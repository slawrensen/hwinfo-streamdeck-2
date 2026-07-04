// Captures the property inspector (served by scripts/pi-harness.mjs) in
// headless Chrome over CDP with real-time waits, so live WebSocket data and
// the theme gallery are present. Two states: settings view and picker open.
// Usage: node scripts/capture-pi.mjs <outDir>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const outDir = process.argv[2] ?? ".";
const URL_PI = "http://127.0.0.1:28997/ui/sensor-reading.html";
const DEBUG_PORT = 29222;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[capture] ${m}`);

// Hard stop so a wedged CDP call can never hang the caller.
const watchdog = setTimeout(() => {
	console.error("[capture] watchdog: 60s elapsed — aborting");
	process.exit(2);
}, 60000);
watchdog.unref();

const chrome = spawn(CHROME, [
	"--headless=new",
	"--disable-gpu",
	`--remote-debugging-port=${DEBUG_PORT}`,
	`--user-data-dir=${path.join(process.env.TEMP ?? ".", "pi-capture-profile")}`,
	"--hide-scrollbars",
	"about:blank"
], { stdio: "ignore" });

try {
	let target = null;
	for (let i = 0; i < 30 && target === null; i++) {
		await sleep(500);
		try {
			const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
			target = list.find((t) => t.type === "page") ?? null;
		} catch {
			/* debugger not up yet */
		}
	}
	if (target === null) {
		throw new Error("chrome debugger never came up");
	}
	log(`debugger target: ${target.title}`);

	const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	log("cdp connected");
	let seq = 0;
	const pending = new Map();
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id !== undefined && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	});
	const cdp = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
			ws.send(JSON.stringify({ id, method, params }));
		});

	await cdp("Emulation.setDeviceMetricsOverride", { width: 400, height: 880, deviceScaleFactor: 2, mobile: false });
	await cdp("Page.enable");
	log("navigating");
	await cdp("Page.navigate", { url: URL_PI });
	await sleep(8000); // real time: plugin ticks + sensor tree + themes payload
	log("capturing settings view");

	const shot1 = await cdp("Page.captureScreenshot", { format: "png" });
	writeFileSync(path.join(outDir, "pi-settings.png"), Buffer.from(shot1.data, "base64"));
	log("settings captured");

	// Open the picker with a query typed in, so the filtered list shows.
	await cdp("Runtime.evaluate", {
		expression: `(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = "gpu"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`
	});
	await sleep(1500);
	const shot2 = await cdp("Page.captureScreenshot", { format: "png" });
	writeFileSync(path.join(outDir, "pi-picker.png"), Buffer.from(shot2.data, "base64"));
	console.log(`captured pi-settings.png + pi-picker.png to ${outDir}`);
} finally {
	chrome.kill();
}
