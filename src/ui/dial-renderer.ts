/**
 * Renders the 200×100 Stream Deck + touchscreen slot as a raw SVG string
 * (sent through `setFeedback` into a full-canvas pixmap layout item — layout
 * text items cannot mix font sizes on one line, which the spec's inline unit
 * requires).
 *
 * Spec geometry: title 18/600 x12 y24 · value 34/700 x12 y58 (24/700 from
 * 10 glyphs, 17/700 from 14, so prose faces never run off the slot) with
 * inline unit 17/600 · stats 12/600 x12 y78 · bar x12 y84 176×6 r3.
 */
import { HISTORY_LENGTH } from "../series";
import { estimateFooterWidth, fitFooter, truncateLabel, wrapLabelTwoLines } from "./format";
import { escapeXml, FONT, sparklinePoints, sparklineSvg, svgOpen } from "./key-renderer";
import type { Palette } from "./themes";

const BAR = { x: 12, y: 84, w: 176, h: 6, r: 3 } as const;
/** 18 px/600 runs ~10 px per glyph; 17 chars keeps clear of the right edge. */
const TITLE_MAX = 17;
/** The smallest value tier fits ~19 glyphs; longer text ellipsizes. */
const VALUE_MAX = 19;

/**
 * 34 px/700 runs ~19 px per glyph: right for numeric values ("56.3"), far
 * too wide for the prose the status faces and the no-selection face put in
 * the value slot ("not detected", "rotate to pick", "un-elevate HWiNFO").
 * Two smaller tiers keep every such line inside the 200 px slot instead of
 * clipping at the edge (seen on the + XL strip with HWiNFO stopped).
 */
function valueFontSize(text: string): 34 | 24 | 17 {
	if (text.length <= 9) {
		return 34;
	}
	return text.length <= 13 ? 24 : 17;
}

/**
 * The wide three-row tile (V3): shared fixed columns and one CONTEXT LINE
 * carrying the deduped shared name plus the session stats. The stats always
 * render in full, right-anchored; the name is the only element that yields
 * (fill-to-width, one ellipsis). The active reading is a 4 px rail thumb on
 * the left groove, which doubles as the window's position in the full list.
 * The context line sits at the top (default) or the bottom, under the rows
 * and above a thin rule.
 */
const WIDE = { labelX: 12, valueRight: 168, unitLeft: 172, lineLeft: 2, lineRight: 196, lineGap: 6 } as const;
/** Value size ladder: largest step where the widest visible value fits the
 * shared column (right edge fixed at x=168, ~110 px of room). */
const WIDE_LADDER = [20, 18, 16, 14, 13, 12] as const;
const WIDE_VALUE_ROOM = 110;
/** Flat 700-weight width estimate, 0.6 px per glyph per font px (the same
 * factor the previous per-tier table encoded: 9.6/16 = 7.8/13 = 7.2/12).
 * The engine cannot be asked to measure; the end anchor makes alignment
 * exact regardless, and estimate error only moves the label budget. */
const WIDE_VALUE_CHAR = 0.6;
/** Header position resolves the vertical layout. Bottom mode trades band
 * height for the rule separating rows from the context line. */
const WIDE_GEO = {
	top: { lineBaseline: 11, rule: null, rowsTop: 16, rowsBottom: 100, bandH: 26 },
	bottom: { lineBaseline: 95, rule: 81, rowsTop: 2, rowsBottom: 80, bandH: 24 }
} as const;
const ROW_VALUE_MAX = 12;
/** Units live in a fixed 28 px slot (x=172 to the edge); 4 code points is
 * the widest that stays inside it ("Mbps" fits, "Mbit/s" ellipsizes). */
const WIDE_UNIT_MAX = 4;
/** Footer pixel budget for the TWO-ROW face (x=6 to ~x=194 at y=96), fitted
 * by estimated glyph widths (fitFooter). Exported so the dial action sizes
 * its roomy/tight footer choice against the same budget. */
export const FOOTER_PX = 188;

/**
 * Ladder fit: the largest step where every visible value stays inside the
 * shared column. Character counts quantize up to even so the most common
 * length flicker (99.9 to 100) cannot re-truncate labels every tick.
 * Returns the chosen size and the estimated width the column books.
 */
