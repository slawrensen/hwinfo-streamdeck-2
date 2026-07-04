/**
 * Standalone smoke test for the HWiNFO readers — run with `npm run probe`.
 * Requires no Stream Deck; prints live readings grouped by sensor source, or
 * a precise diagnostic when HWiNFO data is unavailable. Prefers shared
 * memory and falls back to the Gadget registry, exactly like the plugin.
 *
 *   npm run probe              summary + first readings of every source
 *   npm run probe -- --all     every reading
 *   npm run probe -- --json    full snapshot as JSON
 *   npm run probe -- --gadget  force the Gadget registry backend
 */
import { GadgetRegistryProvider } from "./hwinfo/gadget-registry";
import { SharedMemoryProvider, type SnapshotProvider } from "./hwinfo/provider";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot } from "./hwinfo/types";

const args = new Set(process.argv.slice(2));
const showAll = args.has("--all");
const asJson = args.has("--json");
const forceGadget = args.has("--gadget");

const GUIDANCE: Record<string, string> = {
	"unsupported-platform": "HWiNFO only runs on Windows; this probe has nothing to read here.",
	"not-running": "Start HWiNFO and enable Settings → 'Shared Memory Support' (Sensors window open, or Sensors-only mode) — or enable Gadget reporting and tick sensors (free, no 12-hour limit).",
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

function read(provider: SnapshotProvider): SensorSnapshot {
	const snapshot = provider.read();
	if (snapshot === null) {
		console.error("Could not acquire the HWiNFO mutex within 150 ms — trying once more...");
		const retry = provider.read();
		if (retry === null) {
			console.error("Still locked; giving up.");
			process.exit(1);
		}
		return retry;
	}
	return snapshot;
}

let session: SnapshotProvider;
try {
	session = forceGadget ? GadgetRegistryProvider.open() : SharedMemoryProvider.open();
} catch (err) {
	if (!(err instanceof HwinfoError)) {
		throw err;
	}
	if (forceGadget) {
		bail(err);
	}
	// Same fallback order as the plugin's "auto" mode.
	try {
		session = GadgetRegistryProvider.open();
		console.error(`Shared memory unavailable [${err.reason}] — fell back to the Gadget registry.`);
	} catch (gadgetErr) {
		if (gadgetErr instanceof HwinfoError) {
			bail(err); // shared memory's diagnosis is the actionable one
		}
		throw gadgetErr;
	}
}

try {
	// read()/parseSnapshot can throw HwinfoError too ("disabled" when the free
	// version's 12 h timer wrote the DEAD magic, "invalid" mid-restart) — route
	// those through the same guidance table instead of a raw stack trace.
	const first = read(session);

	// A second read ~2.6 s later proves values are actually flowing (HWiNFO
	// polls every ~2 s by default, so poll time should advance within a cycle).
	await new Promise((resolve) => setTimeout(resolve, 2600));
	const snapshot = read(session);
	const advancing = snapshot.pollTime > first.pollTime;
	const ageSec = Math.round(Date.now() / 1000 - snapshot.pollTime);

	if (asJson) {
		console.log(JSON.stringify({ ...snapshot, byKey: undefined, advancing }, null, 2));
	} else {
		const label = session.source === "gadget" ? "Gadget registry" : `shared memory v${snapshot.version}.${snapshot.revision}`;
		console.log(`HWiNFO ${label} — ${snapshot.sensors.length} sensors, ${snapshot.readings.length} readings [source: ${session.source}]`);
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
	// In JSON mode the snapshot itself is the result; `advancing` is in the payload.
	process.exit(asJson || advancing ? 0 : 1);
} catch (err) {
	if (err instanceof HwinfoError) {
		bail(err);
	}
	throw err;
} finally {
	session.close();
}
