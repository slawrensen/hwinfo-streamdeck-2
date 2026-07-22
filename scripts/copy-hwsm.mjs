// Vendors the hwsm native bridge into the .sdPlugin bundle. hwsm is an
// N-API addon (native/hwsm, built by `npm run build:native`) and cannot be
// inlined by rollup; it ships as bin/hwsm.node next to the bundled
// plugin.js, where the loader's createRequire("./hwsm.node") finds it.
//
// Replacement is careful because Windows locks a loaded .node until the
// owning process exits: identical bytes are skipped, changed bytes are
// staged to a temporary file in the destination directory, verified by
// hash, and swapped in with rename. A locked destination fails CLEANLY —
// the working old binary stays byte-identical, the temp file is removed,
// and the fix (stop the plugin) is printed. A half-written hwsm.node can
// never occur.
//
// Also stages the license/attribution files into the pack: `streamdeck pack`
// only bundles the .sdPlugin directory, so without these copies the MIT
// license and the REALiX non-affiliation disclosure would never reach
// installed users. All copies gitignored.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(repoRoot, "native", "hwsm", "build", "Release", "hwsm.node");
const sdPluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const destDir = path.join(sdPluginDir, "bin");
const dest = path.join(destDir, "hwsm.node");

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

if (!fs.existsSync(built)) {
	console.error(`Missing ${path.relative(repoRoot, built)} — run \`npm run build:native\` first (needs the MSVC build tools node-gyp expects).`);
	process.exit(1);
}

fs.copyFileSync(path.join(repoRoot, "LICENSE"), path.join(sdPluginDir, "LICENSE"));
fs.copyFileSync(path.join(repoRoot, "NOTICE.md"), path.join(sdPluginDir, "NOTICE.md"));

fs.mkdirSync(destDir, { recursive: true });

// Stale staging files from an earlier failed swap: safe to clear, never the
// destination itself. Removal can fail if that temp is itself in use; a
// leftover here must not fail the build.
for (const entry of fs.readdirSync(destDir)) {
	if (entry.startsWith("hwsm.node.staging-")) {
		try {
			fs.rmSync(path.join(destDir, entry));
		} catch {
			console.error(`Warning: could not remove stale ${entry}; continuing.`);
		}
	}
}

const builtHash = sha256(built);
if (fs.existsSync(dest) && sha256(dest) === builtHash) {
	console.log("Vendored hwsm.node already current — skipped (legal files staged).");
	process.exit(0);
}

// Stage next to the destination (same volume, so the final rename is a
// metadata swap, not a copy), verify the staged bytes, then swap.
const staging = path.join(destDir, `hwsm.node.staging-${process.pid}`);
try {
	fs.copyFileSync(built, staging);
	const stagedHash = sha256(staging);
	if (stagedHash !== builtHash) {
		throw new Error(`staged copy hash mismatch (${stagedHash} != ${builtHash})`);
	}
	fs.renameSync(staging, dest);
} catch (err) {
	try {
		fs.rmSync(staging, { force: true });
	} catch {
		// The staging file itself is busy; leave it for the next run's sweep.
	}
	const code = err?.code ?? "";
	if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
		console.error(`bin/hwsm.node is loaded by the running plugin and cannot be replaced (${code}).`);
		console.error("The previous binary is untouched. Swap it in ONE chained command so the");
		console.error("stop window stays seconds long (a long window makes the Stream Deck app");
		console.error("orphan the profile tiles into '?' placeholders until an app relaunch):");
		console.error("  streamdeck stop com.lawrensen.hwinfo && npm run build && streamdeck restart com.lawrensen.hwinfo");
		process.exit(1);
	}
	console.error(`Vendoring hwsm.node failed: ${err?.message ?? err}`);
	process.exit(1);
}

const verifyHash = sha256(dest);
if (verifyHash !== builtHash) {
	console.error(`Vendored hwsm.node hash mismatch after swap (${verifyHash} != ${builtHash}).`);
	process.exit(1);
}
console.log(`Vendored hwsm.node (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, sha256 ${builtHash.slice(0, 12)}…) into ${path.relative(repoRoot, dest)}`);
