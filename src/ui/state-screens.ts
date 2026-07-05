/** Maps poller/selection states to key art and short dial texts. */
import type { PollerStatus } from "../poller";
import type { StatusKeyOptions } from "./key-renderer";

const BLUE = "#4cc2ff";
const AMBER = "#f5a623";
const RED = "#ff5d52";

/**
 * Key art for a non-data state, or `null` when live data is available.
 * Stale counts as a problem state; the mission of these screens is to tell
 * the user exactly what to do next.
 */
export function statusScreen(status: PollerStatus): StatusKeyOptions | null {
	if (status.state === "ok") {
		return null;
	}
	if (status.state === "stale") {
		// Sub-line matches the source in use (like the dial text + PI hint).
		return status.source === "gadget"
			? { icon: "clock", accent: AMBER, lines: ["Not updating", "check Gadget"] }
			: { icon: "clock", accent: AMBER, lines: ["Not updating", "check sharing"] };
	}
	switch (status.reason) {
		case "not-running":
			return { icon: "power", accent: BLUE, lines: ["Start HWiNFO", "not detected"] };
		case "gadget-empty":
			return { icon: "target", accent: AMBER, lines: ["Tick sensors", "in Gadget"] };
		case "disabled":
			return { icon: "warning", accent: AMBER, lines: ["Shared Memory", "is off"] };
		case "access-denied":
			return { icon: "lock", accent: RED, lines: ["Access denied", "un-elevate"] };
		case "unsupported-platform":
			return { icon: "warning", accent: RED, lines: ["Needs x64", "Windows"] };
		default:
			return { icon: "warning", accent: RED, lines: ["HWiNFO error", "restart HWiNFO"] };
	}
}

export function noSelectionScreen(): StatusKeyOptions {
	return { icon: "target", accent: BLUE, lines: ["Pick a sensor", "in settings"] };
}

export function missingReadingScreen(): StatusKeyOptions {
	return { icon: "question", accent: AMBER, lines: ["Sensor missing", "pick again"] };
}

/** Short two-line text for the Stream Deck + touchscreen. */
export function statusDialText(status: PollerStatus): { title: string; value: string } | null {
	if (status.state === "ok") {
		return null;
	}
	if (status.state === "stale") {
		// Match the recovery hint to the source in use, like statusScreen and
		// statusSentence do; a gadget-source dial must not be told to check
		// Shared Memory sharing that isn't even the source it's reading from.
		return status.source === "gadget" ? { title: "HWiNFO stalled", value: "check Gadget" } : { title: "HWiNFO stalled", value: "check sharing" };
	}
	switch (status.reason) {
		case "not-running":
			return { title: "Start HWiNFO", value: "not detected" };
		case "gadget-empty":
			return { title: "Gadget empty", value: "tick sensors" };
		case "disabled":
			return { title: "Shared Memory off", value: "enable in HWiNFO" };
		case "access-denied":
			return { title: "Access denied", value: "un-elevate HWiNFO" };
		case "unsupported-platform":
			return { title: "Needs x64 Windows", value: "—" };
		default:
			return { title: "HWiNFO error", value: "restart HWiNFO" };
	}
}

/** Human sentence for PI hints. */
export function statusSentence(status: PollerStatus): string {
	if (status.state === "ok") {
		return status.source === "gadget" ? "Reading via HWiNFO's Gadget registry (current values only, no min/max/avg). Enable Shared Memory Support for full data; HWiNFO Pro keeps it on permanently." : "";
	}
	if (status.state === "stale") {
		return status.source === "gadget"
			? `HWiNFO's Gadget registry stopped changing ${Math.round(status.staleForMs / 1000)}s ago. Check that HWiNFO is still running with Gadget reporting enabled.`
			: `HWiNFO stopped updating ${Math.round(status.staleForMs / 1000)}s ago. Check that the Sensors window is open and Shared Memory Support is still enabled.`;
	}
	switch (status.reason) {
		case "not-running":
			return "HWiNFO is not running, or it isn't publishing data. Start HWiNFO in Sensors-only mode with Shared Memory Support enabled, or enable Gadget reporting on the free version (no 12-hour limit) and tick the sensors you need.";
		case "gadget-empty":
			return "HWiNFO's Gadget registry is enabled but empty. In the HWiNFO sensor window, right-click each value you want on the deck and tick \"Report value in Gadget\".";
		case "disabled":
			return "HWiNFO reports Shared Memory Support as disabled. Re-enable it in HWiNFO Settings; the free version switches it off after 12 hours.";
		case "access-denied":
			return "Windows denied access to HWiNFO's shared memory: HWiNFO is running elevated (\"Run as administrator\") while Stream Deck is not. Restart HWiNFO without elevation, or run both elevated. On the free version, Gadget reporting also works across privilege levels.";
		case "unsupported-platform":
			return "This plugin needs 64-bit (x64) Windows: HWiNFO's interfaces aren't readable on this system (macOS and Windows-on-ARM are unsupported).";
		default:
			return "HWiNFO's shared memory did not validate; it may be mid-restart or an incompatible version. Usually clears on the next poll; if it persists, restart HWiNFO.";
	}
}

/** Effective key label; spec truncation happens inside the renderer. */
export function keyLabel(custom: string | undefined, fallback: string): string {
	return custom !== undefined && custom.trim() !== "" ? custom.trim() : fallback;
}
