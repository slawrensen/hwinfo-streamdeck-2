// Gallery board 5: the real-hardware photograph on the standard 1920x960
// marketplace board (chrome and type mirror scripts/marketplace-shots.mjs;
// keep the tokens in sync with it). Separate from marketplace-shots.mjs on
// purpose: the photo is an external source, not renderer output, so the
// automated pipelines never depend on it.
//
//   node scripts/shot2-hardware.mjs [photoPath]
//
// photoPath defaults to the processed ProRAW edit; pass any reworked photo
// (a Photoshop pass, a new shot) and the board rebuilds around its aspect.
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PHOTO = process.argv[2] ?? path.join(repoRoot, "marketing", "hwinfo-streamdeckxlplus-squared.png");
const OUT = path.join(repoRoot, "marketing", "shot-2-hardware.png");

const W = 1920;
const H = 960;
const PAGE_BG = "#0B0C0E";
const CARD_BG = "#101116";
const CARD_BORDER = "#1D2026";
const HEADLINE = "#EDEFF4";
const BODY = "#A9AFBC";
const MUTED = "#6B7280";
const FONT = "Segoe UI, Arial, sans-serif";
const MONO = "Cascadia Code, Consolas, monospace";

const meta = await sharp(PHOTO).metadata();
const pad = 14;
// Fit the photo into the right column, preserving its aspect.
const maxH = H - 2 * (49 + pad);
const maxW = 1020;
const scale = Math.min(maxH / meta.height, maxW / meta.width);
const pw = Math.round(meta.width * scale);
const ph = Math.round(meta.height * scale);
const cardW = pw + 2 * pad;
const cardH = ph + 2 * pad;
const cardX = W - 96 - cardW;
const cardY = Math.round((H - cardH) / 2);

const chrome = [
	`<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="${CARD_BG}" stroke="${CARD_BORDER}" stroke-width="1.5"/>`,
	`<text x="96" y="330" font-family="${FONT}" font-size="52" font-weight="700" fill="${HEADLINE}">A photo, not a render.</text>`,
	`<text x="96" y="406" font-family="${FONT}" font-size="24" fill="${BODY}">My own Stream Deck + XL running the plugin live:</text>`,
	`<text x="96" y="442" font-family="${FONT}" font-size="24" fill="${BODY}">36 keys and six dial readouts from HWiNFO.</text>`,
	`<text x="96" y="518" font-family="${MONO}" font-size="16" fill="${MUTED}">keys · live values, sparklines, alerts</text>`,
	`<text x="96" y="550" font-family="${MONO}" font-size="16" fill="${MUTED}">touchstrip · six dial readouts</text>`,
	`<text x="96" y="582" font-family="${MONO}" font-size="16" fill="${MUTED}">knobs · rotate, press+rotate, push</text>`
];
const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAGE_BG}"/>${chrome.join("")}</svg>`;

const photo = await sharp(PHOTO).resize(pw, ph).png().toBuffer();
const mask = Buffer.from(`<svg width="${pw}" height="${ph}"><rect width="${pw}" height="${ph}" rx="10" fill="#fff"/></svg>`);
const rounded = await sharp(photo).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();

await sharp(Buffer.from(base))
	.composite([{ input: rounded, left: cardX + pad, top: cardY + pad }])
	.png()
	.toFile(OUT);
console.log(`wrote ${OUT} (photo ${pw}x${ph} from ${path.basename(PHOTO)})`);
