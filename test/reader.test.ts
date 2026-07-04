/**
 * Shared-memory decoder tests against synthetic buffers — no FFI, no HWiNFO.
 * Covers both real-world layouts (classic 264/316 and the HWiNFO ≥7.x UTF-8
 * 392/460 strides), label/unit selection rules, duplicate-key suffixing, the
 * SnapshotParser fast path vs rebuild invalidation, and malformed-input
 * rejection.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENTRY, ENTRY_CLASSIC_SIZE, ENTRY_UTF8_SIZE, HEADER, HEADER_SIZE, MAGIC_ACTIVE, SENSOR, SENSOR_CLASSIC_SIZE, SENSOR_UTF8_SIZE } from "../src/hwinfo/layout";
import { parseSnapshot, SnapshotParser } from "../src/hwinfo/reader";
import { HwinfoError, SensorType } from "../src/hwinfo/types";

interface FakeSensor {
	id: number;
	instance: number;
	orig: string;
	user?: string;
	utf8?: string;
}

interface FakeEntry {
	type: number;
	sensorIndex: number;
	id: number;
	orig: string;
	user?: string;
	utf8?: string;
	unit: string;
	unitUtf8?: string;
	value: number;
	min?: number;
	max?: number;
	avg?: number;
}

interface ComposeOptions {
	utf8?: boolean;
	revision?: number;
	pollTime?: number;
}

/** Builds a complete synthetic mapping in either stride layout. */
function compose(sensors: FakeSensor[], entries: FakeEntry[], opts: ComposeOptions = {}): Buffer {
	const utf8 = opts.utf8 === true;
	const sensorSize = utf8 ? SENSOR_UTF8_SIZE : SENSOR_CLASSIC_SIZE;
	const entrySize = utf8 ? ENTRY_UTF8_SIZE : ENTRY_CLASSIC_SIZE;
	const sensorOff = HEADER_SIZE;
	const entryOff = sensorOff + sensors.length * sensorSize;
	const buf = Buffer.alloc(entryOff + entries.length * entrySize);

	buf.writeUInt32LE(MAGIC_ACTIVE, HEADER.magic);
	buf.writeUInt32LE(1, HEADER.version);
	buf.writeUInt32LE(opts.revision ?? 2, HEADER.revision);
	buf.writeBigInt64LE(BigInt(opts.pollTime ?? 1_751_600_000), HEADER.pollTime);
	buf.writeUInt32LE(sensorOff, HEADER.sensorSectionOffset);
	buf.writeUInt32LE(sensorSize, HEADER.sensorElementSize);
	buf.writeUInt32LE(sensors.length, HEADER.sensorElementCount);
	buf.writeUInt32LE(entryOff, HEADER.entrySectionOffset);
	buf.writeUInt32LE(entrySize, HEADER.entryElementSize);
	buf.writeUInt32LE(entries.length, HEADER.entryElementCount);

	const cstr = (text: string, offset: number, width: number, enc: "latin1" | "utf8"): void => {
		buf.fill(0, offset, offset + width);
		buf.write(text, offset, width - 1, enc);
	};

	sensors.forEach((s, i) => {
		const o = sensorOff + i * sensorSize;
		buf.writeUInt32LE(s.id, o + SENSOR.id);
		buf.writeUInt32LE(s.instance, o + SENSOR.instance);
		cstr(s.orig, o + SENSOR.labelOrig, 128, "latin1");
		cstr(s.user ?? s.orig, o + SENSOR.labelUser, 128, "latin1");
		if (utf8) {
			cstr(s.utf8 ?? "", o + SENSOR.labelUtf8, 128, "utf8");
		}
	});

	entries.forEach((e, i) => {
		const o = entryOff + i * entrySize;
		buf.writeUInt32LE(e.type, o + ENTRY.type);
		buf.writeUInt32LE(e.sensorIndex, o + ENTRY.sensorIndex);
		buf.writeUInt32LE(e.id, o + ENTRY.id);
		cstr(e.orig, o + ENTRY.labelOrig, 128, "latin1");
		cstr(e.user ?? e.orig, o + ENTRY.labelUser, 128, "latin1");
		cstr(e.unit, o + ENTRY.unit, 16, "latin1");
		buf.writeDoubleLE(e.value, o + ENTRY.value);
		buf.writeDoubleLE(e.min ?? e.value, o + ENTRY.valueMin);
		buf.writeDoubleLE(e.max ?? e.value, o + ENTRY.valueMax);
		buf.writeDoubleLE(e.avg ?? e.value, o + ENTRY.valueAvg);
		if (utf8) {
			cstr(e.utf8 ?? "", o + ENTRY.labelUtf8, 128, "utf8");
			cstr(e.unitUtf8 ?? "", o + ENTRY.unitUtf8, 16, "utf8");
		}
	});
	return buf;
}

