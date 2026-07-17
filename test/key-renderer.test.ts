/**
 * Key-face geometry per the locked spec: fixed anchors, value shrink ramp,
 * label truncation and badge collision, sparkline structure, alert recolor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatQuadValue } from "../src/ui/format";
import { dualValueFontSize, QUAD_DEFAULT_COLORS, quadValueFontSize, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, ringValueFontSize, valueFontSize, type DualKeyOptions, type DualKeyRow, type KeyGauge, type QuadKeyCell, type QuadKeyOptions, type ReadingKeyOptions } from "../src/ui/key-renderer";
import { resolveTextColors } from "../src/ui/text-colors";
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

// --- Bar gauge ----------------------------------------------------------------

const WARN_BG = "#E8940D";
const CRIT_BG = "#CB2114";

function barGauge(overrides: Partial<KeyGauge>): KeyGauge {
	return { kind: "bar", fraction: 0.5, zones: [], ...overrides };
}

describe("key Bar gauge", () => {
	it("pill track x16 y120 112x10 r5 in track color, accent fill from the left", () => {
		// Raised and inset from the physical lens crop (hardware-verified).
		const svg = render({ gauge: barGauge({ fraction: 0.5 }) });
		assert.match(svg, new RegExp(`<rect x="16" y="120" width="112" height="10" rx="5" fill="${VOID.track}"/>`));
		assert.match(svg, new RegExp(`<rect x="16" y="120" width="56\\.0" height="10" rx="5" fill="${VOID.accent}"/>`));
	});

	it("fill clamps to the track and keeps a visible minimum", () => {
		assert.match(render({ gauge: barGauge({ fraction: 1.5 }) }), /width="112\.0" height="10" rx="5"/);
		assert.match(render({ gauge: barGauge({ fraction: 0.001 }) }), /width="10\.0" height="10" rx="5"/);
	});

	it("no fill at zero or on a non-finite fraction; the track stays", () => {
		for (const fraction of [0, Number.NaN]) {
			const svg = render({ gauge: barGauge({ fraction }) });
			assert.match(svg, new RegExp(`<rect x="16" y="120" width="112" height="10" rx="5" fill="${VOID.track}"/>`));
			assert.doesNotMatch(svg, new RegExp(`rx="5" fill="${VOID.accent}"`));
		}
	});

	it("threshold zones sit on the track at their normalized spans", () => {
		const svg = render({
			gauge: barGauge({ fraction: 0.6, zones: [{ from: 0.7, to: 0.9, color: WARN_BG }, { from: 0.9, to: 1, color: CRIT_BG }] })
		});
		// warn: x = 16 + 0.7*112 = 94.4, w = 0.2*112 = 22.4, squared mid-track.
		assert.match(svg, new RegExp(`<rect x="94\\.4" y="120" width="22\\.4" height="10" fill="${WARN_BG}"/>`));
		// crit reaches the right end: rounded, with a same-color square overpaint
		// squaring its left edge (solid fills are the proven clip idiom).
		assert.match(svg, new RegExp(`<rect x="116\\.8" y="120" width="11\\.2" height="10" rx="5" fill="${CRIT_BG}"/><rect x="116\\.8" y="120" width="5\\.0" height="10" fill="${CRIT_BG}"/>`));
	});

	it("alertBelow zones round the left end instead", () => {
		const svg = render({ gauge: barGauge({ zones: [{ from: 0, to: 0.25, color: CRIT_BG }] }) });
		// Rounded rect for the left cap, same-color square overpaint squaring
		// the right edge at 39..44.
		assert.match(svg, new RegExp(`<rect x="16\\.0" y="120" width="28\\.0" height="10" rx="5" fill="${CRIT_BG}"/><rect x="39\\.0" y="120" width="5\\.0" height="10" fill="${CRIT_BG}"/>`));
	});

	it("zone draw order: track, zones, then the fill on top", () => {
		const svg = render({ gauge: barGauge({ fraction: 0.8, zones: [{ from: 0.7, to: 1, color: WARN_BG }] }) });
		const track = svg.indexOf(`fill="${VOID.track}"/>`, svg.indexOf('y="120"'));
		const zone = svg.indexOf(`fill="${WARN_BG}"`);
		const fill = svg.indexOf(`fill="${VOID.accent}"`);
		assert.ok(track !== -1 && zone !== -1 && fill !== -1);
		assert.ok(track < zone && zone < fill, "track < zone < fill");
	});

	it("the bar stays inside the physical safe area (>=14px off every edge it nears)", () => {
		const svg = render({ gauge: barGauge({ fraction: 1 }) });
		assert.doesNotMatch(svg, /y="13[0-9]"[^>]*height="10"/); // nothing below y=130
		assert.doesNotMatch(svg, /<rect x="[0-9]" y="120"/); // nothing left of x=16
	});

	it("value, unit and label anchors stay locked; no sparkline alongside", () => {
		const svg = render({ gauge: barGauge({}), history: [1, 2, 3] });
		assert.match(svg, /<text x="72" y="94" /);
		assert.match(svg, /<text x="72" y="118" /);
		assert.match(svg, /<text x="72" y="32" /);
		assert.doesNotMatch(svg, /polyline/);
	});
});

// --- Ring gauge ---------------------------------------------------------------

function ringGauge(overrides: Partial<KeyGauge>): KeyGauge {
	return { kind: "ring", fraction: 0.5, zones: [], ...overrides };
}

/** Every arc's points, parsed from "Mx,y Ar,r 0 L S x2,y2". */
function ringArcs(svg: string): Array<{ x1: number; y1: number; x2: number; y2: number; large: number; stroke: string; width: string; cap: string }> {
	return [...svg.matchAll(/<path d="M([\d.-]+),([\d.-]+) A([\d.]+),([\d.]+) 0 ([01]) 1 ([\d.-]+),([\d.-]+)" fill="none" stroke="([^"]+)" stroke-width="([\d.]+)" stroke-linecap="([a-z]+)"\/>/g)].map((m) => ({
		x1: Number(m[1]),
		y1: Number(m[2]),
		x2: Number(m[6]),
		y2: Number(m[7]),
		large: Number(m[5]),
		stroke: m[8] as string,
		width: m[9] as string,
		cap: m[10] as string
	}));
}

