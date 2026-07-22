/**
 * Owns loading the hwsm native bridge (native/hwsm, a ~114 KB N-API addon
 * exposing the plugin's exact 11-call Win32 surface) so an unsupported
 * machine degrades to a status screen instead of killing the plugin process.
 *
 * The addon ships win32-x64 only, matching the manifest; the platform gate
 * fails "unsupported-platform" before any load attempt. The plugin entry
 * calls {@link initHwsm} once (failure captured); the FFI layers then obtain
 * the bridge via {@link getHwsm}, which throws a normal {@link HwinfoError}
 * that the poller routes to the key/dial status screens.
 */
import { createRequire } from "node:module";

import { HwinfoError } from "./types";

/** One Win32 handle/pointer call: `value` 0n means failure, and `lastError`
 * (captured inside the native call, where the N-API boundary cannot clobber
 * it) says why. */
export type HandleResult = { value: bigint; lastError: number };

export interface HwsmBridge {
	openFileMappingW(desiredAccess: number, inheritHandle: boolean, name: string): HandleResult;
	mapViewOfFile(hMap: bigint, desiredAccess: number, offsetHigh: number, offsetLow: number, bytesToMap: number): HandleResult;
	/** Copies `bytes` from the mapped view into the caller's Buffer (the
	 * reader's reusable scratch; no per-tick allocation). */
	readInto(base: bigint, dest: Buffer, bytes: number): void;
	unmapViewOfFile(view: bigint): boolean;
	closeHandle(handle: bigint): boolean;
	openMutexW(desiredAccess: number, inheritHandle: boolean, name: string): HandleResult;
	waitForSingleObject(handle: bigint, timeoutMs: number): number;
	releaseMutex(handle: bigint): boolean;
	regOpenKeyExW(hiveOrKey: bigint, subKey: string, samDesired: number): { status: number; hkey: bigint };
	regQueryValueExW(hkey: bigint, valueName: string): { status: number; type: number; data: Buffer };
	regCloseKey(hkey: bigint): number;
}

let cached: HwsmBridge | null = null;
let failure: HwinfoError | null = null;

/** Production resolves the vendored copy beside the bundle (bin/hwsm.node);
 * dev entries under tsx (probe, e2e) resolve the locally built addon. A
 * present-but-unloadable prod copy surfaces its real error instead of
 * falling through to a misleading dev-path miss. */
function requireBridge(): HwsmBridge {
	const require = createRequire(import.meta.url);
	try {
		return require("./hwsm.node") as HwsmBridge;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
			throw err;
		}
		return require("../../native/hwsm/build/Release/hwsm.node") as HwsmBridge;
	}
}

/** Primes the bridge at startup; the failure getHwsm() will keep throwing
 * is captured here instead of killing the entry module. */
export function initHwsm(): void {
	try {
		getHwsm();
	} catch {
		// Recorded in `failure`; the poller surfaces it every tick.
	}
}

/**
 * The loaded bridge, loading it on first call; the failure is sticky for
 * the process lifetime. Throws {@link HwinfoError}: "unsupported-platform"
 * for wrong OS/arch, "bridge-failed" for a load failure on a SUPPORTED
 * win32/x64 machine (AV-quarantined hwsm.node, damaged install) — the
 * status screens must tell an x64 user to repair the install, not that
 * their platform is wrong.
 */
export function getHwsm(): HwsmBridge {
	if (cached !== null) {
		return cached;
	}
	if (failure === null) {
		const incompatible = platformFailure();
		if (incompatible !== null) {
			failure = new HwinfoError("unsupported-platform", incompatible);
		} else {
			try {
				cached = requireBridge();
				return cached;
			} catch (err) {
				failure = new HwinfoError("bridge-failed", `The plugin's native HWiNFO bridge (bin/hwsm.node) failed to load: reinstall the plugin. (${String(err)})`);
			}
		}
	}
	throw failure;
}

function platformFailure(): string | null {
	if (process.platform !== "win32") {
		return "HWiNFO only exists on Windows; this plugin has nothing to read here.";
	}
	if (process.arch !== "x64") {
		// hwsm ships win32-x64 only, like the manifest.
		return `This plugin's HWiNFO bridge needs 64-bit (x64) Windows: the Stream Deck runtime here is ${process.arch}, which has no native build.`;
	}
	return null;
}
