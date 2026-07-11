/**
 * Local hardware event recorder, for development and support diagnostics.
 *
 * Off by default. HWINFO_TRACE_EVENTS=1 appends redacted JSON lines to
 * logs/trace-<pid>.jsonl next to the plugin's normal logs; nothing ever
 * leaves the machine. Independent of the file switch, a small in-memory
 * ring of the most recent events feeds the support report's "last input"
 * section.
 *
 * Redaction rules (locked by test/diagnostics.test.ts):
 *  - device IDs are hashed (sha256, 12 hex chars), names are never recorded
 *  - no sensor values, no reading labels, no computer names, no user paths
 *  - reading identity appears only as HWiNFO's opaque id triplet
 *
 * The field names double as the replay fixture format in test/traces/, so a
 * capture from real hardware can replace a synthetic trace verbatim.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type TraceEvent = {
	/** Wall-clock epoch ms and monotonic ms, stamped at capture. */
	wall?: number;
	mono?: number;
	/** SDK event or lifecycle name: dialRotate, touchTap, willAppear, render... */
	event: string;
	/** Hashed device identifier. */
	device?: string;
	deviceType?: number;
	grid?: string;
	context?: string;
	controller?: string;
	ticks?: number;
	pressed?: boolean;
	hold?: boolean;
	tapX?: number;
	tapY?: number;
	/** Gesture-machine state before/after, compact ("idle", "down@123"...). */
	gestureBefore?: string;
	gestureAfter?: string;
	/** Selected reading identity before/after, hashed (gadget keys carry names). */
	selectionBefore?: string;
	selectionAfter?: string;
	/** Render timing, monotonic ms. */
	renderQueuedAt?: number;
	renderDoneAt?: number;
	note?: string;
};

const RING_SIZE = 24;
const ring: TraceEvent[] = [];
const enabled = process.env.HWINFO_TRACE_EVENTS === "1";
let tracePath: string | null = null;
let writeFailed = false;

/**
 * Short stable hash for identifiers that must not appear in traces or the
 * support report as plain text: device IDs, reading identities (the gadget
 * provider embeds HWiNFO sensor and reading names in its keys), link IDs.
 * Stable, so correlation across events still works.
 */
export function hashId(id: string): string {
	return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

/** Compact one-line form of a gesture state for the trace. */
export function describeGestureState(state: { downAt: number | null; rotatedWhileDown: boolean }): string {
	if (state.downAt === null) {
		return "idle";
	}
	return `down@${Math.round(state.downAt)}${state.rotatedWhileDown ? "+rotated" : ""}`;
}

export function trace(event: TraceEvent): void {
	const stamped: TraceEvent = { wall: Date.now(), mono: Math.round(performance.now() * 1000) / 1000, ...event };
	ring.push(stamped);
	if (ring.length > RING_SIZE) {
		ring.shift();
	}
	if (!enabled || writeFailed) {
		return;
	}
	try {
		if (tracePath === null) {
			mkdirSync("logs", { recursive: true });
			tracePath = join("logs", `trace-${process.pid}.jsonl`);
		}
		appendFileSync(tracePath, `${JSON.stringify(stamped)}\n`);
	} catch (err) {
		// One warning, then stop trying: tracing must never hurt the plugin.
		writeFailed = true;
		console.error("event trace disabled (write failed)", err);
	}
}

/** The most recent events, oldest first, for the support report. */
export function recentEvents(): readonly TraceEvent[] {
	return ring;
}

export function traceEnabled(): boolean {
	return enabled;
}
