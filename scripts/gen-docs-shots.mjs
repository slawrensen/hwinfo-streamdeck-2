// Regenerates the plugin-rendered images used by the documentation site that no
// other tool covers — currently the status-screen grid. (Theme/alert key faces
// come from `npm run contact-sheet`; the settings panel from the pi-harness.)
// Straight from the real renderer, no Stream Deck needed.
//   npx tsx scripts/gen-docs-shots.mjs [outDir=docs/assets/img]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { renderStatusKey } from "../src/ui/key-renderer.ts";
import { missingReadingScreen, noSelectionScreen, statusScreen } from "../src/ui/state-screens.ts";

const outDir = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "assets", "img");
mkdirSync(outDir, { recursive: true });

const unavailable = (reason) => statusScreen({ state: "unavailable", reason, message: "" });
const stale = (source) => statusScreen({ state: "stale", snapshot: {}, source, staleForMs: 20_000 });

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
	const label = Buffer.from(`<svg width="${KEY}" height="${LABEL}"><text x="${KEY / 2}" y="20" text-anchor="middle" font-family="Segoe UI, Arial" font-size="18" fill="#c8c8c8">${name}</text></svg>`);
	layers.push({ input: key, left: x, top: y }, { input: label, left: x, top: y + KEY + 4 });
}

const outFile = path.join(outDir, "status-screens.png");
writeFileSync(outFile, await sharp({ create: { width: W, height: H, channels: 3, background: "#111317" } }).composite(layers).png().toBuffer());
console.log(`wrote ${outFile} (${W}x${H})`);
