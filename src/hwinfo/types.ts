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

/**
 * One consistent decode of the whole shared-memory region.
 *
 * Liveness: a provider may return the SAME snapshot instance on every tick
 * with the value fields updated in place (the skeleton — keys, labels,
 * units, sensors — is static per HWiNFO session). Read what you need when
 * the tick arrives; copy scalars you want to keep. Do not cache `Reading`
 * objects across ticks expecting historical values.
 */
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
	/** Gadget registry exists but no sensor has "Report value in Gadget" ticked. */
	| "gadget-empty"
	/** Mapping exists but we may not read it (privilege mismatch). */
	| "access-denied"
	/** Header magic is "DEAD": shared-memory support was turned off (or the free-version 12 h timer expired). */
	| "disabled"
	/** Header failed validation — unrecognized or corrupt layout. */
	| "invalid"
	/** The hwsm native bridge would not load on a supported machine (missing
	 * or blocked bin/hwsm.node, e.g. an antivirus quarantine): permanent until
	 * the install is repaired, unlike the transient "invalid". */
	| "bridge-failed";

export class HwinfoError extends Error {
	constructor(
		readonly reason: HwinfoUnavailableReason,
		message: string
	) {
		super(message);
		this.name = "HwinfoError";
	}
}
