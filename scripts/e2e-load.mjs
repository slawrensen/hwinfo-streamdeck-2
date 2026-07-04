// Load + every-sensor e2e: drives the BUILT plugin over a mock Stream Deck
// WebSocket with a key context for EVERY live HWiNFO reading (all ~518) plus
// dials, at a 250 ms poll, then churns appear/disappear/settings, soaks while
// sampling the plugin process RSS, and finally proves idle + clean self-exit.
//
//   npm run e2e:load                 (default 90 s soak)
//   LOAD_SOAK_SEC=30 npm run e2e:load
//
// PASS criteria: every reading context renders ≥1 valid frame; plugin
// survives churn; RSS peak < 300 MB and soak growth < 25 MB; zero frames
// after all actions disappear; process self-exits on socket close.
import { execFile, execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";

const PORT = 28995;
const SOAK_SEC = Number(process.env.LOAD_SOAK_SEC ?? "90");
const POLL_MS = 250;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures++;
}

// --- live reading inventory ----------------------------------------------------
console.log("enumerating live readings via probe...");
const { stdout: probeOut } = await promisify(execFile)(process.execPath, ["--import", "tsx", "src/probe.ts", "--json"], {
	cwd: repoRoot,
	timeout: 60_000,
	maxBuffer: 64 * 1024 * 1024
});
const snapshot = JSON.parse(probeOut);
const readings = snapshot.readings;
console.log(`live inventory: ${readings.length} readings / ${snapshot.sensors.length} sensors`);

