// Gadget-registry backend e2e: shared memory is pointed at a nonexistent
// mapping so the plugin's "auto" source must fall back to the Gadget
// registry, which this script populates under a synthetic HKCU key.
//
//   registry populated  → live "Test Temp" value via gadget + gadget hint
//   value updated       → frame shows the new value
//   values frozen       → "Not updating" (digest-based staleness)
//   updates resume      → live again
//   key deleted         → "Start HWiNFO"
//
// Run with `npm run e2e:gadget` (after `npm run build`).
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = 28997;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const VSB_SUBKEY = `Software\\HwinfoE2E_VSB_${process.pid}`;
const REG_PATH = `HKCU\\${VSB_SUBKEY}`;
const READING_KEY = "g:Test Source:Test Temp";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = [];
const piPayloads = [];
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
	regSet("Sensor1", "Test Source");
	regSet("Label1", "Test Fan");
	regSet("Value1", "1200 RPM");
	regSet("ValueRaw1", "1200");
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
				context: "ctx-gadget",
				device: "dev1",
				payload: { settings: { readingKey: READING_KEY }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
			});
			send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-gadget", device: "dev1" });
			send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-gadget", payload: { event: "getSensorTree" } });
		} else if (msg.event === "getGlobalSettings") {
			send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
		} else if (msg.event === "setImage" && msg.context === "ctx-gadget") {
			const image = msg.payload?.image ?? "";
			if (image.startsWith("data:image/svg+xml,")) {
				frames.push(decodeURIComponent(image.slice("data:image/svg+xml,".length)));
			}
		} else if (msg.event === "sendToPropertyInspector") {
			piPayloads.push(msg.payload);
		}
	});
});
const send = (obj) => pluginWs?.send(JSON.stringify(obj));

// Registry primed BEFORE the plugin starts.
publish(47.5);

const plugin = spawn(
	process.execPath,
	["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "e2e-gadget", "-registerEvent", "registerPlugin", "-info",
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
			HWINFO_SM2_NAME: `Local\\HwinfoE2E_NoSuchMapping_${process.pid}`, // force SM unavailable
			HWINFO_VSB_KEY: VSB_SUBKEY,
			HWINFO_STALE_AFTER_MS: "2500",
			HWINFO_REOPEN_PROBE_MS: "1000",
			HWINFO_UPGRADE_PROBE_MS: "3600000" // never upgrade during this test
		},
		stdio: ["ignore", "inherit", "inherit"]
	}
);

try {
	// 1. Auto-fallback: SM absent, gadget populated → live value.
	await expectFrame("auto-fallback → live gadget 'Test Temp'", (svg) => svg.includes("Test Temp") && svg.includes("°C") && svg.includes("47.5"), 8000);

	// 2. Values change → frame updates. Keep updating so the digest stays fresh.
	const updater = setInterval(() => publish((48.9 + Math.random() * 0.05).toFixed(2)), 700);
	await expectFrame("value update propagates", (svg) => svg.includes("48.9"), 8000);

	// 3. PI: sensor tree groups + gadget hint.
	await sleep(500);
	const tree = piPayloads.find((p) => p?.event === "sensorTree" && p.groups?.length > 0);
	const anyGadget = piPayloads.find((p) => p?.source === "gadget");
	check("PI sensorTree has the gadget group", tree !== undefined && tree.groups[0]?.name === "Test Source" && tree.groups[0]?.readings?.length === 2, JSON.stringify(tree?.groups ?? []).slice(0, 120));
	check("PI payloads report source=gadget with hint", anyGadget !== undefined && piPayloads.some((p) => typeof p?.hint === "string" && p.hint.includes("Gadget")), anyGadget?.hint?.slice(0, 80) ?? "");

	// 4. Freeze (HWiNFO exits — key remains, values stop changing) → stale.
	clearInterval(updater);
	await expectFrame("frozen registry → 'Not updating'", (svg) => svg.includes("Not updating"), 12000);

	// 5. Resume → live again.
	const updater2 = setInterval(() => publish((51.1 + Math.random() * 0.05).toFixed(2)), 700);
	await expectFrame("resumed updates → live again", (svg) => svg.includes("51.1"), 10000);
	clearInterval(updater2);

	// 6. Key deleted → unavailable.
	regDeleteKey();
	await expectFrame("key deleted → 'Start HWiNFO'", (svg) => svg.includes("Start HWiNFO"), 10000);
} finally {
	plugin.kill();
	wss.close();
	try {
		regDeleteKey();
	} catch {
		// already gone
	}
}

console.log(failures === 0 ? "\nGADGET E2E: ALL CHECKS PASSED" : `\nGADGET E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
