// The dial's rotation list and step math. Pure so a curated rotation set,
// the sensor-group fallback, and the wrap arithmetic are provable here
// instead of on hardware.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { activeGroupIndex, autoCycleTarget, groupDisplayName, groupReadings, rotationGroupsOf, rotationReadings, stepGroup, stepReading, stepSensorSource } from "../src/rotation";

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
		assert.equal(autoCycleTarget(list, list, "a:0:1", none, false)?.key, "a:0:2");
	});

	it("alert-aware: never rotates away from a critical member (manual turns still can)", () => {
		assert.equal(autoCycleTarget(list, list, "a:0:1", new Set(["a:0:1"]), true), undefined);
	});

	it("alert-aware: a critical member elsewhere preempts the normal step", () => {
		assert.equal(autoCycleTarget(list, list, "a:0:1", new Set(["b:0:2"]), true)?.key, "b:0:2");
	});

	it("plain cycling ignores alerts: steps in order through and past criticals", () => {
		assert.equal(autoCycleTarget(list, list, "a:0:1", new Set(["a:0:1"]), false)?.key, "a:0:2");
		assert.equal(autoCycleTarget(list, list, "a:0:1", new Set(["b:0:2"]), false)?.key, "a:0:2");
	});

	it("alert-aware: the hunt spans the wider alert list, so an alert in another group interrupts", () => {
		// Step list is sensor a's readings only; the critical sits in sensor b.
		const stepList = rotationReadings(undefined, "a:0:1", snap);
		assert.equal(autoCycleTarget(stepList, list, "a:0:1", new Set(["b:0:2"]), true)?.key, "b:0:2");
		// Without alert awareness the wider list plays no part.
		assert.equal(autoCycleTarget(stepList, list, "a:0:1", new Set(["b:0:2"]), false)?.key, "a:0:2");
	});
});

describe("rotationGroupsOf", () => {
	it("parses well-formed groups, trimming names and deduplicating keys", () => {
		const groups = rotationGroupsOf([
			{ name: " CPU ", keys: ["a:0:1", "a:0:2", "a:0:1"] },
			{ keys: ["b:0:1"] }
		]);
		assert.deepEqual(groups, [
			{ name: "CPU", keys: ["a:0:1", "a:0:2"], ordinal: 1 },
			{ name: "", keys: ["b:0:1"], ordinal: 2 }
		]);
	});

	it("drops malformed entries and keys (settings are untyped JSON)", () => {
		const groups = rotationGroupsOf([
			"nope",
			42,
			null,
			["a:0:1"],
			{ name: "no keys" },
			{ name: "empty", keys: [] },
			{ name: "junk keys", keys: [7, "", null, "   "] },
			{ name: "A", keys: ["a:0:1", 7, ""] },
			{ name: 9, keys: ["b:0:1"] }
		]);
		// Ordinals number the OBJECT entries (the rows the PI would render),
		// so the "group N" fallback matches the panel even after junk rows.
		assert.deepEqual(groups, [
			{ name: "A", keys: ["a:0:1"], ordinal: 4 },
			{ name: "", keys: ["b:0:1"], ordinal: 5 }
		]);
	});

	it("a key belongs to its first group only (cross-group duplicates are dropped)", () => {
		// The active group is derived from the current reading; if two groups
		// shared a key, a jump landing on it would re-resolve the earlier
		// group and the target could never stay active. First group wins.
		const groups = rotationGroupsOf([
			{ name: "One", keys: ["shared:0:1", "a:0:1"] },
			{ name: "Two", keys: ["shared:0:1", "b:0:1"] }
		]);
		assert.deepEqual(groups, [
			{ name: "One", keys: ["shared:0:1", "a:0:1"], ordinal: 1 },
			{ name: "Two", keys: ["b:0:1"], ordinal: 2 }
		]);
	});

	it("a group left empty by cross-group deduplication is dropped entirely", () => {
		assert.equal(rotationGroupsOf([{ keys: ["a:0:1"] }, { keys: ["a:0:1"] }]), undefined);
		const groups = rotationGroupsOf([
			{ name: "A", keys: ["a:0:1"] },
			{ name: "copy of A", keys: ["a:0:1"] },
			{ name: "B", keys: ["b:0:1"] }
		]);
		assert.deepEqual(groups, [
			{ name: "A", keys: ["a:0:1"], ordinal: 1 },
			{ name: "B", keys: ["b:0:1"], ordinal: 3 }
		]);
	});

	it("fewer than two usable groups means no groups (the flat set keeps driving)", () => {
		assert.equal(rotationGroupsOf(undefined), undefined);
		assert.equal(rotationGroupsOf("nope"), undefined);
		assert.equal(rotationGroupsOf([]), undefined);
		assert.equal(rotationGroupsOf([{ name: "only", keys: ["a:0:1"] }]), undefined);
		assert.equal(rotationGroupsOf([{ keys: ["a:0:1"] }, { keys: [] }]), undefined);
	});

	it("never mutates the raw settings value (deep-frozen input parses fine)", () => {
		const raw = Object.freeze([
			Object.freeze({ name: " CPU ", keys: Object.freeze(["a:0:1", "a:0:1", "b:0:1"]) }),
			Object.freeze({ name: 7, keys: Object.freeze(["b:0:1", "b:0:2"]) })
		]);
		const groups = rotationGroupsOf(raw);
		assert.deepEqual(groups, [
			{ name: "CPU", keys: ["a:0:1", "b:0:1"], ordinal: 1 },
			{ name: "", keys: ["b:0:2"], ordinal: 2 }
		]);
		assert.deepEqual(raw[0], { name: " CPU ", keys: ["a:0:1", "a:0:1", "b:0:1"] });
	});
});

