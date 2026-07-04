/**
 * Low-level access to HWiNFO's shared memory via koffi FFI (kernel32 only).
 *
 * This module owns every koffi/Win32 call in the plugin. It opens the
 * read-only file mapping once, holds the view, and produces one consistent
 * byte snapshot per {@link SharedMemorySession.read} by copying the used
 * region into a reusable Buffer while holding HWiNFO's consistency mutex.
 * Everything above this layer works on plain Buffers.
 */
import koffi, { type KoffiFunc } from "koffi";

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
		const k32 = koffi.load("kernel32.dll");
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

export class SharedMemorySession {
	private closed = false;
	private locked = false;
	private scratch = Buffer.alloc(0);
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

		const hMap = w.openFileMappingW(FILE_MAP_READ, false, MAPPING_NAME);
		if (isNullPtr(hMap)) {
			const err = w.getLastError();
			if (err === ERROR_ACCESS_DENIED) {
				throw new HwinfoError("access-denied", `Opening ${MAPPING_NAME} was denied (Win32 error 5) — HWiNFO and Stream Deck are likely running at different privilege levels.`);
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
		const hMutex = w.openMutexW(SYNCHRONIZE, false, MUTEX_NAME);
		return new SharedMemorySession(w, hMap, view, isNullPtr(hMutex) ? null : hMutex);
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

			const magic = this.headerBuf.readUInt32LE(HEADER.magic);
			if (magic !== MAGIC_ACTIVE) {
				if (magic === MAGIC_DEAD) {
					throw new HwinfoError("disabled", "HWiNFO reports shared-memory support as disabled (magic \"DEAD\").");
				}
				throw new HwinfoError("invalid", `Unexpected shared-memory magic 0x${magic.toString(16)}.`);
			}

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
			this.w.rtlMoveMemory(this.scratch, this.view, total);
			return this.scratch.subarray(0, total);
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
