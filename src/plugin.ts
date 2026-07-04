import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { SensorReadingAction } from "./actions/sensor-reading";
import { parsePollInterval, poller } from "./poller";

/** Plugin-wide settings (written by the PI's "Advanced" section). */
type GlobalSettings = {
	pollIntervalMs?: string;
};

streamDeck.logger.setLevel(LogLevel.DEBUG);

streamDeck.actions.registerAction(new SensorReadingAction());

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	poller.setIntervalMs(parsePollInterval(ev.settings.pollIntervalMs));
});

await streamDeck.connect();

const globals = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
poller.setIntervalMs(parsePollInterval(globals.pollIntervalMs));