const CPU: FakeSensor = { id: 0xf0000501, instance: 0, orig: "CPU [#0]: Ryzen" };
const TEMP: FakeEntry = { type: SensorType.Temperature, sensorIndex: 0, id: 0x1000000, orig: "Tctl/Tdie", unit: "°C", value: 55.5, min: 40, max: 90, avg: 60 };

describe("parseSnapshot — classic 264/316 layout", () => {
	it("decodes sensors, readings, keys and stats", () => {
		const snap = parseSnapshot(compose([CPU], [TEMP]));
		assert.equal(snap.sensors.length, 1);
		assert.equal(snap.sensors[0]?.name, "CPU [#0]: Ryzen");
		const r = snap.readings[0];
		assert.ok(r);
		assert.equal(r.key, "f0000501:0:1000000");
		assert.equal(r.label, "Tctl/Tdie");
		assert.equal(r.unit, "°C".normalize());
		assert.equal(r.type, SensorType.Temperature);
		assert.deepEqual([r.value, r.valueMin, r.valueMax, r.valueAvg], [55.5, 40, 90, 60]);
		assert.equal(snap.byKey.get(r.key), r);
	});

	it("user rename wins over the original label", () => {
		const snap = parseSnapshot(compose([CPU], [{ ...TEMP, user: "My Temp" }]));
		assert.equal(snap.readings[0]?.label, "My Temp");
	});

	it("suffixes duplicate identities with ~n in order", () => {
		const snap = parseSnapshot(compose([CPU], [TEMP, { ...TEMP, value: 1 }, { ...TEMP, value: 2 }]));
		assert.deepEqual(
			snap.readings.map((r) => r.key),
			["f0000501:0:1000000", "f0000501:0:1000000~1", "f0000501:0:1000000~2"]
		);
		assert.equal(snap.byKey.get("f0000501:0:1000000~2")?.value, 2);
	});

	it("orphan sensorIndex readings survive with a ?-key and sensorIndex -1", () => {
		const snap = parseSnapshot(compose([CPU], [{ ...TEMP, sensorIndex: 7 }]));
		assert.equal(snap.readings[0]?.key, "?:7:1000000");
		assert.equal(snap.readings[0]?.sensorIndex, -1);
	});

	it("clamps out-of-range sensor types to Other", () => {
		const snap = parseSnapshot(compose([CPU], [{ ...TEMP, type: 99 }]));
		assert.equal(snap.readings[0]?.type, SensorType.Other);
	});
});

