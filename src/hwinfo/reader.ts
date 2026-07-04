/**
 * Decodes a shared-memory byte snapshot (produced by
 * {@link SharedMemorySession.read}) into a typed {@link SensorSnapshot},
 * joining each reading to its sensor source via `sensorIndex`.
 *
 * The layout (sensor list, labels, units, keys) is static for the lifetime of
 * an HWiNFO session — between restarts only the value doubles and pollTime
 * move. {@link SnapshotParser} therefore decodes the full skeleton once and
 * on subsequent ticks only re-reads the volatile doubles into the same
 * structures, verifying per entry that the identity words (type, sensor
 * index, id) still match. Any header or identity change ⇒ full rebuild.
 */
import { ENTRY, ENTRY_CLASSIC_SIZE, ENTRY_UTF8_SIZE, HEADER, SENSOR, SENSOR_CLASSIC_SIZE, SENSOR_UTF8_SIZE } from "./layout";
import { HwinfoError, SensorType, type SensorSnapshot, type SensorSource } from "./types";

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

/** i64 pollTime as a plain number — avoids a BigInt allocation per tick. */
function readPollTime(dv: DataView): number {
	return dv.getInt32(HEADER.pollTime + 4, true) * 4294967296 + dv.getUint32(HEADER.pollTime, true);
}

/** Internal mutable twin of {@link Reading} — value fields updated in place. */
interface MutableReading {
	readonly key: string;
	readonly type: SensorType;
	readonly sensorIndex: number;
	readonly id: number;
	readonly label: string;
	readonly unit: string;
	value: number;
	valueMin: number;
	valueMax: number;
	valueAvg: number;
}

interface MutableSnapshot {
	pollTime: number;
	version: number;
	revision: number;
	sensors: readonly SensorSource[];
	readings: readonly MutableReading[];
	byKey: ReadonlyMap<string, MutableReading>;
}

/** Header fields (beyond pollTime) that define the skeleton. */
const HEADER_KEY_OFFSETS = [
	HEADER.version,
	HEADER.revision,
	HEADER.sensorSectionOffset,
	HEADER.sensorElementSize,
	HEADER.sensorElementCount,
	HEADER.entrySectionOffset,
	HEADER.entryElementSize,
	HEADER.entryElementCount
] as const;

/**
 * Stateful snapshot decoder. `parse` returns the SAME snapshot instance on
 * every fast-path tick, with the volatile fields updated in place — callers
 * must treat a snapshot as valid only until the provider's next read (see
 * {@link SensorSnapshot}). Hold one parser per shared-memory session so an
 * HWiNFO restart always starts from a clean skeleton.
 */
export class SnapshotParser {
	private readonly headerKey = new Uint32Array(HEADER_KEY_OFFSETS.length);
	/** [type, sensorIndex, id] per entry — cheap per-tick identity check. */
	private identity = new Uint32Array(0);
	private snapshot: MutableSnapshot | null = null;
	// DataView beats Buffer.read* in the hot loop: its accessors are TurboFan
	// intrinsics, so reads stay unboxed (readDoubleLE allocates a HeapNumber
	// per call). Cached per Buffer identity — the session reuses its scratch.
	private view: DataView | null = null;
	private viewOwner: Buffer | null = null;

	parse(buf: Buffer): SensorSnapshot {
		if (this.viewOwner !== buf || this.view === null) {
			this.view = new DataView(buf.buffer, buf.byteOffset, buf.length);
			this.viewOwner = buf;
		}
		const dv = this.view;
		const cached = this.snapshot;
		if (cached !== null && this.headerMatches(dv) && this.refresh(dv, cached)) {
			return cached;
		}
		return this.rebuild(buf, dv);
	}

	private headerMatches(dv: DataView): boolean {
		for (let i = 0; i < HEADER_KEY_OFFSETS.length; i++) {
			if (dv.getUint32(HEADER_KEY_OFFSETS[i] as number, true) !== this.headerKey[i]) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Fast path: re-read pollTime + the four doubles per entry. Stores are
	 * conditional — writing a double field boxes a fresh HeapNumber, so
	 * skipping unchanged values keeps steady-state ticks alloc-free.
	 */
	private refresh(dv: DataView, snap: MutableSnapshot): boolean {
		const entrySectionOffset = dv.getUint32(HEADER.entrySectionOffset, true);
		const entryElementSize = dv.getUint32(HEADER.entryElementSize, true);
		const readings = snap.readings;
		const identity = this.identity;
		for (let i = 0, o = entrySectionOffset; i < readings.length; i++, o += entryElementSize) {
			if (
				dv.getUint32(o + ENTRY.type, true) !== identity[i * 3] ||
				dv.getUint32(o + ENTRY.sensorIndex, true) !== identity[i * 3 + 1] ||
				dv.getUint32(o + ENTRY.id, true) !== identity[i * 3 + 2]
			) {
				return false; // layout changed under an unchanged header — rebuild
			}
			const r = readings[i] as MutableReading;
			const value = dv.getFloat64(o + ENTRY.value, true);
			if (r.value !== value) {
				r.value = value;
			}
			const valueMin = dv.getFloat64(o + ENTRY.valueMin, true);
			if (r.valueMin !== valueMin) {
				r.valueMin = valueMin;
			}
			const valueMax = dv.getFloat64(o + ENTRY.valueMax, true);
			if (r.valueMax !== valueMax) {
				r.valueMax = valueMax;
			}
			const valueAvg = dv.getFloat64(o + ENTRY.valueAvg, true);
			if (r.valueAvg !== valueAvg) {
				r.valueAvg = valueAvg;
			}
		}
		const pollTime = readPollTime(dv);
		if (snap.pollTime !== pollTime) {
			snap.pollTime = pollTime;
		}
		return true;
	}

	/** Full decode; caches the skeleton for subsequent fast-path ticks. */
	private rebuild(buf: Buffer, dv: DataView): SensorSnapshot {
		const version = buf.readUInt32LE(HEADER.version);
		const revision = buf.readUInt32LE(HEADER.revision);
		const pollTime = readPollTime(dv);
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

		const readings: MutableReading[] = new Array<MutableReading>(entryElementCount);
		const byKey = new Map<string, MutableReading>();
		const identity = new Uint32Array(entryElementCount * 3);
		for (let i = 0; i < entryElementCount; i++) {
			const o = entrySectionOffset + i * entryElementSize;
			const type = buf.readUInt32LE(o + ENTRY.type);
			const sensorIndex = buf.readUInt32LE(o + ENTRY.sensorIndex);
			const id = buf.readUInt32LE(o + ENTRY.id);
			identity[i * 3] = type;
			identity[i * 3 + 1] = sensorIndex;
			identity[i * 3 + 2] = id;
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

			const reading: MutableReading = {
				key,
				type: toSensorType(type),
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

		for (let i = 0; i < HEADER_KEY_OFFSETS.length; i++) {
			this.headerKey[i] = buf.readUInt32LE(HEADER_KEY_OFFSETS[i] as number);
		}
		this.identity = identity;
		this.snapshot = { pollTime, version, revision, sensors, readings, byKey };
		return this.snapshot;
	}
}

/** One-shot decode (probe, tests). The hot path holds a {@link SnapshotParser}. */
export function parseSnapshot(buf: Buffer): SensorSnapshot {
	return new SnapshotParser().parse(buf);
}
