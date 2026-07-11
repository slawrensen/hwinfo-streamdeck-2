/**
 * Control presets: how gestures map to dial commands.
 *
 *   legacy  exact 1.1.x behavior. The push command fires on dial DOWN with
 *           no timing, rotation steps readings whether pressed or not, touch
 *           taps cycle the stat mode. Settings without a preset field (every
 *           install that predates presets) resolve here, so existing dials
 *           keep their physical behavior to the millisecond.
 *   elite   press-aware mapping: rotate steps readings, pressed rotation
 *           jumps between sensors, short press pauses/resumes auto cycle,
 *           long press resets session stats, optional touch zones.
 *   custom  each gesture assigned individually; unset gestures fall back to
 *           their legacy command so a half-configured dial stays familiar.
 *
 * Everything here is pure: settings in, scheme out. The dial action feeds
 * gestures from src/gestures.ts through the scheme and executes commands.
 */
import type { TouchZoneMode } from "./gestures";

export type ControlPreset = "legacy" | "elite" | "custom";

/** Commands a gesture can trigger. Persisted in settings as plain strings. */
export type GestureCommandId =
	| "none"
	/** Step through the rotation set / owning sensor's readings. */
	| "step"
	/** Jump to the previous/next sensor source in the rotation list. */
	| "stepGroup"
	| "cycleStat"
	| "backToCurrent"
	/** Pause or resume the auto cycle timer. */
	| "pauseResume"
	/** Pin: ignore turns and pause the auto cycle until unpinned. */
	| "pin"
	/** Reset session stats; the scope comes from the resetScope setting. */
	| "resetStats";

const COMMAND_IDS: readonly GestureCommandId[] = ["none", "step", "stepGroup", "cycleStat", "backToCurrent", "pauseResume", "pin", "resetStats"];

/** Statistics-reset reach. Destructive scopes are explicit, never a default. */
export type ResetScope = "current" | "set" | "all";

export type ControlScheme = {
	readonly preset: ControlPreset;
	/** "down": the push command fires on dialDown, untimed (exact legacy). */
	readonly pushTiming: "down" | "release";
	readonly rotate: GestureCommandId;
	readonly pressedRotate: GestureCommandId;
	readonly shortPress: GestureCommandId;
	readonly longPress: GestureCommandId;
	readonly touchZones: TouchZoneMode;
	/** Command for a zoneless tap and for the center zone. */
	readonly tap: GestureCommandId;
	readonly touchHold: GestureCommandId;
};

/** The settings fields the scheme is derived from (a subset of DialSettings). */
export type ControlSettings = {
	controlPreset?: string;
	touchZones?: string;
	gestureRotate?: string;
	gesturePressedRotate?: string;
	gestureShortPress?: string;
	gestureLongPress?: string;
	gestureTap?: string;
	gestureTouchHold?: string;
	resetScope?: string;
};

const LEGACY: ControlScheme = {
	preset: "legacy",
	pushTiming: "down",
	rotate: "step",
	pressedRotate: "step",
	shortPress: "resetStats",
	longPress: "resetStats",
	touchZones: "off",
	tap: "cycleStat",
	touchHold: "backToCurrent"
};

function parseCommand(raw: string | undefined, fallback: GestureCommandId): GestureCommandId {
	return (COMMAND_IDS as readonly string[]).includes(raw ?? "") ? (raw as GestureCommandId) : fallback;
}

function parseZones(raw: string | undefined): TouchZoneMode {
	return raw === "two" || raw === "three" ? raw : "off";
}

export function parseResetScope(raw: string | undefined): ResetScope {
	return raw === "set" || raw === "all" ? raw : "current";
}

/** Resolves the scheme; anything unrecognized lands on legacy (migration). */
export function resolveControls(settings: ControlSettings): ControlScheme {
	const preset = settings.controlPreset === "elite" || settings.controlPreset === "custom" ? settings.controlPreset : "legacy";
	if (preset === "legacy") {
		return LEGACY;
	}
	if (preset === "elite") {
		return {
			preset,
			pushTiming: "release",
			rotate: "step",
			pressedRotate: "stepGroup",
			shortPress: "pauseResume",
			longPress: "resetStats",
			touchZones: parseZones(settings.touchZones),
			tap: "cycleStat",
			touchHold: "backToCurrent"
		};
	}
	return {
		preset,
		pushTiming: "release",
		rotate: parseCommand(settings.gestureRotate, LEGACY.rotate),
		pressedRotate: parseCommand(settings.gesturePressedRotate, LEGACY.pressedRotate),
		shortPress: parseCommand(settings.gestureShortPress, LEGACY.shortPress),
		longPress: parseCommand(settings.gestureLongPress, LEGACY.longPress),
		touchZones: parseZones(settings.touchZones),
		tap: parseCommand(settings.gestureTap, LEGACY.tap),
		touchHold: parseCommand(settings.gestureTouchHold, LEGACY.touchHold)
	};
}

const COMMAND_LABELS: Record<GestureCommandId, string | undefined> = {
	none: undefined,
	step: "Cycle readings",
	stepGroup: "Switch sensor",
	cycleStat: "Cycle stat mode",
	backToCurrent: "Back to current value",
	pauseResume: "Pause/resume auto cycle",
	pin: "Pin/unpin reading",
	resetStats: "Reset session stats"
};

/**
 * Texts for the Stream Deck app's own gesture hints (setTriggerDescription,
 * a 6.4-era API). Undefined fields hide that hint.
 */
export function triggerDescriptions(scheme: ControlScheme): { rotate?: string; push?: string; touch?: string; longTouch?: string } {
	const rotate =
		scheme.pressedRotate !== "none" && scheme.pressedRotate !== scheme.rotate
			? joinHints(COMMAND_LABELS[scheme.rotate], `pressed: ${COMMAND_LABELS[scheme.pressedRotate] ?? "off"}`)
			: COMMAND_LABELS[scheme.rotate];
	const push =
		scheme.pushTiming === "down"
			? COMMAND_LABELS[scheme.shortPress]
			: scheme.shortPress === scheme.longPress
				? COMMAND_LABELS[scheme.shortPress]
				: joinHints(COMMAND_LABELS[scheme.shortPress], scheme.longPress === "none" ? undefined : `hold: ${COMMAND_LABELS[scheme.longPress]}`);
	const touch =
		scheme.touchZones === "off"
			? COMMAND_LABELS[scheme.tap]
			: scheme.touchZones === "two"
				? "Left/right: previous/next reading"
				: joinHints("Left/right: previous/next reading", COMMAND_LABELS[scheme.tap] === undefined ? undefined : `center: ${COMMAND_LABELS[scheme.tap]}`);
	return { rotate, push, touch, longTouch: COMMAND_LABELS[scheme.touchHold] };
}

function joinHints(first: string | undefined, second: string | undefined): string | undefined {
	if (first === undefined) {
		return second;
	}
	return second === undefined ? first : `${first} · ${second}`;
}
