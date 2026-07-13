/**
 * Dial command dispatch: the HWiNFO Control key action publishes commands
 * here and the Sensor Dial action registers the one handler that applies
 * them to its matching instances. A plain registration instead of an event
 * emitter keeps the return channel: the control key learns how many dials a
 * command actually reached, so it can show the ok tick or the alert icon.
 *
 * Commands are explicit (pause vs resume vs toggle) so a Multi Action can
 * be made idempotent, and the command carries its own target: the key that
 * sends it may sit on a different device (a pedal driving a deck's dials),
 * so the sender's physical device is never consulted.
 */
import type { ResetScope } from "./controls";

const CONTROL_COMMANDS = [
	"next",
	"prev",
	"nextGroup",
	"prevGroup",
	"cycleStat",
	"showCurrent",
	"showMin",
	"showMax",
	"showAvg",
	"pauseCycle",
	"resumeCycle",
	"toggleCycle",
	"pin",
	"unpin",
	"togglePin",
	"backToCurrent",
	"resetStats"
] as const;

export type ControlCommandId = (typeof CONTROL_COMMANDS)[number];

export function isControlCommand(raw: unknown): raw is ControlCommandId {
	return typeof raw === "string" && (CONTROL_COMMANDS as readonly string[]).includes(raw);
}

export type DialControlCommand = {
	readonly command: ControlCommandId;
	/** Empty string reaches every dial; otherwise only dials whose Link ID matches. */
	readonly target: string;
	/** Reset reach for resetStats; ignored by every other command. */
	readonly scope: ResetScope;
};

type Handler = (command: DialControlCommand) => number;

let handler: Handler | null = null;

/** The dial action class registers itself here once, at construction. */
export function registerDialCommandHandler(next: Handler): void {
	handler = next;
}

/** Returns how many dial instances the command was applied to. */
export function dispatchDialCommand(command: DialControlCommand): number {
	return handler === null ? 0 : handler(command);
}
