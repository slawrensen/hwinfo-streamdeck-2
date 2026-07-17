/**
 * Issue #3 visual proof: adaptive label typography and the triple-row key
 * layout, rendered by the PRODUCTION renderers (never mocks) across the
 * matrix the change touches — single/dual/triple/quad, short and long
 * labels, badges, gauges, themes, alert levels and text modes.
 *
 * Run: node --import tsx scripts/issue3-proof.mjs <outDir>
 *
 * Emits, deterministically named:
 *   issue3-proof-144.png     every face at the native 144 px canvas
 *   issue3-proof-72.png      the same faces downscaled to the 72 px physical key
 *   issue3-deck-sim.png      a Stream-Deck-spaced key grid at physical scale
 *   faces/<id>.png           each face alone at 144 px (for close inspection)
 *
 * Every face passes structural checks (well-formed, in-bounds coordinates,
 * the 12 px font floor, no unsupported SVG features, URI-encodable) and the
 * script fails hard if sharp cannot rasterize any face.
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import sharp from "sharp";

import { renderDualKey, renderQuadKey, renderReadingKey, renderTripleKey } from "../src/ui/key-renderer";
import { resolveTextColors } from "../src/ui/text-colors";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const outDir = process.argv[2] ?? ".";
mkdirSync(path.join(outDir, "faces"), { recursive: true });

const config = loadThemes();
const P = (theme, level = "normal", accent = null) => resolvePalette(config, theme, accent, level);
const VOID = P("void");
const PAPER = P("paper");
const EMBER = P("ember", "normal", "temperature");
const WARN = P("void", "warn");
const CRIT = P("void", "crit");
const custom = (palette, color) => resolveTextColors(palette, { mode: "custom", color, dimSecondary: true }, "normal");
const dim = (palette) => resolveTextColors(palette, { mode: "dim", color: undefined, dimSecondary: false }, "normal");

const HISTORY = [52, 55, 51, 58, 61, 57, 63, 60, 66, 62, 59, 64];
const BAR = { kind: "bar", fraction: 0.62, zones: [{ from: 0.7, to: 0.88, color: "#8A5E06" }, { from: 0.88, to: 1, color: "#7A1B12" }] };
const RING = { kind: "ring", fraction: 0.62, zones: [{ from: 0.7, to: 0.88, color: "#8A5E06" }, { from: 0.88, to: 1, color: "#7A1B12" }] };

const tRow = (label, valueText, unitText) => ({ label, valueText, unitText });
const dRow = (label, valueText, unitText, statBadge = "") => ({ label, valueText, unitText, statBadge });
const qCell = (label, valueText, unitText, color) => ({ label, valueText, unitText, color });
const QC = ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"];

/** [section, id, svg] triples; ids are stable filenames. */
const faces = [
	// -------- single: the adaptive label ladder --------
	["single", "short-ccd1", renderReadingKey({ label: "CCD1", valueText: "35.9", unitText: "°C", statBadge: "", history: HISTORY, palette: VOID })],
	["single", "short-vcore", renderReadingKey({ label: "Vcore", valueText: "1.032", unitText: "V", statBadge: "", palette: VOID })],
	["single", "medium-core-max", renderReadingKey({ label: "Core Max", valueText: "53.9", unitText: "°C", statBadge: "", palette: VOID })],
	["single", "medium-cpu-die", renderReadingKey({ label: "CPU Die", valueText: "61.4", unitText: "°C", statBadge: "", palette: EMBER })],
	["single", "medium-gpu-hot-max", renderReadingKey({ label: "GPU Hot Max", valueText: "78.5", unitText: "°C", statBadge: "", palette: VOID })],
	["single", "long-tctl", renderReadingKey({ label: "CPU (Tctl/Tdie)", valueText: "56.9", unitText: "°C", statBadge: "", history: HISTORY, palette: VOID })],
	["single", "verylong-vmem", renderReadingKey({ label: "Virtual Memory Committed", valueText: "48.6", unitText: "GB", statBadge: "", palette: VOID })],
	["single", "badge-short", renderReadingKey({ label: "CCD1", valueText: "63.1", unitText: "°C", statBadge: "MAX", history: HISTORY, palette: VOID })],
	["single", "badge-long", renderReadingKey({ label: "CPU (Tctl/Tdie)", valueText: "84.2", unitText: "°C", statBadge: "MAX", palette: EMBER })],
	["single", "bar", renderReadingKey({ label: "Core Max", valueText: "53.9", unitText: "°C", statBadge: "", gauge: BAR, palette: VOID })],
	["single", "ring", renderReadingKey({ label: "CCD2", valueText: "37.3", unitText: "°C", statBadge: "", gauge: RING, palette: VOID })],
	["single", "paper", renderReadingKey({ label: "Total CPU Usage", valueText: "54.0", unitText: "%", statBadge: "", palette: PAPER })],
	["single", "cjk-label", renderReadingKey({ label: "電力消費量テスト", valueText: "142.8", unitText: "W", statBadge: "", palette: VOID })],

	// -------- dual: labels one step larger where they fit --------
	["dual", "short-labels", renderDualKey({ top: dRow("CCD1", "35.9", "°C"), bottom: dRow("CCD2", "37.3", "°C"), palette: VOID })],
	["dual", "long-labels", renderDualKey({ top: dRow("Virtual Memory Committed", "48.6", "GB"), bottom: dRow("Current DL rate", "142", "Mbps"), palette: VOID })],
	["dual", "long-values", renderDualKey({ top: dRow("Counter", "1234567890", ""), bottom: dRow("Core 0 Clock", "5025", "MHz"), palette: VOID })],
	["dual", "shared-max", renderDualKey({ top: dRow("CCD1", "63.1", "°C"), bottom: dRow("CCD2", "59.8", "°C"), sharedBadge: "MAX", palette: VOID })],
	["dual", "pinned-stats", renderDualKey({ top: dRow("CPU Package", "56.3", "°C"), bottom: dRow("CPU Package", "84.2", "°C", "MAX"), palette: VOID })],
	["dual", "warn", renderDualKey({ top: dRow("CCD1", "88.2", "°C"), bottom: dRow("CCD2", "79.8", "°C"), palette: WARN })],
	["dual", "crit", renderDualKey({ top: dRow("CCD1", "96.0", "°C"), bottom: dRow("CCD2", "88.1", "°C"), palette: CRIT })],

	// -------- triple: the issue #3 layout --------
	["triple", "temps", renderTripleKey({ rows: [tRow("CCD1", "35.9", "°C"), tRow("CCD2", "37.3", "°C"), tRow("Core Max", "53.9", "°C")], palette: VOID })],
	["triple", "mixed-units", renderTripleKey({ rows: [tRow("Core 0 Clock", "2385", "MHz"), tRow("Total CPU Usage", "54.0", "%"), tRow("Vcore", "1.00", "V")], palette: VOID })],
	["triple", "wide-units", renderTripleKey({ rows: [tRow("Pump", "5025", "RPM"), tRow("Current DL rate", "68.5", "Mbps"), tRow("Committed", "48.6", "GB")], palette: VOID })],
	["triple", "tiny-values", renderTripleKey({ rows: [tRow("Fan Stop", "7", "%"), tRow("SoC Power", "68.5", "W"), tRow("Vcore", "1.00", "V")], palette: VOID })],
	["triple", "long-labels", renderTripleKey({ rows: [tRow("CPU (Tctl/Tdie)", "56.9", "°C"), tRow("CPU Die (average)", "52.2", "°C"), tRow("Virtual Memory Committed", "48.6", "GB")], palette: VOID })],
	["triple", "missing-middle", renderTripleKey({ rows: [tRow("CCD1", "35.9", "°C"), tRow("Sensor missing", "—", ""), tRow("Core Max", "53.9", "°C")], palette: VOID })],
	["triple", "two-rows", renderTripleKey({ rows: [tRow("CCD1", "35.9", "°C"), tRow("CCD2", "37.3", "°C"), null], palette: VOID })],
	["triple", "badge-max", renderTripleKey({ rows: [tRow("CCD1", "63.1", "°C"), tRow("CCD2", "59.8", "°C"), tRow("Core Max", "71.2", "°C")], sharedBadge: "MAX", palette: VOID })],
	["triple", "warn", renderTripleKey({ rows: [tRow("CCD1", "88.2", "°C"), tRow("CCD2", "79.8", "°C"), tRow("Core Max", "89.9", "°C")], palette: WARN })],
	["triple", "crit", renderTripleKey({ rows: [tRow("CCD1", "96.0", "°C"), tRow("CCD2", "88.1", "°C"), tRow("Core Max", "97.4", "°C")], palette: CRIT })],
	["triple", "paper", renderTripleKey({ rows: [tRow("CCD1", "35.9", "°C"), tRow("CCD2", "37.3", "°C"), tRow("Core Max", "53.9", "°C")], palette: PAPER })],
	["triple", "ember-accent", renderTripleKey({ rows: [tRow("CCD1", "35.9", "°C"), tRow("CCD2", "37.3", "°C"), tRow("Core Max", "53.9", "°C")], palette: EMBER })],
	["triple", "text-dim", renderTripleKey({ rows: [tRow("CCD1", "35.9", "°C"), tRow("CCD2", "37.3", "°C"), tRow("Core Max", "53.9", "°C")], palette: VOID, text: dim(VOID) })],
	["triple", "text-custom", renderTripleKey({ rows: [tRow("CCD1", "35.9", "°C"), tRow("CCD2", "37.3", "°C"), tRow("Core Max", "53.9", "°C")], palette: VOID, text: custom(VOID, "#7FD4A8") })],
	["triple", "long-unit-cut", renderTripleKey({ rows: [tRow("API", "1234.5", "requests/sec"), tRow("CCD2", "37.3", "°C"), null], palette: VOID })],

	// -------- quad: micro-labels raised toward 14 --------
	["quad", "labeled", renderQuadKey({ cells: [qCell("CCD1", "35.9", "°C", QC[0]), qCell("CCD2", "37.3", "°C", QC[1]), qCell("Pump", "2850", "RPM", QC[2]), qCell("SoC", "68.5", "W", QC[3])], labels: true, palette: VOID })],
	["quad", "wide-caps", renderQuadKey({ cells: [qCell("WWWW", "35.9", "°C", QC[0]), qCell("MMMM", "37.3", "°C", QC[1]), qCell("GPU", "2850", "MHz", QC[2]), qCell("VRAM", "12.4", "GB", QC[3])], labels: true, palette: VOID })],
	["quad", "four-glyph-values", renderQuadKey({ cells: [qCell("CPU", "-999", "W", QC[0]), qCell("GPU", "10.0", "%", QC[1]), qCell("MEM", "48.7", "GB", QC[2]), qCell("NET", "1.0", "Gbps", QC[3])], labels: true, palette: VOID })],
	["quad", "alert", renderQuadKey({ cells: [qCell("CCD1", "96.0", "°C", CRIT.label), qCell("CCD2", "88.1", "°C", CRIT.label), qCell("Pump", "2850", "RPM", CRIT.label), null], labels: true, sharedBadge: "MAX", palette: CRIT })]
];

