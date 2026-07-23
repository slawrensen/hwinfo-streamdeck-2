/**
 * Renders 144×144 SVG key faces (passed to `setImage` as raw SVG strings —
 * Stream Deck's renderer is not a browser: explicit x/y + text-anchor only,
 * no CSS blocks, no dominant-baseline, local fonts only).
 *
 * Geometry is locked by the display spec: anchors move only when the spec
 * does (the unit baseline lifted 118→112 in the 2026-07 bottom-zone fix,
 * then settled at 114 when the spark span was inset for its stroke);
 * value and label glyph sizes flex with content.
 */
import { estimateKeyTextWidth, fitTextLadder, truncateLabel, type FittedText } from "./format";
import { themeTextColors, type TextColors } from "./text-colors";
import type { Palette } from "./themes";

export const FONT = "Segoe UI, Arial, sans-serif";

/** A gauge zone with its fill already resolved by the caller (the renderers
 * never decide alert colors). Normalized 0..1 along the track. */
export type DrawnZone = { from: number; to: number; color: string };

/** A resolved bounded-value gauge for the single-key Bar and Ring displays. */
export type KeyGauge = {
	kind: "bar" | "ring";
	/** Fill fraction 0..1; NaN draws the empty track only. */
	fraction: number;
	zones: readonly DrawnZone[];
};

/** The canvas open every renderer shares: the SVG header plus the full-bleed
 * background rect. */
export function svgOpen(w: number, h: number, bg: string): string[] {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
		`<rect width="${w}" height="${h}" fill="${bg}"/>`
	];
}

/** Spark strip box: x 8–136, line span y 122–134 (underfill bottom stays
 * 134). The polyline tops out 2 px above its span (stroke 4), so the top
 * inset pins worst-case spark ink at exactly the y=120 band edge instead
 * of overshooting to 118; that reclaimed air is what lets the unit sit at
 * 114 with an even corridor. Sits above a bottom margin so the line at a
 * session low and the r=5 end dot (down to y≈139) never clip the 144 key
 * edge. */
const SPARK = { x: 8, y: 122, w: 128, h: 12 } as const;
/** Accent polyline stroke; the spec's absolute minimum is 3. */
const SPARK_STROKE = 4;
const SPARK_SAMPLES = 36;

/** Bar gauge track: raised above the sparkline strip's row and inset from
 * the sides, because the physical key's lens crops the outer ~10 px of the
 * canvas and rounds its corners (hardware-verified 2026-07-16: a pill at
 * x8/y124 ran into the crop). 10 px tall is 5 physical px on the 72 px
 * key — clearly readable, with 14 px of bottom clearance. */
const KEY_BAR = { x: 16, y: 120, w: 112, h: 10, r: 5 } as const;

/** Ring gauge: an automotive-style arc opening DOWNWARD (the gauge pattern
 * every tachometer and dashboard meter trains: sweep starts bottom-left,
 * crests the top, ends bottom-right, so a high-is-bad redline lands at the
 * lower right). r=46 at cy=90: the crown's outer stroke edge sits at y=39,
 * clear of the label band, and the arc ends' round caps reach y≈130, inside
 * the physical lens crop that cuts below ~y=134 (hardware-verified
 * 2026-07-16). Value and unit keep their locked anchors inside the ring. */
const RING = { cx: 72, cy: 90, r: 46, stroke: 10, gapDeg: 80 } as const;

/** Ring-mode value sizes by character count: the same shrink idea as the
 * single layout, stepped so the widest rendered value (~0.55 em per glyph)
 * stays inside the ring's inner chord across the glyph band. The fit rule
 * is the inner-circle chord at the glyph-band TOP (value baseline y=94,
 * digit tops ~0.70 em above it, inner radius r minus stroke/2), not the
 * midline diameter: text half-width n*0.55*F/2 must stay inside the chord
 * half-width at that height. */
const RING_VALUE_SIZES = [44, 44, 44, 40, 32, 27, 23, 20, 18] as const;

