/*
 * hwsm: minimal N-API addon exposing the exact Win32 surface the plugin
 * needs (shared-memory.ts: 8 kernel32 calls; gadget-registry.ts: 3 advapi32
 * calls). Purpose-built replacement for the 1 MB general-purpose koffi FFI —
 * see design/KOFFI-REPLACEMENT.md for the measurements and rationale.
 *
 * Handles and pointers cross the boundary as BigInt uint64 (0 = NULL).
 * The three calls whose failure modes the plugin distinguishes return
 * { value, lastError } with GetLastError() captured INSIDE the call — the
 * N-API boundary may clobber it between separate calls. readInto() copies
 * mapped memory into a caller-provided Buffer so the reader's reusable
 * scratch stays allocation-free per tick.
 *
 * win32-x64 only (the JS loader gates other platforms before loading): the
 * (uintptr_t) round-trips assume 64-bit pointers.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>

#define NAPI_CALL(env, call)                                  \
	do {                                                       \
		if ((call) != napi_ok) {                               \
			napi_throw_error((env), NULL, "napi call failed"); \
			return NULL;                                       \
		}                                                      \
	} while (0)

static uint64_t arg_u64(napi_env env, napi_value v) {
	uint64_t out = 0;
	bool lossless = false;
	napi_valuetype t;
	if (napi_typeof(env, v, &t) != napi_ok) return 0;
	if (t == napi_bigint) {
		napi_get_value_bigint_uint64(env, v, &out, &lossless);
	} else if (t == napi_number) {
		double d = 0;
		napi_get_value_double(env, v, &d);
		out = (uint64_t)d;
	}
	return out;
}

static napi_value make_u64(napi_env env, uint64_t v) {
	napi_value out = NULL;
	napi_create_bigint_uint64(env, v, &out);
	return out;
}

/* { value: BigInt, lastError: number } — lastError only meaningful when
 * value is 0, and captured before any N-API call can clobber it. */
static napi_value make_handle_result(napi_env env, uint64_t value, DWORD lastError) {
	napi_value out = NULL, err = NULL;
	napi_create_object(env, &out);
	napi_set_named_property(env, out, "value", make_u64(env, value));
	napi_create_uint32(env, lastError, &err);
	napi_set_named_property(env, out, "lastError", err);
	return out;
}

/* UTF-16 string argument into a heap buffer; caller frees. */
static WCHAR* arg_wstr(napi_env env, napi_value v) {
	size_t len = 0;
	if (napi_get_value_string_utf16(env, v, NULL, 0, &len) != napi_ok) return NULL;
	WCHAR* buf = (WCHAR*)HeapAlloc(GetProcessHeap(), 0, (len + 1) * sizeof(WCHAR));
	if (buf == NULL) return NULL;
	napi_get_value_string_utf16(env, v, (char16_t*)buf, len + 1, &len);
	buf[len] = 0;
	return buf;
}

static void free_wstr(WCHAR* s) {
	if (s != NULL) HeapFree(GetProcessHeap(), 0, s);
}

/* openFileMappingW(desiredAccess, inherit, name) -> { value, lastError } */
static napi_value OpenFileMappingW_(napi_env env, napi_callback_info info) {
	size_t argc = 3;
	napi_value args[3];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	uint32_t access = (uint32_t)arg_u64(env, args[0]);
	bool inherit = false;
	napi_get_value_bool(env, args[1], &inherit);
	WCHAR* name = arg_wstr(env, args[2]);
	HANDLE h = OpenFileMappingW(access, inherit, name);
	DWORD err = (h == NULL) ? GetLastError() : 0;
	free_wstr(name);
	return make_handle_result(env, (uint64_t)(uintptr_t)h, err);
}

