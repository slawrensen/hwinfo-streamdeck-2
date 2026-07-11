// The dial's rotation list and step math. Pure so a curated rotation set,
// the sensor-group fallback, and the wrap arithmetic are provable here
// instead of on hardware.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { autoCycleTarget, rotationReadings, stepReading, stepSensorSource } from "../src/rotation";

function reading(key: string, sensorIndex: number): Reading {
	return { key, type: 1, sensorIndex, id: 0, label: key, unit: "°C", value: 50, valueMin: 40, valueMax: 60, valueAvg: 50 };
}

function snapshot(readings: Reading[]): SensorSnapshot {
	return { pollTime: 0, version: 1, revision: 1, sensors: [], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

const snap = snapshot([reading("a:0:1", 0), reading("a:0:2", 0), reading("b:0:1", 1), reading("b:0:2", 1)]);

describe("rotationReadings", () => {
	it("a rotation set wins, in picked order", () => {
		const list = rotationReadings(["b:0:2", "a:0:1"], "a:0:1", snap);
		assert.deepEqual(list.map((r) => r.key), ["b:0:2", "a:0:1"]);
	});

	it("skips set entries the snapshot does not publish", () => {
		const list = rotationReadings(["gone:0:1", "b:0:1"], undefined, snap);
		assert.deepEqual(list.map((r) => r.key), ["b:0:1"]);
	});

	it("without a set, cycles the current reading's sensor group", () => {
		const list = rotationReadings(undefined, "b:0:1", snap);
		assert.deepEqual(list.map((r) => r.key), ["b:0:1", "b:0:2"]);
	});

	it("an empty set behaves like no set", () => {
		const list = rotationReadings([], "a:0:2", snap);
		assert.deepEqual(list.map((r) => r.key), ["a:0:1", "a:0:2"]);
	});

	it("a malformed set (settings are untyped JSON) degrades to no set", () => {
		// A string has a truthy .length too; it must not reach .map and throw.
		const list = rotationReadings("nope" as unknown as string[], "a:0:2", snap);
		assert.deepEqual(list.map((r) => r.key), ["a:0:1", "a:0:2"]);
	});

	it("with nothing picked yet, offers the whole snapshot", () => {
		assert.equal(rotationReadings(undefined, undefined, snap).length, 4);
		assert.equal(rotationReadings(undefined, "", snap).length, 4);
	});
});

describe("stepReading", () => {
	const list = rotationReadings(undefined, "a:0:1", snap); // a:0:1, a:0:2

	it("steps forward and wraps at the end", () => {
		assert.equal(stepReading(list, "a:0:1", 1)?.key, "a:0:2");
		assert.equal(stepReading(list, "a:0:2", 1)?.key, "a:0:1");
	});

	it("steps backward and wraps at the start", () => {
		assert.equal(stepReading(list, "a:0:1", -1)?.key, "a:0:2");
		// Three entries so -1 and +1 land on different readings: a two-entry
		// list cannot tell a direction bug from a wrap.
		const three = [reading("d:0:1", 3), reading("d:0:2", 3), reading("d:0:3", 3)];
		assert.equal(stepReading(three, "d:0:1", -1)?.key, "d:0:3");
		assert.equal(stepReading(three, "d:0:1", 1)?.key, "d:0:2");
		assert.equal(stepReading(three, "d:0:2", -1)?.key, "d:0:1");
	});

	it("handles multi-tick jumps in one event", () => {
		assert.equal(stepReading(list, "a:0:1", 5)?.key, "a:0:2");
		assert.equal(stepReading(list, "a:0:1", -4)?.key, "a:0:1");
	});

	it("enters at the first entry when the current key is not in the list", () => {
		assert.equal(stepReading(list, "b:0:1", 1)?.key, "a:0:1");
		assert.equal(stepReading(list, undefined, 1)?.key, "a:0:1");
	});

	it("returns undefined for an empty list", () => {
		assert.equal(stepReading([], "a:0:1", 1), undefined);
	});
});

describe("stepSensorSource", () => {
	const list = snap.readings; // a:0:1 a:0:2 (sensor 0) b:0:1 b:0:2 (sensor 1)

	it("jumps to the first reading of the next sensor, wrapping", () => {
		assert.equal(stepSensorSource(list, "a:0:1", 1)?.key, "b:0:1");
		assert.equal(stepSensorSource(list, "a:0:2", 1)?.key, "b:0:1");
		assert.equal(stepSensorSource(list, "b:0:2", 1)?.key, "a:0:1");
	});

	it("jumps backwards too", () => {
		assert.equal(stepSensorSource(list, "a:0:1", -1)?.key, "b:0:1");
		// Three sensors so -1 and +1 land on different sources (see above).
		const three = [reading("a:0:1", 0), reading("b:0:1", 1), reading("c:0:1", 2)];
		assert.equal(stepSensorSource(three, "a:0:1", -1)?.key, "c:0:1");
		assert.equal(stepSensorSource(three, "a:0:1", 1)?.key, "b:0:1");
	});

	it("with a single sensor there is nowhere to jump", () => {
		const single = rotationReadings(undefined, "a:0:1", snap);
		assert.equal(stepSensorSource(single, "a:0:1", 1), undefined);
	});

	it("enters at the first entry when the current key is not in the list", () => {
		assert.equal(stepSensorSource(list, "gone:0:1", 1)?.key, "a:0:1");
		assert.equal(stepSensorSource(list, undefined, 1)?.key, "a:0:1");
	});

	it("returns undefined for an empty list", () => {
		assert.equal(stepSensorSource([], "a:0:1", 1), undefined);
	});
});

describe("autoCycleTarget", () => {
	const list = snap.readings;
	const none: ReadonlySet<string> = new Set();

	it("normally steps to the next member", () => {
		assert.equal(autoCycleTarget(list, "a:0:1", none, false)?.key, "a:0:2");
	});

	it("alert-aware: never rotates away from a critical member (manual turns still can)", () => {
		assert.equal(autoCycleTarget(list, "a:0:1", new Set(["a:0:1"]), true), undefined);
	});

	it("alert-aware: a critical member elsewhere preempts the normal step", () => {
		assert.equal(autoCycleTarget(list, "a:0:1", new Set(["b:0:2"]), true)?.key, "b:0:2");
	});

	it("plain cycling ignores alerts: steps in order through and past criticals", () => {
		assert.equal(autoCycleTarget(list, "a:0:1", new Set(["a:0:1"]), false)?.key, "a:0:2");
		assert.equal(autoCycleTarget(list, "a:0:1", new Set(["b:0:2"]), false)?.key, "a:0:2");
	});
});
