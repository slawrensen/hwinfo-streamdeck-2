// End-to-end protocol harness: impersonates the Stream Deck app on a local
// WebSocket, launches the BUILT plugin (bin/plugin.js), drives key/dial/PI
// events, and asserts on the setImage / setFeedback / sendToPropertyInspector
// traffic that comes back. Requires HWiNFO running with shared memory —
// values asserted are live. Run with `npm run e2e` (after `npm run build`).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = 28999;
const READING_KEY = process.env.HW_E2E_KEY ?? "f0000501:0:1000000"; // CPU (Tctl/Tdie) on this machine
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {
	registered: false,
	images: [], // { context, image }
	feedbacks: [], // { context, payload }
	piPayloads: [], // payload
	setSettings: [], // { context, payload }
	errors: []
};

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
let finished = false;

wss.on("connection", (ws) => {
	const send = (obj) => ws.send(JSON.stringify(obj));
	ws.on("message", async (data) => {
		const msg = JSON.parse(data.toString());
		switch (msg.event) {
			case "registerPlugin":
				results.registered = true;
				await scenario(send);
				break;
			case "getGlobalSettings":
				send({ event: "didReceiveGlobalSettings", payload: { settings: {} } });
				break;
			case "setImage":
				results.images.push({ context: msg.context, image: msg.payload?.image ?? "" });
				break;
			case "setFeedback":
				results.feedbacks.push({ context: msg.context, payload: msg.payload });
				break;
			case "sendToPropertyInspector":
				results.piPayloads.push(msg.payload);
				break;
			case "setSettings":
				results.setSettings.push({ context: msg.context, payload: msg.payload });
				break;
			default:
				break;
		}
	});
});

async function scenario(send) {
	// Key with a real sensor + sparkline.
	send({
		event: "willAppear",
		action: "com.lawrensen.hwinfo.reading",
		context: "ctx-key",
		device: "dev1",
		payload: { settings: { readingKey: READING_KEY, sparkline: true }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
	});
	// Dial with no selection yet.
	send({
		event: "willAppear",
		action: "com.lawrensen.hwinfo.dial",
		context: "ctx-dial",
		device: "dev1",
		payload: { settings: {}, coordinates: { column: 0, row: 0 }, controller: "Encoder", isInMultiAction: false }
	});
	await sleep(3200); // a few poll ticks

	// Rotate: with no selection this must adopt the first reading.
	send({
		event: "dialRotate",
		action: "com.lawrensen.hwinfo.dial",
		context: "ctx-dial",
		device: "dev1",
		payload: { settings: {}, coordinates: { column: 0, row: 0 }, ticks: 2, pressed: false }
	});
	// Key press cycles stat mode → MIN.
	send({
		event: "keyDown",
		action: "com.lawrensen.hwinfo.reading",
		context: "ctx-key",
		device: "dev1",
		payload: { settings: { readingKey: READING_KEY, sparkline: true }, coordinates: { column: 0, row: 0 } }
	});
	// PI opens on the key and asks for the tree.
	send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", device: "dev1" });
	send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", payload: { event: "getSensorTree" } });
	await sleep(2600);
	finish();
}

function decodeSvg(image) {
	if (!image.startsWith("data:image/svg+xml,")) {
		return null;
	}
	return decodeURIComponent(image.slice("data:image/svg+xml,".length));
}

function check(name, ok, detail = "") {
	const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
	console.log(line);
	if (!ok) {
		results.errors.push(name);
	}
}

function finish() {
	if (finished) {
		return;
	}
	finished = true;

	check("plugin registered", results.registered);

	const keyImages = results.images.filter((i) => i.context === "ctx-key").map((i) => decodeSvg(i.image));
	check("key rendered as SVG data URI", keyImages.length > 0 && keyImages.every((s) => s !== null), `${keyImages.length} frames`);
	const first = keyImages[0] ?? "";
	check("key SVG shows the sensor label", first.includes("Tctl/Tdie"), first.slice(0, 120));
	check("key SVG shows a °C unit", first.includes("°C"));
	const valueMatch = first.match(/font-weight="700"[^>]*>([-\d.k]+)</);
	const value = valueMatch ? Number(valueMatch[1]) : NaN;
	check("key SVG value is a plausible CPU temp", Number.isFinite(value) && value > 15 && value < 120, `value=${value}`);
	check("key SVG includes sparkline polyline", keyImages.some((s) => s.includes("<polyline")));

	const minFrame = keyImages.find((s) => s.includes(">MIN<"));
	check("keyDown cycled stat mode to MIN", minFrame !== undefined);
	check("keyDown persisted statMode via setSettings", results.setSettings.some((s) => s.context === "ctx-key" && s.payload?.statMode === "min"));

	const dialFeedbacks = results.feedbacks.filter((f) => f.context === "ctx-dial");
	check("dial received feedback", dialFeedbacks.length > 0, `${dialFeedbacks.length} frames`);
	check("dial idle state prompts for selection", dialFeedbacks.some((f) => String(f.payload?.value ?? "").includes("rotate")));
	check("dialRotate adopted a reading + persisted it", results.setSettings.some((s) => s.context === "ctx-dial" && typeof s.payload?.readingKey === "string" && s.payload.readingKey.length > 0));
	const liveDial = dialFeedbacks.find((f) => typeof f.payload?.indicator === "number" && /[▼▲]/.test(String(f.payload?.stats ?? "")));
	check("dial shows live value + session stats + bar", liveDial !== undefined, JSON.stringify(liveDial?.payload ?? {}).slice(0, 140));

	const tree = results.piPayloads.find((p) => p?.event === "sensorTree");
	check("PI got sensorTree", tree !== undefined);
	check("sensorTree has many grouped readings", (tree?.groups?.length ?? 0) > 5 && tree.groups.reduce((n, g) => n + g.readings.length, 0) > 100, `groups=${tree?.groups?.length}, readings=${tree?.groups?.reduce((n, g) => n + g.readings.length, 0)}`);
	const preview = results.piPayloads.find((p) => p?.event === "preview" && p.reading);
	check("PI got live preview for selected reading", preview !== undefined, preview ? `${preview.reading.label}=${preview.reading.value}` : "");

	console.log(results.errors.length === 0 ? "\nE2E: ALL CHECKS PASSED" : `\nE2E: ${results.errors.length} FAILURES`);
	plugin.kill();
	wss.close();
	process.exit(results.errors.length === 0 ? 0 : 1);
}

// Registration info mirroring a real Stream Deck 7.4 registration.
const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
	colors: {},
	devicePixelRatio: 1,
	devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }],
	plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
};

const plugin = spawn(process.execPath, ["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "e2e-harness", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
	cwd: pluginDir,
	stdio: ["ignore", "inherit", "inherit"]
});
plugin.on("exit", (code) => {
	if (!finished) {
		console.error(`plugin exited early with code ${code}`);
		process.exit(1);
	}
});

setTimeout(() => {
	if (!finished) {
		console.error("E2E: timeout — plugin never completed the scenario");
		plugin.kill();
		process.exit(1);
	}
}, 20000);
