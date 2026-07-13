/**
 * Key-face geometry per the locked spec: fixed anchors, value shrink ramp,
 * label truncation and badge collision, sparkline structure, alert recolor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatQuadValue } from "../src/ui/format";
import { dualValueFontSize, QUAD_DEFAULT_COLORS, quadValueFontSize, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, valueFontSize, type DualKeyOptions, type DualKeyRow, type QuadKeyCell, type QuadKeyOptions, type ReadingKeyOptions } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const config = loadThemes();
const VOID = resolvePalette(config, "void", null, "normal");

function render(overrides: Partial<ReadingKeyOptions>): string {
	return renderReadingKey({
		label: "CPU Package",
		valueText: "56.3",
		unitText: "°C",
		statBadge: "",
		palette: VOID,
		...overrides
	});
}

/** Extracts the attributes of the first <text> whose content matches. */
function textElement(svg: string, content: string): string {
	const match = svg.match(new RegExp(`<text[^>]*>${content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
	assert.ok(match, `no <text> containing "${content}" in ${svg}`);
	return (match as RegExpMatchArray)[0];
}

describe("value shrink ramp (digits+dot+sign; unit excluded)", () => {
	const RAMP: Array<[string, number]> = [
		["7", 52],
		["42", 52],
		["104", 48],
		["56.3", 44],
		["412.9", 40],
		["-412.9", 36],
		["48700.1", 32],
		["-48700.1", 28],
		["123456789", 26],
		["123456789012", 26]
	];
	for (const [text, size] of RAMP) {
		it(`${text.length} chars → ${size}px`, () => {
			assert.equal(valueFontSize(text), size);
			assert.match(render({ valueText: text }), new RegExp(`<text x="72" y="94" [^>]*font-size="${size}" font-weight="700"`));
		});
	}
});

describe("anchors never move", () => {
	for (const history of [undefined, [50, 60, 55, 70]]) {
		const name = history === undefined ? "without sparkline" : "with sparkline";
		it(`value y=94, unit y=118, label y=32 ${name}`, () => {
			const svg = render({ history });
			assert.match(svg, /<text x="72" y="94" /);
			assert.match(svg, /<text x="72" y="118" [^>]*font-size="16" font-weight="600"/);
			assert.match(svg, /<text x="72" y="32" text-anchor="middle" [^>]*font-size="16" font-weight="600"/);
		});
	}

	it("unit omitted when empty, anchors unchanged", () => {
		const svg = render({ unitText: "" });
		assert.doesNotMatch(svg, /y="118"/);
		assert.match(svg, /<text x="72" y="94" /);
	});
});

describe("label truncation and badge collision", () => {
	it("centered label allows 16 chars, then ellipsis", () => {
		const svg = render({ label: "Virtual Memory Committed" });
		assert.match(svg, />Virtual Memory …</);
	});

	it("a 16-char label is untouched", () => {
		const svg = render({ label: "0123456789ABCDEF" });
		assert.match(svg, />0123456789ABCDEF</);
	});

	it("badge switches the label to left x=12, max 9 chars, hard-clipped at x=92", () => {
		const svg = render({ label: "Virtual Memory Committed", statBadge: "AVG" });
		const label = textElement(svg, "Virtual …");
		assert.match(label, /x="12" y="32" text-anchor="start"/);
		// The 80px clip is an opaque bg rect between label and badge — a solid
		// fill, the only clipping primitive proven on the Stream Deck engine.
		const mask = svg.indexOf(`<rect x="92" y="14" width="52" height="24" fill="${VOID.bg}"/>`);
		assert.ok(mask !== -1, "bg mask rect missing");
		assert.ok(svg.indexOf(label) < mask && mask < svg.indexOf(">AVG<"), "mask must draw after the label and before the badge");
		assert.doesNotMatch(svg, /<text x="72" y="32"/);
	});

	it("badge is 12/700 CAPS end-anchored at x=132, accent fill, +0.5 tracking", () => {
		const svg = render({ statBadge: "min" });
		const badge = textElement(svg, "MIN");
		assert.match(badge, /x="132" y="32" text-anchor="end"/);
		assert.match(badge, /font-size="12" font-weight="700"/);
		assert.match(badge, /letter-spacing="0.5"/);
		assert.match(badge, new RegExp(`fill="${VOID.accent}"`));
	});
});

describe("sparkline strip", () => {
	const history = Array.from({ length: 40 }, (_, i) => 50 + Math.sin(i) * 10);

	it("caps at 36 samples inside x8–136, y120–134", () => {
		const svg = render({ history });
		const points = (svg.match(/<polyline points="([^"]+)"/) as RegExpMatchArray)[1] as string;
		const pairs = points.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
		assert.equal(pairs.length, 36);
		for (const [x, y] of pairs) {
			assert.ok(x >= 8 && x <= 136, `x ${x}`);
			assert.ok(y >= 120 && y <= 134, `y ${y}`);
		}
	});

	it("accent polyline stroke 4 with round caps and joins", () => {
		const svg = render({ history });
		assert.match(svg, new RegExp(`<polyline [^>]*stroke="${VOID.accent}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"`));
	});

	it("solid under-fill in track color, closed to the strip bottom (y=134)", () => {
		const svg = render({ history });
		const path = (svg.match(/<path d="([^"]+)" fill="([^"]+)"/) as RegExpMatchArray);
		assert.equal(path[2], VOID.track);
		assert.match(path[1] as string, /^M8\.0,134 L/);
		assert.match(path[1] as string, /L136\.0,134 Z$/);
	});

	it("end dot r=5 in accent at the last sample", () => {
		const svg = render({ history: [10, 20, 30] }); // last = max → top of strip
		assert.match(svg, new RegExp(`<circle cx="136\\.0" cy="120\\.0" r="5" fill="${VOID.accent}"/>`));
	});

	it("no sparkline without 2+ samples", () => {
		assert.doesNotMatch(render({}), /polyline/);
		assert.doesNotMatch(render({ history: [42] }), /polyline/);
	});
});

describe("alert pass recolors the whole key", () => {
	it("warn: every element takes the global warn palette", () => {
		const palette = resolvePalette(config, "forest", "temperature", "warn");
		const svg = render({ palette, statBadge: "MAX", history: [1, 2, 3] });
		assert.match(svg, /<rect width="144" height="144" fill="#E8940D"\/>/);
		assert.match(svg, /y="94"[^>]*fill="#1C1200"/);
		assert.match(svg, /y="32"[^>]*fill="#402C00"/); // label
		assert.match(svg, /y="118"[^>]*fill="#553C00"/); // unit
		assert.match(svg, /<polyline [^>]*stroke="#402C00"/); // accent, not themed
		assert.match(svg, /<path [^>]*fill="#C67A06"/); // track, not themed
	});

	it("crit: red field with white value", () => {
		const palette = resolvePalette(config, "void", null, "crit");
		const svg = render({ palette });
		assert.match(svg, /<rect width="144" height="144" fill="#CB2114"\/>/);
		assert.match(svg, /y="94"[^>]*fill="#FFFFFF"/);
	});

	it("legacy alert colors are fully remapped away", () => {
		const warn = render({ palette: resolvePalette(config, "graphite", null, "warn") });
		const crit = render({ palette: resolvePalette(config, "graphite", null, "crit") });
		for (const old of ["#b45309", "#B45309", "#c2251a", "#C2251A"]) {
			assert.ok(!warn.includes(old) && !crit.includes(old), `legacy ${old} leaked`);
		}
	});
});

describe("status keys", () => {
	it("draw on true black, at most two lines, never regular weight", () => {
		const svg = renderStatusKey({ icon: "target", accent: "#4cc2ff", lines: ["Pick a sensor", "in settings", "third dropped"] });
		assert.match(svg, /<rect width="144" height="144" fill="#000000"\/>/); // OLED-safe
		const texts = svg.match(/<text[^>]*>/g) ?? [];
		assert.equal(texts.length, 2); // third line is dropped, not truncated
		for (const el of texts) {
			// strokes thin below one device pixel at regular weight on the 72 px key
			assert.match(el, /font-weight="(600|700)"/, el);
		}
	});
});

describe("hardening", () => {
	it("escapes XML in label, value and unit", () => {
		const svg = render({ label: "A&B<C>", valueText: `1"2`, unitText: "'u" });
		assert.match(svg, />A&amp;B&lt;C&gt;</);
		assert.match(svg, />1&quot;2</);
		assert.match(svg, />&apos;u</);
	});
});