describe("key Ring gauge", () => {
	it("track arc: r=46 around (72,90), 280 degrees opening downward, 10px round caps", () => {
		// The automotive dial pattern: ends at the bottom, crown over the top.
		// The crown's outer edge (y=39) clears the label band; the end caps
		// (y≈130) stay inside the physical lens crop (hardware-verified).
		const svg = render({ gauge: ringGauge({ fraction: 0 }) });
		const arcs = ringArcs(svg);
		assert.equal(arcs.length, 1);
		const track = arcs[0] as (typeof arcs)[0];
		assert.equal(track.stroke, VOID.track);
		assert.equal(track.width, "10");
		assert.equal(track.cap, "round");
		assert.equal(track.large, 1);
		// Start at 220° from top: (72 + 46 sin220, 90 - 46 cos220) = (42.4, 125.2).
		assert.ok(Math.abs(track.x1 - 42.4) < 0.2 && Math.abs(track.y1 - 125.2) < 0.2, `start ${track.x1},${track.y1}`);
		// End at 140° (bottom right): mirrored.
		assert.ok(Math.abs(track.x2 - 101.6) < 0.2 && Math.abs(track.y2 - 125.2) < 0.2, `end ${track.x2},${track.y2}`);
		// Every drawn endpoint stays at or below the crown (y=44), whose outer
		// stroke edge (39) clears the label glyphs (which end near y=36).
		for (const arc of arcs) {
			assert.ok(arc.y1 > 43.9 && arc.y2 > 43.9, "arc clear of the label");
		}
	});

	it("fill arc runs clockwise from the bottom-left end to the fraction", () => {
		const svg = render({ gauge: ringGauge({ fraction: 0.5 }) });
		const arcs = ringArcs(svg);
		assert.equal(arcs.length, 2);
		const fill = arcs[1] as (typeof arcs)[0];
		assert.equal(fill.stroke, VOID.accent);
		// 50% of 280° = 140° sweep from 220°: ends at 360° = the crown (72, 44).
		assert.ok(Math.abs(fill.x2 - 72) < 0.2 && Math.abs(fill.y2 - 44) < 0.2, `fill end ${fill.x2},${fill.y2}`);
	});

	it("zones draw between track and fill at their normalized spans", () => {
		const svg = render({ gauge: ringGauge({ fraction: 0.2, zones: [{ from: 0.75, to: 1, color: WARN_BG }] }) });
		const arcs = ringArcs(svg);
		assert.equal(arcs.length, 3);
		assert.equal(arcs.map((a) => a.stroke).join(" "), `${VOID.track} ${WARN_BG} ${VOID.accent}`);
		const zone = arcs[1] as (typeof arcs)[0];
		// from 0.75: 220 + 210 = 70°, descending the right side toward the
		// bottom-right end at 140° — the tachometer's redline placement.
		assert.ok(Math.abs(zone.x1 - (72 + 46 * Math.sin((70 * Math.PI) / 180))) < 0.2, `zone start x ${zone.x1}`);
		assert.ok(Math.abs(zone.x2 - 101.6) < 0.2, `zone end x ${zone.x2}`);
	});

	it("a non-finite fraction draws the empty track only", () => {
		const svg = render({ gauge: ringGauge({ fraction: Number.NaN }) });
		assert.equal(ringArcs(svg).length, 1);
	});

	it("the ring draws first so value and unit paint over its field", () => {
		const svg = render({ gauge: ringGauge({ fraction: 0.5 }) });
		assert.ok(svg.indexOf("<path") < svg.indexOf('y="94"'), "ring before value");
	});

	it("ring value sizes step down to keep the widest text inside the inner chord", () => {
		const RAMP: Array<[string, number]> = [
			["7", 44],
			["42", 44],
			["104", 40],
			["56.3", 32],
			["412.9", 27],
			["-412.9", 23],
			["48700.1", 20],
			["-48700.1", 18],
			["123456789", 16]
		];
		for (const [text, size] of RAMP) {
			assert.equal(ringValueFontSize(text), size, text);
		}
		assert.match(render({ gauge: ringGauge({}), valueText: "56.3" }), /<text x="72" y="94" [^>]*font-size="32"/);
		// Chord invariant: at the glyph-band TOP (baseline y=94, digit tops
		// ~0.70 em above, so 0.70*F - 4 above the ring center at cy=90), the
		// text width must fit the inner-circle chord (inner radius 46 - 10/2).
		const STROKE = 10;
		for (const [text, size] of RAMP) {
			const halfChord = Math.sqrt((46 - STROKE / 2) ** 2 - (0.7 * size - 4) ** 2);
			assert.ok(Array.from(text).length * 0.55 * size <= 2 * halfChord, `${text} at ${size}px exceeds the inner chord (${(Array.from(text).length * 0.55 * size).toFixed(1)} > ${(2 * halfChord).toFixed(1)})`);
		}
	});

	it("bar and ring communicate the same fraction and zones", () => {
		const zones = [{ from: 0.7, to: 1, color: WARN_BG }];
		const bar = render({ gauge: { kind: "bar", fraction: 0.42, zones } });
		const ring = render({ gauge: { kind: "ring", fraction: 0.42, zones } });
		// Same value face, same zone color, both show a partial accent fill.
		assert.match(bar, new RegExp(`fill="${WARN_BG}"`));
		assert.match(ring, new RegExp(`stroke="${WARN_BG}"`));
		assert.match(bar, new RegExp(`width="47\\.0" height="10" rx="5" fill="${VOID.accent}"`)); // 0.42*112 ≈ 47.0 wide
		const fill = ringArcs(ring).find((a) => a.stroke === VOID.accent);
		assert.ok(fill !== undefined, "ring fill present");
	});
});