export function ringValueFontSize(text: string): number {
	const count = Array.from(text).length;
	return count >= 9 ? 16 : (RING_VALUE_SIZES[count] as number);
}

/** Label fitting: a size ladder against the 120 px band every label owns
 * (x=12..132, the lens-safe span), so a short label ("CCD1") renders large
 * and a long one ellipsizes at the floor — which stays the pre-adaptive 16:
 * sizes only ever grow (the issue #3 ask), never shrink an existing
 * profile's label. */
const LABEL_BUDGET = 120;
const LABEL_SIZES = [20, 18, 16] as const;
/** The stat badge's shared-badge rows: gap 38..52, caps on baseline 48 —
 * between the label band and the widest value's digit tops (y≈56.6). */
const BADGE_GAP_Y = 38;
const BADGE_TEXT_Y = 48;

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

/**
 * One horizontal bar-track segment, squared or pill-rounded per end. Rounding
 * both ends is one rect; a single rounded end is the rounded rect plus a
 * same-color square overpaint on the other end — solid fills are the only
 * clipping primitive proven on the Stream Deck engine. Shared with the dial
 * bar's zones, so this idiom has exactly one home.
 */
export function barSegment(x: number, w: number, y: number, h: number, r: number, color: string, roundLeft: boolean, roundRight: boolean): string {
	if (!roundLeft && !roundRight) {
		return `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${h}" fill="${color}"/>`;
	}
	const rounded = `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="${r}" fill="${color}"/>`;
	if (roundLeft && roundRight) {
		return rounded;
	}
	const squareW = Math.min(r, w / 2);
	const squareX = roundLeft ? x + w - squareW : x;
	return `${rounded}<rect x="${squareX.toFixed(1)}" y="${y}" width="${squareW.toFixed(1)}" height="${h}" fill="${color}"/>`;
}

/** The key Bar gauge: pill track in the sparkline strip's row, threshold
 * zones on the track, accent fill following the live value. */
function keyBarSvg(gauge: KeyGauge, palette: Palette): string[] {
	const { x, y, w, h, r } = KEY_BAR;
	const parts = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${palette.track}"/>`];
	for (const zone of gauge.zones) {
		const zx = x + zone.from * w;
		const zw = (zone.to - zone.from) * w;
		if (zw <= 0) {
			continue;
		}
		parts.push(barSegment(zx, zw, y, h, r, zone.color, zone.from <= 0, zone.to >= 1));
	}
	if (Number.isFinite(gauge.fraction) && gauge.fraction > 0) {
		const fw = Math.max(h, Math.min(1, gauge.fraction) * w);
		parts.push(`<rect x="${x}" y="${y}" width="${fw.toFixed(1)}" height="${h}" rx="${r}" fill="${palette.accent}"/>`);
	}
	return parts;
}

/** Point on the ring at `deg` degrees clockwise from 12 o'clock. */
function ringPoint(deg: number): { x: number; y: number } {
	const rad = (deg * Math.PI) / 180;
	return { x: RING.cx + RING.r * Math.sin(rad), y: RING.cy - RING.r * Math.cos(rad) };
}

/** One stroked arc along the ring from `fromDeg` to `toDeg` (clockwise).
 * Arc path commands are proven on this engine (the status-key lock icon). */
function ringArc(fromDeg: number, toDeg: number, color: string): string {
	const from = ringPoint(fromDeg);
	const to = ringPoint(toDeg);
	const large = toDeg - fromDeg > 180 ? 1 : 0;
	return `<path d="M${from.x.toFixed(1)},${from.y.toFixed(1)} A${RING.r},${RING.r} 0 ${large} 1 ${to.x.toFixed(1)},${to.y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${RING.stroke}" stroke-linecap="round"/>`;
}

/** The key Ring gauge: one restrained arc around the value, opening
 * downward like a meter dial. Track, threshold zones, then the accent fill
 * sweeping clockwise from the bottom-left end. */
