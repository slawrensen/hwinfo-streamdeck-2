/**
 * Dial and touch gesture router: one pure state machine that turns raw SDK
 * events (dialDown / dialRotate / dialUp / touchTap) into logical gestures.
 * Timing comes in with each event, so classification is a pure function of
 * (state, input) and there are no timers to leak, race or cancel: a press is
 * classified short or long on release, pressed rotation is routed the moment
 * it happens, and detaching an action simply drops the state.
 *
 * Guarantees (locked by test/gestures.test.ts):
 *  - one physical interaction produces exactly one logical gesture
 *  - rotation while pressed routes as pressedRotate, never rotate
 *  - a press that saw any pressed rotation emits nothing on release
 *  - touch hold and touch tap are mutually exclusive
 *  - tap zones are deterministic at every boundary (>= boundary lands in
 *    the later zone)
 */

/**
 * A dial press held at least this long counts as a long press. 500 ms sits
 * between a deliberate click (~150-300 ms) and Stream Deck's own touchscreen
 * hold detection, and is long enough that press+rotate started within it is
 * classified by the rotation, not the clock. Tested at 499 / 500 / 501 ms.
 */
export const DIAL_LONG_PRESS_MS = 500;

export type GestureState = {
	/** Monotonic ms when the dial went down; null while not pressed. */
	readonly downAt: number | null;
	/** True when any rotation happened during the current press. */
	readonly rotatedWhileDown: boolean;
};

export const IDLE_GESTURE: GestureState = { downAt: null, rotatedWhileDown: false };

export type TouchZoneMode = "off" | "two" | "three";
export type TapZone = "left" | "center" | "right";

export type GestureInput =
	| { readonly kind: "dialDown"; readonly at: number }
	| { readonly kind: "dialUp"; readonly at: number }
	| { readonly kind: "dialRotate"; readonly at: number; readonly ticks: number; readonly pressed: boolean }
	| { readonly kind: "touchTap"; readonly at: number; readonly hold: boolean; readonly x: number; readonly canvasWidth: number }
	/** willDisappear / device gone: drop any half-tracked press. */
	| { readonly kind: "detach" };

export type Gesture =
	| { readonly kind: "rotate"; readonly ticks: number }
	| { readonly kind: "pressedRotate"; readonly ticks: number }
	| { readonly kind: "shortPress" }
	| { readonly kind: "longPress" }
	| { readonly kind: "tap"; readonly zone: TapZone }
	| { readonly kind: "touchHold" };

/**
 * Maps a tap x position to its zone. Zone edges are half-open: an x exactly
 * on a boundary lands in the later (right-hand) zone, so every pixel has
 * exactly one owner. "off" collapses the whole canvas to "center".
 */
export function tapZoneOf(x: number, canvasWidth: number, mode: TouchZoneMode): TapZone {
	if (mode === "off" || canvasWidth <= 0) {
		return "center";
	}
	if (mode === "two") {
		return x < canvasWidth / 2 ? "left" : "right";
	}
	if (x < canvasWidth / 3) {
		return "left";
	}
	return x < (canvasWidth * 2) / 3 ? "center" : "right";
}

/** Advances the machine by one event; returns the gesture it completed, if any. */
export function routeGesture(state: GestureState, input: GestureInput, zones: TouchZoneMode): { state: GestureState; gesture: Gesture | null } {
	switch (input.kind) {
		case "dialDown":
			// A duplicate down (event replay) keeps the original timestamp so
			// the eventual release still classifies against the real press start.
			if (state.downAt !== null) {
				return { state, gesture: null };
			}
			return { state: { downAt: input.at, rotatedWhileDown: false }, gesture: null };

		case "dialRotate": {
			// The SDK's pressed flag is authoritative; our tracked down state
			// backs it up in case a dialDown was missed (reconnect mid-press).
			if (input.pressed || state.downAt !== null) {
				const next = state.downAt !== null ? { downAt: state.downAt, rotatedWhileDown: true } : state;
				return { state: next, gesture: { kind: "pressedRotate", ticks: input.ticks } };
			}
			return { state, gesture: { kind: "rotate", ticks: input.ticks } };
		}

		case "dialUp": {
			if (state.downAt === null) {
				return { state, gesture: null }; // release without a tracked press
			}
			const consumed = state.rotatedWhileDown;
			const longPress = input.at - state.downAt >= DIAL_LONG_PRESS_MS;
			return {
				state: IDLE_GESTURE,
				gesture: consumed ? null : { kind: longPress ? "longPress" : "shortPress" }
			};
		}

		case "touchTap":
			return {
				state,
				gesture: input.hold ? { kind: "touchHold" } : { kind: "tap", zone: tapZoneOf(input.x, input.canvasWidth, zones) }
			};

		case "detach":
			return { state: IDLE_GESTURE, gesture: null };
	}
}
