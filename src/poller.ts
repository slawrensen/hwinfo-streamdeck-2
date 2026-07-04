/**
 * The single shared HWiNFO poller. Actions retain/release it as they appear
 * and disappear; it opens ONE shared-memory session regardless of how many
 * keys and dials are visible, and fans out a status on every tick.
 *
 * State machine:
 *   ok ──(pollTime frozen > 15 s)──▶ stale ──(mapping gone)──▶ unavailable
 *    ▲                                 │ (probe re-open every 5 s)
 *    └────────(pollTime advances)──────┘
 * `unavailable` re-attempts a full open every tick (cheap: one failing
 * OpenFileMappingW), so recovery is automatic when HWiNFO comes back.
 */
import streamDeck from "@elgato/streamdeck";
import { EventEmitter } from "node:events";

import { parseSnapshot } from "./hwinfo/reader";
import { SharedMemorySession } from "./hwinfo/shared-memory";
import { HwinfoError, type HwinfoUnavailableReason, type SensorSnapshot } from "./hwinfo/types";

export type PollerStatus =
	| { state: "ok"; snapshot: SensorSnapshot }
	| { state: "stale"; snapshot: SensorSnapshot; staleForMs: number }
	| { state: "unavailable"; reason: HwinfoUnavailableReason; message: string };

export const DEFAULT_INTERVAL_MS = 1000;
const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 60_000;
// Both timings are env-overridable so the resilience e2e can force the
// stale/unavailable transitions in seconds instead of minutes.
/** pollTime frozen for longer than this ⇒ HWiNFO stopped sharing. */
const STALE_AFTER_MS = Number(process.env.HWINFO_STALE_AFTER_MS ?? "") || 15_000;
/** While stale, probe a fresh mapping open at most this often. */
const REOPEN_PROBE_MS = Number(process.env.HWINFO_REOPEN_PROBE_MS ?? "") || 5_000;

export function parsePollInterval(raw: unknown): number {
	const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
	if (!Number.isFinite(n)) {
		return DEFAULT_INTERVAL_MS;
	}
	return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

class HwinfoPoller extends EventEmitter {
	private readonly logger = streamDeck.logger.createScope("HwinfoPoller");
	private session: SharedMemorySession | null = null;
	private timer: NodeJS.Timeout | null = null;
	private refs = 0;
	private intervalMs = DEFAULT_INTERVAL_MS;
	private lastPollTime = -1;
	private lastAdvanceAt = 0;
	private lastReopenProbeAt = 0;
	private status: PollerStatus = { state: "unavailable", reason: "not-running", message: "Not polled yet." };

	/** Latest status; safe to read at any time (e.g. right after willAppear). */
	getStatus(): PollerStatus {
		return this.status;
	}

	onTick(listener: (status: PollerStatus) => void): void {
		this.on("tick", listener);
	}

	/** Called by actions on willAppear. Starts polling with the first retain. */
	retain(): void {
		this.refs++;
		if (this.refs === 1) {
			this.start();
		}
	}

	/** Called by actions on willDisappear. Stops polling with the last release. */
	release(): void {
		this.refs = Math.max(0, this.refs - 1);
		if (this.refs === 0) {
			this.stop();
		}
	}

	setIntervalMs(ms: number): void {
		if (ms === this.intervalMs) {
			return;
		}
		this.intervalMs = ms;
		this.logger.info(`Poll interval set to ${ms} ms`);
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = setInterval(() => this.tick(), this.intervalMs);
		}
	}

	private start(): void {
		if (this.timer !== null) {
			return;
		}
		this.logger.debug("Starting");
		this.timer = setInterval(() => this.tick(), this.intervalMs);
		this.tick();
	}

	private stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.dropSession();
		this.logger.debug("Stopped (no visible actions)");
	}

	private dropSession(): void {
		this.session?.close();
		this.session = null;
		this.lastPollTime = -1;
	}

	private tick(): void {
		try {
			if (this.session === null) {
				this.session = SharedMemorySession.open();
				this.lastAdvanceAt = Date.now();
				this.logger.info("Opened HWiNFO shared memory");
			}
			const buf = this.session.read();
			let snapshot: SensorSnapshot | null = null;
			if (buf !== null) {
				snapshot = parseSnapshot(buf);
				if (snapshot.pollTime !== this.lastPollTime) {
					this.lastPollTime = snapshot.pollTime;
					this.lastAdvanceAt = Date.now();
				}
			}
			// Freshness is judged even when the mutex was busy (buf === null) —
			// a consumer wedged on the mutex must not freeze us at "ok" forever.
			const staleForMs = Date.now() - this.lastAdvanceAt;
			if (staleForMs > STALE_AFTER_MS) {
				// The mapping content is frozen. If HWiNFO exited we would never
				// notice through our held handle — probe a fresh open.
				this.probeReopen();
				const last = snapshot ?? (this.status.state !== "unavailable" ? this.status.snapshot : null);
				if (last !== null) {
					this.status = { state: "stale", snapshot: last, staleForMs };
				}
			} else if (snapshot !== null) {
				this.status = { state: "ok", snapshot };
			}
			// Otherwise (mutex busy, still fresh): keep the previous status this tick.
		} catch (err) {
			this.dropSession();
			if (err instanceof HwinfoError) {
				if (this.status.state !== "unavailable" || this.status.reason !== err.reason) {
					this.logger.warn(`HWiNFO unavailable [${err.reason}]: ${err.message}`);
				}
				this.status = { state: "unavailable", reason: err.reason, message: err.message };
			} else {
				this.logger.error("Unexpected poll failure", err);
				this.status = { state: "unavailable", reason: "invalid", message: String(err) };
			}
		}
		this.emit("tick", this.status);
	}

	/** While stale: swap to a freshly opened session (throws when HWiNFO is gone). */
	private probeReopen(): void {
		const now = Date.now();
		if (now - this.lastReopenProbeAt < REOPEN_PROBE_MS) {
			return;
		}
		this.lastReopenProbeAt = now;
		// Release our handles FIRST: a named section stays alive while any handle
		// references it — including ours — so probing before closing would succeed
		// even after HWiNFO died, making the stale→unavailable edge unreachable.
		this.session?.close();
		this.session = null;
		this.session = SharedMemorySession.open(); // HwinfoError propagates to tick()
	}
}

export const poller = new HwinfoPoller();
