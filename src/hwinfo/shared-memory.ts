/**
 * Low-level access to HWiNFO's shared memory via the hwsm native bridge
 * (kernel32 only). It opens the read-only file mapping once, holds the view,
 * and produces one consistent byte snapshot per
 * {@link SharedMemorySession.read} by copying the used region into a
 * reusable Buffer while holding HWiNFO's consistency mutex. Everything
 * above this layer works on plain Buffers.
 */
import { getHwsm, type HwsmBridge } from "./hwsm-loader";
import { HEADER, HEADER_SIZE, MAGIC_ACTIVE, MAGIC_DEAD, MAPPING_NAME, MAX_ELEMENT_COUNT, MAX_REGION_BYTES, MUTEX_NAME } from "./layout";
import { HwinfoError } from "./types";

const FILE_MAP_READ = 0x0004;
const SYNCHRONIZE = 0x00100000;
const WAIT_OBJECT_0 = 0x00000000;
const WAIT_ABANDONED = 0x00000080;
const WAIT_TIMEOUT = 0x00000102;
const ERROR_ACCESS_DENIED = 5;

/** How long to wait for HWiNFO's consistency mutex before skipping a tick. */
const MUTEX_TIMEOUT_MS = 150;

// Overridable so the resilience e2e can point the reader at a synthetic
// mapping it controls (scripts/fake-hwinfo.mjs). Production uses the defaults.
const EFFECTIVE_MAPPING_NAME = process.env.HWINFO_SM2_NAME ?? MAPPING_NAME;
const EFFECTIVE_MUTEX_NAME = process.env.HWINFO_SM2_MUTEX_NAME ?? MUTEX_NAME;

/**
 * Validates the header magic, throwing the status-appropriate {@link HwinfoError}.
 * Shared by open()-time validation and every {@link SharedMemorySession.read} so
 * a mapping HWiNFO has flipped to "DEAD" (free version, after 12 h) is rejected
 * both when we first open it and if it dies mid-run.
 */
function assertMagicActive(headerBuf: Buffer): void {
	const magic = headerBuf.readUInt32LE(HEADER.magic);
	if (magic === MAGIC_ACTIVE) {
		return;
	}
	if (magic === MAGIC_DEAD) {
		throw new HwinfoError("disabled", 'HWiNFO reports shared-memory support as disabled (magic "DEAD").');
	}
	throw new HwinfoError("invalid", `Unexpected shared-memory magic 0x${magic.toString(16)}.`);
}

export class SharedMemorySession {
	private closed = false;
	private locked = false;
	private scratch = Buffer.alloc(0);
	/** Cached `scratch.subarray(0, total)` — recreated only when `total` moves. */
	private scratchView = Buffer.alloc(0);
	private readonly headerBuf = Buffer.alloc(HEADER_SIZE);

	private constructor(
		private readonly w: HwsmBridge,
		private readonly hMap: bigint,
		private readonly view: bigint,
		private hMutex: bigint | null
	) {}

	/**
	 * Opens HWiNFO's shared memory. Throws {@link HwinfoError} with a reason
	 * suitable for the status screens when it is unavailable.
	 */
	static open(): SharedMemorySession {
		if (process.platform !== "win32") {
			throw new HwinfoError("unsupported-platform", "HWiNFO shared memory only exists on Windows.");
		}
		const w = getHwsm();

		const hMap = w.openFileMappingW(FILE_MAP_READ, false, EFFECTIVE_MAPPING_NAME);
		if (hMap.value === 0n) {
			if (hMap.lastError === ERROR_ACCESS_DENIED) {
				throw new HwinfoError("access-denied", `Opening ${EFFECTIVE_MAPPING_NAME} was denied (Win32 error 5): HWiNFO and Stream Deck are likely running at different privilege levels.`);
			}
			throw new HwinfoError("not-running", `HWiNFO shared memory not found (Win32 error ${hMap.lastError}): HWiNFO is not running, or Shared Memory Support is disabled.`);
		}

		const view = w.mapViewOfFile(hMap.value, FILE_MAP_READ, 0, 0, 0);
		if (view.value === 0n) {
			w.closeHandle(hMap.value);
			throw new HwinfoError("not-running", `MapViewOfFile failed (Win32 error ${view.lastError}).`);
		}

		// The consistency mutex is optional — read unguarded if it is absent.
		const hMutex = w.openMutexW(SYNCHRONIZE, false, EFFECTIVE_MUTEX_NAME);
		const session = new SharedMemorySession(w, hMap.value, view.value, hMutex.value === 0n ? null : hMutex.value);
		// Validate the magic NOW, not just on the first read(). A present-but-
		// "DEAD" mapping (free HWiNFO after the 12 h limit leaves the named
		// section behind — see layout.ts) otherwise opens successfully and only
		// fails later in read(), which strands auto mode on the "Shared Memory
		// off" screen instead of falling back to the gadget registry, and lets
		// an upgrade probe close a working gadget provider for a dead one.
		// Treating DEAD as a failed open lets the poller's fallback logic engage.
		try {
			session.validateHeaderMagic();
		} catch (err) {
			session.close();
			throw err;
		}
		return session;
	}

