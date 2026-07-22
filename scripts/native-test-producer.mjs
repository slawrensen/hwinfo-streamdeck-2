// Controllable Win32 producer for the native integration suite
// (test/native-hwsm.test.ts). Dev-only, never shipped: creates named file
// mappings, mutexes, and registry keys — including deny-everyone variants —
// and mutates them on command, so the hwsm addon's failure paths can be
// exercised deterministically.
//
// Protocol: one JSON object per stdin line in, one JSON reply per stdout
// line out ({ ok: true, ... } or { ok: false, error }). Commands:
//   create        { size, mapping, mutex?, denyMapping?, denyMutex? }
//   write         { offset, dataBase64 }   (under the mutex when one exists)
//   hold          acquire the mutex and keep it (abandon by killing us)
//   release       release a held mutex
//   openMutex     { name }                 (attach to someone else's mutex)
//   closeMapping  drop our mapping handle + view (mutex stays)
//   regCreate     { subkey, deny? }        (under HKCU)
//   regSet        { subkey, name, type, dataBase64 }
//   regDeleteValue{ subkey, name }
//   regDeleteKey  { subkey }               (restores a permissive DACL first)
//   exit
import { createRequire } from "node:module";
import readline from "node:readline";

const require = createRequire(import.meta.url);
const koffi = require("koffi");

const k32 = koffi.load("kernel32.dll");
const adv = koffi.load("advapi32.dll");

const SECURITY_ATTRIBUTES = koffi.struct("SECURITY_ATTRIBUTES", {
	nLength: "uint32",
	lpSecurityDescriptor: "void*",
	bInheritHandle: "int"
});
void SECURITY_ATTRIBUTES;

// Win32 BOOL parameters are 32-bit ints; a koffi "bool" (1 byte) can pick up
// stale register bits and flip flags like bInitialOwner to TRUE. Every BOOL
// parameter here is int32 with an explicit 0/1.
const CreateFileMappingW = k32.func("__stdcall", "CreateFileMappingW", "void*", ["int64", "SECURITY_ATTRIBUTES*", "uint32", "uint32", "uint32", "str16"]);
const CreateMutexW = k32.func("__stdcall", "CreateMutexW", "void*", ["SECURITY_ATTRIBUTES*", "int32", "str16"]);
const OpenMutexW = k32.func("__stdcall", "OpenMutexW", "void*", ["uint32", "int32", "str16"]);
const MapViewOfFile = k32.func("__stdcall", "MapViewOfFile", "void*", ["void*", "uint32", "uint32", "uint32", "size_t"]);
const UnmapViewOfFile = k32.func("__stdcall", "UnmapViewOfFile", "bool", ["void*"]);
const CloseHandle = k32.func("__stdcall", "CloseHandle", "bool", ["void*"]);
const WaitForSingleObject = k32.func("__stdcall", "WaitForSingleObject", "uint32", ["void*", "uint32"]);
const ReleaseMutex = k32.func("__stdcall", "ReleaseMutex", "bool", ["void*"]);
// Destination is the mapped view, source is a JS Buffer.
const RtlMoveMemory = k32.func("__stdcall", "RtlMoveMemory", "void", ["void*", "uint8*", "size_t"]);
const GetLastError = k32.func("__stdcall", "GetLastError", "uint32", []);

const InitializeSecurityDescriptor = adv.func("__stdcall", "InitializeSecurityDescriptor", "bool", ["uint8*", "uint32"]);
const SetSecurityDescriptorDacl = adv.func("__stdcall", "SetSecurityDescriptorDacl", "bool", ["uint8*", "int32", "uint8*", "int32"]);
const InitializeAcl = adv.func("__stdcall", "InitializeAcl", "bool", ["uint8*", "uint32", "uint32"]);
const RegCreateKeyExW = adv.func("__stdcall", "RegCreateKeyExW", "uint32", ["uint64", "str16", "uint32", "void*", "uint32", "uint32", "SECURITY_ATTRIBUTES*", "_Out_ uint64*", "_Out_ uint32*"]);
const RegSetValueExW = adv.func("__stdcall", "RegSetValueExW", "uint32", ["uint64", "str16", "uint32", "uint32", "uint8*", "uint32"]);
const RegDeleteValueW = adv.func("__stdcall", "RegDeleteValueW", "uint32", ["uint64", "str16"]);
const RegDeleteKeyW = adv.func("__stdcall", "RegDeleteKeyW", "uint32", ["uint64", "str16"]);
const RegCloseKey = adv.func("__stdcall", "RegCloseKey", "uint32", ["uint64"]);
const RegSetKeySecurity = adv.func("__stdcall", "RegSetKeySecurity", "uint32", ["uint64", "uint32", "uint8*"]);

const INVALID_HANDLE_VALUE = -1n;
const PAGE_READWRITE = 0x04;
const FILE_MAP_WRITE = 0x0002;
const SYNCHRONIZE = 0x00100000;
/** Sign-extended HKEY_CURRENT_USER pseudo-handle (x64). */
const HKEY_CURRENT_USER = 0xffffffff80000001n;
const KEY_ALL_ACCESS = 0xf003f;
const WRITE_DAC = 0x00040000;
const DACL_SECURITY_INFORMATION = 0x4;
const SECURITY_DESCRIPTOR_REVISION = 1;
const ACL_REVISION = 2;

/** Deny-everyone SD: a present DACL with zero ACEs grants nothing. The
 * creating handle keeps the access it requested at creation, so this
 * process can still write and clean up while every OTHER open attempt is
 * denied. Buffers must outlive the kernel objects: module lifetime. */
