// Vendors the hwsm native bridge into the .sdPlugin bundle. hwsm is an
// N-API addon (native/hwsm, built by `npm run build:native`) and cannot be
// inlined by rollup; it ships as bin/hwsm.node next to the bundled
// plugin.js, where the loader's createRequire("./hwsm.node") finds it.
//
// Also stages the license/attribution files into the pack: `streamdeck pack`
// only bundles the .sdPlugin directory, so without these copies the MIT
// license and the REALiX non-affiliation disclosure would never reach
// installed users. All copies gitignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(repoRoot, "native", "hwsm", "build", "Release", "hwsm.node");
const sdPluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const dest = path.join(sdPluginDir, "bin", "hwsm.node");

if (!fs.existsSync(built)) {
	console.error(`Missing ${path.relative(repoRoot, built)} — run \`npm run build:native\` first (needs the MSVC build tools node-gyp expects).`);
	process.exit(1);
}

fs.copyFileSync(path.join(repoRoot, "LICENSE"), path.join(sdPluginDir, "LICENSE"));
fs.copyFileSync(path.join(repoRoot, "NOTICE.md"), path.join(sdPluginDir, "NOTICE.md"));

// When the plugin is running, Windows locks the loaded hwsm.node — skip the
// copy when the vendored bytes already match (keeps `npm run build` working
// while the plugin is live; a changed addon needs
// `streamdeck stop com.lawrensen.hwinfo` first).
if (fs.existsSync(dest) && fs.readFileSync(dest).equals(fs.readFileSync(built))) {
	console.log("Vendored hwsm.node already current — skipped (legal files staged).");
	process.exit(0);
}
fs.copyFileSync(built, dest);
console.log(`Vendored hwsm.node (${(fs.statSync(dest).size / 1024).toFixed(0)} KB) into ${path.relative(repoRoot, dest)}`);
