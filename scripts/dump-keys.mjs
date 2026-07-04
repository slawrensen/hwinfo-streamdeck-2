// Dev utility: dumps every reading as `key | type | unit | value | label`
// for profile scripting. Usage: npx tsx scripts/dump-keys.mjs [filter]
import { SharedMemoryProvider } from "../src/hwinfo/provider";
import { SensorType } from "../src/hwinfo/types";

const filter = (process.argv[2] ?? "").toLowerCase();
const provider = SharedMemoryProvider.open();
const snapshot = provider.read();
if (snapshot === null) {
	throw new Error("shared memory read returned null (mid-update) — rerun");
}
for (const r of snapshot.readings) {
	const sensor = snapshot.sensors[r.sensorIndex]?.name ?? "?";
	const line = `${r.key} | ${SensorType[r.type]} | ${r.unit} | ${r.value.toFixed(2)} | ${r.label}  «${sensor}»`;
	if (filter === "" || line.toLowerCase().includes(filter)) {
		console.log(line);
	}
}
