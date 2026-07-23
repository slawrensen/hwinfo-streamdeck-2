// Native packaging gate, part of `npm run release:validate` (and CI): the
// .sdPlugin bundle must carry exactly the release hwsm.node this plugin.js
// expects — no test builds, no staging leftovers, no koffi, no PDB — and
// the addon's own protocol/ABI report must match the TypeScript loader.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sd = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const binDir = path.join(sd, "bin");
const addonPath = path.join(binDir, "hwsm.node");

const failures = [];
const fail = (msg) => failures.push(msg);

// 1. The addon exists where the loader looks for it.
if (!fs.existsSync(addonPath)) {
	fail("bin/hwsm.node is missing — run `npm run build`.");
} else {
	// 2. It loads, and its self-report matches the TypeScript contract.
	const loaderSrc = fs.readFileSync(path.join(repoRoot, "src", "hwinfo", "hwsm-loader.ts"), "utf8");
	const m = /HWSM_PROTOCOL_VERSION = (\d+)/.exec(loaderSrc);
	const tsProtocol = m ? Number(m[1]) : NaN;
	if (!Number.isFinite(tsProtocol)) {
		fail("could not read HWSM_PROTOCOL_VERSION from src/hwinfo/hwsm-loader.ts");
	}
	if (process.platform === "win32" && process.arch === "x64") {
		try {
			const require = createRequire(import.meta.url);
			const info = require(addonPath).getBuildInfo();
			if (info.protocolVersion !== tsProtocol) {
				fail(`bin/hwsm.node protocol ${info.protocolVersion} != TypeScript protocol ${tsProtocol} (stale vendored addon?)`);
			}
			if (info.napiVersion !== 8) {
				fail(`bin/hwsm.node reports Node-API ${info.napiVersion}, expected 8`);
			}
			if (info.architecture !== "x64") {
				fail(`bin/hwsm.node reports architecture ${info.architecture}, expected x64`);
			}
			if (info.nativeSourceId === "unset") {
				fail("bin/hwsm.node was built without scripts/native-source-id.mjs (nativeSourceId is 'unset') — rebuild with `npm run build:native`.");
			}
		} catch (err) {
			fail(`bin/hwsm.node failed to load: ${err?.message ?? err}`);
		}
	}
	// 3. Version resource sanity: the strings the .rc embeds must be present.
	const bytes = fs.readFileSync(addonPath);
	if (!bytes.includes(Buffer.from("OriginalFilename", "utf16le"))) {
		fail("bin/hwsm.node has no version resource (OriginalFilename missing).");
	}
}

// 4. Nothing test-only, temporary, or debug-only rides along in the pack.
const walk = (dir) => {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
};
for (const file of walk(sd)) {
	const name = path.basename(file);
	const rel = path.relative(sd, file);
	if (name === "hwsm_test.node" || name === "hwsm_protomm.node") fail(`test-only addon must not ship: ${rel}`);
	if (name.includes(".staging-")) fail(`staging leftover must not ship: ${rel}`);
	if (name.endsWith(".pdb")) fail(`PDB must not ship: ${rel}`);
	if (name.endsWith(".obj") || name.endsWith(".iobj") || name.endsWith(".ipdb")) fail(`intermediate object must not ship: ${rel}`);
	if (/koffi/i.test(name)) fail(`koffi must not ship: ${rel}`);
}

// 5. The bundled plugin.js must not reference koffi at runtime.
const pluginJs = path.join(binDir, "plugin.js");
if (fs.existsSync(pluginJs) && /require\(["']koffi/.test(fs.readFileSync(pluginJs, "utf8"))) {
	fail("bin/plugin.js references koffi — the shipped runtime must be koffi-free.");
}

// 6. When the native manifest exists it must describe these exact bytes.
const manifestPath = path.join(repoRoot, "release-native-manifest.json");
if (fs.existsSync(manifestPath) && fs.existsSync(addonPath)) {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const actual = createHash("sha256").update(fs.readFileSync(addonPath)).digest("hex");
	if (manifest.sha256 !== actual) {
		fail(`release-native-manifest.json sha256 ${manifest.sha256.slice(0, 12)}… does not match bin/hwsm.node ${actual.slice(0, 12)}… — regenerate with \`node scripts/native-manifest.mjs\`.`);
	}
}

if (failures.length > 0) {
	console.error(`NATIVE VALIDATION: ${failures.length} failure(s)`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log("NATIVE VALIDATION: OK (hwsm.node present, protocol/ABI consistent, pack clean)");
