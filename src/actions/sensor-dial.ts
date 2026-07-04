/**
 * "Sensor Dial" encoder action (Stream Deck +) — live value on the
 * touchscreen with a range bar and session min/max.
 *
 *   rotate      cycle through the readings of the same sensor source
 *   push        reset the session min/max/avg
 *   touch       cycle displayed stat (current → min → max → avg, session)
 *   long touch  back to the current value
 */
import streamDeck, { action, SingletonAction, type DialDownEvent, type DialRotateEvent, type DidReceiveSettingsEvent, type JsonValue, type SendToPluginEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { Reading } from "../hwinfo/types";
import { buildPreview, buildSensorTree } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import { convertUnit, formatValue, parseThreshold, STAT_BADGE, STAT_MODES, type DecimalsSetting, type StatMode } from "../ui/format";
import { statusDialText } from "../ui/state-screens";

/** Persisted per-dial settings (written by the PI; all optional). */
export type DialSettings = {
	readingKey?: string;
	label?: string;
	decimals?: DecimalsSetting;
	fahrenheit?: boolean;
	/** Manual range for the bar; session min/max is used when absent. */
	barMin?: string;
	barMax?: string;
};

/** Session stats in the reading's NATIVE unit (converted at render time). */
type SessionStats = {
	min: number;
	max: number;
	sum: number;
	count: number;
};

type InstanceState = {
	settings: DialSettings;
	stats: SessionStats | null;
	/** Ephemeral display mode; reset to "current" on appear and long touch. */
	statMode: StatMode;
	lastFeedback: string;
};

@action({ UUID: "com.lawrensen.hwinfo.dial" })
export class SensorDialAction extends SingletonAction<DialSettings> {
	private readonly instances = new Map<string, InstanceState>();

	constructor() {
		super();
		poller.onTick((status) => this.onPollerTick(status));
	}

	override onWillAppear(ev: WillAppearEvent<DialSettings>): void {
		this.instances.set(ev.action.id, { settings: ev.payload.settings, stats: null, statMode: "current", lastFeedback: "" });
		poller.retain();
		this.renderAll(poller.getStatus());
	}

	override onWillDisappear(ev: WillDisappearEvent<DialSettings>): void {
		if (this.instances.delete(ev.action.id)) {
			poller.release();
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		if (state.settings.readingKey !== ev.payload.settings.readingKey) {
			state.stats = null;
			state.statMode = "current";
		}
		state.settings = ev.payload.settings;
		this.renderAll(poller.getStatus());
	}

	/** Rotate: move through the owning sensor's readings (wraps around). */
	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		const status = poller.getStatus();
		if (state === undefined || status.state === "unavailable") {
			return;
		}
		const { snapshot } = status;
		if (snapshot.readings.length === 0) {
			return;
		}

		const current = state.settings.readingKey !== undefined ? snapshot.byKey.get(state.settings.readingKey) : undefined;
		let next: Reading;
		if (current === undefined) {
			next = snapshot.readings[0] as Reading;
		} else {
			const group = snapshot.readings.filter((r) => r.sensorIndex === current.sensorIndex);
			const index = group.findIndex((r) => r.key === current.key);
			const wrapped = (((index + ev.payload.ticks) % group.length) + group.length) % group.length;
			next = group[wrapped] as Reading;
		}
		if (next.key === state.settings.readingKey) {
			return;
		}
		state.settings = { ...state.settings, readingKey: next.key };
		state.stats = null;
		state.statMode = "current";
		await ev.action.setSettings(state.settings);
		this.renderAll(status);
	}

	/** Push: reset the session min/max/avg. */
	override onDialDown(ev: DialDownEvent<DialSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		state.stats = null;
		this.renderAll(poller.getStatus());
	}

	/** Touch: cycle stat mode; long touch: back to the live value. */
	override onTouchTap(ev: TouchTapEvent<DialSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		if (ev.payload.hold) {
			state.statMode = "current";
		} else {
			state.statMode = STAT_MODES[(STAT_MODES.indexOf(state.statMode) + 1) % STAT_MODES.length] as StatMode;
		}
		this.renderAll(poller.getStatus());
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, DialSettings>): void {
		const payload = ev.payload;
		if (typeof payload === "object" && payload !== null && !Array.isArray(payload) && payload.event === "getSensorTree") {
			void streamDeck.ui.current?.sendToPropertyInspector(buildSensorTree(poller.getStatus()));
		}
	}

	private onPollerTick(status: PollerStatus): void {
		if (status.state === "ok") {
			for (const state of this.instances.values()) {
				const key = state.settings.readingKey;
				if (key === undefined || key === "") {
					continue;
				}
				const reading = status.snapshot.byKey.get(key);
				if (reading === undefined || !Number.isFinite(reading.value)) {
					continue;
				}
				if (state.stats === null) {
					state.stats = { min: reading.value, max: reading.value, sum: reading.value, count: 1 };
				} else {
					state.stats.min = Math.min(state.stats.min, reading.value);
					state.stats.max = Math.max(state.stats.max, reading.value);
					state.stats.sum += reading.value;
					state.stats.count++;
				}
			}
		}
		this.renderAll(status);
		this.pushPreview(status);
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
			const feedback = composeFeedback(state, status);
			const serialized = JSON.stringify(feedback);
			if (serialized !== state.lastFeedback) {
				state.lastFeedback = serialized;
				void act.setFeedback(feedback);
			}
		}
	}

	private pushPreview(status: PollerStatus): void {
		const pi = streamDeck.ui.current;
		if (pi === undefined || pi.action.manifestId !== this.manifestId) {
			return;
		}
		const state = this.instances.get(pi.action.id);
		void pi.sendToPropertyInspector(buildPreview(status, state?.settings.readingKey));
	}
}

