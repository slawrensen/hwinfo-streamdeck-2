/**
 * Deck-wide theme state: the global default theme and the type-accent toggle,
 * plus the one-shot migration that decides what pre-theme installs see.
 *
 * Per-key overrides live in each action's settings; this store only carries
 * what is shared across the whole deck.
 */
import streamDeck from "@elgato/streamdeck";

import { loadThemes } from "./themes";

let deckTheme: string | undefined;
let typeAccentsOn = true;
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
export function applyGlobalThemeSettings(settings: { theme?: unknown; typeAccents?: unknown }): void {
	const config = loadThemes();
	const nextTheme = typeof settings.theme === "string" && config.themes[settings.theme] !== undefined ? settings.theme : deckTheme;
	const nextAccents = settings.typeAccents !== "off";
	if (typeof settings.theme === "string") {
		migrationDecided = true;
	}
	if (nextTheme === deckTheme && nextAccents === typeAccentsOn) {
		return;
	}
	deckTheme = nextTheme;
	typeAccentsOn = nextAccents;
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
		await streamDeck.settings.setGlobalSettings({ ...globals, theme });
	} catch (err) {
		streamDeck.logger.error("failed to persist migrated theme", err);
	}
}