export function wideValueFit(values: readonly string[]): { size: number; maxW: number } {
	const quantized = values.map((v) => Math.ceil(Array.from(v).length / 2) * 2);
	const widest = Math.max(0, ...quantized);
	for (const size of WIDE_LADDER) {
		if (widest * WIDE_VALUE_CHAR * size <= WIDE_VALUE_ROOM) {
			return { size, maxW: widest * WIDE_VALUE_CHAR * size };
		}
	}
	const floor = WIDE_LADDER[WIDE_LADDER.length - 1] as number;
	return { size: floor, maxW: widest * WIDE_VALUE_CHAR * floor };
}

export interface OverviewRow {
	label: string;
	valueText: string;
	unitText: string;
	/** The reading on the dial right now; drawn as the rail thumb. */
	selected: boolean;
	/** Fully resolved value color (alert tint already applied by the caller,
	 * mirroring how the single view passes barColor). Alerts recolor the
	 * value TEXT only; nothing else on the face tints. */
	valueColor: string;
}

export interface DialOverviewOptions {
	/** Up to three visible rows, in rotation order. */
	rows: readonly OverviewRow[];
	/** The context line's left region: deduped shared name, state tags, or
	 * a transient overlay. Yields to the stats; empty to omit. */
	contextText: string;
	/** Session stats ("▼min ▲max"), right-anchored and ALWAYS in full; the
	 * caller owns the format. Empty omits it and the context text reclaims
	 * the width. */
	statsText: string;
	/** Context line position; default "top". */
	header?: "top" | "bottom";
	/** Thin track separators between rows (and the bottom-mode rule);
	 * default on. */
	separators?: boolean;
	palette: Palette;
}

/** The context line: the name yields into the remainder at 13 px, dropping
 * to 12 px, then fill-to-width ellipsis; the stats never yield. The canvas
 * still outranks the contract: a physically impossible stats width (fixed
 * decimals on 1e9-scale counters) pixel-fits to the whole line rather than
 * paint past the left edge, exactly like the single view's stats cap. The
 * stats draw LAST so a hot name estimate paints under the numbers, and the
 * name budget keeps 2 px of slack against them. */
function wideContextLine(baseline: number, contextText: string, statsText: string, palette: Palette): string {
	const stats = statsText === "" ? "" : fitFooter(statsText, WIDE.lineRight - WIDE.lineLeft);
	const rightX = stats === "" ? WIDE.lineRight : WIDE.lineRight - estimateFooterWidth(stats) - WIDE.lineGap;
	let out = "";
	if (contextText !== "") {
		const maxW = rightX - WIDE.lineLeft - 2;
		if (maxW > 8) {
			// estimateFooterWidth is 12/600-calibrated; scale for the 13 px try.
			const size = estimateFooterWidth(contextText) * (13 / 12) <= maxW ? 13 : 12;
			const text = size === 13 ? contextText : fitFooter(contextText, maxW);
			out += `<text x="${WIDE.lineLeft}" y="${baseline}" text-anchor="start" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${palette.label}">${escapeXml(text)}</text>`;
		}
	}
	if (stats !== "") {
		out += `<text x="${WIDE.lineRight}" y="${baseline}" text-anchor="end" font-family="${FONT}" font-size="12" font-weight="600" fill="${palette.unit}">${escapeXml(stats)}</text>`;
	}
	return out;
}

/**
 * The overview face, V3 wide tile: rail groove and thumb on the left, one
 * shared right-anchored value column (ladder-sized) with a fixed unit
 * column, UPPERCASE pixel-fitted labels, optional separators, and the
 * stats-priority context line. Same 200×100 pixmap contract as renderDial.
 */