// --- dual layout ------------------------------------------------------------

function dualRow(overrides: Partial<DualKeyRow>): DualKeyRow {
	return { label: "CPU Package", valueText: "56.3", unitText: "°C", statBadge: "", ...overrides };
}

function renderDual(overrides: Partial<DualKeyOptions>): string {
	return renderDualKey({
		top: dualRow({}),
		bottom: dualRow({ label: "GPU Temp", valueText: "48.2" }),
		palette: VOID,
		...overrides
	});
}

describe("dual layout geometry (row B = row A + 72, divider at the midline)", () => {
	it("labels 14/600 centered at x=72, y=22 and y=94 (keys center, like single)", () => {
		const svg = renderDual({});
		assert.match(svg, new RegExp(`<text x="72" y="22" text-anchor="middle" [^>]*font-size="14" font-weight="600" fill="${VOID.label}">CPU Package</text>`));
		assert.match(svg, new RegExp(`<text x="72" y="94" text-anchor="middle" [^>]*font-size="14" font-weight="600" fill="${VOID.label}">GPU Temp</text>`));
	});

	it("values 700 centered at x=72, y=56 and y=128, inline 14/600 unit in the chunk", () => {
		const svg = renderDual({});
		assert.match(svg, new RegExp(`<text x="72" y="56" text-anchor="middle" [^>]*font-size="32" font-weight="700" fill="${VOID.value}">56\\.3<tspan dx="6" font-size="14" font-weight="600" fill="${VOID.unit}">°C</tspan></text>`));
		assert.match(svg, new RegExp(`<text x="72" y="128" text-anchor="middle" [^>]*font-size="32" font-weight="700" fill="${VOID.value}">48\\.2<tspan`));
		assert.doesNotMatch(svg, /text-anchor="start"/);
	});

	it("track-color divider rect at x=12 y=71, 120x2", () => {
		assert.match(renderDual({}), new RegExp(`<rect x="12" y="71" width="120" height="2" fill="${VOID.track}"/>`));
	});

	it("unit omitted when empty", () => {
		const svg = renderDual({ top: dualRow({ unitText: "" }), bottom: dualRow({ unitText: "" }) });
		assert.doesNotMatch(svg, /tspan/);
	});

	it("no sparkline strip in the dual layout", () => {
		assert.doesNotMatch(renderDual({}), /polyline/);
	});
});

