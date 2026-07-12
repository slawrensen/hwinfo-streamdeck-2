// End-to-end protocol harness: impersonates the Stream Deck app on a local
// WebSocket, launches the BUILT plugin (bin/plugin.js), drives key/dial/PI
// events, and asserts on the setImage / setFeedback / sendToPropertyInspector
// traffic that comes back. Requires HWiNFO running with shared memory —
// values asserted are live. Run with `npm run e2e` (after `npm run build`).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = 28999;
const READING_KEY = process.env.HW_E2E_KEY ?? "f0000501:0:1000000"; // CPU (Tctl/Tdie) on this machine
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const harnessStart = new Date();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {
	registered: false,
	images: [], // { context, image }
	feedbacks: [], // { context, payload }
	piPayloads: [], // payload
	setSettings: [], // { context, payload }
	showOks: [], // context
	showAlerts: [], // context
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
			case "showOk":
				results.showOks.push(msg.context);
				break;
			case "showAlert":
				results.showAlerts.push(msg.context);
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
	// Dial with no selection yet, on the + XL's sixth encoder (5,0). The stale
	// custom label must be dropped when rotation adopts a reading.
	send({
		event: "willAppear",
		action: "com.lawrensen.hwinfo.dial",
		context: "ctx-dial",
		device: "devxl",
		payload: { settings: { label: "Stale custom label" }, coordinates: { column: 5, row: 0 }, controller: "Encoder", isInMultiAction: false }
	});
	await sleep(3200); // a few poll ticks

	// Rotate: with no selection this must adopt the first reading.
	send({
		event: "dialRotate",
		action: "com.lawrensen.hwinfo.dial",
		context: "ctx-dial",
		device: "devxl",
		payload: { settings: {}, coordinates: { column: 5, row: 0 }, ticks: 2, pressed: false }
	});
	// Key press cycles stat mode → MIN.
	send({
		event: "keyDown",
		action: "com.lawrensen.hwinfo.reading",
		context: "ctx-key",
		device: "dev1",
		payload: { settings: { readingKey: READING_KEY, sparkline: true }, coordinates: { column: 0, row: 0 } }
	});
	// PI opens on the key and asks for the tree + themes.
	send({ event: "propertyInspectorDidAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", device: "dev1" });
	send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", payload: { event: "getSensorTree" } });
	send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", payload: { event: "getThemes" } });
	await sleep(2600);

	// Rotation set + ignore-turns + autocycle, driven with two live keys from
	// the tree the PI just received.
	const treeMsg = results.piPayloads.find((p) => p?.event === "sensorTree");
	results.rotationKeys = (treeMsg?.groups ?? []).flatMap((g) => g.readings.map((r) => r.key)).slice(0, 2);
	if (results.rotationKeys.length === 2) {
		const [k1, k2] = results.rotationKeys;
		const dialSet = (settings) => send({ event: "didReceiveSettings", action: "com.lawrensen.hwinfo.dial", context: "ctx-dial", device: "devxl", payload: { settings, coordinates: { column: 5, row: 0 }, isInMultiAction: false } });
		const dialRotate = () => send({ event: "dialRotate", action: "com.lawrensen.hwinfo.dial", context: "ctx-dial", device: "devxl", payload: { settings: {}, coordinates: { column: 5, row: 0 }, ticks: 1, pressed: false } });
		const dialWrites = () => results.setSettings.filter((s) => s.context === "ctx-dial");

		dialSet({ readingKey: k1, rotationKeys: [k1, k2] });
		await sleep(300);
		dialRotate();
		await sleep(300);
		results.setStep1 = dialWrites().at(-1)?.payload?.readingKey;
		dialRotate();
		await sleep(300);
		results.setStep2 = dialWrites().at(-1)?.payload?.readingKey;

		// Ignore turns: a rotate while disabled must persist nothing.
		dialSet({ readingKey: k1, rotationKeys: [k1, k2], rotationDisabled: true });
		await sleep(200);
		results.writesBeforeDisabledRotate = dialWrites().length;
		dialRotate();
		await sleep(400);
		results.writesAfterDisabledRotate = dialWrites().length;

		// Autocycle: with turns still ignored, the timer must advance anyway.
		dialSet({ readingKey: k1, rotationKeys: [k1, k2], rotationDisabled: true, autoCycleMs: "1500" });
		const writesBeforeAutocycle = dialWrites().length;
		await sleep(5600);
		results.autocycleWrites = dialWrites().slice(writesBeforeAutocycle);
		dialSet({ readingKey: k1 }); // stop cycling before the exit-hygiene checks
		await sleep(200);

		const dialEvent = (event, payload) =>
			send({ event, action: "com.lawrensen.hwinfo.dial", context: "ctx-dial", device: "devxl", payload: { settings: {}, coordinates: { column: 5, row: 0 }, controller: "Encoder", ...payload } });
		const groupNameOf = (key) => treeMsg.groups.find((g) => g.readings.some((r) => r.key === key))?.name;

		// Elite preset: pressed rotation switches SENSOR SOURCES and the release
		// after it must not fire the push command (no second write, no reset).
		dialSet({ readingKey: k1, controlPreset: "elite" });
		await sleep(200);
		dialEvent("dialDown", {});
		dialEvent("dialRotate", { ticks: 1, pressed: true });
		dialEvent("dialUp", {});
		await sleep(400);
		results.pressedRotateKey = dialWrites().at(-1)?.payload?.readingKey;
		results.pressedRotateCrossed = typeof results.pressedRotateKey === "string" && groupNameOf(results.pressedRotateKey) !== undefined && groupNameOf(results.pressedRotateKey) !== groupNameOf(k1);

		// Stat mode survives page navigation (hidden-state cache): tap to MIN,
		// navigate away and back, the returning frame must still badge MIN.
		dialEvent("touchTap", { hold: false, tapPos: [100, 50] });
		await sleep(400);
		dialEvent("willDisappear", {});
		await sleep(300);
		const dialFramesBeforeReturn = results.feedbacks.filter((f) => f.context === "ctx-dial").length;
		send({
			event: "willAppear",
			action: "com.lawrensen.hwinfo.dial",
			context: "ctx-dial",
			device: "devxl",
			payload: { settings: { readingKey: results.pressedRotateKey ?? k1, controlPreset: "elite" }, coordinates: { column: 5, row: 0 }, controller: "Encoder", isInMultiAction: false }
		});
		await sleep(700);
		results.dialReturnFrames = results.feedbacks
			.filter((f) => f.context === "ctx-dial")
			.slice(dialFramesBeforeReturn)
			.map((f) => decodeSvg(f.payload?.canvas))
			.filter((s) => s !== null);

		// Rotation groups: pressed rotation jumps between the user's own
		// groups (k1 alone vs k2 alone), plain rotate then stays inside the
		// landing group, and the group's name shows on the dial as it lands.
		dialSet({
			readingKey: k1,
			controlPreset: "elite",
			rotationGroups: [
				{ name: "Group A", keys: [k1] },
				{ name: "Group B", keys: [k2] }
			],
			rotationKeys: [k1, k2]
		});
		await sleep(300);
		dialEvent("dialDown", {});
		dialEvent("dialRotate", { ticks: 1, pressed: true });
		dialEvent("dialUp", {});
		await sleep(400);
		results.groupJumpKey = dialWrites().at(-1)?.payload?.readingKey;
		const writesBeforeInGroupRotate = dialWrites().length;
		dialEvent("dialRotate", { ticks: 1, pressed: false });
		await sleep(400);
		results.inGroupRotateWrites = dialWrites().length - writesBeforeInGroupRotate;
		results.groupOverlaySeen = results.feedbacks
			.filter((f) => f.context === "ctx-dial")
			.map((f) => decodeSvg(f.payload?.canvas))
			.some((s) => s !== null && s.includes("Group B"));

		// Six simultaneous + XL dial contexts: rotate exactly one; the others
		// must render but never write settings (state isolation).
		for (let c = 0; c < 5; c++) {
			send({
				event: "willAppear",
				action: "com.lawrensen.hwinfo.dial",
				context: `ctx-dial-${c}`,
				device: "devxl",
				payload: { settings: { readingKey: k1 }, coordinates: { column: c, row: 0 }, controller: "Encoder", isInMultiAction: false }
			});
		}
		await sleep(800);
		send({ event: "dialRotate", action: "com.lawrensen.hwinfo.dial", context: "ctx-dial-2", device: "devxl", payload: { settings: {}, coordinates: { column: 2, row: 0 }, ticks: 1, pressed: false } });
		await sleep(400);
		results.sixDialFrames = [0, 1, 2, 3, 4].every((c) => results.feedbacks.some((f) => f.context === `ctx-dial-${c}`));
		results.bystanderDialWrites = results.setSettings.filter((s) => /^ctx-dial-[0134]$/.test(s.context)).length;
		results.rotatedDialWrite = results.setSettings.find((s) => s.context === "ctx-dial-2")?.payload?.readingKey;
		for (let c = 0; c < 5; c++) {
			send({ event: "willDisappear", action: "com.lawrensen.hwinfo.dial", context: `ctx-dial-${c}`, device: "devxl", payload: { settings: {}, coordinates: { column: c, row: 0 }, controller: "Encoder", isInMultiAction: false } });
		}

		// Malformed / old settings must neither crash the plugin nor corrupt
		// the deck: the context still renders AND rotation still works (the
		// invalid readingKey counts as no selection, so a turn adopts one).
		send({
			event: "willAppear",
			action: "com.lawrensen.hwinfo.dial",
			context: "ctx-bad",
			device: "devxl",
			payload: {
				settings: { readingKey: 42, rotationKeys: "nope", rotationGroups: [{ name: 5, keys: "x" }, 7, null], controlPreset: { evil: true }, autoCycleMs: ["x"], touchZones: 7 },
				coordinates: { column: 4, row: 0 },
				controller: "Encoder",
				isInMultiAction: false
			}
		});
		await sleep(600);
		send({ event: "dialRotate", action: "com.lawrensen.hwinfo.dial", context: "ctx-bad", device: "devxl", payload: { settings: {}, coordinates: { column: 4, row: 0 }, ticks: 1, pressed: false } });
		await sleep(400);
		results.badContextFrames = results.feedbacks.filter((f) => f.context === "ctx-bad").length;
		const badWrite = results.setSettings.find((s) => s.context === "ctx-bad")?.payload;
		results.badContextAdopted = badWrite?.readingKey;
		// The write that adopts a reading must carry the malformed fields
		// through VERBATIM: the runtime salvages a usable view but never
		// rewrites settings it cannot parse (rollback and hand-edit safety).
		results.badContextPreserved = badWrite !== undefined && badWrite.rotationKeys === "nope" && JSON.stringify(badWrite.rotationGroups) === JSON.stringify([{ name: 5, keys: "x" }, 7, null]);
		send({ event: "willDisappear", action: "com.lawrensen.hwinfo.dial", context: "ctx-bad", device: "devxl", payload: { settings: {}, coordinates: { column: 4, row: 0 }, controller: "Encoder", isInMultiAction: false } });

		// HWiNFO Control: a key on ANOTHER device (dev1) drives the + XL dial.
		dialSet({ readingKey: k1, rotationKeys: [k1, k2], controlPreset: "" });
		await sleep(200);
		const controlAppear = () =>
			send({
				event: "willAppear",
				action: "com.lawrensen.hwinfo.control",
				context: "ctx-ctl",
				device: "dev1",
				payload: { settings: { command: "next", target: "" }, coordinates: { column: 1, row: 0 }, controller: "Keypad", isInMultiAction: false }
			});
		controlAppear();
		// Replayed willAppear (reconnect/wake): must not double-count the key.
		controlAppear();
		await sleep(200);
		const writesBeforeControl = dialWrites().length;
		send({ event: "keyUp", action: "com.lawrensen.hwinfo.control", context: "ctx-ctl", device: "dev1", payload: { settings: { command: "next", target: "" }, coordinates: { column: 1, row: 0 }, isInMultiAction: false } });
		await sleep(500);
		results.controlAdvancedTo = dialWrites().length > writesBeforeControl ? dialWrites().at(-1)?.payload?.readingKey : undefined;
		// Success feedback is the key's own icon with a corner tick badge (a
		// setImage), never the stock full-key checkmark; reverts are empty
		// setImage calls and don't count.
		const ctlOks = () => results.images.filter((i) => i.context === "ctx-ctl" && i.image !== "").length;
		results.controlShowedOk = ctlOks() === 1 && results.showOks.length === 0;
		// Malformed settings on the control key: a non-string Target means no
		// target, never a crash (async handlers crash as "Unhandled rejection").
		send({ event: "keyUp", action: "com.lawrensen.hwinfo.control", context: "ctx-ctl", device: "dev1", payload: { settings: { command: "showCurrent", target: 42 }, coordinates: { column: 1, row: 0 }, isInMultiAction: false } });
		await sleep(300);
		results.controlMalformedTargetOk = ctlOks() === 2 && !results.showAlerts.includes("ctx-ctl");
		// Reset-all ignores the Target, exactly as the settings panel says.
		dialSet({ readingKey: k1, rotationKeys: [k1, k2], controlPreset: "", linkId: "xl-dial" });
		await sleep(200);
		send({ event: "keyUp", action: "com.lawrensen.hwinfo.control", context: "ctx-ctl", device: "dev1", payload: { settings: { command: "resetStats", target: "no-such-link", resetScope: "all" }, coordinates: { column: 1, row: 0 }, isInMultiAction: false } });
		await sleep(300);
		results.controlResetAllOk = ctlOks() === 3;
		// A never-configured key (empty settings): the PI displays "Next
		// reading", so the press must act as "next", not alert.
		send({ event: "keyUp", action: "com.lawrensen.hwinfo.control", context: "ctx-ctl", device: "dev1", payload: { settings: {}, coordinates: { column: 1, row: 0 }, isInMultiAction: false } });
		await sleep(300);
		results.controlFreshKeyOk = ctlOks() === 4 && !results.showAlerts.includes("ctx-ctl");
		// nextGroup honors the dial's rotation groups (group jumps do so on
		// every preset; only plain-step scoping needs a Switch gesture).
		dialSet({
			readingKey: k1,
			controlPreset: "",
			rotationGroups: [
				{ name: "A", keys: [k1] },
				{ name: "B", keys: [k2] }
			],
			rotationKeys: [k1, k2]
		});
		await sleep(200);
		send({ event: "keyUp", action: "com.lawrensen.hwinfo.control", context: "ctx-ctl", device: "dev1", payload: { settings: { command: "nextGroup", target: "" }, coordinates: { column: 1, row: 0 }, isInMultiAction: false } });
		await sleep(300);
		results.controlGroupJumpTo = dialWrites().at(-1)?.payload?.readingKey;
		send({ event: "willDisappear", action: "com.lawrensen.hwinfo.control", context: "ctx-ctl", device: "dev1", payload: { settings: {}, coordinates: { column: 1, row: 0 }, controller: "Keypad", isInMultiAction: false } });
		dialSet({ readingKey: k1 });
		await sleep(200);

		// Redacted support report over the PI channel.
		send({ event: "sendToPlugin", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", payload: { event: "getSupportReport" } });
		await sleep(400);
	}

	// Sparkline persistence: nav the key away and back (the dial keeps the
	// poller alive) — the FIRST frame after re-appear must already carry a
	// sparkline, proving the history survived in the poller rather than being
	// wiped on willAppear as it was before.
	const keyFramesBefore = results.images.filter((i) => i.context === "ctx-key").length;
	send({ event: "willDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", device: "dev1", payload: { settings: { readingKey: READING_KEY, sparkline: true }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } });
	await sleep(300);
	send({ event: "willAppear", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", device: "dev1", payload: { settings: { readingKey: READING_KEY, sparkline: true }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } });
	await sleep(300);
	results.reappearFirstFrame = decodeSvg((results.images.filter((i) => i.context === "ctx-key")[keyFramesBefore] ?? {}).image);

	// Exit hygiene: with every action gone the poller must go idle (zero
	// further frames) and the process must then exit on socket close alone.
	send({ event: "propertyInspectorDidDisappear", action: "com.lawrensen.hwinfo.reading", context: "ctx-key", device: "dev1" });
	send({
		event: "willDisappear",
		action: "com.lawrensen.hwinfo.reading",
		context: "ctx-key",
		device: "dev1",
		payload: { settings: { readingKey: READING_KEY, sparkline: true }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false }
	});
	send({
		event: "willDisappear",
		action: "com.lawrensen.hwinfo.dial",
		context: "ctx-dial",
		device: "devxl",
		payload: { settings: {}, coordinates: { column: 5, row: 0 }, controller: "Encoder", isInMultiAction: false }
	});
	await sleep(1200); // drain any in-flight tick
	const framesAtIdle = results.images.length + results.feedbacks.length;
	await sleep(3000); // three poll intervals of required silence
	results.idleDelta = results.images.length + results.feedbacks.length - framesAtIdle;
	await finish();
}

function decodeSvg(image) {
	if (typeof image !== "string" || !image.startsWith("data:image/svg+xml,")) {
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

/** Closes the app-side sockets and waits for the plugin to exit BY ITSELF —
 * the headless equivalent of "Stream Deck stopped". With the poller idle
 * there must be nothing keeping the event loop alive. */
function shutdownPlugin() {
	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				plugin.kill();
				resolve({ clean: false, detail: "still alive 5 s after socket close — killed" });
			}
		}, 5000);
		plugin.once("exit", (code) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve({ clean: true, detail: `self-exited (code ${code})` });
			}
		});
		for (const client of wss.clients) {
			client.close();
		}
		wss.close();
	});
}