	/**
	 * Reads the header into headerBuf and asserts the magic. Called at
	 * open() time without the mutex (the magic is a stable, atomically
	 * written 32-bit field) and by every read() under it.
	 */
	private validateHeaderMagic(): void {
		this.w.readInto(this.view, this.headerBuf, HEADER_SIZE);
		assertMagicActive(this.headerBuf);
	}

	/**
	 * Copies the currently used region into an internal scratch buffer under
	 * the consistency mutex and returns a view of it. Returns `null` when the
	 * mutex could not be acquired in time (caller should keep its previous
	 * snapshot and retry next tick). The returned Buffer is only valid until
	 * the next call.
	 *
	 * Throws {@link HwinfoError} `disabled`/`invalid` when the header no
	 * longer validates — the caller should close this session and re-open.
	 */
	read(): Buffer | null {
		if (this.closed) {
			throw new HwinfoError("invalid", "SharedMemorySession is closed.");
		}
		if (!this.lock()) {
			return null;
		}
		try {
			this.validateHeaderMagic();

			const sensorSectionOffset = this.headerBuf.readUInt32LE(HEADER.sensorSectionOffset);
			const sensorElementSize = this.headerBuf.readUInt32LE(HEADER.sensorElementSize);
			const sensorElementCount = this.headerBuf.readUInt32LE(HEADER.sensorElementCount);
			const entrySectionOffset = this.headerBuf.readUInt32LE(HEADER.entrySectionOffset);
			const entryElementSize = this.headerBuf.readUInt32LE(HEADER.entryElementSize);
			const entryElementCount = this.headerBuf.readUInt32LE(HEADER.entryElementCount);

			if (sensorElementCount > MAX_ELEMENT_COUNT || entryElementCount > MAX_ELEMENT_COUNT) {
				throw new HwinfoError("invalid", `Implausible element counts (${sensorElementCount} sensors, ${entryElementCount} readings).`);
			}
			const total = Math.max(
				HEADER_SIZE,
				sensorSectionOffset + sensorElementSize * sensorElementCount,
				entrySectionOffset + entryElementSize * entryElementCount
			);
			if (total > MAX_REGION_BYTES) {
				throw new HwinfoError("invalid", `Implausible region size (${total} bytes).`);
			}

			if (this.scratch.length < total) {
				this.scratch = Buffer.alloc(total);
			}
			if (this.scratchView.length !== total || this.scratchView.buffer !== this.scratch.buffer) {
				this.scratchView = this.scratch.subarray(0, total);
			}
			this.w.readInto(this.view, this.scratch, total);
			return this.scratchView;
		} finally {
			this.unlock();
		}
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		if (this.hMutex !== null) {
			this.w.closeHandle(this.hMutex);
			this.hMutex = null;
		}
		this.w.unmapViewOfFile(this.view);
		this.w.closeHandle(this.hMap);
	}

	private lock(): boolean {
		if (this.hMutex === null) {
			return true;
		}
		const result = this.w.waitForSingleObject(this.hMutex, MUTEX_TIMEOUT_MS);
		if (result === WAIT_OBJECT_0 || result === WAIT_ABANDONED) {
			this.locked = true;
			return true;
		}
		if (result === WAIT_TIMEOUT) {
			return false;
		}
		// WAIT_FAILED — the handle is unusable; drop it and read unguarded.
		this.w.closeHandle(this.hMutex);
		this.hMutex = null;
		return true;
	}

	private unlock(): void {
		if (this.hMutex !== null && this.locked) {
			this.w.releaseMutex(this.hMutex);
		}
		this.locked = false;
	}
}
