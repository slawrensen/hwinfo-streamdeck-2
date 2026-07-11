// Captures the property inspectors (served by scripts/pi-harness.mjs) in
// headless Chrome over CDP with real-time waits, so live WebSocket data and
// the theme gallery are present. Six states: the key PI's settings view and
// open picker (marketplace shot 3), the dial PI's rotation-set picker with
// ticked rows and chips, the Elite preset view, the Custom gesture rows with
// touch zones, and the HWiNFO Control PI with a Link ID target.
// Usage: node scripts/capture-pi.mjs <outDir>
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const outDir = process.argv[2] ?? ".";
const BASE = "http://127.0.0.1:28997/ui";
const DEBUG_PORT = 29222;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[capture] ${m}`);

const chrome = spawn(CHROME, [
	"--headless=new",
	"--disable-gpu",
	`--remote-debugging-port=${DEBUG_PORT}`,
	`--user-data-dir=${path.join(process.env.TEMP ?? ".", "pi-capture-profile")}`,
	"--hide-scrollbars",
	"about:blank"
], { stdio: "ignore" });

/** chrome.kill() alone can strand renderer children — take down the tree,
 * then sweep any stragglers that re-parented past /T by our profile dir. */
function killChromeTree() {
	try {
		spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
	} catch {
		chrome.kill();
	}
	try {
		spawnSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				"Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'pi-capture-profile' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
			],
			{ stdio: "ignore", timeout: 15000 }
		);
	} catch {
		/* best effort */
	}
}

// Hard stop so a wedged CDP call can never hang the caller — but never at
// the price of an orphaned chrome tree. Six captures with real-time waits
// need more headroom than the old two.
const watchdog = setTimeout(() => {
	console.error("[capture] watchdog: 180s elapsed — aborting");
	killChromeTree();
	process.exit(2);
}, 180000);
watchdog.unref();

let cdpSocket = null;
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
	cdpSocket = ws;
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
	const viewport = (height) => cdp("Emulation.setDeviceMetricsOverride", { width: 400, height, deviceScaleFactor: 2, mobile: false });
	const evaluate = (expression) => cdp("Runtime.evaluate", { expression, returnByValue: true });
	const capture = async (name) => {
		const shot = await cdp("Page.captureScreenshot", { format: "png" });
		writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
		log(`${name} captured`);
	};
	/** Fail loudly when a driven element has been renamed away: a silent miss
	 * would capture the wrong state and ship it. */
	const expectOk = (what, res) => {
		if (res.result?.value !== "ok") {
			throw new Error(`${what} did not resolve (${JSON.stringify(res.result?.value ?? res.exceptionDetails?.text)})`);
		}
	};
	/** Set an sdpi-select's value, driving the inner <select> if the host
	 * element's value accessor did not take. */
	const setSelect = async (setting, value) => {
		const res = await evaluate(`(() => {
			const el = document.querySelector('sdpi-select[setting="${setting}"]');
			if (!el) return "missing";
			el.value = ${JSON.stringify(value)};
			const inner = (el.shadowRoot ?? el).querySelector("select");
			if (inner && inner.value !== ${JSON.stringify(value)}) {
				inner.value = ${JSON.stringify(value)};
				inner.dispatchEvent(new Event("change", { bubbles: true }));
			}
			return "ok";
		})()`);
		expectOk(`sdpi-select[setting="${setting}"]`, res);
	};

	await viewport(880);
	await cdp("Page.enable");

	// ---- key PI: settings view + open picker (marketplace shot 3) ----
	log("navigating: sensor-reading");
	await cdp("Page.navigate", { url: `${BASE}/sensor-reading.html` });
	await sleep(8000); // real time: plugin ticks + sensor tree + themes payload
	// Advanced open (deck theme, accents, source, poll rate, support report)
	// and the viewport fitted, so the capture shows the whole panel.
	expectOk("Advanced details", await evaluate(`(() => {
		const adv = [...document.querySelectorAll("details")].find((d) => (d.querySelector("summary")?.textContent ?? "").trim() === "Advanced");
		if (!adv) return "missing";
		adv.open = true;
		return "ok";
	})()`));
	await sleep(400);
	const settingsHeight = await evaluate(`Math.ceil([...document.body.children].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0))`);
	await viewport(Math.min(2400, Math.max(880, Number(settingsHeight.result?.value ?? 880) + 16)));
	await sleep(300);
	await capture("pi-settings.png");
	await viewport(880);

	// Open the picker with a query typed in, so the filtered list shows.
	await evaluate(`(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = "gpu"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(1500);
	await capture("pi-picker.png");

	// ---- dial PI: the picker's rotation-set checkboxes, mid-tick ----
	log("navigating: sensor-dial");
	await cdp("Page.navigate", { url: `${BASE}/sensor-dial.html` });
	await sleep(8000);
	await evaluate(`(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = "cpu"; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await sleep(700);
	// Two rows ticked so the capture shows checked and unchecked boxes side
	// by side; unticked again after the shot (the chips shot below builds
	// the real cross-sensor set).
	await evaluate(`(() => { let n = 0; for (const tick of document.querySelectorAll('#picker-list input.hw-tick:not(:checked)')) { if (n >= 2) break; tick.click(); n++; } return n; })()`);
	await sleep(500);
	await capture("pi-dial-picker.png");
	await evaluate(`(() => { for (const tick of document.querySelectorAll('#picker-list input.hw-tick:checked')) tick.click(); return "ok"; })()`);
	await sleep(400);

	// ---- dial PI: rotation set (cross-sensor ticks, shown as chips) ----
	// Tick one reading from three different sensors, the way a user would:
	// search, then click the row's checkbox. A cross-sensor set is the point.
	for (const query of ["tctl", "gpu temp", "pump"]) {
		await evaluate(`(() => { const el = document.getElementById("picker-search"); el.focus(); el.value = ${JSON.stringify(query)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
		await sleep(700);
		await evaluate(`document.querySelector('#picker-list input.hw-tick:not(:checked)')?.click()`);
		await sleep(400);
	}
	// Close the picker (outside mousedown) so the chips under it show.
	await evaluate(`(() => { const el = document.getElementById("picker-search"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
	await evaluate(`document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
	await sleep(600);
	await capture("pi-dial-rotation.png");

	// ---- dial PI: Elite preset under "Dial gestures & advanced" ----
	const openGestures = `(() => {
		const all = [...document.querySelectorAll("details")];
		for (const d of all) d.open = false;
		const g = all.find((d) => (d.querySelector("summary")?.textContent ?? "").includes("Dial gestures"));
		if (!g) return "missing";
		g.open = true;
		g.scrollIntoView({ block: "start" });
		return "ok";
	})()`;
	expectOk("Dial gestures details", await evaluate(openGestures));
	await setSelect("controlPreset", "elite");
	await sleep(900); // the PI polls its local settings cache every 400 ms
	await evaluate(openGestures);
	await sleep(300);
	await capture("pi-dial-presets.png");

	// ---- dial PI: Custom gesture rows + touch zones ----
	await setSelect("controlPreset", "custom");
	await sleep(900);
	await viewport(1500);
	await evaluate(openGestures);
	await sleep(300);
	// The page cannot always scroll the section to the top, so clip to it.
	const rect = await evaluate(`(() => {
		const g = [...document.querySelectorAll("details")].find((d) => (d.querySelector("summary")?.textContent ?? "").includes("Dial gestures"));
		const r = g.getBoundingClientRect();
		return { y: Math.max(0, Math.floor(r.top + window.scrollY - 10)), h: Math.ceil(r.height + 20) };
	})()`);
	const clip = rect.result?.value ?? { y: 0, h: 1500 };
	const shotCustom = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: clip.y, width: 400, height: clip.h, scale: 1 } });
	writeFileSync(path.join(outDir, "pi-dial-custom.png"), Buffer.from(shotCustom.data, "base64"));
	log("pi-dial-custom.png captured");

	// ---- HWiNFO Control PI: command + Link ID target ----
	log("navigating: control");
	await viewport(880);
	await cdp("Page.navigate", { url: `${BASE}/control.html` });
	await sleep(4000);
	// Every collapsible open: a capture with folded sections reads as a
	// half-empty panel. Then fit the viewport to the content, no dead space.
	await evaluate(`(() => { for (const d of document.querySelectorAll("details")) d.open = true; return "ok"; })()`);
	await sleep(400);
	// body fills the viewport, so measure the lowest child instead.
	const height = await evaluate(`Math.ceil([...document.body.children].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0))`);
	const h = Math.min(1600, Math.max(400, Number(height.result?.value ?? 880) + 16));
	await viewport(h);
	await sleep(300);
	await capture("pi-control.png");

	console.log(`captured 6 PI states to ${outDir}`);
} finally {
	// The open CDP socket would otherwise hold the event loop until the
	// watchdog fires — close it, then take the browser tree down.
	cdpSocket?.terminate();
	killChromeTree();
}
