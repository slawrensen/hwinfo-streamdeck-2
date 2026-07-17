/**
 * The one measurement-formatting authority: native HWiNFO value/unit in,
 * display text out. Every face (key layouts, dial views, footers) and the
 * property-inspector preview/tree format through here, so the runtime and the
 * PI can never disagree about what "12000000 B/s" reads as.
 *
 * Data units (bytes and transfer rates) are re-tiered under the deck-wide
 * preference: Decimal shows byte quantities in B/KB/MB/GB/TB (base 1000) and
 * rates as bits (bps/kbps/Mbps/Gbps/Tbps, byte rates × 8); Binary shows
 * quantities in B/KiB/MiB/GiB/TiB (base 1024) and rates as bytes
 * (B/s…TiB/s, bit rates ÷ 8). The incoming value is normalized to a
 * canonical base before the display tier is chosen, so an already-prefixed
 * source ("12500 MB") is never double-scaled. Everything else keeps the
 * generic formatValue behavior unchanged.
 *
 * Scaling here is presentation only: thresholds, bar ranges and alert math
 * stay in the native/display-temperature domain of the raw reading.
 */
import { bandPrecision, convertUnit, fixed, formatQuadValue, formatValue, type DecimalsSetting } from "./format";

/** Deck-wide data-unit preference; absent/junk resolves to "decimal", which
 * re-tiers without reinterpreting the source's own 1000-based labels. */
export type DataUnitsPref = "decimal" | "binary";

export function parseDataUnitsPref(raw: unknown): DataUnitsPref {
	return raw === "binary" ? "binary" : "decimal";
}

type DataKind = "bytes" | "byteRate" | "bitRate";

/** A recognized data unit: what it measures, and the factor to the canonical
 * base (bytes, bytes/s, or bits/s). */
export type DataUnit = { kind: DataKind; toBase: number };

const PREFIX_SCALE: Readonly<Record<string, number>> = {
	"": 1,
	K: 1e3,
	k: 1e3,
	M: 1e6,
	G: 1e9,
	T: 1e12,
	Ki: 1024,
	ki: 1024,
	Mi: 1024 ** 2,
	Gi: 1024 ** 3,
	Ti: 1024 ** 4
};

/** Case is semantic: "B" is bytes, "b"/"bit" is bits; "Ki/Mi/Gi/Ti" are the
 * 1024-based prefixes. Covers HWiNFO's forms: KB, MB/s, KiB/s, Mbps, kbit/s. */
const DATA_UNIT = /^([KkMGT]i?)?(B|b|bits?)(\/s|ps)?$/;

/**
 * Parses a data unit into its kind and canonical-base factor. Plain bit
 * quantities ("Mb" with no rate marker) are ambiguous relabeling targets and
 * ordinary units (W, RPM, MHz, °C, %) don't match at all — both return null
 * and keep their current formatting.
 */
export function parseDataUnit(unit: string): DataUnit | null {
	const match = DATA_UNIT.exec(unit.trim());
	if (match === null) {
		return null;
	}
	const scale = PREFIX_SCALE[match[1] ?? ""];
	if (scale === undefined) {
		return null;
	}
	const bytes = match[2] === "B";
	const rate = match[3] !== undefined;
	if (bytes) {
		return { kind: rate ? "byteRate" : "bytes", toBase: scale };
	}
	return rate ? { kind: "bitRate", toBase: scale } : null;
}

const DECIMAL_BYTES = ["B", "KB", "MB", "GB", "TB"] as const;
const BINARY_BYTES = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
const DECIMAL_BIT_RATES = ["bps", "kbps", "Mbps", "Gbps", "Tbps"] as const;
const BINARY_BYTE_RATES = ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"] as const;

/** The canonical value and display ladder one kind+preference resolves to. */
function dataDisplay(baseValue: number, kind: DataKind, pref: DataUnitsPref): { canonical: number; ladder: readonly string[]; base: number } {
	if (kind === "bytes") {
		return pref === "binary" ? { canonical: baseValue, ladder: BINARY_BYTES, base: 1024 } : { canonical: baseValue, ladder: DECIMAL_BYTES, base: 1000 };
	}
	if (pref === "binary") {
		return { canonical: kind === "bitRate" ? baseValue / 8 : baseValue, ladder: BINARY_BYTE_RATES, base: 1024 };
	}
	return { canonical: kind === "byteRate" ? baseValue * 8 : baseValue, ladder: DECIMAL_BIT_RATES, base: 1000 };
}

