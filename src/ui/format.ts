/** Value formatting, unit conversion and stat-mode selection. */
import type { Reading } from "../hwinfo/types";

export type StatMode = "current" | "min" | "max" | "avg";
export type DecimalsSetting = "auto" | "0" | "1" | "2" | "3";

export const STAT_MODES: readonly StatMode[] = ["current", "min", "max", "avg"];

/** Short badge shown when a non-current stat is displayed. */
export const STAT_BADGE: Record<StatMode, string> = {
	current: "",
	min: "MIN",
	max: "MAX",
	avg: "AVG"
};

export function isStatMode(value: unknown): value is StatMode {
	return typeof value === "string" && (STAT_MODES as readonly string[]).includes(value);
}

export function statValue(reading: Reading, mode: StatMode): number {
	switch (mode) {
		case "min":
			return reading.valueMin;
		case "max":
			return reading.valueMax;
		case "avg":
			return reading.valueAvg;
		default:
			return reading.value;
	}
}

/** Converts a value for display; only °C→°F is meaningful in HWiNFO data. */
export function convertUnit(value: number, unit: string, fahrenheit: boolean): { value: number; unit: string } {
	if (fahrenheit && unit === "°C") {
		return { value: value * 1.8 + 32, unit: "°F" };
	}
	return { value, unit };
}

/**
 * Formats a value for a 72 px key. "auto" scales precision with magnitude and
 * compacts very large values (48700 → "48.7k") so they never overflow the key.
 */
export function formatValue(value: number, decimals: DecimalsSetting): string {
	if (!Number.isFinite(value)) {
		return "—";
	}
	if (decimals !== "auto") {
		return value.toFixed(Number(decimals));
	}
	const abs = Math.abs(value);
	if (abs >= 100_000) {
		return `${(value / 1000).toFixed(0)}k`;
	}
	if (abs >= 10_000) {
		return `${(value / 1000).toFixed(1)}k`;
	}
	if (abs >= 100) {
		return value.toFixed(0);
	}
	if (abs >= 10) {
		return value.toFixed(1);
	}
	return value.toFixed(2);
}

/** Parses a threshold field coming from the PI (string or number, may be empty). */
export function parseThreshold(raw: unknown): number | undefined {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === "string" && raw.trim() !== "") {
		// The PI accepts locale decimal commas ("70,5") — Number() does not.
		const n = Number(raw.trim().replace(",", "."));
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/**
 * Whether thresholds and manual bar ranges configured against `alertUnit`
 * apply to a reading measured in `readingUnit`. A warn value typed for a
 * temperature must never fire on a fan's RPM after rotating to it: numbers
 * only compare within one unit.
 *
 * `undefined` means unscoped: settings that predate unit scoping keep the
 * old apply-everywhere behavior until the user next edits a threshold
 * (which anchors it to the reading on screen). An empty string is a REAL
 * unit (HWiNFO's unitless yes/no readings) and scopes to unitless readings
 * only; conflating it with unscoped would both widen alerts and defeat the
 * stamped-check.
 */
export function thresholdsApplyTo(alertUnit: string | undefined, readingUnit: string): boolean {
	return alertUnit === undefined || alertUnit === readingUnit;
}

export type AlertLevel = "normal" | "warn" | "crit";

/**
 * Evaluates warn/critical thresholds against the *live* (current) value in the
 * displayed unit. With `alertBelow`, lower is worse (e.g. fan RPM); otherwise
 * higher is worse (temperatures, power).
 */
export function alertLevel(current: number, warn: number | undefined, crit: number | undefined, alertBelow: boolean): AlertLevel {
	const beyond = (limit: number): boolean => (alertBelow ? current <= limit : current >= limit);
	if (crit !== undefined && beyond(crit)) {
		return "crit";
	}
	if (warn !== undefined && beyond(warn)) {
		return "warn";
	}
	return "normal";
}

/**
 * Truncates a label to fit a key, appending an ellipsis when cut. Operates on
 * code points, not UTF-16 units — slicing through a surrogate pair would leave
 * a lone surrogate that makes encodeURIComponent throw on the rendered SVG.
 */
export function truncateLabel(label: string, max: number): string {
	const chars = Array.from(label);
	return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}…`;
}
