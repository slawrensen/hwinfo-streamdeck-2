/**
 * Effective text-color resolution for the Text setting (issue #2): Theme,
 * Dim, or Custom, deck-wide with per-key/per-dial overrides. Purely textual:
 * the structural palette tokens (backgrounds, accents as graphics, tracks,
 * gauge fills, sparklines) never resolve through here.
 *
 * Precedence, in order: warn/critical alert palettes, then the effective
 * local/global text mode, then plain theme text.
 */
import type { AlertLevel } from "./format";
import type { Palette } from "./themes";

export type TextMode = "theme" | "dim" | "custom";

/** One scope's parsed Text settings (local override or deck-wide default). */
export type TextSettings = {
	mode: TextMode;
	/** Valid #RRGGBB only; anything else parses to undefined and Custom
	 * degrades to theme text at resolve time. */
	color: string | undefined;
	dimSecondary: boolean;
};

/** Resolved fills for the four textual roles every face draws. */
export type TextColors = {
	/** Primary values. */
	value: string;
	/** Labels, wrapped label lines, context/footer text. */
	label: string;
	/** Units, suffixes, min/max/avg stats. */
	unit: string;
	/** Stat badges (MIN/MAX/AVG), drawn in the accent token on theme faces. */
	badge: string;
};

const HEX6 = /^#[0-9A-Fa-f]{6}$/;

/**
 * Dim blends toward the theme background: polarity-correct on dark and light
 * themes alike, hue retained. Values keep more presence than secondary text
 * so the hierarchy survives. Constants tuned on real renders of Void,
 * Graphite, Ember and Paper (see test/text-colors.test.ts contrast floors).
 */
export const DIM_VALUE_BLEND = 0.42;
export const DIM_SECONDARY_BLEND = 0.3;
/** Custom secondary text: the selected hue, stepped toward the background. */
export const CUSTOM_SECONDARY_BLEND = 0.35;

/** Channel-wise linear blend of `color` toward `toward` by `amount` (0..1). */
export function mixToward(color: string, toward: string, amount: number): string {
	const channel = (offset: number): string => {
		const from = parseInt(color.slice(offset, offset + 2), 16);
		const to = parseInt(toward.slice(offset, offset + 2), 16);
		return Math.round(from + (to - from) * amount)
			.toString(16)
			.padStart(2, "0")
			.toUpperCase();
	};
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Parses one scope of raw Text settings. Settings are untyped JSON at
 * runtime: only the exact mode markers count, and anything else (absent, "",
 * junk, a newer version's future value) returns null, which means "follow
 * the wider scope" locally and "theme" deck-wide.
 */
export function parseTextSettings(raw: { textMode?: unknown; textColor?: unknown; textDimSecondary?: unknown }): TextSettings | null {
	const mode = raw.textMode;
	if (mode !== "theme" && mode !== "dim" && mode !== "custom") {
		return null;
	}
	const color = typeof raw.textColor === "string" && HEX6.test(raw.textColor) ? raw.textColor : undefined;
	return { mode, color, dimSecondary: raw.textDimSecondary === true };
}

const THEME_TEXT: TextSettings = { mode: "theme", color: undefined, dimSecondary: false };

/** Local override wins; absent/malformed local follows the deck default;
 * absent/malformed deck default resolves to theme. */
export function effectiveTextSettings(local: TextSettings | null, deck: TextSettings | null): TextSettings {
	return local ?? deck ?? THEME_TEXT;
}

/** The mode that actually applies: Custom without a valid color is theme. */
export function appliedTextMode(settings: TextSettings): TextMode {
	return settings.mode === "custom" && settings.color === undefined ? "theme" : settings.mode;
}

/** The theme's own text tokens, as a TextColors (the identity resolution). */
export function themeTextColors(palette: Palette): TextColors {
	return { value: palette.value, label: palette.label, unit: palette.unit, badge: palette.accent };
}

/**
 * Resolves the final textual fills. Alert faces always return the (alert)
 * palette's own tokens: warn/critical presentation outranks every text mode.
 * The main value in Custom is the exact selected color, never adjusted.
 */
export function resolveTextColors(palette: Palette, settings: TextSettings, level: AlertLevel): TextColors {
	const mode = appliedTextMode(settings);
	if (level !== "normal" || mode === "theme") {
		return themeTextColors(palette);
	}
	if (mode === "dim") {
		return {
			value: mixToward(palette.value, palette.bg, DIM_VALUE_BLEND),
			label: mixToward(palette.label, palette.bg, DIM_SECONDARY_BLEND),
			unit: mixToward(palette.unit, palette.bg, DIM_SECONDARY_BLEND),
			badge: mixToward(palette.accent, palette.bg, DIM_SECONDARY_BLEND)
		};
	}
	const color = settings.color as string;
	const secondary = settings.dimSecondary ? mixToward(color, palette.bg, CUSTOM_SECONDARY_BLEND) : color;
	return { value: color, label: secondary, unit: secondary, badge: secondary };
}