/** One scaled number in the established rhythm: band precision for "auto"
 * (settled on the band the ROUNDED value lands in), fixed otherwise. */
function formatScaled(scaled: number, decimals: DecimalsSetting): string {
	if (decimals !== "auto") {
		return fixed(scaled, Number(decimals));
	}
	const text = fixed(scaled, bandPrecision(Math.abs(scaled)));
	return fixed(scaled, bandPrecision(Math.abs(Number(text))));
}

function measureData(canonical: number, ladder: readonly string[], base: number, decimals: DecimalsSetting, quad: boolean): Measurement {
	const abs = Math.abs(canonical);
	let tier = 0;
	while (tier < ladder.length - 1 && abs >= base ** (tier + 1)) {
		tier++;
	}
	for (;;) {
		const scaled = canonical / base ** tier;
		const valueText = quad ? formatQuadValue(scaled, decimals) : formatScaled(scaled, decimals);
		// Rounding can hit the next tier ("1024 KiB"), and a quad cell squeezes
		// a 5-glyph value ("-1010") into its own magnitude suffix ("-1k", NaN
		// here): both promote a tier instead, so a value suffix never stacks on
		// a unit prefix. Past the top tier the quad clamp keeps the budget.
		const rounded = Math.abs(Number(valueText));
		if (tier < ladder.length - 1 && !(rounded < base)) {
			tier++;
			continue;
		}
		return { valueText, unitText: ladder[tier] as string };
	}
}

export type Measurement = { valueText: string; unitText: string };

export type MeasureOptions = {
	decimals: DecimalsSetting;
	fahrenheit: boolean;
	dataUnits: DataUnitsPref;
};

/**
 * Formats one reading for display: °C→°F conversion, then either data-unit
 * re-tiering (under the deck preference) or the generic magnitude ladder.
 * Non-finite values keep the placeholder glyph and the source unit.
 */
export function formatMeasurement(value: number, unit: string, opts: MeasureOptions): Measurement {
	const converted = convertUnit(value, unit, opts.fahrenheit);
	const data = parseDataUnit(converted.unit);
	if (data === null || !Number.isFinite(converted.value)) {
		return { valueText: formatValue(converted.value, opts.decimals), unitText: converted.unit };
	}
	const { canonical, ladder, base } = dataDisplay(converted.value * data.toBase, data.kind, opts.dataUnits);
	return measureData(canonical, ladder, base, opts.decimals, false);
}

/** The quad-cell variant: same tiering, value capped at the quad glyph
 * budget. A value that only fits with its own magnitude suffix (a negative
 * near a binary tier edge, "-1010") promotes a tier instead. */
export function formatQuadMeasurement(value: number, unit: string, opts: MeasureOptions): Measurement {
	const converted = convertUnit(value, unit, opts.fahrenheit);
	const data = parseDataUnit(converted.unit);
	if (data === null || !Number.isFinite(converted.value)) {
		return { valueText: formatQuadValue(converted.value, opts.decimals), unitText: converted.unit };
	}
	const { canonical, ladder, base } = dataDisplay(converted.value * data.toBase, data.kind, opts.dataUnits);
	return measureData(canonical, ladder, base, opts.decimals, true);
}

/** Whether a reading's unit re-tiers under the data-unit preference (the
 * footers switch to their tight layout for the longer unit-suffixed stats). */
export function isDataUnit(unit: string): boolean {
	return parseDataUnit(unit) !== null;
}

/**
 * One stat (session/HWiNFO min, max, avg) for a footer or stats line. Plain
 * readings keep the bare number exactly as before (the face's unit applies
 * 1:1); data units carry their own tier suffix ("8.19GB") because each stat
 * picks its own tier and a bare number would read in the wrong unit.
 */
export function formatStat(value: number, unit: string, opts: MeasureOptions): string {
	if (!isDataUnit(unit)) {
		return formatValue(convertUnit(value, unit, opts.fahrenheit).value, opts.decimals);
	}
	const m = formatMeasurement(value, unit, opts);
	return `${m.valueText}${m.unitText}`;
}
