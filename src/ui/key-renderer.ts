/**
 * Renders 144×144 SVG key faces (passed to `setImage` as raw SVG strings —
 * Stream Deck's renderer is not a browser: explicit x/y + text-anchor only,
 * no CSS blocks, no dominant-baseline, local fonts only).
 *
 * Geometry is locked by the display spec: anchors never move; only the value
 * glyph size flexes with character count.
 */
import { truncateLabel } from "./format";
import type { Palette } from "./themes";

const FONT = "Segoe UI, Arial, sans-serif";

/** Spark strip box: x 8–136, y 124–140. */
const SPARK = { x: 8, y: 124, w: 128, h: 16 } as const;
/** Accent polyline stroke; the spec's absolute minimum is 3. */
const SPARK_STROKE = 4;
const SPARK_SAMPLES = 36;

/** Label lengths: 16 chars centred, 9 when a stat badge shares the row. */
const LABEL_MAX = 16;
const LABEL_MAX_WITH_BADGE = 9;

export function escapeXml(text: string): string {
	return text.replace(/[<>&'"]/g, (c) => {
		switch (c) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case "'":
				return "&apos;";
			default:
				return "&quot;";
		}
	});
}

/**
 * Value glyph size by rendered character count (digits, dot, sign — the unit
 * is a separate element and never counts).
 */
export function valueFontSize(text: string): number {
	const count = Array.from(text).length;
	if (count <= 2) {
		return 52;
	}
	if (count >= 9) {
		return 26;
	}
	// 3:48 4:44 5:40 6:36 7:32 8:28 — a straight −4 px per character ramp.
	return 48 - (count - 3) * 4;
}

/** Maps a value series onto polyline points within the given box. */
function sparklinePoints(values: readonly number[], x: number, y: number, w: number, h: number): Array<{ px: number; py: number }> {
	if (values.length < 2 || values.some((v) => !Number.isFinite(v))) {
		return [];
	}
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	const span = max - min;
	const points: Array<{ px: number; py: number }> = [];
	for (let i = 0; i < values.length; i++) {
		const px = x + (w * i) / (values.length - 1);
		const norm = span === 0 ? 0.5 : ((values[i] as number) - min) / span;
		const py = y + h - norm * h;
		points.push({ px, py });
	}
	return points;
}

export interface ReadingKeyOptions {
	label: string;
	valueText: string;
	unitText: string;
	/** "MIN" | "MAX" | "AVG" badge; empty for the live value. */
	statBadge: string;
	/** Recent values (display unit); rendered as a sparkline when 2+ points. */
	history?: readonly number[];
	/** Fully resolved tokens (alert override and type accent already applied). */
	palette: Palette;
}

export function renderReadingKey(opts: ReadingKeyOptions): string {
	const { valueText, unitText, statBadge, history, palette } = opts;
	const hasBadge = statBadge !== "";
	const label = truncateLabel(opts.label, hasBadge ? LABEL_MAX_WITH_BADGE : LABEL_MAX);
	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">`,
		`<rect width="144" height="144" fill="${palette.bg}"/>`
	];
	if (hasBadge) {
		// Left-anchored label hard-clipped at x=92 (max 80 px) so it can never
		// reach the end-anchored badge, which owns x≥96. The clip is an opaque
		// bg-colored rect over the label band — clipPath is a reference-based
		// SVG feature the Stream Deck engine isn't proven to honor; a solid
		// fill is renderer-proof by construction.
		parts.push(
			`<text x="12" y="32" text-anchor="start" font-family="${FONT}" font-size="16" font-weight="600" fill="${palette.label}">${escapeXml(label)}</text>`,
			`<rect x="92" y="14" width="52" height="24" fill="${palette.bg}"/>`,
			`<text x="132" y="32" text-anchor="end" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing="0.5" fill="${palette.accent}">${escapeXml(statBadge.toUpperCase())}</text>`
		);
	} else {
		parts.push(`<text x="72" y="32" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="600" fill="${palette.label}">${escapeXml(label)}</text>`);
	}
	parts.push(`<text x="72" y="94" text-anchor="middle" font-family="${FONT}" font-size="${valueFontSize(valueText)}" font-weight="700" fill="${palette.value}">${escapeXml(valueText)}</text>`);
	if (unitText !== "") {
		parts.push(`<text x="72" y="118" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="600" fill="${palette.unit}">${escapeXml(unitText)}</text>`);
	}
	if (history !== undefined) {
		const samples = history.slice(-SPARK_SAMPLES);
		const points = sparklinePoints(samples, SPARK.x, SPARK.y, SPARK.w, SPARK.h);
		if (points.length > 0) {
			const line = points.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(" ");
			const first = points[0] as { px: number; py: number };
			const last = points[points.length - 1] as { px: number; py: number };
			const bottom = SPARK.y + SPARK.h;
			parts.push(
				`<path d="M${first.px.toFixed(1)},${bottom} L${line.split(" ").join(" L")} L${last.px.toFixed(1)},${bottom} Z" fill="${palette.track}"/>`,
				`<polyline points="${line}" fill="none" stroke="${palette.accent}" stroke-width="${SPARK_STROKE}" stroke-linejoin="round" stroke-linecap="round"/>`,
				`<circle cx="${last.px.toFixed(1)}" cy="${last.py.toFixed(1)}" r="5" fill="${palette.accent}"/>`
			);
		}
	}
	parts.push("</svg>");
	return parts.join("");
}

