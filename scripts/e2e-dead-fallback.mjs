// Regression e2e for the DEAD-magic auto-fallback bug (v1.1.5): a present-but-
// "DEAD" shared-memory mapping (free HWiNFO after its 12 h limit leaves the
// named section behind) must NOT strand auto mode on "Shared Memory off" when
// the gadget registry is available — the poller must fall back to gadget and
// stay there across the shared-memory upgrade probes (which used to clobber the
// working gadget provider by "successfully" opening the dead mapping).
//
//   present DEAD mapping + populated gadget, auto → live gadget value
//   value keeps updating past the upgrade-probe interval (no clobber)
//
// Combines fake-hwinfo.mjs (the DEAD mapping) with a synthetic HKCU gadget key.
// Run with `npm run e2e:dead-fallback` (after `npm run build`).
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = 28999;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const MAPPING_NAME = `Local\\HwinfoDead_SM2_${process.pid}`;
const MUTEX_NAME = `${MAPPING_NAME}_MUTEX`;
const VSB_SUBKEY = `Software\\HwinfoDead_VSB_${process.pid}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;
const READING_KEY = "g:Test Source:Test Temp"; // gadget-format key

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = [];
let failures = 0;

function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures++;
}

async function expectFrame(name, predicate, timeoutMs) {
	const start = Date.now();
	let from = frames.length;
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

function regSet(name, value) {
	execSync(`reg add "${REG_PATH}" /v ${name} /t REG_SZ /d "${value}" /f`, { stdio: "ignore" });
}
function regDeleteKey() {
	execSync(`reg delete "${REG_PATH}" /f`, { stdio: "ignore" });
}
function publish(temp) {
	regSet("Sensor0", "Test Source");
	regSet("Label0", "Test Temp");
	regSet("Value0", `${temp} °C`);
	regSet("ValueRaw0", String(temp));
}

// --- mock Stream Deck ---------------------------------------------------------
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
let pluginWs = null;
wss.on("connection", (ws) => {
	pluginWs = ws;
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.event === "registerPlugin") {
			send({
				event: "willAppear",
				action: "com.lawrensen.hwinfo.reading",
				context: "ctx-dead",
				device: "dev1",
				payload: { settings: { readingKey: READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
			});
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: {} } }); // source defaults to auto
		} else if (msg.event === "setImage" && msg.context === "ctx-dead") {
			const image = msg.payload?.image ?? "";
			if (image.startsWith("data:image/svg+xml,")) {
				frames.push(decodeURIComponent(image.slice("data:image/svg+xml,".length)));
			}
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

// --- fake shared memory, driven straight to DEAD -----------------------------
let fake = null;
function startFakeDead() {
	return new Promise((resolve, reject) => {
		fake = spawn(process.execPath, [path.join(repoRoot, "scripts", "fake-hwinfo.mjs")], {
			env: { ...process.env, HWINFO_SM2_NAME: MAPPING_NAME, HWINFO_SM2_MUTEX_NAME: MUTEX_NAME },
			stdio: ["pipe", "pipe", "inherit"]
		});
		fake.stdout.on("data", (d) => {
			const s = d.toString();
			if (s.includes("READY")) {
				fake.stdin.write("dead\n"); // present-but-DEAD mapping
			}
			if (s.includes("MODE dead")) {
				resolve();
			}
		});
		fake.on("exit", () => {
			fake = null;
		});
		setTimeout(() => reject(new Error("fake provider did not reach DEAD")), 5000);
	});
}

try {
	// Gadget populated + present DEAD shared-memory mapping, BEFORE the plugin runs.
	publish(47.5);
	await startFakeDead();

	const plugin = spawn(
		process.execPath,
		["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "e2e-dead-fallback", "-registerEvent", "registerPlugin", "-info",
			JSON.stringify({
				application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
				colors: {},
				devicePixelRatio: 1,
				devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }],
				plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
			})],
		{
			cwd: pluginDir,
			env: {
				...process.env,
				HWINFO_SM2_NAME: MAPPING_NAME,
				HWINFO_SM2_MUTEX_NAME: MUTEX_NAME,
				HWINFO_VSB_KEY: VSB_SUBKEY,
				HWINFO_STALE_AFTER_MS: "4000",
				HWINFO_REOPEN_PROBE_MS: "1000",
				HWINFO_UPGRADE_PROBE_MS: "1500" // probe SM often; a DEAD open must NOT clobber gadget
			},
			stdio: ["ignore", "inherit", "inherit"]
		}
	);
	try {
		// 1. Present DEAD mapping must not block the gadget fallback in auto mode.
		//    (Pre-fix: SharedMemoryProvider.open() "succeeds" on the dead mapping,
		//    so auto never reaches gadget and the key shows "Shared Memory off".)
		await expectFrame("present DEAD mapping → falls back to live gadget value", (svg) => svg.includes("Test Temp") && svg.includes("47.5"), 9000);
		const smFrames = frames.map((svg, i) => [i, svg]).filter(([, svg]) => svg.includes("Shared Memory"));
		if (smFrames.length > 0) {
			console.log(`  [diag] frame ${smFrames[0][0]} of ${frames.length}: ${smFrames[0][1].replace(/\s+/g, " ").slice(0, 220)}`);
		}
		check("never shows the 'Shared Memory off' screen", smFrames.length === 0, `${smFrames.length} such frame(s)`);

		// 2. Keep updating and outlast the 1.5 s upgrade probe: the probe opens the
		//    dead mapping and must throw (not clobber the working gadget provider).
		const updater = setInterval(() => publish((49.0 + Math.random() * 0.05).toFixed(2)), 600);
		await expectFrame("gadget survives upgrade probes → value keeps updating (no clobber)", (svg) => svg.includes("49.0"), 9000);
		clearInterval(updater);
	} finally {
		plugin.kill();
	}
} finally {
	fake?.stdin.write("exit\n");
	await sleep(300);
	fake?.kill();
	wss.close();
	try {
		regDeleteKey();
	} catch {
		// already gone
	}
}

console.log(failures === 0 ? "\nDEAD-FALLBACK E2E: FALLBACK + NO-CLOBBER VERIFIED" : `\nDEAD-FALLBACK E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
