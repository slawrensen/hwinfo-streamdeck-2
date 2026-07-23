// Loads ONE exact hwsm.node (no rebuild) under whatever Node runtime runs
// this script, and proves the full lifecycle against a private synthetic
// mapping: require, getBuildInfo, open, byteLength, one guarded read,
// close. Used by the CI matrix to load the same Node-20-built binary under
// Node 20, 22, and 24, and locally against any runtime on the machine.
//
//   node scripts/abi-check.mjs [path\to\hwsm.node]
//
// Prints one PASS line with the runtime facts, or exits nonzero.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addonPath = path.resolve(process.argv[2] ?? path.join(repoRoot, "native", "hwsm", "build", "Release", "hwsm.node"));

if (process.platform !== "win32" || process.arch !== "x64") {
	console.error("abi-check: win32-x64 only");
	process.exit(1);
}
const sha = createHash("sha256").update(fs.readFileSync(addonPath)).digest("hex");

const require = createRequire(import.meta.url);
const bridge = require(addonPath);
const info = bridge.getBuildInfo();
if (info.napiVersion !== 8 || info.architecture !== "x64" || typeof info.protocolVersion !== "number") {
	console.error(`abi-check: unexpected build info ${JSON.stringify(info)}`);
	process.exit(1);
}

// Synthetic producer: a plain-Node child writes a minimal valid layout
// (1 sensor / 2 entries => 940 bytes) through the koffi test producer.
const mapping = `Local\\HwsmAbi_${process.pid}`;
const mutex = `${mapping}_MUTEX`;
const producer = spawn(process.execPath, [path.join(repoRoot, "scripts", "native-test-producer.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
const replies = [];
const waiters = [];
let acc = "";
producer.stdout.setEncoding("utf8");
producer.stdout.on("data", (chunk) => {
	acc += chunk;
	let nl;
	while ((nl = acc.indexOf("\n")) >= 0) {
		const line = acc.slice(0, nl).trim();
		acc = acc.slice(nl + 1);
		if (line.length > 0) {
			const w = waiters.shift();
			if (w) w(JSON.parse(line));
			else replies.push(JSON.parse(line));
		}
	}
});
const recv = () => new Promise((resolve, reject) => {
	if (replies.length > 0) return resolve(replies.shift());
	const t = setTimeout(() => reject(new Error("producer timeout")), 10_000);
	waiters.push((r) => { clearTimeout(t); resolve(r); });
});
const send = async (cmd) => {
	producer.stdin.write(JSON.stringify(cmd) + "\n");
	const r = await recv();
	if (!r.ok) throw new Error(`producer ${cmd.cmd}: ${r.error}`);
	return r;
};

try {
	await recv(); // ready
	await send({ cmd: "create", size: 4096, mapping, mutex });
	const header = Buffer.alloc(44);
	header.writeUInt32LE(0x53695748, 0); // "HWiS"
	header.writeUInt32LE(1, 4);
	header.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 12);
	header.writeUInt32LE(44, 20);
	header.writeUInt32LE(264, 24);
	header.writeUInt32LE(1, 28);
	header.writeUInt32LE(308, 32);
	header.writeUInt32LE(316, 36);
	header.writeUInt32LE(2, 40);
	await send({ cmd: "write", offset: 0, dataBase64: header.toString("base64") });

	const session = bridge.openSharedMemory(mapping, mutex);
	const expected = 44 + 264 + 2 * 316;
	if (session.byteLength !== expected) throw new Error(`byteLength ${session.byteLength} != ${expected}`);
	const dest = Buffer.alloc(session.byteLength);
	const n = session.readInto(dest);
	if (n !== expected) throw new Error(`readInto returned ${n}`);
	if (dest.readUInt32LE(0) !== 0x53695748) throw new Error("copied header magic mismatch");
	session.close();
	session.close();

	console.log(`ABI-CHECK PASS node=${process.version} napi=${process.versions.napi} modules=${process.versions.modules} addon=sha256:${sha.slice(0, 16)}… protocol=${info.protocolVersion} native=${info.nativeVersion} sourceId=${info.nativeSourceId}`);
} finally {
	await send({ cmd: "exit" }).catch(() => producer.kill());
}