type Feedback = {
	title: string;
	value: string;
	stats: string;
	indicator: number;
};

function composeFeedback(state: InstanceState, status: PollerStatus): Feedback {
	const problem = statusDialText(status);
	if (problem !== null) {
		return { title: problem.title, value: problem.value, stats: "", indicator: 0 };
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const settings = state.settings;
	if (settings.readingKey === undefined || settings.readingKey === "") {
		return { title: "HWiNFO", value: "rotate to pick", stats: "or use the settings panel", indicator: 0 };
	}
	const reading = snapshot.byKey.get(settings.readingKey);
	if (reading === undefined) {
		return { title: "Sensor missing", value: "rotate to pick", stats: "", indicator: 0 };
	}

	const fahrenheit = settings.fahrenheit === true;
	const decimals: DecimalsSetting = settings.decimals ?? "auto";
	const stats = state.stats ?? { min: reading.value, max: reading.value, sum: reading.value, count: 1 };

	const nativeShown = state.statMode === "min" ? stats.min : state.statMode === "max" ? stats.max : state.statMode === "avg" ? stats.sum / stats.count : reading.value;
	const shown = convertUnit(nativeShown, reading.unit, fahrenheit);
	const badge = STAT_BADGE[state.statMode];

	const min = convertUnit(stats.min, reading.unit, fahrenheit).value;
	const max = convertUnit(stats.max, reading.unit, fahrenheit).value;
	const live = convertUnit(reading.value, reading.unit, fahrenheit).value;

	// Bar: manual range when configured, else the session's observed range.
	const barMin = parseThreshold(settings.barMin) ?? min;
	const barMax = parseThreshold(settings.barMax) ?? max;
	const span = barMax - barMin;
	const indicator = span > 0 ? Math.max(0, Math.min(100, ((live - barMin) / span) * 100)) : 50;

	const label = settings.label !== undefined && settings.label.trim() !== "" ? settings.label.trim() : reading.label;
	return {
		title: label.length > 26 ? `${label.slice(0, 25)}…` : label,
		value: `${formatValue(shown.value, decimals)} ${shown.unit}${badge !== "" ? "  ·  " + badge : ""}`.trim(),
		stats: `▼ ${formatValue(min, decimals)}   ▲ ${formatValue(max, decimals)}   session`,
		indicator: Math.round(indicator)
	};
}
