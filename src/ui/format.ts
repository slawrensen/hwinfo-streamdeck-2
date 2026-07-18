/** Value formatting, unit conversion and stat-mode selection. */
import type { Reading } from "../hwinfo/types";

export type StatMode = "current" | "min" | "max" | "avg";
export type DecimalsSetting = "auto" | "0" | "1" | "2" | "3";

export const STAT_MODES: readonly StatMode[] = ["current", "min", "max", "avg"];

/** Short badge shown when a non-current stat is displayed. */
export const STAT_BADGE: Record<StatMode, string> = {
	current: "",
	min: "MIN",
	max: "MAX",
	avg: "AVG"
};

export function isStatMode(value: unknown): value is StatMode {
	return typeof value === "string" && (STAT_MODES as readonly string[]).includes(value);
}

export function statValue(reading: Reading, mode: StatMode): number {
	switch (mode) {
		case "min":
			return reading.valueMin;
		case "max":
			return reading.valueMax;
		case "avg":
			return reading.valueAvg;
		default:
			return reading.value;
	}
}

/** Converts a value for display; only °C→°F is meaningful in HWiNFO data. */
export function convertUnit(value: number, unit: string, fahrenheit: boolean): { value: number; unit: string } {
	if (fahrenheit && unit === "°C") {
		return { value: value * 1.8 + 32, unit: "°F" };
	}
	return { value, unit };
}

/** The generic magnitude ladder auto-compaction climbs (thousand steps). */
const MAGNITUDES = [
	{ suffix: "k", scale: 1_000 },
	{ suffix: "M", scale: 1_000_000 },
	{ suffix: "G", scale: 1_000_000_000 },
	{ suffix: "T", scale: 1_000_000_000_000 }
] as const;

/**
 * Precision by magnitude band: whole numbers from 100, one decimal from 10,
 * two below. The key's established rhythm, reused at every compacted tier.
 */
export function bandPrecision(abs: number): 0 | 1 | 2 {
	return abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
}

/** toFixed with the sign dropped from a zero result: "-0.00" reads as a
 * negative reading that isn't there. */
