/**
 * "Sensor Dial" encoder action (Stream Deck + / + XL) — live value on the
 * touchscreen with a range bar and session min/max.
 *
 * Gestures route through the control scheme (src/controls.ts). The default
 * (legacy) scheme is the exact 1.1.x behavior:
 *
 *   rotate      cycle through the rotation set / same sensor's readings
 *   push        reset the session min/max/avg (fires on dial DOWN)
 *   touch       cycle displayed stat (current → min → max → avg, session)
 *   long touch  back to the current value
 *
 * The elite and custom presets classify presses on release through the
 * gesture machine (src/gestures.ts), route pressed rotation separately,
 * and can enable touch zones. Session stats are keyed per reading
 * (src/stats.ts) and, together with the display/pause/pin state, survive
 * page and profile navigation through a bounded hidden-state cache. The
 * Stream Deck app owns horizontal touch-strip swipes (page navigation);
 * this class only preserves state across the willDisappear/willAppear it
 * causes.
 */
import streamDeck, { action, SingletonAction, type DialAction, type DialDownEvent, type DialRotateEvent, type DialUpEvent, type DidReceiveSettingsEvent, type SendToPluginEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { registerDialCommandHandler, type DialControlCommand } from "../commands";
import { parseResetScope, resolveControls, triggerDescriptions, type ControlScheme, type GestureCommandId, type ResetScope } from "../controls";
import { deviceCapabilities, tapCanvasWidth } from "../devices";
import { registerDiagnostics } from "../diagnostics";
import { IDLE_GESTURE, routeGesture, type GestureState } from "../gestures";
import type { SensorSnapshot } from "../hwinfo/types";
import { buildPreview, buildSensorTree, buildSupportReportPayload, buildThemesPayload } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import { describeGestureState, hashId, trace, traceEnabled } from "../recorder";
import { autoCycleTarget, rotationReadings, stepReading, stepSensorSource } from "../rotation";
import { SessionStatsStore } from "../stats";
import { renderDial } from "../ui/dial-renderer";
import { alertLevel, convertUnit, formatValue, parseThreshold, STAT_BADGE, STAT_MODES, thresholdsApplyTo, truncateLabel, type DecimalsSetting, type StatMode } from "../ui/format";
import { statusDialText } from "../ui/state-screens";
import { decideLegacyDefault, getDeckTheme, onThemeChange, typeAccentsEnabled } from "../ui/theme-store";
import { classifyTypeAccent, loadThemes, resolvePalette } from "../ui/themes";

/** Persisted per-dial settings (written by the PI; all optional). */
export type DialSettings = {
	readingKey?: string;
	label?: string;
	decimals?: DecimalsSetting;
	fahrenheit?: boolean;
	/** Manual range for the bar; session min/max is used when absent. */
	barMin?: string;
	barMax?: string;
	warnValue?: string;
	critValue?: string;
	alertBelow?: boolean;
	/** Per-dial theme override; empty/absent follows the deck default. */
	theme?: string;
	/** Rotation set: rotate/autocycle move only through these picked readings. */
	rotationKeys?: string[];
	/** Ignore dial turns entirely (protection against accidental bumps). */
	rotationDisabled?: boolean;
	/** Autocycle interval in ms as the PI select writes it; absent/"off" = off. */
	autoCycleMs?: string;
	/** Control preset: "legacy" (default, exact 1.1.x), "elite" or "custom". */
	controlPreset?: string;
	/** Touch zones for elite/custom: "off" (default), "two" or "three". */
	touchZones?: string;
	/** Custom preset gesture assignments (GestureCommandId strings). */
	gestureRotate?: string;
	gesturePressedRotate?: string;
	gestureShortPress?: string;
	gestureLongPress?: string;
	gestureTap?: string;
	gestureTouchHold?: string;
	/** Reset reach for the reset command: "current" (default), "set", "all". */
	resetScope?: string;
	/** "auto" (default): rotation clears the custom label; "fixed" keeps it. */
	labelMode?: string;
	/** Optional ID the HWiNFO Control action can target. */
	linkId?: string;
	/** Autocycle jumps to an alerting member instead of the next one. */
	alertInterrupt?: boolean;
	/**
	 * Unit the thresholds/bar range were configured against; stamped by the
	 * plugin (never the PI) so they cannot fire on an incompatible unit
	 * after rotating to a different kind of reading.
	 */
	alertUnit?: string;
};

type InstanceState = {
	settings: DialSettings;
	/** Session stats per reading identity; survives rotation and hiding. */
	stats: SessionStatsStore;
	/** Ephemeral display mode; reset to "current" on long touch. */
	statMode: StatMode;
	lastFeedback: string;
	/** Next autocycle due time (epoch ms); null re-arms on the next tick. */
	nextCycleAt: number | null;
	cyclePaused: boolean;
	/** Pinned: selection cannot change (turns, taps, autocycle) until unpinned. */
	pinned: boolean;
	gesture: GestureState;
	/** Transient on-device hint ("cycle paused"); cleared at `until`. */
	overlay: { text: string; until: number } | null;
	overlayTimer: NodeJS.Timeout | null;
	deviceId: string;
	/** A threshold edit is waiting for a resolvable reading to stamp its unit. */
	pendingAlertUnitStamp: boolean;
};

/** How long a hidden dial's state (stats, pause, pin) is kept for its return. */
const HIDDEN_STATE_TTL_MS = 30 * 60_000;
const HIDDEN_STATE_CAP = 64;
/** On-device hint duration. */
const OVERLAY_MS = 1600;

@action({ UUID: "com.lawrensen.hwinfo.dial" })
export class SensorDialAction extends SingletonAction<DialSettings> {
	private readonly instances = new Map<string, InstanceState>();
	/** State of dials that navigated off-screen, kept for their reappearance. */
	private readonly hidden = new Map<string, { at: number; state: InstanceState }>();

	constructor() {
		super();
		// Isolated so a rendering bug in one action class can't starve the other
		// listeners on the shared "tick" event.
		poller.onTick((status) => {
			try {
				this.onPollerTick(status);
			} catch (err) {
				streamDeck.logger.error("SensorDialAction tick failed", err);
			}
		});
		onThemeChange(() => {
			this.renderAll(poller.getStatus());
			// Keep the open PI's "Deck default" chip truthful in real time.
			if (streamDeck.ui.action?.manifestId === this.manifestId) {
				void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
			}
		});
		registerDialCommandHandler((command) => this.applyControlCommand(command));
		registerDiagnostics("sensorDial", () => this.diagnostics());
	}

	override onWillAppear(ev: WillAppearEvent<DialSettings>): void {
		streamDeck.logger.debug(`Dial appeared on ${ev.action.device.name}${ev.action.isDial() ? ` at ${ev.action.coordinates.column},${ev.action.coordinates.row}` : ""} (${ev.action.id})`);
		this.traceLifecycle("willAppear", ev.action.id, ev.action.device.id);
		// Stream Deck can replay willAppear for a context without an intervening
		// willDisappear (reconnect, wake): retain only on the first sighting.
		// Page/profile navigation DOES send willDisappear; that state waits in
		// the hidden cache and is restored here, so stats, pause and pin state
		// survive page swipes and folder hops.
		const replayed = this.instances.get(ev.action.id);
		// The TTL is enforced here too, not only by the tick sweep: with the
		// poller idle (nothing visible) the sweep never runs, and a return
		// hours later must not resurrect stale pause/pin/stats state.
		const hiddenEntry = this.hidden.get(ev.action.id);
		const restored = replayed ?? (hiddenEntry !== undefined && Date.now() - hiddenEntry.at <= HIDDEN_STATE_TTL_MS ? hiddenEntry.state : undefined);
		this.hidden.delete(ev.action.id);
		if (replayed === undefined) {
			poller.retain();
		}
		decideLegacyDefault(Object.values(ev.payload.settings).some((v) => v !== undefined));
		if (restored !== undefined && restored.overlayTimer !== null) {
			clearTimeout(restored.overlayTimer);
		}
		const state: InstanceState = {
			settings: ev.payload.settings,
			stats: restored?.stats ?? new SessionStatsStore(),
			statMode: restored !== undefined && restored.settings.readingKey === ev.payload.settings.readingKey ? restored.statMode : "current",
			lastFeedback: restored?.lastFeedback ?? "",
			nextCycleAt: null,
			cyclePaused: restored?.cyclePaused ?? false,
			pinned: restored?.pinned ?? false,
			gesture: IDLE_GESTURE,
			overlay: null,
			overlayTimer: null,
			deviceId: ev.action.device.id,
			pendingAlertUnitStamp: restored?.pendingAlertUnitStamp ?? false
		};
		this.instances.set(ev.action.id, state);
		if (ev.action.isDial()) {
			this.pushTriggerDescriptions(ev.action, resolveControls(ev.payload.settings));
		}
		this.renderAll(poller.getStatus());
	}

	override onWillDisappear(ev: WillDisappearEvent<DialSettings>): void {
		this.traceLifecycle("willDisappear", ev.action.id, ev.action.device.id);
		const state = this.instances.get(ev.action.id);
		if (state === undefined || !this.instances.delete(ev.action.id)) {
			return;
		}
		poller.release();
		// A press cannot span a disappearance; drop any half-tracked gesture
		// and its overlay timer, then park the state for the action's return.
		state.gesture = routeGesture(state.gesture, { kind: "detach" }, "off").state;
		if (state.overlayTimer !== null) {
			clearTimeout(state.overlayTimer);
			state.overlayTimer = null;
		}
		state.overlay = null;
		state.lastFeedback = ""; // the strip may be repainted by others meanwhile
		this.hidden.set(ev.action.id, { at: Date.now(), state });
		if (this.hidden.size > HIDDEN_STATE_CAP) {
			const oldest = this.hidden.keys().next().value;
			if (oldest !== undefined) {
				this.hidden.delete(oldest);
			}
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		const previous = state.settings;
		if (previous.readingKey !== ev.payload.settings.readingKey) {
			state.statMode = "current";
		}
		state.settings = ev.payload.settings;
		state.nextCycleAt = null; // the interval may have changed: re-arm on the next tick
		// Thresholds edited in the PI are meant for the reading on screen NOW:
		// clear the old unit anchor, PERSIST the clear (a stale stamp must not
		// resurrect from a later whole-settings write), then stamp the new unit
		// as soon as the reading is resolvable (immediately, or a later tick).
		const thresholdsChanged =
			previous.warnValue !== state.settings.warnValue || previous.critValue !== state.settings.critValue || previous.barMin !== state.settings.barMin || previous.barMax !== state.settings.barMax;
		if (thresholdsChanged && ev.action.isDial()) {
			state.settings = { ...state.settings, alertUnit: undefined };
			state.pendingAlertUnitStamp = [state.settings.warnValue, state.settings.critValue, state.settings.barMin, state.settings.barMax].some((v) => parseThreshold(v) !== undefined);
			void ev.action.setSettings(state.settings);
			this.stampAlertUnit(ev.action, state);
		}
		if (ev.action.isDial()) {
			this.pushTriggerDescriptions(ev.action, resolveControls(state.settings));
		}
		this.renderAll(poller.getStatus());
	}

	/** Rotate: routed by the scheme (legacy: step, whether pressed or not). */
	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		const scheme = resolveControls(state.settings);
		const routed = routeGesture(state.gesture, { kind: "dialRotate", at: performance.now(), ticks: ev.payload.ticks, pressed: ev.payload.pressed }, scheme.touchZones);
		this.traceGesture("dialRotate", ev.action.id, state, routed.state, { ticks: ev.payload.ticks, pressed: ev.payload.pressed });
		state.gesture = routed.state;
		if (routed.gesture === null) {
			return;
		}
		// "Ignore turns" and pin make turn gestures true no-ops (autocycle,
		// touch and the control action are deliberate and stay live).
		if (state.settings.rotationDisabled === true || state.pinned) {
			return;
		}
		if (routed.gesture.kind === "rotate") {
			await this.executeCommand(ev.action, state, scheme.rotate, routed.gesture.ticks);
		} else if (routed.gesture.kind === "pressedRotate") {
			await this.executeCommand(ev.action, state, scheme.pressedRotate, routed.gesture.ticks);
		}
	}

	/** Push down: legacy fires its command here, untimed (exact 1.1.x). */
	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		const scheme = resolveControls(state.settings);
		const routed = routeGesture(state.gesture, { kind: "dialDown", at: performance.now() }, scheme.touchZones);
		this.traceGesture("dialDown", ev.action.id, state, routed.state, {});
		state.gesture = routed.state;
		if (scheme.pushTiming === "down") {
			// Mark the press consumed so a preset switch mid-press can never
			// fire a second command on release.
			state.gesture = { downAt: state.gesture.downAt, rotatedWhileDown: true };
			await this.executeCommand(ev.action, state, scheme.shortPress, 0);
		}
	}

	/** Release: short/long press classification (never after pressed rotation). */
	override async onDialUp(ev: DialUpEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		const scheme = resolveControls(state.settings);
		const routed = routeGesture(state.gesture, { kind: "dialUp", at: performance.now() }, scheme.touchZones);
		this.traceGesture("dialUp", ev.action.id, state, routed.state, {});
		state.gesture = routed.state;
		if (routed.gesture === null || scheme.pushTiming !== "release") {
			return;
		}
		await this.executeCommand(ev.action, state, routed.gesture.kind === "longPress" ? scheme.longPress : scheme.shortPress, 0);
	}

	/** Touch: tap (optionally zoned) and hold, mutually exclusive. */
	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		const scheme = resolveControls(state.settings);
		const canvasWidth = tapCanvasWidth(deviceCapabilities.get(ev.action.device.id));
		const routed = routeGesture(state.gesture, { kind: "touchTap", at: performance.now(), hold: ev.payload.hold, x: ev.payload.tapPos[0], canvasWidth }, scheme.touchZones);
		this.traceGesture("touchTap", ev.action.id, state, routed.state, { hold: ev.payload.hold, tapX: ev.payload.tapPos[0], tapY: ev.payload.tapPos[1] });
		state.gesture = routed.state;
		if (routed.gesture === null) {
			return;
		}
		if (routed.gesture.kind === "touchHold") {
			await this.executeCommand(ev.action, state, scheme.touchHold, 0);
			return;
		}
		if (routed.gesture.kind !== "tap") {
			return;
		}
		if (scheme.touchZones !== "off" && routed.gesture.zone === "left") {
			await this.executeCommand(ev.action, state, "step", -1); // advance() itself honors pin
		} else if (scheme.touchZones !== "off" && routed.gesture.zone === "right") {
			await this.executeCommand(ev.action, state, "step", 1);
		} else {
			await this.executeCommand(ev.action, state, scheme.tap, 0);
		}
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, DialSettings>): void {
		const payload = ev.payload;
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			return;
		}
		if (payload.event === "getSensorTree") {
			void streamDeck.ui.sendToPropertyInspector(buildSensorTree(poller.getStatus()));
		} else if (payload.event === "getThemes") {
			void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
		} else if (payload.event === "getSupportReport") {
			void streamDeck.ui.sendToPropertyInspector(buildSupportReportPayload());
		}
	}

	/** One gesture (or control command) becomes exactly one of these. */
	private async executeCommand(action: DialAction<DialSettings>, state: InstanceState, command: GestureCommandId, ticks: number): Promise<void> {
		switch (command) {
			case "none":
				return;
			case "step":
				await this.advance(action, state, ticks === 0 ? 1 : ticks, "reading");
				return;
			case "stepGroup":
				await this.advance(action, state, ticks === 0 ? 1 : ticks, "sensor");
				return;
			case "cycleStat":
				state.statMode = STAT_MODES[(STAT_MODES.indexOf(state.statMode) + 1) % STAT_MODES.length] as StatMode;
				break;
			case "backToCurrent":
				state.statMode = "current";
				break;
			case "pauseResume":
				this.setPaused(state, !state.cyclePaused);
				break;
			case "pin":
				this.setPinned(state, !state.pinned);
				break;
			case "resetStats":
				this.resetStats(state, parseResetScope(state.settings.resetScope));
				break;
		}
		this.renderAll(poller.getStatus());
	}

	private setPaused(state: InstanceState, paused: boolean): void {
		state.cyclePaused = paused;
		state.nextCycleAt = null;
		this.showOverlay(state, paused ? "cycle paused" : "cycle resumed");
	}

	private setPinned(state: InstanceState, pinned: boolean): void {
		state.pinned = pinned;
		state.nextCycleAt = null;
		this.showOverlay(state, pinned ? "pinned" : "unpinned");
	}

	/**
	 * Resets session stats. "current" and "set" stay inside this dial;
	 * "all" reaches every dial (visible and hidden) and is only ever
	 * reachable through the explicit resetScope setting or the control
	 * action, never a default gesture.
	 */
	private resetStats(state: InstanceState, scope: ResetScope): void {
		if (scope === "all") {
			for (const other of this.instances.values()) {
				other.stats.reset();
			}
			for (const entry of this.hidden.values()) {
				entry.state.stats.reset();
			}
			this.showOverlay(state, "all dials reset");
			return;
		}
		const key = readingKeyOf(state.settings);
		if (scope === "set") {
			state.stats.reset([...(rotationKeysOf(state.settings) ?? []), ...(key === undefined ? [] : [key])]);
			this.showOverlay(state, "set stats reset");
			return;
		}
		if (key !== undefined) {
			state.stats.reset([key]);
		}
		this.showOverlay(state, "stats reset");
	}

	/** Shared by rotate, taps, autocycle and the control action. */
	private async advance(action: DialAction<DialSettings>, state: InstanceState, ticks: number, granularity: "reading" | "sensor"): Promise<void> {
		const status = poller.getStatus();
		if (status.state === "unavailable" || state.pinned) {
			return;
		}
		const { snapshot } = status;
		const key = readingKeyOf(state.settings);
		// A saved reading the snapshot doesn't publish right now (HWiNFO
		// restart, sensor dropout) is a transient state: never let a turn
		// replace the saved selection with an unrelated reading.
		if (key !== undefined && !snapshot.byKey.has(key)) {
			return;
		}
		// The reading list is scoped to the rotation set or the current sensor;
		// a sensor jump with no set must roam the whole snapshot, or it could
		// never leave the sensor it is scoped to.
		const setKeys = rotationKeysOf(state.settings);
		const list = granularity === "sensor" && setKeys === undefined ? snapshot.readings : rotationReadings(setKeys, key, snapshot);
		const next = granularity === "sensor" ? stepSensorSource(list, key, ticks) : stepReading(list, key, ticks);
		if (next === undefined || next.key === state.settings.readingKey) {
			return;
		}
		await this.adoptReading(action, state, next.key, status);
	}

	/** Moves the selection and persists it; per-reading stats stay intact. */
	private async adoptReading(action: DialAction<DialSettings>, state: InstanceState, nextKey: string, status: PollerStatus): Promise<void> {
		const before = readingKeyOf(state.settings);
		// The custom label described the reading it was written for; in the
		// default "auto" label mode, moving to a different reading drops it
		// so the title always names what the value actually is. "fixed"
		// keeps the label as a deliberate constant title for the slot.
		const keepLabel = state.settings.labelMode === "fixed";
		state.settings = { ...state.settings, readingKey: nextKey, label: keepLabel ? state.settings.label : undefined };
		state.statMode = "current";
		state.nextCycleAt = null; // any move defers the next automatic step by a full interval
		trace({ event: "selection", context: action.id, selectionBefore: before === undefined ? undefined : hashId(before), selectionAfter: hashId(nextKey) });
		await action.setSettings(state.settings);
		this.renderAll(status);
	}

	private onPollerTick(status: PollerStatus): void {
		if (status.state === "ok") {
			const now = Date.now();
			// Stats accumulate for the selected reading and every rotation-set
			// member, visible or hidden, so rotating (back) to a member shows
			// its true session, and hidden members keep alert coverage.
			for (const state of this.instances.values()) {
				this.sampleStats(state, status.snapshot);
			}
			// Completes a unit stamp whose threshold edit landed while the
			// reading was unresolvable; no-op otherwise.
			for (const act of this.actions) {
				if (act.isDial()) {
					const state = this.instances.get(act.id);
					if (state !== undefined && state.pendingAlertUnitStamp) {
						this.stampAlertUnit(act, state);
					}
				}
			}
			for (const [id, entry] of this.hidden) {
				if (now - entry.at > HIDDEN_STATE_TTL_MS) {
					this.hidden.delete(id);
					continue;
				}
				this.sampleStats(entry.state, status.snapshot);
			}
			this.autoCycle(status, now);
		}
		this.renderAll(status);
		this.pushPreview(status);
	}

	private sampleStats(state: InstanceState, snapshot: SensorSnapshot): void {
		const keys = new Set<string>(rotationKeysOf(state.settings) ?? []);
		const current = readingKeyOf(state.settings);
		if (current !== undefined) {
			keys.add(current);
		}
		for (const key of keys) {
			const reading = snapshot.byKey.get(key);
			if (reading !== undefined) {
				state.stats.sample(key, reading.value);
			}
		}
		// Bound by relevance: every actively sampled reading is kept whatever
		// the set size (an insert-time cap would thrash and zero all sessions
		// each tick the moment a set outgrew it); strays from reselection are
		// dropped oldest-first past the slack.
		state.stats.prune(keys, 64);
	}

	/** Advances autocycling dials whose interval elapsed (timed by poll ticks). */
	private autoCycle(status: Extract<PollerStatus, { state: "ok" }>, now: number): void {
		for (const act of this.actions) {
			if (!act.isDial()) {
				continue;
			}
			const state = this.instances.get(act.id);
			if (state === undefined) {
				continue;
			}
			const interval = parseAutoCycleMs(state.settings.autoCycleMs);
			if (interval === null || state.cyclePaused || state.pinned) {
				state.nextCycleAt = null;
			} else if (state.nextCycleAt === null) {
				state.nextCycleAt = now + interval;
			} else if (now >= state.nextCycleAt) {
				const key = readingKeyOf(state.settings);
				if (key !== undefined && !status.snapshot.byKey.has(key)) {
					continue; // transient dropout: hold, retry next tick
				}
				const list = rotationReadings(rotationKeysOf(state.settings), key, status.snapshot);
				const target = autoCycleTarget(list, key, this.criticalKeys(state, list), state.settings.alertInterrupt === true);
				if (target === undefined || target.key === key) {
					// Held (critical member on screen, or nowhere to go):
					// wait a full interval before looking again.
					state.nextCycleAt = now + interval;
					continue;
				}
				// adoptReading leaves nextCycleAt null; the next tick re-arms
				// a full interval out.
				void this.adoptReading(act, state, target.key, status);
			}
		}
	}

	/** Rotation-set members currently critical under this dial's thresholds. */
	private criticalKeys(state: InstanceState, list: readonly { key: string; unit: string; value: number }[]): ReadonlySet<string> {
		const settings = state.settings;
		const warn = parseThreshold(settings.warnValue);
		const crit = parseThreshold(settings.critValue);
		if (crit === undefined && warn === undefined) {
			return EMPTY_SET;
		}
		const critical = new Set<string>();
		for (const member of list) {
			if (!thresholdsApplyTo(settings.alertUnit, member.unit)) {
				continue;
			}
			const live = convertUnit(member.value, member.unit, settings.fahrenheit === true).value;
			if (alertLevel(live, warn, crit, settings.alertBelow === true) === "crit") {
				critical.add(member.key);
			}
		}
		return critical;
	}

	/**
	 * Stamps the unit the thresholds/bar range apply to, from the reading on
	 * screen when the user edited them (the pending flag is set only there).
	 * Settings that predate unit scoping are never stamped uninvited: they
	 * keep the old apply-everywhere behavior until the next threshold edit,
	 * because guessing their unit from whatever reading happens to be
	 * selected at upgrade time would silently disable alerts configured for
	 * a different reading. An empty string is a real unit (unitless
	 * readings), so the pending flag, not the value, decides whether to
	 * stamp again.
	 */
	private stampAlertUnit(action: DialAction<DialSettings>, state: InstanceState): void {
		if (!state.pendingAlertUnitStamp) {
			return;
		}
		const status = poller.getStatus();
		if (status.state === "unavailable") {
			return; // stamped by a later tick, once the reading resolves
		}
		const key = readingKeyOf(state.settings);
		const reading = key === undefined ? undefined : status.snapshot.byKey.get(key);
		if (reading === undefined) {
			return;
		}
		state.pendingAlertUnitStamp = false;
		state.settings = { ...state.settings, alertUnit: reading.unit };
		void action.setSettings(state.settings);
	}

	/** Applies a control-action command; returns how many dials it reached. */
	private applyControlCommand(command: DialControlCommand): number {
		let applied = 0;
		for (const act of this.actions) {
			if (!act.isDial()) {
				continue;
			}
			const state = this.instances.get(act.id);
			if (state === undefined || !matchesTarget(command.target, state.settings)) {
				continue;
			}
			applied++;
			void this.executeControl(act, state, command);
		}
		// State-only commands also reach hidden dials, whose pause/pin/stats
		// state is live and waiting to reappear. Selection changes need a
		// visible action and skip them. The TTL is enforced here too: with
		// the poller idle the tick sweep never runs, and an expired entry
		// will be discarded at restore, so counting it as "reached" would
		// show the control key a false ok tick.
		if (!SELECTION_COMMANDS.has(command.command)) {
			const now = Date.now();
			for (const [id, entry] of this.hidden) {
				if (now - entry.at > HIDDEN_STATE_TTL_MS) {
					this.hidden.delete(id);
					continue;
				}
				if (!matchesTarget(command.target, entry.state.settings)) {
					continue;
				}
				applied++;
				this.executeStateCommand(entry.state, command);
			}
		}
		this.renderAll(poller.getStatus());
		return applied;
	}

	private async executeControl(action: DialAction<DialSettings>, state: InstanceState, command: DialControlCommand): Promise<void> {
		switch (command.command) {
			case "next":
				await this.advance(action, state, 1, "reading");
				return;
			case "prev":
				await this.advance(action, state, -1, "reading");
				return;
			case "nextGroup":
				await this.advance(action, state, 1, "sensor");
				return;
			case "prevGroup":
				await this.advance(action, state, -1, "sensor");
				return;
			default:
				this.executeStateCommand(state, command);
		}
	}

	/** The non-selection commands, shared by visible and hidden dials. */
	private executeStateCommand(state: InstanceState, command: DialControlCommand): void {
		switch (command.command) {
			case "cycleStat":
				state.statMode = STAT_MODES[(STAT_MODES.indexOf(state.statMode) + 1) % STAT_MODES.length] as StatMode;
				return;
			case "showCurrent":
			case "backToCurrent":
				state.statMode = "current";
				return;
			case "showMin":
				state.statMode = "min";
				return;
			case "showMax":
				state.statMode = "max";
				return;
			case "showAvg":
				state.statMode = "avg";
				return;
			case "pauseCycle":
				if (!state.cyclePaused) {
					this.setPaused(state, true);
				}
				return;
			case "resumeCycle":
				if (state.cyclePaused) {
					this.setPaused(state, false);
				}
				return;
			case "toggleCycle":
				this.setPaused(state, !state.cyclePaused);
				return;
			case "pin":
				if (!state.pinned) {
					this.setPinned(state, true);
				}
				return;
			case "unpin":
				if (state.pinned) {
					this.setPinned(state, false);
				}
				return;
			case "togglePin":
				this.setPinned(state, !state.pinned);
				return;
			case "resetStats":
				this.resetStats(state, command.scope);
				return;
			default:
				return;
		}
	}

	private showOverlay(state: InstanceState, text: string): void {
		state.overlay = { text, until: Date.now() + OVERLAY_MS };
		if (state.overlayTimer !== null) {
			clearTimeout(state.overlayTimer);
		}
		const timer = setTimeout(() => {
			state.overlay = null;
			state.overlayTimer = null;
			this.renderAll(poller.getStatus());
		}, OVERLAY_MS);
		timer.unref();
		state.overlayTimer = timer;
	}

	/** The app's own gesture hints follow the active scheme (6.4-era API). */
	private pushTriggerDescriptions(action: DialAction<DialSettings>, scheme: ControlScheme): void {
		// Legacy matches the manifest text; undefined restores exactly that.
		void action.setTriggerDescription(scheme.preset === "legacy" ? undefined : triggerDescriptions(scheme));
	}

	private renderAll(status: PollerStatus): void {
		for (const act of this.actions) {
			if (!act.isDial()) {
				continue;
			}
			const state = this.instances.get(act.id);
			if (state === undefined) {
				continue;
			}
			const svg = composeDialSvg(state, status);
			if (svg !== state.lastFeedback) {
				state.lastFeedback = svg;
				const queuedAt = performance.now();
				const send = act.setFeedback({ canvas: `data:image/svg+xml,${encodeURIComponent(svg)}` });
				if (traceEnabled()) {
					void send.then(() => trace({ event: "render", context: act.id, renderQueuedAt: queuedAt, renderDoneAt: performance.now() }));
				} else {
					void send;
				}
			}
		}
	}

	private pushPreview(status: PollerStatus): void {
		const piAction = streamDeck.ui.action;
		if (piAction === undefined || piAction.manifestId !== this.manifestId) {
			return;
		}
		const state = this.instances.get(piAction.id);
		void streamDeck.ui.sendToPropertyInspector(buildPreview(status, state?.settings.readingKey));
	}

	private traceLifecycle(event: string, context: string, deviceId: string): void {
		const caps = deviceCapabilities.get(deviceId);
		trace({ event, context, device: hashId(deviceId), deviceType: caps.type, grid: `${caps.columns}x${caps.rows}` });
	}

	private traceGesture(event: string, context: string, state: InstanceState, after: GestureState, extra: { ticks?: number; pressed?: boolean; hold?: boolean; tapX?: number; tapY?: number }): void {
		// Hashed: gadget-source reading keys embed HWiNFO sensor/reading
		// names, which are user-renamable text. readingKeyOf also shields
		// hashId from malformed non-string settings values.
		const selection = readingKeyOf(state.settings);
		trace({
			event,
			context,
			device: hashId(state.deviceId),
			controller: "Encoder",
			...extra,
			gestureBefore: describeGestureState(state.gesture),
			gestureAfter: describeGestureState(after),
			selectionBefore: selection === undefined ? undefined : hashId(selection)
		});
	}

	private diagnostics(): unknown {
		const summarize = (state: InstanceState, visible: boolean): unknown => ({
			visible,
			device: hashId(state.deviceId),
			preset: resolveControls(state.settings).preset,
			// Hashed like device ids: gadget keys and link IDs carry user text.
			selection: readingKeyOf(state.settings) === undefined ? null : hashId(readingKeyOf(state.settings) ?? ""),
			statMode: state.statMode,
			rotationSet: rotationKeysOf(state.settings)?.length ?? 0,
			autoCycleMs: parseAutoCycleMs(state.settings.autoCycleMs),
			cyclePaused: state.cyclePaused,
			pinned: state.pinned,
			trackedStats: state.stats.size,
			linkId: typeof state.settings.linkId === "string" && state.settings.linkId.trim() !== "" ? hashId(state.settings.linkId.trim()) : null
		});
		return {
			visible: [...this.instances.values()].map((s) => summarize(s, true)),
			hidden: [...this.hidden.values()].map((entry) => summarize(entry.state, false))
		};
	}
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Commands that change the selection and therefore need a visible action. */
const SELECTION_COMMANDS: ReadonlySet<string> = new Set(["next", "prev", "nextGroup", "prevGroup"]);

