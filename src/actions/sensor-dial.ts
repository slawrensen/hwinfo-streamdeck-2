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
 * gesture machine (src/gestures.ts), route pressed rotation separately
 * (jumping between named rotation groups once the settings define them,
 * else between sensor sources), and can enable touch zones. Session stats are keyed per reading
 * (src/stats.ts) and, together with the display/pause/pin state, survive
 * page and profile navigation through a bounded hidden-state cache. The
 * Stream Deck app owns horizontal touch-strip swipes (page navigation);
 * this class only preserves state across the willDisappear/willAppear it
 * causes.
 */
import streamDeck, { action, SingletonAction, type DialAction, type DialDownEvent, type DialRotateEvent, type DialUpEvent, type DidReceiveSettingsEvent, type SendToPluginEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { registerDialCommandHandler, type ControlCommandId, type DialControlCommand } from "../commands";
import { parseResetScope, resolveControls, schemeCanSwitchGroups, triggerDescriptions, type ControlScheme, type GestureCommandId, type ResetScope } from "../controls";
import { deviceCapabilities, tapCanvasWidth } from "../devices";
import { registerDiagnostics } from "../diagnostics";
import { IDLE_GESTURE, routeGesture, type GestureState } from "../gestures";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { buildThemesPayload, handlePiRequest, pushPreviewToPi } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import { describeGestureState, hashId, trace, traceEnabled } from "../recorder";
import { activeGroupIndex, autoCycleTarget, groupDisplayName, groupReadings, overviewWindow, rotationGroupsOf, rotationReadings, stepGroup, stepReading, stepSensorSource, type RotationGroup } from "../rotation";
import { SessionStatsStore, type SessionStats } from "../stats";
import { FOOTER_PX, renderDial, renderDialOverview, renderDialTwoRow, type OverviewRow } from "../ui/dial-renderer";
import { alertLevel, convertUnit, dedupeSharedLabelPrefix, estimateFooterWidth, parseThreshold, STAT_BADGE, STAT_MODES, thresholdsApplyTo, truncateLabel, type DecimalsSetting, type StatMode } from "../ui/format";
import { computeGauge, drawnZones } from "../ui/gauge";
import { formatMeasurement, formatStat, isDataUnit } from "../ui/measure";
import { statusDialText } from "../ui/state-screens";
import { resolveTextColors, type TextColors } from "../ui/text-colors";
import { decideLegacyDefault, effectiveTextFor, getDeckTheme, measureOptionsFrom, onThemeChange, typeAccentsEnabled } from "../ui/theme-store";
import { classifyTypeAccent, loadThemes, resolvePalette, type ThemesConfig } from "../ui/themes";

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
	/**
	 * Per-dial Text setting (issue #2): "theme", "dim" or "custom"; anything
	 * else (absent, "", junk) follows the deck-wide Text default.
	 */
	textMode?: string;
	/** Custom text color (#RRGGBB); invalid values degrade to theme text. */
	textColor?: string;
	/** Custom mode: labels, units and stats at lower intensity. */
	textDimSecondary?: boolean;
	/** Rotation set: rotate/autocycle move only through these picked readings. */
	rotationKeys?: string[];
	/**
	 * Named rotation groups (optional): plain rotate stays inside the active
	 * group, a Switch gesture (Elite press+rotate) jumps between groups. The
	 * PI keeps rotationKeys mirrored to the union of all group keys so
	 * set-wide consumers (stats, reset reach) and older plugin versions after
	 * a rollback keep reading the flat set unchanged.
	 */
	rotationGroups?: { name?: string; keys?: string[] }[];
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
	/**
	 * "overview" lists up to three rotation-list rows at once, "tworow" two
	 * bigger ones with sparklines (the selected row marked, the window
	 * following rotation in both); anything else renders the unchanged
	 * single view, so settings from a newer version degrade safely after a
	 * rollback and old profiles are never migrated or rewritten.
	 */
	dialView?: string;
	/**
	 * Per-reading display names, keyed by the stable reading identity
	 * (renamed by clicking a rotation-set chip's name in the PI). Shown as
	 * the overview row label and as the dial title while that reading is
	 * selected; the per-dial `label` field still overrides while set.
	 */
	rotationNames?: Record<string, string>;
	/**
	 * Overview row labels: anything but the exact "full" shortens shared
	 * label prefixes and shows them once in the context line (the default);
	 * "full" keeps every row label exactly as named.
	 */
	overviewLabels?: string;
	/**
	 * Three-row overview context line position: the exact "bottom" moves it
	 * under the rows (above a thin rule); anything else is the top default,
	 * so rolled-back or hand-edited settings degrade safely.
	 */
	overviewHeader?: string;
	/**
	 * Three-row overview separators: the exact "off" hides the thin lines
	 * between rows (and the bottom-mode rule); anything else keeps them.
	 */
	overviewSeparators?: string;
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
	/** Readings this instance holds poller series subscriptions for (the
	 * two-row view's sparklines); synced each tick, released on disappear.
	 * Not restored across hiding: the poller's grace window keeps the rings
	 * warm and the first tick back resubscribes. */
	rowSeries: Set<string>;
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
			// Keep the open PI's "Deck default" chip and live preview truthful
			// in real time (theme, Text and Data units are all deck-wide).
			if (streamDeck.ui.action?.manifestId === this.manifestId) {
				void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
				pushPreviewToPi(poller.getStatus(), this.manifestId, this.instances, false);
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
			pendingAlertUnitStamp: restored?.pendingAlertUnitStamp ?? false,
			rowSeries: new Set()
		};
		this.instances.set(ev.action.id, state);
		if (ev.action.isDial()) {
			this.pushTriggerDescriptions(ev.action, ev.payload.settings);
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
		// The rows' rings stay tracked in the poller: history keeps
		// collecting off-screen, so the two-row view returns complete.
		state.rowSeries.clear();
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
			this.pushTriggerDescriptions(ev.action, state.settings);
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
		handlePiRequest(ev.payload);
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
				await this.advance(action, state, ticks === 0 ? 1 : ticks, "group");
				return;
			default:
				this.executeStateCommand(state, { command: GESTURE_STATE_COMMANDS[command], target: "", scope: parseResetScope(state.settings.resetScope) });
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
	private async advance(action: DialAction<DialSettings>, state: InstanceState, ticks: number, granularity: "reading" | "group"): Promise<void> {
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
		const groups = rotationGroupsOf(state.settings.rotationGroups);
		let next: Reading | undefined;
		if (granularity === "group") {
			if (groups !== undefined) {
				next = stepGroup(groups, key, ticks, snapshot);
			} else {
				// Without groups the jump moves between sensor sources, and with
				// no rotation set either it must roam the whole snapshot, or it
				// could never leave the sensor it is scoped to.
				const setKeys = rotationKeysOf(state.settings);
				next = stepSensorSource(setKeys === undefined ? snapshot.readings : rotationReadings(setKeys, key, snapshot), key, ticks);
			}
		} else {
			next = stepReading(stepListOf(state.settings, key, groups, snapshot), key, ticks);
		}
		if (next === undefined || next.key === state.settings.readingKey) {
			return;
		}
		// A group jump names its landing group; set before adopting so the
		// adopt's own render already paints the overlay.
		if (granularity === "group" && groups !== undefined) {
			const landed = activeGroupIndex(groups, next.key);
			if (landed !== -1) {
				this.showOverlay(state, groupDisplayName(groups, landed));
			}
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
			// its true session, and hidden members keep alert coverage. The
			// two-row view's sparkline subscriptions ride the same sweep.
			for (const state of this.instances.values()) {
				this.sampleStats(state, status.snapshot);
				this.syncRowSeries(state, status.snapshot);
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
		pushPreviewToPi(status, this.manifestId, this.instances, false);
	}

	private sampleStats(state: InstanceState, snapshot: SensorSnapshot): void {
		const keys = new Set<string>(rotationKeysOf(state.settings) ?? []);
		const current = readingKeyOf(state.settings);
		if (current !== undefined) {
			keys.add(current);
		}
		// The multi-row views show session min/max/avg for every visible row,
		// so their step list samples too (a sensor-scoped view has no rotation
		// set; without this its non-selected rows would show live values under
		// a MIN badge). prune() below bounds the total by relevance as always.
		if (dialViewOf(state.settings) !== "single") {
			for (const member of stepListOf(state.settings, current, rotationGroupsOf(state.settings.rotationGroups), snapshot)) {
				keys.add(member.key);
			}
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

	/**
	 * Keeps the poller series subscriptions matched to the two-row view's
	 * visible rows (they feed the row sparklines). The poller's grace window
	 * carries the rings across window moves and quick page flips, so a row
	 * scrolling back within a minute keeps its history.
	 */
	private syncRowSeries(state: InstanceState, snapshot: SensorSnapshot): void {
		const desired = new Set<string>();
		if (dialViewOf(state.settings) === "tworow") {
			const key = readingKeyOf(state.settings);
			const reading = key === undefined ? undefined : snapshot.byKey.get(key);
			if (reading !== undefined) {
				const list = stepListOf(state.settings, key, rotationGroupsOf(state.settings.rotationGroups), snapshot);
				for (const member of overviewWindow(list.length === 0 ? [reading] : list, key, 2).rows) {
					desired.add(member.key);
				}
			}
		}
		for (const key of [...state.rowSeries]) {
			if (!desired.has(key)) {
				// Off the visible window now; its ring stays warm in the poller.
				state.rowSeries.delete(key);
			}
		}
		for (const key of desired) {
			if (!state.rowSeries.has(key)) {
				poller.subscribeSeries(key);
				state.rowSeries.add(key);
			}
		}
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
				const groups = rotationGroupsOf(state.settings.rotationGroups);
				const list = stepListOf(state.settings, key, groups, status.snapshot);
				// While groups scope the step list, alerts are still hunted
				// across every group. The scan list comes from the parsed
				// groups (the authority), not the rotationKeys mirror, which
				// can go stale after settings edits under a rolled-back
				// version. Ungrouped and Legacy dials pass their own list.
				const alertList = groups !== undefined && schemeCanSwitchGroups(resolveControls(state.settings)) ? rotationReadings(groups.flatMap((g) => g.keys), key, status.snapshot) : list;
				const target = autoCycleTarget(list, alertList, key, this.criticalKeys(state, alertList), state.settings.alertInterrupt === true);
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
				await this.advance(action, state, 1, "group");
				return;
			case "prevGroup":
				await this.advance(action, state, -1, "group");
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
	private pushTriggerDescriptions(action: DialAction<DialSettings>, settings: DialSettings): void {
		const scheme: ControlScheme = resolveControls(settings);
		// Legacy matches the manifest text; undefined restores exactly that.
		void action.setTriggerDescription(scheme.preset === "legacy" ? undefined : triggerDescriptions(scheme, rotationGroupsOf(settings.rotationGroups) !== undefined));
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
			view: dialViewOf(state.settings),
			statMode: state.statMode,
			rotationSet: rotationKeysOf(state.settings)?.length ?? 0,
			// Counts only: group and reading names carry user text, like keys.
			rotationGroups: rotationGroupsOf(state.settings.rotationGroups)?.length ?? 0,
			rotationNames: Object.keys(rotationNamesOf(state.settings) ?? {}).length,
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

/** The state-only gesture commands, mapped to their executeStateCommand ids
 *  (the gestures toggle where the control action also has explicit on/off). */
const GESTURE_STATE_COMMANDS: Record<Exclude<GestureCommandId, "none" | "step" | "stepGroup">, ControlCommandId> = { cycleStat: "cycleStat", backToCurrent: "backToCurrent", pauseResume: "toggleCycle", pin: "togglePin", resetStats: "resetStats" };

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

/** Only the exact markers activate a multi-row view; anything else (absent,
 *  junk, a newer version's future value after a rollback) stays single. */
function dialViewOf(settings: DialSettings): "single" | "overview" | "tworow" {
	return settings.dialView === "overview" ? "overview" : settings.dialView === "tworow" ? "tworow" : "single";
}

/**
 * The list plain stepping and the auto cycle move through, and exactly what
 * the overview lists. Groups scope it to the active group only while the
 * scheme itself can jump groups (schemeCanSwitchGroups); otherwise the union
 * mirrored in rotationKeys keeps the pre-groups behavior, so defined groups
 * can never strand a dial inside one of them, and Legacy stays exact.
 * Module-level so composeDialSvg renders the same list rotation steps
 * through; the two can never disagree.
 */
function stepListOf(settings: DialSettings, key: string | undefined, groups: readonly RotationGroup[] | undefined, snapshot: SensorSnapshot): readonly Reading[] {
	if (groups !== undefined && schemeCanSwitchGroups(resolveControls(settings))) {
		return groupReadings(groups, key, snapshot);
	}
	return rotationReadings(rotationKeysOf(settings), key, snapshot);
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
	// Dial faces stay themed while alerting, so the Text setting resolves at
	// level "normal" here; the alert expression (bar fill, alerting row
	// values) is fixed separately and custom text never recolors it.
	const textOf = (palette: Parameters<typeof resolveTextColors>[0]): TextColors => resolveTextColors(palette, effectiveTextFor(settings), "normal");

	const problem = statusDialText(status);
	if (problem !== null) {
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: problem.title, valueText: problem.value, unitText: "", statsText: "", fraction: NaN, palette, barColor: palette.accent, text: textOf(palette) });
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	if (settings.readingKey === undefined || settings.readingKey === "") {
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: "HWiNFO", valueText: "rotate to pick", unitText: "", statsText: "or use the settings panel", fraction: NaN, palette, barColor: palette.accent, text: textOf(palette) });
	}
	const reading = snapshot.byKey.get(settings.readingKey);
	if (reading === undefined) {
		// Turns are ignored here on purpose (see advance): the saved selection
		// survives a transient HWiNFO outage instead of being rotated away.
		const palette = resolvePalette(config, themeId, null, "normal");
		return renderDial({ title: "Sensor missing", valueText: "waiting", unitText: "", statsText: "reselect in settings", fraction: NaN, palette, barColor: palette.accent, text: textOf(palette) });
	}

	// Status, no-selection and missing faces above are shared with the single
	// view on purpose: the multi-row views only change how live data is laid
	// out.
	const view = dialViewOf(settings);
	if (view !== "single") {
		return composeOverviewSvg(state, snapshot, reading, config, themeId, view === "tworow" ? 2 : 3);
	}

	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const stats = state.stats.get(settings.readingKey) ?? { min: reading.value, max: reading.value, sum: reading.value, count: 1 };

	const nativeShown = rowStatValue(reading.value, stats, state.statMode);
	const shown = formatMeasurement(nativeShown, reading.unit, measureOpts);
	const badge = STAT_BADGE[state.statMode];

	const min = convertUnit(stats.min, reading.unit, fahrenheit).value;
	const max = convertUnit(stats.max, reading.unit, fahrenheit).value;
	const live = convertUnit(reading.value, reading.unit, fahrenheit).value;

	// Thresholds and the manual bar range only apply to readings in the unit
	// they were configured against (mixed-unit rotation safety). Bounds and
	// zones come from the shared gauge model: manual sides win exactly,
	// automatic sides stay the session min/max (the dial's established
	// behavior) and only expand when thresholds would fall outside.
	const scoped = thresholdsApplyTo(settings.alertUnit, reading.unit);
	const warn = scoped ? parseThreshold(settings.warnValue) : undefined;
	const crit = scoped ? parseThreshold(settings.critValue) : undefined;
	const gauge = computeGauge({
		value: live,
		manualMin: scoped ? parseThreshold(settings.barMin) : undefined,
		manualMax: scoped ? parseThreshold(settings.barMax) : undefined,
		evidence: { min, max },
		warn,
		crit,
		alertBelow: settings.alertBelow === true
	});
	const fraction = Number.isFinite(gauge.fraction) ? gauge.fraction : 0.5;

	// Dials stay themed while alerting — only the bar fill flips to the alert
	// field color (the touchscreen slot is too small for a full polarity flip).
	const level = scoped ? alertLevel(live, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true) : "normal";
	const accent = typeAccentsEnabled() ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const palette = resolvePalette(config, themeId, accent, "normal");

	// Title precedence: the per-dial label (transient or fixed), then the
	// reading's own per-member name, then HWiNFO's label.
	const label = customLabelOf(settings) ?? rotationNamesOf(settings)?.[reading.key] ?? reading.label;
	// A transient hint owns the whole stats line for its moment (appending it
	// to min/max would run past the 200 px canvas); persistent states replace
	// only the trailing "session" tag. Belt and braces: the line is truncated
	// to what 12 px/600 fits, so no combination can clip off-canvas. Data
	// units carry their own tier suffix per stat, so that variant packs
	// tighter to keep the whole line on canvas.
	const overlay = state.overlay;
	const stateTag = state.pinned ? "pinned" : state.cyclePaused && parseAutoCycleMs(settings.autoCycleMs) !== null ? "cycle paused" : "session";
	const minText = formatStat(stats.min, reading.unit, measureOpts);
	const maxText = formatStat(stats.max, reading.unit, measureOpts);
	const statsLine = overlay !== null && overlay.until > Date.now() ? overlay.text : isDataUnit(reading.unit) ? `▼${minText} ▲${maxText} ${stateTag}` : `▼ ${minText}   ▲ ${maxText}   ${stateTag}`;
	return renderDial({
		title: label,
		valueText: shown.valueText,
		unitText: `${shown.unitText}${badge !== "" ? " · " + badge : ""}`.trim(),
		statsText: truncateLabel(statsLine, 28),
		fraction,
		palette,
		barColor: level !== "normal" ? config.alerts[level].bg : palette.accent,
		zones: drawnZones(gauge.zones, config.alerts, palette.bg),
		text: textOf(palette)
	});
}

function customLabelOf(settings: DialSettings): string | undefined {
	return typeof settings.label === "string" && settings.label.trim() !== "" ? settings.label.trim() : undefined;
}

/** Settings are untyped JSON: keep non-empty string names under string keys
 *  (the PI's chip rename writes them); anything else degrades to no names. */
function rotationNamesOf(settings: DialSettings): Record<string, string> | undefined {
	const raw: unknown = settings.rotationNames;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	let names: Record<string, string> | undefined;
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "string" && value.trim() !== "") {
			(names ??= {})[key] = value.trim();
		}
	}
	return names;
}

/**
 * The overview face: rows are the exact rotation step list, the three-row
 * window follows the selection statelessly (see overviewWindow), and the
 * footer carries the single view's stats-line mechanics unchanged: session
 * min/max of the selected reading, transient overlays (group-jump names,
 * "cycle paused", reset confirmations), pinned and paused tags, and the
 * stat badge when a non-current stat is displayed. Row values honor the
 * displayed stat from each member's own session, and warn/critical tint a
 * row's value under the same alertUnit scoping as the single view's bar.
 */
function composeOverviewSvg(state: InstanceState, snapshot: SensorSnapshot, reading: Reading, config: ThemesConfig, themeId: string, rowCount: 2 | 3): string {
	const settings = state.settings;
	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const stepList = stepListOf(settings, reading.key, rotationGroupsOf(settings.rotationGroups), snapshot);
	// A set whose members are all absent from the snapshot (sensor asleep)
	// still has a live selection to show; never render an empty face.
	const list = stepList.length === 0 ? [reading] : stepList;
	const { rows, selectedIndex } = overviewWindow(list, reading.key, rowCount);

	// Row names, resolved over the VISIBLE window: a user-typed name (the
	// per-dial label on the selected row, or a per-reading rotationNames
	// entry) wins verbatim and is never altered; among the rest, the leading
	// words all rows share are dropped ("GPU Temperature / GPU Hot Spot"
	// reads as "Temperature / Hot Spot") and come back once as the footer's
	// context prefix, unless "Row labels" is set to full.
	const names = rotationNamesOf(settings);
	const customLabel = customLabelOf(settings);
	const candidates = rows.map((member, index) => {
		const override = index === selectedIndex && customLabel !== undefined ? customLabel : names?.[member.key];
		return { text: override ?? member.label, locked: override !== undefined };
	});
	const shorten = settings.overviewLabels !== "full";
	const deduped = shorten
		? dedupeSharedLabelPrefix(
				candidates.map((c) => c.text),
				candidates.map((c) => c.locked)
			)
		: { labels: candidates.map((c) => c.text), prefix: "" };

	// The accent (selection bar) follows the reading on the dial, exactly
	// like the single view's accent follows it.
	const accent = typeAccentsEnabled() ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const palette = resolvePalette(config, themeId, accent, "normal");
	const text = resolveTextColors(palette, effectiveTextFor(settings), "normal");
	const warn = parseThreshold(settings.warnValue);
	const crit = parseThreshold(settings.critValue);

	const overviewRows: (OverviewRow & { history?: readonly number[] })[] = rows.map((member, index) => {
		const selected = index === selectedIndex;
		const shown = formatMeasurement(rowStatValue(member.value, state.stats.get(member.key), state.statMode), member.unit, measureOpts);
		const scoped = thresholdsApplyTo(settings.alertUnit, member.unit);
		const live = convertUnit(member.value, member.unit, fahrenheit).value;
		const level = scoped ? alertLevel(live, warn, crit, settings.alertBelow === true) : "normal";
		return {
			label: deduped.labels[index] ?? member.label,
			valueText: shown.valueText,
			unitText: shown.unitText,
			selected,
			// An alerting row's value is the alert indicator and stays fixed;
			// custom text never recolors it.
			valueColor: level !== "normal" ? config.alerts[level].bg : text.value,
			// The two-row view draws each visible reading's trend from the
			// poller's series store, which syncRowSeries keeps subscribed.
			...(rowCount === 2 ? { history: poller.getSeries(member.key) } : {})
		};
	});

	const stats = state.stats.get(reading.key) ?? { min: reading.value, max: reading.value, sum: reading.value, count: 1 };
	const minText = formatStat(stats.min, reading.unit, measureOpts);
	const maxText = formatStat(stats.max, reading.unit, measureOpts);
	const badge = STAT_BADGE[state.statMode];
	// One tag slot: pinned wins, then paused, then the stat badge; "session"
	// fills the quiet default, but yields to the shared-prefix context.
	const stateTag = state.pinned ? "pinned" : state.cyclePaused && parseAutoCycleMs(settings.autoCycleMs) !== null ? "cycle paused" : badge !== "" || deduped.prefix !== "" ? "" : "session";
	const tags = [badge, stateTag].filter((part) => part !== "").join(" · ");
	const overlay = state.overlay;
	const overlayActive = overlay !== null && overlay.until > Date.now();
	if (rowCount === 2) {
		// The two-row face keeps the single footer line: the stripped shared
		// prefix TRAILS it so the renderer's fitting may shorten the context
		// ("· Virtual Mem…") but can never eat a number; the tight variant
		// (markers hugging their numbers) usually saves the whole text first.
		const context = deduped.prefix !== "" ? `· ${deduped.prefix}` : "";
		const roomy = [`▼ ${minText}`, `▲ ${maxText}`, tags, context].filter((part) => part !== "").join("  ");
		const tight = [`▼${minText}`, `▲${maxText}`, tags, context].filter((part) => part !== "").join(" ");
		const footer = overlayActive ? overlay.text : estimateFooterWidth(roomy) <= FOOTER_PX ? roomy : tight;
		return renderDialTwoRow({ rows: overviewRows, footerText: footer, palette, text });
	}
	// The three-row wide tile splits that line: the stats are their own
	// right-anchored element the renderer never clips, and the left region
	// carries the tags and shared name (or a transient overlay, which takes
	// the whole line exactly as it took the whole footer).
	const contextText = overlayActive ? overlay.text : [tags, deduped.prefix].filter((part) => part !== "").join(" · ");
	const statsText = overlayActive ? "" : `▼${minText} ▲${maxText}`;
	return renderDialOverview({
		rows: overviewRows,
		contextText,
		statsText,
		header: settings.overviewHeader === "bottom" ? "bottom" : "top",
		separators: settings.overviewSeparators !== "off",
		palette,
		text
	});
}

/** The session stat a row displays; the live value when no session yet. */
function rowStatValue(live: number, stats: SessionStats | undefined, mode: StatMode): number {
	if (stats === undefined || mode === "current") {
		return live;
	}
	return mode === "min" ? stats.min : mode === "max" ? stats.max : stats.sum / stats.count;
}