// ---------------------------------------------------------------- checks --
const failures = [];
const checkFace = (id, svg) => {
	const fail = (why) => failures.push(`${id}: ${why}`);
	if (!svg.startsWith("<svg xmlns=") || !svg.endsWith("</svg>")) fail("not a well-formed SVG document");
	for (const poison of ["NaN", "Infinity", "undefined", "null"]) {
		if (svg.includes(poison)) fail(`contains ${poison}`);
	}
	for (const feature of ["clipPath", "dominant-baseline", "<style", "<filter", "<mask", "textLength"]) {
		if (svg.includes(feature)) fail(`unsupported SVG feature ${feature}`);
	}
	for (const match of svg.matchAll(/ x="(-?[\d.]+)"/g)) {
		const x = Number(match[1]);
		if (!(x >= 0 && x <= 144)) fail(`x=${x} outside the canvas`);
	}
	for (const match of svg.matchAll(/ width="(-?[\d.]+)"/g)) {
		if (Number(match[1]) < 0) fail(`negative width ${match[1]}`);
	}
	for (const match of svg.matchAll(/font-size="([\d.]+)"/g)) {
		if (Number(match[1]) < 12) fail(`font ${match[1]} below the 12px floor`);
	}
	try {
		encodeURIComponent(svg);
	} catch {
		fail("not URI-encodable (lone surrogate?)");
	}
};
for (const [, id, svg] of faces) checkFace(id, svg);
if (failures.length > 0) {
	console.error(`ISSUE3 PROOF: ${failures.length} structural failure(s)`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}

// ------------------------------------------------------------- rasterize --
const KEY = 144;
const esc = (t) => t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

async function sheet(px, file) {
	const cell = px + 8;
	const perRow = 7;
	const sections = [...new Set(faces.map(([s]) => s))];
	const composites = [];
	const headers = [];
	let y = 6;
	for (const section of sections) {
		const group = faces.filter(([s]) => s === section);
		headers.push(`<text x="8" y="${y + 14}" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" fill="#9aa3b2">${esc(section.toUpperCase())}</text>`);
		y += 22;
		for (let i = 0; i < group.length; i++) {
			const [, id, svg] = group[i];
			const col = i % perRow;
			const row = Math.floor(i / perRow);
			const left = 8 + col * cell;
			const top = y + row * (cell + 14);
			composites.push({ input: await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer(), left, top });
			headers.push(`<text x="${left}" y="${top + px + 11}" font-family="Segoe UI, Arial, sans-serif" font-size="9" fill="#6b7280">${esc(id)}</text>`);
		}
		y += Math.ceil(group.length / perRow) * (cell + 14) + 8;
	}
	const width = 8 + perRow * cell + 8;
	const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}"><rect width="${width}" height="${y}" fill="#101013"/>${headers.join("")}</svg>`;
	const out = path.join(outDir, file);
	const info = await sharp(Buffer.from(base)).composite(composites).png().toFile(out);
	console.log(`${file}: ${info.width}x${info.height} (${faces.length} faces at ${px}px)`);
}