export function renderDialOverview(opts: DialOverviewOptions): string {
	const { palette } = opts;
	const g = WIDE_GEO[opts.header === "bottom" ? "bottom" : "top"];
	const separators = opts.separators !== false;
	const rows = opts.rows.slice(0, 3).map((row) => {
		const valueText = truncateLabel(row.valueText, ROW_VALUE_MAX);
		return { ...row, valueText, unitText: row.unitText === "" ? "" : truncateLabel(row.unitText, WIDE_UNIT_MAX) };
	});
	const fit = wideValueFit(rows.map((row) => row.valueText));
	const labelRight = WIDE.valueRight - fit.maxW - 8;
	// Estimation slack: a flat 4 px plus ~6% for the 0.4 letter-spacing the
	// estimator does not model, so a hot estimate cannot reach the column.
	const labelBudget = Math.max(0, (labelRight - WIDE.labelX - 4) * 0.94);
	const pitch = (g.rowsBottom - g.rowsTop) / 3;
	const parts: string[] = [
		...svgOpen(200, 100, palette.bg),
		// The rail groove spans the rows region; the thumb rides in it.
		`<rect x="0" y="${g.rowsTop}" width="4" height="${g.rowsBottom - g.rowsTop}" fill="${palette.track}"/>`
	];
	if (separators) {
		for (let p = 1; p < rows.length; p++) {
			parts.push(`<rect x="4" y="${Math.round(g.rowsTop + p * pitch)}" width="196" height="1" fill="${palette.track}"/>`);
		}
		if (g.rule !== null) {
			parts.push(`<rect x="0" y="${g.rule}" width="200" height="1" fill="${palette.track}"/>`);
		}
	}
	rows.forEach((row, pos) => {
		const bandTop = Math.round(g.rowsTop + pos * pitch + (pitch - g.bandH) / 2);
		// Baseline computed (no dominant-baseline on this engine): optical
		// center of the band plus 0.34 em.
		const baseline = Math.round((bandTop + g.bandH / 2 + fit.size * 0.34) * 10) / 10;
		if (row.selected) {
			parts.push(`<rect x="0" y="${bandTop}" width="4" height="${g.bandH}" rx="2" fill="${palette.accent}"/>`);
		}
		const label = fitFooter(row.label.toUpperCase(), labelBudget);
		parts.push(
			`<text x="${WIDE.labelX}" y="${baseline}" text-anchor="start" font-family="${FONT}" font-size="12" font-weight="600" letter-spacing="0.4" fill="${row.selected ? palette.label : palette.unit}">${escapeXml(label)}</text>`,
			// Bg-colored insurance between label and value column: invisible
			// (rows sit on plain bg now), and renderer-proof where the width
			// estimate ran hot (clipPath is unproven on this engine).
			`<rect x="${labelRight.toFixed(1)}" y="${bandTop}" width="${(200 - labelRight).toFixed(1)}" height="${g.bandH}" fill="${palette.bg}"/>`,
			`<text x="${WIDE.valueRight}" y="${baseline}" text-anchor="end" font-family="${FONT}" font-size="${fit.size}" font-weight="700" fill="${row.valueColor}">${escapeXml(row.valueText)}</text>`
		);
		if (row.unitText !== "") {
			parts.push(`<text x="${WIDE.unitLeft}" y="${baseline}" text-anchor="start" font-family="${FONT}" font-size="12" font-weight="600" fill="${palette.unit}">${escapeXml(row.unitText)}</text>`);
		}
	});
	parts.push(wideContextLine(g.lineBaseline, opts.contextText, opts.statsText, palette));
	parts.push("</svg>");
	return parts.join("");
}

/** Two-row view: 40 px rows at y=4 and y=46, the footer in its usual slot.
 * Each row is a label line over a value line; the value line's left side
 * carries either the label's wrapped second line or a sparkline. Its table
 * columns are placed by the widest VISIBLE unit and value, estimated from
 * character counts (the engine cannot be asked to measure); the end anchor
 * makes digit alignment exact regardless of estimate error. */
const TWO_ROW = { tops: [4, 46], height: 40, labelBaseline: 13, valueBaseline: 36 } as const;
const RIGHT_EDGE = 192;
const VALUE_UNIT_GAP = 4;
/** Units are mostly caps (RPM, MHz, W): budget them at caps width. */
const EST_UNIT_CHAR = 8;
const EST_LABEL_CHAR = 6.5;
const ROW_LABEL_MIN = 8;
const ROW_UNIT_MAX = 5;
/** The label line spans the full slot: ~27 chars at 13 px/600. */
const TWO_ROW_LINE1_MAX = 27;
const TWO_ROW_SPARK = { y: 25, h: 12, minW: 40 } as const;
/** Big-value tiers for the two-row view; per-char width estimates below. */
const EST_TWO_ROW_VALUE: Record<26 | 20 | 16, number> = { 26: 15.6, 20: 12, 16: 9.6 };