/** The harness instance rotated the logs on startup, so .0 is OURS: scans it
 * for a line stamped within this run. */
function loggedThisRun(needle) {
	try {
		const log = fs.readFileSync(path.join(pluginDir, "logs", "com.lawrensen.hwinfo.0.log"), "utf8");
		for (const line of log.split("\n")) {
			if (line.includes(needle)) {
				const stamp = new Date(line.slice(0, 24));
				if (!Number.isNaN(stamp.getTime()) && stamp >= harnessStart) {
					return true;
				}
			}
		}
	} catch {
		/* fall through */
	}
	return false;
}

async function finish() {
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
	check(
		"sparkline survives nav away + back (history persisted in poller)",
		typeof results.reappearFirstFrame === "string" && results.reappearFirstFrame.includes("<polyline"),
		typeof results.reappearFirstFrame === "string" ? results.reappearFirstFrame.slice(0, 80) : "no re-appear frame"
	);

	const minFrame = keyImages.find((s) => s.includes(">MIN<"));
	check("keyDown cycled stat mode to MIN", minFrame !== undefined);
	check("keyDown persisted statMode via setSettings", results.setSettings.some((s) => s.context === "ctx-key" && s.payload?.statMode === "min"));

	// The dial layout is a single full-canvas pixmap — feedback carries one SVG.
	const dialSvgs = results.feedbacks.filter((f) => f.context === "ctx-dial").map((f) => decodeSvg(f.payload?.canvas)).filter((s) => s !== null);
	check("dial received SVG canvas feedback", dialSvgs.length > 0, `${dialSvgs.length} frames`);
	check("dial idle state prompts for selection", dialSvgs.some((s) => s.includes("rotate to pick")));
	check("dialRotate adopted a reading + persisted it", results.setSettings.some((s) => s.context === "ctx-dial" && typeof s.payload?.readingKey === "string" && s.payload.readingKey.length > 0));
	// A custom label names the reading it was written for; the persisted
	// settings after rotation must not carry it over to the new reading.
	check("dialRotate dropped the stale custom label", results.setSettings.some((s) => s.context === "ctx-dial" && typeof s.payload?.readingKey === "string" && !("label" in s.payload)));

	// Rotation set, ignore-turns, autocycle (needs two live readings).
	check("tree offered two readings for the rotation-set drive", results.rotationKeys?.length === 2);
	check("rotation set: a turn lands on the second picked reading", results.setStep1 === results.rotationKeys?.[1], `got ${results.setStep1}`);
	check("rotation set: the next turn wraps back to the first", results.setStep2 === results.rotationKeys?.[0], `got ${results.setStep2}`);
	check("ignore-turns blocks manual rotation", results.writesBeforeDisabledRotate === results.writesAfterDisabledRotate, `writes ${results.writesBeforeDisabledRotate} -> ${results.writesAfterDisabledRotate}`);
	check(
		"autocycle advances within the set while turns are ignored",
		(results.autocycleWrites?.length ?? 0) >= 1 && results.autocycleWrites.every((s) => results.rotationKeys.includes(s.payload?.readingKey)),
		`${results.autocycleWrites?.length ?? 0} advances in 5.6 s`
	);
	const liveDial = dialSvgs.find((s) => /[▼▲]/.test(s) && s.includes('y="84"'));
	check("dial shows live value + session stats + bar", liveDial !== undefined, (liveDial ?? "").slice(0, 140));

	// Elite preset: pressed rotation is a sensor jump, not a reading step.
	check("elite pressed rotation switches sensor sources", results.pressedRotateCrossed === true, `landed on ${results.pressedRotateKey}`);

	// Rotation groups end to end: jump between them, stay inside one, name it.
	check("pressed rotation jumps to the next rotation group", results.groupJumpKey === results.rotationKeys?.[1], `landed on ${results.groupJumpKey}`);
	check("plain rotate stays inside the active group (single member: no write)", results.inGroupRotateWrites === 0, `${results.inGroupRotateWrites} writes`);
	check("the landing group's name shows on the dial", results.groupOverlaySeen === true);
	check(
		"stat mode survives page navigation (hidden-state cache)",
		Array.isArray(results.dialReturnFrames) && results.dialReturnFrames.some((s) => s.includes("MIN")),
		`${results.dialReturnFrames?.length ?? 0} frames after return`
	);

	// Six simultaneous + XL dial contexts: independence under targeted input.
	check("all six + XL dial contexts render", results.sixDialFrames === true && dialSvgs.length > 0);
	check("rotating one dial writes only that dial", results.bystanderDialWrites === 0 && typeof results.rotatedDialWrite === "string", `bystander writes=${results.bystanderDialWrites}, rotated->${results.rotatedDialWrite}`);

	// Malformed settings: survive, render, keep working. Async handler
	// failures surface as "Unhandled rejection", not "Uncaught exception" —
	// grep for both or a thrown rotate handler ships green.
	check("malformed settings render without crashing", (results.badContextFrames ?? 0) > 0, `${results.badContextFrames} frames`);
	check("malformed settings still rotate (adopted a reading)", typeof results.badContextAdopted === "string" && results.badContextAdopted.length > 0, `adopted ${results.badContextAdopted}`);
	check("malformed rotation fields pass through writes verbatim (no salvage rewrite)", results.badContextPreserved === true);
	check("no uncaught exception was logged", !loggedThisRun("Uncaught exception"));
	check("no unhandled rejection was logged", !loggedThisRun("Unhandled rejection"));

	// HWiNFO Control key on dev1 drives the dial on devxl.
	check("control key advances the dial across devices", results.controlAdvancedTo === results.rotationKeys?.[1], `advanced to ${results.controlAdvancedTo}`);
	check("control key shows the corner tick badge, never the stock checkmark", results.controlShowedOk === true);
	check("control key treats a malformed Target as no target (no crash)", results.controlMalformedTargetOk === true);
	check("reset-all reaches the dials past a non-matching Target (as its panel says)", results.controlResetAllOk === true);
	check("a never-configured control key acts as Next reading (panel default), not an alert", results.controlFreshKeyOk === true);
	check("control key nextGroup honors rotation groups on any preset", results.controlGroupJumpTo === results.rotationKeys?.[1], `advanced to ${results.controlGroupJumpTo}`);

	// Support report: valid JSON, models named, raw device IDs and names absent.
	const supportMsg = results.piPayloads.find((p) => p?.event === "supportReport");
	let reportOk = false;
	let reportDetail = "no supportReport payload";
	let reportControlVisible = null;
	if (supportMsg && typeof supportMsg.report === "string") {
		try {
			const parsed = JSON.parse(supportMsg.report);
			const models = (parsed.devices ?? []).map((d) => d.model);
			// Redaction: no raw device ids, no device names, and no raw reading
			// identities (gadget keys embed sensor names; all keys are hashed).
			const rawKey = results.rotationKeys?.[0] ?? "";
			reportOk = models.includes("Stream Deck + XL") && !supportMsg.report.includes("devxl") && !supportMsg.report.includes("Harness") && (rawKey === "" || !supportMsg.report.includes(rawKey));
			reportDetail = `models=${models.join("|")}`;
			reportControlVisible = parsed.control?.visibleKeys ?? null;
		} catch (err) {
			reportDetail = `unparseable: ${err}`;
		}
	}
	check("support report is redacted, valid JSON", reportOk, reportDetail);
	// The control key saw a replayed willAppear and then one willDisappear:
	// per-context tracking must report zero visible keys, not a stuck count.
	check("support report: replayed control key is not double-counted", reportControlVisible === 0, `visibleKeys=${reportControlVisible}`);

	const tree = results.piPayloads.find((p) => p?.event === "sensorTree");
	check("PI got sensorTree", tree !== undefined);
	check("sensorTree has many grouped readings", (tree?.groups?.length ?? 0) > 5 && tree.groups.reduce((n, g) => n + g.readings.length, 0) > 100, `groups=${tree?.groups?.length}, readings=${tree?.groups?.reduce((n, g) => n + g.readings.length, 0)}`);
	const preview = results.piPayloads.find((p) => p?.event === "preview" && p.reading);
	check("PI got live preview for selected reading", preview !== undefined, preview ? `${preview.reading.label}=${preview.reading.value}` : "");

	// The Deck-default chip must never guess: the plugin sends its RESOLVED
	// deck theme, and it must be a real theme id from the same payload.
	const themes = results.piPayloads.find((p) => p?.event === "themes");
	check(
		"themes payload carries a valid effectiveDeckTheme",
		themes !== undefined && typeof themes.effectiveDeckTheme === "string" && themes.themes?.[themes.effectiveDeckTheme] !== undefined,
		themes ? `effectiveDeckTheme=${themes.effectiveDeckTheme}` : "no themes payload"
	);

	// Device registry: the + XL mock must resolve to its named type, proving
	// the plugin understands DeviceType 13 (hardware-verified 2026-07-09).
	check("device registry names the + XL", loggedThisRun("Harness + XL (StreamDeckPlusXL, 9x4)"));
	check("device registry names the +", loggedThisRun("Harness Plus (StreamDeckPlus, 4x2)"));

	// The SDK clamps trace to info outside a debug launch; asking for trace
	// must land on debug (never LESS detail than asked) and log the fallback.
	if (forcedLogLevel) {
		check("HWINFO_LOG_LEVEL=trace falls back to debug on a normal launch", loggedThisRun("Log level = debug (HWINFO_LOG_LEVEL asked for trace"));
	}

	// Exit hygiene.
	check("poller idles when no actions visible", results.idleDelta === 0, `frames in 3 s after willDisappear: ${results.idleDelta}`);
	check("poller logged idle stop", loggedThisRun("Stopped (no visible actions)"));
	const shutdown = await shutdownPlugin();
	check("plugin exits when the app socket closes", shutdown.clean, shutdown.detail);

	console.log(results.errors.length === 0 ? "\nE2E: ALL CHECKS PASSED" : `\nE2E: ${results.errors.length} FAILURES`);
	process.exit(results.errors.length === 0 ? 0 : 1);
}