describe("rotation groups", () => {
	const groups = rotationGroupsOf([
		{ name: "CPU", keys: ["a:0:1", "a:0:2"] },
		{ name: "", keys: ["b:0:1", "b:0:2"] },
		{ name: "Gone", keys: ["gone:0:1"] }
	]);
	assert.notEqual(groups, undefined);
	if (groups === undefined) {
		throw new Error("unreachable");
	}

	it("activeGroupIndex is unambiguous: every key has exactly one owning group", () => {
		assert.equal(activeGroupIndex(groups, "a:0:2"), 0);
		assert.equal(activeGroupIndex(groups, "b:0:2"), 1);
		assert.equal(activeGroupIndex(groups, "stray:0:1"), -1);
		assert.equal(activeGroupIndex(groups, undefined), -1);
		// A duplicated key is owned by its first group; the later occurrence
		// is not in the projection, so no key can resolve two groups.
		const deduped = rotationGroupsOf([
			{ keys: ["a:0:1", "shared:0:1"] },
			{ keys: ["shared:0:1", "b:0:1"] }
		]);
		assert.equal(activeGroupIndex(deduped ?? [], "shared:0:1"), 0);
		assert.equal(activeGroupIndex(deduped ?? [], "b:0:1"), 1);
	});

	it("groupDisplayName uses the typed name, else the group's PI row number", () => {
		assert.equal(groupDisplayName(groups, 0), "CPU");
		assert.equal(groupDisplayName(groups, 1), "group 2");
		// A draft row the projection skipped (empty keys) still counts for
		// the fallback number, so the overlay matches the panel's "Group N"
		// placeholders.
		const withDraft = rotationGroupsOf([
			{ name: "CPU", keys: ["a:0:1"] },
			{ keys: [] },
			{ keys: ["b:0:1"] }
		]);
		assert.equal(groupDisplayName(withDraft ?? [], 1), "group 3");
	});

	it("groupReadings lists the active group's present members, in picked order", () => {
		assert.deepEqual(groupReadings(groups, "b:0:2", snap).map((r) => r.key), ["b:0:1", "b:0:2"]);
	});

	it("groupReadings enters at group 0 when the current reading is in no group", () => {
		assert.deepEqual(groupReadings(groups, "stray:0:1", snap).map((r) => r.key), ["a:0:1", "a:0:2"]);
		assert.deepEqual(groupReadings(groups, undefined, snap).map((r) => r.key), ["a:0:1", "a:0:2"]);
	});

	it("stepGroup lands on the target group's first present member, wrapping", () => {
		assert.equal(stepGroup(groups, "a:0:2", 1, snap)?.key, "b:0:1");
		assert.equal(stepGroup(groups, "b:0:1", -1, snap)?.key, "a:0:1");
	});

	it("stepGroup skips groups with no present members (sensor asleep)", () => {
		// Group 3's only member is absent from the snapshot: +1 from group 2
		// must wrap straight back to group 1, in both directions.
		assert.equal(stepGroup(groups, "b:0:2", 1, snap)?.key, "a:0:1");
		assert.equal(stepGroup(groups, "a:0:1", -1, snap)?.key, "b:0:1");
	});

	it("stepGroup handles coalesced multi-tick spins via wrap arithmetic", () => {
		assert.equal(stepGroup(groups, "a:0:1", 2, snap)?.key, "a:0:1");
		assert.equal(stepGroup(groups, "a:0:1", -3, snap)?.key, "b:0:1");
	});

	it("stepGroup enters at the first present group when the current reading is in none", () => {
		assert.equal(stepGroup(groups, "stray:0:1", 1, snap)?.key, "a:0:1");
		assert.equal(stepGroup(groups, undefined, 1, snap)?.key, "a:0:1");
	});

	it("stepGroup with fewer than two present groups has nowhere to jump", () => {
		const lone = rotationGroupsOf([
			{ name: "here", keys: ["a:0:1"] },
			{ name: "gone", keys: ["gone:0:1"] }
		]);
		assert.equal(stepGroup(lone ?? [], "a:0:1", 1, snap), undefined);
		assert.equal(stepGroup(lone ?? [], "gone:0:1", 1, snap)?.key, "a:0:1"); // absent current: enter
		assert.equal(stepGroup([], "a:0:1", 1, snap), undefined);
	});

	it("a jump always lands in a reading OWNED by the target group (no ping-pong)", () => {
		// Regression: before cross-group deduplication, group 2 starting with
		// a key group 1 also held made every jump into group 2 resolve group 1
		// again, so group 2 could never stay active. The projection guarantees
		// the landing key's owner IS the target.
		const dup = rotationGroupsOf([
			{ name: "One", keys: ["a:0:1", "a:0:2"] },
			{ name: "Two", keys: ["a:0:1", "b:0:1"] }
		]);
		assert.notEqual(dup, undefined);
		const landed = stepGroup(dup ?? [], "a:0:1", 1, snap);
		assert.equal(landed?.key, "b:0:1");
		assert.equal(activeGroupIndex(dup ?? [], landed?.key ?? ""), 1);
		// And plain stepping from there stays inside the landing group.
		assert.deepEqual(groupReadings(dup ?? [], landed?.key, snap).map((r) => r.key), ["b:0:1"]);
	});

	it("an active group with no present members steps nowhere, safely", () => {
		// Current reading saved from a sensor that vanished along with the
		// rest of its group: the plain-step list is empty, never a throw.
		const parsed = rotationGroupsOf([
			{ name: "asleep", keys: ["gone:0:1", "gone:0:2"] },
			{ name: "awake", keys: ["a:0:1"] }
		]);
		assert.deepEqual(groupReadings(parsed ?? [], "gone:0:1", snap), []);
		assert.equal(stepReading(groupReadings(parsed ?? [], "gone:0:1", snap), "gone:0:1", 1), undefined);
		// The jump can still leave: only one group has present members and
		// the current reading is outside all PRESENT groups, so it enters it.
		assert.equal(stepGroup(parsed ?? [], "gone:0:1", 1, snap)?.key, "a:0:1");
	});

	it("grouped autocycle: steps inside the active group, alerts pull across groups", () => {
		// Composes the pieces the way sensor-dial's autoCycle() does: the step
		// list is the active group's readings, the alert hunt runs over the
		// union of every group.
		const parsed = rotationGroupsOf([
			{ name: "CPU", keys: ["a:0:1", "a:0:2"] },
			{ name: "GPU", keys: ["b:0:1", "b:0:2"] }
		]);
		assert.notEqual(parsed, undefined);
		const grouped = parsed ?? [];
		const list = groupReadings(grouped, "a:0:1", snap);
		const union = grouped.flatMap((g) => g.keys).map((k) => snap.byKey.get(k)).filter((r): r is Reading => r !== undefined);
		// No alert: the cycle wraps inside group CPU.
		assert.equal(autoCycleTarget(list, union, "a:0:1", new Set(), true)?.key, "a:0:2");
		assert.equal(autoCycleTarget(list, union, "a:0:2", new Set(), true)?.key, "a:0:1");
		// A critical member of group GPU interrupts across the boundary, and
		// the landing reading's group becomes the active one.
		const pulled = autoCycleTarget(list, union, "a:0:1", new Set(["b:0:2"]), true);
		assert.equal(pulled?.key, "b:0:2");
		assert.equal(activeGroupIndex(grouped, pulled?.key ?? ""), 1);
		// After the alert clears, the cycle continues inside the new group.
		assert.equal(autoCycleTarget(groupReadings(grouped, "b:0:2", snap), union, "b:0:2", new Set(), true)?.key, "b:0:1");
	});
});
