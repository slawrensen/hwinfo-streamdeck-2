/**
 * The single shared HWiNFO poller. Actions retain/release it as they appear
 * and disappear; it opens ONE data source regardless of how many keys and
 * dials are visible, and fans out a status on every tick.
 *
 * Sources (see provider.ts): shared memory is preferred; in "auto" mode the
 * Gadget registry is the fallback (free HWiNFO disables shared memory after
 * 12 h — gadget reporting never expires), with periodic probes to upgrade
 * back to shared memory when it returns.
 *
 * State machine:
 *   ok ──(pollTime frozen > 15 s)──▶ stale ──(backend gone)──▶ unavailable
 *    ▲                                 │ (probe re-open every 5 s)
 *    └────────(pollTime advances)──────┘
 * `unavailable` re-attempts a full open every tick (cheap: one failing
 * OpenFileMappingW / RegOpenKeyExW), so recovery is automatic.
 */
import streamDeck from "@elgato/streamdeck";
import { EventEmitter } from "node:events";

import { GadgetRegistryProvider } from "./hwinfo/gadget-registry";
import { SharedMemoryProvider, type SnapshotProvider, type SnapshotSource } from "./hwinfo/provider";
import { HwinfoError, type HwinfoUnavailableReason, type SensorSnapshot } from "./hwinfo/types";

export type PollerStatus =
	| { state: "ok"; snapshot: SensorSnapshot; source: SnapshotSource }
	| { state: "stale"; snapshot: SensorSnapshot; source: SnapshotSource; staleForMs: number }
	| { state: "unavailable"; reason: HwinfoUnavailableReason; message: string };

export type SourceMode = "auto" | "shared-memory" | "gadget";

export const DEFAULT_INTERVAL_MS = 1000;
const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 60_000;
// Both timings are env-overridable so the resilience e2e can force the
// stale/unavailable transitions in seconds instead of minutes.
/** pollTime frozen for longer than this ⇒ HWiNFO stopped sharing. */
const STALE_AFTER_MS = Number(process.env.HWINFO_STALE_AFTER_MS ?? "") || 15_000;
/** While stale, probe a fresh open at most this often. */
const REOPEN_PROBE_MS = Number(process.env.HWINFO_REOPEN_PROBE_MS ?? "") || 5_000;
/** While on the gadget fallback in auto mode, probe shared memory this often. */
const UPGRADE_PROBE_MS = Number(process.env.HWINFO_UPGRADE_PROBE_MS ?? "") || 15_000;

export function parsePollInterval(raw: unknown): number {
	const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
	if (!Number.isFinite(n)) {
		return DEFAULT_INTERVAL_MS;
	}
	return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(n)));
}

export function parseSourceMode(raw: unknown): SourceMode {
	return raw === "shared-memory" || raw === "gadget" ? raw : "auto";
}

class HwinfoPoller extends EventEmitter {
	private readonly logger = streamDeck.logger.createScope("HwinfoPoller");
	private provider: SnapshotProvider | null = null;
	private timer: NodeJS.Timeout | null = null;
	private refs = 0;
	private intervalMs = DEFAULT_INTERVAL_MS;
	private mode: SourceMode = "auto";
	private lastPollTime = -1;
	private lastAdvanceAt = 0;
	private lastReopenProbeAt = 0;
	private lastUpgradeProbeAt = 0;
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

	setSourceMode(mode: SourceMode): void {
		if (mode === this.mode) {
			return;
		}
		this.mode = mode;
		this.logger.info(`Source mode set to ${mode}`);
		this.dropProvider();
		if (this.timer !== null) {
			this.tick();
		}
	}

	private start(): void {
		if (this.timer !== null) {
			return;
		}
		this.logger.info(`Started (${this.intervalMs} ms interval)`);
		this.timer = setInterval(() => this.tick(), this.intervalMs);
		this.tick();
	}

