/**
 * The shared gauge model: bounds resolution (manual, percent, boolean,
 * evidence), threshold expansion, zone construction, degenerate inputs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeGauge, drawnZones, ZONE_BG_BLEND, type GaugeInput } from "../src/ui/gauge";
import { mixToward } from "../src/ui/text-colors";
import { loadThemes } from "../src/ui/themes";

function gauge(input: Partial<GaugeInput> & { value: number }): ReturnType<typeof computeGauge> {
	return computeGauge({ alertBelow: false, ...input });
}

const close = (actual: number, expected: number, message?: string): void => {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""}: ${actual} !== ${expected}`);
};

describe("automatic bounds", () => {
	it("percent readings run 0..100", () => {
		close(gauge({ value: 0, unit: "%" }).fraction, 0, "0%");
		close(gauge({ value: 42, unit: "%", evidence: { min: 10, max: 80 } }).fraction, 0.42, "42%");
		close(gauge({ value: 100, unit: "%" }).fraction, 1, "100%");
	});

	it("boolean yes/no readings run 0..1", () => {
		close(gauge({ value: 0, unit: "" }).fraction, 0, "no");
		close(gauge({ value: 1, unit: "" }).fraction, 1, "yes");
		close(gauge({ value: 1, unit: "", evidence: { min: 0, max: 1 } }).fraction, 1, "yes with evidence");
	});

	it("a unitless reading beyond 0..1 is not a boolean", () => {
		// Evidence outside [0,1] falls through to the observed range.
		close(gauge({ value: 5, unit: "", evidence: { min: 0, max: 10 } }).fraction, 0.5, "unitless analog");
	});

	it("other readings derive from values actually visited", () => {
		close(gauge({ value: 60, evidence: { min: 40, max: 80 } }).fraction, 0.5, "mid");
		close(gauge({ value: 40, evidence: { min: 40, max: 80 } }).fraction, 0, "at min");
		close(gauge({ value: 80, evidence: { min: 40, max: 80 } }).fraction, 1, "at max");
	});

	it("the live value joins the evidence union", () => {
		// value 90 above the evidence max extends the range to it.
		close(gauge({ value: 90, evidence: { min: 40, max: 80 } }).fraction, 1, "live extends");
		close(gauge({ value: 65, evidence: { min: 40, max: 90 } }).fraction, 0.5, "same range");
	});

	it("all-negative ranges normalize correctly", () => {
		close(gauge({ value: -30, evidence: { min: -40, max: -20 } }).fraction, 0.5, "negative mid");
		close(gauge({ value: -40, evidence: { min: -40, max: -20 } }).fraction, 0, "negative min");
	});

	it("clamps outside the domain", () => {
		close(gauge({ value: 150, unit: "%", evidence: { min: 0, max: 100 } }).fraction, 1, "over");
		close(gauge({ value: -5, unit: "%", evidence: { min: 0, max: 100 } }).fraction, 0, "under");
	});
});

describe("manual bounds (the dial's barMin/barMax)", () => {
	it("each manual side wins independently", () => {
		close(gauge({ value: 50, manualMin: 0, manualMax: 100, evidence: { min: 40, max: 60 } }).fraction, 0.5, "both");
		close(gauge({ value: 50, manualMin: 0, evidence: { min: 40, max: 100 } }).fraction, 0.5, "min only");
		close(gauge({ value: 50, manualMax: 100, evidence: { min: 0, max: 60 } }).fraction, 0.5, "max only");
	});

	it("manual bounds never expand for thresholds", () => {
		const g = gauge({ value: 50, manualMin: 0, manualMax: 100, warn: 150, crit: 200 });
		close(g.fraction, 0.5, "fraction");
		assert.deepEqual(g.zones, []); // both thresholds clip out of the domain
	});

	it("reversed or equal manual limits are degenerate: half fill, no zones", () => {
		const reversed = gauge({ value: 50, manualMin: 100, manualMax: 0, warn: 70 });
		close(reversed.fraction, 0.5, "reversed");
		assert.deepEqual(reversed.zones, []);
		const equal = gauge({ value: 50, manualMin: 50, manualMax: 50 });
		close(equal.fraction, 0.5, "equal");
	});
});

describe("degenerate inputs", () => {
	it("one constant sample: half fill, no zones", () => {
		const g = gauge({ value: 50, evidence: { min: 50, max: 50 } });
		close(g.fraction, 0.5, "constant");
		assert.deepEqual(g.zones, []);
	});

	it("constant zero", () => {
		close(gauge({ value: 0, evidence: { min: 0, max: 0 } }).fraction, 0.5, "zero");
	});

	it("non-finite live value: NaN fraction (no fill), zones still drawn", () => {
		const g = gauge({ value: Number.NaN, evidence: { min: 40, max: 80 }, warn: 70 });
		assert.ok(Number.isNaN(g.fraction));
		assert.equal(g.zones.length, 1);
	});

	it("non-finite evidence is ignored", () => {
		close(gauge({ value: 50, evidence: { min: Number.NaN, max: Number.NaN } }).fraction, 0.5, "NaN evidence");
	});

	it("a constant equal to its only threshold stays degenerate", () => {
		const g = gauge({ value: 50, evidence: { min: 50, max: 50 }, warn: 50 });
		close(g.fraction, 0.5, "constant at threshold");
		assert.deepEqual(g.zones, []);
	});
});

describe("threshold zones, high-is-bad", () => {
	it("warn and crit inside the range", () => {
		const g = gauge({ value: 60, evidence: { min: 0, max: 100 }, warn: 70, crit: 90 });
		assert.deepEqual(g.zones, [
			{ from: 0.7, to: 0.9, level: "warn" },
			{ from: 0.9, to: 1, level: "crit" }
		]);
		close(g.fraction, 0.6, "fraction untouched");
	});

	it("warn only / crit only", () => {
		assert.deepEqual(gauge({ value: 50, evidence: { min: 0, max: 100 }, warn: 75 }).zones, [{ from: 0.75, to: 1, level: "warn" }]);
		assert.deepEqual(gauge({ value: 50, evidence: { min: 0, max: 100 }, crit: 75 }).zones, [{ from: 0.75, to: 1, level: "crit" }]);
	});

	it("thresholds entered in reverse order: crit owns its side, warn empties", () => {
		const g = gauge({ value: 50, evidence: { min: 0, max: 100 }, warn: 90, crit: 70 });
		assert.deepEqual(g.zones, [{ from: 0.7, to: 1, level: "crit" }]);
	});

	it("a threshold above the observed range expands it, with visible headroom", () => {
		// Evidence 41..79, warn 80, crit 90: the range grows to the crit edge
		// plus 6% pad, so the red zone renders as a band, not a zero-width line.
		const g = gauge({ value: 60, evidence: { min: 41, max: 79 }, warn: 80, crit: 90 });
		const lo = 41;
		const hi = 90 + (90 - 41) * 0.06;
		close(g.fraction, (60 - lo) / (hi - lo), "fraction over expanded range");
		const critZone = g.zones.find((z) => z.level === "crit");
		assert.ok(critZone !== undefined);
		close(critZone.from, (90 - lo) / (hi - lo), "crit zone at 90");
		close(critZone.to, 1, "crit zone reaches the edge");
		assert.ok(critZone.to - critZone.from > 0.02, "crit zone visibly wide");
	});

	it("temperature conversion keeps value, bounds and zones aligned", () => {
		// The caller converts everything to display units; °F positions match °C.
		const c = gauge({ value: 60, evidence: { min: 40, max: 80 }, warn: 70 });
		const f = gauge({ value: 140, evidence: { min: 104, max: 176 }, warn: 158 });
		close(c.fraction, f.fraction, "fractions match");
		close(c.zones[0]?.from ?? NaN, f.zones[0]?.from ?? NaN, "zones match");
	});
});

describe("threshold zones, alertBelow", () => {
	it("reverses the zones: red at the bottom, amber above it", () => {
		const g = gauge({ value: 1200, evidence: { min: 0, max: 2000 }, warn: 800, crit: 500, alertBelow: true });
		assert.deepEqual(g.zones, [
			{ from: 0.25, to: 0.4, level: "warn" },
			{ from: 0, to: 0.25, level: "crit" }
		]);
	});

	it("warn only covers from the floor", () => {
		assert.deepEqual(gauge({ value: 1200, evidence: { min: 0, max: 2000 }, warn: 800, alertBelow: true }).zones, [{ from: 0, to: 0.4, level: "warn" }]);
	});

	it("a threshold below the observed range expands the floor with headroom", () => {
		const g = gauge({ value: 1200, evidence: { min: 1000, max: 2000 }, crit: 500, alertBelow: true });
		const critZone = g.zones.find((z) => z.level === "crit");
		assert.ok(critZone !== undefined);
		close(critZone.from, 0, "crit zone starts at the edge");
		assert.ok(critZone.to > 0.02, "crit zone visibly wide");
	});
});

describe("drawnZones: zone fills are dimmed shades, never the full alert color", () => {
	const alerts = loadThemes().alerts;

	it("blends each zone's alert color toward the face background", () => {
		const zones = drawnZones(
			[
				{ from: 0.7, to: 0.9, level: "warn" },
				{ from: 0.9, to: 1, level: "crit" }
			],
			alerts,
			"#000000"
		);
		assert.deepEqual(zones, [
			{ from: 0.7, to: 0.9, color: mixToward(alerts.warn.bg, "#000000", ZONE_BG_BLEND) },
			{ from: 0.9, to: 1, color: mixToward(alerts.crit.bg, "#000000", ZONE_BG_BLEND) }
		]);
		// The live fill (full alert bg while alerting) must stay distinguishable:
		// the zone shade is never the fill's own color.
		assert.notEqual(zones[0]?.color, alerts.warn.bg);
		assert.notEqual(zones[1]?.color, alerts.crit.bg);
	});

	it("exact shades on the void background (locked)", () => {
		const zones = drawnZones([{ from: 0, to: 1, level: "crit" }], alerts, "#000000");
		assert.equal(zones[0]?.color, "#70120B");
		assert.equal(drawnZones([{ from: 0, to: 1, level: "warn" }], alerts, "#000000")[0]?.color, "#805107");
	});
});

describe("dial-compat invariants", () => {
	it("no thresholds, evidence bounds: exactly the pre-model fraction", () => {
		// The dial's established math: clamp((live - min) / (max - min)).
		for (const [value, min, max] of [
			[56.3, 41.2, 79],
			[0, -10, 10],
			[99, 0, 99]
		] as const) {
			const expected = Math.max(0, Math.min(1, (value - min) / (max - min)));
			close(gauge({ value, evidence: { min, max } }).fraction, expected, `${value} in ${min}..${max}`);
		}
	});

	it("no thresholds means no zones, whatever the bounds", () => {
		assert.deepEqual(gauge({ value: 50, evidence: { min: 0, max: 100 } }).zones, []);
		assert.deepEqual(gauge({ value: 42, unit: "%" }).zones, []);
	});
});
