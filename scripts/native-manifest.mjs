// Generates release-native-manifest.json: the complete build facts for the
// shipped hwsm.node (hash, size, PE architecture and hardening, imports,
// Node-API/protocol/native versions, toolchain). The release workflow
// attaches it next to the plugin package so an administrator can verify the
// exact native binary a release contains without unpacking anything.
//
// Self-contained PE parsing (no dumpbin dependency): COFF machine, linker
// version, DllCharacteristics, import + delay-import DLL names, and the
// debug directory's repro and CET entries.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin", "bin", "hwsm.node");
const outPath = path.join(repoRoot, "release-native-manifest.json");

if (!fs.existsSync(target)) {
	console.error(`native-manifest: ${path.relative(repoRoot, target)} not found — run \`npm run build\` first.`);
	process.exit(1);
}
const bytes = fs.readFileSync(target);

function parsePe(buf) {
	const lfanew = buf.readUInt32LE(0x3c);
	if (buf.readUInt32LE(lfanew) !== 0x00004550) {
		throw new Error("not a PE image");
	}
	const coff = lfanew + 4;
	const machine = buf.readUInt16LE(coff);
	const numberOfSections = buf.readUInt16LE(coff + 2);
	const sizeOfOptionalHeader = buf.readUInt16LE(coff + 16);
	const opt = coff + 20;
	const magic = buf.readUInt16LE(opt);
	if (magic !== 0x20b) {
		throw new Error(`unexpected optional-header magic 0x${magic.toString(16)} (not PE32+)`);
	}
	const linker = `${buf.readUInt8(opt + 2)}.${buf.readUInt8(opt + 3)}`;
	const dllCharacteristics = buf.readUInt16LE(opt + 70);
	const dataDirs = opt + 112; // PE32+
	const dir = (i) => ({ rva: buf.readUInt32LE(dataDirs + i * 8), size: buf.readUInt32LE(dataDirs + i * 8 + 4) });

	const sections = [];
	let sec = opt + sizeOfOptionalHeader;
	for (let i = 0; i < numberOfSections; i++, sec += 40) {
		sections.push({
			virtualAddress: buf.readUInt32LE(sec + 12),
			sizeOfRawData: buf.readUInt32LE(sec + 16),
			pointerToRawData: buf.readUInt32LE(sec + 20)
		});
	}
	const rvaToOffset = (rva) => {
		for (const s of sections) {
			if (rva >= s.virtualAddress && rva < s.virtualAddress + s.sizeOfRawData) {
				return s.pointerToRawData + (rva - s.virtualAddress);
			}
		}
		return -1;
	};
	const cstr = (off) => {
		let end = off;
		while (end < buf.length && buf[end] !== 0) end++;
		return buf.toString("latin1", off, end);
	};

	const imports = [];
	const imp = dir(1);
	const impStart = imp.rva !== 0 ? rvaToOffset(imp.rva) : -1;
	if (impStart >= 0) {
		for (let d = impStart; ; d += 20) {
			const nameRva = buf.readUInt32LE(d + 12);
			if (nameRva === 0 && buf.readUInt32LE(d) === 0) break;
			if (nameRva !== 0) imports.push(cstr(rvaToOffset(nameRva)));
		}
	}
	const delayImports = [];
	const delay = dir(13);
	const delayStart = delay.rva !== 0 ? rvaToOffset(delay.rva) : -1;
	if (delayStart >= 0) {
		for (let d = delayStart; ; d += 32) {
			const nameRva = buf.readUInt32LE(d + 4);
			if (nameRva === 0) break;
			delayImports.push(cstr(rvaToOffset(nameRva)));
		}
	}

	let repro = false;
	let cetCompat = false;
	const dbg = dir(6);
	if (dbg.rva !== 0) {
		const base = rvaToOffset(dbg.rva);
		for (let d = base; d < base + dbg.size; d += 28) {
			const type = buf.readUInt32LE(d + 12);
			if (type === 16) repro = true; // IMAGE_DEBUG_TYPE_REPRO
			if (type === 20) {
				// IMAGE_DEBUG_TYPE_EX_DLLCHARACTERISTICS: bit 0 = CET compat
				const raw = buf.readUInt32LE(d + 24);
				if (raw > 0 && raw < buf.length) cetCompat = (buf.readUInt32LE(raw) & 0x01) !== 0;
			}
		}
	}

	return {
		machine: machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : `0x${machine.toString(16)}`,
		linkerVersion: linker,
		imports,
		delayImports,
		hardening: {
			highEntropyVa: (dllCharacteristics & 0x0020) !== 0,
			dynamicBase: (dllCharacteristics & 0x0040) !== 0,
			nxCompat: (dllCharacteristics & 0x0100) !== 0,
			controlFlowGuard: (dllCharacteristics & 0x4000) !== 0,
			cetCompat,
			reproducibleLink: repro
		}
	};
}

const pe = parsePe(bytes);

// Load the exact file being described (win32-x64 only) for its own report.
let buildInfo = null;
if (process.platform === "win32" && process.arch === "x64") {
	const require = createRequire(import.meta.url);
	buildInfo = require(target).getBuildInfo();
}

const strip = (v) => (v ?? "").replace(/[\\/]+$/, "");
const manifest = {
	file: path.basename(target),
	sha256: createHash("sha256").update(bytes).digest("hex"),
	byteSize: bytes.length,
	machine: pe.machine,
	linkerVersion: pe.linkerVersion,
	imports: pe.imports,
	delayImports: pe.delayImports,
	hardening: pe.hardening,
	napiVersion: buildInfo?.napiVersion ?? null,
	protocolVersion: buildInfo?.protocolVersion ?? null,
	nativeVersion: buildInfo?.nativeVersion ?? null,
	nativeSourceId: buildInfo?.nativeSourceId ?? null,
	compileDefines: ["NAPI_VERSION=8"],
	// Toolchain facts come from the build environment when it exports them
	// (CI does); "unknown" is honest for a bare local run.
	compilerVersion: process.env.HWSM_CL_VERSION || "unknown",
	windowsSdkVersion: strip(process.env.WindowsSDKVersion) || "unknown",
	buildNodeVersion: process.version,
	buildWorkflowRun: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
};

fs.writeFileSync(outPath, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`native manifest → ${path.relative(repoRoot, outPath)}`);
console.log(`  ${manifest.file} ${manifest.byteSize} bytes sha256=${manifest.sha256.slice(0, 16)}… ${manifest.machine} napi=${manifest.napiVersion} protocol=${manifest.protocolVersion} native=${manifest.nativeVersion}`);
console.log(`  hardening: ${Object.entries(manifest.hardening).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
console.log(`  imports: ${manifest.imports.join(", ")} | delay: ${manifest.delayImports.join(", ")}`);
