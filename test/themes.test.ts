/**
 * Locked-spec enforcement for themes.json: verbatim tokens, WCAG contrast
 * invariants, alert polarity, palette resolution and type-accent mapping.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SensorType } from "../src/hwinfo/types";
import { classifyTypeAccent, loadThemes, resolvePalette, validateThemesConfig } from "../src/ui/themes";
import { contrast, luminance } from "./wcag";

const config = loadThemes();

/** The spec's token table, verbatim — order bg,label,value,unit,accent,track. */
const SPEC_THEMES: Record<string, [string, string, string, string, string, string]> = {
	void: ["#000000", "#7A8393", "#FFFFFF", "#667082", "#4CC2FF", "#161A21"],
	graphite: ["#1A1C22", "#8B93A3", "#F4F6FA", "#757F91", "#55C7FF", "#2A2F3A"],
	ultraviolet: ["#10061F", "#8F80AE", "#F3EDFF", "#7C6C9F", "#C08BFF", "#261544"],
	midnight: ["#071120", "#788CA9", "#EFF6FF", "#627896", "#6FCFFF", "#152238"],
	forest: ["#05130C", "#739181", "#ECFBF2", "#5D7D6F", "#3FE09A", "#12271B"],
	ember: ["#000000", "#A47632", "#FFB84D", "#8A6326", "#E0912F", "#1E1305"],
	paper: ["#E9E6DE", "#4A4740", "#14120D", "#615D4F", "#3B382E", "#CDC9BD"]
};

/** Alert rows are spec-ordered bg,value,label,unit,accent,track. */
const SPEC_ALERTS: Record<"warn" | "crit", [string, string, string, string, string, string]> = {
	warn: ["#E8940D", "#1C1200", "#402C00", "#553C00", "#402C00", "#C67A06"],
	crit: ["#CB2114", "#FFFFFF", "#FFDCD6", "#F8C2B9", "#FFDCD6", "#A81A0C"]
};

const SPEC_TYPE_ACCENTS: Record<string, string> = {
	temperature: "#FF7E8E",
	fan: "#3FBEDD",
	power: "#D4AB33",
	clock: "#38CD89",
	load: "#B195FF",
	network: "#6FA7FF",
	memory: "#CE8BE0"
};

describe("themes.json tokens are verbatim per spec", () => {
	it("defines exactly the seven presets", () => {
		assert.deepEqual(Object.keys(config.themes).sort(), Object.keys(SPEC_THEMES).sort());
	});

	for (const [name, [bg, label, value, unit, accent, track]] of Object.entries(SPEC_THEMES)) {
		it(`theme ${name}`, () => {
			assert.deepEqual(config.themes[name], { bg, label, value, unit, accent, track });
		});
	}

	for (const [name, [bg, value, label, unit, accent, track]] of Object.entries(SPEC_ALERTS) as Array<["warn" | "crit", string[]]>) {
		it(`alert ${name}`, () => {
			assert.deepEqual(config.alerts[name], { bg, label, value, unit, accent, track });
		});
	}

	it("type accents", () => {
		assert.deepEqual({ ...config.typeAccents }, SPEC_TYPE_ACCENTS);
	});

	it("migration defaults: new installs void, legacy installs graphite", () => {
		assert.equal(config.defaultTheme, "void");
		assert.equal(config.legacyDefaultTheme, "graphite");
	});

	it("type accents are disabled on paper only", () => {
		assert.deepEqual([...config.typeAccentsDisabledOn], ["paper"]);
	});
});