function keyRingSvg(gauge: KeyGauge, palette: Palette): string[] {
	const start = 180 + RING.gapDeg / 2;
	const sweep = 360 - RING.gapDeg;
	const parts = [ringArc(start, start + sweep, palette.track)];
	for (const zone of gauge.zones) {
		if (zone.to - zone.from <= 0) {
			continue;
		}
		parts.push(ringArc(start + zone.from * sweep, start + zone.to * sweep, zone.color));
	}
	if (Number.isFinite(gauge.fraction) && gauge.fraction > 0) {
		// Round caps keep a minimum sweep visible, like the bar's h-wide floor.
		const fillSweep = Math.max(4, Math.min(1, gauge.fraction) * sweep);
		parts.push(ringArc(start, start + fillSweep, palette.accent));
	}
	return parts;
}

export interface ReadingKeyOptions {
	label: string;
	valueText: string;
	unitText: string;
	/** "MIN" | "MAX" | "AVG" badge; empty for the live value. */
	statBadge: string;
	/** Recent values (display unit); rendered as a sparkline when 2+ points. */
	history?: readonly number[];
	/** Bounded-value gauge (Bar or Ring display); the caller passes either
	 * this or `history`, never both. */
	gauge?: KeyGauge;
	/** Fully resolved tokens (alert override and type accent already applied). */
	palette: Palette;
	/** Resolved textual fills; defaults to the palette's own text tokens. */
	text?: TextColors;
}

