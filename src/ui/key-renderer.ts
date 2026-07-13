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

export const FONT = "Segoe UI, Arial, sans-serif";

/** The canvas open every renderer shares: the SVG header plus the full-bleed
 * background rect. */
export function svgOpen(w: number, h: number, bg: string): string[] {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
		`<rect width="${w}" height="${h}" fill="${bg}"/>`
	];
}

/** Spark strip box: x 8–136, y 120–134. Sits above a bottom margin so the
 * line at a session low and the r=5 end dot (down to y≈139) never clip the
 * 144 key edge. */
const SPARK = { x: 8, y: 120, w: 128, h: 14 } as const;
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

/** Maps a value series onto polyline points within the given box. Exported
 * for the dial's two-row view, which draws the same self-normalizing line. */
export function sparklinePoints(values: readonly number[], x: number, y: number, w: number, h: number): Array<{ px: number; py: number }> {
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

/** Composes the sparkline triple (track under-fill, accent line, end dot)
 * from placed points. Exported for the dial's two-row view, which draws the
 * same idiom at its own bottom edge, stroke and dot radius. */
export function sparklineSvg(points: ReadonlyArray<{ px: number; py: number }>, bottom: number, stroke: number, dotR: number, palette: Palette): string[] {
	const line = points.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(" ");
	const first = points[0] as { px: number; py: number };
	const last = points[points.length - 1] as { px: number; py: number };
	return [
		`<path d="M${first.px.toFixed(1)},${bottom} L${line.split(" ").join(" L")} L${last.px.toFixed(1)},${bottom} Z" fill="${palette.track}"/>`,
		`<polyline points="${line}" fill="none" stroke="${palette.accent}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`,
		`<circle cx="${last.px.toFixed(1)}" cy="${last.py.toFixed(1)}" r="${dotR}" fill="${palette.accent}"/>`
	];
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
	const parts: string[] = svgOpen(144, 144, palette.bg);
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
			parts.push(...sparklineSvg(points, SPARK.y + SPARK.h, SPARK_STROKE, 5, palette));
		}
	}
	parts.push("</svg>");
	return parts.join("");
}

/** Dual rows: label baselines y=22/94, value baselines y=56/128 — row B is
 * row A shifted exactly 72 px, the key's midline, with a 2 px track-color
 * divider centered between them. Everything centers on x=72 like the single
 * layout (keys are optically centered surfaces; the divider badge already
 * was). A stat badge shared by both rows sits in a gap at the divider's
 * center; a per-row badge rides inline after the unit, the dial's own
 * idiom, so a row label always keeps its full 16 characters and nothing
 * crowds the key's corners. */
const DUAL = { labelY: 22, valueY: 56, rowPitch: 72, dividerY: 71 } as const;
const DUAL_LABEL_MAX = 16;
const DUAL_VALUE_MAX = 14;
/** The divider gap that hosts the shared badge: centered on x=72. */
const DUAL_BADGE_GAP = { x: 47, y: 63, w: 50, h: 14 } as const;

/** Gap first (opaque bg over the divider or cross arms), then the badge into
 * it: solid fills, the only clipping primitive proven on this engine. */
function sharedBadgeSvg(badge: string, palette: Palette): [string, string] {
	return [
		`<rect x="${DUAL_BADGE_GAP.x}" y="${DUAL_BADGE_GAP.y}" width="${DUAL_BADGE_GAP.w}" height="${DUAL_BADGE_GAP.h}" fill="${palette.bg}"/>`,
		`<text x="72" y="76" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing="0.5" fill="${palette.accent}">${escapeXml(badge.toUpperCase())}</text>`
	];
}

/**
 * Dual-row value size by character count. One readout per half key: 32 px
 * for the numeric norm, stepped tiers for fixed-decimals extremes, never
 * below 14 px (the 12 px legibility floor plus margin). An inline badge
 * shares the line, so a badged row steps down exactly one tier.
 */
export function dualValueFontSize(text: string, badged = false): 32 | 24 | 17 | 14 {
	const count = Array.from(text).length;
	const tier = count <= 4 ? 0 : count <= 6 ? 1 : count <= 9 ? 2 : 3;
	const sizes = [32, 24, 17, 14] as const;
	return sizes[Math.min(3, tier + (badged ? 1 : 0))] as 32 | 24 | 17 | 14;
}

export interface DualKeyRow {
	label: string;
	valueText: string;
	unitText: string;
	/** This row's own "MIN" | "MAX" | "AVG", drawn inline after the unit;
	 * empty for the live value or when sharedBadge covers both rows. */
	statBadge: string;
}

