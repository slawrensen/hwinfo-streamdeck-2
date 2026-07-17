// Marketplace listing stills (1920×960 per Elgato's product guidelines:
// thumbnail + gallery are 1920×960 PNG; 1920×1080 is the VIDEO spec), composed
// from the plugin's own renderers with live HWiNFO values — the marketing art
// IS the product output. Emits gallery shots 1/3/5 (+4 with a capture dir; shot 2 is the hardware photo board from scripts/shot2-hardware.mjs)
// and a dedicated thumbnail.png.
// Usage: npx tsx scripts/marketplace-shots.mjs <outputDir> [piCaptureDir]
import path from "node:path";
import sharp from "sharp";

import { renderDial } from "../src/ui/dial-renderer";
import { renderReadingKey } from "../src/ui/key-renderer";
import { formatValue } from "../src/ui/format";
import { SharedMemoryProvider } from "../src/hwinfo/provider";
import { classifyTypeAccent, loadThemes, resolvePalette } from "../src/ui/themes";

const outDir = process.argv[2] ?? "marketing";
const config = loadThemes();

// ---------- live data ----------
const provider = SharedMemoryProvider.open();
const snapshot = provider.read();
if (snapshot === null) {
	throw new Error("shared memory mid-update — rerun");
}
const byKey = (key) => {
	const r = snapshot.byKey.get(key);
	if (r === undefined) {
		throw new Error(`reading ${key} missing`);
	}
	return r;
};

/** Deterministic pseudo-history: a walk inside [min,max] ending at `end`. */
function walk(seedStr, min, max, end, n = 36) {
	let s = 0;
	for (let i = 0; i < seedStr.length; i++) {
		s = (s * 31 + seedStr.charCodeAt(i)) >>> 0;
	}
	const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
	const span = Math.max(max - min, Math.abs(end) * 0.05, 1);
	const out = [];
	let v = end - span * 0.25 + rnd() * span * 0.2;
	for (let i = 0; i < n - 1; i++) {
		v += (rnd() - 0.48) * span * 0.14;
		v = Math.max(min, Math.min(max, v));
		out.push(v);
	}
	out.push(end);
	return out;
}

// ---------- svg helpers (design-spec chrome) ----------
const FONT = "Segoe UI, Arial, sans-serif";
const MONO = "Cascadia Code, Consolas, monospace";
const esc = (t) => t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);

/** Rasterizes an SVG string at an integer scale (crisp vector upscale). */
function rasterize(svg, scale, w, h) {
	const scaled = svg.replace(`width="${w}" height="${h}"`, `width="${w * scale}" height="${h * scale}"`);
	return sharp(Buffer.from(scaled)).png().toBuffer();
}

/** Rounded-corner mask + rim, like the spec's key mockups. */
async function roundedKey(svg, size, radius, rim) {
	const png = await rasterize(svg, size / 144, 144, 144);
	const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
	const rimSvg = Buffer.from(`<svg width="${size}" height="${size}"><rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${radius}" fill="none" stroke="${rim}" stroke-width="1"/></svg>`);
	return sharp(png)
		.composite([
			{ input: mask, blend: "dest-in" },
			{ input: rimSvg, blend: "over" }
		])
		.png()
		.toBuffer();
}

/** Still-image canvas per current Elgato marketplace guidelines. */
const W = 1920;
const H = 960;

const PAGE_BG = "#0B0C0E";
const CARD_BG = "#101116";
const CARD_BORDER = "#1D2026";
const HEADLINE = "#EDEFF4";
const BODY = "#A9AFBC";
const MUTED = "#6B7280";
const CYAN = "#4CC2FF";

function pageBase(w, h, elements) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${PAGE_BG}"/>${elements.join("")}</svg>`;
}

// ---------- key face builders ----------
function face({ key, label, level = "normal", forceValue, statBadge = "", spark = true, theme = "void", fahrenheitLabel }) {
	const r = byKey(key);
	const value = forceValue ?? r.value;
	const accent = classifyTypeAccent(r.type, r.unit, r.label);
	const palette = resolvePalette(config, theme, accent, level);
	return renderReadingKey({
		label: label ?? r.label,
		valueText: formatValue(value, "auto"),
		unitText: fahrenheitLabel ?? r.unit,
		statBadge,
		history: spark ? walk(key + (label ?? ""), Math.min(r.valueMin, value), Math.max(r.valueMax, value), value) : undefined,
		palette
	});
}

