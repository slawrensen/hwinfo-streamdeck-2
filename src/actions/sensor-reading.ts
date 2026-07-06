/**
 * "Sensor Reading" key action — shows one live HWiNFO reading with optional
 * thresholds, stat modes and a sparkline. Pressing the key cycles the stat
 * mode (current → min → max → avg).
 */
import streamDeck, { action, SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { buildPreview, buildSensorTree, buildThemesPayload } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import { alertLevel, convertUnit, formatValue, isStatMode, parseThreshold, STAT_BADGE, STAT_MODES, statValue, type DecimalsSetting, type StatMode } from "../ui/format";
import { renderReadingKey, renderStatusKey } from "../ui/key-renderer";
import { keyLabel, missingReadingScreen, noSelectionScreen, statusScreen } from "../ui/state-screens";
import { decideLegacyDefault, getDeckTheme, onThemeChange, typeAccentsEnabled } from "../ui/theme-store";
import { classifyTypeAccent, loadThemes, resolvePalette } from "../ui/themes";

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
	/** Per-key theme override; empty/absent follows the deck default. */
	theme?: string;
};

type InstanceState = {
	settings: ReadingSettings;
	/** The reading key this instance is subscribed to in the poller's sparkline
	 *  store (undefined when nothing is selected). */
	subscribedKey: string | undefined;
	/** Last SVG sent — identical frames are skipped. */
	lastSvg: string;
};

function readingKeyOf(settings: ReadingSettings): string | undefined {
	return typeof settings.readingKey === "string" && settings.readingKey !== "" ? settings.readingKey : undefined;
}

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
		onThemeChange(() => {
			this.renderAll(poller.getStatus());
			// Keep the open PI's "Deck default" chip truthful in real time.
			if (streamDeck.ui.action?.manifestId === this.manifestId) {
				void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
			}
		});
	}

	override onWillAppear(ev: WillAppearEvent<ReadingSettings>): void {
		// Stream Deck can replay willAppear for a context without an intervening
		// willDisappear (reconnect, wake) — retain + subscribe only on the first
		// sighting, and carry the existing subscription across a replay so the
		// sparkline history (now owned by the poller) is never dropped.
		const existing = this.instances.get(ev.action.id);
		const firstSighting = existing === undefined;
		if (firstSighting) {
			poller.retain();
		}
		decideLegacyDefault(Object.values(ev.payload.settings).some((v) => v !== undefined));
		const key = readingKeyOf(ev.payload.settings);
		if (firstSighting && key !== undefined) {
			poller.subscribeSeries(key);
		}
		this.instances.set(ev.action.id, {
			settings: ev.payload.settings,
			subscribedKey: firstSighting ? key : existing?.subscribedKey,
			lastSvg: existing?.lastSvg ?? ""
		});
		this.renderAll(poller.getStatus());
	}

	override onWillDisappear(ev: WillDisappearEvent<ReadingSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (this.instances.delete(ev.action.id)) {
			poller.release();
			if (state?.subscribedKey !== undefined) {
				poller.unsubscribeSeries(state.subscribedKey);
			}
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ReadingSettings>): void {
		const state = this.instances.get(ev.action.id);
		if (state === undefined) {
			return;
		}
		// Re-point the sparkline subscription when the sensor changes. A °C/°F
		// change no longer resets anything: the poller stores native values, so
		// the drawn shape is unit-invariant and the history carries across.
		const nextSub = readingKeyOf(ev.payload.settings);
		if (state.subscribedKey !== nextSub) {
			if (state.subscribedKey !== undefined) {
				poller.unsubscribeSeries(state.subscribedKey);
			}
			if (nextSub !== undefined) {
				poller.subscribeSeries(nextSub);
			}
			state.subscribedKey = nextSub;
		}
		state.settings = ev.payload.settings;
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
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			return;
		}
		if (payload.event === "getSensorTree") {
			void streamDeck.ui.sendToPropertyInspector(buildSensorTree(poller.getStatus()));
		} else if (payload.event === "getThemes") {
			void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
		}
	}

	private onPollerTick(status: PollerStatus): void {
		// The sparkline rings are filled by the poller now (once per fresh
		// snapshot, keyed by reading) so it survives this action's appear churn —
		// here we only render and feed the open PI's live preview.
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
		const piAction = streamDeck.ui.action;
		if (piAction === undefined || piAction.manifestId !== this.manifestId) {
			return;
		}
		const state = this.instances.get(piAction.id);
		void streamDeck.ui.sendToPropertyInspector(buildPreview(status, state?.settings.readingKey));
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

	const level = alertLevel(live.value, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true);
	const themeId = settings.theme !== undefined && settings.theme !== "" ? settings.theme : getDeckTheme();
	const accent = typeAccentsEnabled() ? classifyTypeAccent(reading.type, reading.unit, reading.label) : null;
	const badge = STAT_BADGE[mode];
	return renderReadingKey({
		label: keyLabel(settings.label, reading.label),
		valueText: formatValue(displayed.value, decimals),
		unitText: displayed.unit,
		statBadge: badge,
		// Poller-owned NATIVE ring: the renderer self-normalizes over the
		// samples' own min/max and °C→°F is a positive affine map, so native
		// values draw a pixel-identical sparkline to converted ones (and the
		// shape survives a unit toggle unchanged).
		history: settings.sparkline === true ? poller.getSeries(settings.readingKey) : undefined,
		palette: resolvePalette(loadThemes(), themeId, accent, level)
	});
}
