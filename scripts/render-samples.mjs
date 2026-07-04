// Dev utility: rasterizes sample key faces to scratch PNGs for visual review.
// Usage: node scripts/render-samples.mjs <outputDir>
import path from "node:path";
import sharp from "sharp";

// Import the compiled renderer via tsx-less trick: re-implemented import from
// the TypeScript sources is not possible here, so this script is executed
// through tsx (see package.json "samples").
import { renderReadingKey, renderStatusKey } from "../src/ui/key-renderer";
import { noSelectionScreen, missingReadingScreen, statusScreen } from "../src/ui/state-screens";

const outDir = process.argv[2] ?? ".";
const history = [52, 54, 53, 58, 61, 60, 64, 63, 66, 71, 69, 74, 72, 70, 75, 78];

const samples = {
	"key-normal": renderReadingKey({ label: "CPU (Tctl/Tdie)", valueText: "56.3", unitText: "°C", level: "normal", statBadge: "" }),
	"key-spark": renderReadingKey({ label: "CPU Package", valueText: "78.1", unitText: "°C", level: "normal", statBadge: "", history }),
	"key-warn": renderReadingKey({ label: "GPU Hot Spot", valueText: "87", unitText: "°C", level: "warn", statBadge: "", history }),
	"key-crit": renderReadingKey({ label: "VRM", valueText: "104", unitText: "°C", level: "crit", statBadge: "" }),
	"key-max": renderReadingKey({ label: "Total Power", valueText: "412.9", unitText: "W", level: "normal", statBadge: "MAX" }),
	"key-long": renderReadingKey({ label: "Virtual Memory C…", valueText: "48.7k", unitText: "MB", level: "normal", statBadge: "AVG", history }),
	"state-not-running": renderStatusKey(statusScreen({ state: "unavailable", reason: "not-running", message: "" })),
	"state-disabled": renderStatusKey(statusScreen({ state: "unavailable", reason: "disabled", message: "" })),
	"state-denied": renderStatusKey(statusScreen({ state: "unavailable", reason: "access-denied", message: "" })),
	"state-stale": renderStatusKey(statusScreen({ state: "stale", snapshot: {}, staleForMs: 20000 })),
	"state-pick": renderStatusKey(noSelectionScreen()),
	"state-missing": renderStatusKey(missingReadingScreen())
};

for (const [name, svg] of Object.entries(samples)) {
	await sharp(Buffer.from(svg)).resize(144, 144).png().toFile(path.join(outDir, `${name}.png`));
}

// contact sheet 6 x 2
const names = Object.keys(samples);
const composite = names.map((name, i) => ({
	input: path.join(outDir, `${name}.png`),
	left: (i % 6) * 152 + 4,
	top: Math.floor(i / 6) * 152 + 4
}));
await sharp({ create: { width: 6 * 152 + 4, height: 2 * 152 + 4, channels: 4, background: "#101013" } })
	.composite(composite)
	.png()
	.toFile(path.join(outDir, "contact-sheet.png"));
console.log(`Rendered ${names.length} samples + contact-sheet.png to ${outDir}`);