/* mapViewOfFile(handle, desiredAccess, offHigh, offLow, bytes) -> { value, lastError } */
static napi_value MapViewOfFile_(napi_env env, napi_callback_info info) {
	size_t argc = 5;
	napi_value args[5];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	HANDLE h = (HANDLE)(uintptr_t)arg_u64(env, args[0]);
	uint32_t access = (uint32_t)arg_u64(env, args[1]);
	uint32_t offHigh = (uint32_t)arg_u64(env, args[2]);
	uint32_t offLow = (uint32_t)arg_u64(env, args[3]);
	size_t bytes = (size_t)arg_u64(env, args[4]);
	void* base = MapViewOfFile(h, access, offHigh, offLow, bytes);
	DWORD err = (base == NULL) ? GetLastError() : 0;
	return make_handle_result(env, (uint64_t)(uintptr_t)base, err);
}

/* openMutexW(desiredAccess, inherit, name) -> { value, lastError } */
static napi_value OpenMutexW_(napi_env env, napi_callback_info info) {
	size_t argc = 3;
	napi_value args[3];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	uint32_t access = (uint32_t)arg_u64(env, args[0]);
	bool inherit = false;
	napi_get_value_bool(env, args[1], &inherit);
	WCHAR* name = arg_wstr(env, args[2]);
	HANDLE h = OpenMutexW(access, inherit, name);
	DWORD err = (h == NULL) ? GetLastError() : 0;
	free_wstr(name);
	return make_handle_result(env, (uint64_t)(uintptr_t)h, err);
}

/* readInto(base: BigInt, dest: Buffer, bytes: number) — copies mapped memory
 * into the caller's Buffer (the reader's reusable scratch; no per-tick
 * allocation). Throws on NULL base or a copy larger than the Buffer. */
static napi_value ReadInto_(napi_env env, napi_callback_info info) {
	size_t argc = 3;
	napi_value args[3];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	uint64_t base = arg_u64(env, args[0]);
	void* dest = NULL;
	size_t destLen = 0;
	NAPI_CALL(env, napi_get_buffer_info(env, args[1], &dest, &destLen));
	uint64_t bytes = arg_u64(env, args[2]);
	if (base == 0) {
		napi_throw_error(env, NULL, "readInto: NULL base");
		return NULL;
	}
	if (bytes > destLen) {
		napi_throw_error(env, NULL, "readInto: copy exceeds destination Buffer");
		return NULL;
	}
	RtlMoveMemory(dest, (const void*)(uintptr_t)base, (SIZE_T)bytes);
	return NULL;
}

static napi_value UnmapViewOfFile_(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	BOOL ok = UnmapViewOfFile((void*)(uintptr_t)arg_u64(env, args[0]));
	napi_value out;
	napi_get_boolean(env, ok != 0, &out);
	return out;
}

static napi_value CloseHandle_(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	BOOL ok = CloseHandle((HANDLE)(uintptr_t)arg_u64(env, args[0]));
	napi_value out;
	napi_get_boolean(env, ok != 0, &out);
	return out;
}

static napi_value WaitForSingleObject_(napi_env env, napi_callback_info info) {
	size_t argc = 2;
	napi_value args[2];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	DWORD r = WaitForSingleObject((HANDLE)(uintptr_t)arg_u64(env, args[0]), (DWORD)arg_u64(env, args[1]));
	napi_value out;
	napi_create_uint32(env, r, &out);
	return out;
}

static napi_value ReleaseMutex_(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	BOOL ok = ReleaseMutex((HANDLE)(uintptr_t)arg_u64(env, args[0]));
	napi_value out;
	napi_get_boolean(env, ok != 0, &out);
	return out;
}