function readingKeyOf(settings: DialSettings): string | undefined {
	return typeof settings.readingKey === "string" && settings.readingKey !== "" ? settings.readingKey : undefined;
}

/** Settings are untyped JSON at runtime: anything but a non-empty string
 *  array (a hand-edited profile, an import) degrades to "no set". */
function rotationKeysOf(settings: DialSettings): string[] | undefined {
	if (!Array.isArray(settings.rotationKeys)) {
		return undefined;
	}
	const keys = settings.rotationKeys.filter((k): k is string => typeof k === "string");
	return keys.length > 0 ? keys : undefined;
}

function matchesTarget(target: string, settings: DialSettings): boolean {
	return target === "" || (typeof settings.linkId === "string" && settings.linkId.trim() === target);
}

/** The PI writes "off" or a millisecond count; anything else means off too. */
function parseAutoCycleMs(raw: string | undefined): number | null {
	const ms = raw !== undefined && raw !== "" ? Number(raw) : NaN;
	return Number.isInteger(ms) && ms > 0 ? ms : null;
}

function composeDialSvg(state: InstanceState, status: PollerStatus): string {
	const settings = state.settings;
	const config = loadThemes();
	const themeId = settings.theme !== undefined && settings.theme !== "" ? settings.theme : getDeckTheme();

	const problem = statusDialText(status);
	if (problem !== null) {
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: problem.title, valueText: problem.value, unitText: "", statsText: "", fraction: NaN, palette, barColor: palette.accent });
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	if (settings.readingKey === undefined || settings.readingKey === "") {
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: "HWiNFO", valueText: "rotate to pick", unitText: "", statsText: "or use the settings panel", fraction: NaN, palette, barColor: palette.accent });
	}
	const reading = snapshot.byKey.get(settings.readingKey);
	if (reading === undefined) {
		// Turns are ignored here on purpose (see advance): the saved selection
		// survives a transient HWiNFO outage instead of being rotated away.
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: "Sensor missing", valueText: "waiting", unitText: "", statsText: "reselect in settings", fraction: NaN, palette, barColor: palette.accent });
	}

	const fahrenheit = settings.fahrenheit === true;
	const decimals: DecimalsSetting = settings.decimals ?? "auto";
	const stats = state.stats.get(settings.readingKey) ?? { min: reading.value, max: reading.value, sum: reading.value, count: 1 };

	const nativeShown = state.statMode === "min" ? stats.min : state.statMode === "max" ? stats.max : state.statMode === "avg" ? stats.sum / stats.count : reading.value;
	const shown = convertUnit(nativeShown, reading.unit, fahrenheit);
	const badge = STAT_BADGE[state.statMode];

	const min = convertUnit(stats.min, reading.unit, fahrenheit).value;
	const max = convertUnit(stats.max, reading.unit, fahrenheit).value;
	const live = convertUnit(reading.value, reading.unit, fahrenheit).value;

	// Thresholds and the manual bar range only apply to readings in the unit
	// they were configured against (mixed-unit rotation safety).
	const scoped = thresholdsApplyTo(settings.alertUnit, reading.unit);
	const barMin = (scoped ? parseThreshold(settings.barMin) : undefined) ?? min;
	const barMax = (scoped ? parseThreshold(settings.barMax) : undefined) ?? max;
	const span = barMax - barMin;
	const fraction = span > 0 && Number.isFinite(live) ? Math.max(0, Math.min(1, (live - barMin) / span)) : 0.5;

	// Dials stay themed while alerting — only the bar fill flips to the alert
	// field color (the touchscreen slot is too small for a full polarity flip).
	const level = scoped ? alertLevel(live, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true) : "normal";
	const accent = typeAccentsEnabled() ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const palette = resolvePalette(config, themeId, accent, "normal");

	const label = settings.label !== undefined && settings.label.trim() !== "" ? settings.label.trim() : reading.label;
	// A transient hint owns the whole stats line for its moment (appending it
	// to min/max would run past the 200 px canvas); persistent states replace
	// only the trailing "session" tag. Belt and braces: the line is truncated
	// to what 12 px/600 fits, so no combination can clip off-canvas.
	const overlay = state.overlay;
	const stateTag = state.pinned ? "pinned" : state.cyclePaused && parseAutoCycleMs(settings.autoCycleMs) !== null ? "cycle paused" : "session";
	const statsLine = overlay !== null && overlay.until > Date.now() ? overlay.text : `▼ ${formatValue(min, decimals)}   ▲ ${formatValue(max, decimals)}   ${stateTag}`;
	return renderDial({
		title: label,
		valueText: formatValue(shown.value, decimals),
		unitText: `${shown.unit}${badge !== "" ? " · " + badge : ""}`.trim(),
		statsText: truncateLabel(statsLine, 28),
		fraction,
		palette,
		barColor: level !== "normal" ? config.alerts[level].bg : palette.accent
	});
}
