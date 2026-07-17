/**
 * Deck-wide presentation state: the global default theme, the type-accent
 * toggle, the deck-wide Text setting, the data-unit preference, plus the
 * one-shot migration that decides what pre-theme installs see.
 *
 * Per-key overrides live in each action's settings; this store only carries
 * what is shared across the whole deck.
 */
import streamDeck from "@elgato/streamdeck";

import type { DecimalsSetting } from "./format";
import { parseDataUnitsPref, type DataUnitsPref, type MeasureOptions } from "./measure";
import { effectiveTextSettings, parseTextSettings, type TextSettings } from "./text-colors";
import { loadThemes } from "./themes";

let deckTheme: string | undefined;
let typeAccentsOn = true;
let deckText: TextSettings | null = null;
let dataUnits: DataUnitsPref = "decimal";
let migrationDecided = false;
const listeners = new Set<() => void>();

/** The deck-wide default theme id (spec default until settings arrive). */
export function getDeckTheme(): string {
	return deckTheme ?? loadThemes().defaultTheme;
}

/** Type accents replace the accent token when on (spec default: on). */
export function typeAccentsEnabled(): boolean {
	return typeAccentsOn;
}

/** One scope's effective Text setting: the action's own parsed override,
 * else the deck-wide default, else theme. Every face and the PI preview
 * resolve through here, so the precedence can never fork. */
export function effectiveTextFor(raw: { textMode?: unknown; textColor?: unknown; textDimSecondary?: unknown }): TextSettings {
	return effectiveTextSettings(parseTextSettings(raw), deckText);
}

/** The deck-wide data-unit preference (absent/malformed: decimal). */
export function getDataUnits(): DataUnitsPref {
	return dataUnits;
}

/** One action's measurement options: its decimals and °F settings under the
 * deck-wide data-unit preference, the one policy every face and the PI
 * preview format with. */
export function measureOptionsFrom(settings: { decimals?: DecimalsSetting; fahrenheit?: boolean }): MeasureOptions {
	return { decimals: settings.decimals ?? "auto", fahrenheit: settings.fahrenheit === true, dataUnits };
}

/** Re-render hook for the action classes. */
export function onThemeChange(listener: () => void): void {
	listeners.add(listener);
}

function notify(): void {
	for (const listener of listeners) {
		try {
			listener();
		} catch (err) {
			streamDeck.logger.error("theme change listener failed", err);
		}
	}
}

/** Ingests the global settings (startup read and every later change). */
export function applyGlobalThemeSettings(settings: { theme?: unknown; typeAccents?: unknown; textMode?: unknown; textColor?: unknown; textDimSecondary?: unknown; dataUnits?: unknown }): void {
	const config = loadThemes();
	const themeValid = typeof settings.theme === "string" && config.themes[settings.theme] !== undefined;
	const nextTheme = themeValid ? (settings.theme as string) : deckTheme;
	const nextAccents = settings.typeAccents !== "off";
	const nextText = parseTextSettings(settings);
	const nextUnits = parseDataUnitsPref(settings.dataUnits);
	// Only a VALID stored theme counts as "the user (or migration) decided" —
	// an empty/invalid value must not lock out the legacy migration while
	// silently failing to apply.
	if (themeValid) {
		migrationDecided = true;
	}
	const textChanged = JSON.stringify(nextText) !== JSON.stringify(deckText);
	if (nextTheme === deckTheme && nextAccents === typeAccentsOn && !textChanged && nextUnits === dataUnits) {
		return;
	}
	deckTheme = nextTheme;
	typeAccentsOn = nextAccents;
	deckText = nextText;
	dataUnits = nextUnits;
	streamDeck.logger.info(`Deck theme = ${getDeckTheme()} (type accents ${typeAccentsOn ? "on" : "off"}, text ${deckText?.mode ?? "theme"}, data units ${dataUnits}, source: global settings)`);
	notify();
}

/**
 * Migration: runs once when no theme was ever chosen. Installs that predate
 * the theme system keep the old look (graphite — the previous hardcoded
 * background); genuinely new installs start on the spec default (void).
 * "Predates" is detected by any already-configured state: plugin-wide
 * settings, or a first appearing action that already carries settings.
 */
export function decideLegacyDefault(hasExistingConfig: boolean): void {
	if (migrationDecided) {
		return;
	}
	migrationDecided = true;
	const config = loadThemes();
	const theme = hasExistingConfig ? config.legacyDefaultTheme : config.defaultTheme;
	streamDeck.logger.info(`Deck theme = ${theme} (source: ${hasExistingConfig ? "legacy migration" : "fresh-install default"})`);
	if (theme !== getDeckTheme()) {
		deckTheme = theme;
		notify();
	} else {
		deckTheme = theme;
	}
	void persistTheme(theme);
}

async function persistTheme(theme: string): Promise<void> {
	try {
		const globals = await streamDeck.settings.getGlobalSettings();
		// Async race guard: if a PI wrote a theme while we awaited, the user's
		// explicit choice wins — never clobber it with the migration result.
		if (typeof globals.theme === "string" && globals.theme !== "") {
			return;
		}
		await streamDeck.settings.setGlobalSettings({ ...globals, theme });
	} catch (err) {
		streamDeck.logger.error("failed to persist migrated theme", err);
	}
}
