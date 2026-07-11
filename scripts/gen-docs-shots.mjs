// Regenerates the plugin-rendered images used by the documentation site that no
// other tool covers — the status-screen grid, the dial state faces (pinned /
// cycle paused / critical hold), the Stream Deck + XL six-dial strip, and the
// HWiNFO Control key face. (Theme/alert key faces come from `npm run
// contact-sheet`; the settings panel from the pi-harness.) Everything except
// the shipped Control key SVG is drawn by the real renderers; the dial boards
// read live HWiNFO values, so HWiNFO must be running.
//   npx tsx scripts/gen-docs-shots.mjs [outDir=docs/assets/img]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { SharedMemoryProvider } from "../src/hwinfo/provider.ts";
import { renderDial } from "../src/ui/dial-renderer.ts";
import { formatValue } from "../src/ui/format.ts";
import { renderStatusKey } from "../src/ui/key-renderer.ts";
import { missingReadingScreen, noSelectionScreen, statusScreen } from "../src/ui/state-screens.ts";
import { classifyTypeAccent, loadThemes, resolvePalette } from "../src/ui/themes.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] ?? path.join(repoRoot, "docs", "assets", "img");
mkdirSync(outDir, { recursive: true });

const BOARD_BG = "#111317";
const LABEL_STYLE = `font-family="Segoe UI, Arial" font-size="18" fill="#c8c8c8"`;

// ---------- status-screen grid (docs/status-screens.md, faq, troubleshooting) ----------

const unavailable = (reason) => statusScreen({ state: "unavailable", reason, message: "" });
const stale = (source) => statusScreen({ state: "stale", snapshot: {}, source, staleForMs: 20_000 });

async function statusBoard() {
	const items = [
		["not running", unavailable("not-running")],
		["shared memory off", unavailable("disabled")],
		["access denied", unavailable("access-denied")],
		["gadget empty", unavailable("gadget-empty")],
		["stale (shared memory)", stale("shared-memory")],
		["stale (gadget)", stale("gadget")],
		["no selection", noSelectionScreen()],
		["sensor missing", missingReadingScreen()]
	];

	const KEY = 288; // 144 * 2
	const LABEL = 30;
	const GAP = 16;
	const COLS = 4;
	const rows = Math.ceil(items.length / COLS);
	const W = COLS * KEY + (COLS + 1) * GAP;
	const H = rows * (KEY + LABEL) + (rows + 1) * GAP;

	// Rounded-corner mask so a flat 144px SVG reads like a physical deck key.
	const mask = Buffer.from(`<svg width="${KEY}" height="${KEY}"><rect width="${KEY}" height="${KEY}" rx="26" ry="26" fill="#fff"/></svg>`);

	const layers = [];
	for (let i = 0; i < items.length; i++) {
		const [name, opts] = items[i];
		if (!opts) continue;
		const x = GAP + (i % COLS) * (KEY + GAP);
		const y = GAP + Math.floor(i / COLS) * (KEY + LABEL + GAP);
		const key = await sharp(Buffer.from(renderStatusKey(opts))).resize(KEY, KEY).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
		const label = Buffer.from(`<svg width="${KEY}" height="${LABEL}"><text x="${KEY / 2}" y="20" text-anchor="middle" ${LABEL_STYLE}>${name}</text></svg>`);
		layers.push({ input: key, left: x, top: y }, { input: label, left: x, top: y + KEY + 4 });
	}

	const outFile = path.join(outDir, "status-screens.png");
	writeFileSync(outFile, await sharp({ create: { width: W, height: H, channels: 3, background: BOARD_BG } }).composite(layers).png().toBuffer());
	console.log(`wrote ${outFile} (${W}x${H})`);
}

// ---------- dial faces from live HWiNFO data (production renderer) ----------

const config = loadThemes();
const provider = SharedMemoryProvider.open();
const snapshot = provider.read();
if (snapshot === null) {
	throw new Error("shared memory mid-update: rerun");
}
const byKey = (key) => {
	const r = snapshot.byKey.get(key);
	if (r === undefined) {
		throw new Error(`reading ${key} missing`);
	}
	return r;
};

// The live showcase sensors (same table as scripts/marketplace-shots.mjs).
const K = {
	cpuTemp: "f0000501:0:1000000",
	cpuPower: "f0000501:0:5000000",
	cpuLoad: "f0000300:0:7000021",
	gpuTemp: "e0002000:0:1000000",
	gpuHot: "e0002000:0:1000005",
	cpuFan: "f7006687:0:3000000",
	pump: "f7006687:0:3000001"
};

/**
 * One dial face exactly as `renderSlot` composes it in production: live value,
 * `▼ min   ▲ max   <tag>` stats line, session bar fraction, themed palette,
 * bar fill flipped to the alert field only when a threshold would trip.
 */
function dialFace({ key, label, tag = "session", level = "normal", forceValue, statMode = "" }) {
	const r = byKey(key);
	const value = forceValue ?? r.value;
	const min = Math.min(r.valueMin, value);
	const max = Math.max(r.valueMax, value);
	const span = max - min;
	const fraction = span > 0 ? Math.max(0, Math.min(1, (value - min) / span)) : 0.5;
	const palette = resolvePalette(config, "void", classifyTypeAccent(r.type, r.unit, r.label), "normal");
	return renderDial({
		title: label ?? r.label,
		valueText: formatValue(value, "auto"),
		unitText: `${r.unit}${statMode !== "" ? " · " + statMode : ""}`.trim(),
		statsText: `▼ ${formatValue(min, "auto")}   ▲ ${formatValue(max, "auto")}   ${tag}`,
		fraction,
		palette,
		barColor: level !== "normal" ? config.alerts[level].bg : palette.accent
	});
}

