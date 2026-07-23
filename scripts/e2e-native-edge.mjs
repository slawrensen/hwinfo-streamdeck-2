// Native-boundary edge e2e: drives the BUILT plugin through the conditions
// the hwsm capability API must fail closed on, asserting on rendered frames:
//
//   mapping present, mutex ABSENT  → "Start HWiNFO" (never an unguarded read)
//   mutex appears                  → live value (recovery)
//   published layout GROWS mid-run → session invalidates → reopen → live again
//   protocol-mismatched hwsm.node  → "Plugin damaged" (loader fails closed)
//
// The mismatch leg runs a second plugin instance from a scratch bundle whose
// hwsm.node is the hwsm_protomm build (HWSM_PROTOCOL_VERSION=999).
// Run with `npm run e2e:native-edge` (after `npm run build`).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = 28995;
const MISMATCH_PORT = 28994;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const MAPPING_NAME = `Local\\HwinfoE2E_Edge_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const READING_KEY = "f0001234:0:1000001"; // "Test Temp" in the fake provider

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures++;
}

function makeServer(port, context, frames) {
	const wss = new WebSocketServer({ host: "127.0.0.1", port });
	let ws = null;
	wss.on("connection", (socket) => {
		ws = socket;
		socket.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.event === "registerPlugin") {
				socket.send(JSON.stringify({
					event: "willAppear",
					action: "com.lawrensen.hwinfo.reading",
					context,
					device: "dev1",
					payload: { settings: { readingKey: READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
				}));
			} else if (msg.event === "getGlobalSettings") {
				socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: {} } }));
			} else if (msg.event === "setImage" && msg.context === context) {
				const image = msg.payload?.image ?? "";
				if (image.startsWith("data:image/svg+xml,")) {
					frames.push(decodeURIComponent(image.slice("data:image/svg+xml,".length)));
				}
			}
		});
	});
	return { wss, send: (obj) => ws?.send(JSON.stringify(obj)) };
}

async function expectFrame(frames, name, predicate, timeoutMs, { fromStart = false } = {}) {
	const start = Date.now();
	// A one-shot status screen renders exactly once at plugin startup; a leg
	// asserting on it must scan the whole history, not just new frames.
	let from = fromStart ? 0 : frames.length;
	while (Date.now() - start < timeoutMs) {
		while (from < frames.length) {
			if (predicate(frames[from])) {
				check(name, true, `after ${((Date.now() - start) / 1000).toFixed(1)}s`);
				return;
			}
			from++;
		}
		await sleep(150);
	}
	check(name, false, `no matching frame within ${timeoutMs / 1000}s (last: ${frames.at(-1)?.slice(0, 160) ?? "none"})`);
}

function spawnPlugin(entry, cwd, port, uuid) {
	return spawn(
		process.execPath,
		[entry, "-port", String(port), "-pluginUUID", uuid, "-registerEvent", "registerPlugin", "-info",
			JSON.stringify({
				application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
				colors: {},
				devicePixelRatio: 1,
				devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }],
				plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
			})],
		{
			cwd,
			env: {
				...process.env,
				HWINFO_SM2_NAME: MAPPING_NAME,
				HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
				HWINFO_VSB_KEY: `Software\\HwinfoE2E_NoVSB_${process.pid}`,
				HWINFO_STALE_AFTER_MS: "2500",
				HWINFO_REOPEN_PROBE_MS: "1000"
			},
			stdio: ["ignore", "inherit", "inherit"]
		}
	);
}

// --- leg 1: mutex-absent, recovery, layout growth ---------------------------
const frames = [];
const { wss } = makeServer(PORT, "ctx-edge", frames);

const fake = spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs"), "--no-mutex"], {
	env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME },
	stdio: ["pipe", "pipe", "inherit"]
});
await new Promise((resolve, reject) => {
	fake.stdout.on("data", (d) => {
		if (d.toString().includes("READY")) resolve();
	});
	setTimeout(() => reject(new Error("fake provider did not become ready")), 5000);
});

const plugin = spawnPlugin("bin/plugin.js", pluginDir, PORT, "e2e-native-edge");

// --- leg 2: protocol mismatch in a scratch bundle ---------------------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hwsm-protomm-"));
fs.mkdirSync(path.join(scratch, "bin"), { recursive: true });
fs.copyFileSync(path.join(pluginDir, "bin", "plugin.js"), path.join(scratch, "bin", "plugin.js"));
fs.copyFileSync(path.join(repoRoot, "native", "hwsm", "build", "Release", "hwsm_protomm.node"), path.join(scratch, "bin", "hwsm.node"));
// The bundle reads these relative to bin/.. at startup.
fs.copyFileSync(path.join(pluginDir, "themes.json"), path.join(scratch, "themes.json"));
fs.copyFileSync(path.join(pluginDir, "manifest.json"), path.join(scratch, "manifest.json"));
const mismatchFrames = [];
const { wss: mismatchWss } = makeServer(MISMATCH_PORT, "ctx-mm", mismatchFrames);
const mismatchPlugin = spawnPlugin(path.join(scratch, "bin", "plugin.js"), scratch, MISMATCH_PORT, "e2e-protomm");

try {
	// Mapping exists, mutex does not: the reader must treat this as "still
	// starting up", never as permission to read unguarded.
	await expectFrame(frames, "mapping without mutex → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 8000);

	fake.stdin.write("mutex\n");
	await expectFrame(frames, "mutex appears → live 'Test Temp' value", (svg) => svg.includes("Test Temp") && svg.includes("°C"), 8000);

	// The published layout grows mid-session: the exact-length session must
	// invalidate, and the poller must reopen at the new exact size WITHIN the
	// same tick. The pre-hwsm builds mapped the whole section and absorbed
	// growth invisibly; the in-place reopen must match, so no status screen
	// may reach the deck during the transition.
	const beforeGrow = frames.length;
	fake.stdin.write("grow\n");
	await sleep(300);
	await expectFrame(frames, "layout grows → live values continue (reopened in place)", (svg) => svg.includes("Test Temp"), 10000);
	const flashed = frames.slice(beforeGrow).filter((svg) => svg.includes("HWiNFO error") || svg.includes("HWiNFO stalled") || svg.includes("Start HWiNFO"));
	check("no status frame during the growth transition", flashed.length === 0, flashed.length > 0 ? `${flashed.length} status frame(s) reached the deck` : "");

	// A plugin.js next to a wrong-protocol hwsm.node must fail closed.
	await expectFrame(mismatchFrames, "protocol-mismatched addon → 'Plugin damaged'", (svg) => svg.includes("Plugin damaged"), 10000, { fromStart: true });
} finally {
	const gone = Promise.all([plugin, mismatchPlugin].map((p) => new Promise((r) => { p.once("exit", r); p.kill(); })));
	fake.kill();
	wss.close();
	mismatchWss.close();
	await Promise.race([gone, sleep(3000)]);
	for (let i = 0; i < 5; i++) {
		try {
			fs.rmSync(scratch, { recursive: true, force: true });
			break;
		} catch {
			await sleep(400); // the killed process may still hold hwsm.node mapped
		}
	}
}

console.log(failures === 0 ? "\nNATIVE-EDGE E2E: ALL CHECKS PASSED" : `\nNATIVE-EDGE E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