const denyAcl = Buffer.alloc(64);
const denySd = Buffer.alloc(64);
InitializeAcl(denyAcl, 64, ACL_REVISION);
InitializeSecurityDescriptor(denySd, SECURITY_DESCRIPTOR_REVISION);
SetSecurityDescriptorDacl(denySd, 1, denyAcl, 0);
/** NULL-DACL SD (everyone full access) for restoring before cleanup. */
const openSd = Buffer.alloc(64);
InitializeSecurityDescriptor(openSd, SECURITY_DESCRIPTOR_REVISION);
SetSecurityDescriptorDacl(openSd, 1, null, 0);

const denySa = { nLength: 24, lpSecurityDescriptor: denySd, bInheritHandle: 0 };

let hMap = null;
let hMutex = null;
let view = null;
let shadow = null; // full-size staging buffer; writes merge here, then flush
let held = false;
const regKeys = new Map(); // subkey -> uint64 handle (from creation, full access)

function reply(obj) {
	process.stdout.write(JSON.stringify(obj) + "\n");
}

function handle(msg) {
	switch (msg.cmd) {
		case "create": {
			hMap = CreateFileMappingW(INVALID_HANDLE_VALUE, msg.denyMapping ? denySa : null, PAGE_READWRITE, 0, msg.size, msg.mapping);
			if (hMap === null) return { ok: false, error: `CreateFileMappingW ${GetLastError()}` };
			if (msg.mutex) {
				hMutex = CreateMutexW(msg.denyMutex ? denySa : null, 0, msg.mutex);
				if (hMutex === null) return { ok: false, error: `CreateMutexW ${GetLastError()}` };
			}
			view = MapViewOfFile(hMap, FILE_MAP_WRITE, 0, 0, 0);
			if (view === null) return { ok: false, error: `MapViewOfFile ${GetLastError()}` };
			shadow = Buffer.alloc(msg.size);
			return { ok: true };
		}
		case "write": {
			// Merge into the shadow at the offset, then publish the whole
			// region from offset 0 (no native pointer arithmetic needed).
			const data = Buffer.from(msg.dataBase64, "base64");
			data.copy(shadow, msg.offset ?? 0);
			const locked = hMutex !== null && !held;
			if (locked) WaitForSingleObject(hMutex, 2000);
			try {
				RtlMoveMemory(view, shadow, shadow.length);
			} finally {
				if (locked) ReleaseMutex(hMutex);
			}
			return { ok: true };
		}
		case "hold": {
			const w = WaitForSingleObject(hMutex, 2000);
			held = w === 0 || w === 0x80;
			return { ok: held, wait: w };
		}
		case "release": {
			if (held) {
				ReleaseMutex(hMutex);
				held = false;
			}
			return { ok: true };
		}
		case "openMutex": {
			hMutex = OpenMutexW(SYNCHRONIZE, 0, msg.name);
			return hMutex === null ? { ok: false, error: `OpenMutexW ${GetLastError()}` } : { ok: true };
		}
		case "closeMapping": {
			if (view !== null) UnmapViewOfFile(view);
			if (hMap !== null) CloseHandle(hMap);
			view = null;
			hMap = null;
			return { ok: true };
		}
		case "regCreate": {
			const out = [0n];
			const disp = [0];
			const status = RegCreateKeyExW(HKEY_CURRENT_USER, msg.subkey, 0, null, 0, KEY_ALL_ACCESS | WRITE_DAC, msg.deny ? denySa : null, out, disp);
			if (status !== 0) return { ok: false, error: `RegCreateKeyExW ${status}` };
			regKeys.set(msg.subkey, out[0]);
			return { ok: true };
		}
		case "regSet": {
			const key = regKeys.get(msg.subkey);
			if (key === undefined) return { ok: false, error: "key not created here" };
			const data = Buffer.from(msg.dataBase64, "base64");
			const status = RegSetValueExW(key, msg.name, 0, msg.type, data, data.length);
			return status === 0 ? { ok: true } : { ok: false, error: `RegSetValueExW ${status}` };
		}
		case "regDeleteValue": {
			const key = regKeys.get(msg.subkey);
			if (key === undefined) return { ok: false, error: "key not created here" };
			const status = RegDeleteValueW(key, msg.name);
			return status === 0 ? { ok: true } : { ok: false, error: `RegDeleteValueW ${status}` };
		}
		case "regDeleteKey": {
			const key = regKeys.get(msg.subkey);
			if (key !== undefined) {
				RegSetKeySecurity(key, DACL_SECURITY_INFORMATION, openSd);
				RegCloseKey(key);
				regKeys.delete(msg.subkey);
			}
			const status = RegDeleteKeyW(HKEY_CURRENT_USER, msg.subkey);
			return status === 0 ? { ok: true } : { ok: false, error: `RegDeleteKeyW ${status}` };
		}
		case "exit": {
			cleanup();
			reply({ ok: true });
			process.exit(0);
			return { ok: true };
		}
		default:
			return { ok: false, error: `unknown cmd ${msg.cmd}` };
	}
}

function cleanup() {
	// Deliberately NOT releasing a held mutex: killing/exiting while holding
	// is exactly how the abandonment tests work.
	if (view !== null) UnmapViewOfFile(view);
	if (hMap !== null) CloseHandle(hMap);
	if (hMutex !== null) CloseHandle(hMutex);
	for (const [, key] of regKeys) RegCloseKey(key);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		reply({ ok: false, error: "bad json" });
		return;
	}
	try {
		reply(handle(msg));
	} catch (err) {
		reply({ ok: false, error: String(err) });
	}
});

reply({ ok: true, ready: true, pid: process.pid });