const DIAL_W = 400; // 200x100 * 2
const DIAL_H = 200;
const dialMask = Buffer.from(`<svg width="${DIAL_W}" height="${DIAL_H}"><rect width="${DIAL_W}" height="${DIAL_H}" rx="12" fill="#fff"/></svg>`);

async function dialPng(svg) {
	const scaled = svg.replace(`width="200" height="100"`, `width="${DIAL_W}" height="${DIAL_H}"`);
	return sharp(Buffer.from(scaled)).png().composite([{ input: dialMask, blend: "dest-in" }]).png().toBuffer();
}

/** Pinned, cycle-paused, and critical-hold faces side by side, labelled. */
async function dialStates() {
	const items = [
		["pinned (turns and cycle locked out)", dialFace({ key: K.cpuTemp, label: "CPU Temp", tag: "pinned" })],
		["cycle paused", dialFace({ key: K.pump, label: "Pump", tag: "cycle paused" })],
		["critical: auto cycle holds here", dialFace({ key: K.gpuHot, label: "GPU Hot Spot", level: "crit", forceValue: 106.2, statMode: "MAX" })]
	];
	const GAP = 20;
	const LABEL = 30;
	const W = items.length * DIAL_W + (items.length + 1) * GAP;
	const H = GAP + DIAL_H + LABEL + GAP;
	const layers = [];
	for (let i = 0; i < items.length; i++) {
		const [name, svg] = items[i];
		const x = GAP + i * (DIAL_W + GAP);
		layers.push({ input: await dialPng(svg), left: x, top: GAP });
		layers.push({ input: Buffer.from(`<svg width="${DIAL_W}" height="${LABEL}"><text x="${DIAL_W / 2}" y="20" text-anchor="middle" ${LABEL_STYLE}>${name}</text></svg>`), left: x, top: GAP + DIAL_H + 4 });
	}
	const outFile = path.join(outDir, "dial-states.png");
	writeFileSync(outFile, await sharp({ create: { width: W, height: H, channels: 3, background: BOARD_BG } }).composite(layers).png().toBuffer());
	console.log(`wrote ${outFile} (${W}x${H})`);
}

/**
 * The Stream Deck + XL encoder strip: six real 200x100 segments side by side
 * (the device's actual per-encoder touch geometry), knob chrome below. Six
 * independent segments on purpose — that is what the hardware shows.
 */
async function plusXlStrip() {
	const faces = [
		dialFace({ key: K.cpuTemp, label: "CPU Temp" }),
		dialFace({ key: K.gpuTemp, label: "GPU Temp" }),
		dialFace({ key: K.cpuFan, label: "CPU Fan", tag: "pinned" }),
		dialFace({ key: K.cpuPower, label: "CPU Power" }),
		dialFace({ key: K.cpuLoad, label: "CPU Load" }),
		dialFace({ key: K.gpuHot, label: "GPU Hot Spot", level: "crit", forceValue: 106.2 })
	];
	const GAP = 14;
	const PAD = 28;
	const KNOB = 84;
	const W = 2 * PAD + faces.length * DIAL_W + (faces.length - 1) * GAP;
	const H = PAD + DIAL_H + 20 + KNOB + PAD;
	const layers = [];
	for (let i = 0; i < faces.length; i++) {
		const x = PAD + i * (DIAL_W + GAP);
		layers.push({ input: await dialPng(faces[i]), left: x, top: PAD });
		const knobX = x + Math.round(DIAL_W / 2) - KNOB / 2;
		layers.push({
			input: Buffer.from(
				`<svg width="${KNOB}" height="${KNOB}"><circle cx="${KNOB / 2}" cy="${KNOB / 2}" r="${KNOB / 2 - 2}" fill="#1B1D22" stroke="#2E3138" stroke-width="2"/><circle cx="${KNOB / 2}" cy="${KNOB / 2}" r="${KNOB / 2 - 11}" fill="#101116"/><rect x="${KNOB / 2 - 1.5}" y="12" width="3" height="13" rx="1.5" fill="#4CC2FF"/></svg>`
			),
			left: knobX,
			top: PAD + DIAL_H + 20
		});
	}
	const outFile = path.join(outDir, "plusxl-dials.png");
	writeFileSync(outFile, await sharp({ create: { width: W, height: H, channels: 3, background: BOARD_BG } }).composite(layers).png().toBuffer());
	console.log(`wrote ${outFile} (${W}x${H})`);
}

// ---------- the HWiNFO Control key face (the shipped action image) ----------

async function controlKey() {
	const SIZE = 288;
	const svg = readFileSync(path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin", "imgs", "actions", "control", "key.svg"));
	const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="26" ry="26" fill="#fff"/></svg>`);
	const key = await sharp(svg, { density: 288 }).resize(SIZE, SIZE).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
	const GAP = 16;
	const W = SIZE + 2 * GAP;
	const H = SIZE + 2 * GAP;
	const outFile = path.join(outDir, "control-key.png");
	writeFileSync(outFile, await sharp({ create: { width: W, height: H, channels: 3, background: BOARD_BG } }).composite([{ input: key, left: GAP, top: GAP }]).png().toBuffer());
	console.log(`wrote ${outFile} (${W}x${H})`);
}

try {
	await statusBoard();
	await dialStates();
	await plusXlStrip();
	await controlKey();
} finally {
	provider.close();
}
