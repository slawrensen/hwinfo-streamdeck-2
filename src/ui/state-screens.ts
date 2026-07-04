/** Maps poller/selection states to key art and short dial texts. */
import type { PollerStatus } from "../poller";
import { truncateLabel } from "./format";
import type { StatusKeyOptions } from "./key-renderer";

const BLUE = "#4cc2ff";
const AMBER = "#f5a623";
const RED = "#ff5d52";

/**
 * Key art for a non-data state, or `null` when live data is available.
 * Stale counts as a problem state — the mission of these screens is to tell
 * the user exactly what to do next.
 */
export function statusScreen(status: PollerStatus): StatusKeyOptions | null {
	if (status.state === "ok") {
		return null;
	}
	if (status.state === "stale") {
		return status.source === "gadget"
			? { icon: "clock", accent: AMBER, lines: ["Not updating", "check HWiNFO", "Gadget report"] }
			: { icon: "clock", accent: AMBER, lines: ["Not updating", "check HWiNFO", "Shared Memory"] };
	}
	switch (status.reason) {
		case "not-running":
			return { icon: "power", accent: BLUE, lines: ["Start HWiNFO", "sensors app", "not detected"] };
		case "disabled":
			return { icon: "warning", accent: AMBER, lines: ["Shared Memory", "off — enable it", "in HWiNFO"] };
		case "access-denied":
			return { icon: "lock", accent: RED, lines: ["Access denied", "match privilege", "levels"] };
		case "unsupported-platform":
			return { icon: "warning", accent: RED, lines: ["Windows only"] };
		default:
			return { icon: "warning", accent: RED, lines: ["HWiNFO error", "data unreadable"] };
	}
}

export function noSelectionScreen(): StatusKeyOptions {
	return { icon: "target", accent: BLUE, lines: ["Pick a sensor", "in the key's", "settings"] };
}

export function missingReadingScreen(): StatusKeyOptions {
	return { icon: "question", accent: AMBER, lines: ["Sensor missing", "pick it again", "in settings"] };
}

/** Short two-line text for the Stream Deck + touchscreen. */
export function statusDialText(status: PollerStatus): { title: string; value: string } | null {
	if (status.state === "ok") {
		return null;
	}
	if (status.state === "stale") {
		return { title: "HWiNFO stalled", value: "check sharing" };
	}
	switch (status.reason) {
		case "not-running":
			return { title: "Start HWiNFO", value: "not detected" };
		case "disabled":
			return { title: "Shared Memory off", value: "enable in HWiNFO" };
		case "access-denied":
			return { title: "Access denied", value: "privilege mismatch" };
		case "unsupported-platform":
			return { title: "Windows only", value: "—" };
		default:
			return { title: "HWiNFO error", value: "unreadable" };
	}
}

/** Human sentence for PI hints. */
export function statusSentence(status: PollerStatus): string {
	if (status.state === "ok") {
		return status.source === "gadget" ? "Reading via HWiNFO's Gadget registry (current values only, no min/max/avg). Enable Shared Memory Support for full data — HWiNFO Pro keeps it on permanently." : "";
	}
	if (status.state === "stale") {
		return status.source === "gadget"
			? `HWiNFO's Gadget registry stopped changing ${Math.round(status.staleForMs / 1000)}s ago — check that HWiNFO is still running with Gadget reporting enabled.`
			: `HWiNFO stopped updating ${Math.round(status.staleForMs / 1000)}s ago — check that the Sensors window is open and Shared Memory Support is still enabled (the free version disables it after 12 hours).`;
	}
	switch (status.reason) {
		case "not-running":
			return "HWiNFO is not running, or it isn't publishing data. Start HWiNFO in Sensors-only mode with Shared Memory Support enabled — or, on the free version, enable Gadget reporting (no 12-hour limit) and tick the sensors you need.";
		case "disabled":
			return "HWiNFO reports Shared Memory Support as disabled. Re-enable it in HWiNFO Settings — on the free version it switches off after 12 hours.";
		case "access-denied":
			return "Windows denied access to HWiNFO's shared memory. Run HWiNFO and Stream Deck at the same privilege level.";
		case "unsupported-platform":
			return "HWiNFO is Windows-only; this plugin has nothing to read on this system.";
		default:
			return "HWiNFO's shared memory did not validate; it may be mid-restart or an incompatible version.";
	}
}

/** Compact label used on key faces; tighter when a stat badge shares the row. */
export function keyLabel(custom: string | undefined, fallback: string, maxLength = 16): string {
	const label = custom !== undefined && custom.trim() !== "" ? custom.trim() : fallback;
	return truncateLabel(label, maxLength);
}