	private stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.dropProvider();
		// Info on purpose: the e2e exit-hygiene check greps for this line to
		// prove the poller idles (timer cleared, provider closed) with no keys.
		this.logger.info("Stopped (no visible actions)");
	}

	private dropProvider(): void {
		this.provider?.close();
		this.provider = null;
		this.lastPollTime = -1;
	}

	/** Opens the preferred source; in auto mode shared memory wins, gadget is the fallback. */
	private openProvider(): SnapshotProvider {
		if (this.mode === "shared-memory") {
			return SharedMemoryProvider.open();
		}
		if (this.mode === "gadget") {
			return GadgetRegistryProvider.open();
		}
		try {
			return SharedMemoryProvider.open();
		} catch (primary) {
			try {
				return GadgetRegistryProvider.open();
			} catch (fallback) {
				// A present-but-empty gadget key means the user is set up for
				// Gadget reporting and just needs to tick sensors — that beats
				// shared memory's generic "not running". Anything else: shared
				// memory's diagnosis is the actionable one.
				if (fallback instanceof HwinfoError && fallback.reason === "gadget-empty") {
					throw fallback;
				}
				throw primary;
			}
		}
	}

	private tick(): void {
		try {
			if (this.provider === null) {
				this.provider = this.openProvider();
				this.lastAdvanceAt = Date.now();
				this.logger.info(`Opened HWiNFO data source: ${this.provider.source}`);
			}
			this.maybeUpgradeToSharedMemory();

			const snapshot = this.provider.read();
			if (snapshot !== null && snapshot.pollTime !== this.lastPollTime) {
				this.lastPollTime = snapshot.pollTime;
				this.lastAdvanceAt = Date.now();
			}
			// Freshness is judged even when the read was skipped (mutex busy) —
			// a consumer wedged on the mutex must not freeze us at "ok" forever.
			const staleForMs = Date.now() - this.lastAdvanceAt;
			if (staleForMs > STALE_AFTER_MS) {
				// The data is frozen. If HWiNFO exited we would never notice through
				// our held handles — probe a fresh open.
				this.probeReopen();
				const source = this.provider.source;
				const last = snapshot ?? (this.status.state !== "unavailable" ? this.status.snapshot : null);
				if (last !== null) {
					this.status = { state: "stale", snapshot: last, source, staleForMs };
				}
			} else if (snapshot !== null) {
				this.status = { state: "ok", snapshot, source: this.provider.source };
			}
			// Otherwise (skipped read, still fresh): keep the previous status.
		} catch (err) {
			this.dropProvider();
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

	/** While stale: swap to a freshly opened provider (throws when HWiNFO is gone). */
	private probeReopen(): void {
		const now = Date.now();
		if (now - this.lastReopenProbeAt < REOPEN_PROBE_MS) {
			return;
		}
		this.lastReopenProbeAt = now;
		// Release our handles FIRST: a named section stays alive while any handle
		// references it — including ours — so probing before closing would succeed
		// even after HWiNFO died, making the stale→unavailable edge unreachable.
		this.dropProvider();
		this.provider = this.openProvider(); // HwinfoError propagates to tick()
	}

	/** On the gadget fallback in auto mode, switch back once shared memory returns. */
	private maybeUpgradeToSharedMemory(): void {
		if (this.mode !== "auto" || this.provider === null || this.provider.source !== "gadget") {
			return;
		}
		const now = Date.now();
		if (now - this.lastUpgradeProbeAt < UPGRADE_PROBE_MS) {
			return;
		}
		this.lastUpgradeProbeAt = now;
		try {
			const upgraded = SharedMemoryProvider.open();
			this.provider.close();
			this.provider = upgraded;
			this.lastPollTime = -1;
			this.lastAdvanceAt = now;
			this.logger.info("Shared memory returned — upgraded from the gadget registry");
		} catch {
			// Still unavailable — stay on the gadget registry.
		}
	}
}

export const poller = new HwinfoPoller();