describe("WCAG contrast invariants", () => {
	// The spec's label/unit bands (5.2–5.5, 3.9–4.3) pin the muted-text
	// hierarchy on the dark themes; light "paper" can only exceed them, so the
	// ceilings apply to dark backgrounds only. ε absorbs the spec's 1-decimal
	// rounding (e.g. ember unit computes 3.885).
	const EPS = 0.05;
	for (const [name, palette] of Object.entries(config.themes)) {
		const dark = luminance(palette.bg) < 0.5;
		it(`${name}: value ≥12, label 5.2–5.5, unit 3.9–4.3, accent ≥4`, () => {
			assert.ok(contrast(palette.value, palette.bg) >= 12, `value ${contrast(palette.value, palette.bg)}`);
			const label = contrast(palette.label, palette.bg);
			assert.ok(label >= 5.2 - EPS, `label ${label}`);
			const unit = contrast(palette.unit, palette.bg);
			assert.ok(unit >= 3.9 - EPS, `unit ${unit}`);
			if (dark) {
				assert.ok(label <= 5.5 + EPS, `label ceiling ${label}`);
				assert.ok(unit <= 4.3 + EPS, `unit ceiling ${unit}`);
			}
			assert.ok(contrast(palette.accent, palette.bg) >= 4, `accent ${contrast(palette.accent, palette.bg)}`);
		});
	}

	it("warn text hits 7.6 / 5.5 / 4.3", () => {
		const { bg, value, label, unit, accent } = config.alerts.warn;
		assert.ok(contrast(value, bg) >= 7.6 - EPS);
		assert.ok(contrast(label, bg) >= 5.5 - EPS);
		assert.ok(contrast(unit, bg) >= 4.3 - EPS);
		assert.ok(contrast(accent, bg) >= 4);
	});

	it("crit text hits 5.6 / 4.4 / 3.6", () => {
		const { bg, value, label, unit, accent } = config.alerts.crit;
		assert.ok(contrast(value, bg) >= 5.6 - EPS);
		assert.ok(contrast(label, bg) >= 4.4 - EPS);
		assert.ok(contrast(unit, bg) >= 3.6 - EPS);
		assert.ok(contrast(accent, bg) >= 4);
	});

	it("alerts are a polarity flip: warn dark-on-bright, crit light-on-red", () => {
		assert.ok(luminance(config.alerts.warn.value) < luminance(config.alerts.warn.bg));
		assert.ok(luminance(config.alerts.crit.value) > luminance(config.alerts.crit.bg));
	});

	it("warn/crit field-luminance gap is ~2.8× (the CVD guarantee)", () => {
		const gap = luminance(config.alerts.warn.bg) / luminance(config.alerts.crit.bg);
		assert.ok(gap >= 2.5 && gap <= 3.1, `gap ${gap}`);
	});

	it("track is a structural fill: 1.2–1.5:1 against its background", () => {
		// The spec table's delivered "1.2–1.4" is rounded to one decimal —
		// ember computes 1.151, midnight 1.187 — so the floor carries ε=0.06.
		for (const [name, palette] of Object.entries(config.themes)) {
			const ratio = contrast(palette.track, palette.bg);
			assert.ok(ratio >= 1.2 - 0.06 && ratio <= 1.5 + EPS, `${name} track ${ratio}`);
		}
	});

	it("dark backgrounds stay 'black with a cast' (luminance ≤ 0.012)", () => {
		for (const [name, palette] of Object.entries(config.themes)) {
			const l = luminance(palette.bg);
			if (l < 0.5) {
				assert.ok(l <= 0.012, `${name} bg luminance ${l}`);
			}
		}
	});

	it("type accents sit in the harmony band: 8.4–10.3:1 on black, L 0.37–0.46", () => {
		// One tight band so no sensor type reads "more important" than another.
		for (const [name, hex] of Object.entries(config.typeAccents)) {
			const ratio = contrast(hex, "#000000");
			assert.ok(ratio >= 8.4 - EPS && ratio <= 10.3 + EPS, `${name} ${ratio}`);
			const l = luminance(hex);
			assert.ok(l >= 0.37 - 0.005 && l <= 0.46 + 0.005, `${name} L ${l}`);
		}
	});

	it("every type accent keeps ≥4:1 on every theme it can appear on", () => {
		for (const [theme, palette] of Object.entries(config.themes)) {
			if (config.typeAccentsDisabledOn.includes(theme)) {
				continue;
			}
			for (const [accent, hex] of Object.entries(config.typeAccents)) {
				assert.ok(contrast(hex, palette.bg) >= 4, `${accent} on ${theme}: ${contrast(hex, palette.bg)}`);
			}
		}
	});
});