// --- Text setting (issue #2) ----------------------------------------------------

describe("key text colors", () => {
	const custom = resolveTextColors(VOID, { mode: "custom", color: "#660000", dimSecondary: false }, "normal");
	const customDim = resolveTextColors(VOID, { mode: "custom", color: "#660000", dimSecondary: true }, "normal");
	const dim = resolveTextColors(VOID, { mode: "dim", color: undefined, dimSecondary: false }, "normal");

	it("custom: the main value is the exact selected color", () => {
		const svg = render({ text: custom });
		assert.match(svg, /<text x="72" y="94" [^>]*fill="#660000">56\.3<\/text>/);
	});

	it("custom without secondary dim: label, unit and badge take the exact color", () => {
		const svg = render({ text: custom, statBadge: "MAX" });
		assert.match(svg, /y="32"[^>]*fill="#660000"/);
		assert.match(svg, /y="118"[^>]*fill="#660000"/);
		assert.match(svg, />MAX<\/text>/);
		assert.match(svg, /x="132" y="32"[^>]*fill="#660000"/);
	});

	it("custom with secondary dim: value exact, secondary stepped toward bg", () => {
		const svg = render({ text: customDim, statBadge: "MAX" });
		assert.match(svg, /y="94"[^>]*fill="#660000"/);
		assert.match(svg, new RegExp(`y="118"[^>]*fill="${customDim.unit}"`));
		assert.notEqual(customDim.unit, "#660000");
	});

	it("dim mode dims every textual element but nothing structural", () => {
		const svg = render({ text: dim, history: [1, 2, 3] });
		assert.match(svg, new RegExp(`y="94"[^>]*fill="${dim.value}"`));
		// The sparkline keeps the theme accent and track: graphics never dim.
		assert.match(svg, new RegExp(`<polyline [^>]*stroke="${VOID.accent}"`));
		assert.match(svg, new RegExp(`<path [^>]*fill="${VOID.track}"`));
		assert.match(svg, new RegExp(`<rect width="144" height="144" fill="${VOID.bg}"/>`));
	});

	it("gauge fills and tracks are not recolored by text", () => {
		const svg = render({ text: custom, gauge: { kind: "bar", fraction: 0.5, zones: [] } });
		assert.match(svg, new RegExp(`rx="5" fill="${VOID.accent}"`));
		assert.match(svg, new RegExp(`rx="5" fill="${VOID.track}"`));
	});

	it("dual rows and quad cells take the resolved text", () => {
		const dual = renderDualKey({
			top: dualRow({}),
			bottom: dualRow({ label: "GPU", valueText: "48.2", statBadge: "max" }),
			palette: VOID,
			text: custom
		});
		assert.match(dual, /y="56"[^>]*fill="#660000"/);
		assert.match(dual, /<tspan dx="6" font-size="14" font-weight="600" fill="#660000">°C<\/tspan>/);
		assert.match(dual, /fill="#660000">MAX<\/tspan>/);
		const quad = renderQuadKey({ cells: [quadCell({ color: "#660000" }), null, null, null], palette: VOID, text: custom, sharedBadge: "MIN" });
		assert.match(quad, /y="40"[^>]*fill="#660000"/);
		assert.match(quad, /y="76"[^>]*fill="#660000">MIN<\/text>/);
	});

	it("alert palettes override custom text outright", () => {
		const crit = resolvePalette(config, "void", null, "crit");
		// The action resolves text at the alert level, which returns the alert
		// palette's own tokens; the render is then the plain alert face.
		const text = resolveTextColors(crit, { mode: "custom", color: "#660000", dimSecondary: false }, "crit");
		const svg = render({ palette: crit, text });
		assert.match(svg, /<rect width="144" height="144" fill="#CB2114"\/>/);
		assert.match(svg, /y="94"[^>]*fill="#FFFFFF"/);
		assert.doesNotMatch(svg, /#660000/);
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