describe("dual value shrink ramp", () => {
	const RAMP: Array<[string, number]> = [
		["7", 32],
		["56.3", 32],
		["412.9", 24],
		["5250.0", 24],
		["-5250.0", 17],
		["123456789", 17],
		["1234567890", 14]
	];
	for (const [text, size] of RAMP) {
		it(`${Array.from(text).length} chars → ${size}px`, () => {
			assert.equal(dualValueFontSize(text), size);
			assert.match(renderDual({ top: dualRow({ valueText: text }) }), new RegExp(`<text x="72" y="56" [^>]*font-size="${size}" font-weight="700"`));
		});
	}

	it("value text past 14 chars ellipsizes", () => {
		assert.match(renderDual({ top: dualRow({ valueText: "123456789012345678", unitText: "" }) }), />1234567890123…</);
	});
});

describe("dual labels and badges", () => {
	it("a row label always allows 16 chars, badges or not, then ellipsis", () => {
		assert.match(renderDual({ top: dualRow({ label: "Virtual Memory Committed" }) }), />Virtual Memory …</);
		assert.match(renderDual({ top: dualRow({ label: "Virtual Memory Committed", statBadge: "AVG" }), sharedBadge: "" }), />Virtual Memory …</);
	});

	it("a shared badge is 12/700 CAPS centered in a divider gap, drawn over the divider", () => {
		const svg = renderDual({ sharedBadge: "min" });
		const divider = svg.indexOf(`<rect x="12" y="71" width="120" height="2" fill="${VOID.track}"/>`);
		const gap = svg.indexOf(`<rect x="47" y="63" width="50" height="14" fill="${VOID.bg}"/>`);
		const badge = svg.match(new RegExp(`<text x="72" y="76" text-anchor="middle" [^>]*font-size="12" font-weight="700" letter-spacing="0.5" fill="${VOID.accent}">MIN</text>`));
		assert.ok(divider !== -1, "divider missing");
		assert.ok(gap !== -1, "divider gap missing");
		assert.ok(badge !== null, "centered badge missing");
		assert.ok(divider < gap && gap < svg.indexOf(">MIN<"), "gap must draw after the divider and before the badge");
	});

	it("no gap and no badge without a shared stat", () => {
		const svg = renderDual({});
		assert.doesNotMatch(svg, /<rect x="47"/);
		assert.doesNotMatch(svg, /x="72" y="76"/);
	});

	it("a pinned row's badge rides inline after the unit, 12/700 accent (dial idiom)", () => {
		const svg = renderDual({ bottom: dualRow({ label: "GPU Temp", valueText: "48.2", statBadge: "max" }) });
		assert.match(
			svg,
			new RegExp(
				`<text x="72" y="128" [^>]*font-weight="700" fill="${VOID.value}">48\\.2<tspan dx="6" font-size="14" font-weight="600" fill="${VOID.unit}">°C</tspan><tspan dx="6" font-size="12" font-weight="700" letter-spacing="0.5" fill="${VOID.accent}">MAX</tspan></text>`
			)
		);
		assert.doesNotMatch(svg, /x="132"/); // nothing end-anchored into the corner
	});

	it("an inline badge books three characters of the value's size budget", () => {
		assert.equal(dualValueFontSize("56.3", false), 32);
		assert.equal(dualValueFontSize("56.3", true), 24);
		assert.match(renderDual({ top: dualRow({ valueText: "56.3", statBadge: "MIN" }) }), /<text x="72" y="56" [^>]*font-size="24"/);
	});

	it("an inline badge renders even on a unitless reading", () => {
		const svg = renderDual({ top: dualRow({ unitText: "", statBadge: "avg" }) });
		assert.match(svg, /y="56"[^>]*>56\.3<tspan dx="6" font-size="12" font-weight="700"[^>]*>AVG<\/tspan><\/text>/);
	});
});

