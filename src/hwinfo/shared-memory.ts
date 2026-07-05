/**
 * Low-level access to HWiNFO's shared memory via koffi FFI (kernel32 only).
 *
 * This module owns every koffi/Win32 call in the plugin. It opens the
 * read-only file mapping once, holds the view, and produces one consistent
 * byte snapshot per {@link SharedMemorySession.read} by copying the used
 * region into a reusable Buffer while holding HWiNFO's consistency mutex.
 * Everything above this layer works on plain Buffers.
 */
import type { KoffiFunc } from "koffi";

import { getKoffi } from "./koffi-loader";
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

/** Opaque native pointer/handle as surfaced by koffi (bigint, or null for NULL). */
type NativePtr = unknown;

interface Win32 {
	openFileMappingW: KoffiFunc<(desiredAccess: number, inheritHandle: boolean, name: string) => NativePtr>;
	mapViewOfFile: KoffiFunc<(hMap: NativePtr, desiredAccess: number, offsetHigh: number, offsetLow: number, bytesToMap: number) => NativePtr>;
	unmapViewOfFile: KoffiFunc<(view: NativePtr) => boolean>;
	closeHandle: KoffiFunc<(handle: NativePtr) => boolean>;
	openMutexW: KoffiFunc<(desiredAccess: number, inheritHandle: boolean, name: string) => NativePtr>;
	waitForSingleObject: KoffiFunc<(handle: NativePtr, timeoutMs: number) => number>;
	releaseMutex: KoffiFunc<(handle: NativePtr) => boolean>;
	rtlMoveMemory: KoffiFunc<(dest: Buffer, src: NativePtr, bytes: number) => void>;
	getLastError: KoffiFunc<() => number>;
}

let win32: Win32 | null = null;

/** Lazily binds kernel32 so importing this module is safe off-Windows. */
function getWin32(): Win32 {
	if (win32 === null) {
		const k32 = getKoffi().load("kernel32.dll");
		win32 = {
			openFileMappingW: k32.func("__stdcall", "OpenFileMappingW", "void*", ["uint32", "bool", "str16"]) as Win32["openFileMappingW"],
			mapViewOfFile: k32.func("__stdcall", "MapViewOfFile", "void*", ["void*", "uint32", "uint32", "uint32", "size_t"]) as Win32["mapViewOfFile"],
			unmapViewOfFile: k32.func("__stdcall", "UnmapViewOfFile", "bool", ["void*"]) as Win32["unmapViewOfFile"],
			closeHandle: k32.func("__stdcall", "CloseHandle", "bool", ["void*"]) as Win32["closeHandle"],
			openMutexW: k32.func("__stdcall", "OpenMutexW", "void*", ["uint32", "bool", "str16"]) as Win32["openMutexW"],
			waitForSingleObject: k32.func("__stdcall", "WaitForSingleObject", "uint32", ["void*", "uint32"]) as Win32["waitForSingleObject"],
			releaseMutex: k32.func("__stdcall", "ReleaseMutex", "bool", ["void*"]) as Win32["releaseMutex"],
			rtlMoveMemory: k32.func("__stdcall", "RtlMoveMemory", "void", ["_Out_ uint8*", "void*", "size_t"]) as Win32["rtlMoveMemory"],
			getLastError: k32.func("__stdcall", "GetLastError", "uint32", []) as Win32["getLastError"]
		};
	}
	return win32;
}

function isNullPtr(ptr: NativePtr): boolean {
	return ptr === null || ptr === undefined || ptr === 0n || ptr === 0;
}

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
		private readonly w: Win32,
		private readonly hMap: NativePtr,
		private readonly view: NativePtr,
		private hMutex: NativePtr
	) {}

	/**
	 * Opens HWiNFO's shared memory. Throws {@link HwinfoError} with a reason
	 * suitable for the status screens when it is unavailable.
	 */
	static open(): SharedMemorySession {
		if (process.platform !== "win32") {
			throw new HwinfoError("unsupported-platform", "HWiNFO shared memory only exists on Windows.");
		}
		const w = getWin32();

		const hMap = w.openFileMappingW(FILE_MAP_READ, false, EFFECTIVE_MAPPING_NAME);
		if (isNullPtr(hMap)) {
			const err = w.getLastError();
			if (err === ERROR_ACCESS_DENIED) {
				throw new HwinfoError("access-denied", `Opening ${EFFECTIVE_MAPPING_NAME} was denied (Win32 error 5) — HWiNFO and Stream Deck are likely running at different privilege levels.`);
			}
			throw new HwinfoError("not-running", `HWiNFO shared memory not found (Win32 error ${err}) — HWiNFO is not running, or Shared Memory Support is disabled.`);
		}

		const view = w.mapViewOfFile(hMap, FILE_MAP_READ, 0, 0, 0);
		if (isNullPtr(view)) {
			const err = w.getLastError();
			w.closeHandle(hMap);
			throw new HwinfoError("not-running", `MapViewOfFile failed (Win32 error ${err}).`);
		}

		// The consistency mutex is optional — read unguarded if it is absent.
		const hMutex = w.openMutexW(SYNCHRONIZE, false, EFFECTIVE_MUTEX_NAME);
		const session = new SharedMemorySession(w, hMap, view, isNullPtr(hMutex) ? null : hMutex);
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
	 * Reads the header once (unguarded — the magic is a stable, atomically
	 * written 32-bit field) and asserts it, for open()-time validation.
	 */
	private validateHeaderMagic(): void {
		this.w.rtlMoveMemory(this.headerBuf, this.view, HEADER_SIZE);
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
			this.w.rtlMoveMemory(this.headerBuf, this.view, HEADER_SIZE);

			assertMagicActive(this.headerBuf);

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
			this.w.rtlMoveMemory(this.scratch, this.view, total);
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
