/**
 * HWiNFO "Gadget" registry backend — `HKCU\Software\HWiNFO64\VSB` holds
 * `Sensor<i>` / `Label<i>` / `Value<i>` / `ValueRaw<i>` REG_SZ quadruplets for
 * every reading the user ticked "Report value in Gadget" for. Unlike shared
 * memory it never expires on the free version, but it carries no min/max/avg,
 * no ids and no poll timestamp.
 *
 * Freshness: the registry is NOT cleared when HWiNFO exits, so absence can't
 * be detected structurally. A content digest is tracked instead — while the
 * values keep changing the synthesized pollTime advances; when HWiNFO stops,
 * the digest freezes and the poller's normal staleness handling kicks in.
 */
import koffi, { type KoffiFunc } from "koffi";

import { HwinfoError, SensorType, type Reading, type SensorSnapshot, type SensorSource } from "./types";

/** Overridable so the gadget e2e can point at a synthetic key. */
const VSB_SUBKEY = process.env.HWINFO_VSB_KEY ?? "Software\\HWiNFO64\\VSB";

/** Sign-extended HKEY_CURRENT_USER pseudo-handle (x64). */
const HKEY_CURRENT_USER = 0xffffffff80000001n;
const KEY_READ = 0x20019;
const ERROR_SUCCESS = 0;
const MAX_ENTRIES = 1024;

interface Advapi32 {
	regOpenKeyExW: KoffiFunc<(hKey: bigint, subKey: string, options: number, samDesired: number, phkResult: BigUint64Array) => number>;
	regQueryValueExW: KoffiFunc<(hKey: bigint, valueName: string, reserved: null, type: Uint32Array, data: Buffer, size: Uint32Array) => number>;
	regCloseKey: KoffiFunc<(hKey: bigint) => number>;
}

let advapi32: Advapi32 | null = null;

function getAdvapi32(): Advapi32 {
	if (advapi32 === null) {
		const lib = koffi.load("advapi32.dll");
		advapi32 = {
			regOpenKeyExW: lib.func("__stdcall", "RegOpenKeyExW", "uint32", ["uint64", "str16", "uint32", "uint32", "_Out_ uint64*"]) as Advapi32["regOpenKeyExW"],
			regQueryValueExW: lib.func("__stdcall", "RegQueryValueExW", "uint32", ["uint64", "str16", "void*", "_Out_ uint32*", "_Out_ uint8*", "_Inout_ uint32*"]) as Advapi32["regQueryValueExW"],
			regCloseKey: lib.func("__stdcall", "RegCloseKey", "uint32", ["uint64"]) as Advapi32["regCloseKey"]
		};
	}
	return advapi32;
}

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

export class GadgetRegistryProvider {
	readonly source = "gadget";

	private lastDigest = "";
	private lastChangeSec = Math.floor(Date.now() / 1000);
	private readonly valueBuf = Buffer.alloc(8192);

	private constructor() {}

	/**
	 * Opens the backend, verifying the key exists AND currently has entries —
	 * an empty/leftover key must not win over a useful "start HWiNFO" state.
	 */
	static open(): GadgetRegistryProvider {
		if (process.platform !== "win32") {
			throw new HwinfoError("unsupported-platform", "The HWiNFO Gadget registry only exists on Windows.");
		}
		const provider = new GadgetRegistryProvider();
		const snapshot = provider.read();
		if (snapshot.readings.length === 0) {
			throw new HwinfoError("not-running", `No readings under HKCU\\${VSB_SUBKEY} — enable HWiNFO's Gadget reporting and tick "Report value in Gadget" for the sensors you need.`);
		}
		return provider;
	}

	read(): SensorSnapshot {
		const api = getAdvapi32();
		const phk = new BigUint64Array(1);
		const rc = api.regOpenKeyExW(HKEY_CURRENT_USER, VSB_SUBKEY, 0, KEY_READ, phk);
		if (rc !== ERROR_SUCCESS) {
			throw new HwinfoError("not-running", `HWiNFO Gadget registry key HKCU\\${VSB_SUBKEY} is not present (Win32 error ${rc}) — enable Gadget reporting in HWiNFO, or start HWiNFO.`);
		}
		const hkey = phk[0] as bigint;
		try {
			const sensors: SensorSource[] = [];
			const sensorIndexByName = new Map<string, number>();
			const readings: Reading[] = [];
			const byKey = new Map<string, Reading>();
			const digestParts: string[] = [];

			for (let i = 0; i < MAX_ENTRIES; i++) {
				const sensorName = this.readSz(api, hkey, `Sensor${i}`);
				if (sensorName === null) {
					break;
				}
				const label = this.readSz(api, hkey, `Label${i}`) ?? `Reading ${i}`;
				const formatted = this.readSz(api, hkey, `Value${i}`) ?? "";
				const raw = this.readSz(api, hkey, `ValueRaw${i}`) ?? "";

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
		} finally {
			api.regCloseKey(hkey);
		}
	}

	close(): void {
		// Nothing held between reads.
	}

	private readSz(api: Advapi32, hkey: bigint, name: string): string | null {
		const type = new Uint32Array(1);
		const size = new Uint32Array([this.valueBuf.length]);
		const rc = api.regQueryValueExW(hkey, name, null, type, this.valueBuf, size);
		if (rc !== ERROR_SUCCESS) {
			return null;
		}
		return this.valueBuf.toString("utf16le", 0, size[0] as number).replace(/\0+$/, "");
	}
}
