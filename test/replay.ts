/**
 * Deterministic replay harness (helper, not a test): feeds a recorded event
 * trace through the production gesture machine, control-scheme resolution
 * and rotation math, modeling one dial per context exactly the way
 * sensor-dial.ts routes commands. Fixtures live in test/traces/*.json and
 * use the recorder's field names, so a capture from real hardware can
 * replace a synthetic trace verbatim.
 */
import { resolveControls, schemeCanSwitchGroups, type GestureCommandId } from "../src/controls";
import { IDLE_GESTURE, routeGesture, type GestureInput, type GestureState } from "../src/gestures";
import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { groupReadings, rotationGroupsOf, rotationReadings, stepGroup, stepReading, stepSensorSource } from "../src/rotation";
import { STAT_MODES, type StatMode } from "../src/ui/format";

export type TraceFixture = {
	name: string;
	description?: string;
	contexts: Record<string, { settings?: Record<string, unknown>; device?: string }>;
	events: {
		context: string;
		event: "dialDown" | "dialUp" | "dialRotate" | "touchTap" | "willAppear" | "willDisappear" | "deviceDisconnect" | "deviceReconnect";
		mono?: number;
		ticks?: number;
		pressed?: boolean;
		hold?: boolean;
		tapX?: number;
	}[];
	expect: Record<
		string,
		{
			commands?: string[];
			selection?: string;
			statMode?: string;
			paused?: boolean;
			pinned?: boolean;
		}
	>;
};

export type ReplayOutcome = {
	commands: string[];
	selection: string | undefined;
	statMode: StatMode;
	paused: boolean;
	pinned: boolean;
};

