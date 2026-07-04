/**
 * "Sensor Reading" key action — shows one live HWiNFO reading with optional
 * thresholds, stat modes and a sparkline. Pressing the key cycles the stat
 * mode (current → min → max → avg).
 */
import streamDeck, { action, SingletonAction, type DidReceiveSettingsEvent, type JsonValue, type KeyDownEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { buildPreview, buildSensorTree } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import { alertLevel, convertUnit, formatValue, isStatMode, parseThreshold, STAT_BADGE, STAT_MODES, statValue, type DecimalsSetting, type StatMode } from "../ui/format";
import { renderReadingKey, renderStatusKey } from "../ui/key-renderer";
import { keyLabel, missingReadingScreen, noSelectionScreen, statusScreen } from "../ui/state-screens";

/** Persisted per-key settings (written by the PI; all optional). */
export type ReadingSettings = {
	readingKey?: string;
	label?: string;
	decimals?: DecimalsSetting;
	fahrenheit?: boolean;
	statMode?: StatMode;
	sparkline?: boolean;
	warnValue?: string;
	critValue?: string;
	alertBelow?: boolean;
};

const HISTORY_LENGTH = 36;

type InstanceState = {
	settings: ReadingSettings;
	/** Recent current values in display units, for the sparkline. */
	history: number[];
	/** Last SVG sent — identical frames are skipped. */
	lastSvg: string;
};

@action({ UUID: "com.lawrensen.hwinfo.reading" })
export class SensorReadingAction extends SingletonAction<ReadingSettings> {
	private readonly instances = new Map<string, InstanceState>();

	constructor() {
		super();
		// Isolated so a rendering bug in one action class can't starve the other
		// listeners on the shared "tick" event.
		poller.onTick((status) => {
			try {
				this.onPollerTick(status);
			} catch (err) {
				streamDeck.logger.error("SensorReadingAction tick failed", err);
			}
		});
	}

	override onWillAppear(ev: WillAppearEvent<ReadingSettings>): void {
		// Stream Deck can replay willAppear for a context without an intervening
		// willDisappear (reconnect, wake) — retain only on the first sighting.
		if (!this.instances.has(ev.action.id)) {
			poller.retain();
		}
		this.instances.set(ev.action.id, { settings: ev.payload.settings, history: [], lastSvg: "" });
		this.renderAll(poller.getStatus());
	}

	override onWillDisappear(ev: WillDisappearEvent<ReadingSettings>): void {
		if (this.instances.delete(ev.action.id)) {
			poller.release();
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ReadingSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		const previous = state.settings;
		state.settings = ev.payload.settings;
		if (previous.readingKey !== state.settings.readingKey || previous.fahrenheit !== state.settings.fahrenheit) {
			state.history.length = 0;
		}
		this.renderAll(poller.getStatus());
	}

	/** Key press cycles the displayed stat: current → min → max → avg. */
	override async onKeyDown(ev: KeyDownEvent<ReadingSettings>): Promise<void> {
		const state = this.instances.get(ev.action.id);
		if (state === undefined || state.settings.readingKey === undefined) {
			return;
		}
		const current = isStatMode(state.settings.statMode) ? state.settings.statMode : "current";
		const next = STAT_MODES[(STAT_MODES.indexOf(current) + 1) % STAT_MODES.length] as StatMode;
		state.settings = { ...state.settings, statMode: next };
		await ev.action.setSettings(state.settings);
		this.renderAll(poller.getStatus());
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, ReadingSettings>): void {
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
					state.history.length = 0;
					continue;
				}
				const reading = status.snapshot.byKey.get(key);
				if (reading === undefined) {
					continue;
				}
				const { value } = convertUnit(reading.value, reading.unit, state.settings.fahrenheit === true);
				if (!Number.isFinite(value)) {
					continue;
				}
				state.history.push(value);
				if (state.history.length > HISTORY_LENGTH) {
					state.history.shift();
				}
			}
		}
		this.renderAll(status);
		this.pushPreview(status);
	}

	private renderAll(status: PollerStatus): void {
		for (const act of this.actions) {
			if (!act.isKey()) {
				continue;
			}
			const state = this.instances.get(act.id);
			if (state === undefined) {
				continue;
			}
			const svg = compose(state, status);
			if (svg !== state.lastSvg) {
				state.lastSvg = svg;
				void act.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
			}
		}
	}

	/** Live numbers for the PI while it is open on one of our keys. */
	private pushPreview(status: PollerStatus): void {
		const pi = streamDeck.ui.current;
		// pi.action is typed non-optional but the SDK constructs it as undefined
		// when the PI appears before the action's willAppear (restart races).
		if (pi === undefined || (pi.action as typeof pi.action | undefined)?.manifestId !== this.manifestId) {
			return;
		}
		const state = this.instances.get(pi.action.id);
		void pi.sendToPropertyInspector(buildPreview(status, state?.settings.readingKey));
	}
}

function compose(state: InstanceState, status: PollerStatus): string {
	const screen = statusScreen(status);
	if (screen !== null) {
		return renderStatusKey(screen);
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const settings = state.settings;
	if (settings.readingKey === undefined || settings.readingKey === "") {
		return renderStatusKey(noSelectionScreen());
	}
	const reading = snapshot.byKey.get(settings.readingKey);
	if (reading === undefined) {
		return renderStatusKey(missingReadingScreen());
	}

	const fahrenheit = settings.fahrenheit === true;
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const displayed = convertUnit(statValue(reading, mode), reading.unit, fahrenheit);
	const live = convertUnit(reading.value, reading.unit, fahrenheit);
	const decimals: DecimalsSetting = settings.decimals ?? "auto";

	const badge = STAT_BADGE[mode];
	return renderReadingKey({
		label: keyLabel(settings.label, reading.label, badge === "" ? 16 : 11),
		valueText: formatValue(displayed.value, decimals),
		unitText: displayed.unit,
		level: alertLevel(live.value, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true),
		statBadge: badge,
		history: settings.sparkline === true ? state.history : undefined
	});
}
