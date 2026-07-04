/**
 * Owns loading the koffi FFI runtime so an unsupported machine degrades to a
 * status screen instead of killing the plugin process.
 *
 * koffi ships native binaries per platform/arch and has NO win32-arm64 build;
 * a static `import koffi from "koffi"` therefore throws at module-evaluation
 * time on Windows-on-ARM — before any error handler exists. The plugin entry
 * calls {@link initKoffi} once (dynamic import, failure captured); the FFI
 * layers then obtain the module via {@link getKoffi}, which throws a normal
 * {@link HwinfoError} that the poller routes to the key/dial status screens.
 */
import { createRequire } from "node:module";

import type koffiModule from "koffi";
import { HwinfoError } from "./types";

type Koffi = typeof koffiModule;

let cached: Koffi | null = null;
let failure: string | null = null;

/** Loads koffi once at startup; captures failure instead of throwing. */
export async function initKoffi(): Promise<void> {
	if (cached !== null || failure !== null) {
		return;
	}
	const incompatible = platformFailure();
	if (incompatible !== null) {
		failure = incompatible;
		return;
	}
	try {
		cached = (await import("koffi")).default as Koffi;
	} catch (err) {
		failure = `The native FFI runtime failed to load on ${process.platform}/${process.arch}: ${String(err)}`;
	}
}

/**
 * The loaded koffi module. Throws {@link HwinfoError} "unsupported-platform"
 * when {@link initKoffi} failed. Dev entries that skip initKoffi (probe,
 * bench under tsx) fall back to a synchronous require — the full koffi
 * package in the repo's node_modules still has its CJS entry (the vendored
 * production copy does not, which is why production must init asynchronously).
 */
export function getKoffi(): Koffi {
	if (cached !== null) {
		return cached;
	}
	if (failure !== null) {
		throw new HwinfoError("unsupported-platform", failure);
	}
	const incompatible = platformFailure();
	if (incompatible !== null) {
		throw new HwinfoError("unsupported-platform", incompatible);
	}
	try {
		cached = createRequire(import.meta.url)("koffi") as Koffi;
		return cached;
	} catch (err) {
		throw new HwinfoError("unsupported-platform", `The native FFI runtime failed to load: ${String(err)}`);
	}
}

function platformFailure(): string | null {
	if (process.platform !== "win32") {
		return "HWiNFO only exists on Windows; this plugin has nothing to read here.";
	}
	if (process.arch !== "x64") {
		// koffi publishes no win32-arm64 binary; only x64 is vendored.
		return `This plugin's HWiNFO bridge needs 64-bit (x64) Windows — the Stream Deck runtime here is ${process.arch}, which has no native FFI build.`;
	}
	return null;
}