// --- mock Stream Deck -----------------------------------------------------------
const framesByCtx = new Map(); // ctx → frame count
const feedbacksByCtx = new Map();
let totalFrames = 0;
let totalFeedbacks = 0;
let invalidFrames = 0;
let pluginWs = null;

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
wss.on("connection", (ws) => {
	pluginWs = ws;
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: { pollIntervalMs: String(POLL_MS) } } });
		} else if (msg.event === "setImage") {
			const image = msg.payload?.image ?? "";
			if (image.startsWith("data:image/svg+xml,") && decodeURIComponent(image.slice(19)).includes('viewBox="0 0 144 144"')) {
				framesByCtx.set(msg.context, (framesByCtx.get(msg.context) ?? 0) + 1);
				totalFrames++;
			} else {
				invalidFrames++;
			}
		} else if (msg.event === "setFeedback") {
			feedbacksByCtx.set(msg.context, (feedbacksByCtx.get(msg.context) ?? 0) + 1);
			totalFeedbacks++;
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

const registered = new Promise((resolve) => {
	wss.on("connection", (ws) => ws.on("message", (d) => JSON.parse(d.toString()).event === "registerPlugin" && resolve()));
});

// --- plugin under test ----------------------------------------------------------
const plugin = spawn(
	process.execPath,
	["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "e2e-load", "-registerEvent", "registerPlugin", "-info",
		JSON.stringify({
			application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
			colors: {},
			devicePixelRatio: 1,
			devices: [{ id: "dev1", name: "Load Deck", size: { columns: 5, rows: 3 }, type: 0 }],
			plugin: { uuid: "com.lawrensen.hwinfo", version: "1.1.0.0" }
		})],
	{ cwd: pluginDir, stdio: ["ignore", "inherit", "inherit"] }
);
let pluginExited = null;
const exitPromise = new Promise((resolve) => plugin.once("exit", (code) => { pluginExited = code; resolve(code); }));

function rssMB() {
	try {
		const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${plugin.pid}).WorkingSet64`], { encoding: "utf8", timeout: 15_000 });
		return Math.round((Number(out.trim()) / 1048576) * 10) / 10;
	} catch {
		return -1;
	}
}

const keyAppear = (ctx, reading, extra = {}) => ({
	event: "willAppear",
	action: "com.lawrensen.hwinfo.reading",
	context: ctx,
	device: "dev1",
	payload: { settings: { readingKey: reading.key, ...extra }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
});
const keyDisappear = (ctx, reading) => ({
	event: "willDisappear",
	action: "com.lawrensen.hwinfo.reading",
	context: ctx,
	device: "dev1",
	payload: { settings: { readingKey: reading.key }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
});

const DIALS = 8;

try {
	await Promise.race([registered, sleep(10_000)]);
	check("plugin registered", pluginWs !== null);
	const rssStart = rssMB();

	// Phase 1 — every-sensor sweep: one key context per live reading + dials.
	for (let i = 0; i < readings.length; i++) {
		send(keyAppear(`k${i}`, readings[i], i % 3 === 0 ? { sparkline: true } : {}));
	}
	for (let d = 0; d < DIALS; d++) {
		send({
			event: "willAppear",
			action: "com.lawrensen.hwinfo.dial",
			context: `dial${d}`,
			device: "dev1",
			payload: { settings: { readingKey: readings[d * 7 % readings.length].key }, coordinates: { column: d % 4, row: 0 }, controller: "Encoder", isInMultiAction: false }
		});
	}
	const sweepDeadline = Date.now() + 30_000;
	let missing = readings.length;
	while (Date.now() < sweepDeadline) {
		missing = 0;
		for (let i = 0; i < readings.length; i++) {
			if ((framesByCtx.get(`k${i}`) ?? 0) === 0) missing++;
		}
		if (missing === 0) break;
		await sleep(500);
	}
	check(`every reading rendered (${readings.length} contexts)`, missing === 0, missing === 0 ? `${totalFrames} frames` : `${missing} contexts frameless`);
	const dialsSeen = Array.from({ length: DIALS }, (_, d) => feedbacksByCtx.get(`dial${d}`) ?? 0).filter((n) => n > 0).length;
	check(`all ${DIALS} dials rendered feedback`, dialsSeen === DIALS, `${dialsSeen}/${DIALS}, ${totalFeedbacks} feedbacks`);
	check("no invalid frames", invalidFrames === 0, `${invalidFrames}`);

	// Phase 2 — churn: appear/disappear waves, settings variants, dial rotates, key presses.
	const framesBeforeChurn = totalFrames;
	for (let round = 0; round < 12 && pluginExited === null; round++) {
		for (let i = round % 2; i < readings.length; i += 2) {
			send(keyDisappear(`k${i}`, readings[i]));
		}
		await sleep(400);
		for (let i = round % 2; i < readings.length; i += 2) {
			send(keyAppear(`k${i}`, readings[i], { sparkline: round % 3 === 0, fahrenheit: round % 4 === 0, statMode: ["current", "min", "max", "avg"][round % 4] }));
		}
		for (let d = 0; d < DIALS; d++) {
			send({ event: "dialRotate", action: "com.lawrensen.hwinfo.dial", context: `dial${d}`, device: "dev1", payload: { settings: {}, coordinates: { column: d % 4, row: 0 }, ticks: round % 2 === 0 ? 1 : -1, pressed: false } });
		}
		send({ event: "keyDown", action: "com.lawrensen.hwinfo.reading", context: `k${round}`, device: "dev1", payload: { settings: { readingKey: readings[round].key }, coordinates: { column: 0, row: 0 } } });
		await sleep(400);
	}
	check("plugin survived churn (12 waves × ~260 contexts)", pluginExited === null, pluginExited === null ? `${totalFrames - framesBeforeChurn} frames during churn` : `exited code ${pluginExited}`);

	// Phase 3 — soak with everything visible; RSS must stay bounded.
	const samples = [rssMB()];
	const soakEnd = Date.now() + SOAK_SEC * 1000;
	while (Date.now() < soakEnd && pluginExited === null) {
		await sleep(Math.min(15_000, Math.max(1000, soakEnd - Date.now())));
		samples.push(rssMB());
	}
	const valid = samples.filter((s) => s > 0);
	const peak = Math.max(...valid);
	const growth = valid[valid.length - 1] - valid[0];
	console.log(`RSS samples (MB): start=${rssStart} ${valid.join(" → ")}`);
	check(`soak ${SOAK_SEC}s: RSS peak < 300 MB`, peak < 300, `peak ${peak} MB`);
	check("soak: RSS growth < 25 MB", growth < 25, `${growth >= 0 ? "+" : ""}${growth.toFixed(1)} MB over ${valid.length} samples`);
	check("plugin alive after soak", pluginExited === null);

	// Phase 4 — all actions gone → poller idles → socket close → self-exit.
	for (let i = 0; i < readings.length; i++) {
		send(keyDisappear(`k${i}`, readings[i]));
	}
	for (let d = 0; d < DIALS; d++) {
		send({ event: "willDisappear", action: "com.lawrensen.hwinfo.dial", context: `dial${d}`, device: "dev1", payload: { settings: {}, coordinates: { column: d % 4, row: 0 }, controller: "Encoder", isInMultiAction: false } });
	}
	await sleep(1000);
	const framesAtIdle = totalFrames + totalFeedbacks;
	await sleep(3 * POLL_MS + 1000);
	check("poller idles (zero frames after mass disappear)", totalFrames + totalFeedbacks === framesAtIdle, `${totalFrames + totalFeedbacks - framesAtIdle} late frames`);

	for (const client of wss.clients) {
		client.close();
	}
	wss.close();
	const code = await Promise.race([exitPromise, sleep(5000).then(() => "timeout")]);
	check("plugin self-exits on socket close", code === 0, `exit ${code}`);
} finally {
	if (pluginExited === null) {
		plugin.kill();
	}
	wss.close();
}

console.log(`\nmetrics: contexts=${readings.length}+${DIALS} dials, frames=${totalFrames}, feedbacks=${totalFeedbacks}, invalid=${invalidFrames}`);
console.log(failures === 0 ? "\nLOAD E2E: ALL CHECKS PASSED" : `\nLOAD E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
