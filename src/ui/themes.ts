/**
 * Theme tokens for key and dial rendering. The single source of truth is
 * `themes.json` at the plugin root — the property inspector fetches the same
 * file for its preset gallery, so hexes exist exactly once. The loader
 * validates the file's shape on first use and fails loudly on drift.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SensorType } from "../hwinfo/types";
import type { AlertLevel } from "./format";

/** The six render tokens every theme and alert palette must define. */
export const TOKEN_KEYS = ["bg", "label", "value", "unit", "accent", "track"] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];
export type Palette = Readonly<Record<TokenKey, string>>;

export const TYPE_ACCENT_KEYS = ["temperature", "fan", "power", "clock", "load", "network", "memory"] as const;
export type TypeAccentKey = (typeof TYPE_ACCENT_KEYS)[number];

export type ThemesConfig = {
	readonly version: number;
	readonly defaultTheme: string;
	/** Theme applied when migrating installs that predate the theme system. */
	readonly legacyDefaultTheme: string;
	/** Themes on which type accents are ignored (e.g. light "paper"). */
	readonly typeAccentsDisabledOn: readonly string[];
	readonly themes: Readonly<Record<string, Palette>>;
	/** Global alert palettes — never themed; applied as a whole-key override. */
	readonly alerts: Readonly<Record<"warn" | "crit", Palette>>;
	readonly typeAccents: Readonly<Record<TypeAccentKey, string>>;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

function fail(path: string, problem: string): never {
	throw new Error(`themes.json invalid at ${path}: ${problem}`);
}

function validatePalette(value: unknown, path: string): Palette {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(path, "expected an object");
	}
	const record = value as Record<string, unknown>;
	for (const key of TOKEN_KEYS) {
		const hex = record[key];
		if (typeof hex !== "string" || !HEX.test(hex)) {
			fail(`${path}.${key}`, `expected a #RRGGBB hex, got ${JSON.stringify(hex)}`);
		}
	}
	const extra = Object.keys(record).filter((k) => !(TOKEN_KEYS as readonly string[]).includes(k));
	if (extra.length > 0) {
		fail(path, `unknown token(s): ${extra.join(", ")}`);
	}
	return record as Palette;
}

/** Validates the parsed JSON against the expected schema; throws on mismatch. */
export function validateThemesConfig(raw: unknown): ThemesConfig {
	if (typeof raw !== "object" || raw === null) {
		fail("$", "expected a top-level object");
	}
	const root = raw as Record<string, unknown>;
	if (typeof root.version !== "number") {
		fail("version", "expected a number");
	}
	if (typeof root.themes !== "object" || root.themes === null) {
		fail("themes", "expected an object");
	}
	const themes: Record<string, Palette> = {};
	for (const [name, palette] of Object.entries(root.themes as Record<string, unknown>)) {
		themes[name] = validatePalette(palette, `themes.${name}`);
	}
	if (Object.keys(themes).length === 0) {
		fail("themes", "no themes defined");
	}
	for (const field of ["defaultTheme", "legacyDefaultTheme"] as const) {
		if (typeof root[field] !== "string" || themes[root[field] as string] === undefined) {
			fail(field, "must name a defined theme");
		}
	}
	if (!Array.isArray(root.typeAccentsDisabledOn) || root.typeAccentsDisabledOn.some((t) => typeof t !== "string" || themes[t] === undefined)) {
		fail("typeAccentsDisabledOn", "must list defined themes");
	}
	const alertsRaw = root.alerts;
	if (typeof alertsRaw !== "object" || alertsRaw === null) {
		fail("alerts", "expected an object");
	}
	const alerts = {
		warn: validatePalette((alertsRaw as Record<string, unknown>).warn, "alerts.warn"),
		crit: validatePalette((alertsRaw as Record<string, unknown>).crit, "alerts.crit")
	};
	const accentsRaw = root.typeAccents;
	if (typeof accentsRaw !== "object" || accentsRaw === null) {
		fail("typeAccents", "expected an object");
	}
	const accents = accentsRaw as Record<string, unknown>;
	for (const key of TYPE_ACCENT_KEYS) {
		const hex = accents[key];
		if (typeof hex !== "string" || !HEX.test(hex)) {
			fail(`typeAccents.${key}`, `expected a #RRGGBB hex, got ${JSON.stringify(hex)}`);
		}
	}
	const extra = Object.keys(accents).filter((k) => !(TYPE_ACCENT_KEYS as readonly string[]).includes(k));
	if (extra.length > 0) {
		fail("typeAccents", `unknown accent(s): ${extra.join(", ")}`);
	}
	return {
		version: root.version,
		defaultTheme: root.defaultTheme as string,
		legacyDefaultTheme: root.legacyDefaultTheme as string,
		typeAccentsDisabledOn: root.typeAccentsDisabledOn as string[],
		themes,
		alerts,
		typeAccents: accents as Record<TypeAccentKey, string>
	};
}

// The bundle lives at <plugin>/bin/plugin.js with themes.json one level up;
// under tsx (tests, probe) this module is at src/ui/ inside the repo.
const CANDIDATE_PATHS = ["../themes.json", "../../com.lawrensen.hwinfo.sdPlugin/themes.json"];

let cached: ThemesConfig | null = null;

export function loadThemes(): ThemesConfig {
	if (cached !== null) {
		return cached;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const errors: string[] = [];
	for (const candidate of CANDIDATE_PATHS) {
		const file = join(here, candidate);
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch (err) {
			errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
			continue;
		}
		cached = validateThemesConfig(JSON.parse(text));
		return cached;
	}
	throw new Error(`themes.json not found:\n${errors.join("\n")}`);
}

/**
 * Resolves the final six tokens for one render.
 *
 * Alerts win outright: the whole key is recolored — accent and track
 * included — from the global alert palette, never tinted per theme (the
 * warn/crit field-luminance gap is the color-vision-deficiency guarantee).
 * Otherwise the type accent, when enabled and known, replaces the accent
 * token only — except on themes that opt out (paper).
 */
export function resolvePalette(config: ThemesConfig, themeId: string | undefined, typeAccent: TypeAccentKey | null, level: AlertLevel): Palette {
	if (level !== "normal") {
		return config.alerts[level];
	}
	const id = themeId !== undefined && config.themes[themeId] !== undefined ? themeId : config.defaultTheme;
	const base = config.themes[id] as Palette;
	if (typeAccent === null || config.typeAccentsDisabledOn.includes(id)) {
		return base;
	}
	return { ...base, accent: config.typeAccents[typeAccent] };
}

/**
 * Maps a reading to its type-accent category. HWiNFO's reading type covers
 * the first five; network and memory have no dedicated type, so they are
 * recognized from the unit (throughput) or label (memory readings report
 * plain MB/GB or percentages under type Other/Usage).
 */
export function classifyTypeAccent(type: SensorType, unit: string, label: string): TypeAccentKey | null {
	if (/^[KMGT]?(B|bit)\/s$/i.test(unit) || /\bMbps\b/i.test(unit)) {
		return "network";
	}
	if (/\bmemory\b/i.test(label) || /\b[VD]?RAM\b/i.test(label)) {
		return "memory";
	}
	switch (type) {
		case SensorType.Temperature:
			return "temperature";
		case SensorType.Fan:
			return "fan";
		case SensorType.Power:
			return "power";
		case SensorType.Clock:
			return "clock";
		case SensorType.Usage:
			return "load";
		default:
			return null;
	}
}
