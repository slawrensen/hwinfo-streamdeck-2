/**
 * "Sensor Reading" key action — shows one live HWiNFO reading with optional
 * thresholds, stat modes and a sparkline. Pressing the key cycles the stat
 * mode (current → min → max → avg).
 */
import streamDeck, { action, SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { buildThemesPayload, handlePiRequest, pushPreviewToPi } from "../pi-protocol";
import { poller, type PollerStatus } from "../poller";
import type { Reading, SensorSnapshot } from "../hwinfo/types";
import { alertLevel, convertUnit, isStatMode, parseThreshold, STAT_BADGE, STAT_MODES, statValue, type AlertLevel, type DecimalsSetting, type StatMode } from "../ui/format";
import { computeGauge, drawnZones } from "../ui/gauge";
import { formatMeasurement, formatQuadMeasurement, type MeasureOptions } from "../ui/measure";
import { QUAD_DEFAULT_COLORS, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, renderTripleKey, type DrawnZone, type DualKeyRow, type QuadKeyCell, type TripleKeyRow } from "../ui/key-renderer";
import { keyLabel, missingReadingScreen, noSelectionScreen, statusScreen } from "../ui/state-screens";
import { appliedTextMode, DIM_SECONDARY_BLEND, DIM_VALUE_BLEND, mixToward, resolveTextColors, type TextColors, type TextSettings } from "../ui/text-colors";
import { decideLegacyDefault, effectiveTextFor, getDeckTheme, measureOptionsFrom, onThemeChange, typeAccentsEnabled } from "../ui/theme-store";
import { classifyTypeAccent, loadThemes, resolvePalette, type ThemesConfig, type TypeAccentKey } from "../ui/themes";

/** Persisted per-key settings (written by the PI; all optional). */
export type ReadingSettings = {
	readingKey?: string;
	label?: string;
	decimals?: DecimalsSetting;
	fahrenheit?: boolean;
	statMode?: StatMode;
	sparkline?: boolean;
	/**
	 * Single-layout display strip: "sparkline", "bar", "ring" or "none". A
	 * valid value wins; anything else (absent, junk, a newer version's
	 * future value) falls back to the legacy `sparkline` field, which is
	 * never rewritten, so pre-Display profiles keep their exact face.
	 */
	displayMode?: string;
	warnValue?: string;
	critValue?: string;
	alertBelow?: boolean;
	/** Per-key theme override; empty/absent follows the deck default. */
	theme?: string;
	/**
	 * Per-key Text setting (issue #2): "theme", "dim" or "custom"; anything
	 * else (absent, "", junk) follows the deck-wide Text default.
	 */
	textMode?: string;
	/** Custom text color (#RRGGBB); invalid values degrade to theme text. */
	textColor?: string;
	/** Custom mode: labels, units and stats at lower intensity. */
	textDimSecondary?: boolean;
	/**
	 * "dual" stacks a second readout under the first; "triple" shows three
	 * compact horizontal rows; "quad" splits the key into a 2x2 grid of up
	 * to four readouts; anything else (or too few usable readings for the
	 * marker) renders the unchanged single layout, so settings written by a
	 * newer version degrade safely after a rollback and old profiles are
	 * never migrated or rewritten.
	 */
	keyLayout?: string;
	/** The second row's reading; same stable identity as readingKey. */
	secondaryReadingKey?: string;
	secondaryLabel?: string;
	/** Fixed stat for the second row; the key press cycles only the first.
	 * Dual-only: the triple and quad layouts cycle every row together. */
	secondaryStatMode?: StatMode;
	/** Quad slots 3 and 4 (slots 1 and 2 reuse readingKey and
	 * secondaryReadingKey, so switching from dual keeps both sensors). The
	 * triple layout reuses slot 3 as its third row for the same reason. */
	quadReadingKey3?: string;
	quadReadingKey4?: string;
	/** Micro-labels for quad slots 3 and 4; label and secondaryLabel cover
	 * slots 1 and 2. Drawn only in the micro-label variant. quadLabel3 also
	 * serves as the triple layout's third-row label (full length there). */
	quadLabel3?: string;
	quadLabel4?: string;
	/** Quad variant: true draws micro-labels above plain values; the default
	 * (false) colors each value with its slot color instead. */
	quadLabels?: boolean;
	/** Per-slot identity colors, four #RRGGBB entries. Salvaged per entry:
	 * an invalid entry falls back to that slot's default alone. */
	quadColors?: string[];
};

type InstanceState = {
	settings: ReadingSettings;
	/** The reading key this instance is subscribed to in the poller's sparkline
	 *  store (undefined when nothing is selected). */
	subscribedKey: string | undefined;
	/** Last SVG sent — identical frames are skipped. */
	lastSvg: string;
};

/** Settings are untyped JSON at runtime: anything but a non-empty string
 *  degrades to unset (no selection, no second reading, or an unconfigured
 *  quad slot rendered as an empty quadrant, never an error). */
function nonEmptyStringOf(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

const QUAD_HEX = /^#[0-9A-Fa-f]{6}$/;

/** Per-entry salvage of the quad identity colors: each slot independently
 *  keeps a valid #RRGGBB override or falls back to that slot's default, so
 *  one hand-edited bad hex costs exactly one cell. */
function quadColorsOf(settings: ReadingSettings): readonly [string, string, string, string] {
	const raw: unknown = settings.quadColors;
	const entries: readonly unknown[] = Array.isArray(raw) ? raw : [];
	return QUAD_DEFAULT_COLORS.map((fallback, i) => {
		const entry = entries[i];
		return typeof entry === "string" && QUAD_HEX.test(entry) ? entry : fallback;
	}) as unknown as readonly [string, string, string, string];
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
			// Keep the open PI's "Deck default" chip and live preview truthful
			// in real time (theme, Text and Data units are all deck-wide).
			if (streamDeck.ui.action?.manifestId === this.manifestId) {
				void streamDeck.ui.sendToPropertyInspector(buildThemesPayload());
				pushPreviewToPi(poller.getStatus(), this.manifestId, this.instances, true);
			}
		});
	}

	override onWillAppear(ev: WillAppearEvent<ReadingSettings>): void {
		// Stream Deck can replay willAppear for a context without an intervening
		// willDisappear (reconnect, wake) — retain + subscribe only on the first
		// sighting, and carry the existing subscription across a replay so the
		// sparkline history (now owned by the poller) is never dropped.
		streamDeck.logger.debug(`Key appeared on ${ev.action.device.name}${ev.action.isKey() && ev.action.coordinates !== undefined ? ` at ${ev.action.coordinates.column},${ev.action.coordinates.row}` : ""} (${ev.action.id})`);
		const existing = this.instances.get(ev.action.id);
		const firstSighting = existing === undefined;
		if (firstSighting) {
			poller.retain();
		}
		decideLegacyDefault(Object.values(ev.payload.settings).some((v) => v !== undefined));
		const key = nonEmptyStringOf(ev.payload.settings.readingKey);
		let subscribedKey = existing?.subscribedKey;
		if (firstSighting) {
			if (key !== undefined) {
				poller.subscribeSeries(key);
			}
			subscribedKey = key;
		} else if (subscribedKey !== key) {
			// A replayed willAppear can carry settings that changed while the
			// action was out of sight — re-point the sparkline subscription
			// exactly like onDidReceiveSettings, or the ring for the new key
			// never fills and the sparkline goes permanently blank.
			if (subscribedKey !== undefined) {
				poller.unsubscribeSeries(subscribedKey);
			}
			if (key !== undefined) {
				poller.subscribeSeries(key);
			}
			subscribedKey = key;
		}
		this.instances.set(ev.action.id, {
			settings: ev.payload.settings,
			subscribedKey,
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
		const nextSub = nonEmptyStringOf(ev.payload.settings.readingKey);
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
		handlePiRequest(ev.payload);
	}

	private onPollerTick(status: PollerStatus): void {
		// The sparkline rings are filled by the poller now (once per fresh
		// snapshot, keyed by reading) so it survives this action's appear churn —
		// here we only render and feed the open PI's live preview.
		this.renderAll(status);
		pushPreviewToPi(status, this.manifestId, this.instances, true);
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
}

function compose(state: InstanceState, status: PollerStatus): string {
	const screen = statusScreen(status);
	if (screen !== null) {
		return renderStatusKey(screen);
	}
	const { snapshot } = status as Extract<PollerStatus, { state: "ok" }>;
	const settings = state.settings;
	const primaryKey = nonEmptyStringOf(settings.readingKey);
	if (primaryKey === undefined) {
		return renderStatusKey(noSelectionScreen());
	}
	// The dual layout needs BOTH the exact "dual" marker and a usable second
	// reading; every other combination (absent, junk, rolled-back settings)
	// falls through to the unchanged single path below.
	const secondaryKey = nonEmptyStringOf(settings.secondaryReadingKey);
	// The quad grid needs the exact "quad" marker plus at least two
	// resolvable slots; the primary above is slot 1, so one more of slots
	// 2-4 must parse. Junk slots simply don't render. With only the primary
	// left, the marker degrades along the dual rules (not "dual", and no
	// second reading either way) onto the unchanged single path below.
	if (settings.keyLayout === "quad") {
		const slotKeys = [primaryKey, secondaryKey, nonEmptyStringOf(settings.quadReadingKey3), nonEmptyStringOf(settings.quadReadingKey4)];
		if (slotKeys.filter((k) => k !== undefined).length >= 2) {
			return composeQuad(settings, snapshot, slotKeys);
		}
	}
	// The triple rows follow the quad's gate: the exact "triple" marker plus
	// at least two resolvable slots (an unconfigured slot renders an empty
	// band). With only the primary left, the marker degrades onto the
	// unchanged single path, exactly like dual and quad.
	if (settings.keyLayout === "triple") {
		const slotKeys = [primaryKey, secondaryKey, nonEmptyStringOf(settings.quadReadingKey3)];
		if (slotKeys.filter((k) => k !== undefined).length >= 2) {
			return composeTriple(settings, snapshot, slotKeys);
		}
	}
	if (settings.keyLayout === "dual" && secondaryKey !== undefined) {
		return composeDual(settings, snapshot, primaryKey, secondaryKey);
	}
	const reading = snapshot.byKey.get(primaryKey);
	if (reading === undefined) {
		return renderStatusKey(missingReadingScreen());
	}

	const fahrenheit = settings.fahrenheit === true;
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const measureOpts = measureOptionsFrom(settings);
	const measured = formatMeasurement(statValue(reading, mode), reading.unit, measureOpts);

	const config = loadThemes();
	const { level, themeId, accent } = primaryContext(settings, reading, fahrenheit);
	const palette = resolvePalette(config, themeId, accent, level);
	const text = resolveTextColors(palette, effectiveTextFor(settings), level);
	const display = displayModeOf(settings);
	const badge = STAT_BADGE[mode];
	return renderReadingKey({
		label: keyLabel(settings.label, reading.label),
		valueText: measured.valueText,
		unitText: measured.unitText,
		statBadge: badge,
		// Poller-owned NATIVE ring: the renderer self-normalizes over the
		// samples' own min/max and °C→°F is a positive affine map, so native
		// values draw a pixel-identical sparkline to converted ones (and the
		// shape survives a unit toggle unchanged).
		history: display === "sparkline" ? poller.getSeries(primaryKey) : undefined,
		gauge: display === "bar" || display === "ring" ? { kind: display, ...keyGauge(settings, reading, fahrenheit, config, palette.bg) } : undefined,
		palette,
		text
	});
}

/** The effective single-layout display strip; see ReadingSettings.displayMode. */
function displayModeOf(settings: ReadingSettings): "sparkline" | "bar" | "ring" | "none" {
	const mode = settings.displayMode;
	if (mode === "sparkline" || mode === "bar" || mode === "ring" || mode === "none") {
		return mode;
	}
	return settings.sparkline === true ? "sparkline" : "none";
}

/**
 * The Bar/Ring gauge for a single-reading key. Bounds are automatic: percent
 * and yes/no readings get their fixed domains; everything else derives from
 * values actually visited — HWiNFO's own session min/max where trustworthy
 * (the gadget source reports min = max = value, which the union neutralizes)
 * plus the poller's observed series — expanded to keep threshold zones
 * inside the visible domain. The fill follows the LIVE value even while the
 * text shows MIN/MAX/AVG, matching the dial bar and alert behavior.
 */
function keyGauge(settings: ReadingSettings, reading: Reading, fahrenheit: boolean, config: ThemesConfig, faceBg: string): { fraction: number; zones: DrawnZone[] } {
	const display = (value: number): number => convertUnit(value, reading.unit, fahrenheit).value;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const candidate of [reading.valueMin, reading.valueMax, ...(poller.getSeries(reading.key) ?? [])]) {
		if (Number.isFinite(candidate)) {
			min = Math.min(min, candidate);
			max = Math.max(max, candidate);
		}
	}
	const gauge = computeGauge({
		value: display(reading.value),
		evidence: Number.isFinite(min) && Number.isFinite(max) ? { min: display(min), max: display(max) } : undefined,
		unit: reading.unit === "°C" && fahrenheit ? "°F" : reading.unit,
		warn: parseThreshold(settings.warnValue),
		crit: parseThreshold(settings.critValue),
		alertBelow: settings.alertBelow === true
	});
	return { fraction: gauge.fraction, zones: drawnZones(gauge.zones, config.alerts, faceBg) };
}

/** Alert level, theme override and type accent for a key face; all three
 *  follow the primary (first) reading, whatever the layout. */
function primaryContext(settings: ReadingSettings, primary: Reading | undefined, fahrenheit: boolean): { level: AlertLevel; themeId: string; accent: TypeAccentKey | null } {
	const level =
		primary !== undefined
			? alertLevel(convertUnit(primary.value, primary.unit, fahrenheit).value, parseThreshold(settings.warnValue), parseThreshold(settings.critValue), settings.alertBelow === true)
			: "normal";
	const themeId = settings.theme !== undefined && settings.theme !== "" ? settings.theme : getDeckTheme();
	const accent = primary !== undefined && typeAccentsEnabled() ? classifyTypeAccent(primary.type, primary.unit, primary.label) : null;
	return { level, themeId, accent };
}

/**
 * The dual face. Alerts and the type accent come from the FIRST reading only
 * (per-second-row thresholds are deliberately out of scope), and the whole
 * key recolors on alert exactly like the single layout. A row whose reading
 * the snapshot does not publish renders the placeholder glyph instead of
 * tearing down the other, still-live row; both missing is the same
 * "Sensor missing" screen the single layout shows.
 *
 * Stat display: the second row FOLLOWS the first's stat mode unless
 * "Second shows" pins it (so the key press cycles both rows together by
 * default, like the dial's tap switches its whole face). When both rows
 * show the same stat, ONE badge sits centered in the divider gap and the
 * labels keep their full width; only rows whose stat differs carry their
 * own badge, inline after the unit.
 */
function composeDual(settings: ReadingSettings, snapshot: SensorSnapshot, primaryKey: string, secondaryKey: string): string {
	const primary = snapshot.byKey.get(primaryKey);
	const secondary = snapshot.byKey.get(secondaryKey);
	if (primary === undefined && secondary === undefined) {
		return renderStatusKey(missingReadingScreen());
	}
	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const { level, themeId, accent } = primaryContext(settings, primary, fahrenheit);
	const palette = resolvePalette(loadThemes(), themeId, accent, level);
	const topMode = isStatMode(settings.statMode) ? settings.statMode : "current";
	// Absent, "follow", or junk all follow the first row (append-only
	// salvage); only an explicit stat mode pins the second row.
	const bottomMode = isStatMode(settings.secondaryStatMode) ? settings.secondaryStatMode : topMode;
	const shared = topMode === bottomMode;
	return renderDualKey({
		top: dualRow(primary, settings.label, topMode, shared, measureOpts),
		bottom: dualRow(secondary, settings.secondaryLabel, bottomMode, shared, measureOpts),
		sharedBadge: shared ? STAT_BADGE[topMode] : "",
		palette,
		text: resolveTextColors(palette, effectiveTextFor(settings), level)
	});
}

/**
 * The triple face: three compact horizontal rows over the first, second and
 * third sensor slots (the same slots the dual and quad layouts read, so
 * switching layouts keeps every selection). Alerts and the type accent come
 * from the FIRST reading only and the whole key recolors on alert, exactly
 * like the other multi-reading layouts. A configured row the snapshot does
 * not publish renders the placeholder glyph; an unconfigured slot renders an
 * empty band; every configured row missing is the same "Sensor missing"
 * screen. Every row shows the same stat (statMode; the key press cycles all
 * rows together), badged once on the first separator. Values format through
 * the normal measurement path — the rows have room for full values, so the
 * quad's 4-glyph compaction would only cost precision.
 */
function composeTriple(settings: ReadingSettings, snapshot: SensorSnapshot, slotKeys: ReadonlyArray<string | undefined>): string {
	const readings = slotKeys.map((key) => (key === undefined ? undefined : snapshot.byKey.get(key)));
	if (readings.every((r) => r === undefined)) {
		return renderStatusKey(missingReadingScreen());
	}
	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const { level, themeId, accent } = primaryContext(settings, readings[0], fahrenheit);
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const palette = resolvePalette(loadThemes(), themeId, accent, level);
	const customLabels = [settings.label, settings.secondaryLabel, settings.quadLabel3];
	return renderTripleKey({
		rows: slotKeys.map((key, i) => (key === undefined ? null : tripleRow(readings[i], customLabels[i], mode, measureOpts))),
		sharedBadge: STAT_BADGE[mode],
		palette,
		text: resolveTextColors(palette, effectiveTextFor(settings), level)
	});
}

function tripleRow(reading: Reading | undefined, customLabel: string | undefined, mode: StatMode, measureOpts: MeasureOptions): TripleKeyRow {
	if (reading === undefined) {
		// The one permitted em dash: the key face's "no value" placeholder.
		return { label: keyLabel(customLabel, "Sensor missing"), valueText: "—", unitText: "" };
	}
	const measured = formatMeasurement(statValue(reading, mode), reading.unit, measureOpts);
	return { label: keyLabel(customLabel, reading.label), valueText: measured.valueText, unitText: measured.unitText };
}

/**
 * The quad face: up to four readouts in a 2x2 grid. Alerts and the type
 * accent come from the FIRST reading only, exactly like the dual layout,
 * and on warn/crit the whole key takes the global alert palette with the
 * slot identity colors ignored, so the alert recolor stays unmistakable.
 * A configured slot the snapshot does not publish renders the placeholder
 * glyph; an unconfigured (or junk) slot renders an empty quadrant; every
 * configured slot missing is the same "Sensor missing" screen.
 *
 * Every slot shows the same stat (statMode; the key press cycles it),
 * badged once at the cross intersection. Per-slot pins are dual-only.
 */
function composeQuad(settings: ReadingSettings, snapshot: SensorSnapshot, slotKeys: ReadonlyArray<string | undefined>): string {
	const readings = slotKeys.map((key) => (key === undefined ? undefined : snapshot.byKey.get(key)));
	if (readings.every((r) => r === undefined)) {
		return renderStatusKey(missingReadingScreen());
	}
	const fahrenheit = settings.fahrenheit === true;
	const measureOpts = measureOptionsFrom(settings);
	const primary = readings[0];
	const { level, themeId, accent } = primaryContext(settings, primary, fahrenheit);
	const mode = isStatMode(settings.statMode) ? settings.statMode : "current";
	const labeled = settings.quadLabels === true;
	const palette = resolvePalette(loadThemes(), themeId, accent, level);
	const textSettings = effectiveTextFor(settings);
	const text = resolveTextColors(palette, textSettings, level);
	// On alert the identity color collapses into the alert palette's own
	// text token (the value in the default variant, the micro-label in the
	// labeled one): the whole key is alert-colored, nothing else survives.
	const alertColor = level !== "normal" ? (labeled ? palette.label : palette.value) : null;
	const colors = quadColorsOf(settings);
	const customLabels = [settings.label, settings.secondaryLabel, settings.quadLabel3, settings.quadLabel4];
	return renderQuadKey({
		cells: slotKeys.map((key, i) => (key === undefined ? null : quadCell(readings[i], customLabels[i], labeled, mode, measureOpts, alertColor ?? quadSlotColor(colors[i] as string, labeled, textSettings, text, palette)))),
		labels: labeled,
		sharedBadge: STAT_BADGE[mode],
		palette,
		text
	});
}

/**
 * A quad slot's identity color under the effective Text setting. The slot
 * colors are textual (the value glyphs, or the micro-label), so Custom
 * governs them too: the exact color for values, the secondary shade for
 * micro-labels. Dim lowers the identity hues themselves; Theme keeps them.
 */
function quadSlotColor(identity: string, labeled: boolean, settings: TextSettings, text: TextColors, palette: { bg: string }): string {
	const mode = appliedTextMode(settings);
	if (mode === "custom") {
		return labeled ? text.label : text.value;
	}
	if (mode === "dim") {
		return mixToward(identity, palette.bg, labeled ? DIM_SECONDARY_BLEND : DIM_VALUE_BLEND);
	}
	return identity;
}

function quadCell(reading: Reading | undefined, customLabel: string | undefined, labeled: boolean, mode: StatMode, measureOpts: MeasureOptions, color: string): QuadKeyCell {
	// The micro-label falls back to the reading label's first word; the
	// renderer hard-cuts to 4 code points and uppercases either source.
	const fallbackLabel = reading === undefined ? "" : (reading.label.split(" ")[0] ?? "");
	const label = labeled ? keyLabel(customLabel, fallbackLabel) : "";
	if (reading === undefined) {
		// The one permitted em dash: the key face's "no value" placeholder.
		return { label, valueText: "—", unitText: "", color };
	}
	const measured = formatQuadMeasurement(statValue(reading, mode), reading.unit, measureOpts);
	return { label, valueText: measured.valueText, unitText: measured.unitText, color };
}

function dualRow(reading: Reading | undefined, customLabel: string | undefined, mode: StatMode, shared: boolean, measureOpts: MeasureOptions): DualKeyRow {
	if (reading === undefined) {
		// The one permitted em dash: the key face's "no value" placeholder.
		return { label: keyLabel(customLabel, "Sensor missing"), valueText: "—", unitText: "", statBadge: "" };
	}
	const measured = formatMeasurement(statValue(reading, mode), reading.unit, measureOpts);
	return {
		label: keyLabel(customLabel, reading.label),
		valueText: measured.valueText,
		unitText: measured.unitText,
		statBadge: shared ? "" : STAT_BADGE[mode]
	};
}
