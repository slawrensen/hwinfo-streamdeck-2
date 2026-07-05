import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { SensorDialAction } from "./actions/sensor-dial";
import { SensorReadingAction } from "./actions/sensor-reading";
import { initKoffi } from "./hwinfo/koffi-loader";
import { parsePollInterval, parseSourceMode, poller } from "./poller";
import { applyGlobalThemeSettings, decideLegacyDefault } from "./ui/theme-store";

/** Plugin-wide settings (written by the PI's "Advanced" and theme sections). */
type GlobalSettings = {
	pollIntervalMs?: string;
	source?: string;
	/** Deck-wide default theme id from themes.json. */
	theme?: string;
	/** "on" (default) | "off" — color accents by sensor type. */
	typeAccents?: string;
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

// Load the FFI runtime before anything can poll: on machines without a
// koffi binary (e.g. Windows-on-ARM) this records the failure so the poller
// shows the "unsupported" status screen instead of the process dying on a
// top-level import.
await initKoffi();

// The Stream Deck app reaps plugin processes through its job object, but if
// it ever dies without that teardown (hard crash), the poller's interval
// would keep this process alive — polling for nobody. Watch the parent and
// leave when it does. SDK 1.4.1 exposes no connection-close event, and the
// watchdog also covers closes the socket never sees. unref'd so the timer
// itself never holds the event loop open.
const parentPid = process.ppid;
const PARENT_CHECK_MS = Number(process.env.HWINFO_PARENT_CHECK_MS ?? "") || 30_000;
setInterval(() => {
	try {
		process.kill(parentPid, 0); // signal 0 = existence probe
	} catch {
		streamDeck.logger.info("Parent process gone — exiting.");
		process.exit(0);
	}
}, PARENT_CHECK_MS).unref();

streamDeck.actions.registerAction(new SensorReadingAction());
streamDeck.actions.registerAction(new SensorDialAction());

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
	poller.setIntervalMs(parsePollInterval(ev.settings.pollIntervalMs));
	poller.setSourceMode(parseSourceMode(ev.settings.source));
	applyGlobalThemeSettings(ev.settings);
});

await streamDeck.connect();

const globals = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
poller.setIntervalMs(parsePollInterval(globals.pollIntervalMs));
poller.setSourceMode(parseSourceMode(globals.source));
applyGlobalThemeSettings(globals);
// Pre-theme installs that already tweaked plugin-wide settings keep the old
// look (graphite); otherwise the first appearing action decides (see actions).
if (globals.theme === undefined && Object.values(globals).some((v) => v !== undefined)) {
	decideLegacyDefault(true);
}
