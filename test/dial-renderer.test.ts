/**
 * Dial (200×100) geometry per the locked spec: title 18/600 x12 y24, value
 * 34/700 x12 y58 with inline 17/600 unit, stats 12/600 y78, bar x12 y84
 * 176×6 r3 with track under fill.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderDial, type DialRenderOptions } from "../src/ui/dial-renderer";
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
