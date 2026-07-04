import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { SensorDialAction } from "./actions/sensor-dial";
import { SensorReadingAction } from "./actions/sensor-reading";
import { parsePollInterval, parseSourceMode, poller } from "./poller";

/** Plugin-wide settings (written by the PI's "Advanced" section). */
type GlobalSettings = {
	pollIntervalMs?: string;
	source?: string;
};

streamDeck.logger.setLevel(LogLevel.INFO);

// A monitoring widget should log-and-continue rather than die silently; every
// per-tick failure mode is already handled in the poller, so anything landing
// here is unexpected and worth a trace.
process.on("uncaughtException", (err) => {
	streamDeck.logger.error("Uncaught exception", err);
});
process.on("unhandledRejection", (reason) => {
	streamDeck.logger.error("Unhandled rejection", reason);
});

streamDeck.actions.registerAction(new SensorReadingAction());
streamDeck.actions.registerAction(new SensorDialAction());

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	poller.setIntervalMs(parsePollInterval(ev.settings.pollIntervalMs));
	poller.setSourceMode(parseSourceMode(ev.settings.source));
});

await streamDeck.connect();

const globals = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
poller.setIntervalMs(parsePollInterval(globals.pollIntervalMs));
poller.setSourceMode(parseSourceMode(globals.source));