describe("dual alert recolor (whole key, from the primary thresholds)", () => {
	it("crit: red field, white values on both rows", () => {
		const palette = resolvePalette(config, "void", null, "crit");
		const svg = renderDual({ palette });
		assert.match(svg, /<rect width="144" height="144" fill="#CB2114"\/>/);
		assert.match(svg, /y="56"[^>]*fill="#FFFFFF"/);
		assert.match(svg, /y="128"[^>]*fill="#FFFFFF"/);
	});
});

describe("dual hardening", () => {
	it("escapes XML in row labels, values and units", () => {
		const svg = renderDual({ top: dualRow({ label: "A&B<C>", valueText: `1"2`, unitText: "'u" }) });
		assert.match(svg, />A&amp;B&lt;C&gt;</);
		assert.match(svg, />1&quot;2</);
		assert.match(svg, />&apos;u</);
	});
});

// --- quad layout --------------------------------------------------------------

function quadCell(overrides: Partial<QuadKeyCell>): QuadKeyCell {
	return { label: "CPU", valueText: "56.3", unitText: "°C", color: "#4CC2FF", ...overrides };
}

function renderQuad(overrides: Partial<QuadKeyOptions>): string {
	return renderQuadKey({
		cells: [quadCell({}), quadCell({ label: "GPU", valueText: "48.2", color: "#FF7E8E" }), quadCell({ label: "Pump", valueText: "2850", unitText: "RPM", color: "#38CD89" }), quadCell({ label: "Power", valueText: "142", unitText: "W", color: "#D4AB33" })],
		palette: VOID,
		...overrides
	});
}

