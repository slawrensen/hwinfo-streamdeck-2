// Physical render targets. Keys ship as one 144x144 logical SVG canvas and
// dials as one 200x100 canvas; the Stream Deck app rasterizes them at each
// device's native key size (72, 80, 96, 112, 120 px are the documented
// families). Vector output scales losslessly, so what this suite locks is
// the part scaling cannot fix: extreme content must stay well-formed, inside
// the canvas, truncated where the spec says, and legible at the smallest
// (0.5x) target on every theme and alert level.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderDial, renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer";
import { formatQuadValue, formatValue, type AlertLevel } from "../src/ui/format";
import { QUAD_DEFAULT_COLORS, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey } from "../src/ui/key-renderer";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const config = loadThemes();
const THEME_IDS = Object.keys(config.themes);
const LEVELS: AlertLevel[] = ["normal", "warn", "crit"];

/** The documented physical key sizes the logical canvas is rasterized to. */
const KEY_TARGETS = [72, 80, 96, 112, 120];
/** Every device's touch strip renders per-encoder segments at exactly this. */
const DIAL_TARGET = { w: 200, h: 100 };

/** Content extremes: long labels, negatives, high RPM, big clocks, tiny values.
 * `raw` keeps the unformatted number for layouts with their own formatter
 * (the quad grid). */
const EXTREMES = [
	{ label: "GPU Hot Spot Temperature Sensor #2", value: formatValue(-273.15, "auto"), unit: "°C", raw: -273.15 },
	{ label: "Chassis Fan #4", value: formatValue(12345, "auto"), unit: "RPM", raw: 12345 },
	{ label: "Core Clock", value: formatValue(5250, "auto"), unit: "MHz", raw: 5250 },
	{ label: "Vcore", value: formatValue(0.012, "auto"), unit: "V", raw: 0.012 },
	{ label: "電力消費量テスト", value: formatValue(1234567, "auto"), unit: "W", raw: 1234567 },
	{ label: "P", value: formatValue(0, "3"), unit: "", raw: 0 },
	// Fixed decimals bypass k-compaction: the widest honest value a counter
	// can produce, and as an overview stats pair it exceeds the whole
	// context line (the impossible-width trim path).
	{ label: "Counter", value: formatValue(1234567890, "3"), unit: "", raw: 1234567890 }
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

	it("dual layout: every theme x alert level x content extreme renders in-bounds", () => {
		for (const themeId of THEME_IDS) {
			for (const level of LEVELS) {
				for (const extreme of EXTREMES) {
					const palette = resolvePalette(config, themeId, null, level);
					// warn exercises the inline per-row badge, crit the shared
					// centered one, normal the badge-free face.
					const svg = renderDualKey({
						top: { label: extreme.label, valueText: extreme.value, unitText: extreme.unit, statBadge: level === "warn" ? "MAX" : "" },
						bottom: { label: extreme.label, valueText: extreme.value, unitText: extreme.unit, statBadge: "" },
						sharedBadge: level === "crit" ? "AVG" : "",
						palette
					});
					assertRenderable(svg, 144, 144, `dual key ${themeId}/${level}/${extreme.label}`);
				}
			}
		}
	});

	it("quad layout: every theme x alert level x content extreme renders in-bounds", () => {
		for (const themeId of THEME_IDS) {
			for (const level of LEVELS) {
				for (const extreme of EXTREMES) {
					const palette = resolvePalette(config, themeId, null, level);
					// normal exercises color-as-identity values, warn the
					// micro-label variant with an empty slot (a three-sensor
					// quad is a supported shape), crit the labeled face plus
					// the shared badge over the cross. On alert the cells
					// carry the alert palette's text token, as the action
					// collapses them.
					const labeled = level !== "normal";
					const cell = {
						label: extreme.label,
						valueText: formatQuadValue(extreme.raw, "auto"),
						unitText: extreme.unit,
						color: level === "normal" ? (QUAD_DEFAULT_COLORS[0] as string) : labeled ? palette.label : palette.value
					};
					const svg = renderQuadKey({
						cells: [cell, cell, cell, level === "warn" ? null : cell],
						labels: labeled,
						sharedBadge: level === "crit" ? "AVG" : "",
						palette
					});
					assertRenderable(svg, 144, 144, `quad key ${themeId}/${level}/${extreme.label}`);
				}
			}
		}
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

	it("two-row view: every theme x alert level x content extreme renders in-bounds", () => {
		const history = [10, 12, 11, 15, 9, 14, 13, 16];
		for (const themeId of THEME_IDS) {
			for (const level of LEVELS) {
				for (const extreme of EXTREMES) {
					const palette = resolvePalette(config, themeId, null, "normal");
					const svg = renderDialTwoRow({
						rows: [0, 1].map((i) => ({
							label: extreme.label,
							valueText: extreme.value,
							unitText: extreme.unit,
							selected: i === 0,
							valueColor: level !== "normal" ? config.alerts[level].bg : palette.value,
							history
						})),
						footerText: `▼ ${extreme.value}  ▲ ${extreme.value}  session`,
						palette
					});
					assertRenderable(svg, DIAL_TARGET.w, DIAL_TARGET.h, `two-row ${themeId}/${level}/${extreme.label}`);
				}
			}
		}
	});

	it("NaN fraction (status screens) hides the fill without leaking NaN", () => {
		const palette = resolvePalette(config, "void", null, "normal");
		const svg = renderDial({ title: "Sensor missing", valueText: "waiting", unitText: "", statsText: "", fraction: NaN, palette, barColor: palette.accent });
		assertRenderable(svg, 200, 100, "dial NaN fraction");
	});

	it("overview: every theme x alert level x content extreme renders in-bounds", () => {
		for (const themeId of THEME_IDS) {
			for (const level of LEVELS) {
				for (const extreme of EXTREMES) {
					const palette = resolvePalette(config, themeId, null, "normal");
					// warn exercises the bottom-mode context line, crit the
					// separator-free face, normal the top default.
					const svg = renderDialOverview({
						rows: [0, 1, 2].map((i) => ({
							label: extreme.label,
							valueText: extreme.value,
							unitText: extreme.unit,
							selected: i === 1,
							valueColor: level !== "normal" ? config.alerts[level].bg : palette.value
						})),
						contextText: extreme.label,
						statsText: `▼${extreme.value} ▲${extreme.value}`,
						header: level === "warn" ? "bottom" : "top",
						separators: level !== "crit",
						palette
					});
					assertRenderable(svg, DIAL_TARGET.w, DIAL_TARGET.h, `overview ${themeId}/${level}/${extreme.label}`);
				}
			}
		}
	});
});