// The live showcase sensors (mirrors the deck's page 2).
const K = {
	cpuTemp: "f0000501:0:1000000",
	ccd1: "f0000501:0:1000008",
	cpuPower: "f0000501:0:5000000",
	coreClock: "f0000300:0:600001c",
	cpuLoad: "f0000300:0:7000021",
	memLoad: "f0000301:0:8000005",
	gpuTemp: "e0002000:0:1000000",
	gpuHot: "e0002000:0:1000005",
	gpuPower: "e0002000:0:5000000",
	gpuLoad: "e0002000:0:7000000",
	vram: "e0002000:0:80000fc",
	pump: "f7006687:0:3000001",
	cpuFan: "f7006687:0:3000000",
	netDown: "f000ea00:0:8000002",
	netUp: "f000ea00:0:8000003"
};

// ---------- shot 1: hero ----------
async function hero() {
	// An "under load" scenario — every face is still drawn by the real renderer.
	const faces = [
		face({ key: K.cpuTemp, label: "CPU Temp", forceValue: 71.4 }),
		face({ key: K.cpuPower, label: "CPU Power", forceValue: 142.8 }),
		face({ key: K.coreClock, label: "Core 1 Clock", forceValue: 5625 }),
		face({ key: K.cpuLoad, label: "CPU Load", forceValue: 87.4 }),
		face({ key: K.memLoad, label: "Memory Load", spark: false }),
		face({ key: K.gpuTemp, label: "GPU Temp", level: "warn", forceValue: 84.6 }),
		// "GPU Hot" fits the badge-shortened label band without truncation.
		face({ key: K.gpuHot, label: "GPU Hot", level: "crit", forceValue: 106.2, statBadge: "MAX" }),
		face({ key: K.gpuPower, label: "GPU Power", forceValue: 316.4 }),
		face({ key: K.gpuLoad, label: "GPU Load", forceValue: 98 }),
		face({ key: K.vram, label: "VRAM Alloc", spark: false, forceValue: 14206 }),
		face({ key: K.pump, label: "Pump" }),
		face({ key: K.cpuFan, label: "CPU Fan", spark: false, forceValue: 1466 }),
		face({ key: K.ccd1, label: "CCD1 (X3D)", forceValue: 66.9 }),
		face({ key: K.netDown, label: "Net Down", forceValue: 48700 }),
		face({ key: K.netUp, label: "Net Up" })
	];

	const KEY = 176;
	const GAP = 14;
	const PAD = 42;
	const deckW = 5 * KEY + 4 * GAP + 2 * PAD;
	const deckH = 3 * KEY + 2 * GAP + 2 * PAD;
	const deckX = W - deckW - 96;
	const deckY = Math.round((H - deckH) / 2);

	const chrome = [
		`<rect x="${deckX}" y="${deckY}" width="${deckW}" height="${deckH}" rx="34" fill="#131418" stroke="#26282E" stroke-width="1.5"/>`,
		`<text x="96" y="392" font-family="${FONT}" font-size="66" font-weight="700" fill="${HEADLINE}">HWiNFO Sensors</text>`,
		`<text x="96" y="446" font-family="${FONT}" font-size="26" font-weight="400" fill="${BODY}">Live hardware readings on your Stream Deck.</text>`,
		`<text x="96" y="522" font-family="${MONO}" font-size="17" fill="${CYAN}">temperatures · clocks · fans · power · load · network</text>`,
		`<text x="96" y="560" font-family="${MONO}" font-size="17" fill="${MUTED}">7 themes · type accents · sparklines · aviation-style alerts</text>`,
		`<text x="96" y="912" font-family="${MONO}" font-size="15" fill="${MUTED}">every key face above is real plugin output: Ryzen 9 9950X3D + RTX 4090</text>`
	];

	const composites = [];
	for (let i = 0; i < faces.length; i++) {
		const col = i % 5;
		const row = Math.floor(i / 5);
		composites.push({
			input: await roundedKey(faces[i], KEY, 20, "#26282E"),
			left: deckX + PAD + col * (KEY + GAP),
			top: deckY + PAD + row * (KEY + GAP)
		});
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-1-hero.png"));
}

// ---------- shot 2: themes ----------
async function themes() {
	const names = Object.keys(config.themes);
	const KEY = 196;
	const GAP = 22;
	const totalW = names.length * KEY + (names.length - 1) * GAP;
	const startX = Math.round((W - totalW) / 2);
	const rowY = [246, 246 + KEY + 54];

	const chrome = [
		`<text x="960" y="96" text-anchor="middle" font-family="${FONT}" font-size="52" font-weight="700" fill="${HEADLINE}">Seven themes. One instrument.</text>`,
		`<text x="960" y="142" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${BODY}">Per key or deck-wide. Anchors never move, only the palette changes.</text>`,
		`<text x="960" y="${rowY[1] + KEY + 64}" text-anchor="middle" font-family="${FONT}" font-size="21" fill="${BODY}">Alerts are global and never themed: amber field with black text at warn, red with white at critical.</text>`
	];

	const composites = [];
	for (let i = 0; i < names.length; i++) {
		const theme = names[i];
		const x = startX + i * (KEY + GAP);
		chrome.push(`<text x="${x + KEY / 2}" y="${rowY[0] - 26}" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${theme === "void" ? CYAN : MUTED}">${theme}${theme === "void" ? " · default" : ""}</text>`);
		composites.push({ input: await roundedKey(face({ key: K.cpuTemp, label: "CPU Temp", theme }), KEY, 22, "#26282E"), left: x, top: rowY[0] });
		composites.push({ input: await roundedKey(face({ key: K.gpuPower, label: "GPU Power", theme, statBadge: "AVG" }), KEY, 22, "#26282E"), left: x, top: rowY[1] });
	}

	// centered warn/crit pair under the wall
	const pairY = rowY[1] + KEY + 92;
	const pair = [
		face({ key: K.gpuTemp, label: "GPU Temp", level: "warn", forceValue: 84.6 }),
		face({ key: K.gpuHot, label: "GPU Hot", level: "crit", forceValue: 106.2, statBadge: "MAX" })
	];
	for (let i = 0; i < 2; i++) {
		composites.push({ input: await roundedKey(pair[i], 150, 17, "#26282E"), left: 960 - 160 + i * 170, top: pairY });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-3-themes.png"));
}

// ---------- shot 4: dials (Stream Deck +) ----------
async function dials() {
	const mk = (key, label, statMode, fraction, { forceValue, forceBar } = {}) => {
		const r = byKey(key);
		const accent = classifyTypeAccent(r.type, r.unit, r.label);
		const palette = resolvePalette(config, "void", accent, "normal");
		return renderDial({
			title: label,
			valueText: formatValue(forceValue ?? r.value, "auto"),
			unitText: `${r.unit}${statMode ? " · " + statMode : ""}`.trim(),
			statsText: `▼ ${formatValue(r.valueMin, "auto")}   ▲ ${formatValue(Math.max(r.valueMax, forceValue ?? 0), "auto")}   session`,
			fraction,
			palette,
			barColor: forceBar ?? palette.accent
		});
	};
	const strip = [
		mk(K.cpuTemp, "CPU Temp", "", 0.58, { forceValue: 71.4 }),
		mk(K.gpuPower, "GPU Power", "", 0.53, { forceValue: 316.4 }),
		mk(K.pump, "Pump", "", 0.92),
		mk(K.gpuHot, "GPU Hot Spot", "MAX", 0.97, { forceValue: 106.2, forceBar: config.alerts.crit.bg })
	];
	const keys = [
		face({ key: K.cpuTemp, label: "CPU Temp", forceValue: 71.4 }),
		face({ key: K.gpuTemp, label: "GPU Temp", forceValue: 76.2 }),
		face({ key: K.cpuLoad, label: "CPU Load", forceValue: 87.4 }),
		face({ key: K.gpuLoad, label: "GPU Load", forceValue: 98 }),
		face({ key: K.cpuPower, label: "CPU Power", forceValue: 142.8 }),
		face({ key: K.gpuPower, label: "GPU Power", forceValue: 316.4 }),
		face({ key: K.netDown, label: "Net Down", forceValue: 48700 }),
		face({ key: K.memLoad, label: "Memory Load", spark: false })
	];

	const KEY = 148;
	const GAP = 14;
	const PAD = 40;
	const stripW = 4 * 296 + 3 * GAP; // dials rendered 200x100 → 296x148
	const deckW = Math.max(4 * KEY + 3 * GAP, stripW) + 2 * PAD;
	const keysW = 4 * KEY + 3 * GAP;
	const deckH = PAD + 2 * KEY + GAP + 26 + 148 + 100 + PAD;
	const deckX = W - deckW - 110;
	const deckY = Math.round((H - deckH) / 2);

	const chrome = [
		`<rect x="${deckX}" y="${deckY}" width="${deckW}" height="${deckH}" rx="34" fill="#131418" stroke="#26282E" stroke-width="1.5"/>`,
		`<text x="110" y="360" font-family="${FONT}" font-size="56" font-weight="700" fill="${HEADLINE}">Dials, themed too.</text>`,
		`<text x="110" y="418" font-family="${FONT}" font-size="24" fill="${BODY}">Stream Deck + and + XL</text>`,
		`<text x="110" y="454" font-family="${FONT}" font-size="24" fill="${BODY}">touchscreen slots: live value,</text>`,
		`<text x="110" y="490" font-family="${FONT}" font-size="24" fill="${BODY}">session range, and a bar that</text>`,
		`<text x="110" y="526" font-family="${FONT}" font-size="24" fill="${BODY}">flips to the alert color when</text>`,
		`<text x="110" y="562" font-family="${FONT}" font-size="24" fill="${BODY}">a threshold trips.</text>`,
		`<text x="110" y="622" font-family="${MONO}" font-size="16" fill="${MUTED}">rotate · switch reading</text>`,
		`<text x="110" y="654" font-family="${MONO}" font-size="16" fill="${MUTED}">push · reset session</text>`,
		`<text x="110" y="686" font-family="${MONO}" font-size="16" fill="${MUTED}">touch · cycle stat</text>`
	];

	const composites = [];
	const keysX = deckX + Math.round((deckW - keysW) / 2);
	for (let i = 0; i < keys.length; i++) {
		composites.push({
			input: await roundedKey(keys[i], KEY, 17, "#26282E"),
			left: keysX + (i % 4) * (KEY + GAP),
			top: deckY + PAD + Math.floor(i / 4) * (KEY + GAP)
		});
	}
	const stripX = deckX + Math.round((deckW - stripW) / 2);
	const stripY = deckY + PAD + 2 * KEY + GAP + 26;
	for (let i = 0; i < strip.length; i++) {
		const png = await rasterize(strip[i], 1.48, 200, 100);
		const mask = Buffer.from(`<svg width="296" height="148"><rect width="296" height="148" rx="10" fill="#fff"/></svg>`);
		const framed = await sharp(png).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
		composites.push({ input: framed, left: stripX + i * (296 + GAP), top: stripY });
		// knob under each slot
		const knobX = stripX + i * (296 + GAP) + 148;
		composites.push({
			input: Buffer.from(
				`<svg width="76" height="76"><circle cx="38" cy="38" r="36" fill="#1B1D22" stroke="#2E3138" stroke-width="2"/><circle cx="38" cy="38" r="28" fill="#101116"/><rect x="36.5" y="12" width="3" height="12" rx="1.5" fill="#4CC2FF"/></svg>`
			),
			left: knobX - 38,
			top: stripY + 148 + 22
		});
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-5-dials.png"));
}

// ---------- shot 3: settings panel (from capture-pi.mjs screenshots) ----------
async function settings(piDir) {
	const panels = [
		{ file: "pi-picker.png", title: "Searchable picker: every reading, live values" },
		{ file: "pi-settings.png", title: "Themes, thresholds and gauges per key" }
	];
	const CROP_H = 1150; // content ends at the Advanced fold (2× captures are 800px wide)
	const SCALE_H = 700;
	const w = Math.round(800 * (SCALE_H / CROP_H));
	const gap = 96;
	const startX = Math.round((W - (2 * w + gap)) / 2);
	const top = 178;

	const chrome = [
		`<text x="960" y="84" text-anchor="middle" font-family="${FONT}" font-size="50" font-weight="700" fill="${HEADLINE}">Set up in seconds.</text>`,
		`<text x="960" y="130" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${BODY}">The real settings panel: search 500+ readings with live values, pick a theme, set thresholds.</text>`
	];
	const composites = [];
	for (let i = 0; i < panels.length; i++) {
		const x = startX + i * (w + gap);
		const img = await sharp(path.join(piDir, panels[i].file)).extract({ left: 0, top: 0, width: 800, height: CROP_H }).resize({ height: SCALE_H }).png().toBuffer();
		chrome.push(
			`<rect x="${x - 14}" y="${top - 14}" width="${w + 28}" height="${SCALE_H + 28}" rx="14" fill="${CARD_BG}" stroke="${CARD_BORDER}" stroke-width="1.5"/>`,
			`<text x="${x + w / 2}" y="${top + SCALE_H + 52}" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${MUTED}">${esc(panels[i].title)}</text>`
		);
		composites.push({ input: img, left: x, top });
	}
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "shot-4-settings.png"));
}

// ---------- thumbnail (dedicated 1920×960 listing card) ----------
async function thumbnail() {
	// Purpose-built per the guidelines: depicts real functionality with large
	// legible text — one row of real key faces + a real dial slot.
	const KEY = 220;
	const GAP = 18;
	const faces = [
		face({ key: K.cpuTemp, label: "CPU Temp", forceValue: 71.4 }),
		face({ key: K.gpuTemp, label: "GPU Temp", level: "warn", forceValue: 84.6 }),
		face({ key: K.cpuPower, label: "CPU Power", forceValue: 142.8 }),
		face({ key: K.gpuLoad, label: "GPU Load", forceValue: 98 }),
		face({ key: K.pump, label: "Pump" })
	];
	const rowW = faces.length * KEY + (faces.length - 1) * GAP;
	const rowX = Math.round((W - rowW) / 2);
	const rowY = 404;

	const r = byKey(K.gpuHot);
	const palette = resolvePalette(config, "void", classifyTypeAccent(r.type, r.unit, r.label), "normal");
	const dial = renderDial({
		title: "GPU Hot Spot",
		valueText: formatValue(106.2, "auto"),
		unitText: "°C · MAX",
		statsText: `▼ ${formatValue(r.valueMin, "auto")}   ▲ 106.2   session`,
		fraction: 0.97,
		palette,
		barColor: config.alerts.crit.bg
	});

	const chrome = [
		`<text x="960" y="180" text-anchor="middle" font-family="${FONT}" font-size="86" font-weight="700" fill="${HEADLINE}">HWiNFO Sensors</text>`,
		`<text x="960" y="248" text-anchor="middle" font-family="${FONT}" font-size="32" fill="${BODY}">Live hardware readings on keys and dials</text>`,
		`<text x="960" y="322" text-anchor="middle" font-family="${MONO}" font-size="22" fill="${CYAN}">temperatures · clocks · fans · power · load · network</text>`,
		`<text x="960" y="878" text-anchor="middle" font-family="${MONO}" font-size="20" fill="${MUTED}">7 themes · sparklines · warn/critical alerts · Stream Deck + and + XL</text>`
	];
	const composites = [];
	for (let i = 0; i < faces.length; i++) {
		composites.push({ input: await roundedKey(faces[i], KEY, 24, "#26282E"), left: rowX + i * (KEY + GAP), top: rowY });
	}
	// centered dial slot under the key row
	const dialPng = await rasterize(dial, 1.6, 200, 100);
	const dialMask = Buffer.from(`<svg width="320" height="160"><rect width="320" height="160" rx="12" fill="#fff"/></svg>`);
	composites.push({ input: await sharp(dialPng).composite([{ input: dialMask, blend: "dest-in" }]).png().toBuffer(), left: 960 - 160, top: rowY + KEY + 44 });
	await sharp(Buffer.from(pageBase(W, H, chrome))).composite(composites).png().toFile(path.join(outDir, "thumbnail.png"));
}

await hero();
await themes();
await dials();
await thumbnail();
const piDir = process.argv[3];
if (piDir !== undefined) {
	await settings(piDir);
	console.log(`Rendered thumbnail + shots 1, 3, 4, 5 (${W}x${H}) to ${outDir}/`);
} else {
	console.log(`Rendered thumbnail + shots 1, 3, 5 (${W}x${H}) to ${outDir}/ (pass a capture dir with pi-settings.png + pi-picker.png for shot 4)`);
}
