/**
 * Thin domain wrapper over the hwsm native shared-memory session. The
 * native side owns the mapping, the consistency mutex, the exact validated
 * byte length, and the entire guarded read transaction (acquire, validate,
 * copy, release); this layer owns one reusable Buffer sized to the
 * session's exact byteLength and the translation of stable native HWSM_*
 * codes into {@link HwinfoError} reasons for the poller and status screens.
 * Everything above this layer works on plain Buffers; no handle, address,
 * or byte count ever originates in JavaScript.
 */
import { getHwsm, hwsmCode, type HwsmSharedMemorySession } from "./hwsm-loader";
import { MAPPING_NAME, MUTEX_NAME } from "./layout";
import { HwinfoError, type HwinfoUnavailableReason } from "./types";

// Overridable so the resilience e2e can point the reader at a synthetic
// mapping it controls (scripts/fake-hwinfo.mjs). Production uses the defaults.
const EFFECTIVE_MAPPING_NAME = process.env.HWINFO_SM2_NAME ?? MAPPING_NAME;
const EFFECTIVE_MUTEX_NAME = process.env.HWINFO_SM2_MUTEX_NAME ?? MUTEX_NAME;

/**
 * Maps a native HWSM_* failure to the status-screen reason. Layout and
 * synchronization failures land on "invalid": the session is poisoned, the
 * poller drops the provider and re-opens, and a genuinely changed source
 * gets a fresh exact mapping on the next tick.
 */
function reasonFor(code: string): HwinfoUnavailableReason {
	switch (code) {
		case "HWSM_NOT_FOUND":
		case "HWSM_MUTEX_NOT_FOUND": // producer mid-startup: mapping before mutex
		case "HWSM_MUTEX_BUSY": // open-time contention; transient
		case "HWSM_MAP_FAILED":
			return "not-running";
		case "HWSM_ACCESS_DENIED":
			return "access-denied";
		case "HWSM_DISABLED":
			return "disabled";
		default:
			// HWSM_INVALID_LAYOUT, HWSM_LAYOUT_CHANGED, HWSM_ABANDONED,
			// HWSM_WAIT_FAILED, HWSM_RELEASE_FAILED, HWSM_SESSION_*.
			return "invalid";
	}
}

/** Wraps a native failure; non-Error throwables pass through untouched. */
function toHwinfoError(err: unknown): unknown {
	const code = hwsmCode(err);
	if (code === "") {
		return err;
	}
	return new HwinfoError(reasonFor(code), (err as Error).message);
}

export class SharedMemorySession {
	/** One reusable snapshot buffer, sized once to the exact session length. */
	private readonly scratch: Buffer;

	private constructor(private readonly native: HwsmSharedMemorySession) {
		this.scratch = Buffer.alloc(native.byteLength);
	}

	/**
	 * Opens HWiNFO's shared memory. Throws {@link HwinfoError} with a reason
	 * suitable for the status screens when it is unavailable. A mapping whose
	 * header reads "DEAD" (free version after 12 h, or support toggled off)
	 * fails here as "disabled" so the poller's fallback logic engages instead
	 * of stranding auto mode on a dead session.
	 */
	static open(): SharedMemorySession {
		if (process.platform !== "win32") {
			throw new HwinfoError("unsupported-platform", "HWiNFO shared memory only exists on Windows.");
		}
		const bridge = getHwsm();
		try {
			return new SharedMemorySession(bridge.openSharedMemory(EFFECTIVE_MAPPING_NAME, EFFECTIVE_MUTEX_NAME));
		} catch (err) {
			throw toHwinfoError(err);
		}
	}

	/**
	 * One consistent snapshot: exactly byteLength bytes copied under HWiNFO's
	 * consistency mutex, as a view that is only valid until the next call.
	 * Returns `null` when the mutex was busy (skip this tick; keep the
	 * previous snapshot). Throws {@link HwinfoError} when the session is gone
	 * (layout changed, DEAD magic, synchronization failure) — the caller
	 * should close this provider and re-open.
	 */
	read(): Buffer | null {
		let copied: number;
		try {
			copied = this.native.readInto(this.scratch);
		} catch (err) {
			throw toHwinfoError(err);
		}
		if (copied === 0) {
			return null;
		}
		if (copied !== this.scratch.length) {
			// The native contract copies exactly byteLength or throws; anything
			// else is a broken bridge, not a data condition.
			throw new HwinfoError("invalid", `Native readInto returned ${copied} bytes for a ${this.scratch.length}-byte session.`);
		}
		return this.scratch;
	}

	close(): void {
		this.native.close();
	}
}