export function renderReadingKey(opts: ReadingKeyOptions): string {
	const { valueText, unitText, statBadge, history, gauge, palette } = opts;
	const text = opts.text ?? themeTextColors(palette);
	const ring = gauge?.kind === "ring";
	const label = fitTextLadder(opts.label, LABEL_BUDGET, LABEL_SIZES);
	const parts: string[] = svgOpen(144, 144, palette.bg);
	if (ring && gauge !== undefined) {
		// The ring draws first so the value, unit and badge paint over its field.
		parts.push(...keyRingSvg(gauge, palette));
	}
	parts.push(`<text x="72" y="32" text-anchor="middle" font-family="${FONT}" font-size="${label.fontSize}" font-weight="600" fill="${text.label}">${escapeXml(label.text)}</text>`);
	if (statBadge !== "") {
		// The stat reads as part of the whole "title / stat / number" stack, in
		// the family's shared-badge gap idiom: the bg rect notches the Ring
		// crown the way the dual gap notches its divider, and the label keeps
		// its full band — a stat must never cost title width.
		parts.push(...sharedBadgeSvg(statBadge, palette, text.badge, BADGE_GAP_Y, BADGE_TEXT_Y));
	}
	parts.push(`<text x="72" y="94" text-anchor="middle" font-family="${FONT}" font-size="${ring ? ringValueFontSize(valueText) : valueFontSize(valueText)}" font-weight="700" fill="${text.value}">${escapeXml(valueText)}</text>`);
	if (unitText !== "") {
		// Baseline 114/18: worst-case spark/bar ink starts at y=120 (the spark
		// span is inset for its stroke), so the corridor is optically balanced
		// with the larger gap against the heavier neighbor — measured ink air
		// 6.5–7.0 up to the value vs 5.9 down to the band, and descender units
		// (Mbps) keep the same ≥1.9 px band clearance the 112 baseline had.
		parts.push(`<text x="72" y="114" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="600" fill="${text.unit}">${escapeXml(unitText)}</text>`);
	}
	if (gauge !== undefined && gauge.kind === "bar") {
		parts.push(...keyBarSvg(gauge, palette));
	}
	if (gauge === undefined && history !== undefined) {
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
/** Dual labels fit the same 120 px band as the single layout, one step
 * smaller: a short row label gains a size, a long one keeps today's 14.
 * The TOP row caps at 15: from its y=22 baseline, 16 px cap tops reach
 * y≈10.8, grazing the ~10 px top lens crop, and accented caps would lose
 * their marks outright. The bottom row (baseline y=94) has no such edge. */
const DUAL_LABEL_SIZES_TOP = [15, 14] as const;
const DUAL_LABEL_SIZES = [16, 15, 14] as const;
const DUAL_VALUE_MAX = 14;
/** The divider gap that hosts the shared badge: centered on x=72. */
const DUAL_BADGE_GAP = { x: 47, y: 63, w: 50, h: 14 } as const;

/** Gap first (opaque bg over whatever lies beneath — divider, cross arms or
 * the single key's ring crown), then the badge into it: solid fills, the
 * only clipping primitive proven on this engine. The default gap/text rows
 * are the dual divider's; the triple and single layouts pass their own. */
function sharedBadgeSvg(badge: string, palette: Palette, badgeColor: string, gapY: number = DUAL_BADGE_GAP.y, textY = 76): [string, string] {
	return [
		`<rect x="${DUAL_BADGE_GAP.x}" y="${gapY}" width="${DUAL_BADGE_GAP.w}" height="${DUAL_BADGE_GAP.h}" fill="${palette.bg}"/>`,
		`<text x="72" y="${textY}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing="0.5" fill="${badgeColor}">${escapeXml(badge.toUpperCase())}</text>`
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
	/** Resolved textual fills; defaults to the palette's own text tokens. */
	text?: TextColors;
}

/**
 * The dual layout: two stacked readouts on one key, each a label line plus a
 * value line with the unit inline (the dial's proven tspan idiom), separated
 * by a track-color divider. No sparkline in this layout — two rows use the
 * full face.
 */
export function renderDualKey(opts: DualKeyOptions): string {
	const { palette } = opts;
	const text = opts.text ?? themeTextColors(palette);
	const sharedBadge = opts.sharedBadge ?? "";
	const parts: string[] = svgOpen(144, 144, palette.bg);
	[opts.top, opts.bottom].forEach((row, i) => {
		const labelY = DUAL.labelY + i * DUAL.rowPitch;
		const valueY = DUAL.valueY + i * DUAL.rowPitch;
		const label = fitTextLadder(row.label, LABEL_BUDGET, i === 0 ? DUAL_LABEL_SIZES_TOP : DUAL_LABEL_SIZES);
		parts.push(`<text x="72" y="${labelY}" text-anchor="middle" font-family="${FONT}" font-size="${label.fontSize}" font-weight="600" fill="${text.label}">${escapeXml(label.text)}</text>`);
		const valueText = truncateLabel(row.valueText, DUAL_VALUE_MAX);
		const badged = row.statBadge !== "";
		const unit = row.unitText !== "" ? `<tspan dx="6" font-size="14" font-weight="600" fill="${text.unit}">${escapeXml(row.unitText)}</tspan>` : "";
		const badge = badged ? `<tspan dx="6" font-size="12" font-weight="700" letter-spacing="0.5" fill="${text.badge}">${escapeXml(row.statBadge.toUpperCase())}</tspan>` : "";
		// One middle-anchored chunk: the engine centers the value, unit and
		// badge as a unit, exactly like the single layout centers its value.
		parts.push(`<text x="72" y="${valueY}" text-anchor="middle" font-family="${FONT}" font-size="${dualValueFontSize(valueText, badged)}" font-weight="700" fill="${text.value}">${escapeXml(valueText)}${unit}${badge}</text>`);
	});
	parts.push(`<rect x="12" y="${DUAL.dividerY}" width="120" height="2" fill="${palette.track}"/>`);
	if (sharedBadge !== "") {
		parts.push(...sharedBadgeSvg(sharedBadge, palette, text.badge));
	}
	parts.push("</svg>");
	return parts.join("");
}

/** Triple rows: three 48 px horizontal bands, each one compact readout with
 * the label start-anchored at x=12 (the badge layout's hardware-proven left
 * anchor) and the value+unit chunk end-anchored at x=132 (the badge's proven
 * right anchor), separated by the dual divider's 2 px track-color rule.
 * Baselines sit at each band's optical center; the bottom row's descenders
 * stay above the ~y=134 physical lens crop. */
const TRIPLE = { labelX: 12, valueRight: 132, baselines: [30, 78, 126], separatorYs: [47, 95], rowWidth: 120 } as const;
/** Band interiors (between the face edges and the separators), used by the
 * chunk's solid under-mask so it never repaints a separator. */
const TRIPLE_BANDS = [
	{ top: 0, height: 47 },
	{ top: 49, height: 46 },
	{ top: 97, height: 47 }
] as const;
/** Value ladder: 18 px reads clearly at the physical half scale; the floor
 * shares the dual layout's 14 px (above the 12 px legibility floor). One
 * size serves all rows so the values read as one column. */
const TRIPLE_VALUE_SIZES = [18, 16, 14] as const;
/** Labels yield before values: the dual ladder extended to the 12 px
 * legibility floor (the quad micro-labels' and dial overview's size), so a
 * medium label like "Core Max" renders whole beside its value instead of
 * ellipsizing two sizes up. */
const TRIPLE_LABEL_SIZES = [16, 15, 14, 13, 12] as const;
/** Inline unit, the multi-readout family's 14 px step (dual and quad). */
const TRIPLE_UNIT_SIZE = 14;
/** The dual chunks' inline tspan gap. */
const TRIPLE_UNIT_DX = 6;
/** Defensive value cut (the formatter compacts long before this). 11 keeps
 * even an all-digit value plus the widest data unit inside the canvas when
 * the chunk grows leftward from its end anchor. */
const TRIPLE_VALUE_MAX = 11;
/** Defensive unit cut: 5 covers every re-tiered unit ("MiB/s") and HWiNFO's
 * common native ones; an arbitrary custom-sensor unit ("requests/sec")
 * would otherwise push the value's most significant digits off the canvas,
 * a silently wrong number. */
const TRIPLE_UNIT_MAX = 5;
/** Labels on one face stay within one visible step of the smallest fitted
 * peer (values already share one size): 16 px beside 12 px reads as an
 * accidental hierarchy between rows that are semantic equals. */
const TRIPLE_LABEL_SPREAD = 2;
/** A value chunk may claim at most this much of the 120 px row, so every
 * fitted label keeps a readable minimum before it ellipsizes. */
const TRIPLE_CHUNK_MAX = 84;
/** Optical gap between a fitted label and its row's value chunk. */
const TRIPLE_LABEL_GAP = 8;
/** No label renders below this budget: a lone ellipsis is noise, and the
 * band reads cleaner as value-only. */
const TRIPLE_LABEL_MIN_BUDGET = 16;
/** The shared badge's gap and text rows, the dual idiom re-centered on the
 * first separator (y=48): under the primary row, whose stat the badge names. */
const TRIPLE_BADGE_GAP_Y = 39;
const TRIPLE_BADGE_TEXT_Y = 52;

export interface TripleKeyRow {
	label: string;
	valueText: string;
	unitText: string;
}

export interface TripleKeyOptions {
	/** Up to three rows top to bottom. A null slot draws an empty band. */
	rows: readonly (TripleKeyRow | null)[];
	/** Stat every row displays (the key press cycles all rows together);
	 * one badge in a gap on the first separator. Empty for the live value. */
	sharedBadge?: string;
	/** Fully resolved tokens (alert override and type accent already applied;
	 * alerts come from the primary reading's thresholds only). */
	palette: Palette;
	/** Resolved textual fills; defaults to the palette's own text tokens. */
	text?: TextColors;
}

/** Estimated width of one row's end-anchored value+unit chunk at the given
 * value size (the unit keeps its fixed step, like the dual chunks). */
function tripleChunkWidth(row: TripleKeyRow, valueSize: number): number {
	let width = estimateKeyTextWidth(row.valueText, valueSize, { fontWeight: 700 });
	if (row.unitText !== "") {
		width += TRIPLE_UNIT_DX + estimateKeyTextWidth(row.unitText, TRIPLE_UNIT_SIZE);
	}
	return width;
}

/**
 * One value size for the whole face: the largest ladder step where every
 * configured row's chunk stays inside the chunk budget, so the values keep
 * a stable right-aligned column instead of three sizes stacked. Callers
 * pass rows whose valueText is already cut to the defensive maximum.
 */
export function tripleValueFontSize(rows: readonly (TripleKeyRow | null)[]): number {
	for (const size of TRIPLE_VALUE_SIZES) {
		if (rows.every((row) => row === null || tripleChunkWidth(row, size) <= TRIPLE_CHUNK_MAX)) {
			return size;
		}
	}
	return TRIPLE_VALUE_SIZES[TRIPLE_VALUE_SIZES.length - 1] as number;
}

/**
 * The triple layout: three compact horizontal readouts, label left and
 * value+unit right on a shared baseline per band, thin track-color
 * separators between bands. No sparkline, gauge or per-row controls — three
 * rows use the whole face and stay calm. Each row's label budget derives
 * from its own chunk's estimated width; a bg-colored mask under the chunk
 * (paint order, the engine's one proven clipping primitive) guarantees an
 * estimation miss can never strike through the numbers.
 */
export function renderTripleKey(opts: TripleKeyOptions): string {
	const { palette } = opts;
	const text = opts.text ?? themeTextColors(palette);
	const sharedBadge = opts.sharedBadge ?? "";
	const rows = [0, 1, 2].map((i) => {
		const row = opts.rows[i] ?? null;
		return row === null ? null : { ...row, valueText: truncateLabel(row.valueText, TRIPLE_VALUE_MAX), unitText: truncateLabel(row.unitText, TRIPLE_UNIT_MAX) };
	});
	const valueSize = tripleValueFontSize(rows);
	// Fit every label first: the face-wide spread cap needs the smallest
	// fitted peer before anything draws (a degenerate fit draws value-only
	// and doesn't drag the cap down).
	const fitted = rows.map((row) => {
		if (row === null) {
			return null;
		}
		const chunkWidth = tripleChunkWidth(row, valueSize);
		const labelBudget = TRIPLE.rowWidth - chunkWidth - TRIPLE_LABEL_GAP;
		if (labelBudget < TRIPLE_LABEL_MIN_BUDGET) {
			return { chunkWidth, label: null };
		}
		const label = fitTextLadder(row.label, labelBudget, TRIPLE_LABEL_SIZES, { minimumSlack: 2 });
		return { chunkWidth, label: label.text === "" || label.text === "…" ? null : label };
	});
	const minLabelSize = Math.min(...fitted.map((f) => (f !== null && f.label !== null ? f.label.fontSize : Number.POSITIVE_INFINITY)));
	const parts: string[] = svgOpen(144, 144, palette.bg);
	rows.forEach((row, i) => {
		if (row === null) {
			return;
		}
		const baseline = TRIPLE.baselines[i] as number;
		const band = TRIPLE_BANDS[i] as (typeof TRIPLE_BANDS)[number];
		const fit = fitted[i] as { chunkWidth: number; label: FittedText | null };
		if (fit.label !== null) {
			// A size already fitted only shrinks under the cap, never grows,
			// so the fitted text stays valid at the capped size.
			const size = Math.min(fit.label.fontSize, minLabelSize + TRIPLE_LABEL_SPREAD);
			parts.push(
				`<text x="${TRIPLE.labelX}" y="${baseline}" text-anchor="start" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${text.label}">${escapeXml(fit.label.text)}</text>`,
				`<rect x="${(TRIPLE.valueRight - fit.chunkWidth - 4).toFixed(1)}" y="${band.top}" width="${(fit.chunkWidth + 12).toFixed(1)}" height="${band.height}" fill="${palette.bg}"/>`
			);
		}
		const unit = row.unitText !== "" ? `<tspan dx="${TRIPLE_UNIT_DX}" font-size="${TRIPLE_UNIT_SIZE}" font-weight="600" fill="${text.unit}">${escapeXml(row.unitText)}</tspan>` : "";
		parts.push(`<text x="${TRIPLE.valueRight}" y="${baseline}" text-anchor="end" font-family="${FONT}" font-size="${valueSize}" font-weight="700" fill="${text.value}">${escapeXml(row.valueText)}${unit}</text>`);
	});
	// A separator draws only between configured rows: a trailing rule over
	// an unpicked band would read as a row that failed to load. The empty
	// band an unpicked slot leaves behind stays plain whitespace.
	TRIPLE.separatorYs.forEach((y, k) => {
		const above = rows.slice(0, k + 1).some((r) => r !== null);
		const below = rows.slice(k + 1).some((r) => r !== null);
		if (above && below) {
			parts.push(`<rect x="12" y="${y}" width="120" height="2" fill="${palette.track}"/>`);
		}
	});
	if (sharedBadge !== "") {
		parts.push(...sharedBadgeSvg(sharedBadge, palette, text.badge, TRIPLE_BADGE_GAP_Y, TRIPLE_BADGE_TEXT_Y));
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
/** Micro-label size ladder: 14 when the four glyphs fit the cell's safe
 * width, 12 (the old fixed size) when they run wide — four W-class caps at
 * 14 px would graze the lens crop on the outer cells. */
const QUAD_LABEL_SIZES = [14, 12] as const;
const QUAD_LABEL_BUDGET = 50;
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
	/** Resolved textual fills; defaults to the palette's own text tokens.
	 * Cell identity colors arrive per cell, already resolved by the caller. */
	text?: TextColors;
}

/**
 * The quad layout: a 2x2 grid of readouts behind a hairline cross. No
 * sparkline and no per-cell badges in this layout; four cells use the whole
 * face and the one shared badge sits at the cross center.
 */
export function renderQuadKey(opts: QuadKeyOptions): string {
	const { palette } = opts;
	const text = opts.text ?? themeTextColors(palette);
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
				// The 4-code-point cut above keeps the identity budget; the fit
				// only picks the size (four bold W's price 48.2, inside 50 —
				// any slack here would push WWWW into an ellipsis).
				const fit = fitTextLadder(micro, QUAD_LABEL_BUDGET, QUAD_LABEL_SIZES, { fontWeight: 700, letterSpacing: 0.5 });
				parts.push(`<text x="${cx}" y="${top + 20}" text-anchor="middle" font-family="${FONT}" font-size="${fit.fontSize}" font-weight="700" letter-spacing="0.5" fill="${cell.color}">${escapeXml(fit.text)}</text>`);
			}
		}
		parts.push(`<text x="${cx}" y="${top + (labeled ? 45 : 40)}" text-anchor="middle" font-family="${FONT}" font-size="${quadValueFontSize(valueText, labeled)}" font-weight="700" fill="${labeled ? text.value : cell.color}">${escapeXml(valueText)}</text>`);
		if (cell.unitText !== "") {
			// 14 px matches the dual layout's unit step (single 16, dual 14,
			// quad 14): the empty band under the value has the room, and the
			// unit is what tells 1785 RPM from 1785 MHz at a glance.
			parts.push(`<text x="${cx}" y="${top + (labeled ? 61 : 58)}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="${text.unit}">${escapeXml(cell.unitText)}</text>`);
		}
	}
	parts.push(
		`<rect x="${QUAD_CROSS_H.x}" y="${QUAD_CROSS_H.y}" width="${QUAD_CROSS_H.w}" height="${QUAD_CROSS_H.h}" fill="${palette.track}"/>`,
		`<rect x="${QUAD_CROSS_V.x}" y="${QUAD_CROSS_V.y}" width="${QUAD_CROSS_V.w}" height="${QUAD_CROSS_V.h}" fill="${palette.track}"/>`
	);
	if (sharedBadge !== "") {
		parts.push(...sharedBadgeSvg(sharedBadge, palette, text.badge));
	}
	parts.push("</svg>");
	return parts.join("");
}

/** Every adaptive text ladder on the key faces, exported so the policy
 * (largest-first order, 12 px floor) is testable against the REAL arrays
 * instead of copies that drift. */
export const KEY_TEXT_LADDERS = {
	singleLabel: LABEL_SIZES,
	dualLabelTop: DUAL_LABEL_SIZES_TOP,
	dualLabel: DUAL_LABEL_SIZES,
	tripleValue: TRIPLE_VALUE_SIZES,
	tripleLabel: TRIPLE_LABEL_SIZES,
	quadMicroLabel: QUAD_LABEL_SIZES
} as const;

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
