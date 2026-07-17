/**
 * Dial (200×100) geometry per the locked spec: title 18/600 x12 y24, value
 * 34/700 x12 y58 (24/700 from 10 glyphs, 17/700 from 14, ellipsis past 19)
 * with inline 17/600 unit, stats 12/600 y78, bar x12 y84 176×6 r3 with
 * track under fill.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderDial, renderDialOverview, renderDialTwoRow, twoRowValueFontSize, wideValueFit, type DialOverviewOptions, type DialRenderOptions, type DialTwoRowOptions, type OverviewRow, type TwoRowRow } from "../src/ui/dial-renderer";
import { dedupeSharedLabelPrefix, wrapLabelTwoLines } from "../src/ui/format";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const config = loadThemes();
const MIDNIGHT = resolvePalette(config, "midnight", null, "normal");

function render(overrides: Partial<DialRenderOptions>): string {
	return renderDial({
		title: "CPU Package",
		valueText: "56.3",
		unitText: "°C",
		statsText: "▼ 42.0   ▲ 78.5   session",
		fraction: 0.5,
		palette: MIDNIGHT,
		barColor: MIDNIGHT.accent,
		...overrides
	});
}

describe("dial geometry", () => {
	it("title 18/600 at x=12 y=24 in label color", () => {
		assert.match(render({}), new RegExp(`<text x="12" y="24" text-anchor="start" [^>]*font-size="18" font-weight="600" fill="${MIDNIGHT.label}"`));
	});

	it("value 34/700 at x=12 y=58 with inline 17/600 unit in unit color", () => {
		const svg = render({});
		assert.match(svg, new RegExp(`<text x="12" y="58" text-anchor="start" [^>]*font-size="34" font-weight="700" fill="${MIDNIGHT.value}">56\\.3<tspan dx="6" font-size="17" font-weight="600" fill="${MIDNIGHT.unit}">°C</tspan></text>`));
	});

	it("long value prose steps down so status faces never clip at the slot edge", () => {
		// Numeric values keep the 34 px size up to 9 glyphs.
		assert.match(render({ valueText: "12345.678", unitText: "" }), /y="58" [^>]*font-size="34"/);
		// 10 to 13 glyphs ("not detected", "tick sensors"): 24 px.
		assert.match(render({ valueText: "not detected", unitText: "" }), /y="58" [^>]*font-size="24"/);
		// 14 and up ("rotate to pick", "un-elevate HWiNFO"): 17 px.
		assert.match(render({ valueText: "rotate to pick", unitText: "" }), /y="58" [^>]*font-size="17"/);
		assert.match(render({ valueText: "un-elevate HWiNFO", unitText: "" }), /y="58" [^>]*font-size="17"/);
		// Belt and braces: text past the smallest tier's ~19-glyph fit ellipsizes.
		assert.match(render({ valueText: "some very long prose that cannot fit", unitText: "" }), />some very long pro…</);
	});

	it("unit omitted when empty", () => {
		assert.doesNotMatch(render({ unitText: "" }), /tspan/);
	});

	it("stats 12/600 at y=78 in unit color; omitted when empty", () => {
		assert.match(render({}), new RegExp(`<text x="12" y="78" text-anchor="start" [^>]*font-size="12" font-weight="600" fill="${MIDNIGHT.unit}"`));
		assert.doesNotMatch(render({ statsText: "" }), /y="78"/);
	});

	it("title truncates with an ellipsis", () => {
		assert.match(render({ title: "GPU Memory Junction Temperature" }), />GPU Memory Junct…</);
	});
});

describe("dial bar (x12 y84 176×6 r3)", () => {
	it("track always renders under the fill", () => {
		const svg = render({});
		const track = svg.indexOf(`<rect x="12" y="84" width="176" height="6" rx="3" fill="${MIDNIGHT.track}"/>`);
		const fill = svg.indexOf(`fill="${MIDNIGHT.accent}"`);
		assert.ok(track !== -1, "track missing");
		assert.ok(fill > track, "fill must draw after (on top of) the track");
	});

	it("fill width follows the fraction", () => {
		assert.match(render({ fraction: 0.5 }), /width="88\.0" height="6" rx="3"/);
	});

	it("fraction clamps to the bar width", () => {
		assert.match(render({ fraction: 7 }), /width="176\.0" height="6" rx="3"/);
	});

	it("tiny fractions keep a visible rounded nub", () => {
		assert.match(render({ fraction: 0.001 }), /width="6\.0" height="6" rx="3"/);
	});

	it("zero or NaN fraction renders the track only", () => {
		for (const fraction of [0, NaN]) {
			const svg = render({ fraction });
			assert.equal(svg.match(/<rect x="12" y="84"/g)?.length, 1);
		}
	});

	it("alerting swaps the fill to the alert field color", () => {
		const svg = render({ barColor: config.alerts.crit.bg });
		assert.match(svg, new RegExp(`<rect x="12" y="84" width="88\\.0" height="6" rx="3" fill="${config.alerts.crit.bg}"/>`));
	});
});

// --- overview view ------------------------------------------------------------

function overviewRow(overrides: Partial<OverviewRow>): OverviewRow {
	return { label: "CPU Package", valueText: "56.3", unitText: "°C", selected: false, valueColor: MIDNIGHT.value, ...overrides };
}

function renderOverview(overrides: Partial<DialOverviewOptions>): string {
	return renderDialOverview({
		rows: [overviewRow({ selected: true }), overviewRow({ label: "GPU Temp", valueText: "48.2" }), overviewRow({ label: "SSD", valueText: "39.0" })],
		contextText: "session",
		statsText: "▼42.0 ▲78.5",
		palette: MIDNIGHT,
		...overrides
	});
}

describe("overview geometry (V3 wide tile: rail, fixed columns, context line)", () => {
	it("rail groove x0-4 spans the rows region; the thumb marks the selected row", () => {
		const svg = renderOverview({});
		const groove = svg.indexOf(`<rect x="0" y="16" width="4" height="84" fill="${MIDNIGHT.track}"/>`);
		const thumb = svg.indexOf(`<rect x="0" y="17" width="4" height="26" rx="2" fill="${MIDNIGHT.accent}"/>`);
		assert.ok(groove !== -1, "rail groove missing");
		assert.ok(thumb !== -1, "rail thumb missing");
		assert.ok(groove < thumb, "thumb must draw on top of the groove");
		assert.doesNotMatch(svg, /width="200" height="26"/); // no full-width band anymore
	});

	it("the thumb follows the selected row (top mode band tops 17/45/73)", () => {
		const svg = renderOverview({ rows: [overviewRow({}), overviewRow({ selected: true }), overviewRow({})] });
		assert.match(svg, new RegExp(`<rect x="0" y="45" width="4" height="26" rx="2" fill="${MIDNIGHT.accent}"/>`));
		assert.doesNotMatch(svg, /<rect x="0" y="17" width="4" height="26"/);
	});

	it("UPPERCASE labels 12/600 +0.4 tracking at x=12; the selected label lifts to label color", () => {
		const svg = renderOverview({});
		assert.match(svg, new RegExp(`<text x="12" y="36.8" text-anchor="start" [^>]*font-size="12" font-weight="600" letter-spacing="0.4" fill="${MIDNIGHT.label}">CPU PACKAGE</text>`));
		assert.match(svg, new RegExp(`<text x="12" y="64.8" text-anchor="start" [^>]*font-size="12" font-weight="600" letter-spacing="0.4" fill="${MIDNIGHT.unit}">GPU TEMP</text>`));
		assert.match(svg, new RegExp(`<text x="12" y="92.8" [^>]*fill="${MIDNIGHT.unit}">SSD</text>`));
	});

	it("values end-anchor at the fixed x=168 column, units start at x=172", () => {
		const svg = renderOverview({});
		assert.match(svg, new RegExp(`<text x="168" y="36.8" text-anchor="end" [^>]*font-size="20" font-weight="700" fill="${MIDNIGHT.value}">56\\.3</text>`));
		assert.match(svg, new RegExp(`<text x="172" y="36.8" text-anchor="start" [^>]*font-size="12" font-weight="600" fill="${MIDNIGHT.unit}">°C</text>`));
		assert.match(svg, /<text x="168" y="64.8" text-anchor="end" /);
		assert.match(svg, /<text x="168" y="92.8" text-anchor="end" /);
	});

	it("a unitless value keeps the same fixed column (numbers never move)", () => {
		const svg = renderOverview({ rows: [overviewRow({ valueText: "37.4", unitText: "" })] });
		assert.match(svg, /<text x="168" y="36.8" text-anchor="end" [^>]*font-weight="700"/);
		assert.doesNotMatch(svg, /x="172"/);
	});

	it("separators: thin track lines between rows, none past the last row", () => {
		const svg = renderOverview({});
		assert.match(svg, new RegExp(`<rect x="4" y="44" width="196" height="1" fill="${MIDNIGHT.track}"/>`));
		assert.match(svg, new RegExp(`<rect x="4" y="72" width="196" height="1" fill="${MIDNIGHT.track}"/>`));
		assert.equal(svg.match(/height="1"/g)?.length, 2);
	});

	it("separators off removes the lines and the bottom-mode rule", () => {
		const svg = renderOverview({ separators: false, header: "bottom" });
		assert.doesNotMatch(svg, /height="1"/);
	});

	it("bottom mode: rows y2-80, separators at 28/54, rule at y=81, context baseline y=95", () => {
		const svg = renderOverview({ header: "bottom" });
		assert.match(svg, new RegExp(`<rect x="0" y="2" width="4" height="78" fill="${MIDNIGHT.track}"/>`));
		assert.match(svg, new RegExp(`<rect x="4" y="28" width="196" height="1" fill="${MIDNIGHT.track}"/>`));
		assert.match(svg, new RegExp(`<rect x="4" y="54" width="196" height="1" fill="${MIDNIGHT.track}"/>`));
		assert.match(svg, new RegExp(`<rect x="0" y="81" width="200" height="1" fill="${MIDNIGHT.track}"/>`));
		assert.equal(svg.match(/height="1"/g)?.length, 3); // two separators + the rule
		assert.match(svg, new RegExp(`<rect x="0" y="3" width="4" height="24" rx="2" fill="${MIDNIGHT.accent}"/>`));
		assert.match(svg, /<text x="12" y="21.8" /);
		assert.match(svg, /<text x="196" y="95" text-anchor="end" /);
		assert.doesNotMatch(svg, /y="11"/);
	});

	it("the thumb walks to the bottom band at a window clamp (band top 73)", () => {
		const svg = renderOverview({ rows: [overviewRow({}), overviewRow({}), overviewRow({ selected: true })] });
		assert.match(svg, new RegExp(`<rect x="0" y="73" width="4" height="26" rx="2" fill="${MIDNIGHT.accent}"/>`));
	});

	it("no selected row renders the groove without a thumb", () => {
		const svg = renderOverview({ rows: [overviewRow({}), overviewRow({}), overviewRow({})] });
		assert.doesNotMatch(svg, /rx="2"/);
		assert.match(svg, new RegExp(`<rect x="0" y="16" width="4" height="84" fill="${MIDNIGHT.track}"/>`));
	});

	it("an opaque bg mask separates the label run from its row's value (estimate insurance)", () => {
		// A four-glyph value at the 20px step books 48px: labelRight = 118.
		const svg = renderOverview({ rows: [overviewRow({ label: "GPU Memory Junction Temperature", selected: true })] });
		const label = svg.indexOf(">GPU MEMORY J…<");
		const mask = svg.indexOf(`<rect x="118.0" y="17" width="82.0" height="26" fill="${MIDNIGHT.bg}"/>`);
		const value = svg.indexOf(`<text x="168" y="36.8"`);
		assert.ok(label !== -1, "fitted label missing");
		assert.ok(mask !== -1, "bg mask missing");
		assert.ok(label < mask && mask < value, "mask must draw after the label and before the value");
	});

	it("labels budget per row, against their OWN value, not the widest row's", () => {
		// Shared ladder size 14 (the 12-glyph row); the 4-glyph row books
		// 33.6px (labelRight 132.4), the 12-glyph row 100.8px (labelRight
		// 65.2), so the same long name keeps ten more characters beside the
		// short value than beside the long one.
		const svg = renderOverview({
			rows: [
				overviewRow({ label: "GPU Memory Junction Temperature", valueText: "39.0" }),
				overviewRow({ label: "GPU Memory Junction Temperature", valueText: "123456789012" })
			]
		});
		assert.match(svg, />GPU MEMORY JUN…</);
		assert.match(svg, />GPU M…</);
		assert.match(svg, new RegExp(`<rect x="132.4" y="17" width="67.6" height="26" fill="${MIDNIGHT.bg}"/>`));
		assert.match(svg, new RegExp(`<rect x="65.2" y="45" width="134.8" height="26" fill="${MIDNIGHT.bg}"/>`));
	});

	it("nine-glyph memory labels render whole beside five-glyph values (the Committed regression)", () => {
		// The prefix-deduped Virtual Memory face: 63.5K books 72px at the
		// 20px step, leaving a 77px label budget, so COMMITTED (est 68.4px)
		// stays whole instead of ellipsizing a third of the way out.
		const svg = renderOverview({
			rows: [
				overviewRow({ label: "Committed", valueText: "63.5K", unitText: "MB", selected: true }),
				overviewRow({ label: "Available", valueText: "11.1K", unitText: "MB" }),
				overviewRow({ label: "Load", valueText: "85.1", unitText: "%" })
			]
		});
		assert.match(svg, />COMMITTED</);
		assert.match(svg, />AVAILABLE</);
		assert.match(svg, />LOAD</);
		assert.doesNotMatch(svg, /…/);
	});

	it("renders one or two rows without inventing empty ones", () => {
		const svg = renderOverview({ rows: [overviewRow({ selected: true }), overviewRow({ label: "GPU Temp" })] });
		assert.match(svg, /y="36.8"/);
		assert.match(svg, /y="64.8"/);
		assert.doesNotMatch(svg, /y="92.8"/);
		assert.equal(svg.match(/height="1"/g)?.length, 1); // one separator for two rows
	});

	it("caps at three rows even when handed more", () => {
		const rows = [overviewRow({}), overviewRow({}), overviewRow({}), overviewRow({ label: "Fourth" })];
		assert.doesNotMatch(renderOverview({ rows }), />FOURTH</);
	});

	it("no range bar in the overview", () => {
		assert.doesNotMatch(renderOverview({}), /y="84" width="176"/);
	});
});

describe("overview context line (stats-priority)", () => {
	it("stats 12/600 end-anchored at x=196 y=11; context 13/600 from x=2", () => {
		const svg = renderOverview({});
		assert.match(svg, new RegExp(`<text x="196" y="11" text-anchor="end" [^>]*font-size="12" font-weight="600" fill="${MIDNIGHT.unit}">▼42\\.0 ▲78\\.5</text>`));
		assert.match(svg, new RegExp(`<text x="2" y="11" text-anchor="start" [^>]*font-size="13" font-weight="600" fill="${MIDNIGHT.label}">session</text>`));
	});

	it("the stats never clip; only the context text yields (fill-to-width ellipsis)", () => {
		const svg = renderOverview({ contextText: "GPU Memory Controller", statsText: "▼73.0k ▲83.1k" });
		assert.match(svg, />▼73\.0k ▲83\.1k</); // stats whole, always
		assert.match(svg, /<text x="2" y="11" [^>]*font-size="12"[^>]*>GPU Memory [^<]*…</);
	});

	it("a missing stat reclaims its width: the same name fits whole at 13px", () => {
		const svg = renderOverview({ contextText: "GPU Memory Controller", statsText: "" });
		assert.doesNotMatch(svg, /x="196"/);
		assert.match(svg, /<text x="2" y="11" [^>]*font-size="13"[^>]*>GPU Memory Controller</);
	});

	it("an empty context line renders neither element", () => {
		const svg = renderOverview({ contextText: "", statsText: "" });
		assert.doesNotMatch(svg, /y="11"/);
	});

	it("a name in the middle band drops to 12px and stays whole (no ellipsis)", () => {
		// est 112.4px: past the 13px try (times 13/12 exceeds the budget),
		// inside the 12px budget, so the drop must not also ellipsize.
		const svg = renderOverview({ contextText: "Virtual Memory Ctrls" });
		assert.match(svg, /<text x="2" y="11" [^>]*font-size="12"[^>]*>Virtual Memory Ctrls</);
	});

	it("a physically impossible stats width pixel-fits instead of leaving the canvas", () => {
		// Decimals "3" on a 1e9-scale counter: the pair estimates past the
		// whole 194px line, so the stats trim (the canvas outranks the
		// never-yield contract) and the name region reports no room.
		const svg = renderOverview({ contextText: "session", statsText: "▼1234567890.000 ▲1234567890.000" });
		assert.match(svg, /<text x="196" y="11" text-anchor="end" [^>]*>▼1234567890\.000 [^<]*…</);
		assert.doesNotMatch(svg, /x="2" y="11"/);
	});
});

describe("overview content fitting", () => {
	it("value ladder: largest step where the widest visible value fits the column", () => {
		assert.equal(wideValueFit(["56.3"]).size, 20);
		assert.equal(wideValueFit(["49.6", "5250.00"]).size, 20); // 8 quantized glyphs still fit at 20
		assert.equal(wideValueFit(["123456789"]).size, 18); // 10 quantized
		assert.equal(wideValueFit(["123456789012"]).size, 14); // 12 quantized
		assert.equal(wideValueFit(["1234567890123"]).size, 13); // 14 quantized
		assert.equal(wideValueFit(["1234567890123456"]).size, 12); // floor
	});

	it("length flicker damping: counts quantize up to even", () => {
		assert.equal(wideValueFit(["99.9"]).maxW, wideValueFit(["100"]).maxW);
	});

	it("values ellipsize at 12 glyphs and units at 4; the ladder sizes the truncated text", () => {
		const svg = renderOverview({ rows: [overviewRow({ label: "Short", valueText: "123456789012345", unitText: "Mbit/s" })] });
		assert.match(svg, /font-size="14" font-weight="700"[^>]*>12345678901…</);
		assert.match(svg, />Mbi…</);
	});

	it("a row's value color passes through for alert tinting (value text only)", () => {
		const svg = renderOverview({ rows: [overviewRow({ valueColor: config.alerts.crit.bg })] });
		assert.match(svg, new RegExp(`font-weight="700" fill="${config.alerts.crit.bg}"`));
		assert.doesNotMatch(svg, new RegExp(`fill="${config.alerts.crit.bg}"[^>]*letter-spacing`));
	});

	it("escapes XML in labels, values and units", () => {
		const svg = renderOverview({ rows: [overviewRow({ label: "A&B<C>", valueText: `1"2`, unitText: "'u" })] });
		assert.match(svg, />A&amp;B&lt;C&gt;</);
		assert.match(svg, />1&quot;2</);
		assert.match(svg, />&apos;u</);
	});
});

describe("overview label prefix dedup (the shared words truncation would waste)", () => {
	const open = (labels: string[]) => dedupeSharedLabelPrefix(labels, labels.map(() => false));

	it("drops the leading word every label shares and reports it as the prefix", () => {
		assert.deepEqual(open(["GPU Temperature", "GPU Hot Spot", "GPU Thermal Limit"]), { labels: ["Temperature", "Hot Spot", "Thermal Limit"], prefix: "GPU" });
	});

	it("drops multi-word shared prefixes", () => {
		assert.deepEqual(open(["Virtual Memory Committed", "Virtual Memory Available"]), { labels: ["Committed", "Available"], prefix: "Virtual Memory" });
	});

	it("whole words only, never substrings", () => {
		assert.deepEqual(open(["GPUA Temp", "GPUB Temp"]), { labels: ["GPUA Temp", "GPUB Temp"], prefix: "" });
	});

	it("leaves labels alone when nothing is shared", () => {
		assert.deepEqual(open(["CPU Package", "GPU Temp", "Pump"]), { labels: ["CPU Package", "GPU Temp", "Pump"], prefix: "" });
	});

	it("a label that IS the prefix keeps its text; the others still shorten", () => {
		assert.deepEqual(open(["GPU", "GPU Temp", "GPU Hot"]), { labels: ["GPU", "Temp", "Hot"], prefix: "GPU" });
	});

	it("identical labels stay whole and report no prefix", () => {
		assert.deepEqual(open(["CPU Temp", "CPU Temp"]), { labels: ["CPU Temp", "CPU Temp"], prefix: "" });
	});

	it("locked labels (user-typed names) are kept verbatim and not considered", () => {
		assert.deepEqual(dedupeSharedLabelPrefix(["My GPU", "GPU Temperature", "GPU Hot Spot"], [true, false, false]), { labels: ["My GPU", "Temperature", "Hot Spot"], prefix: "GPU" });
	});

	it("fewer than two unlocked labels change nothing", () => {
		assert.deepEqual(dedupeSharedLabelPrefix(["GPU Temp", "GPU Hot"], [true, true]), { labels: ["GPU Temp", "GPU Hot"], prefix: "" });
		assert.deepEqual(open(["GPU Temp"]), { labels: ["GPU Temp"], prefix: "" });
	});
});

// --- two-row view ------------------------------------------------------------

function twoRowRow(overrides: Partial<TwoRowRow>): TwoRowRow {
	return { label: "CPU Package", valueText: "56.3", unitText: "°C", selected: false, valueColor: MIDNIGHT.value, ...overrides };
}

function renderTwoRow(overrides: Partial<DialTwoRowOptions>): string {
	return renderDialTwoRow({
		rows: [twoRowRow({ selected: true, history: [50, 52, 51, 55, 58, 56] }), twoRowRow({ label: "GPU Temp", valueText: "48.2" })],
		footerText: "▼ 42.0  ▲ 78.5  session",
		palette: MIDNIGHT,
		...overrides
	});
}

describe("two-row view (40px rows, big values, trend or wrapped label)", () => {
	it("rows sit at y=4 and y=46 with label and value lines", () => {
		const svg = renderTwoRow({});
		assert.match(svg, /<text x="12" y="17" text-anchor="start" [^>]*font-size="13" font-weight="600"/);
		assert.match(svg, /<text x="12" y="59" text-anchor="start" [^>]*font-size="13" font-weight="600"/);
		assert.match(svg, /<text x="172.0" y="40" text-anchor="end" [^>]*font-size="26" font-weight="700"/);
		assert.match(svg, /<text x="172.0" y="82" text-anchor="end" [^>]*font-size="26" font-weight="700"/);
	});

	it("values and units share the table columns at 26px scale", () => {
		const svg = renderTwoRow({});
		assert.match(svg, new RegExp(`<text x="172.0" y="40" text-anchor="end" [^>]*fill="${MIDNIGHT.value}">56\\.3</text>`));
		assert.match(svg, new RegExp(`<text x="176.0" y="40" text-anchor="start" [^>]*font-size="13" font-weight="600" fill="${MIDNIGHT.unit}">°C</text>`));
	});

	it("the selected row band spans the 40px row with a taller accent bar", () => {
		const svg = renderTwoRow({});
		assert.match(svg, new RegExp(`<rect x="0" y="4" width="200" height="40" fill="${MIDNIGHT.track}"/>`));
		assert.match(svg, new RegExp(`<rect x="2" y="8" width="4" height="32" rx="2" fill="${MIDNIGHT.accent}"/>`));
		assert.doesNotMatch(svg, /<rect x="0" y="46"/);
	});

	it("a short label frees its second line for the sparkline (key idiom)", () => {
		const svg = renderTwoRow({});
		assert.match(svg, new RegExp(`<polyline points="[^"]+" fill="none" stroke="${MIDNIGHT.accent}" stroke-width="3"`));
		assert.match(svg, new RegExp(`<path d="M12\\.0,41[^"]+" fill="${MIDNIGHT.track}"/>`));
		assert.match(svg, new RegExp(`<circle cx="[\\d.]+" cy="[\\d.]+" r="3.5" fill="${MIDNIGHT.accent}"/>`));
	});

	it("a long label wraps onto the second line instead of the sparkline", () => {
		const svg = renderTwoRow({
			rows: [twoRowRow({ label: "GPU Memory Junction Temperature", selected: true, history: [1, 2, 3, 4] })]
		});
		assert.match(svg, /<text x="12" y="17" [^>]*>GPU Memory Junction</);
		assert.match(svg, /<text x="12" y="40" [^>]*>Temperature</);
		assert.doesNotMatch(svg, /polyline/);
	});

	it("no sparkline without history or with one point", () => {
		assert.doesNotMatch(renderTwoRow({ rows: [twoRowRow({})] }), /polyline/);
		assert.doesNotMatch(renderTwoRow({ rows: [twoRowRow({ history: [42] })] }), /polyline/);
	});

	it("caps at two rows and keeps the footer slot", () => {
		const rows = [twoRowRow({}), twoRowRow({}), twoRowRow({ label: "Third" })];
		const svg = renderTwoRow({ rows });
		assert.doesNotMatch(svg, />Third</);
		assert.match(svg, /<text x="6" y="96" [^>]*font-size="12"/);
	});

	it("two-row value tiers 26/20/16 by character count", () => {
		assert.equal(twoRowValueFontSize("56.3"), 26);
		assert.equal(twoRowValueFontSize("5250.001"), 20);
		assert.equal(twoRowValueFontSize("1234567890"), 16);
	});
});

describe("two-line label wrap", () => {
	it("keeps a fitting label on one line", () => {
		assert.deepEqual(wrapLabelTwoLines("CPU Package", 27, 13), ["CPU Package"]);
	});

	it("wraps whole words onto the second line", () => {
		assert.deepEqual(wrapLabelTwoLines("GPU Memory Junction Temperature", 27, 13), ["GPU Memory Junction", "Temperature"]);
	});

	it("ellipsizes a second line that still overflows", () => {
		assert.deepEqual(wrapLabelTwoLines("GPU Memory Junction Temperature Sensor Values", 27, 13), ["GPU Memory Junction", "Temperature …"]);
	});

	it("truncates a single unbreakable word", () => {
		assert.deepEqual(wrapLabelTwoLines("Supercalifragilisticexpialidocious", 27, 13), ["Supercalifragilisticexpial…"]);
	});
});

// --- threshold zones on the dial bar --------------------------------------------

describe("dial bar threshold zones", () => {
	const WARN_BG = "#E8940D";
	const CRIT_BG = "#CB2114";

	it("no zones: exactly the established track and fill, nothing else", () => {
		const svg = render({ zones: [] });
		assert.equal(svg, render({}));
		assert.match(svg, new RegExp(`<rect x="12" y="84" width="176" height="6" rx="3" fill="${MIDNIGHT.track}"/>`));
	});

	it("zones sit on the track between track and fill, squared mid-track", () => {
		const svg = render({ fraction: 0.6, zones: [{ from: 0.7, to: 0.9, color: WARN_BG }] });
		// x = 12 + 0.7*176 = 135.2, w = 0.2*176 = 35.2, no rounding mid-track.
		assert.match(svg, new RegExp(`<rect x="135\\.2" y="84" width="35\\.2" height="6" fill="${WARN_BG}"/>`));
		const track = svg.indexOf(`width="176" height="6" rx="3" fill="${MIDNIGHT.track}"`);
		const zone = svg.indexOf(`fill="${WARN_BG}"`);
		const fill = svg.indexOf(`fill="${MIDNIGHT.accent}"`);
		assert.ok(track < zone && zone < fill, "track < zone < fill");
	});

	it("a zone reaching the right end rounds it, squaring its own start", () => {
		const svg = render({ zones: [{ from: 0.9, to: 1, color: CRIT_BG }] });
		// x = 12 + 0.9*176 = 170.4, w = 17.6: rounded rect plus square overpaint.
		assert.match(svg, new RegExp(`<rect x="170\\.4" y="84" width="17\\.6" height="6" rx="3" fill="${CRIT_BG}"/><rect x="170\\.4" y="84" width="3\\.0" height="6" fill="${CRIT_BG}"/>`));
	});

	it("an alertBelow zone reaching the left end rounds it", () => {
		const svg = render({ zones: [{ from: 0, to: 0.25, color: CRIT_BG }] });
		assert.match(svg, new RegExp(`<rect x="12\\.0" y="84" width="44\\.0" height="6" rx="3" fill="${CRIT_BG}"/><rect x="53\\.0" y="84" width="3\\.0" height="6" fill="${CRIT_BG}"/>`));
	});

	it("zero-width zones draw nothing", () => {
		assert.equal(render({ zones: [{ from: 0.5, to: 0.5, color: WARN_BG }] }), render({}));
	});

	it("the alert-colored fill still paints over the zones", () => {
		const svg = render({ fraction: 1, barColor: CRIT_BG, zones: [{ from: 0.7, to: 1, color: WARN_BG }] });
		const zone = svg.indexOf(`fill="${WARN_BG}"`);
		const fill = svg.lastIndexOf(`fill="${CRIT_BG}"`);
		assert.ok(zone !== -1 && fill > zone, "alert fill draws after the zone");
	});
});

// --- Text setting on dial faces ---------------------------------------------------

describe("dial text colors", () => {
	const custom = { value: "#660000", label: "#550505", unit: "#440A0A", badge: "#440A0A" };

	it("single view: title, value, unit chunk and stats take the resolved text", () => {
		const svg = render({ text: custom });
		assert.match(svg, /<text x="12" y="24" [^>]*fill="#550505"/);
		assert.match(svg, /<text x="12" y="58" [^>]*fill="#660000">56\.3<tspan [^>]*fill="#440A0A">°C<\/tspan><\/text>/);
		assert.match(svg, /<text x="12" y="78" [^>]*fill="#440A0A"/);
	});

	it("single view: bar track and fill are never recolored by text", () => {
		const svg = render({ text: custom });
		assert.match(svg, new RegExp(`rx="3" fill="${MIDNIGHT.track}"`));
		assert.match(svg, new RegExp(`rx="3" fill="${MIDNIGHT.accent}"`));
	});

	it("three-row overview: labels, units, context and stats take the text; rail stays", () => {
		const svg = renderOverview({ text: custom });
		assert.match(svg, /letter-spacing="0.4" fill="#550505">CPU PACKAGE</); // selected row label
		assert.match(svg, /letter-spacing="0.4" fill="#440A0A">GPU TEMP</); // unselected row label
		assert.match(svg, /fill="#440A0A">°C</); // unit column
		assert.match(svg, /fill="#550505">session</); // context line
		assert.match(svg, /fill="#440A0A">▼42\.0 ▲78\.5</); // stats
		assert.match(svg, new RegExp(`<rect x="0" y="16" width="4" height="84" fill="${MIDNIGHT.track}"/>`)); // rail groove
		assert.match(svg, new RegExp(`rx="2" fill="${MIDNIGHT.accent}"`)); // rail thumb
	});

	it("two-row view: labels, units and footer take the text; sparkline stays themed", () => {
		const svg = renderTwoRow({ rows: [twoRowRow({ selected: true, history: [1, 2, 3] }), twoRowRow({ label: "GPU" })], text: custom });
		assert.match(svg, /<text x="12" y="17" [^>]*fill="#550505"/); // selected label
		assert.match(svg, /<text x="6" y="96" [^>]*fill="#440A0A"/); // footer
		assert.match(svg, new RegExp(`<polyline [^>]*stroke="${MIDNIGHT.accent}"`));
	});

	it("caller-fixed row value colors (alert indicators) pass through untouched", () => {
		const svg = renderOverview({ rows: [overviewRow({ valueColor: "#CB2114" }), overviewRow({ label: "GPU Hot Spot", selected: false })], text: custom });
		assert.match(svg, /fill="#CB2114">56\.3</);
	});
});