export function fixed(value: number, digits: number): string {
	const text = value.toFixed(digits);
	return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/**
 * Formats a value for a 72 px key. "auto" scales precision with magnitude and
 * compacts large values through k/M/G/T (48700 → "48.7k", 48700000 → "48.7M")
 * so they never overflow the key. Rounding rolls over cleanly: a value that
 * would round to "1000k" is promoted to "1.00M" instead.
 */
export function formatValue(value: number, decimals: DecimalsSetting): string {
	if (!Number.isFinite(value)) {
		return "—";
	}
	if (decimals !== "auto") {
		return fixed(value, Number(decimals));
	}
	const abs = Math.abs(value);
	if (abs < 10_000) {
		return fixed(value, bandPrecision(abs));
	}
	let tier = 0;
	while (tier < MAGNITUDES.length - 1 && abs / (MAGNITUDES[tier] as (typeof MAGNITUDES)[number]).scale >= 1000) {
		tier++;
	}
	for (;;) {
		const { suffix, scale } = MAGNITUDES[tier] as (typeof MAGNITUDES)[number];
		const scaled = value / scale;
		const text = fixed(scaled, bandPrecision(Math.abs(scaled)));
		const rounded = Math.abs(Number(text));
		if (rounded >= 1000 && tier < MAGNITUDES.length - 1) {
			tier++;
			continue;
		}
		// Rounding can cross a precision band (9.99 → "10.0"): settle on the
		// band the rounded value actually lands in.
		return `${fixed(scaled, bandPrecision(rounded))}${suffix}`;
	}
}

/**
 * Formats a value for one 72 px quad-grid cell: at most 4 glyphs, ever. The
 * shared decimals setting is the starting precision ("auto" starts from
 * formatValue's magnitude rule); decimals drop first, then the magnitude
 * compacts through k/M/G/T, so 48700 reads "49k" instead of overflowing the
 * cell. The sign counts as a glyph.
 */
export function formatQuadValue(value: number, decimals: DecimalsSetting): string {
	if (!Number.isFinite(value)) {
		return "—";
	}
	const startPrecision = (abs: number): number => {
		if (decimals !== "auto") {
			return Number(decimals);
		}
		return bandPrecision(abs);
	};
	const tiers = [
		{ suffix: "", scale: 1 },
		{ suffix: "k", scale: 1_000 },
		{ suffix: "M", scale: 1_000_000 },
		{ suffix: "G", scale: 1_000_000_000 },
		{ suffix: "T", scale: 1_000_000_000_000 }
	];
	for (const { suffix, scale } of tiers) {
		const scaled = value / scale;
		for (let d = startPrecision(Math.abs(scaled)); d >= 0; d--) {
			const text = `${fixed(scaled, d)}${suffix}`;
			if (Array.from(text).length <= 4) {
				return text;
			}
		}
	}
	// Past ±9999T, which no HWiNFO reading approaches: clamp, never overflow.
	return `${Math.round(value / 1_000_000_000_000)}T`;
}

/** Parses a threshold field coming from the PI (string or number, may be empty). */
export function parseThreshold(raw: unknown): number | undefined {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === "string" && raw.trim() !== "") {
		// The PI accepts locale decimal commas ("70,5") — Number() does not.
		const n = Number(raw.trim().replace(",", "."));
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/**
 * Whether thresholds and manual bar ranges configured against `alertUnit`
 * apply to a reading measured in `readingUnit`. A warn value typed for a
 * temperature must never fire on a fan's RPM after rotating to it: numbers
 * only compare within one unit.
 *
 * `undefined` means unscoped: settings that predate unit scoping keep the
 * old apply-everywhere behavior until the user next edits a threshold
 * (which anchors it to the reading on screen). An empty string is a REAL
 * unit (HWiNFO's unitless yes/no readings) and scopes to unitless readings
 * only; conflating it with unscoped would both widen alerts and defeat the
 * stamped-check.
 */
export function thresholdsApplyTo(alertUnit: string | undefined, readingUnit: string): boolean {
	return alertUnit === undefined || alertUnit === readingUnit;
}

export type AlertLevel = "normal" | "warn" | "crit";

/**
 * Evaluates warn/critical thresholds against the *live* (current) value in the
 * displayed unit. With `alertBelow`, lower is worse (e.g. fan RPM); otherwise
 * higher is worse (temperatures, power).
 */
export function alertLevel(current: number, warn: number | undefined, crit: number | undefined, alertBelow: boolean): AlertLevel {
	const beyond = (limit: number): boolean => (alertBelow ? current <= limit : current >= limit);
	if (crit !== undefined && beyond(crit)) {
		return "crit";
	}
	if (warn !== undefined && beyond(warn)) {
		return "warn";
	}
	return "normal";
}

/**
 * Truncates a label to fit a key, appending an ellipsis when cut. Operates on
 * code points, not UTF-16 units — slicing through a surrogate pair would leave
 * a lone surrogate that makes encodeURIComponent throw on the rendered SVG.
 */
export function truncateLabel(label: string, max: number): string {
	const chars = Array.from(label);
	return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * Estimated pixel width of a string at the dial footer's 12 px/600, by
 * glyph class (the Stream Deck engine cannot be asked to measure). Narrow
 * lowercase, digits, caps, spaces and the footer's marker glyphs each carry
 * their own budget, so a footer full of narrow letters fits more characters
 * than one full of caps, instead of both being cut at a flat count.
 */
export function estimateFooterWidth(text: string): number {
	let width = 0;
	for (const ch of text) {
		if (ch === "▼" || ch === "▲") {
			width += 12;
		} else if (ch === " ") {
			width += 3.4;
		} else if (ch === "·") {
			width += 5;
		} else if (ch === "…") {
			width += 10;
		} else if (ch === "i" || ch === "j" || ch === "l" || ch === "." || ch === ",") {
			width += 3.2;
		} else if (ch >= "0" && ch <= "9") {
			width += 6.3;
		} else if (ch >= "A" && ch <= "Z") {
			width += 7.6;
		} else if (ch >= "a" && ch <= "z") {
			width += 6.1;
		} else {
			width += 7;
		}
	}
	return width;
}

/**
 * East Asian wide and fullwidth code points advance a full em (Segoe UI
 * falls back to the system CJK fonts): CJK ideographs (base and extensions),
 * kana, hangul, CJK punctuation/compatibility, fullwidth forms, and the
 * supplementary ideographic planes. Estimating them at the 7 px default
 * would undercount by ~40% and overflow the face.
 */
function isWideGlyph(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0x303e) ||
		(code >= 0x3041 && code <= 0x33ff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xa000 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		// Emoji and symbol planes plus the supplementary ideographs: all
		// full-width-or-wider in every fallback font.
		code >= 0x1f000
	);
}

/**
 * Estimated pixel width of one glyph at 12 px, by class. The key layouts'
 * generalization of the footer table above: same calibration and classes,
 * plus a wide class for M/W (and their lowercase) and a full-em class for
 * East Asian wide glyphs, so a four-cap quad micro-label, an all-caps key
 * label or a CJK sensor name can't slip past its budget on the
 * average-width assumption. The footer keeps its own table untouched — dial
 * fitting is locked output and must not shift under a key-side refinement.
 * Unknown glyphs take the widest common budget: overestimating keeps text
 * inside the face, underestimating overflows it.
 */
function keyGlyphWidth12(ch: string): number {
	if (ch === " ") {
		return 3.4;
	}
	if (isWideGlyph(ch.codePointAt(0) as number)) {
		return 12;
	}
	if (ch === "i" || ch === "j" || ch === "l" || ch === "." || ch === "," || ch === "'" || ch === ":" || ch === ";" || ch === "!" || ch === "|") {
		return 3.2;
	}
	// Parens and the slash are narrow in Segoe UI (~4.7 px at 12): HWiNFO's
	// own names use them constantly ("CPU (Tctl/Tdie)"), and pricing them at
	// the 7 px default costs those names a whole ladder step.
	if (ch === "(" || ch === ")" || ch === "/") {
		return 4.7;
	}
	if (ch >= "0" && ch <= "9") {
		return 6.3;
	}
	if (ch === "M" || ch === "W" || ch === "%") {
		return 10.4;
	}
	if (ch === "m" || ch === "w") {
		return 9.6;
	}
	if (ch >= "A" && ch <= "Z") {
		return 7.6;
	}
	if (ch >= "a" && ch <= "z") {
		return 6.1;
	}
	// Also the label ellipsis' real advance (the footer budgets its own 10;
	// overpricing the ellipsis retreats a floor fit one character too far).
	return 7;
}

/** Bold strokes (weight 700) run a touch wider than the 600 the table is
 * calibrated for; a flat few percent keeps the estimate on the safe side. */
const BOLD_WIDTH_FACTOR = 1.04;

export type TextFitOptions = {
	/** Glyph weight the caller will render; the table assumes 600. */
	fontWeight?: 600 | 700;
	/** SVG letter-spacing in px, applied per inter-glyph gap at every size. */
	letterSpacing?: number;
	/** Extra px the fit must leave unused, on top of the caller's budget. */
	minimumSlack?: number;
};

/**
 * Estimated pixel width of a string as a key face renders it: the glyph-class
 * table above scaled linearly from its 12 px calibration, a flat widening for
 * weight 700, and the caller's letter-spacing per gap. Estimation only (the
 * Stream Deck engine cannot be asked to measure), so callers budget slack.
 */
export function estimateKeyTextWidth(text: string, fontSize: number, options?: TextFitOptions): number {
	let width = 0;
	let count = 0;
	for (const ch of text) {
		width += keyGlyphWidth12(ch);
		count++;
	}
	width = (width * fontSize) / 12;
	if (options?.fontWeight === 700) {
		width *= BOLD_WIDTH_FACTOR;
	}
	return width + Math.max(0, count - 1) * (options?.letterSpacing ?? 0);
}

/** One fitted string: what to draw, at what size. */
export type FittedText = {
	text: string;
	fontSize: number;
};

/**
 * Fits text into a pixel budget down a font-size ladder: the largest size
 * whose whole-string estimate fits wins; when even the smallest size cannot
 * hold the whole string, the widest fitting prefix plus an ellipsis renders
 * at that floor size. Code-point based (never splits a surrogate pair) and
 * deterministic: same text, budget and ladder always fit identically.
 */
export function fitTextLadder(text: string, maxWidth: number, sizes: readonly number[], options?: TextFitOptions): FittedText {
	if (text === "") {
		return { text: "", fontSize: sizes[0] as number };
	}
	const budget = maxWidth - (options?.minimumSlack ?? 0);
	const floor = sizes[sizes.length - 1] as number;
	for (const size of sizes) {
		if (estimateKeyTextWidth(text, size, options) <= budget) {
			return { text, fontSize: size };
		}
	}
	const chars = Array.from(text);
	for (let i = chars.length - 1; i > 0; i--) {
		const candidate = `${chars.slice(0, i).join("").trimEnd()}…`;
		if (estimateKeyTextWidth(candidate, floor, options) <= budget) {
			return { text: candidate, fontSize: floor };
		}
	}
	return { text: "…", fontSize: floor };
}

/**
 * Fits text to a pixel budget at the footer's metrics: kept whole when the
 * estimate fits, else trimmed from the end with an ellipsis at the widest
 * fitting prefix. Estimation-based, so the budget should leave the caller's
 * layout a few pixels of slack.
 */
export function fitFooter(text: string, maxPx: number): string {
	if (estimateFooterWidth(text) <= maxPx) {
		return text;
	}
	const chars = Array.from(text);
	let width = 10; // the ellipsis
	let kept = 0;
	for (const ch of chars) {
		const next = width + estimateFooterWidth(ch);
		if (next > maxPx) {
			break;
		}
		width = next;
		kept++;
	}
	return `${chars.slice(0, kept).join("").trimEnd()}…`;
}

/**
 * Greedy two-line word wrap for the dial's two-row view. Fills the first
 * line with whole words up to `line1Max` code points, puts the rest on the
 * second line (ellipsized past `line2Max`). A first word too long for line
 * one is truncated there and nothing wraps (labels are names, not prose).
 */
export function wrapLabelTwoLines(label: string, line1Max: number, line2Max: number): string[] {
	const text = label.trim();
	if (Array.from(text).length <= line1Max) {
		return [text];
	}
	const words = text.split(" ").filter((w) => w !== "");
	let line1 = "";
	let index = 0;
	while (index < words.length) {
		const candidate = line1 === "" ? (words[index] as string) : `${line1} ${words[index] as string}`;
		if (Array.from(candidate).length > line1Max) {
			break;
		}
		line1 = candidate;
		index++;
	}
	if (line1 === "") {
		// One unbreakable word: keep it to a single truncated line.
		return [truncateLabel(text, line1Max)];
	}
	const rest = words.slice(index).join(" ");
	return rest === "" ? [line1] : [line1, truncateLabel(rest, line2Max)];
}

/**
 * Drops the leading whole words every unlocked label shares, so rows like
 * "GPU Temperature / GPU Hot Spot / GPU Thermal Limit" read as
 * "Temperature / Hot Spot / Thermal Limit" where truncation would otherwise
 * eat exactly the distinguishing tail. The removed words come back as
 * `prefix` so the face can keep the context in one place (the footer)
 * instead of three. Locked labels (user-typed names) are neither considered
 * nor changed. The prefix is whole space-separated words only and needs two
 * or more unlocked labels to exist. A label the strip would empty (one that
 * IS the shared prefix, or a set of identical labels) keeps its original
 * text instead of disabling the strip for everyone; `prefix` is empty when
 * no label actually changed.
 */
export function dedupeSharedLabelPrefix(labels: readonly string[], locked: readonly boolean[]): { labels: string[]; prefix: string } {
	const open = labels.filter((_, i) => locked[i] !== true);
	if (open.length < 2) {
		return { labels: [...labels], prefix: "" };
	}
	const split = open.map((label) => label.split(" "));
	const first = split[0] as string[];
	let shared = 0;
	while (shared < first.length && split.every((words) => words.length === shared || words[shared] === first[shared])) {
		shared++;
	}
	if (shared === 0) {
		return { labels: [...labels], prefix: "" };
	}
	let stripped = false;
	const result = labels.map((label, i) => {
		if (locked[i] === true) {
			return label;
		}
		const rest = label.split(" ").slice(shared).join(" ");
		if (rest === "") {
			return label;
		}
		stripped = true;
		return rest;
	});
	return { labels: result, prefix: stripped ? first.slice(0, shared).join(" ") : "" };
}