describe("resolvePalette", () => {
	it("alerts override the whole key — accent and track included, never themed", () => {
		for (const theme of Object.keys(config.themes)) {
			assert.deepEqual(resolvePalette(config, theme, "temperature", "warn"), config.alerts.warn);
			assert.deepEqual(resolvePalette(config, theme, null, "crit"), config.alerts.crit);
		}
	});

	it("type accent replaces the accent token only", () => {
		const palette = resolvePalette(config, "midnight", "fan", "normal");
		assert.deepEqual(palette, { ...config.themes.midnight, accent: config.typeAccents.fan });
	});

	it("type accents are disabled on paper", () => {
		assert.deepEqual(resolvePalette(config, "paper", "temperature", "normal"), config.themes.paper);
	});

	it("unknown or absent theme falls back to the default (void)", () => {
		assert.deepEqual(resolvePalette(config, "no-such-theme", null, "normal"), config.themes.void);
		assert.deepEqual(resolvePalette(config, undefined, null, "normal"), config.themes.void);
	});
});

describe("classifyTypeAccent", () => {
	it("maps HWiNFO reading types", () => {
		assert.equal(classifyTypeAccent(SensorType.Temperature, "°C", "CPU (Tctl/Tdie)"), "temperature");
		assert.equal(classifyTypeAccent(SensorType.Fan, "RPM", "CPU Fan"), "fan");
		assert.equal(classifyTypeAccent(SensorType.Power, "W", "CPU Package Power"), "power");
		assert.equal(classifyTypeAccent(SensorType.Clock, "MHz", "Core 0 Clock"), "clock");
		assert.equal(classifyTypeAccent(SensorType.Usage, "%", "Total CPU Usage"), "load");
	});

	it("recognizes network by throughput unit", () => {
		assert.equal(classifyTypeAccent(SensorType.Other, "KB/s", "Current DL rate"), "network");
		assert.equal(classifyTypeAccent(SensorType.Other, "MB/s", "Current UP rate"), "network");
	});

	it("recognizes memory by label", () => {
		assert.equal(classifyTypeAccent(SensorType.Other, "MB", "Physical Memory Used"), "memory");
		assert.equal(classifyTypeAccent(SensorType.Usage, "%", "GPU Memory Usage"), "memory");
	});

	it("leaves voltage/current/other on the theme accent", () => {
		assert.equal(classifyTypeAccent(SensorType.Voltage, "V", "Vcore"), null);
		assert.equal(classifyTypeAccent(SensorType.Current, "A", "CPU Current"), null);
		assert.equal(classifyTypeAccent(SensorType.Other, "X", "Frame Time"), null);
	});
});

describe("schema validation", () => {
	const valid = (): Record<string, unknown> => JSON.parse(JSON.stringify({ ...config, themes: { ...config.themes } })) as Record<string, unknown>;

	it("accepts the shipped file", () => {
		assert.doesNotThrow(() => validateThemesConfig(valid()));
	});

	it("rejects a missing token", () => {
		const broken = valid();
		delete ((broken.themes as Record<string, Record<string, string>>).void as Record<string, string>).track;
		assert.throws(() => validateThemesConfig(broken), /themes\.void\.track/);
	});

	it("rejects a malformed hex", () => {
		const broken = valid();
		((broken.themes as Record<string, unknown>).ember as Record<string, string>).bg = "black";
		assert.throws(() => validateThemesConfig(broken), /themes\.ember\.bg/);
	});

	it("rejects unknown tokens", () => {
		const broken = valid();
		((broken.themes as Record<string, unknown>).forest as Record<string, string>).glow = "#123456";
		assert.throws(() => validateThemesConfig(broken), /unknown token/);
	});

	it("rejects a defaultTheme that is not defined", () => {
		const broken = valid();
		broken.defaultTheme = "carbon";
		assert.throws(() => validateThemesConfig(broken), /defaultTheme/);
	});

	it("rejects missing alert palettes", () => {
		const broken = valid();
		delete (broken.alerts as Record<string, unknown>).crit;
		assert.throws(() => validateThemesConfig(broken), /alerts\.crit/);
	});

	it("rejects unknown type-accent keys", () => {
		const broken = valid();
		(broken.typeAccents as Record<string, string>).gpu = "#FFFFFF";
		assert.throws(() => validateThemesConfig(broken), /unknown accent/);
	});
});
