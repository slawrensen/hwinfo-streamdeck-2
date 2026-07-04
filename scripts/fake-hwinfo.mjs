// Synthetic HWiNFO shared-memory provider for the resilience e2e. Creates a
// REAL named file mapping + mutex (classic 264/316 layout — the live HWiNFO
// covers the extended UTF-8 layout) and mutates it on stdin commands:
//   alive   valid magic, pollTime + values advancing every 400 ms
//   freeze  stop advancing (pollTime frozen)
//   dead    write the "DEAD" magic (shared-memory support disabled)
//   exit    unmap, close handles, quit — the mapping disappears with us
// Prints "READY <mappingName>" once the mapping exists.
import { createRequire } from "node:module";
import readline from "node:readline";

const require = createRequire(import.meta.url);
const koffi = require("koffi");

const MAPPING_NAME = process.env.HWINFO_SM2_NAME ?? `Local\\HwinfoE2E_SM2_${process.pid}`;
const MUTEX_NAME = process.env.HWINFO_SM2_MUTEX_NAME ?? `${MAPPING_NAME}_MUTEX`;

const k32 = koffi.load("kernel32.dll");
const CreateFileMappingW = k32.func("__stdcall", "CreateFileMappingW", "void*", ["int64", "void*", "uint32", "uint32", "uint32", "str16"]);
const CreateMutexW = k32.func("__stdcall", "CreateMutexW", "void*", ["void*", "bool", "str16"]);
const MapViewOfFile = k32.func("__stdcall", "MapViewOfFile", "void*", ["void*", "uint32", "uint32", "uint32", "size_t"]);
const UnmapViewOfFile = k32.func("__stdcall", "UnmapViewOfFile", "bool", ["void*"]);
const CloseHandle = k32.func("__stdcall", "CloseHandle", "bool", ["void*"]);
const WaitForSingleObject = k32.func("__stdcall", "WaitForSingleObject", "uint32", ["void*", "uint32"]);
const ReleaseMutex = k32.func("__stdcall", "ReleaseMutex", "bool", ["void*"]);
// Source is an input buffer here (writing INTO the view), unlike the reader.
const RtlMoveMemory = k32.func("__stdcall", "RtlMoveMemory", "void", ["void*", "uint8*", "size_t"]);

const INVALID_HANDLE_VALUE = -1n;
const PAGE_READWRITE = 0x04;
const FILE_MAP_WRITE = 0x0002;
const SIZE = 4096;

const MAGIC_ACTIVE = 0x53695748;
const MAGIC_DEAD = 0x44414544;
const SENSOR_SIZE = 264;
const ENTRY_SIZE = 316;
const HEADER_SIZE = 44;

const hMap = CreateFileMappingW(INVALID_HANDLE_VALUE, null, PAGE_READWRITE, 0, SIZE, MAPPING_NAME);
if (hMap === null) {
	console.error("CreateFileMappingW failed");
	process.exit(1);
}
const hMutex = CreateMutexW(null, false, MUTEX_NAME);
const view = MapViewOfFile(hMap, FILE_MAP_WRITE, 0, 0, 0);
if (view === null) {
	console.error("MapViewOfFile failed");
	process.exit(1);
}

const buf = Buffer.alloc(SIZE);
let value = 50;
let mode = "alive"; // alive | freeze | dead

function cstr(offset, width, text) {
	buf.fill(0, offset, offset + width);
	buf.write(text, offset, width - 1, "latin1");
}

function compose() {
	const magic = mode === "dead" ? MAGIC_DEAD : MAGIC_ACTIVE;
	buf.writeUInt32LE(magic, 0);
	buf.writeUInt32LE(1, 4); // version
	buf.writeUInt32LE(0, 8); // revision
	buf.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 12);
	buf.writeUInt32LE(HEADER_SIZE, 20); // sensor section offset
	buf.writeUInt32LE(SENSOR_SIZE, 24);
	buf.writeUInt32LE(1, 28);
	buf.writeUInt32LE(HEADER_SIZE + SENSOR_SIZE, 32); // entry section offset
	buf.writeUInt32LE(ENTRY_SIZE, 36);
	buf.writeUInt32LE(2, 40);

	// sensor[0]
	const s = HEADER_SIZE;
	buf.writeUInt32LE(0xf0001234, s);
	buf.writeUInt32LE(0, s + 4);
	cstr(s + 8, 128, "Test Source");
	cstr(s + 136, 128, "Test Source");

	// entry[0]: temperature that advances
	let e = HEADER_SIZE + SENSOR_SIZE;
	buf.writeUInt32LE(1, e); // Temperature
	buf.writeUInt32LE(0, e + 4); // sensorIndex
	buf.writeUInt32LE(0x1000001, e + 8);
	cstr(e + 12, 128, "Test Temp");
	cstr(e + 140, 128, "Test Temp");
	cstr(e + 268, 16, "°C");
	buf.writeDoubleLE(value, e + 284);
	buf.writeDoubleLE(40, e + 292);
	buf.writeDoubleLE(90, e + 300);
	buf.writeDoubleLE(55, e + 308);

	// entry[1]: fan
	e += ENTRY_SIZE;
	buf.writeUInt32LE(3, e); // Fan
	buf.writeUInt32LE(0, e + 4);
	buf.writeUInt32LE(0x1000002, e + 8);
	cstr(e + 12, 128, "Test Fan");
	cstr(e + 140, 128, "Test Fan");
	cstr(e + 268, 16, "RPM");
	buf.writeDoubleLE(1200, e + 284);
	buf.writeDoubleLE(800, e + 292);
	buf.writeDoubleLE(2000, e + 300);
	buf.writeDoubleLE(1250, e + 308);
}

function publish() {
	WaitForSingleObject(hMutex, 1000);
	try {
		RtlMoveMemory(view, buf, SIZE);
	} finally {
		ReleaseMutex(hMutex);
	}
}

compose();
publish();
console.log(`READY ${MAPPING_NAME}`);

const timer = setInterval(() => {
	if (mode === "alive") {
		value += 0.5;
		compose();
		publish();
	}
}, 400);

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	const cmd = line.trim();
	if (cmd === "alive" || cmd === "freeze" || cmd === "dead") {
		mode = cmd;
		compose();
		publish();
		console.log(`MODE ${mode}`);
	} else if (cmd === "exit") {
		clearInterval(timer);
		UnmapViewOfFile(view);
		CloseHandle(hMap);
		CloseHandle(hMutex);
		console.log("CLOSED");
		process.exit(0);
	}
});
