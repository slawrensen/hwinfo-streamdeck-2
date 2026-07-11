// The gesture state machine. Pure, so press timing, pressed-rotation
// suppression and tap-zone boundaries are provable to the millisecond and
// pixel here instead of on hardware.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DIAL_LONG_PRESS_MS, IDLE_GESTURE, routeGesture, tapZoneOf, type GestureInput, type GestureState } from "../src/gestures";

/** Runs a sequence from idle; returns every emitted gesture and the end state. */
function run(inputs: GestureInput[], zones: "off" | "two" | "three" = "off"): { gestures: string[]; state: GestureState } {
	let state = IDLE_GESTURE;
	const gestures: string[] = [];
	for (const input of inputs) {
		const routed = routeGesture(state, input, zones);
		state = routed.state;
		if (routed.gesture !== null) {
			const g = routed.gesture;
			gestures.push(g.kind + ("ticks" in g ? `:${g.ticks}` : "") + ("zone" in g ? `:${g.zone}` : ""));
		}
	}
	return { gestures, state };
}

describe("dial press classification", () => {
	it("classifies short and long deterministically around the threshold", () => {
		const press = (ms: number): string[] => run([{ kind: "dialDown", at: 1000 }, { kind: "dialUp", at: 1000 + ms }]).gestures;
		assert.deepEqual(press(DIAL_LONG_PRESS_MS - 1), ["shortPress"]);
		assert.deepEqual(press(DIAL_LONG_PRESS_MS), ["longPress"]);
		assert.deepEqual(press(DIAL_LONG_PRESS_MS + 1), ["longPress"]);
	});

	it("one press is exactly one gesture (down emits nothing)", () => {
		const { gestures } = run([
			{ kind: "dialDown", at: 0 },
			{ kind: "dialUp", at: 100 }
		]);
		assert.equal(gestures.length, 1);
	});

	it("a duplicate dialDown keeps the original press start", () => {
		const { gestures } = run([
			{ kind: "dialDown", at: 0 },
			{ kind: "dialDown", at: 400 },
			{ kind: "dialUp", at: DIAL_LONG_PRESS_MS }
		]);
		assert.deepEqual(gestures, ["longPress"]);
	});

	it("a release without a tracked press is a no-op", () => {
		assert.deepEqual(run([{ kind: "dialUp", at: 50 }]).gestures, []);
	});

	it("detach drops a half-tracked press", () => {
		const { gestures } = run([{ kind: "dialDown", at: 0 }, { kind: "detach" }, { kind: "dialUp", at: 100 }]);
		assert.deepEqual(gestures, []);
	});
});

describe("rotation routing", () => {
	it("routes unpressed rotation as rotate with its ticks", () => {
		assert.deepEqual(run([{ kind: "dialRotate", at: 0, ticks: 3, pressed: false }]).gestures, ["rotate:3"]);
		assert.deepEqual(run([{ kind: "dialRotate", at: 0, ticks: -2, pressed: false }]).gestures, ["rotate:-2"]);
	});

	it("routes rotation with the SDK pressed flag as pressedRotate", () => {
		assert.deepEqual(run([{ kind: "dialRotate", at: 0, ticks: 1, pressed: true }]).gestures, ["pressedRotate:1"]);
	});

	it("routes rotation during a tracked press as pressedRotate even without the flag", () => {
		const { gestures } = run([
			{ kind: "dialDown", at: 0 },
			{ kind: "dialRotate", at: 50, ticks: 1, pressed: false }
		]);
		assert.deepEqual(gestures, ["pressedRotate:1"]);
	});

	it("pressed rotation consumes the press: no command on release, ever", () => {
		for (const upAt of [100, DIAL_LONG_PRESS_MS + 100]) {
			const { gestures } = run([
				{ kind: "dialDown", at: 0 },
				{ kind: "dialRotate", at: 50, ticks: 1, pressed: true },
				{ kind: "dialUp", at: upAt }
			]);
			assert.deepEqual(gestures, ["pressedRotate:1"], `release at ${upAt}`);
		}
	});

	it("rapid alternating events keep the machine consistent", () => {
		const { gestures, state } = run([
			{ kind: "dialRotate", at: 0, ticks: 1, pressed: false },
			{ kind: "dialRotate", at: 5, ticks: 1, pressed: false },
			{ kind: "dialDown", at: 10 },
			{ kind: "dialRotate", at: 15, ticks: -1, pressed: true },
			{ kind: "dialUp", at: 20 },
			{ kind: "dialRotate", at: 25, ticks: 2, pressed: false }
		]);
		assert.deepEqual(gestures, ["rotate:1", "rotate:1", "pressedRotate:-1", "rotate:2"]);
		assert.equal(state.downAt, null);
	});
});

describe("touch routing", () => {
	it("hold and tap are mutually exclusive", () => {
		assert.deepEqual(run([{ kind: "touchTap", at: 0, hold: true, x: 100, canvasWidth: 200 }]).gestures, ["touchHold"]);
		assert.deepEqual(run([{ kind: "touchTap", at: 0, hold: false, x: 100, canvasWidth: 200 }]).gestures, ["tap:center"]);
	});

	it("a touch never disturbs a concurrent press gesture", () => {
		const { gestures } = run([
			{ kind: "dialDown", at: 0 },
			{ kind: "touchTap", at: 10, hold: false, x: 10, canvasWidth: 200 },
			{ kind: "dialUp", at: 100 }
		]);
		assert.deepEqual(gestures, ["tap:center", "shortPress"]);
	});
});

describe("tapZoneOf", () => {
	it("off mode collapses everything to center", () => {
		assert.equal(tapZoneOf(0, 200, "off"), "center");
		assert.equal(tapZoneOf(199, 200, "off"), "center");
	});

	it("two zones split at the midpoint; the boundary lands right", () => {
		assert.equal(tapZoneOf(0, 200, "two"), "left");
		assert.equal(tapZoneOf(99.999, 200, "two"), "left");
		assert.equal(tapZoneOf(100, 200, "two"), "right");
		assert.equal(tapZoneOf(200, 200, "two"), "right");
	});

	it("three zones split at thirds; each boundary lands in the later zone", () => {
		const third = 200 / 3;
		assert.equal(tapZoneOf(0, 200, "three"), "left");
		assert.equal(tapZoneOf(third - 0.001, 200, "three"), "left");
		assert.equal(tapZoneOf(third, 200, "three"), "center");
		assert.equal(tapZoneOf(2 * third - 0.001, 200, "three"), "center");
		assert.equal(tapZoneOf(2 * third, 200, "three"), "right");
		assert.equal(tapZoneOf(200, 200, "three"), "right");
	});

	it("degrades to center for a zero-width canvas", () => {
		assert.equal(tapZoneOf(50, 0, "three"), "center");
	});
});