describe("quad layout geometry (2x2 cells behind a hairline cross)", () => {
	it("default variant: 26/700 values at the four cell centers, each in its slot color", () => {
		const svg = renderQuad({});
		assert.match(svg, /<text x="36" y="40" text-anchor="middle" [^>]*font-size="26" font-weight="700" fill="#4CC2FF">56\.3<\/text>/);
		assert.match(svg, /<text x="108" y="40" text-anchor="middle" [^>]*font-size="26" font-weight="700" fill="#FF7E8E">48\.2<\/text>/);
		assert.match(svg, /<text x="36" y="112" text-anchor="middle" [^>]*font-size="26" font-weight="700" fill="#38CD89">2850<\/text>/);
		assert.match(svg, /<text x="108" y="112" text-anchor="middle" [^>]*font-size="26" font-weight="700" fill="#D4AB33">142<\/text>/);
	});

	it("default variant: 14/600 units in the theme unit color at top+58, no labels", () => {
		const svg = renderQuad({});
		assert.match(svg, new RegExp(`<text x="36" y="58" text-anchor="middle" [^>]*font-size="14" font-weight="600" fill="${VOID.unit}">°C</text>`));
		assert.match(svg, new RegExp(`<text x="108" y="130" text-anchor="middle" [^>]*font-size="14" font-weight="600" fill="${VOID.unit}">W</text>`));
		assert.doesNotMatch(svg, /y="20"/);
		assert.doesNotMatch(svg, />CPU</);
	});

	it("track-color cross: the dual divider rect plus its vertical twin", () => {
		const svg = renderQuad({});
		assert.match(svg, new RegExp(`<rect x="12" y="71" width="120" height="2" fill="${VOID.track}"/>`));
		assert.match(svg, new RegExp(`<rect x="71" y="12" width="2" height="120" fill="${VOID.track}"/>`));
	});

	it("unit omitted when empty; a null slot draws an empty quadrant", () => {
		const svg = renderQuad({ cells: [quadCell({ unitText: "" }), null, null, quadCell({ valueText: "9", unitText: "" })] });
		assert.doesNotMatch(svg, /y="58"/);
		assert.doesNotMatch(svg, /x="108" y="40"/);
		assert.doesNotMatch(svg, /x="36" y="112"/);
		assert.match(svg, /<text x="36" y="40" /);
		assert.match(svg, /<text x="108" y="112" /);
		assert.match(svg, new RegExp(`<rect x="71" y="12" width="2" height="120" fill="${VOID.track}"/>`)); // cross survives empties
	});

	it("no sparkline and nothing end-anchored in the quad layout", () => {
		const svg = renderQuad({});
		assert.doesNotMatch(svg, /polyline/);
		assert.doesNotMatch(svg, /text-anchor="end"/);
	});
});

describe("quad micro-label variant", () => {
	it("12/700 slot-colored micro-labels at top+20, values 24/700 in the theme value color at top+45, units at top+61", () => {
		const svg = renderQuad({ labels: true });
		assert.match(svg, /<text x="36" y="20" text-anchor="middle" [^>]*font-size="12" font-weight="700" letter-spacing="0.5" fill="#4CC2FF">CPU<\/text>/);
		assert.match(svg, /<text x="36" y="92" text-anchor="middle" [^>]*font-size="12" font-weight="700" letter-spacing="0.5" fill="#38CD89">PUMP<\/text>/);
		assert.match(svg, new RegExp(`<text x="36" y="45" text-anchor="middle" [^>]*font-size="24" font-weight="700" fill="${VOID.value}">56\\.3</text>`));
		assert.match(svg, new RegExp(`<text x="108" y="117" text-anchor="middle" [^>]*font-size="24" font-weight="700" fill="${VOID.value}">142</text>`));
		assert.match(svg, new RegExp(`<text x="36" y="61" text-anchor="middle" [^>]*font-size="14" font-weight="600" fill="${VOID.unit}">°C</text>`));
	});

	it("micro-labels uppercase and hard-cut to 4 code points, no ellipsis", () => {
		const svg = renderQuad({ labels: true, cells: [quadCell({ label: "Package" }), quadCell({ label: "ßß" }), null, null] });
		assert.match(svg, />PACK</);
		assert.doesNotMatch(svg, /…</);
		// Locale expansion happens before the cut: ß to SS never exceeds 4.
		assert.match(svg, />SSSS</);
	});

	it("an empty label draws no micro-label but keeps the value anchored at top+45", () => {
		const svg = renderQuad({ labels: true, cells: [quadCell({ label: "" }), null, null, null] });
		assert.doesNotMatch(svg, /y="20"/);
		assert.match(svg, /<text x="36" y="45" /);
	});
});

describe("quad shared badge (the dual gap idiom at the cross intersection)", () => {
	it("a badge is 12/700 CAPS centered at x=72 y=76 in an opaque gap over the cross", () => {
		const svg = renderQuad({ sharedBadge: "min" });
		const cross = svg.indexOf(`<rect x="71" y="12" width="2" height="120" fill="${VOID.track}"/>`);
		const gap = svg.indexOf(`<rect x="47" y="63" width="50" height="14" fill="${VOID.bg}"/>`);
		const badge = svg.match(new RegExp(`<text x="72" y="76" text-anchor="middle" [^>]*font-size="12" font-weight="700" letter-spacing="0.5" fill="${VOID.accent}">MIN</text>`));
		assert.ok(cross !== -1, "cross missing");
		assert.ok(gap !== -1, "cross gap missing");
		assert.ok(badge !== null, "centered badge missing");
		assert.ok(cross < gap && gap < svg.indexOf(">MIN<"), "gap must draw after the cross and before the badge");
	});

	it("no gap and no badge for the live value", () => {
		const svg = renderQuad({});
		assert.doesNotMatch(svg, /<rect x="47"/);
		assert.doesNotMatch(svg, /x="72" y="76"/);
	});
});