export interface DualKeyOptions {
	top: DualKeyRow;
	bottom: DualKeyRow;
	/** Stat both rows display; drawn once, centered in the divider gap.
	 * The caller sets this INSTEAD of the per-row badges when the rows
	 * show the same stat. Empty for none. */
	sharedBadge?: string;
	/** Fully resolved tokens (alert override and type accent already applied;
	 * alerts come from the primary reading's thresholds only). */
	palette: Palette;
}

/**
 * The dual layout: two stacked readouts on one key, each a label line plus a
 * value line with the unit inline (the dial's proven tspan idiom), separated
 * by a track-color divider. No sparkline in this layout — two rows use the
 * full face.
 */
export function renderDualKey(opts: DualKeyOptions): string {
	const { palette } = opts;
	const sharedBadge = opts.sharedBadge ?? "";
	const parts: string[] = svgOpen(144, 144, palette.bg);
	[opts.top, opts.bottom].forEach((row, i) => {
		const labelY = DUAL.labelY + i * DUAL.rowPitch;
		const valueY = DUAL.valueY + i * DUAL.rowPitch;
		parts.push(`<text x="72" y="${labelY}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="${palette.label}">${escapeXml(truncateLabel(row.label, DUAL_LABEL_MAX))}</text>`);
		const valueText = truncateLabel(row.valueText, DUAL_VALUE_MAX);
		const badged = row.statBadge !== "";
		const unit = row.unitText !== "" ? `<tspan dx="6" font-size="14" font-weight="600" fill="${palette.unit}">${escapeXml(row.unitText)}</tspan>` : "";
		const badge = badged ? `<tspan dx="6" font-size="12" font-weight="700" letter-spacing="0.5" fill="${palette.accent}">${escapeXml(row.statBadge.toUpperCase())}</tspan>` : "";
		// One middle-anchored chunk: the engine centers the value, unit and
		// badge as a unit, exactly like the single layout centers its value.
		parts.push(`<text x="72" y="${valueY}" text-anchor="middle" font-family="${FONT}" font-size="${dualValueFontSize(valueText, badged)}" font-weight="700" fill="${palette.value}">${escapeXml(valueText)}${unit}${badge}</text>`);
	});
	parts.push(`<rect x="12" y="${DUAL.dividerY}" width="120" height="2" fill="${palette.track}"/>`);
	if (sharedBadge !== "") {
		parts.push(...sharedBadgeSvg(sharedBadge, palette));
	}
	parts.push("</svg>");
	return parts.join("");
}

/** Quad grid: four readouts in a 2x2 grid split by a hairline track-color
 * cross. Cell centers sit at x=36/108 with the two rows at y offsets 0/72,
 * so each quadrant is one 72 px cell of the 144 canvas. The shared stat
 * badge reuses the dual layout's divider-gap idiom, centered where the
 * cross arms meet. */
const QUAD = { cellCenterX: [36, 108], rowTop: [0, 72] } as const;
/** The cross arms: the dual divider plus its vertical twin. */
const QUAD_CROSS_H = { x: 12, y: 71, w: 120, h: 2 } as const;
const QUAD_CROSS_V = { x: 71, y: 12, w: 2, h: 120 } as const;
/** Micro-label budget: 4 code points, hard cut (an ellipsis would eat a
 * third of a 12 px identifier). */
const QUAD_LABEL_MAX = 4;
/** Values ellipsize here; the quad formatter caps at 4 glyphs, so any longer
 * text is a defensive path, and 7 glyphs at the ramp's 14 px still fit the
 * 72 px cell. */
const QUAD_VALUE_MAX = 7;

/** Default per-slot identity colors (top-left, top-right, bottom-left,
 * bottom-right): four hues apart in both hue and lightness, picked to hold
 * against every theme background. The action salvages user overrides per
 * entry against these; the PI's preset list starts from the same four. */
export const QUAD_DEFAULT_COLORS = ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"] as const;

/**
 * Quad-cell value size by character count. The quad formatter caps values
 * at 4 glyphs, where the base size holds (26 px, or 24 px when a micro-label
 * shares the cell); anything longer steps down 4 px per extra glyph rather
 * than overflow a 72 px cell, never below the 12 px legibility floor.
 */
export function quadValueFontSize(text: string, labeled = false): number {
	const count = Array.from(text).length;
	const base = labeled ? 24 : 26;
	if (count <= 4) {
		return base;
	}
	return Math.max(12, base - (count - 4) * 4);
}

