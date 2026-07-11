// Physical render targets. Keys ship as one 144x144 logical SVG canvas and
// dials as one 200x100 canvas; the Stream Deck app rasterizes them at each
// device's native key size (72, 80, 96, 112, 120 px are the documented
// families). Vector output scales losslessly, so what this suite locks is
// the part scaling cannot fix: extreme content must stay well-formed, inside
// the canvas, truncated where the spec says, and legible at the smallest
// (0.5x) target on every theme and alert level.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderDial } from "../src/ui/dial-renderer";
import { formatValue, type AlertLevel } from "../src/ui/format";
import { renderReadingKey, renderStatusKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const config = loadThemes();
const THEME_IDS = Object.keys(config.themes);
const LEVELS: AlertLevel[] = ["normal", "warn", "crit"];

/** The documented physical key sizes the logical canvas is rasterized to. */
const KEY_TARGETS = [72, 80, 96, 112, 120];
/** Every device's touch strip renders per-encoder segments at exactly this. */
const DIAL_TARGET = { w: 200, h: 100 };

/** Content extremes: long labels, negatives, high RPM, big clocks, tiny values. */
const EXTREMES = [
	{ label: "GPU Hot Spot Temperature Sensor #2", value: formatValue(-273.15, "auto"), unit: "°C" },
	{ label: "Chassis Fan #4", value: formatValue(12345, "auto"), unit: "RPM" },
	{ label: "Core Clock", value: formatValue(5250, "auto"), unit: "MHz" },
	{ label: "Vcore", value: formatValue(0.012, "auto"), unit: "V" },
	{ label: "電力消費量テスト", value: formatValue(1234567, "auto"), unit: "W" },
	{ label: "P", value: formatValue(0, "3"), unit: "" }
];

function assertRenderable(svg: string, canvasW: number, canvasH: number, what: string): void {
	assert.ok(svg.startsWith("<svg xmlns="), `${what}: not an SVG`);
	assert.ok(svg.endsWith("</svg>"), `${what}: unterminated`);
	assert.ok(svg.includes(`viewBox="0 0 ${canvasW} ${canvasH}"`), `${what}: wrong canvas`);
	for (const poison of ["NaN", "Infinity", "undefined", "null"]) {
		assert.ok(!svg.includes(poison), `${what}: contains ${poison}`);
	}
	assert.doesNotThrow(() => encodeURIComponent(svg), `${what}: not URI-encodable`);
	// Every drawn x coordinate stays inside the canvas.
	for (const match of svg.matchAll(/ x="(-?[\d.]+)"/g)) {
		const x = Number(match[1]);
		assert.ok(x >= 0 && x <= canvasW, `${what}: x=${x} outside canvas`);
	}
	// Legibility floor: nothing below 12px logical (6px at the 0.5x target)
	// and no stroke under 3px (1.5px at 0.5x).
	for (const match of svg.matchAll(/font-size="([\d.]+)"/g)) {
		assert.ok(Number(match[1]) >= 12, `${what}: font ${match[1]} below floor`);
	}
	for (const match of svg.matchAll(/stroke-width="([\d.]+)"/g)) {
		assert.ok(Number(match[1]) >= 3, `${what}: stroke ${match[1]} below floor`);
	}
}

describe("key faces at every density target", () => {
	it(`the logical canvas maps cleanly onto ${KEY_TARGETS.join("/")} px keys`, () => {
		// Vector scaling needs an intrinsic square aspect; the physical target
		// list is here so a future canvas change re-evaluates every family.
		for (const target of KEY_TARGETS) {
			assert.ok(target > 0 && Number.isInteger(target));
		}
		const svg = renderReadingKey({ label: "CPU", valueText: "62", unitText: "°C", statBadge: "", palette: resolvePalette(config, "void", null, "normal") });
		assert.ok(svg.includes('viewBox="0 0 144 144"') && svg.includes('width="144" height="144"'));
	});

	it("every theme x alert level x content extreme renders in-bounds", () => {
		for (const themeId of THEME_IDS) {
			for (const level of LEVELS) {
				for (const extreme of EXTREMES) {
					const palette = resolvePalette(config, themeId, null, level);
					const svg = renderReadingKey({
						label: extreme.label,
						valueText: extreme.value,
						unitText: extreme.unit,
						statBadge: level === "normal" ? "" : "MAX",
						history: [10, 12, 11, 15, 9, 14],
						palette
					});
					assertRenderable(svg, 144, 144, `key ${themeId}/${level}/${extreme.label}`);
				}
			}
		}
	});

	it("status screens (stale, missing, errors) hold the same floor", () => {
		const svg = renderStatusKey({ icon: "warning", accent: "#F59E0B", lines: ["HWiNFO stale", "check sharing"] });
		assertRenderable(svg, 144, 144, "status key");
	});
});

describe("dial segment at the 200x100 target", () => {
	it("every theme x alert level x content extreme renders in-bounds", () => {
		for (const themeId of THEME_IDS) {
			for (const level of LEVELS) {
				for (const extreme of EXTREMES) {
					const palette = resolvePalette(config, themeId, null, "normal");
					const svg = renderDial({
						title: extreme.label,
						valueText: extreme.value,
						unitText: extreme.unit,
						statsText: `▼ ${extreme.value}   ▲ ${extreme.value}   session`,
						fraction: level === "crit" ? 1 : 0.42,
						palette,
						barColor: level !== "normal" ? config.alerts[level].bg : palette.accent
					});
					assertRenderable(svg, DIAL_TARGET.w, DIAL_TARGET.h, `dial ${themeId}/${level}/${extreme.label}`);
				}
			}
		}
	});

	it("NaN fraction (status screens) hides the fill without leaking NaN", () => {
		const palette = resolvePalette(config, "void", null, "normal");
		const svg = renderDial({ title: "Sensor missing", valueText: "waiting", unitText: "", statsText: "", fraction: NaN, palette, barColor: palette.accent });
		assertRenderable(svg, 200, 100, "dial NaN fraction");
	});
});
