/** Public data model for HWiNFO sensor snapshots. */

/** Reading categories reported by HWiNFO. */
export enum SensorType {
	None = 0,
	Temperature = 1,
	Voltage = 2,
	Fan = 3,
	Current = 4,
	Power = 5,
	Clock = 6,
	Usage = 7,
	Other = 8
}

/** A sensor source, e.g. "CPU [#0]: AMD Ryzen 9 9950X3D". */
export interface SensorSource {
	/** Position in the shared-memory sensor section (what readings reference). */
	readonly index: number;
	readonly id: number;
	readonly instance: number;
	/** Effective display name (user rename respected, UTF-8 preferred). */
	readonly name: string;
}

/** A single reading, e.g. "CPU (Tctl/Tdie) = 56.3 °C". */
export interface Reading {
	/**
	 * Stable identity of this reading across HWiNFO restarts:
	 * `sensorId:sensorInstance:readingId` (hex), with `~n` appended for
	 * duplicates. Persist this in action settings — never the array index.
	 */
	readonly key: string;
	readonly type: SensorType;
	/** Index of the owning sensor in {@link SensorSnapshot.sensors}, or -1. */
	readonly sensorIndex: number;
	readonly id: number;
	/** Effective display label (user rename respected, UTF-8 preferred). */
	readonly label: string;
	readonly unit: string;
	readonly value: number;
	readonly valueMin: number;
	readonly valueMax: number;
	readonly valueAvg: number;
}

/** One consistent decode of the whole shared-memory region. */
export interface SensorSnapshot {
	/** Unix seconds of HWiNFO's last sensor poll (its clock, same machine). */
	readonly pollTime: number;
	readonly version: number;
	readonly revision: number;
	readonly sensors: readonly SensorSource[];
	readonly readings: readonly Reading[];
	/** Lookup by {@link Reading.key}. */
	readonly byKey: ReadonlyMap<string, Reading>;
}

/** Why HWiNFO data is unavailable — drives the key/dial status screens. */
export type HwinfoUnavailableReason =
	/** Not running on Windows. */
	| "unsupported-platform"
	/** Mapping absent: HWiNFO isn't running, or Shared Memory Support is off. */
	| "not-running"
	/** Mapping exists but we may not read it (privilege mismatch). */
	| "access-denied"
	/** Header magic is "DEAD": shared-memory support was turned off (or the free-version 12 h timer expired). */
	| "disabled"
	/** Header failed validation — unrecognized or corrupt layout. */
	| "invalid";

export class HwinfoError extends Error {
	constructor(
		readonly reason: HwinfoUnavailableReason,
		message: string
	) {
		super(message);
		this.name = "HwinfoError";
	}
}
