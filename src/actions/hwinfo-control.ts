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
import streamDeck, { action, SingletonAction, type KeyUpEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { dispatchDialCommand, isControlCommand } from "../commands";
import { parseResetScope } from "../controls";
import { registerDiagnostics } from "../diagnostics";
import { buildSupportReportPayload } from "../pi-protocol";
import { hashId, trace } from "../recorder";

/** Persisted settings (written by the PI; all optional). */
export type ControlActionSettings = {
	/** A ControlCommandId; unset or unknown shows the alert icon on press. */
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
	}

	override async onKeyUp(ev: KeyUpEvent<ControlActionSettings>): Promise<void> {
		const settings = ev.payload.settings;
		if (!isControlCommand(settings.command)) {
			await ev.action.showAlert();
			return;
		}
		const scope = parseResetScope(settings.resetScope);
		const command = {
			command: settings.command,
			// Settings are untyped JSON at runtime: a non-string target means
			// no target. The all-scope reset ignores the Target on purpose,
			// exactly as its settings panel says.
			target: settings.command === "resetStats" && scope === "all" ? "" : typeof settings.target === "string" ? settings.target.trim() : "",
			scope
		};
		const reached = dispatchDialCommand(command);
		// The target is user-typed text: hashed in the trace, like device ids.
		trace({ event: "controlCommand", context: ev.action.id, device: hashId(ev.action.device.id), note: `${command.command}->${command.target === "" ? "all" : "link:" + hashId(command.target)} reached=${reached}` });
		if (reached > 0) {
			await ev.action.showOk();
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
