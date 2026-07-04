// Vendors the koffi FFI runtime into the .sdPlugin bundle. koffi is a native
// module (N-API) and cannot be inlined by rollup, so it is marked `external`
// and shipped as bin/node_modules/koffi next to the bundled plugin.js, where
// Node's resolver finds it at runtime.
//
// koffi 3.x layout (verified against koffi@3.1.0):
//   node_modules/koffi                     — pure-JS loader (ESM+CJS)
//   node_modules/@koromix/koffi-win32-x64  — the actual win32 x64 .node binary,
//     resolved by koffi via require("@koromix/koffi-win32-x64")
// Build sources (lib/, vendor/, *.cc) and docs are excluded to keep the
// package small; only win32-x64 is shipped because the manifest is
// windows-only and Stream Deck's Node runtime is x64.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destModules = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin", "bin", "node_modules");

// koffi's exports map doesn't expose ./package.json, so locate the package
// root from its main entry (node_modules/koffi/index.cjs).
const koffiSrc = path.dirname(require.resolve("koffi"));
const nativeSrc = path.join(path.dirname(koffiSrc), "@koromix", "koffi-win32-x64");

if (!fs.existsSync(nativeSrc)) {
	console.error(`Missing ${nativeSrc} — koffi's win32-x64 native package is not installed.`);
	process.exit(1);
}

// When the plugin is running, Windows locks the loaded koffi.node — skip the
// copy entirely if the vendored copy already matches (keeps `npm run build`
// working while the plugin is live; a version bump needs
// `streamdeck stop com.lawrensen.hwinfo` first). BOTH halves must match: a
// partial vendor (JS copied, native locked) must not satisfy the guard.
function pkgVersion(...segments) {
	try {
		return JSON.parse(fs.readFileSync(path.join(destModules, ...segments, "package.json"), "utf8")).version;
	} catch {
		return null;
	}
}
const sourceVersion = JSON.parse(fs.readFileSync(path.join(koffiSrc, "package.json"), "utf8")).version;
const vendoredComplete =
	pkgVersion("koffi") === sourceVersion &&
	pkgVersion("@koromix", "koffi-win32-x64") === sourceVersion &&
	fs.existsSync(path.join(destModules, "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"));
/**
 * Ships license/attribution in the pack: `streamdeck pack` only bundles the
 * .sdPlugin directory, so without these copies the MIT license, koffi/sdpi
 * attribution and the REALiX non-affiliation disclosure would never reach
 * installed users. The native @koromix package has no license file of its
 * own — koffi's MIT text covers both (same project). All copies gitignored.
 */
function stageLegalFiles() {
	const sdPluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
	fs.copyFileSync(path.join(repoRoot, "LICENSE"), path.join(sdPluginDir, "LICENSE"));
	fs.copyFileSync(path.join(repoRoot, "NOTICE.md"), path.join(sdPluginDir, "NOTICE.md"));
	const koromixLicense = path.join(destModules, "@koromix", "koffi-win32-x64", "LICENSE.txt");
	if (fs.existsSync(path.dirname(koromixLicense))) {
		fs.copyFileSync(path.join(koffiSrc, "LICENSE.txt"), koromixLicense);
	}
}

if (vendoredComplete) {
	stageLegalFiles();
	console.log(`Vendored koffi ${sourceVersion} already in place — skipped (legal files staged).`);
	process.exit(0);
}

// Runtime loads ONLY the ESM chain: koffi/index.js → src/koffi/index.js →
// src/koffi/src/static.js → @koromix/koffi-win32-x64/index.js → koffi.node
// (verified via require.cache/import tracing; the plugin is pure ESM, so the
// CJS twins, the worker-thread `indirect` entry and index.d.ts never load).
// LICENSE.txt and package.json stay for attribution + module resolution.
const EXCLUDED_DIRS = new Set(["doc", "vendor", "lib", "node_modules", "abi"]);
const EXCLUDED_FILES = new Set(["cnoke.cjs", "CHANGELOG.md", "README.md", "CMakeLists.txt", "index.d.ts", "indirect.js"]);
const EXCLUDED_EXTS = new Set([".cc", ".hh", ".inc", ".def", ".lib", ".s", ".asm", ".cjs"]);

function includeEntry(src) {
	const name = path.basename(src);
	if (fs.statSync(src).isDirectory()) {
		return !EXCLUDED_DIRS.has(name);
	}
	return !EXCLUDED_FILES.has(name) && !EXCLUDED_EXTS.has(path.extname(name).toLowerCase());
}

function vendor(src, dest) {
	fs.rmSync(dest, { recursive: true, force: true });
	fs.cpSync(src, dest, { recursive: true, filter: includeEntry });
}

vendor(koffiSrc, path.join(destModules, "koffi"));
vendor(nativeSrc, path.join(destModules, "@koromix", "koffi-win32-x64"));
stageLegalFiles();

let total = 0;
for (const file of fs.readdirSync(destModules, { recursive: true, withFileTypes: true })) {
	if (file.isFile()) {
		// Dirent.parentPath landed in Node 20.12; older 20.x expose .path.
		total += fs.statSync(path.join(file.parentPath ?? file.path, file.name)).size;
	}
}
console.log(`Vendored koffi runtime into ${path.relative(repoRoot, destModules)} (${(total / 1024 / 1024).toFixed(1)} MB)`);
