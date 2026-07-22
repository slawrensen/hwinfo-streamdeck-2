/**
 * The measurement authority: generic k/M/G/T compaction, data-unit parsing,
 * decimal/binary re-tiering, rate conversion, stat text, quad glyph budget.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateKeyTextWidth, fitTextLadder, formatQuadValue, formatValue } from "../src/ui/format";
import { formatMeasurement, formatQuadMeasurement, formatStat, isDataUnit, parseDataUnit, parseDataUnitsPref, type MeasureOptions } from "../src/ui/measure";

const DEC: MeasureOptions = { decimals: "auto", fahrenheit: false, dataUnits: "decimal" };
const BIN: MeasureOptions = { decimals: "auto", fahrenheit: false, dataUnits: "binary" };

describe("formatValue generic magnitude ladder", () => {
	it("keeps the sub-10k rhythm byte-identical to 1.1.x", () => {
		const LEGACY: Array<[number, string]> = [
			[0, "0.00"],
			[0.5, "0.50"],
			[7, "7.00"],
			[9.99, "9.99"],
			[10, "10.0"],
			[56.34, "56.3"],
			[99.95, "100.0"],
			[100, "100"],
			[999.4, "999"],
			[999.9, "1000"],
			[1000, "1000"],
			[5250, "5250"],
			[9999, "9999"],
			[9999.9, "10000"],
			[-273.15, "-273"]
		];
		for (const [value, expected] of LEGACY) {
			assert.equal(formatValue(value, "auto"), expected, String(value));
		}
	});

	it("scales through k, M, G and T", () => {
		const CASES: Array<[number, string]> = [
			[10_000, "10.0k"],
			[48_700, "48.7k"],
			[123_456, "123k"],
			[999_499, "999k"],
			[48_700_000, "48.7M"],
			[123_456_789, "123M"],
			[12_000_000_000, "12.0G"],
			[123_000_000_000, "123G"],
			[4_200_000_000_000, "4.20T"],
			[56_000_000_000_000, "56.0T"]
		];
		for (const [value, expected] of CASES) {
			assert.equal(formatValue(value, "auto"), expected, String(value));
		}
	});

	it("negative values mirror the positive ladder", () => {
		assert.equal(formatValue(-48_700, "auto"), "-48.7k");
		assert.equal(formatValue(-48_700_000, "auto"), "-48.7M");
		assert.equal(formatValue(-12_000_000_000, "auto"), "-12.0G");
		assert.equal(formatValue(-4_200_000_000_000, "auto"), "-4.20T");
	});

	it("rolls over cleanly: never 1000k, never 1000M", () => {
		assert.equal(formatValue(999_950, "auto"), "1.00M");
		assert.equal(formatValue(1_000_000, "auto"), "1.00M");
		assert.equal(formatValue(999_950_000, "auto"), "1.00G");
		assert.equal(formatValue(999_950_000_000, "auto"), "1.00T");
		// Rounding that crosses a precision band settles on the landed band.
		assert.equal(formatValue(99_990, "auto"), "100k");
		assert.equal(formatValue(9_999_000, "auto"), "10.0M");
	});

	it("boundaries just below and above each tier", () => {
		assert.equal(formatValue(9_999, "auto"), "9999");
		assert.equal(formatValue(10_001, "auto"), "10.0k");
		assert.equal(formatValue(999_449, "auto"), "999k");
		assert.equal(formatValue(1_000_001, "auto"), "1.00M");
		assert.equal(formatValue(999_449_000, "auto"), "999M");
		assert.equal(formatValue(1_000_000_001, "auto"), "1.00G");
	});

	it("no scientific notation, no negative zero, em dash for non-finite", () => {
		assert.doesNotMatch(formatValue(1e15, "auto"), /e/i);
		assert.equal(formatValue(-0.001, "auto"), "0.00");
		assert.equal(formatValue(-0.0001, "2"), "0.00");
		assert.equal(formatValue(Number.NaN, "auto"), "—");
		assert.equal(formatValue(Number.POSITIVE_INFINITY, "auto"), "—");
	});

	it("fixed decimals stay uncompacted and meaningful", () => {
		assert.equal(formatValue(12345.678, "0"), "12346");
		assert.equal(formatValue(12345.678, "2"), "12345.68");
		assert.equal(formatValue(-5, "3"), "-5.000");
	});

	it("T-scale values stay within the quad glyph budget", () => {
		assert.equal(formatQuadValue(4_200_000_000_000, "auto"), "4.2T");
		assert.equal(formatQuadValue(56_100_000_000_000, "auto"), "56T");
		assert.equal(formatQuadValue(-4_200_000_000_000, "auto"), "-4T");
		for (const value of [1e12, 9.9e12, 5.61e13, 9.99e14]) {
			assert.ok(Array.from(formatQuadValue(value, "auto")).length <= 4, String(value));
		}
	});
});

describe("parseDataUnit", () => {
	it("recognizes byte quantities with decimal and binary prefixes", () => {
		assert.deepEqual(parseDataUnit("B"), { kind: "bytes", toBase: 1 });
		assert.deepEqual(parseDataUnit("KB"), { kind: "bytes", toBase: 1e3 });
		assert.deepEqual(parseDataUnit("kB"), { kind: "bytes", toBase: 1e3 });
		assert.deepEqual(parseDataUnit("MB"), { kind: "bytes", toBase: 1e6 });
		assert.deepEqual(parseDataUnit("GB"), { kind: "bytes", toBase: 1e9 });
		assert.deepEqual(parseDataUnit("TB"), { kind: "bytes", toBase: 1e12 });
		assert.deepEqual(parseDataUnit("KiB"), { kind: "bytes", toBase: 1024 });
		assert.deepEqual(parseDataUnit("MiB"), { kind: "bytes", toBase: 1024 ** 2 });
		assert.deepEqual(parseDataUnit("GiB"), { kind: "bytes", toBase: 1024 ** 3 });
		assert.deepEqual(parseDataUnit("TiB"), { kind: "bytes", toBase: 1024 ** 4 });
	});

	it("recognizes byte and bit rates in HWiNFO's casings", () => {
		assert.deepEqual(parseDataUnit("B/s"), { kind: "byteRate", toBase: 1 });
		assert.deepEqual(parseDataUnit("KB/s"), { kind: "byteRate", toBase: 1e3 });
		assert.deepEqual(parseDataUnit("MB/s"), { kind: "byteRate", toBase: 1e6 });
		assert.deepEqual(parseDataUnit("GB/s"), { kind: "byteRate", toBase: 1e9 });
		assert.deepEqual(parseDataUnit("MiB/s"), { kind: "byteRate", toBase: 1024 ** 2 });
		assert.deepEqual(parseDataUnit("MBps"), { kind: "byteRate", toBase: 1e6 });
		assert.deepEqual(parseDataUnit("bps"), { kind: "bitRate", toBase: 1 });
		assert.deepEqual(parseDataUnit("kbps"), { kind: "bitRate", toBase: 1e3 });
		assert.deepEqual(parseDataUnit("Mbps"), { kind: "bitRate", toBase: 1e6 });
		assert.deepEqual(parseDataUnit("Gbps"), { kind: "bitRate", toBase: 1e9 });
		assert.deepEqual(parseDataUnit("bit/s"), { kind: "bitRate", toBase: 1 });
		assert.deepEqual(parseDataUnit("kbit/s"), { kind: "bitRate", toBase: 1e3 });
		assert.deepEqual(parseDataUnit("Mbit/s"), { kind: "bitRate", toBase: 1e6 });
		assert.deepEqual(parseDataUnit("Gbit/s"), { kind: "bitRate", toBase: 1e9 });
	});

	it("case is semantic: B is bytes, b is bits", () => {
		assert.equal(parseDataUnit("MB/s")?.kind, "byteRate");
		assert.equal(parseDataUnit("Mb/s")?.kind, "bitRate");
	});

	it("never mistakes ordinary units for data units", () => {
		for (const unit of ["W", "V", "A", "RPM", "MHz", "GHz", "°C", "%", "", "Yes/No", "x", "T", "G", "Mbar", "dB"]) {
			assert.equal(parseDataUnit(unit), null, unit);
		}
		// Plain bit quantities are ambiguous relabeling targets: passthrough.
		assert.equal(parseDataUnit("Mb"), null);
		assert.equal(parseDataUnit("b"), null);
	});

	it("preference parser: only the exact binary marker flips", () => {
		assert.equal(parseDataUnitsPref("binary"), "binary");
		assert.equal(parseDataUnitsPref("decimal"), "decimal");
		assert.equal(parseDataUnitsPref(undefined), "decimal");
		assert.equal(parseDataUnitsPref("BINARY"), "decimal");
		assert.equal(parseDataUnitsPref(42), "decimal");
	});
});

describe("formatMeasurement: byte quantities", () => {
	it("decimal tiers by 1000 through TB", () => {
		assert.deepEqual(formatMeasurement(512, "B", DEC), { valueText: "512", unitText: "B" });
		assert.deepEqual(formatMeasurement(45.2, "MB", DEC), { valueText: "45.2", unitText: "MB" });
		assert.deepEqual(formatMeasurement(8192, "MB", DEC), { valueText: "8.19", unitText: "GB" });
		assert.deepEqual(formatMeasurement(12_345.6, "MB", DEC), { valueText: "12.3", unitText: "GB" });
		assert.deepEqual(formatMeasurement(2_000_000, "MB", DEC), { valueText: "2.00", unitText: "TB" });
	});

	it("binary tiers by 1024 through TiB", () => {
		assert.deepEqual(formatMeasurement(512, "B", BIN), { valueText: "512", unitText: "B" });
		assert.deepEqual(formatMeasurement(8192, "MiB", BIN), { valueText: "8.00", unitText: "GiB" });
		// 8192 MB = 8.192e9 B = 7.63 GiB: the label conversion is real.
		assert.deepEqual(formatMeasurement(8192, "MB", BIN), { valueText: "7.63", unitText: "GiB" });
	});

	it("already-prefixed units round-trip without double scaling", () => {
		assert.deepEqual(formatMeasurement(12.5, "GB", DEC), { valueText: "12.5", unitText: "GB" });
		assert.deepEqual(formatMeasurement(999, "KB", DEC), { valueText: "999", unitText: "KB" });
		assert.deepEqual(formatMeasurement(3.5, "TiB", BIN), { valueText: "3.50", unitText: "TiB" });
	});

	it("rounding at a tier edge promotes instead of reading 1000/1024", () => {
		assert.deepEqual(formatMeasurement(999_950, "B", DEC), { valueText: "1.00", unitText: "MB" });
		assert.deepEqual(formatMeasurement(1023.9, "KiB", BIN), { valueText: "1.00", unitText: "MiB" });
	});

	it("fixed decimals apply to the scaled value", () => {
		assert.deepEqual(formatMeasurement(8192, "MB", { ...DEC, decimals: "0" }), { valueText: "8", unitText: "GB" });
		assert.deepEqual(formatMeasurement(8192, "MB", { ...DEC, decimals: "3" }), { valueText: "8.192", unitText: "GB" });
	});

	it("fixed decimals promote at a tier edge too, never reading 1024", () => {
		assert.deepEqual(formatMeasurement(1023.9, "KiB", { ...BIN, decimals: "0" }), { valueText: "1", unitText: "MiB" });
	});
});

describe("formatMeasurement: transfer rates", () => {
	it("decimal shows bits: byte rates multiply by 8", () => {
		assert.deepEqual(formatMeasurement(12_000_000, "B/s", DEC), { valueText: "96.0", unitText: "Mbps" });
		assert.deepEqual(formatMeasurement(1.5, "MB/s", DEC), { valueText: "12.0", unitText: "Mbps" });
		assert.deepEqual(formatMeasurement(512, "B/s", DEC), { valueText: "4.10", unitText: "kbps" });
		assert.deepEqual(formatMeasurement(2.5, "GB/s", DEC), { valueText: "20.0", unitText: "Gbps" });
	});

	it("decimal keeps bit-rate sources in bits", () => {
		assert.deepEqual(formatMeasurement(96, "Mbps", DEC), { valueText: "96.0", unitText: "Mbps" });
		assert.deepEqual(formatMeasurement(2500, "kbit/s", DEC), { valueText: "2.50", unitText: "Mbps" });
	});

	it("binary shows bytes: bit rates divide by 8", () => {
		assert.deepEqual(formatMeasurement(12_000_000, "B/s", BIN), { valueText: "11.4", unitText: "MiB/s" });
		assert.deepEqual(formatMeasurement(96, "Mbps", BIN), { valueText: "11.4", unitText: "MiB/s" });
		assert.deepEqual(formatMeasurement(800, "bps", BIN), { valueText: "100", unitText: "B/s" });
	});

	it("an MiB/s source stays put in binary and converts in decimal", () => {
		assert.deepEqual(formatMeasurement(11.4, "MiB/s", BIN), { valueText: "11.4", unitText: "MiB/s" });
		const dec = formatMeasurement(11.4, "MiB/s", DEC);
		assert.equal(dec.unitText, "Mbps");
		assert.equal(dec.valueText, "95.6"); // 11.4 * 1024^2 * 8 / 1e6
	});
});

describe("formatMeasurement: passthrough and edge cases", () => {
	it("unknown units keep the generic ladder and their own unit", () => {
		assert.deepEqual(formatMeasurement(56.34, "°C", DEC), { valueText: "56.3", unitText: "°C" });
		assert.deepEqual(formatMeasurement(1785, "RPM", DEC), { valueText: "1785", unitText: "RPM" });
		assert.deepEqual(formatMeasurement(48_700_000, "", DEC), { valueText: "48.7M", unitText: "" });
	});

	it("°C to °F conversion still applies", () => {
		assert.deepEqual(formatMeasurement(50, "°C", { ...DEC, fahrenheit: true }), { valueText: "122", unitText: "°F" });
	});

	it("non-finite values keep the placeholder and the source unit", () => {
		assert.deepEqual(formatMeasurement(Number.NaN, "MB", DEC), { valueText: "—", unitText: "MB" });
		assert.deepEqual(formatMeasurement(Number.NaN, "W", DEC), { valueText: "—", unitText: "W" });
	});

	it("zero and negatives tier at base without a stray sign", () => {
		assert.deepEqual(formatMeasurement(0, "MB", DEC), { valueText: "0.00", unitText: "B" });
		assert.deepEqual(formatMeasurement(-1500, "MB", DEC), { valueText: "-1.50", unitText: "GB" });
	});
});

describe("formatQuadMeasurement", () => {
	it("re-tiered data values keep the 4-glyph budget", () => {
		const CASES: Array<[number, string, MeasureOptions, string, string]> = [
			[12_345.6, "MB", DEC, "12.3", "GB"],
			[12_000_000, "B/s", DEC, "96.0", "Mbps"],
			[12_000_000, "B/s", BIN, "11.4", "MiB/s"],
			[1023.9, "KiB", BIN, "1.00", "MiB"]
		];
		for (const [value, unit, opts, valueText, unitText] of CASES) {
			assert.deepEqual(formatQuadMeasurement(value, unit, opts), { valueText, unitText }, `${value} ${unit}`);
			assert.ok(Array.from(valueText).length <= 4);
		}
	});

	it("non-data units keep the quad ladder", () => {
		assert.deepEqual(formatQuadMeasurement(48_700, "RPM", DEC), { valueText: "49k", unitText: "RPM" });
	});

	it("negative values near a tier edge promote instead of stacking suffixes", () => {
		// The quad budget squeezes a 5-glyph "-1010" into "-1k", which would
		// stack a magnitude suffix on the unit prefix ("-1k KiB"): promote.
		assert.deepEqual(formatQuadMeasurement(-1023.9, "KiB", BIN), { valueText: "-1.0", unitText: "MiB" });
		assert.deepEqual(formatQuadMeasurement(-999.6, "MB", DEC), { valueText: "-1.0", unitText: "GB" });
		assert.deepEqual(formatQuadMeasurement(-8.04, "kbit/s", BIN), { valueText: "-1.0", unitText: "KiB/s" });
		assert.deepEqual(formatQuadMeasurement(-1010, "KiB", { ...BIN, decimals: "0" }), { valueText: "-1", unitText: "MiB" });
	});
});

describe("formatStat and isDataUnit", () => {
	it("plain readings keep the bare number", () => {
		assert.equal(formatStat(41.2, "°C", DEC), "41.2");
		assert.equal(formatStat(41.2, "°C", { ...DEC, fahrenheit: true }), "106");
	});

	it("data units carry their own tier suffix", () => {
		assert.equal(formatStat(8192, "MB", DEC), "8.19GB");
		assert.equal(formatStat(12_000_000, "B/s", BIN), "11.4MiB/s");
	});

	it("isDataUnit gates the tight footer variant", () => {
		assert.equal(isDataUnit("MB"), true);
		assert.equal(isDataUnit("B/s"), true);
		assert.equal(isDataUnit("°C"), false);
		assert.equal(isDataUnit("RPM"), false);
	});
});

describe("estimateKeyTextWidth (the key faces' glyph-class estimator)", () => {
	it("scales linearly from the 12px calibration", () => {
		// C 7.15 ×2 + D 8.65 + "1" 4.85 = 27.8, minus the 1.5 terminal credit.
		const at12 = estimateKeyTextWidth("CCD1", 12);
		assert.ok(Math.abs(at12 - 26.3) < 1e-9, `CCD1 at 12px: ${at12}`);
		assert.ok(Math.abs(estimateKeyTextWidth("CCD1", 24) - at12 * 2) < 1e-9, "24px is exactly double 12px");
	});

	it("classes narrow glyphs, digits, caps, wide caps, lowercase and spaces apart", () => {
		assert.ok(estimateKeyTextWidth("iiii", 12) < estimateKeyTextWidth("1111", 12), "narrow < digits");
		assert.ok(estimateKeyTextWidth("aaaa", 12) < estimateKeyTextWidth("AAAA", 12), "lowercase < caps");
		assert.ok(estimateKeyTextWidth("AAAA", 12) < estimateKeyTextWidth("WWWW", 12), "caps < wide caps");
		assert.ok(estimateKeyTextWidth("nnnn", 12) < estimateKeyTextWidth("mmmm", 12), "regular < wide lowercase");
		assert.ok(estimateKeyTextWidth("a a", 12) < estimateKeyTextWidth("aaa", 12), "space < glyph");
		assert.ok(estimateKeyTextWidth("...", 12) < estimateKeyTextWidth("…", 12) * 2, "punctuation narrow, ellipsis wide");
	});

	it("unknown glyphs take a near-worst measured advance (overestimate keeps text inside)", () => {
		// µ is unmapped: default 9.1 minus the 1.5 terminal credit. ° is now a
		// MEASURED narrow glyph (4.55), no longer priced at an average.
		assert.ok(Math.abs(estimateKeyTextWidth("µ", 12) - 7.6) < 1e-9);
		assert.ok(Math.abs(estimateKeyTextWidth("°", 12) - 3.05) < 1e-9);
	});

	it("East Asian wide glyphs advance a full em", () => {
		// A default-width pricing here undercounts fullwidth glyphs by ~25% and
		// lets a CJK sensor name overflow the face at the ladder's top size.
		// Differencing cancels the terminal credit: each glyph adds exactly 12.
		for (const glyph of ["水", "電", "テ", "한", "！", "😀"]) {
			assert.equal(estimateKeyTextWidth(glyph.repeat(2), 12) - estimateKeyTextWidth(glyph, 12), 12, glyph);
		}
	});

	it("weight 700 runs a flat few percent wider; letter-spacing adds per gap", () => {
		const base = estimateKeyTextWidth("MAX", 12);
		assert.ok(estimateKeyTextWidth("MAX", 12, { fontWeight: 700 }) > base);
		assert.equal(estimateKeyTextWidth("MAX", 12, { letterSpacing: 0.5 }), base + 1);
		// Single glyph, no gaps: measured M advance 11.1 minus the 1.5 credit.
		assert.ok(Math.abs(estimateKeyTextWidth("M", 12, { letterSpacing: 0.5 }) - 9.6) < 1e-9);
	});
});

describe("fitTextLadder (largest safe size, ellipsis only at the floor)", () => {
	const SIZES = [20, 18, 16, 14] as const;

	it("keeps a short string whole at the top of the ladder", () => {
		assert.deepEqual(fitTextLadder("CCD1", 120, SIZES), { text: "CCD1", fontSize: 20 });
	});

	it("steps down to the first size that fits, keeping the whole string", () => {
		const fit = fitTextLadder("Total CPU Usage", 116, SIZES);
		assert.equal(fit.text, "Total CPU Usage");
		assert.equal(fit.fontSize, 14);
	});

	it("at the floor, ellipsizes at the widest fitting prefix and trims trailing spaces", () => {
		const fit = fitTextLadder("Virtual Memory Committed", 116, SIZES);
		assert.equal(fit.text, "Virtual Memory…");
		assert.equal(fit.fontSize, 14);
		assert.ok(estimateKeyTextWidth(fit.text, fit.fontSize) <= 116);
	});

	it("operates on code points: never splits a surrogate pair", () => {
		const fit = fitTextLadder("😀😀😀😀😀😀😀😀😀😀😀😀", 60, SIZES);
		assert.ok(fit.text.endsWith("…"));
		assert.doesNotThrow(() => encodeURIComponent(fit.text));
	});

	it("empty text stays empty at the ladder top, never a bare ellipsis", () => {
		assert.deepEqual(fitTextLadder("", 120, SIZES), { text: "", fontSize: 20 });
	});

	it("an impossibly small budget still returns a deterministic ellipsis", () => {
		const fit = fitTextLadder("CPU", 4, SIZES);
		assert.equal(fit.text, "…");
		assert.equal(fit.fontSize, 14);
	});

	it("minimumSlack tightens the budget", () => {
		const loose = fitTextLadder("Core Max", 70, SIZES);
		const tight = fitTextLadder("Core Max", 70, SIZES, { minimumSlack: 20 });
		assert.ok(tight.fontSize < loose.fontSize);
	});

	it("the ellipsis is budgeted at its real label advance, not the footer's", () => {
		// The old class table priced "…" at 7px against a measured 9.8 advance:
		// floor cuts could poke ~3px past their budget. Now 9.8 minus the 1.5
		// terminal credit; mispricing either way misplaces the cut point.
		assert.ok(Math.abs(estimateKeyTextWidth("…", 12) - 8.3) < 1e-9);
	});
});