/** A Stream-Deck-spaced grid at physical 72 px: key pitch ~ key + 28%. */
async function deckSim(file) {
	const px = 72;
	const gap = 20;
	const picks = [
		"single/short-ccd1",
		"single/badge-short",
		"single/long-tctl",
		"triple/temps",
		"triple/mixed-units",
		"single/ring",
		"dual/short-labels",
		"triple/badge-max",
		"triple/long-labels",
		"quad/labeled",
		"triple/warn",
		"triple/crit",
		"triple/paper",
		"single/bar",
		"quad/wide-caps"
	];
	const cols = 5;
	const composites = [];
	// The physical key lens rounds its corners; a rounded mask makes the sim
	// honest about what survives near the edges.
	const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><rect width="${px}" height="${px}" rx="7" fill="#fff"/></svg>`);
	for (let i = 0; i < picks.length; i++) {
		const face = faces.find(([s, id]) => `${s}/${id}` === picks[i]);
		if (face === undefined) throw new Error(`deck sim pick missing: ${picks[i]}`);
		const png = await sharp(Buffer.from(face[2]))
			.resize(px, px)
			.composite([{ input: mask, blend: "dest-in" }])
			.png()
			.toBuffer();
		composites.push({ input: png, left: 24 + (i % cols) * (px + gap), top: 24 + Math.floor(i / cols) * (px + gap) });
	}
	const width = 24 * 2 + cols * px + (cols - 1) * gap;
	const height = 24 * 2 + 3 * px + 2 * gap;
	const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="14" fill="#17181c"/></svg>`;
	const out = path.join(outDir, file);
	const info = await sharp(Buffer.from(base)).composite(composites).png().toFile(out);
	console.log(`${file}: ${info.width}x${info.height} (${picks.length} keys at physical ${px}px)`);
}

for (const [section, id, svg] of faces) {
	await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, "faces", `${section}-${id}.png`));
}
await sheet(KEY, "issue3-proof-144.png");
await sheet(72, "issue3-proof-72.png");
await deckSim("issue3-deck-sim.png");
console.log(`ISSUE3 PROOF: ${faces.length} faces structurally clean, rasterized to ${outDir}`);