/** Two-row value size: 26 px for the numeric norm, stepped for extremes. */
export function twoRowValueFontSize(text: string): 26 | 20 | 16 {
	const count = Array.from(text).length;
	if (count <= 6) {
		return 26;
	}
	return count <= 9 ? 20 : 16;
}

export interface TwoRowRow {
	label: string;
	valueText: string;
	unitText: string;
	selected: boolean;
	/** Fully resolved value color (alert tint applied by the caller). */
	valueColor: string;
	/** Recent native values; drawn as a sparkline when the label does not
	 * need its second line and 2+ points exist. */
	history?: readonly number[];
}

export interface DialTwoRowOptions {
	/** Up to two visible rows, in rotation order. */
	rows: readonly TwoRowRow[];
	/** Stats/overlay/state line under the rows; empty to omit. */
	footerText: string;
	palette: Palette;
}

/**
 * The two-row face: bigger values than the three-row overview (26 px vs
 * 16 px), a full-width label line per row, and the value line's left side
 * put to work: a long label wraps onto it, a short label frees it for a
 * sparkline of that reading's recent values (the key strip's own idiom:
 * track under-fill, accent line, end dot). Values and units share the same
 * table columns as the three-row view, footer semantics included.
 */
export function renderDialTwoRow(opts: DialTwoRowOptions): string {
	const { palette } = opts;
	const rows = opts.rows.slice(0, 2).map((row) => {
		const valueText = truncateLabel(row.valueText, ROW_VALUE_MAX);
		return {
			...row,
			valueText,
			unitText: row.unitText === "" ? "" : truncateLabel(row.unitText, ROW_UNIT_MAX),
			size: twoRowValueFontSize(valueText)
		};
	});
	// Shared table columns, like the three-row view: widest unit, then the
	// widest value, place the anchors every row uses.
	const maxUnitW = Math.max(0, ...rows.map((row) => (row.unitText === "" ? 0 : Array.from(row.unitText).length * EST_UNIT_CHAR)));
	const unitX = RIGHT_EDGE - maxUnitW;
	const valueEndX = maxUnitW === 0 ? RIGHT_EDGE : unitX - VALUE_UNIT_GAP;
	const maxValueW = Math.max(0, ...rows.map((row) => Math.ceil(Array.from(row.valueText).length / 2) * 2 * EST_TWO_ROW_VALUE[row.size]));
	const valueStartEst = valueEndX - maxValueW;
	const line2Max = Math.max(ROW_LABEL_MIN, Math.floor((valueStartEst - 20) / EST_LABEL_CHAR));
	const parts: string[] = svgOpen(200, 100, palette.bg);
	rows.forEach((row, i) => {
		const top = TWO_ROW.tops[i] as number;
		const rowBg = row.selected ? palette.track : palette.bg;
		if (row.selected) {
			parts.push(
				`<rect x="0" y="${top}" width="200" height="${TWO_ROW.height}" fill="${palette.track}"/>`,
				`<rect x="2" y="${top + 4}" width="4" height="32" rx="2" fill="${palette.accent}"/>`
			);
		}
		const lines = wrapLabelTwoLines(row.label, TWO_ROW_LINE1_MAX, line2Max);
		parts.push(
			`<text x="12" y="${top + TWO_ROW.labelBaseline}" text-anchor="start" font-family="${FONT}" font-size="13" font-weight="600" fill="${row.selected ? palette.label : palette.unit}">${escapeXml(lines[0] as string)}</text>`
		);
		if (lines.length > 1) {
			parts.push(
				`<text x="12" y="${top + TWO_ROW.valueBaseline}" text-anchor="start" font-family="${FONT}" font-size="13" font-weight="600" fill="${row.selected ? palette.label : palette.unit}">${escapeXml(lines[1] as string)}</text>`
			);
		} else if (row.history !== undefined) {
			// The freed line hosts the trend: self-normalized over its own
			// samples, drawn only when it has real width and 2+ points.
			const sparkW = valueStartEst - 12 - 12;
			const samples = row.history.slice(-HISTORY_LENGTH);
			const points = sparkW >= TWO_ROW_SPARK.minW ? sparklinePoints(samples, 12, top + TWO_ROW_SPARK.y, sparkW, TWO_ROW_SPARK.h) : [];
			if (points.length > 0) {
				parts.push(...sparklineSvg(points, top + TWO_ROW_SPARK.y + TWO_ROW_SPARK.h, 3, 3.5, palette));
			}
		}
		parts.push(
			// The mask covers only the value line's band, so a wrapped label
			// or sparkline that ran long is clipped renderer-proof, while the
			// full-width label line above stays untouched.
			`<rect x="${(valueStartEst - 4).toFixed(1)}" y="${top + 18}" width="${(204 - valueStartEst).toFixed(1)}" height="${TWO_ROW.height - 18}" fill="${rowBg}"/>`,
			`<text x="${valueEndX.toFixed(1)}" y="${top + TWO_ROW.valueBaseline}" text-anchor="end" font-family="${FONT}" font-size="${row.size}" font-weight="700" fill="${row.valueColor}">${escapeXml(row.valueText)}</text>`
		);
		if (row.unitText !== "") {
			parts.push(`<text x="${unitX.toFixed(1)}" y="${top + TWO_ROW.valueBaseline}" text-anchor="start" font-family="${FONT}" font-size="13" font-weight="600" fill="${palette.unit}">${escapeXml(row.unitText)}</text>`);
		}
	});
	if (opts.footerText !== "") {
		parts.push(`<text x="6" y="96" text-anchor="start" font-family="${FONT}" font-size="12" font-weight="600" fill="${palette.unit}">${escapeXml(fitFooter(opts.footerText, FOOTER_PX))}</text>`);
	}
	parts.push("</svg>");
	return parts.join("");
}

