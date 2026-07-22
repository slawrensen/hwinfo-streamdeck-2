/**
 * HWiNFO "Gadget" registry backend — `HKCU\Software\HWiNFO64\VSB` holds
 * `Sensor<i>` / `Label<i>` / `Value<i>` / `ValueRaw<i>` REG_SZ quadruplets for
 * every reading the user ticked "Report value in Gadget" for. Unlike shared
 * memory it never expires on the free version, but it carries no min/max/avg,
 * no ids and no poll timestamp.
 *
 * The provider owns ONE opaque native GadgetKey for its lifetime (opened
 * under HKCU with query-only rights by the hwsm bridge); every value read
 * reuses the key and the bridge's native buffer, so steady-state polling
 * allocates only the JavaScript strings it returns.
 *
 * Freshness: the registry is NOT cleared when HWiNFO exits, so absence can't
 * be detected structurally. A content digest is tracked instead — while the
 * values keep changing the synthesized pollTime advances; when HWiNFO stops,
 * the digest freezes and the poller's normal staleness handling kicks in.
 */
import { getHwsm, hwsmCode, hwsmWin32, type HwsmGadgetKey } from "./hwsm-loader";
import { HwinfoError, SensorType, type Reading, type SensorSnapshot, type SensorSource } from "./types";

/** Overridable so the gadget e2e can point at a synthetic key. */
const VSB_SUBKEY = process.env.HWINFO_VSB_KEY ?? "Software\\HWiNFO64\\VSB";

const MAX_ENTRIES = 1024;
/** Win32 ERROR_KEY_DELETED: the key vanished under our open handle. */
const ERROR_KEY_DELETED = 1018;

/** Maps a display unit to the closest HWiNFO sensor type for picker chips. */
function inferType(unit: string): SensorType {
	switch (unit) {
		case "°C":
		case "°F":
			return SensorType.Temperature;
		case "RPM":
			return SensorType.Fan;
		case "V":
		case "mV":
			return SensorType.Voltage;
		case "A":
			return SensorType.Current;
		case "W":
			return SensorType.Power;
		case "MHz":
		case "GHz":
			return SensorType.Clock;
		case "%":
			return SensorType.Usage;
		default:
			return SensorType.Other;
	}
}

/** "45.5 °C" → "°C"; "1 200 RPM" → "RPM"; "Yes" → "". */
function unitOf(formatted: string): string {
	const match = /^\s*-?[\d.,\s]*(.*)$/.exec(formatted);
	return (match?.[1] ?? "").trim();
}

/** Native registry failure → status-screen reason. */
function toHwinfoError(err: unknown): unknown {
	const code = hwsmCode(err);
	if (code === "") {
		return err;
	}
	if (code === "HWSM_REGISTRY_NOT_FOUND" || hwsmWin32(err) === ERROR_KEY_DELETED) {
		return new HwinfoError("not-running", `HWiNFO Gadget registry key HKCU\\${VSB_SUBKEY} is not present: enable Gadget reporting in HWiNFO, or start HWiNFO.`);
	}
	if (code === "HWSM_REGISTRY_ACCESS_DENIED") {
		return new HwinfoError("access-denied", `Reading HKCU\\${VSB_SUBKEY} was denied.`);
	}
	return new HwinfoError("invalid", (err as Error).message);
}

export class GadgetRegistryProvider {
	readonly source = "gadget";

	private lastDigest = "";
	private lastChangeSec = Math.floor(Date.now() / 1000);

	private constructor(private readonly key: HwsmGadgetKey) {}

	/**
	 * Opens the backend, verifying the key exists AND currently has entries.
	 * A present-but-empty key throws "gadget-empty" — the user has Gadget
	 * reporting set up and needs to tick sensors, which (only) outranks a
	 * generic "not-running" from shared memory in the poller's auto mode.
	 */
	static open(): GadgetRegistryProvider {
		if (process.platform !== "win32") {
			throw new HwinfoError("unsupported-platform", "The HWiNFO Gadget registry only exists on Windows.");
		}
		const bridge = getHwsm();
		let key: HwsmGadgetKey;
		try {
			key = bridge.openGadgetKey(VSB_SUBKEY);
		} catch (err) {
			throw toHwinfoError(err);
		}
		const provider = new GadgetRegistryProvider(key);
		let snapshot: SensorSnapshot;
		try {
			snapshot = provider.read();
		} catch (err) {
			provider.close();
			throw err;
		}
		if (snapshot.readings.length === 0) {
			provider.close();
			// The key existing but holding no readings means HWiNFO IS (or was)
			// running with Gadget support — "start HWiNFO" would mislead here.
			throw new HwinfoError("gadget-empty", `HKCU\\${VSB_SUBKEY} exists but holds no readings: in HWiNFO's sensor window, tick "Report value in Gadget" for the sensors you need.`);
		}
		return provider;
	}

	read(): SensorSnapshot {
		try {
			return this.readEntries();
		} catch (err) {
			throw toHwinfoError(err);
		}
	}

	private readEntries(): SensorSnapshot {
		const sensors: SensorSource[] = [];
		const sensorIndexByName = new Map<string, number>();
		const readings: Reading[] = [];
		const byKey = new Map<string, Reading>();
		const digestParts: string[] = [];

		for (let i = 0; i < MAX_ENTRIES; i++) {
			const sensorName = this.key.queryString(`Sensor${i}`);
			if (sensorName === null) {
				break;
			}
			const label = this.key.queryString(`Label${i}`) ?? `Reading ${i}`;
			const formatted = this.key.queryString(`Value${i}`) ?? "";
			const raw = this.key.queryString(`ValueRaw${i}`) ?? "";

			let sensorIndex = sensorIndexByName.get(sensorName);
			if (sensorIndex === undefined) {
				sensorIndex = sensors.length;
				sensorIndexByName.set(sensorName, sensorIndex);
				sensors.push({ index: sensorIndex, id: 0, instance: sensorIndex, name: sensorName });
			}

			const unit = unitOf(formatted);
			// HWiNFO writes ValueRaw with the system locale's decimal separator.
			const value = Number.parseFloat(raw.replace(",", "."));

			const baseKey = `g:${sensorName}:${label}`;
			let key = baseKey;
			for (let dup = 1; byKey.has(key); dup++) {
				key = `${baseKey}~${dup}`;
			}
			const reading: Reading = {
				key,
				type: inferType(unit),
				sensorIndex,
				id: i,
				label,
				unit,
				// The gadget interface exposes only the current value.
				value,
				valueMin: value,
				valueMax: value,
				valueAvg: value
			};
			readings.push(reading);
			byKey.set(key, reading);
			digestParts.push(raw);
		}

		const digest = digestParts.join("|");
		if (digest !== this.lastDigest) {
			this.lastDigest = digest;
			this.lastChangeSec = Math.floor(Date.now() / 1000);
		}

		return { pollTime: this.lastChangeSec, version: 0, revision: 0, sensors, readings, byKey };
	}

	close(): void {
		this.key.close(); // idempotent on the native side
	}

	/**
	 * Carries the staleness baseline across a poller reopen probe — a fresh
	 * provider would otherwise treat a frozen registry as newly changed and
	 * flap the status back to "ok" for another stale window.
	 */
	adoptFreshness(from: GadgetRegistryProvider): void {
		this.lastDigest = from.lastDigest;
		this.lastChangeSec = from.lastChangeSec;
	}
}
