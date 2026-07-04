/**
 * Snapshot provider abstraction. HWiNFO publishes sensors through two
 * interfaces with different licensing trade-offs:
 *
 *  - Shared memory (`Global\HWiNFO_SENS_SM2`): every reading with min/max/avg,
 *    but the free version disables it after 12 hours (Pro removes the limit).
 *  - The Gadget registry (`HKCU\Software\HWiNFO64\VSB`): only user-checked
 *    sensors, current value only — but free without a time limit.
 *
 * The poller prefers shared memory and can fall back to the gadget registry.
 */
import { parseSnapshot } from "./reader";
import { SharedMemorySession } from "./shared-memory";
import type { SensorSnapshot } from "./types";

export type SnapshotSource = "shared-memory" | "gadget";

export interface SnapshotProvider {
	readonly source: SnapshotSource;
	/**
	 * One consistent snapshot. `null` means "skip this tick" (transient, e.g.
	 * mutex busy). Throws {@link HwinfoError} when the backend is gone.
	 */
	read(): SensorSnapshot | null;
	close(): void;
}

export class SharedMemoryProvider implements SnapshotProvider {
	readonly source = "shared-memory";

	private constructor(private readonly session: SharedMemorySession) {}

	/** Throws {@link HwinfoError} when the mapping is unavailable. */
	static open(): SharedMemoryProvider {
		return new SharedMemoryProvider(SharedMemorySession.open());
	}

	read(): SensorSnapshot | null {
		const buf = this.session.read();
		return buf === null ? null : parseSnapshot(buf);
	}

	close(): void {
		this.session.close();
	}
}
