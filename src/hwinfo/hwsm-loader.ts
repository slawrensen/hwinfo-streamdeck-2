/**
 * Owns loading and verifying the hwsm native bridge (native/hwsm), the
 * plugin's first-party N-API addon. The bridge is a capability API: it
 * hands out opaque session objects and never exposes a handle, pointer,
 * or generic Win32 call to JavaScript.
 *
 * Loading is gated twice. The platform gate fails "unsupported-platform"
 * before any load attempt on a non-win32/x64 host. The protocol gate runs
 * after a successful load: the addon's getBuildInfo() must report exactly
 * the protocol this plugin.js was built against, Node-API 8, and x64.
 * A mismatch (a new plugin.js next to an old-but-loadable hwsm.node, or
 * the reverse) fails closed as "bridge-failed" instead of polling through
 * a contract the two sides do not share.
 *
 * The plugin entry calls {@link initHwsm} once (failure captured); the
 * data-source layers then obtain the bridge via {@link getHwsm}, which
 * throws a normal {@link HwinfoError} that the poller routes to the
 * key/dial status screens.
 */
import { createRequire } from "node:module";

import { HwinfoError } from "./types";

/**
 * The JavaScript/native contract number; must equal HWSM_PROTOCOL_VERSION
 * in native/hwsm/hwsm-version.h. Bump ONLY when the exported API's shape
 * or meaning changes.
 */
export const HWSM_PROTOCOL_VERSION = 1;

/** Immutable startup metadata reported by the addon. */
export interface HwsmBuildInfo {
	readonly protocolVersion: number;
	readonly napiVersion: number;
	readonly architecture: string;
	readonly nativeVersion: string;
	readonly nativeSourceId: string;
}

/**
 * Opaque native shared-memory session. Owns the mapping, the consistency
 * mutex, and an exact-length view; JavaScript holds only this object.
 */
export interface HwsmSharedMemorySession {
	/** Exact validated mapping length; readInto copies exactly this many bytes. */
	readonly byteLength: number;
	/**
	 * One guarded snapshot copy into `dest` (which must be at least
	 * byteLength long). Returns byteLength on success, 0 when the mutex was
	 * busy (nothing copied). Throws an Error with a stable HWSM_* `code` on
	 * every other condition; layout and synchronization failures invalidate
	 * the session permanently.
	 */
	readInto(dest: Buffer): number;
	/** Idempotent. */
	close(): void;
}

/** Opaque native registry key (HKCU only, KEY_QUERY_VALUE only). */
export interface HwsmGadgetKey {
	/** REG_SZ value, or null when the value does not exist. */
	queryString(valueName: string): string | null;
	/** Idempotent. */
	close(): void;
}

export interface HwsmBridge {
	getBuildInfo(): HwsmBuildInfo;
	openSharedMemory(mappingName: string, mutexName: string): HwsmSharedMemorySession;
	openGadgetKey(subkey: string): HwsmGadgetKey;
}

/** Stable failure shape thrown by the native bridge. */
export interface HwsmNativeError extends Error {
	code?: string;
	operation?: string;
	win32Error?: number;
}

/** Narrow accessor for the HWSM_* code on a caught native error. */
export function hwsmCode(err: unknown): string {
	return err instanceof Error && typeof (err as HwsmNativeError).code === "string" ? ((err as HwsmNativeError).code as string) : "";
}

/** The Win32/LSTATUS error a native failure carried, or 0. */
export function hwsmWin32(err: unknown): number {
	return err instanceof Error && typeof (err as HwsmNativeError).win32Error === "number" ? ((err as HwsmNativeError).win32Error as number) : 0;
}

let cached: HwsmBridge | null = null;
let failure: HwinfoError | null = null;

/** Production resolves the vendored copy beside the bundle (bin/hwsm.node);
 * dev entries under tsx (probe, e2e) resolve the locally built addon. A
 * present-but-unloadable prod copy surfaces its real error instead of
 * falling through to a misleading dev-path miss. */
function requireBridge(): unknown {
	const require = createRequire(import.meta.url);
	try {
		return require("./hwsm.node") as unknown;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
			throw err;
		}
		return require("../../native/hwsm/build/Release/hwsm.node") as unknown;
	}
}

/**
 * The protocol gate. Returns null when the loaded module is the bridge this
 * plugin.js was built against; otherwise one factual sentence for the log
 * (the user-facing message stays "reinstall the plugin"). Exported for the
 * native suite; production calls it through {@link getHwsm} with the real
 * process.versions.napi.
 */
export function bridgeProtocolFailure(mod: unknown, napiVersionString: string | undefined = process.versions.napi): string | null {
	const napi = Number(napiVersionString ?? "0");
	if (!Number.isFinite(napi) || napi < 8) {
		return `the Node runtime reports Node-API ${napiVersionString ?? "none"}, below the required 8`;
	}
	if (typeof mod !== "object" || mod === null) {
		return "the addon did not export an object";
	}
	const bridge = mod as Partial<HwsmBridge>;
	if (typeof bridge.getBuildInfo !== "function" || typeof bridge.openSharedMemory !== "function" || typeof bridge.openGadgetKey !== "function") {
		return "the addon is missing required methods (getBuildInfo, openSharedMemory, openGadgetKey)";
	}
	let info: HwsmBuildInfo;
	try {
		info = bridge.getBuildInfo();
	} catch (err) {
		return `getBuildInfo() threw: ${String(err)}`;
	}
	if (
		typeof info !== "object" ||
		info === null ||
		typeof info.protocolVersion !== "number" ||
		typeof info.napiVersion !== "number" ||
		typeof info.architecture !== "string" ||
		typeof info.nativeVersion !== "string" ||
		typeof info.nativeSourceId !== "string"
	) {
		return "getBuildInfo() returned an unexpected shape";
	}
	if (info.protocolVersion !== HWSM_PROTOCOL_VERSION) {
		return `native protocol ${info.protocolVersion} does not match this plugin build's protocol ${HWSM_PROTOCOL_VERSION} (mixed hwsm.node and plugin.js versions)`;
	}
	if (info.napiVersion !== 8) {
		return `the addon was built for Node-API ${info.napiVersion}, expected 8`;
	}
	if (info.architecture !== "x64") {
		return `the addon reports architecture ${info.architecture}, expected x64`;
	}
	return null;
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
 * The loaded, protocol-verified bridge, loading it on first call; the
 * failure is sticky for the process lifetime. Throws {@link HwinfoError}:
 * "unsupported-platform" for wrong OS/arch, "bridge-failed" for a load or
 * protocol failure on a SUPPORTED win32/x64 machine (AV-quarantined
 * hwsm.node, damaged install, mixed plugin/addon versions) — the status
 * screens must tell an x64 user to repair the install, not that their
 * platform is wrong.
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
				const mod = requireBridge();
				const mismatch = bridgeProtocolFailure(mod);
				if (mismatch !== null) {
					console.error(`hwsm bridge rejected: ${mismatch}`);
					failure = new HwinfoError("bridge-failed", "The plugin's native HWiNFO bridge (bin/hwsm.node) does not match this plugin version: reinstall the plugin.");
				} else {
					cached = mod as HwsmBridge;
					return cached;
				}
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
