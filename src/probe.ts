/**
 * Standalone smoke test for the HWiNFO shared-memory reader — run with
 * `npm run probe`. Requires no Stream Deck; prints live readings grouped by
 * sensor source, or a precise diagnostic when HWiNFO data is unavailable.
 *
 *   npm run probe            summary + first readings of every source
 *   npm run probe -- --all   every reading
 *   npm run probe -- --json  full snapshot as JSON
 */
import { parseSnapshot } from "./hwinfo/reader";
import { SharedMemorySession } from "./hwinfo/shared-memory";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot } from "./hwinfo/types";

const args = new Set(process.argv.slice(2));
const showAll = args.has("--all");
const asJson = args.has("--json");

const GUIDANCE: Record<string, string> = {
	"unsupported-platform": "HWiNFO only runs on Windows; this probe has nothing to read here.",
	"not-running": "Start HWiNFO and enable Settings → 'Shared Memory Support' (Sensors window must be open, or run in Sensors-only mode).",
	"access-denied": "HWiNFO and this process run at different privilege levels. Run both elevated or both non-elevated.",
	disabled: "Shared Memory Support is switched off in HWiNFO — re-enable it in Settings. On the free version it auto-disables after 12 hours; HWiNFO Pro removes that limit.",
	invalid: "The shared-memory contents did not validate; HWiNFO may be mid-restart or an incompatible version. Try again in a few seconds."
};

function bail(err: HwinfoError): never {
	console.error(`HWiNFO unavailable [${err.reason}]: ${err.message}`);
	console.error(`→ ${GUIDANCE[err.reason]}`);
	process.exit(2);
}

function fmt(r: Reading): string {
	const stats = `min ${r.valueMin.toFixed(1)}  max ${r.valueMax.toFixed(1)}  avg ${r.valueAvg.toFixed(1)}`;
	return `${r.label.padEnd(38)} ${r.value.toFixed(2).padStart(12)} ${r.unit.padEnd(8)} (${stats})  [${SensorType[r.type]}]`;
}

function read(session: SharedMemorySession): SensorSnapshot {
	const buf = session.read();
	if (buf === null) {
		console.error("Could not acquire the HWiNFO mutex within 150 ms — trying once more...");
		const retry = session.read();
		if (retry === null) {
			console.error("Still locked; giving up.");
			process.exit(1);
		}
		return parseSnapshot(retry);
	}
	return parseSnapshot(buf);
}

let session: SharedMemorySession;
try {
	session = SharedMemorySession.open();
} catch (err) {
	if (err instanceof HwinfoError) {
		bail(err);
	}
	throw err;
}

try {
	const first = read(session);

	// A second read ~1.2 s later proves values are actually flowing (HWiNFO
	// polls every ~2 s by default, so poll time should advance within a tick or two).
	await new Promise((resolve) => setTimeout(resolve, 1200));
	const snapshot = read(session);
	const advancing = snapshot.pollTime > first.pollTime;
	const ageSec = Math.round(Date.now() / 1000 - snapshot.pollTime);

	if (asJson) {
		console.log(JSON.stringify({ ...snapshot, byKey: undefined }, null, 2));
	} else {
		console.log(`HWiNFO shared memory v${snapshot.version}.${snapshot.revision} — ${snapshot.sensors.length} sensors, ${snapshot.readings.length} readings`);
		console.log(`last poll: ${new Date(snapshot.pollTime * 1000).toISOString()} (${ageSec}s ago) — advancing: ${advancing ? "yes" : "NO (previous poll " + first.pollTime + ")"}`);
		console.log("");

		const bySensor = new Map<number, Reading[]>();
		for (const r of snapshot.readings) {
			const list = bySensor.get(r.sensorIndex) ?? [];
			list.push(r);
			bySensor.set(r.sensorIndex, list);
		}

		let printed = 0;
		const limit = showAll ? Number.POSITIVE_INFINITY : 40;
		for (const [sensorIndex, readings] of bySensor) {
			const source = snapshot.sensors[sensorIndex];
			console.log(`▸ ${source?.name ?? `<unknown sensor #${sensorIndex}>`}  (${readings.length} readings)`);
			for (const r of readings) {
				if (printed >= limit) {
					continue;
				}
				console.log(`    ${fmt(r)}`);
				printed++;
			}
			if (printed >= limit && !showAll) {
				console.log(`\n…truncated at ${limit} readings — rerun with --all for everything.`);
				break;
			}
		}
	}
	process.exit(advancing ? 0 : 1);
} finally {
	session.close();
}