// Registration info mirroring a real Stream Deck 7.4 registration.
const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
	colors: {},
	devicePixelRatio: 1,
	devices: [
		{ id: "dev1", name: "Harness Deck", size: { columns: 5, rows: 3 }, type: 0 },
		// A Stream Deck + (type 7) so the registry ingests the 4-encoder model.
		{ id: "devplus", name: "Harness Plus", size: { columns: 4, rows: 2 }, type: 7 },
		// Mirrors the real Stream Deck + XL registration observed on hardware
		// (2026-07-09): DeviceType 13, 9x4 keys, encoders 0-5.
		{ id: "devxl", name: "Harness + XL", size: { columns: 9, rows: 4 }, type: 13 }
	],
	plugin: { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" }
};

// Default the plugin to HWINFO_LOG_LEVEL=trace: a normal (non-debug) launch
// must fall back to debug and say so. An explicit level from the caller wins.
const forcedLogLevel = process.env.HWINFO_LOG_LEVEL === undefined;
const plugin = spawn(process.execPath, ["bin/plugin.js", "-port", String(PORT), "-pluginUUID", "e2e-harness", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
	cwd: pluginDir,
	stdio: ["ignore", "inherit", "inherit"],
	env: forcedLogLevel ? { ...process.env, HWINFO_LOG_LEVEL: "trace" } : process.env
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
}, 45000);
