/**
 * Decodes a shared-memory byte snapshot (produced by
 * {@link SharedMemorySession.read}) into a typed {@link SensorSnapshot},
 * joining each reading to its sensor source via `sensorIndex`.
 */
import { ENTRY, ENTRY_CLASSIC_SIZE, ENTRY_UTF8_SIZE, HEADER, SENSOR, SENSOR_CLASSIC_SIZE, SENSOR_UTF8_SIZE } from "./layout";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot, type SensorSource } from "./types";

/** Reads a NUL-terminated string out of a fixed-width field. */
function cstr(buf: Buffer, offset: number, length: number, encoding: "latin1" | "utf8"): string {
	const end = offset + length;
	let nul = buf.indexOf(0, offset);
	if (nul < 0 || nul > end) {
		nul = end;
	}
	return buf.toString(encoding, offset, nul);
}

/**
 * Picks the effective display label. The UTF-8 tail (when present) mirrors
 * one of the two ANSI labels; if the user renamed the item and the tail holds
 * the original name, the rename wins.
 */
function pickLabel(orig: string, user: string, utf8: string): string {
	if (utf8.length > 0) {
		if (user !== orig && utf8 === orig) {
			return user;
		}
		return utf8;
	}
	return user.length > 0 ? user : orig;
}

function toSensorType(raw: number): SensorType {
	return raw >= SensorType.None && raw <= SensorType.Other ? (raw as SensorType) : SensorType.Other;
}

export function parseSnapshot(buf: Buffer): SensorSnapshot {
	const version = buf.readUInt32LE(HEADER.version);
	const revision = buf.readUInt32LE(HEADER.revision);
	const pollTime = Number(buf.readBigInt64LE(HEADER.pollTime));
	const sensorSectionOffset = buf.readUInt32LE(HEADER.sensorSectionOffset);
	const sensorElementSize = buf.readUInt32LE(HEADER.sensorElementSize);
	const sensorElementCount = buf.readUInt32LE(HEADER.sensorElementCount);
	const entrySectionOffset = buf.readUInt32LE(HEADER.entrySectionOffset);
	const entryElementSize = buf.readUInt32LE(HEADER.entryElementSize);
	const entryElementCount = buf.readUInt32LE(HEADER.entryElementCount);

	if (sensorElementSize < SENSOR_CLASSIC_SIZE) {
		throw new HwinfoError("invalid", `Sensor element stride ${sensorElementSize} is smaller than the classic layout (${SENSOR_CLASSIC_SIZE}).`);
	}
	if (entryElementSize < ENTRY_CLASSIC_SIZE) {
		throw new HwinfoError("invalid", `Reading element stride ${entryElementSize} is smaller than the classic layout (${ENTRY_CLASSIC_SIZE}).`);
	}

	const sensorHasUtf8 = sensorElementSize >= SENSOR_UTF8_SIZE;
	const entryHasUtf8 = entryElementSize >= ENTRY_UTF8_SIZE;

	const sensors: SensorSource[] = new Array<SensorSource>(sensorElementCount);
	for (let i = 0; i < sensorElementCount; i++) {
		const o = sensorSectionOffset + i * sensorElementSize;
		const orig = cstr(buf, o + SENSOR.labelOrig, 128, "latin1");
		const user = cstr(buf, o + SENSOR.labelUser, 128, "latin1");
		const utf8 = sensorHasUtf8 ? cstr(buf, o + SENSOR.labelUtf8, 128, "utf8") : "";
		sensors[i] = {
			index: i,
			id: buf.readUInt32LE(o + SENSOR.id),
			instance: buf.readUInt32LE(o + SENSOR.instance),
			name: pickLabel(orig, user, utf8)
		};
	}

	const readings: Reading[] = new Array<Reading>(entryElementCount);
	const byKey = new Map<string, Reading>();
	for (let i = 0; i < entryElementCount; i++) {
		const o = entrySectionOffset + i * entryElementSize;
		const sensorIndex = buf.readUInt32LE(o + ENTRY.sensorIndex);
		const id = buf.readUInt32LE(o + ENTRY.id);
		const orig = cstr(buf, o + ENTRY.labelOrig, 128, "latin1");
		const user = cstr(buf, o + ENTRY.labelUser, 128, "latin1");
		const utf8 = entryHasUtf8 ? cstr(buf, o + ENTRY.labelUtf8, 128, "utf8") : "";
		const unitAnsi = cstr(buf, o + ENTRY.unit, 16, "latin1");
		const unitUtf8 = entryHasUtf8 ? cstr(buf, o + ENTRY.unitUtf8, 16, "utf8") : "";

		const source = sensors[sensorIndex];
		// Identity that survives HWiNFO restarts: owning sensor id+instance plus
		// the reading id, with a `~n` suffix for in-order duplicates.
		const baseKey =
			source !== undefined
				? `${source.id.toString(16)}:${source.instance}:${id.toString(16)}`
				: `?:${sensorIndex}:${id.toString(16)}`;
		let key = baseKey;
		for (let dup = 1; byKey.has(key); dup++) {
			key = `${baseKey}~${dup}`;
		}

		const reading: Reading = {
			key,
			type: toSensorType(buf.readUInt32LE(o + ENTRY.type)),
			sensorIndex: source !== undefined ? sensorIndex : -1,
			id,
			label: pickLabel(orig, user, utf8),
			unit: unitUtf8.length > 0 ? unitUtf8 : unitAnsi,
			value: buf.readDoubleLE(o + ENTRY.value),
			valueMin: buf.readDoubleLE(o + ENTRY.valueMin),
			valueMax: buf.readDoubleLE(o + ENTRY.valueMax),
			valueAvg: buf.readDoubleLE(o + ENTRY.valueAvg)
		};
		readings[i] = reading;
		byKey.set(key, reading);
	}

	return { pollTime, version, revision, sensors, readings, byKey };
}