/* regOpenKeyExW(hiveOrHkey: BigInt, subkey: string, sam: number) -> { status, hkey } */
static napi_value RegOpenKeyExW_(napi_env env, napi_callback_info info) {
	size_t argc = 3;
	napi_value args[3];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	HKEY hive = (HKEY)(uintptr_t)arg_u64(env, args[0]);
	WCHAR* subkey = arg_wstr(env, args[1]);
	uint32_t sam = (uint32_t)arg_u64(env, args[2]);
	HKEY hkey = NULL;
	LSTATUS status = RegOpenKeyExW(hive, subkey, 0, sam, &hkey);
	free_wstr(subkey);
	napi_value out, vs;
	napi_create_object(env, &out);
	napi_create_uint32(env, (uint32_t)status, &vs);
	napi_set_named_property(env, out, "status", vs);
	napi_set_named_property(env, out, "hkey", make_u64(env, (uint64_t)(uintptr_t)hkey));
	return out;
}

/* regQueryValueExW(hkey: BigInt, name: string) -> { status, type, data: Buffer } */
static napi_value RegQueryValueExW_(napi_env env, napi_callback_info info) {
	size_t argc = 2;
	napi_value args[2];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	HKEY hkey = (HKEY)(uintptr_t)arg_u64(env, args[0]);
	WCHAR* name = arg_wstr(env, args[1]);
	DWORD type = 0, size = 0;
	LSTATUS status = RegQueryValueExW(hkey, name, NULL, &type, NULL, &size);
	napi_value out = NULL, v = NULL;
	napi_create_object(env, &out);
	if (status == ERROR_SUCCESS && size > 0) {
		void* data = NULL;
		napi_value buf = NULL;
		if (napi_create_buffer(env, size, &data, &buf) != napi_ok) {
			free_wstr(name);
			napi_throw_error(env, NULL, "regQueryValueExW: buffer allocation failed");
			return NULL;
		}
		status = RegQueryValueExW(hkey, name, NULL, &type, (LPBYTE)data, &size);
		napi_set_named_property(env, out, "data", buf);
	} else {
		void* d = NULL;
		napi_value empty = NULL;
		napi_create_buffer(env, 0, &d, &empty);
		napi_set_named_property(env, out, "data", empty);
	}
	free_wstr(name);
	napi_create_uint32(env, (uint32_t)status, &v);
	napi_set_named_property(env, out, "status", v);
	napi_create_uint32(env, type, &v);
	napi_set_named_property(env, out, "type", v);
	return out;
}

static napi_value RegCloseKey_(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1];
	NAPI_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
	LSTATUS status = RegCloseKey((HKEY)(uintptr_t)arg_u64(env, args[0]));
	napi_value out;
	napi_create_uint32(env, (uint32_t)status, &out);
	return out;
}

static napi_value Init(napi_env env, napi_value exports) {
	const napi_property_descriptor props[] = {
		{ "openFileMappingW", NULL, OpenFileMappingW_, NULL, NULL, NULL, napi_default, NULL },
		{ "mapViewOfFile", NULL, MapViewOfFile_, NULL, NULL, NULL, napi_default, NULL },
		{ "readInto", NULL, ReadInto_, NULL, NULL, NULL, napi_default, NULL },
		{ "unmapViewOfFile", NULL, UnmapViewOfFile_, NULL, NULL, NULL, napi_default, NULL },
		{ "closeHandle", NULL, CloseHandle_, NULL, NULL, NULL, napi_default, NULL },
		{ "openMutexW", NULL, OpenMutexW_, NULL, NULL, NULL, napi_default, NULL },
		{ "waitForSingleObject", NULL, WaitForSingleObject_, NULL, NULL, NULL, napi_default, NULL },
		{ "releaseMutex", NULL, ReleaseMutex_, NULL, NULL, NULL, napi_default, NULL },
		{ "regOpenKeyExW", NULL, RegOpenKeyExW_, NULL, NULL, NULL, napi_default, NULL },
		{ "regQueryValueExW", NULL, RegQueryValueExW_, NULL, NULL, NULL, napi_default, NULL },
		{ "regCloseKey", NULL, RegCloseKey_, NULL, NULL, NULL, napi_default, NULL },
	};
	napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
	return exports;
}

NAPI_MODULE(hwsm, Init)
