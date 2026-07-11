/**
 * "HWiNFO Control" key action — a plain key, pedal, G-key or Multi Action
 * step that remote-controls Sensor Dials: switch readings or sensors, set
 * the displayed stat, pause/resume the auto cycle, pin, reset session stats.
 *
 * Targeting is explicit: every dial, or only dials whose Link ID matches
 * the key's Target field. The key's own physical device is never consulted,
 * so a pedal or a headless controller can drive dials on a different deck.
 * Commands fire on key UP, once per press (Multi Action safe), and the
 * explicit pause/resume/pin/unpin variants are idempotent under repeats.
 * The destructive all-dials stats reset exists only as an explicit scope
 * choice in this action's settings, never as a default.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import streamDeck, { action, SingletonAction, type KeyAction, type KeyUpEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { dispatchDialCommand, isControlCommand } from "../commands";
import { parseResetScope } from "../controls";
import { registerDiagnostics } from "../diagnostics";
import { buildSupportReportPayload } from "../pi-protocol";
import { hashId, trace } from "../recorder";

/**
 * Success feedback image: the key's own icon with a small tick badge in the
 * corner, shown briefly instead of the Stream Deck's full-key green checkmark
 * (which blankets the icon and matches nothing else this plugin renders).
 * The icon file resolves like themes.json does, relative to this module:
 * the bundle sits at <plugin>/bin/plugin.js with imgs/ one level up; under
 * tsx this module is at src/actions/ inside the repo.
 */
const ICON_CANDIDATES = ["../imgs/actions/control/key.svg", "../../com.lawrensen.hwinfo.sdPlugin/imgs/actions/control/key.svg"];

function buildSuccessImage(): string | undefined {
	const here = dirname(fileURLToPath(import.meta.url));
	for (const candidate of ICON_CANDIDATES) {
		try {
			const base = readFileSync(join(here, candidate), "utf8");
			const svg =
				`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">` +
				`<image href="data:image/svg+xml;base64,${Buffer.from(base, "utf8").toString("base64")}" width="72" height="72"/>` +
				`<circle cx="59" cy="59" r="9" fill="#1E2228" stroke="#667082" stroke-width="1"/>` +
				`<path d="M 54.5 59 L 58 62.5 L 64 55.5" fill="none" stroke="#E8EAED" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
				`</svg>`;
			return `data:image/svg+xml,${encodeURIComponent(svg)}`;
		} catch {
			// try the next candidate
		}
	}
	return undefined;
}

const SUCCESS_IMAGE = buildSuccessImage();
const SUCCESS_BADGE_MS = 700;

/** Persisted settings (written by the PI; all optional). */
export type ControlActionSettings = {
	/**
	 * A ControlCommandId. Unset means "next": the PI's select displays
	 * "Next reading" before the user ever touches it, and a never-configured
	 * key must do what its panel shows. Unknown values show the alert icon.
	 */
	command?: string;
	/** Empty targets every dial; otherwise only dials with this Link ID. */
	target?: string;
	/** Reach of resetStats: "current" (default), "set" or "all". */
	resetScope?: string;
};

@action({ UUID: "com.lawrensen.hwinfo.control" })
export class HwinfoControlAction extends SingletonAction<ControlActionSettings> {
	/** By context id: Stream Deck can replay willAppear without a disappear. */
	private readonly visible = new Set<string>();
	/** Pending badge reverts by context id, so repeats re-arm cleanly. */
	private readonly badgeTimers = new Map<string, NodeJS.Timeout>();

	constructor() {
		super();
		registerDiagnostics("control", () => ({ visibleKeys: this.visible.size }));
	}

	override onWillAppear(ev: WillAppearEvent<ControlActionSettings>): void {
		this.visible.add(ev.action.id);
		streamDeck.logger.debug(`Control key appeared on ${ev.action.device.name} (${ev.action.id})`);
	}

	override onWillDisappear(ev: WillDisappearEvent<ControlActionSettings>): void {
		this.visible.delete(ev.action.id);
		const timer = this.badgeTimers.get(ev.action.id);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.badgeTimers.delete(ev.action.id);
		}
	}

	/**
	 * Non-blocking success feedback: the key's own icon with a corner tick
	 * for a moment, never the stock full-key checkmark. Falls back to the
	 * stock tick only if the icon asset could not be read.
	 */
	private showSuccess(keyAction: KeyAction<ControlActionSettings>): void {
		if (SUCCESS_IMAGE === undefined) {
			void keyAction.showOk();
			return;
		}
		const previous = this.badgeTimers.get(keyAction.id);
		if (previous !== undefined) {
			clearTimeout(previous);
		}
		void keyAction.setImage(SUCCESS_IMAGE);
		this.badgeTimers.set(
			keyAction.id,
			setTimeout(() => {
				this.badgeTimers.delete(keyAction.id);
				// No argument restores the manifest image.
				void keyAction.setImage();
			}, SUCCESS_BADGE_MS)
		);
	}

	override async onKeyUp(ev: KeyUpEvent<ControlActionSettings>): Promise<void> {
		const settings = ev.payload.settings;
		// Honor the panel: its Command select shows "Next reading" until the
		// user picks something, so an unset command is "next", not an error.
		const commandId = settings.command === undefined ? "next" : settings.command;
		if (!isControlCommand(commandId)) {
			await ev.action.showAlert();
			return;
		}
		const scope = parseResetScope(settings.resetScope);
		const command = {
			command: commandId,
			// Settings are untyped JSON at runtime: a non-string target means
			// no target. The all-scope reset ignores the Target on purpose,
			// exactly as its settings panel says.
			target: commandId === "resetStats" && scope === "all" ? "" : typeof settings.target === "string" ? settings.target.trim() : "",
			scope
		};
		const reached = dispatchDialCommand(command);
		// The target is user-typed text: hashed in the trace, like device ids.
		trace({ event: "controlCommand", context: ev.action.id, device: hashId(ev.action.device.id), note: `${command.command}->${command.target === "" ? "all" : "link:" + hashId(command.target)} reached=${reached}` });
		if (reached > 0) {
			this.showSuccess(ev.action);
		} else {
			await ev.action.showAlert();
		}
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, ControlActionSettings>): void {
		const payload = ev.payload;
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			return;
		}
		if (payload.event === "getSupportReport") {
			void streamDeck.ui.sendToPropertyInspector(buildSupportReportPayload());
		}
	}
}
