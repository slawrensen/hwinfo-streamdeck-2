/**
 * Renders 144×144 SVG key faces (passed to `setImage` as raw SVG strings —
 * Stream Deck's renderer is not a browser: explicit x/y + text-anchor only,
 * no CSS blocks, no dominant-baseline, local fonts only).
 */
import type { AlertLevel } from "./format";

const FONT = "Segoe UI, Arial, sans-serif";

const BG: Record<AlertLevel, string> = {
	normal: "#1a1c22",
	warn: "#b45309",
	crit: "#c2251a"
};

const LABEL_FILL: Record<AlertLevel, string> = {
	normal: "#8b8fa3",
	warn: "#ffe3bd",
	crit: "#ffd4cf"
};

const UNIT_FILL: Record<AlertLevel, string> = {
	normal: "#6d7183",
	warn: "#ffe3bd",
	crit: "#ffd4cf"
};

const ACCENT = "#4cc2ff";

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

function valueFontSize(text: string): number {
	if (text.length <= 3) {
		return 52;
	}
	if (text.length <= 5) {
		return 44;
	}
	if (text.length <= 7) {
		return 34;
	}
	return 26;
}

/** Maps a value series onto an SVG polyline within the given box. */
function sparklinePoints(values: readonly number[], x: number, y: number, w: number, h: number): string {
	if (values.length < 2) {
		return "";
	}
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	const span = max - min;
	const points: string[] = [];
	for (let i = 0; i < values.length; i++) {
		const px = x + (w * i) / (values.length - 1);
		const norm = span === 0 ? 0.5 : ((values[i] as number) - min) / span;
		const py = y + h - norm * h;
		points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
	}
	return points.join(" ");
}

export interface ReadingKeyOptions {
	label: string;
	valueText: string;
	unitText: string;
	level: AlertLevel;
	/** "MIN" | "MAX" | "AVG" badge; empty for the live value. */
	statBadge: string;
	/** Recent values (display unit); rendered as a sparkline when 2+ points. */
	history?: readonly number[];
}

export function renderReadingKey(opts: ReadingKeyOptions): string {
	const { label, valueText, unitText, level, statBadge, history } = opts;
	const sparkline = history !== undefined && history.length >= 2;
	const valueY = sparkline ? 84 : 92;
	const unitY = sparkline ? 108 : 120;
	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">`,
		`<rect width="144" height="144" fill="${BG[level]}"/>`,
		`<text x="72" y="30" text-anchor="middle" font-family="${FONT}" font-size="16" fill="${LABEL_FILL[level]}">${escapeXml(label)}</text>`,
		`<text x="72" y="${valueY}" text-anchor="middle" font-family="${FONT}" font-size="${valueFontSize(valueText)}" font-weight="700" fill="#ffffff">${escapeXml(valueText)}</text>`
	];
	if (unitText !== "") {
		parts.push(`<text x="72" y="${unitY}" text-anchor="middle" font-family="${FONT}" font-size="17" fill="${UNIT_FILL[level]}">${escapeXml(unitText)}</text>`);
	}
	if (statBadge !== "") {
		parts.push(`<text x="136" y="24" text-anchor="end" font-family="${FONT}" font-size="13" font-weight="700" fill="${level === "normal" ? ACCENT : "#ffffff"}">${escapeXml(statBadge)}</text>`);
	}
	if (sparkline) {
		const points = sparklinePoints(history, 14, 116, 116, 20);
		if (points !== "") {
			parts.push(`<polyline points="${points}" fill="none" stroke="${level === "normal" ? ACCENT : "rgba(255,255,255,0.85)"}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
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
		const weight = i === 0 ? ` font-weight="700"` : "";
		const fill = i === 0 ? "#ffffff" : "#8b8fa3";
		parts.push(`<text x="72" y="${startY + i * 19}" text-anchor="middle" font-family="${FONT}" font-size="${i === 0 ? 17 : 14}"${weight} fill="${fill}">${escapeXml(line)}</text>`);
	}
	parts.push("</svg>");
	return parts.join("");
}
