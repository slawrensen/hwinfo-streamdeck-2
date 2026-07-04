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

const EXCLUDED_DIRS = new Set(["doc", "vendor", "lib", "node_modules"]);
const EXCLUDED_FILES = new Set(["cnoke.cjs", "CHANGELOG.md", "README.md", "CMakeLists.txt"]);
const EXCLUDED_EXTS = new Set([".cc", ".hh", ".inc", ".def", ".lib"]);

function includeEntry(src) {
	const name = path.basename(src);
	if (fs.statSync(src).isDirectory()) {
		return !EXCLUDED_DIRS.has(name);
	}
	return !EXCLUDED_FILES.has(name) && !EXCLUDED_EXTS.has(path.extname(name));
}

function vendor(src, dest) {
	fs.rmSync(dest, { recursive: true, force: true });
	fs.cpSync(src, dest, { recursive: true, filter: includeEntry });
}

vendor(koffiSrc, path.join(destModules, "koffi"));
vendor(nativeSrc, path.join(destModules, "@koromix", "koffi-win32-x64"));

let total = 0;
for (const file of fs.readdirSync(destModules, { recursive: true, withFileTypes: true })) {
	if (file.isFile()) {
		total += fs.statSync(path.join(file.parentPath, file.name)).size;
	}
}
console.log(`Vendored koffi runtime into ${path.relative(repoRoot, destModules)} (${(total / 1024 / 1024).toFixed(1)} MB)`);
