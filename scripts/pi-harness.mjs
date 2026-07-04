// Serves the REAL property inspector in a normal browser against the REAL
// plugin (live HWiNFO data) for settings-panel screenshots: a mock Stream Deck
// WebSocket bridges plugin <-> PI, and a static server hosts ui/ with a
// bootstrap that performs the registration call the Stream Deck app would.
// Usage: node scripts/pi-harness.mjs   (then open http://127.0.0.1:28997/)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const WS_PORT = 28996;
const HTTP_PORT = 28997;
const READING_KEY = "f0000501:0:1000000"; // CPU (Tctl/Tdie)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");

// One key context whose settings both sides share.
const store = {
	settings: { readingKey: READING_KEY, sparkline: true, warnValue: "80", critValue: "89", theme: "" },
	globals: { theme: "void", typeAccents: "on" }
};

let pluginWs = null;
let piWs = null;
const toPlugin = (obj) => pluginWs?.send(JSON.stringify(obj));
const toPi = (obj) => piWs?.send(JSON.stringify(obj));

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
wss.on("connection", (ws) => {
	ws.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		switch (msg.event) {
			case "registerPlugin":
				pluginWs = ws;
				toPlugin({
					event: "willAppear",
					action: "com.lawrensen.hwinfo.reading",
					context: "ctx-key",
					device: "dev1",
					payload: { settings: store.settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
				});
				toPlugin({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", device: "dev1" });
				break;
			case "registerPropertyInspector":
				piWs = ws;
				break;
			// ---- from the PI ----
			case "sendToPlugin":
				toPlugin({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", payload: msg.payload });
				break;
			case "getSettings":
				ws.send(JSON.stringify({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: msg.context ?? "ctx-key", payload: { settings: store.settings, coordinates: { column: 0, row: 0 } } }));
				break;
			case "setSettings":
				store.settings = msg.payload ?? {};
				toPlugin({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", payload: { settings: store.settings, coordinates: { column: 0, row: 0 }, isInMultiAction: false } });
				break;
			case "getGlobalSettings":
				ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: store.globals } }));
				break;
			case "setGlobalSettings":
				store.globals = msg.payload ?? {};
				toPlugin({ event: "didReceiveGlobalSettings", payload: { settings: store.globals } });
				toPi({ event: "didReceiveGlobalSettings", payload: { settings: store.globals } });
				break;
			// ---- from the plugin ----
			case "sendToPropertyInspector":
				toPi({ event: "sendToPropertyInspector", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", payload: msg.payload });
				break;
			case "setImage":
			case "setFeedback":
			case "logMessage":
				break;
			default:
				break;
		}
	});
});

const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
	colors: {},
	devicePixelRatio: 1,
	devices: [{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 }],
	plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
};
const actionInfo = {
	action: "com.lawrensen.hwinfo.reading",
	context: "ctx-key",
	device: "dev1",
	payload: { settings: store.settings, coordinates: { column: 0, row: 0 }, controller: "Keypad" }
};

const BOOTSTRAP = `<style>body{background:#2d2d2d;margin:0;padding:8px 0;}</style>
<script>window.addEventListener("load",()=>{connectElgatoStreamDeckSocket(String(${WS_PORT}),"pi-ctx","registerPropertyInspector",${JSON.stringify(JSON.stringify(info))},${JSON.stringify(JSON.stringify(actionInfo))});});</script>`;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
createServer((req, res) => {
	if (req.url === "/" || req.url === "") {
		res.writeHead(302, { location: "/ui/sensor-reading.html" }).end();
		return;
	}
	const url = (req.url ?? "/").split("?")[0];
	const file = path.join(pluginDir, path.normalize(url).replace(/^([\\/.])+/, ""));
	if (!file.startsWith(pluginDir)) {
		res.writeHead(403).end();
		return;
	}
	try {
		let body = readFileSync(file);
		if (file.endsWith(".html")) {
			body = Buffer.from(body.toString("utf8").replace("</head>", `${BOOTSTRAP}</head>`));
		}
		res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" }).end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
}).listen(HTTP_PORT, "127.0.0.1", () => console.log(`PI at http://127.0.0.1:${HTTP_PORT}/  (ws ${WS_PORT})`));

const plugin = spawn(process.execPath, ["bin/plugin.js", "-port", String(WS_PORT), "-pluginUUID", "pi-harness", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
	cwd: pluginDir,
	stdio: ["ignore", "inherit", "inherit"]
});
let shuttingDown = false;
plugin.on("exit", (code) => {
	if (!shuttingDown) {
		console.error(`plugin exited with code ${code}`);
		process.exit(1);
	}
});
function shutdown() {
	shuttingDown = true;
	plugin.kill();
	process.exit(0);
}
process.on("SIGINT", shutdown);
// Windows kill() is TerminateProcess — handlers never run and the plugin
// child would be orphaned. Automation writes "exit" to stdin instead (same
// protocol as fake-hwinfo.mjs).
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	if (line.trim() === "exit") {
		shutdown();
	}
});