describe("parseSnapshot — UTF-8 392/460 layout (HWiNFO ≥ 7.x)", () => {
	it("prefers the UTF-8 label and unit tails", () => {
		const buf = compose([{ ...CPU, utf8: "CPU [#0]: Ryzen™" }], [{ ...TEMP, utf8: "Tctl/Tdie ✓", unitUtf8: "°C" }], { utf8: true });
		const snap = parseSnapshot(buf);
		assert.equal(snap.sensors[0]?.name, "CPU [#0]: Ryzen™");
		assert.equal(snap.readings[0]?.label, "Tctl/Tdie ✓");
		assert.equal(snap.readings[0]?.unit, "°C");
	});

	it("a user rename beats a UTF-8 tail that still holds the original", () => {
		const buf = compose([CPU], [{ ...TEMP, user: "Renamed", utf8: "Tctl/Tdie" }], { utf8: true });
		assert.equal(parseSnapshot(buf).readings[0]?.label, "Renamed");
	});

	it("empty UTF-8 tails fall back to the ANSI fields", () => {
		const buf = compose([CPU], [TEMP], { utf8: true });
		const snap = parseSnapshot(buf);
		assert.equal(snap.readings[0]?.label, "Tctl/Tdie");
		assert.equal(snap.readings[0]?.unit, "°C".normalize());
	});
});

describe("SnapshotParser — incremental fast path", () => {
	it("returns the same snapshot instance with updated doubles", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		const second = parser.parse(compose([CPU], [{ ...TEMP, value: 77.25 }], { pollTime: 1_751_600_005 }));
		assert.equal(second, first, "fast path must reuse the snapshot instance");
		assert.equal(second.readings[0]?.value, 77.25);
		assert.equal(second.pollTime, 1_751_600_005);
		assert.equal(second.byKey.get("f0000501:0:1000000")?.value, 77.25);
	});

	it("rebuilds when the header changes (entry count)", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		const second = parser.parse(compose([CPU], [TEMP, { ...TEMP, id: 0x1000001, orig: "Core", value: 3 }]));
		assert.notEqual(second, first);
		assert.equal(second.readings.length, 2);
	});

	it("rebuilds when an entry identity changes under an unchanged header", () => {
		const parser = new SnapshotParser();
		const first = parser.parse(compose([CPU], [TEMP]));
		const swapped = parser.parse(compose([CPU], [{ ...TEMP, id: 0x2000000, orig: "Different" }]));
		assert.notEqual(swapped, first);
		assert.equal(swapped.readings[0]?.key, "f0000501:0:2000000");
		assert.equal(swapped.readings[0]?.label, "Different");
	});

	it("fast path works across classic AND utf8 strides", () => {
		for (const utf8 of [false, true]) {
			const parser = new SnapshotParser();
			const a = parser.parse(compose([CPU], [TEMP], { utf8 }));
			const b = parser.parse(compose([CPU], [{ ...TEMP, value: 61 }], { utf8 }));
			assert.equal(b, a);
			assert.equal(b.readings[0]?.value, 61);
		}
	});
});

describe("parseSnapshot — malformed input", () => {
	it("rejects a sensor stride below the classic layout", () => {
		const buf = compose([CPU], [TEMP]);
		buf.writeUInt32LE(SENSOR_CLASSIC_SIZE - 4, HEADER.sensorElementSize);
		assert.throws(() => parseSnapshot(buf), (e: unknown) => e instanceof HwinfoError && e.reason === "invalid");
	});

	it("rejects an entry stride below the classic layout", () => {
		const buf = compose([CPU], [TEMP]);
		buf.writeUInt32LE(ENTRY_CLASSIC_SIZE - 1, HEADER.entryElementSize);
		assert.throws(() => parseSnapshot(buf), (e: unknown) => e instanceof HwinfoError && e.reason === "invalid");
	});

	it("garbage label bytes decode without throwing (lossy, never fatal)", () => {
		const buf = compose([CPU], [TEMP], { utf8: true });
		// Invalid UTF-8 in the label tail must not break the decode.
		buf.fill(0xfe, buf.readUInt32LE(HEADER.entrySectionOffset) + ENTRY.labelUtf8, buf.readUInt32LE(HEADER.entrySectionOffset) + ENTRY.labelUtf8 + 8);
		const snap = parseSnapshot(buf);
		assert.equal(typeof snap.readings[0]?.label, "string");
		assert.ok((snap.readings[0]?.label.length ?? 0) > 0);
	});
});
