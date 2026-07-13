/**
 * Control presets: how gestures map to dial commands.
 *
 *   legacy  exact 1.1.x behavior. The push command fires on dial DOWN with
 *           no timing, rotation steps readings whether pressed or not, touch
 *           taps cycle the stat mode. Settings without a preset field (every
 *           install that predates presets) resolve here, so existing dials
 *           keep their physical behavior to the millisecond.
 *   elite   press-aware mapping: rotate steps readings, pressed rotation
 *           jumps between rotation groups (or sensors while none are
 *           defined), short press pauses/resumes auto cycle, long press
 *           resets session stats, optional touch zones.
 *   custom  each gesture assigned individually; unset gestures fall back to
 *           their legacy command so a half-configured dial stays familiar.
 *
 * Everything here is pure: settings in, scheme out. The dial action feeds
 * gestures from src/gestures.ts through the scheme and executes commands.
 */
import type { TouchZoneMode } from "./gestures";

type ControlPreset = "legacy" | "elite" | "custom";

/** Commands a gesture can trigger. Persisted in settings as plain strings. */
export type GestureCommandId =
	| "none"
	/** Step through the active rotation group / set / owning sensor's readings. */
	| "step"
	/** Jump to the previous/next rotation group (or sensor source without groups). */
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
type ControlSettings = {
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

/**
 * True when some gesture of this scheme can jump rotation groups. Plain
 * stepping honors group boundaries only while this holds: otherwise a dial
 * could rotate inside one group forever with no gesture able to leave it,
 * so defined groups dissolve into one flat list (the pre-groups behavior)
 * until a Switch gesture exists. Legacy never maps one, which is exactly
 * its compatibility contract.
 */
export function schemeCanSwitchGroups(scheme: ControlScheme): boolean {
	return (
		scheme.rotate === "stepGroup" ||
		scheme.pressedRotate === "stepGroup" ||
		scheme.shortPress === "stepGroup" ||
		scheme.longPress === "stepGroup" ||
		scheme.tap === "stepGroup" ||
		scheme.touchHold === "stepGroup"
	);
}

/** Hint texts when the command leads its line in the app's hint column. */
const HINT_LABELS: Record<GestureCommandId, string | undefined> = {
	none: undefined,
	step: "Cycle readings",
	stepGroup: "Switch sensor",
	cycleStat: "Cycle stat mode",
	backToCurrent: "Back to current",
	pauseResume: "Pause/resume",
	pin: "Pin/unpin",
	resetStats: "Reset stats"
};

/**
 * Hint texts after a "pressed:" / "hold:" / "center:" prefix. The prefix and
 * the gesture glyph already carry the context, so these drop to the object
 * alone; the app's hint column is narrow and clips longer lines.
 */
const SUFFIX_LABELS: Record<GestureCommandId, string | undefined> = {
	none: undefined,
	step: "readings",
	stepGroup: "sensor",
	cycleStat: "stat mode",
	backToCurrent: "current",
	pauseResume: "pause/resume",
	pin: "pin/unpin",
	resetStats: "reset stats"
};

/**
 * Texts for the Stream Deck app's own gesture hints (setTriggerDescription,
 * a 6.4-era API). Undefined fields hide that hint. `hasGroups` swaps the
 * stepGroup wording from sensors to groups so the hint names what the jump
 * actually moves between on this dial.
 */
export function triggerDescriptions(scheme: ControlScheme, hasGroups: boolean): { rotate?: string; push?: string; touch?: string; longTouch?: string } {
	const hint = (command: GestureCommandId): string | undefined => (command === "stepGroup" && hasGroups ? "Switch group" : HINT_LABELS[command]);
	const suffix = (command: GestureCommandId): string | undefined => (command === "stepGroup" && hasGroups ? "group" : SUFFIX_LABELS[command]);
	const rotate =
		scheme.pressedRotate !== "none" && scheme.pressedRotate !== scheme.rotate
			? joinHints(hint(scheme.rotate), `pressed: ${suffix(scheme.pressedRotate) ?? "off"}`)
			: hint(scheme.rotate);
	const push =
		scheme.pushTiming === "down"
			? hint(scheme.shortPress)
			: scheme.shortPress === scheme.longPress
				? hint(scheme.shortPress)
				: joinHints(hint(scheme.shortPress), scheme.longPress === "none" ? undefined : `hold: ${suffix(scheme.longPress)}`);
	const touch =
		scheme.touchZones === "off"
			? hint(scheme.tap)
			: scheme.touchZones === "two"
				? "Left/right: previous/next"
				: joinHints("Left/right: previous/next", suffix(scheme.tap) === undefined ? undefined : `center: ${suffix(scheme.tap)}`);
	return { rotate, push, touch, longTouch: hint(scheme.touchHold) };
}

function joinHints(first: string | undefined, second: string | undefined): string | undefined {
	if (first === undefined) {
		return second;
	}
	return second === undefined ? first : `${first} · ${second}`;
}