export interface QuadKeyCell {
	/** Micro-label source; drawn only in the labeled variant, hard-cut to 4
	 * code points and uppercased. Empty draws no label. */
	label: string;
	valueText: string;
	unitText: string;
	/** This slot's identity color, already salvaged by the caller. It fills
	 * the value in the default variant and the micro-label in the labeled
	 * one. On alert the caller passes the alert palette's own text token
	 * instead, so the whole key stays inside the global alert palette. */
	color: string;
}

export interface QuadKeyOptions {
	/** Up to four cells in reading order (top-left, top-right, bottom-left,
	 * bottom-right). A null slot draws an empty quadrant. */
	cells: readonly (QuadKeyCell | null)[];
	/** Micro-label variant: a slot-colored 12 px label above a value in the
	 * theme's value color, instead of color-as-identity values. */
	labels?: boolean;
	/** Stat every slot displays; one badge centered at the cross
	 * intersection in the dual layout's gap idiom. Empty for the live value. */
	sharedBadge?: string;
	/** Fully resolved tokens (alert override and type accent already applied;
	 * alerts come from the primary reading's thresholds only). */
	palette: Palette;
}

/**
 * The quad layout: a 2x2 grid of readouts behind a hairline cross. No
 * sparkline and no per-cell badges in this layout; four cells use the whole
 * face and the one shared badge sits at the cross center.
 */
export function renderQuadKey(opts: QuadKeyOptions): string {
	const { palette } = opts;
	const labeled = opts.labels === true;
	const sharedBadge = opts.sharedBadge ?? "";
	const parts: string[] = svgOpen(144, 144, palette.bg);
	for (let i = 0; i < 4; i++) {
		const cell = opts.cells[i] ?? null;
		if (cell === null) {
			continue;
		}
		const cx = QUAD.cellCenterX[i % 2] as number;
		const top = QUAD.rowTop[i < 2 ? 0 : 1] as number;
		const valueText = truncateLabel(cell.valueText, QUAD_VALUE_MAX);
		if (labeled) {
			// Uppercase before the cut: locale expansions (ß to SS) must never
			// push a micro-label past its 4-glyph budget.
			const micro = Array.from(cell.label.trim().toUpperCase()).slice(0, QUAD_LABEL_MAX).join("").trimEnd();
			if (micro !== "") {
				parts.push(`<text x="${cx}" y="${top + 20}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing="0.5" fill="${cell.color}">${escapeXml(micro)}</text>`);
			}
		}
		parts.push(`<text x="${cx}" y="${top + (labeled ? 45 : 40)}" text-anchor="middle" font-family="${FONT}" font-size="${quadValueFontSize(valueText, labeled)}" font-weight="700" fill="${labeled ? palette.value : cell.color}">${escapeXml(valueText)}</text>`);
		if (cell.unitText !== "") {
			// 14 px matches the dual layout's unit step (single 16, dual 14,
			// quad 14): the empty band under the value has the room, and the
			// unit is what tells 1785 RPM from 1785 MHz at a glance.
			parts.push(`<text x="${cx}" y="${top + (labeled ? 61 : 58)}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="${palette.unit}">${escapeXml(cell.unitText)}</text>`);
		}
	}
	parts.push(
		`<rect x="${QUAD_CROSS_H.x}" y="${QUAD_CROSS_H.y}" width="${QUAD_CROSS_H.w}" height="${QUAD_CROSS_H.h}" fill="${palette.track}"/>`,
		`<rect x="${QUAD_CROSS_V.x}" y="${QUAD_CROSS_V.y}" width="${QUAD_CROSS_V.w}" height="${QUAD_CROSS_V.h}" fill="${palette.track}"/>`
	);
	if (sharedBadge !== "") {
		parts.push(...sharedBadgeSvg(sharedBadge, palette));
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
	// True black so the key vanishes into an OLED panel (no backlight glow,
	// no burn-in worry) and stays calm on the desk.
	const parts: string[] = [...svgOpen(144, 144, "#000000"), ICONS[opts.icon](opts.accent)];
	// One soft-white headline (never pure #fff — it blooms on OLED and tires the
	// eye) and at most one dim sub-line. Two lines, not three: the full recovery
	// step already lives in the PI hint, so the key can breathe.
	const lines = opts.lines.slice(0, 2);
	const single = lines.length === 1;
	for (let i = 0; i < lines.length; i++) {
		const headline = i === 0;
		const y = single ? 104 : 100 + i * 22;
		// Hierarchy comes from size + color, not weight — both stay >=600 so the
		// strokes survive the 0.5x downscale to the 72 px physical key.
		parts.push(
			`<text x="72" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${headline ? 19 : 13}" font-weight="600" fill="${headline ? "#d6d9de" : "#6b7280"}">${escapeXml(lines[i] as string)}</text>`
		);
	}
	parts.push("</svg>");
	return parts.join("");
}