/** Two sensor sources with two readings each, plus a loner: the standard rig. */
export function standardSnapshot(): SensorSnapshot {
	const reading = (key: string, sensorIndex: number): Reading => ({ key, type: 1, sensorIndex, id: 0, label: key, unit: "°C", value: 50, valueMin: 40, valueMax: 60, valueAvg: 50 });
	const readings = [reading("a:0:1", 0), reading("a:0:2", 0), reading("b:0:1", 1), reading("b:0:2", 1), reading("c:0:1", 2)];
	return { pollTime: 0, version: 1, revision: 1, sensors: [], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

type ContextModel = {
	settings: Record<string, unknown>;
	gesture: GestureState;
	selection: string | undefined;
	statMode: StatMode;
	paused: boolean;
	pinned: boolean;
	commands: string[];
};

const CANVAS_WIDTH = 200;

export function replayTrace(fixture: TraceFixture, snapshot: SensorSnapshot = standardSnapshot()): Map<string, ReplayOutcome> {
	const contexts = new Map<string, ContextModel>();
	for (const [id, spec] of Object.entries(fixture.contexts)) {
		const settings = spec.settings ?? {};
		contexts.set(id, {
			settings,
			gesture: IDLE_GESTURE,
			selection: typeof settings.readingKey === "string" && settings.readingKey !== "" ? settings.readingKey : undefined,
			statMode: "current",
			paused: false,
			pinned: false,
			commands: []
		});
	}

	const execute = (model: ContextModel, command: GestureCommandId, ticks: number): void => {
		if (command === "none") {
			return;
		}
		model.commands.push(ticks !== 0 ? `${command}:${ticks}` : command);
		switch (command) {
			case "step":
			case "stepGroup": {
				// Mirrors sensor-dial advance(): pinned blocks, and a selection
				// the snapshot does not publish must never be rotated away.
				if (model.pinned || (model.selection !== undefined && !snapshot.byKey.has(model.selection))) {
					return;
				}
				// Mirrors sensor-dial rotationKeysOf(): only the string entries
				// count, and an effectively empty set means "no set".
				const rawKeys = Array.isArray(model.settings.rotationKeys) ? model.settings.rotationKeys.filter((k): k is string => typeof k === "string") : [];
				const keys = rawKeys.length > 0 ? rawKeys : undefined;
				const groups = rotationGroupsOf(model.settings.rotationGroups);
				const stepTicks = ticks === 0 ? 1 : ticks;
				let next: Reading | undefined;
				if (command === "stepGroup") {
					// Mirrors advance(): user groups supersede the sensor jump; a
					// sensor jump with no rotation set roams the whole snapshot.
					next =
						groups !== undefined
							? stepGroup(groups, model.selection, stepTicks, snapshot)
							: stepSensorSource(keys === undefined ? snapshot.readings : rotationReadings(keys, model.selection, snapshot), model.selection, stepTicks);
				} else {
					// Mirrors stepList(): groups scope plain stepping only while
					// the scheme can jump them; otherwise the union keeps driving.
					const list =
						groups !== undefined && schemeCanSwitchGroups(resolveControls(model.settings))
							? groupReadings(groups, model.selection, snapshot)
							: rotationReadings(keys, model.selection, snapshot);
					next = stepReading(list, model.selection, stepTicks);
				}
				if (next !== undefined && next.key !== model.selection) {
					model.selection = next.key;
					model.statMode = "current";
				}
				return;
			}
			case "cycleStat":
				model.statMode = STAT_MODES[(STAT_MODES.indexOf(model.statMode) + 1) % STAT_MODES.length] as StatMode;
				return;
			case "backToCurrent":
				model.statMode = "current";
				return;
			case "pauseResume":
				model.paused = !model.paused;
				return;
			case "pin":
				model.pinned = !model.pinned;
				return;
			case "resetStats":
				return; // recorded; stats themselves are covered by stats.test.ts
		}
	};

	for (const event of fixture.events) {
		const model = contexts.get(event.context);
		if (model === undefined) {
			throw new Error(`trace event for unknown context ${event.context}`);
		}
		const scheme = resolveControls(model.settings);
		const at = event.mono ?? 0;

		if (event.event === "willAppear" || event.event === "deviceReconnect") {
			model.gesture = IDLE_GESTURE;
			continue;
		}
		if (event.event === "willDisappear" || event.event === "deviceDisconnect") {
			model.gesture = routeGesture(model.gesture, { kind: "detach" }, scheme.touchZones).state;
			continue;
		}

		const input: GestureInput =
			event.event === "dialDown"
				? { kind: "dialDown", at }
				: event.event === "dialUp"
					? { kind: "dialUp", at }
					: event.event === "dialRotate"
						? { kind: "dialRotate", at, ticks: event.ticks ?? 1, pressed: event.pressed === true }
						: { kind: "touchTap", at, hold: event.hold === true, x: event.tapX ?? CANVAS_WIDTH / 2, canvasWidth: CANVAS_WIDTH };
		const routed = routeGesture(model.gesture, input, scheme.touchZones);
		model.gesture = routed.state;

		if (event.event === "dialDown" && scheme.pushTiming === "down") {
			// Legacy: the push command fires immediately and consumes the press.
			model.gesture = { downAt: model.gesture.downAt, rotatedWhileDown: true };
			execute(model, scheme.shortPress, 0);
			continue;
		}
		if (routed.gesture === null) {
			continue;
		}
		switch (routed.gesture.kind) {
			case "rotate":
				if (model.settings.rotationDisabled !== true && !model.pinned) {
					execute(model, scheme.rotate, routed.gesture.ticks);
				}
				break;
			case "pressedRotate":
				if (model.settings.rotationDisabled !== true && !model.pinned) {
					execute(model, scheme.pressedRotate, routed.gesture.ticks);
				}
				break;
			case "shortPress":
				if (scheme.pushTiming === "release") {
					execute(model, scheme.shortPress, 0);
				}
				break;
			case "longPress":
				if (scheme.pushTiming === "release") {
					execute(model, scheme.longPress, 0);
				}
				break;
			case "tap":
				if (scheme.touchZones !== "off" && routed.gesture.zone === "left") {
					execute(model, "step", -1);
				} else if (scheme.touchZones !== "off" && routed.gesture.zone === "right") {
					execute(model, "step", 1);
				} else {
					execute(model, scheme.tap, 0);
				}
				break;
			case "touchHold":
				execute(model, scheme.touchHold, 0);
				break;
		}
	}

	const outcomes = new Map<string, ReplayOutcome>();
	for (const [id, model] of contexts) {
		outcomes.set(id, { commands: model.commands, selection: model.selection, statMode: model.statMode, paused: model.paused, pinned: model.pinned });
	}
	return outcomes;
}
