/**
 * Key-face geometry per the locked spec: fixed anchors, value shrink ramp,
 * label truncation and badge collision, sparkline structure, alert recolor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderReadingKey, renderStatusKey, valueFontSize, type ReadingKeyOptions } from "../src/ui/key-renderer";
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