export interface DialRenderOptions {
	title: string;
	valueText: string;
	/** Rendered inline after the value; empty to omit. */
	unitText: string;
	/** Single stats line under the value; empty to omit. */
	statsText: string;
	/** Bar fill fraction 0–1; NaN hides the fill. */
	fraction: number;
	/** Theme tokens — dials stay themed even while alerting. */
	palette: Palette;
	/** Bar fill: accent (or type accent) normally, the alert bg when alerting. */
	barColor: string;
}

export function renderDial(opts: DialRenderOptions): string {
	const { palette, barColor } = opts;
	const parts: string[] = [
		...svgOpen(200, 100, palette.bg),
		`<text x="12" y="24" text-anchor="start" font-family="${FONT}" font-size="18" font-weight="600" fill="${palette.label}">${escapeXml(truncateLabel(opts.title, TITLE_MAX))}</text>`
	];
	const unit = opts.unitText !== "" ? `<tspan dx="6" font-size="17" font-weight="600" fill="${palette.unit}">${escapeXml(opts.unitText)}</tspan>` : "";
	const valueText = truncateLabel(opts.valueText, VALUE_MAX);
	parts.push(`<text x="12" y="58" text-anchor="start" font-family="${FONT}" font-size="${valueFontSize(valueText)}" font-weight="700" fill="${palette.value}">${escapeXml(valueText)}${unit}</text>`);
	if (opts.statsText !== "") {
		parts.push(`<text x="12" y="78" text-anchor="start" font-family="${FONT}" font-size="12" font-weight="600" fill="${palette.unit}">${escapeXml(opts.statsText)}</text>`);
	}
	parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="${BAR.r}" fill="${palette.track}"/>`);
	if (Number.isFinite(opts.fraction) && opts.fraction > 0) {
		const w = Math.max(BAR.h, Math.min(1, opts.fraction) * BAR.w);
		parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${w.toFixed(1)}" height="${BAR.h}" rx="${BAR.r}" fill="${barColor}"/>`);
	}
	parts.push("</svg>");
	return parts.join("");
}