describe("quad value shrink ramp and formatter", () => {
	it("the 4-glyph norm holds the base size; longer steps 4px per glyph to the 12px floor", () => {
		const RAMP: Array<[string, number, number]> = [
			["7", 26, 24],
			["9999", 26, 24],
			["-9999", 22, 20],
			["123456", 18, 16],
			["1234567", 14, 12],
			["12345678", 12, 12],
			["123456789012", 12, 12]
		];
		for (const [text, plain, labeled] of RAMP) {
			assert.equal(quadValueFontSize(text), plain, text);
			assert.equal(quadValueFontSize(text, true), labeled, `${text} labeled`);
		}
		assert.match(renderQuad({ cells: [quadCell({ valueText: "-9999" }), null, null, null] }), /<text x="36" y="40" [^>]*font-size="22"/);
	});

	it("value text past 7 code points ellipsizes (defensive; the formatter caps at 4)", () => {
		const svg = renderQuad({ cells: [quadCell({ valueText: "123456789", unitText: "" }), null, null, null] });
		assert.match(svg, />123456…</);
	});

	it("formatQuadValue caps every magnitude at 4 glyphs", () => {
		const CASES: Array<[number, "auto" | "0" | "1" | "2" | "3", string]> = [
			[7, "auto", "7.00"],
			[56.34, "auto", "56.3"],
			[999.9, "auto", "1000"],
			[9999, "auto", "9999"],
			[12345, "auto", "12k"],
			[48700, "auto", "49k"],
			[123456, "auto", "123k"],
			[999999, "auto", "1.0M"],
			[1234567, "auto", "1.2M"],
			[123456789, "auto", "123M"],
			[1234567890, "auto", "1.2G"],
			[-273.15, "auto", "-273"],
			[-12345, "auto", "-12k"],
			[0.012, "auto", "0.01"],
			[5250, "auto", "5250"],
			[0, "3", "0.00"],
			[1.5, "3", "1.50"],
			[70, "0", "70"]
		];
		for (const [value, decimals, expected] of CASES) {
			assert.equal(formatQuadValue(value, decimals), expected, `${value} @ ${decimals}`);
			assert.ok(Array.from(formatQuadValue(value, decimals)).length <= 4, `${value} over 4 glyphs`);
		}
		assert.equal(formatQuadValue(Number.NaN, "auto"), "—");
	});

	it("the exported default slot palette is four #RRGGBB hexes", () => {
		assert.equal(QUAD_DEFAULT_COLORS.length, 4);
		for (const hex of QUAD_DEFAULT_COLORS) {
			assert.match(hex, /^#[0-9A-F]{6}$/);
		}
	});
});

describe("quad alert recolor (whole key, from the primary thresholds)", () => {
	it("crit: red field, cross and badge from the alert palette, caller-collapsed cell colors", () => {
		const palette = resolvePalette(config, "void", null, "crit");
		// The action passes the alert palette's own text token as every slot
		// color, so no identity hue survives the recolor.
		const cells = [quadCell({ color: palette.value }), quadCell({ color: palette.value }), null, null];
		const svg = renderQuadKey({ cells, sharedBadge: "MAX", palette });
		assert.match(svg, /<rect width="144" height="144" fill="#CB2114"\/>/);
		assert.match(svg, /y="40"[^>]*fill="#FFFFFF"/);
		assert.doesNotMatch(svg, /#4CC2FF/i);
		assert.match(svg, new RegExp(`<rect x="12" y="71" width="120" height="2" fill="${palette.track}"/>`));
	});
});

describe("quad hardening", () => {
	it("escapes XML in micro-labels, values and units", () => {
		const svg = renderQuad({ labels: true, cells: [quadCell({ label: "A&B<", valueText: `1"2`, unitText: "'u" }), null, null, null] });
		assert.match(svg, />A&amp;B&lt;</);
		assert.match(svg, />1&quot;2</);
		assert.match(svg, />&apos;u</);
	});
});
