// Control presets: settings in, scheme out. The legacy mapping IS the
// backward-compatibility contract: settings without a preset field (every
// pre-preset install) must resolve to the exact 1.1.x behavior.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseResetScope, resolveControls, triggerDescriptions } from "../src/controls";

describe("resolveControls", () => {
	it("settings with no preset field migrate to legacy (the 1.1.x contract)", () => {
		const scheme = resolveControls({});
		assert.equal(scheme.preset, "legacy");
		assert.equal(scheme.pushTiming, "down"); // push fires on dial DOWN, untimed
		assert.equal(scheme.rotate, "step");
		assert.equal(scheme.pressedRotate, "step"); // pressed or not, rotation stepped
		assert.equal(scheme.shortPress, "resetStats");
		assert.equal(scheme.touchZones, "off");
		assert.equal(scheme.tap, "cycleStat");
		assert.equal(scheme.touchHold, "backToCurrent");
	});

	it("an unknown preset value also lands on legacy", () => {
		assert.equal(resolveControls({ controlPreset: "turbo" }).preset, "legacy");
		assert.equal(resolveControls({ controlPreset: "" }).preset, "legacy");
	});

	it("legacy ignores touch zones and custom assignments entirely", () => {
		const scheme = resolveControls({ controlPreset: "legacy", touchZones: "three", gestureRotate: "cycleStat" });
		assert.equal(scheme.touchZones, "off");
		assert.equal(scheme.rotate, "step");
	});

	it("elite: pressed rotation switches sensors, presses are timed", () => {
		const scheme = resolveControls({ controlPreset: "elite" });
		assert.equal(scheme.pushTiming, "release");
		assert.equal(scheme.rotate, "step");
		assert.equal(scheme.pressedRotate, "stepGroup");
		assert.equal(scheme.shortPress, "pauseResume");
		assert.equal(scheme.longPress, "resetStats");
		assert.equal(scheme.touchZones, "off"); // zones are opt-in even on elite
		assert.equal(scheme.touchHold, "backToCurrent");
	});

	it("elite honors the touch-zone setting", () => {
		assert.equal(resolveControls({ controlPreset: "elite", touchZones: "three" }).touchZones, "three");
		assert.equal(resolveControls({ controlPreset: "elite", touchZones: "two" }).touchZones, "two");
		assert.equal(resolveControls({ controlPreset: "elite", touchZones: "nonsense" }).touchZones, "off");
	});

	it("custom: unset gestures fall back to their legacy command", () => {
		const scheme = resolveControls({ controlPreset: "custom" });
		assert.equal(scheme.pushTiming, "release");
		assert.equal(scheme.rotate, "step");
		assert.equal(scheme.shortPress, "resetStats");
		assert.equal(scheme.tap, "cycleStat");
	});

	it("custom: explicit assignments win, malformed ones fall back", () => {
		const scheme = resolveControls({
			controlPreset: "custom",
			gestureRotate: "cycleStat",
			gestureShortPress: "pin",
			gestureLongPress: "not-a-command",
			gestureTouchHold: "none"
		});
		assert.equal(scheme.rotate, "cycleStat");
		assert.equal(scheme.shortPress, "pin");
		assert.equal(scheme.longPress, "resetStats"); // fallback
		assert.equal(scheme.touchHold, "none");
	});
});

describe("parseResetScope", () => {
	it("defaults to the non-destructive current scope", () => {
		assert.equal(parseResetScope(undefined), "current");
		assert.equal(parseResetScope("everything"), "current");
		assert.equal(parseResetScope("set"), "set");
		assert.equal(parseResetScope("all"), "all");
	});
});

describe("triggerDescriptions", () => {
	it("describes the elite mapping including the pressed-rotate hint", () => {
		const texts = triggerDescriptions(resolveControls({ controlPreset: "elite" }));
		assert.match(texts.rotate ?? "", /Cycle readings/);
		assert.match(texts.rotate ?? "", /pressed: sensor/);
		assert.match(texts.push ?? "", /Pause\/resume/);
		assert.match(texts.push ?? "", /hold: reset stats/);
		assert.equal(texts.longTouch, "Back to current");
	});

	it("describes touch zones when enabled", () => {
		const texts = triggerDescriptions(resolveControls({ controlPreset: "elite", touchZones: "three" }));
		assert.match(texts.touch ?? "", /Left\/right/);
		assert.match(texts.touch ?? "", /center: stat mode/);
	});

	it("hides hints for gestures assigned to none", () => {
		const texts = triggerDescriptions(resolveControls({ controlPreset: "custom", gestureTap: "none", gestureTouchHold: "none" }));
		assert.equal(texts.touch, undefined);
		assert.equal(texts.longTouch, undefined);
	});
});
