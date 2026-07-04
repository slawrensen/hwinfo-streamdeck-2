// Parse-path microbenchmark against the LIVE HWiNFO mapping. Measures the
// production tick (provider.read() = mutex + copy + parse), the raw copy
// alone (session.read()), the allocation rate per tick from
// process.memoryUsage() deltas, and gc-to-gc retained growth. Emits one JSON
// line on stdout; perf-report.mjs consumes it.
//
// Run: node --expose-gc --import tsx scripts/bench-parse.ts
import { GadgetRegistryProvider } from "../src/hwinfo/gadget-registry";
import { SharedMemoryProvider, type SnapshotProvider } from "../src/hwinfo/provider";
import { SharedMemorySession } from "../src/hwinfo/shared-memory";
import type { SensorSnapshot } from "../src/hwinfo/types";

const ITERS = Number(process.env.BENCH_ITERS ?? "1000");
const WARMUP = 25;

const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) {
	console.error("Run with --expose-gc (perf-report.mjs does).");
	process.exit(1);
}

interface Stats {
	mean: number;
	p50: number;
	p95: number;
}

function stats(samplesNs: number[]): Stats {
	const sorted = [...samplesNs].sort((a, b) => a - b);
	const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
	const mean = samplesNs.reduce((a, b) => a + b, 0) / samplesNs.length;
	const us = (ns: number): number => Math.round(ns / 100) / 10;
	return { mean: us(mean), p50: us(at(0.5)), p95: us(at(0.95)) };
}

/** One tick; retries transient mutex-busy nulls so every sample does real work. */
function tick(provider: SnapshotProvider): SensorSnapshot {
	for (let attempt = 0; attempt < 50; attempt++) {
		const snapshot = provider.read();
		if (snapshot !== null) {
			return snapshot;
		}
	}
	throw new Error("Mutex busy for 50 consecutive reads — aborting bench.");
}

function timePass(fn: () => unknown): Stats {
	const samples: number[] = new Array<number>(ITERS);
	for (let i = 0; i < ITERS; i++) {
		const t0 = process.hrtime.bigint();
		fn();
		samples[i] = Number(process.hrtime.bigint() - t0);
	}
	return stats(samples);
}

/** Sums positive heapUsed deltas across iterations — allocation rate per tick. */
function allocPass(fn: () => unknown): number {
	if (gc) {
		gc();
	}
	let allocated = 0;
	let prev = process.memoryUsage().heapUsed;
	for (let i = 0; i < ITERS; i++) {
		fn();
		const now = process.memoryUsage().heapUsed;
		if (now > prev) {
			allocated += now - prev;
		}
		prev = now;
	}
	return Math.round(allocated / ITERS);
}

/** gc → run → gc growth: what the ticks permanently retained. */
function retainedPass(fn: () => unknown): number {
	if (!gc) {
		return 0;
	}
	gc();
	const before = process.memoryUsage().heapUsed;
	for (let i = 0; i < ITERS; i++) {
		fn();
	}
	gc();
	return process.memoryUsage().heapUsed - before;
}

interface SourceReport {
	sensors: number;
	readings: number;
	tickUs: Stats;
	allocPerTickB: number;
	retainedB: number;
}

function benchProvider(provider: SnapshotProvider): SourceReport {
	for (let i = 0; i < WARMUP; i++) {
		tick(provider);
	}
	const first = tick(provider);
	const tickUs = timePass(() => tick(provider));
	const allocPerTickB = allocPass(() => tick(provider));
	const retainedB = retainedPass(() => tick(provider));
	return { sensors: first.sensors.length, readings: first.readings.length, tickUs, allocPerTickB, retainedB };
}

const report: Record<string, unknown> = { iters: ITERS };

// Raw copy cost (mutex + RtlMoveMemory into scratch), no parsing.
try {
	const session = SharedMemorySession.open();
	const buf = session.read();
	report.regionBytes = buf?.length ?? 0;
	report.readUs = timePass(() => session.read());
	session.close();
} catch (err) {
	report.readError = String(err);
}

try {
	const provider = SharedMemoryProvider.open();
	report.sharedMemory = benchProvider(provider);
	provider.close();
} catch (err) {
	report.sharedMemoryError = String(err);
}

try {
	const provider = GadgetRegistryProvider.open();
	report.gadget = benchProvider(provider);
	provider.close();
} catch (err) {
	report.gadgetError = String(err);
}

console.log(JSON.stringify(report));