type StatusIcon = "power" | "warning" | "clock" | "lock" | "target" | "question";

/** Simple vector glyphs, each drawn inside a 36×36 box centred at (72, 46). */
const ICONS: Record<StatusIcon, (accent: string) => string> = {
	power: (a) => `<circle cx="72" cy="46" r="19" fill="none" stroke="${a}" stroke-width="3.5"/><polygon points="67,36 82,46 67,56" fill="${a}"/>`,
	warning: (a) =>
		`<polygon points="72,28 91,62 53,62" fill="none" stroke="${a}" stroke-width="3.5" stroke-linejoin="round"/><rect x="70.2" y="40" width="3.6" height="12" rx="1.8" fill="${a}"/><circle cx="72" cy="57" r="2.4" fill="${a}"/>`,
	clock: (a) => `<circle cx="72" cy="46" r="19" fill="none" stroke="${a}" stroke-width="3.5"/><polyline points="72,35 72,47 81,52" fill="none" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/>`,
	lock: (a) =>
		`<rect x="59" y="42" width="26" height="20" rx="3" fill="none" stroke="${a}" stroke-width="3.5"/><path d="M64 42 v-6 a8 8 0 0 1 16 0 v6" fill="none" stroke="${a}" stroke-width="3.5"/>`,
	target: (a) => `<circle cx="72" cy="46" r="18" fill="none" stroke="${a}" stroke-width="3.5"/><circle cx="72" cy="46" r="9" fill="none" stroke="${a}" stroke-width="3.5"/><circle cx="72" cy="46" r="2.5" fill="${a}"/>`,
	question: (a) =>
		`<circle cx="72" cy="46" r="19" fill="none" stroke="${a}" stroke-width="3.5"/><path d="M66 40 a6 6 0 1 1 8.5 5.4 c-2 1-2.5 2-2.5 4.1" fill="none" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/><circle cx="72" cy="56" r="2.4" fill="${a}"/>`
};

export interface StatusKeyOptions {
	icon: StatusIcon;
	accent: string;
	/** 1–3 short lines below the icon. */
	lines: readonly string[];
}

export function renderStatusKey(opts: StatusKeyOptions): string {
	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">`,
		`<rect width="144" height="144" fill="#1a1c22"/>`,
		ICONS[opts.icon](opts.accent)
	];
	const startY = 88;
	for (let i = 0; i < opts.lines.length && i < 3; i++) {
		const line = opts.lines[i] as string;
		// Never regular weight at these physical sizes — strokes thin below one
		// device pixel on the 72 px key.
		const weight = i === 0 ? 700 : 600;
		const fill = i === 0 ? "#ffffff" : "#8b8fa3";
		parts.push(`<text x="72" y="${startY + i * 19}" text-anchor="middle" font-family="${FONT}" font-size="${i === 0 ? 17 : 14}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`);
	}
	parts.push("</svg>");
	return parts.join("");
}
