// Rasterizes the marketplace plugin icon — the manifest's top-level Icon must
// be PNG (256 px + 512 px @2x); every other image ships as a single SVG.
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "assets", "marketplace.svg");
const outDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin", "imgs", "plugin");

// Max zlib effort: same pixels, ~18% smaller files, and these two PNGs are
// the third-largest item in the pack after koffi and plugin.js. Palette
// quantization would halve them again but visibly fringes the icon's
// anti-aliased edges; adaptive filtering also measured larger. Level 9 alone
// is the only encode that shrinks the files with byte-identical pixels.
const png = { compressionLevel: 9 };
await sharp(source, { density: 300 }).resize(256, 256).png(png).toFile(path.join(outDir, "marketplace.png"));
await sharp(source, { density: 300 }).resize(512, 512).png(png).toFile(path.join(outDir, "marketplace@2x.png"));
console.log("Rendered marketplace.png (256) and marketplace@2x.png (512)");
