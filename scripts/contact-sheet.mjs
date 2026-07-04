// Proof sheet for the display spec: every theme in normal/warn/crit plus two
// dials, rasterized exactly as the plugin renders them.
// Usage: npm run contact-sheet [-- <outputDir>]   (runs under tsx — imports TS)
import path from "node:path";
import sharp from "sharp";

import { renderDial } from "../src/ui/dial-renderer";
import { renderReadingKey } from "../src/ui/key-renderer";
import { classifyTypeAccent, loadThemes, resolvePalette } from "../src/ui/themes";
import { SensorType } from "../src/hwinfo/types";

const outDir = process.argv[2] ?? ".";
const config = loadThemes();
const themes = Object.keys(config.themes);

const history = [52, 54, 53, 58, 61, 60, 64, 63, 66, 71, 69, 74, 72, 70, 75, 78, 74, 77, 80, 79, 83, 82, 85, 84, 88, 87, 86, 89, 91, 90, 92, 94, 93, 95, 97, 96];

// One representative reading per theme so the type accents all appear.
const READINGS = {
	void: { label: "CPU (Tctl/Tdie)", value: "56.3", unit: "°C", type: SensorType.Temperature },
	graphite: { label: "CPU Fan", value: "1180", unit: "RPM", type: SensorType.Fan },
	ultraviolet: { label: "Total CPU Usage", value: "37.4", unit: "%", type: SensorType.Usage },
	midnight: { label: "Current DL rate", value: "48.7", unit: "MB/s", type: SensorType.Other },
	forest: { label: "Core 0 Clock", value: "5462", unit: "MHz", type: SensorType.Clock },
	ember: { label: "CPU Package Power", value: "142.8", unit: "W", type: SensorType.Power },
	paper: { label: "Vcore", value: "1.288", unit: "V", type: SensorType.Voltage }
};

const KEY = 144;
const CELL = KEY + 8;
const HEADER = 22;
const DIAL_ROW_Y = HEADER + 3 * CELL + 12;
const SHEET_W = themes.length * CELL + 8;
const SHEET_H = DIAL_ROW_Y + 100 + 12;

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const headerSvg = (name, x) =>
	`<text x="${x}" y="15" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="#c8cdd6">${name}</text>`;

const composites = [];
const headers = [];
for (let i = 0; i < themes.length; i++) {
	const theme = themes[i];
	const reading = READINGS[theme];
	const accent = classifyTypeAccent(reading.type, reading.unit, reading.label);
	const x = i * CELL + 8;
	headers.push(headerSvg(theme, x + KEY / 2));

	const faces = [
		renderReadingKey({ label: reading.label, valueText: reading.value, unitText: reading.unit, statBadge: "", history, palette: resolvePalette(config, theme, accent, "normal") }),
		renderReadingKey({ label: reading.label, valueText: "87", unitText: reading.unit, statBadge: "", history, palette: resolvePalette(config, theme, accent, "warn") }),
		renderReadingKey({ label: reading.label, valueText: "104", unitText: reading.unit, statBadge: "MAX", palette: resolvePalette(config, theme, accent, "crit") })
	];
	for (let row = 0; row < faces.length; row++) {
		composites.push({ input: await png(faces[row]), left: x, top: HEADER + row * CELL });
	}
}

// Two dials: one live with a type accent, one pinned at critical.
const dials = [
	renderDial({
		title: "CPU (Tctl/Tdie)",
		valueText: "56.3",
		unitText: "°C",
		statsText: "▼ 42.0   ▲ 78.5   session",
		fraction: 0.62,
		palette: resolvePalette(config, "midnight", "temperature", "normal"),
		barColor: config.typeAccents.temperature
	}),
	renderDial({
		title: "GPU Hot Spot",
		valueText: "104",
		unitText: "°C · MAX",
		statsText: "▼ 61.0   ▲ 104.0   session",
		fraction: 0.97,
		palette: resolvePalette(config, "void", "temperature", "normal"),
		barColor: config.alerts.crit.bg
	})
];
for (let i = 0; i < dials.length; i++) {
	composites.push({ input: await png(dials[i]), left: 8 + i * 212, top: DIAL_ROW_Y });
}

const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}"><rect width="${SHEET_W}" height="${SHEET_H}" fill="#101013"/>${headers.join("")}</svg>`;
const file = path.join(outDir, "contact-sheet.png");
await sharp(Buffer.from(base)).composite(composites).png().toFile(file);
console.log(`Rendered ${themes.length}×3 keys + ${dials.length} dials to ${file}`);
