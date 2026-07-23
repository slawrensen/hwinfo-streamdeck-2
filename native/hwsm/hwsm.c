/*
 * hwsm: the plugin's first-party N-API addon for reading HWiNFO. It exposes
 * a capability-shaped API, not Win32:
 *
 *   getBuildInfo()                          startup metadata (protocol, ABI)
 *   openSharedMemory(mappingName, mutexName) -> SharedMemorySession
 *       .byteLength                         exact validated mapping length
 *       .readInto(dest: Buffer) -> number   one guarded snapshot copy; 0 = busy
 *       .close()                            idempotent
 *   openGadgetKey(subkey) -> GadgetKey      HKCU only, KEY_QUERY_VALUE only
 *       .queryString(name) -> string|null   REG_SZ read, null = value absent
 *       .close()                            idempotent
 *
 * No handle, pointer, address, access mask, or registry root ever crosses
 * the JavaScript boundary. Sessions are napi_wrap'd structs identified by
 * N-API type tags, so JavaScript cannot invent, forge, or replay a native
 * resource; the only authority JavaScript holds is the opaque object itself.
 *
 * Failure surfaces as Error objects with a stable `code` (HWSM_*), the
 * `operation` that failed, and `win32Error` when one exists. GetLastError()
 * is always captured before any further call can clobber it. Registry
 * operations report their LSTATUS, never GetLastError().
 *
 * The shared-memory read path is one complete native transaction: acquire
 * HWiNFO's consistency mutex (0 ms; busy means "skip this tick"), validate
 * the header against the session's exact mapped length, copy, release.
 * WAIT_ABANDONED and WAIT_FAILED are terminal: the session invalidates and
 * no bytes are ever reported. A read is never attempted without ownership.
 *
 * Built as C with stable Node-API 8 only (NAPI_VERSION pinned in
 * binding.gyp); no node.h, no V8, no libuv. The hwsm_test target compiles
 * the same source with HWSM_TEST_HOOKS for fault injection; the release
 * hwsm.node contains none of that code.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <assert.h>
#include <node_api.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "hwsm-version.h"

#if defined(_M_X64)
#define HWSM_ARCH "x64"
#elif defined(_M_ARM64)
#define HWSM_ARCH "arm64"
#else
#error hwsm supports x64 and arm64 Windows only
#endif

/* ------------------------------------------------------------------------- *
 * HWiNFO shared-memory header (44 bytes, packed, little-endian).
 * Must match src/hwinfo/layout.ts exactly; both trace to the publicly
 * documented field layout of the interface (see NOTICE.md).
 * ------------------------------------------------------------------------- */

#pragma pack(push, 1)
typedef struct {
	uint32_t magic;
	uint32_t version;
	uint32_t revision;
	int64_t pollTime;
	uint32_t sensorSectionOffset;
	uint32_t sensorElementSize;
	uint32_t sensorElementCount;
	uint32_t entrySectionOffset;
	uint32_t entryElementSize;
	uint32_t entryElementCount;
} HwsmHeader;
#pragma pack(pop)

/* Compile-time assert usable in every MSVC C mode (no /std dependency):
 * a negative array size makes any violated layout fact a build error. */
#define HWSM_STATIC_ASSERT(cond, tag) typedef char hwsm_static_assert_##tag[(cond) ? 1 : -1]

HWSM_STATIC_ASSERT(sizeof(HwsmHeader) == 44, header_size);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, magic) == 0, off_magic);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, version) == 4, off_version);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, revision) == 8, off_revision);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, pollTime) == 12, off_pollTime);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, sensorSectionOffset) == 20, off_sensorSectionOffset);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, sensorElementSize) == 24, off_sensorElementSize);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, sensorElementCount) == 28, off_sensorElementCount);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, entrySectionOffset) == 32, off_entrySectionOffset);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, entryElementSize) == 36, off_entryElementSize);
HWSM_STATIC_ASSERT(offsetof(HwsmHeader, entryElementCount) == 40, off_entryElementCount);

#define HWSM_HEADER_SIZE 44u
/* "HWiS" / "DEAD" stored little-endian (layout.ts MAGIC_ACTIVE/MAGIC_DEAD). */
#define HWSM_MAGIC_ACTIVE 0x53695748u
#define HWSM_MAGIC_DEAD 0x44414544u
/* Classic (minimum) element strides; HWiNFO appends fields, so real strides
 * may be larger and are always taken from the header. */
#define HWSM_SENSOR_MIN_STRIDE 264u
#define HWSM_ENTRY_MIN_STRIDE 316u
/* Sanity bounds, mirrored from layout.ts (MAX_REGION_BYTES / MAX_ELEMENT_COUNT). */
#define HWSM_MAX_REGION_BYTES (64u * 1024u * 1024u)
#define HWSM_MAX_ELEMENT_COUNT 100000u

/* Bounded open-time mutex wait; steady-state readInto uses 0 ms (skip tick). */
#define HWSM_OPEN_WAIT_MS 500u
/* Bounded re-validate retries when the layout moves between open stages. */
#define HWSM_OPEN_ATTEMPTS 3
/* Kernel object names and registry subkeys are short; longer is caller error. */
#define HWSM_MAX_NAME_CHARS 511
/* Hard cap for one registry value (bytes) and the MORE_DATA retry budget. */
#define HWSM_REG_MAX_BYTES (64u * 1024u)
#define HWSM_REG_ATTEMPTS 4

/* ------------------------------------------------------------------------- *
 * Error plumbing. HwsmFail carries a failure across pure-Win32 helpers
 * (which make no Node-API calls, so GetLastError() stays trustworthy);
 * throw_fail() turns one into a pending JavaScript exception.
 * ------------------------------------------------------------------------- */

typedef struct {
	const char* code; /* "HWSM_*", static */
	const char* operation; /* Win32 call or contract step, static */
	DWORD win32; /* 0 = no Win32 error to report */
	const char* detail; /* optional static human detail */
} HwsmFail;

static const char* const CODE_NOT_FOUND = "HWSM_NOT_FOUND";
static const char* const CODE_ACCESS_DENIED = "HWSM_ACCESS_DENIED";
static const char* const CODE_DISABLED = "HWSM_DISABLED";
static const char* const CODE_INVALID_LAYOUT = "HWSM_INVALID_LAYOUT";
static const char* const CODE_LAYOUT_CHANGED = "HWSM_LAYOUT_CHANGED";
static const char* const CODE_MUTEX_NOT_FOUND = "HWSM_MUTEX_NOT_FOUND";
static const char* const CODE_MUTEX_BUSY = "HWSM_MUTEX_BUSY";
static const char* const CODE_ABANDONED = "HWSM_ABANDONED";
static const char* const CODE_WAIT_FAILED = "HWSM_WAIT_FAILED";
static const char* const CODE_RELEASE_FAILED = "HWSM_RELEASE_FAILED";
static const char* const CODE_MAP_FAILED = "HWSM_MAP_FAILED";
static const char* const CODE_SESSION_CLOSED = "HWSM_SESSION_CLOSED";
static const char* const CODE_SESSION_INVALIDATED = "HWSM_SESSION_INVALIDATED";
static const char* const CODE_BUFFER_TOO_SMALL = "HWSM_BUFFER_TOO_SMALL";
static const char* const CODE_REG_NOT_FOUND = "HWSM_REGISTRY_NOT_FOUND";
static const char* const CODE_REG_ACCESS_DENIED = "HWSM_REGISTRY_ACCESS_DENIED";
static const char* const CODE_REG_WRONG_TYPE = "HWSM_REGISTRY_WRONG_TYPE";
static const char* const CODE_REG_INVALID_DATA = "HWSM_REGISTRY_INVALID_DATA";
static const char* const CODE_REG_FAILED = "HWSM_REGISTRY_FAILED";

/* Creates and throws Error{code, operation, win32Error?}. Always leaves a
 * pending exception (a plain throw as last resort); returns NULL so callers
 * can `return throw_fail(...)`. */
static napi_value throw_fail(napi_env env, const HwsmFail* f) {
	char text[256];
	if (f->win32 != 0) {
		snprintf(text, sizeof(text), "%s: %s failed (Win32 error %lu)%s%s", f->code, f->operation, (unsigned long)f->win32, f->detail != NULL ? ": " : "", f->detail != NULL ? f->detail : "");
	} else {
		snprintf(text, sizeof(text), "%s: %s%s%s", f->code, f->operation, f->detail != NULL ? ": " : "", f->detail != NULL ? f->detail : "");
	}
	napi_value codeVal = NULL;
	napi_value msgVal = NULL;
	napi_value errVal = NULL;
	if (napi_create_string_utf8(env, f->code, NAPI_AUTO_LENGTH, &codeVal) != napi_ok ||
		napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &msgVal) != napi_ok ||
		napi_create_error(env, codeVal, msgVal, &errVal) != napi_ok) {
		napi_throw_error(env, f->code, text);
		return NULL;
	}
	napi_value opVal = NULL;
	if (napi_create_string_utf8(env, f->operation, NAPI_AUTO_LENGTH, &opVal) == napi_ok) {
		napi_set_named_property(env, errVal, "operation", opVal);
	}
	if (f->win32 != 0) {
		napi_value w32Val = NULL;
		if (napi_create_uint32(env, (uint32_t)f->win32, &w32Val) == napi_ok) {
			napi_set_named_property(env, errVal, "win32Error", w32Val);
		}
	}
	napi_throw(env, errVal);
	return NULL;
}

static napi_value throw_type(napi_env env, const char* msg) {
	napi_throw_type_error(env, "HWSM_BAD_ARGUMENT", msg);
	return NULL;
}

static napi_value throw_range(napi_env env, const char* code, const char* msg) {
	napi_throw_range_error(env, code, msg);
	return NULL;
}

/* ------------------------------------------------------------------------- *
 * Checked size arithmetic. All layout math runs through these before any
 * value is used as a length or offset.
 * ------------------------------------------------------------------------- */

static int checked_add_size(size_t a, size_t b, size_t* out) {
	if (a > SIZE_MAX - b) {
		return 0;
	}
	*out = a + b;
	return 1;
}

static int checked_mul_size(size_t a, size_t b, size_t* out) {
	if (b != 0 && a > SIZE_MAX / b) {
		return 0;
	}
	*out = a * b;
	return 1;
}

/* offset + stride*count for one section; count 0 contributes nothing. */
static int checked_section_end(uint32_t offset, uint32_t stride, uint32_t count, size_t* out) {
	size_t bytes = 0;
	if (!checked_mul_size((size_t)stride, (size_t)count, &bytes)) {
		return 0;
	}
	return checked_add_size((size_t)offset, bytes, out);
}

/* ------------------------------------------------------------------------- *
 * Header validation. Everything the layout claims is proven here before a
 * single byte beyond the header is trusted.
 * ------------------------------------------------------------------------- */

typedef enum {
	LAYOUT_OK = 0,
	LAYOUT_DEAD, /* magic "DEAD": shared-memory support disabled */
	LAYOUT_BAD
} LayoutStatus;

static LayoutStatus validate_header(const HwsmHeader* h, size_t* requiredOut, const char** whyOut) {
	*whyOut = "";
	if (h->magic == HWSM_MAGIC_DEAD) {
		return LAYOUT_DEAD;
	}
	if (h->magic != HWSM_MAGIC_ACTIVE) {
		*whyOut = "header magic is neither ACTIVE nor DEAD";
		return LAYOUT_BAD;
	}
	if (h->sensorElementCount > HWSM_MAX_ELEMENT_COUNT || h->entryElementCount > HWSM_MAX_ELEMENT_COUNT) {
		*whyOut = "implausible element count";
		return LAYOUT_BAD;
	}
	size_t sensorEnd = HWSM_HEADER_SIZE;
	size_t entryEnd = HWSM_HEADER_SIZE;
	if (h->sensorElementCount > 0) {
		if (h->sensorElementSize < HWSM_SENSOR_MIN_STRIDE) {
			*whyOut = "sensor stride below the classic minimum";
			return LAYOUT_BAD;
		}
		if (h->sensorSectionOffset < HWSM_HEADER_SIZE) {
			*whyOut = "sensor section starts inside the header";
			return LAYOUT_BAD;
		}
		if (!checked_section_end(h->sensorSectionOffset, h->sensorElementSize, h->sensorElementCount, &sensorEnd)) {
			*whyOut = "sensor section size overflows";
			return LAYOUT_BAD;
		}
	}
	if (h->entryElementCount > 0) {
		if (h->entryElementSize < HWSM_ENTRY_MIN_STRIDE) {
			*whyOut = "reading stride below the classic minimum";
			return LAYOUT_BAD;
		}
		if (h->entrySectionOffset < HWSM_HEADER_SIZE) {
			*whyOut = "reading section starts inside the header";
			return LAYOUT_BAD;
		}
		if (!checked_section_end(h->entrySectionOffset, h->entryElementSize, h->entryElementCount, &entryEnd)) {
			*whyOut = "reading section size overflows";
			return LAYOUT_BAD;
		}
	}
	if (h->sensorElementCount > 0 && h->entryElementCount > 0) {
		/* The two arrays may not interleave; overlapping sections mean a
		 * corrupt header, not a future layout (HWiNFO only appends). */
		const size_t sOff = h->sensorSectionOffset;
		const size_t eOff = h->entrySectionOffset;
		if (!(sensorEnd <= eOff || entryEnd <= sOff)) {
			*whyOut = "sensor and reading sections overlap";
			return LAYOUT_BAD;
		}
	}
	size_t required = HWSM_HEADER_SIZE;
	if (sensorEnd > required) {
		required = sensorEnd;
	}
	if (entryEnd > required) {
		required = entryEnd;
	}
	if (required > HWSM_MAX_REGION_BYTES) {
		*whyOut = "claimed region exceeds the 64 MiB bound";
		return LAYOUT_BAD;
	}
	*requiredOut = required;
	return LAYOUT_OK;
}

/* ------------------------------------------------------------------------- *
 * SharedMemorySession: owns the mapping handle, the mutex handle, and the
 * exact-length view. One cleanup route; safe to run repeatedly.
 * ------------------------------------------------------------------------- */

typedef struct {
	HANDLE hMap;
	HANDLE hMutex;
	const BYTE* view;
	size_t viewLength; /* exact mapped length == validated required length */
	BOOL closed;
	BOOL invalidated;
#ifdef HWSM_TEST_HOOKS
	BOOL testFailNextWait;
	BOOL testFailNextRelease;
#endif
} SharedSession;

/* The one cleanup route. Ordering per the ownership contract: mark closed
 * (no new wait can start), unmap, close mapping, close mutex, null fields.
 * Never touches Node-API; never waits; tolerates partial construction and
 * repeated invocation, so explicit close, invalidation, and the finalizer
 * all funnel here. */
static void session_cleanup(SharedSession* s) {
	if (s->closed) {
		return;
	}
	s->closed = TRUE;
	if (s->view != NULL) {
		UnmapViewOfFile((LPCVOID)s->view);
		s->view = NULL;
	}
	if (s->hMap != NULL) {
		CloseHandle(s->hMap);
		s->hMap = NULL;
	}
	if (s->hMutex != NULL) {
		CloseHandle(s->hMutex);
		s->hMutex = NULL;
	}
}

/* A synchronization or layout failure poisons the session permanently. */
static void session_invalidate(SharedSession* s) {
	s->invalidated = TRUE;
	session_cleanup(s);
}

static void session_finalize(napi_env env, void* data, void* hint) {
	(void)env;
	(void)hint;
	SharedSession* s = (SharedSession*)data;
	session_cleanup(s);
	HeapFree(GetProcessHeap(), 0, s);
}

/* 128-bit type tags: the proof an object was wrapped by THIS addon.
 * JavaScript cannot mint or copy them onto invented objects. */
static const napi_type_tag SESSION_TYPE_TAG = { 0x9b7c2f4e8a1d4c63ull, 0xb45f0e2a7d9c4181ull };
static const napi_type_tag GADGET_TYPE_TAG = { 0x51c8ee29f6a94b02ull, 0x8d34ba6c1e0f4977ull };

/* Receiver validation shared by all methods: cb info -> type tag -> unwrap.
 * Throws TypeError and returns NULL unless `this` is a live wrap of ours. */
static void* unwrap_receiver(napi_env env, napi_callback_info info, const napi_type_tag* tag, const char* expected, size_t* argc, napi_value* args) {
	napi_value thisArg = NULL;
	if (napi_get_cb_info(env, info, argc, args, &thisArg, NULL) != napi_ok) {
		throw_type(env, "hwsm: failed to read callback info");
		return NULL;
	}
	bool tagged = false;
	if (thisArg == NULL || napi_check_object_type_tag(env, thisArg, tag, &tagged) != napi_ok || !tagged) {
		throw_type(env, expected);
		return NULL;
	}
	void* native = NULL;
	if (napi_unwrap(env, thisArg, &native) != napi_ok || native == NULL) {
		throw_type(env, expected);
		return NULL;
	}
	return native;
}

/* ------------------------------------------------------------------------- *
 * openSharedMemory: two-stage exact mapping.
 *
 * Stage A maps exactly the 44-byte header, copies it under the mutex, and
 * computes the required total length. Stage B maps exactly that length and
 * re-validates under the mutex; if the producer changed the layout between
 * stages, the whole attempt restarts (bounded). The mutex is mandatory: a
 * mapping without its mutex (producer mid-startup) is a transient failure,
 * never an unguarded read.
 * ------------------------------------------------------------------------- */

typedef enum {
	TRY_OPEN_OK = 0,
	TRY_OPEN_FAIL,
	TRY_OPEN_LAYOUT_MOVED
} TryOpenResult;

/* Pure Win32 (no Node-API): every GetLastError() is captured at the failing
 * call site. On TRY_OPEN_OK the session owns all resources; otherwise
 * everything acquired here has been released. */
static TryOpenResult try_open_once(const WCHAR* mappingName, const WCHAR* mutexName, SharedSession** out, HwsmFail* fail) {
	HANDLE hMap = NULL;
	HANDLE hMutex = NULL;
	const BYTE* headerView = NULL;
	const BYTE* view = NULL;
	TryOpenResult result = TRY_OPEN_FAIL;

	hMap = OpenFileMappingW(FILE_MAP_READ, FALSE, mappingName);
	if (hMap == NULL) {
		DWORD err = GetLastError();
		if (err == ERROR_ACCESS_DENIED) {
			*fail = (HwsmFail){ CODE_ACCESS_DENIED, "OpenFileMappingW", err, "the mapping exists but this process may not read it" };
		} else {
			*fail = (HwsmFail){ CODE_NOT_FOUND, "OpenFileMappingW", err, "shared-memory mapping not found" };
		}
		goto done;
	}

	hMutex = OpenMutexW(SYNCHRONIZE, FALSE, mutexName);
	if (hMutex == NULL) {
		DWORD err = GetLastError();
		if (err == ERROR_ACCESS_DENIED) {
			*fail = (HwsmFail){ CODE_ACCESS_DENIED, "OpenMutexW", err, "the consistency mutex exists but this process may not wait on it" };
		} else {
			*fail = (HwsmFail){ CODE_MUTEX_NOT_FOUND, "OpenMutexW", err, "the consistency mutex is required; a mapping without it is treated as still starting up" };
		}
		goto done;
	}

	/* Stage A: exact header view. A mapping physically smaller than the
	 * header makes this MapViewOfFile fail cleanly. */
	headerView = (const BYTE*)MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, HWSM_HEADER_SIZE);
	if (headerView == NULL) {
		*fail = (HwsmFail){ CODE_MAP_FAILED, "MapViewOfFile", GetLastError(), "mapping the 44-byte header" };
		goto done;
	}

	HwsmHeader hdr;
	{
		DWORD w = WaitForSingleObject(hMutex, HWSM_OPEN_WAIT_MS);
		if (w == WAIT_TIMEOUT) {
			*fail = (HwsmFail){ CODE_MUTEX_BUSY, "WaitForSingleObject", 0, "the consistency mutex stayed busy during open" };
			goto done;
		}
		if (w == WAIT_ABANDONED) {
			/* We own the mutex but the protected bytes are suspect. Release
			 * exactly once and fail the open; a later attempt starts clean. */
			ReleaseMutex(hMutex);
			*fail = (HwsmFail){ CODE_ABANDONED, "WaitForSingleObject", 0, "the producer died while holding the consistency mutex" };
			goto done;
		}
		if (w != WAIT_OBJECT_0) {
			*fail = (HwsmFail){ CODE_WAIT_FAILED, "WaitForSingleObject", GetLastError(), NULL };
			goto done;
		}
		memcpy(&hdr, headerView, sizeof(hdr));
		if (!ReleaseMutex(hMutex)) {
			*fail = (HwsmFail){ CODE_RELEASE_FAILED, "ReleaseMutex", GetLastError(), NULL };
			goto done;
		}
	}

	size_t required = 0;
	const char* why = "";
	LayoutStatus ls = validate_header(&hdr, &required, &why);
	if (ls == LAYOUT_DEAD) {
		*fail = (HwsmFail){ CODE_DISABLED, "header validation", 0, "shared-memory support is disabled (magic DEAD)" };
		goto done;
	}
	if (ls != LAYOUT_OK) {
		*fail = (HwsmFail){ CODE_INVALID_LAYOUT, "header validation", 0, why };
		goto done;
	}

	UnmapViewOfFile((LPCVOID)headerView);
	headerView = NULL;

	/* Stage B: exact complete view. If the mapping is physically smaller
	 * than the header's claim, this fails cleanly (no partial view). */
	view = (const BYTE*)MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, required);
	if (view == NULL) {
		*fail = (HwsmFail){ CODE_MAP_FAILED, "MapViewOfFile", GetLastError(), "the mapping is smaller than the layout its header claims" };
		goto done;
	}

	{
		DWORD w = WaitForSingleObject(hMutex, HWSM_OPEN_WAIT_MS);
		if (w == WAIT_TIMEOUT) {
			*fail = (HwsmFail){ CODE_MUTEX_BUSY, "WaitForSingleObject", 0, "the consistency mutex stayed busy during open" };
			goto done;
		}
		if (w == WAIT_ABANDONED) {
			ReleaseMutex(hMutex);
			*fail = (HwsmFail){ CODE_ABANDONED, "WaitForSingleObject", 0, "the producer died while holding the consistency mutex" };
			goto done;
		}
		if (w != WAIT_OBJECT_0) {
			*fail = (HwsmFail){ CODE_WAIT_FAILED, "WaitForSingleObject", GetLastError(), NULL };
			goto done;
		}
		HwsmHeader hdr2;
		memcpy(&hdr2, view, sizeof(hdr2));
		if (!ReleaseMutex(hMutex)) {
			*fail = (HwsmFail){ CODE_RELEASE_FAILED, "ReleaseMutex", GetLastError(), NULL };
			goto done;
		}

		size_t required2 = 0;
		LayoutStatus ls2 = validate_header(&hdr2, &required2, &why);
		if (ls2 == LAYOUT_DEAD) {
			*fail = (HwsmFail){ CODE_DISABLED, "header validation", 0, "shared-memory support is disabled (magic DEAD)" };
			goto done;
		}
		if (ls2 != LAYOUT_OK) {
			*fail = (HwsmFail){ CODE_INVALID_LAYOUT, "header validation", 0, why };
			goto done;
		}
		if (required2 != required) {
			result = TRY_OPEN_LAYOUT_MOVED;
			goto done;
		}
	}

	{
		SharedSession* s = (SharedSession*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(SharedSession));
		if (s == NULL) {
			*fail = (HwsmFail){ CODE_MAP_FAILED, "HeapAlloc", ERROR_NOT_ENOUGH_MEMORY, "allocating the session" };
			goto done;
		}
		s->hMap = hMap;
		s->hMutex = hMutex;
		s->view = view;
		s->viewLength = required;
		*out = s;
		return TRY_OPEN_OK; /* ownership moved into the session */
	}

done:
	if (headerView != NULL) {
		UnmapViewOfFile((LPCVOID)headerView);
	}
	if (view != NULL) {
		UnmapViewOfFile((LPCVOID)view);
	}
	if (hMutex != NULL) {
		CloseHandle(hMutex);
	}
	if (hMap != NULL) {
		CloseHandle(hMap);
	}
	return result;
}

/* Extracts a required non-empty string arg into a fixed WCHAR buffer. */
static int arg_name(napi_env env, napi_value v, WCHAR* buf, size_t bufChars, const char* what) {
	napi_valuetype t = napi_undefined;
	if (napi_typeof(env, v, &t) != napi_ok || t != napi_string) {
		throw_type(env, what);
		return 0;
	}
	size_t len = 0;
	if (napi_get_value_string_utf16(env, v, (char16_t*)buf, bufChars, &len) != napi_ok) {
		throw_type(env, what);
		return 0;
	}
	if (len == 0) {
		throw_range(env, "HWSM_BAD_ARGUMENT", what);
		return 0;
	}
	if (len >= bufChars - 1) {
		throw_range(env, "HWSM_BAD_ARGUMENT", what);
		return 0;
	}
	return 1;
}

static napi_value session_read_into(napi_env env, napi_callback_info info);
static napi_value session_close(napi_env env, napi_callback_info info);
static napi_value session_byte_length(napi_env env, napi_callback_info info);
#ifdef HWSM_TEST_HOOKS
static napi_value session_test_control(napi_env env, napi_callback_info info);
#endif

static napi_value make_session_object(napi_env env, SharedSession* s) {
	napi_value obj = NULL;
	const napi_property_descriptor props[] = {
		{ "byteLength", NULL, NULL, session_byte_length, NULL, NULL, napi_enumerable, NULL },
		{ "readInto", NULL, session_read_into, NULL, NULL, NULL, napi_default, NULL },
		{ "close", NULL, session_close, NULL, NULL, NULL, napi_default, NULL },
#ifdef HWSM_TEST_HOOKS
		{ "_testControl", NULL, session_test_control, NULL, NULL, NULL, napi_default, NULL },
#endif
	};
	if (napi_create_object(env, &obj) != napi_ok ||
		napi_define_properties(env, obj, sizeof(props) / sizeof(props[0]), props) != napi_ok ||
		napi_type_tag_object(env, obj, &SESSION_TYPE_TAG) != napi_ok ||
		napi_wrap(env, obj, s, session_finalize, NULL, NULL) != napi_ok) {
		/* The wrap never took ownership: release resources here. */
		session_cleanup(s);
		HeapFree(GetProcessHeap(), 0, s);
		napi_throw_error(env, NULL, "hwsm: failed to construct the session object");
		return NULL;
	}
	return obj;
}

static napi_value OpenSharedMemory(napi_env env, napi_callback_info info) {
	size_t argc = 2;
	napi_value args[2] = { NULL, NULL };
	if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) {
		return throw_type(env, "hwsm: failed to read callback info");
	}
	if (argc < 2) {
		return throw_type(env, "openSharedMemory(mappingName, mutexName) requires two string arguments");
	}
	WCHAR mappingName[HWSM_MAX_NAME_CHARS + 1];
	WCHAR mutexName[HWSM_MAX_NAME_CHARS + 1];
	if (!arg_name(env, args[0], mappingName, HWSM_MAX_NAME_CHARS + 1, "mappingName must be a non-empty string of at most 510 characters")) {
		return NULL;
	}
	if (!arg_name(env, args[1], mutexName, HWSM_MAX_NAME_CHARS + 1, "mutexName must be a non-empty string of at most 510 characters")) {
		return NULL;
	}

	SharedSession* session = NULL;
	HwsmFail fail = { CODE_LAYOUT_CHANGED, "openSharedMemory", 0, "the layout kept changing between validation stages" };
	for (int attempt = 0; attempt < HWSM_OPEN_ATTEMPTS; attempt++) {
		TryOpenResult r = try_open_once(mappingName, mutexName, &session, &fail);
		if (r == TRY_OPEN_OK) {
			return make_session_object(env, session);
		}
		if (r == TRY_OPEN_FAIL) {
			return throw_fail(env, &fail);
		}
		/* TRY_OPEN_LAYOUT_MOVED: bounded retry with everything released. */
	}
	return throw_fail(env, &fail);
}

/* One complete guarded read transaction; see the file header for the
 * contract. Returns the exact copied byte count, or 0 when the mutex was
 * busy (nothing copied, nothing released). */
static napi_value session_read_into(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1] = { NULL };
	SharedSession* s = (SharedSession*)unwrap_receiver(env, info, &SESSION_TYPE_TAG, "readInto must be called on a hwsm SharedMemorySession", &argc, args);
	if (s == NULL) {
		return NULL;
	}
	if (s->invalidated) {
		HwsmFail f = { CODE_SESSION_INVALIDATED, "readInto", 0, "the session was invalidated by an earlier failure; open a new one" };
		return throw_fail(env, &f);
	}
	if (s->closed) {
		HwsmFail f = { CODE_SESSION_CLOSED, "readInto", 0, "the session is closed" };
		return throw_fail(env, &f);
	}
	if (argc < 1) {
		return throw_type(env, "readInto(destination) requires a Buffer argument");
	}
	bool isBuffer = false;
	if (napi_is_buffer(env, args[0], &isBuffer) != napi_ok || !isBuffer) {
		return throw_type(env, "readInto destination must be a Buffer");
	}
	void* dest = NULL;
	size_t destLen = 0;
	if (napi_get_buffer_info(env, args[0], &dest, &destLen) != napi_ok || (dest == NULL && destLen > 0)) {
		return throw_type(env, "readInto destination must be a Buffer with backing storage");
	}
	if (destLen < s->viewLength) {
		return throw_range(env, CODE_BUFFER_TOO_SMALL, "readInto destination is smaller than session.byteLength");
	}

	/* --- the guarded transaction: no Node-API calls from here to release --- */
	DWORD w;
#ifdef HWSM_TEST_HOOKS
	if (s->testFailNextWait) {
		s->testFailNextWait = FALSE;
		SetLastError(ERROR_INVALID_HANDLE);
		w = WAIT_FAILED;
	} else
#endif
	w = WaitForSingleObject(s->hMutex, 0);

	if (w == WAIT_TIMEOUT) {
		/* No ownership: no copy, no release, not an error. */
		napi_value zero = NULL;
		napi_create_uint32(env, 0, &zero);
		return zero;
	}
	if (w == WAIT_ABANDONED) {
		/* We own the mutex, but the snapshot under it is not trustworthy.
		 * Release exactly once, poison the session, report no data. */
		ReleaseMutex(s->hMutex);
		session_invalidate(s);
		HwsmFail f = { CODE_ABANDONED, "WaitForSingleObject", 0, "the producer died while holding the consistency mutex; the snapshot was discarded" };
		return throw_fail(env, &f);
	}
	if (w != WAIT_OBJECT_0) {
		DWORD err = GetLastError();
		session_invalidate(s);
		HwsmFail f = { CODE_WAIT_FAILED, "WaitForSingleObject", err, NULL };
		return throw_fail(env, &f);
	}

	/* Ownership established. Validate, then copy exactly viewLength bytes. */
	HwsmHeader hdr;
	memcpy(&hdr, s->view, sizeof(hdr));
	size_t required = 0;
	const char* why = "";
	LayoutStatus ls = validate_header(&hdr, &required, &why);
	const char* failCode = NULL;
	const char* failDetail = NULL;
	if (ls == LAYOUT_DEAD) {
		failCode = CODE_DISABLED;
		failDetail = "shared-memory support was disabled while the session was open (magic DEAD)";
	} else if (ls != LAYOUT_OK) {
		failCode = CODE_LAYOUT_CHANGED;
		failDetail = why;
	} else if (required != s->viewLength) {
		failCode = CODE_LAYOUT_CHANGED;
		failDetail = "the header now claims a different total size than this session mapped";
	} else {
		memcpy(dest, s->view, s->viewLength);
	}

	BOOL released = ReleaseMutex(s->hMutex);
	DWORD releaseErr = released ? 0 : GetLastError();
#ifdef HWSM_TEST_HOOKS
	if (s->testFailNextRelease) {
		/* The real release above kept the mutex healthy; only the reported
		 * outcome is forced, so the failure HANDLING path is what's tested. */
		s->testFailNextRelease = FALSE;
		released = FALSE;
		releaseErr = ERROR_INVALID_HANDLE;
	}
#endif
	if (!released) {
		session_invalidate(s);
		HwsmFail f = { CODE_RELEASE_FAILED, "ReleaseMutex", releaseErr, "the copied snapshot was discarded" };
		return throw_fail(env, &f);
	}
	if (failCode != NULL) {
		session_invalidate(s);
		HwsmFail f = { failCode, "readInto", 0, failDetail };
		return throw_fail(env, &f);
	}

	napi_value count = NULL;
	if (napi_create_uint32(env, (uint32_t)s->viewLength, &count) != napi_ok) {
		napi_throw_error(env, NULL, "hwsm: failed to create the result value");
		return NULL;
	}
	return count;
}

static napi_value session_close(napi_env env, napi_callback_info info) {
	size_t argc = 0;
	SharedSession* s = (SharedSession*)unwrap_receiver(env, info, &SESSION_TYPE_TAG, "close must be called on a hwsm SharedMemorySession", &argc, NULL);
	if (s == NULL) {
		return NULL;
	}
	session_cleanup(s); /* idempotent, including after invalidation */
	napi_value undef = NULL;
	napi_get_undefined(env, &undef);
	return undef;
}

static napi_value session_byte_length(napi_env env, napi_callback_info info) {
	size_t argc = 0;
	SharedSession* s = (SharedSession*)unwrap_receiver(env, info, &SESSION_TYPE_TAG, "byteLength must be read on a hwsm SharedMemorySession", &argc, NULL);
	if (s == NULL) {
		return NULL;
	}
	napi_value out = NULL;
	if (napi_create_uint32(env, (uint32_t)s->viewLength, &out) != napi_ok) {
		napi_throw_error(env, NULL, "hwsm: failed to create the result value");
		return NULL;
	}
	return out;
}

#ifdef HWSM_TEST_HOOKS
/* Test-build-only fault injection: _testControl("failNextWait" |
 * "failNextRelease"). Exists ONLY in the hwsm_test target; the release
 * addon compiles none of this. */
static napi_value session_test_control(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1] = { NULL };
	SharedSession* s = (SharedSession*)unwrap_receiver(env, info, &SESSION_TYPE_TAG, "_testControl must be called on a hwsm SharedMemorySession", &argc, args);
	if (s == NULL) {
		return NULL;
	}
	char what[32] = { 0 };
	size_t len = 0;
	if (argc < 1 || napi_get_value_string_utf8(env, args[0], what, sizeof(what), &len) != napi_ok) {
		return throw_type(env, "_testControl requires a mode string");
	}
	if (strcmp(what, "failNextWait") == 0) {
		s->testFailNextWait = TRUE;
	} else if (strcmp(what, "failNextRelease") == 0) {
		s->testFailNextRelease = TRUE;
	} else {
		return throw_type(env, "_testControl mode must be failNextWait or failNextRelease");
	}
	napi_value undef = NULL;
	napi_get_undefined(env, &undef);
	return undef;
}
#endif

/* ------------------------------------------------------------------------- *
 * GadgetKey: owns one HKCU subkey handle (KEY_QUERY_VALUE only) and a
 * reusable native WCHAR buffer for value reads.
 * ------------------------------------------------------------------------- */

typedef struct {
	HKEY hkey;
	WCHAR* buf;
	DWORD bufBytes;
	BOOL closed;
} GadgetKey;

static BOOL is_predefined_hkey(HKEY k) {
	const uintptr_t v = (uintptr_t)k;
	/* Sign-extended HKEY_CLASSES_ROOT .. HKEY_CURRENT_USER_LOCAL_SETTINGS. */
	return v >= (uintptr_t)0xFFFFFFFF80000000ull && v <= (uintptr_t)0xFFFFFFFF80000007ull;
}

/* The one cleanup route: mark closed, close only a key this addon opened
 * (never a predefined root), free the value buffer, null everything. */
static void gadget_cleanup(GadgetKey* g) {
	if (g->closed) {
		return;
	}
	g->closed = TRUE;
	if (g->hkey != NULL && !is_predefined_hkey(g->hkey)) {
		RegCloseKey(g->hkey);
	}
	g->hkey = NULL;
	if (g->buf != NULL) {
		HeapFree(GetProcessHeap(), 0, g->buf);
		g->buf = NULL;
	}
	g->bufBytes = 0;
}

static void gadget_finalize(napi_env env, void* data, void* hint) {
	(void)env;
	(void)hint;
	GadgetKey* g = (GadgetKey*)data;
	gadget_cleanup(g);
	HeapFree(GetProcessHeap(), 0, g);
}

static napi_value gadget_query_string(napi_env env, napi_callback_info info);
static napi_value gadget_close(napi_env env, napi_callback_info info);

static napi_value OpenGadgetKey(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1] = { NULL };
	if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) {
		return throw_type(env, "hwsm: failed to read callback info");
	}
	if (argc < 1) {
		return throw_type(env, "openGadgetKey(subkey) requires a string argument");
	}
	WCHAR subkey[HWSM_MAX_NAME_CHARS + 1];
	if (!arg_name(env, args[0], subkey, HWSM_MAX_NAME_CHARS + 1, "subkey must be a non-empty string of at most 510 characters")) {
		return NULL;
	}

	/* The root is fixed: this addon can only ever open under HKCU, and only
	 * for value queries. The LSTATUS is the operation result (not
	 * GetLastError). */
	HKEY hkey = NULL;
	LSTATUS status = RegOpenKeyExW(HKEY_CURRENT_USER, subkey, 0, KEY_QUERY_VALUE, &hkey);
	if (status != ERROR_SUCCESS) {
		HwsmFail f;
		if (status == ERROR_FILE_NOT_FOUND) {
			f = (HwsmFail){ CODE_REG_NOT_FOUND, "RegOpenKeyExW", (DWORD)status, "the Gadget registry key does not exist" };
		} else if (status == ERROR_ACCESS_DENIED) {
			f = (HwsmFail){ CODE_REG_ACCESS_DENIED, "RegOpenKeyExW", (DWORD)status, NULL };
		} else {
			f = (HwsmFail){ CODE_REG_FAILED, "RegOpenKeyExW", (DWORD)status, NULL };
		}
		return throw_fail(env, &f);
	}
	if (is_predefined_hkey(hkey)) {
		/* Defensive: never hold (or later close) a predefined root. */
		HwsmFail f = { CODE_REG_FAILED, "RegOpenKeyExW", 0, "refusing to wrap a predefined registry root" };
		return throw_fail(env, &f);
	}

	GadgetKey* g = (GadgetKey*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(GadgetKey));
	if (g == NULL) {
		RegCloseKey(hkey);
		HwsmFail f = { CODE_REG_FAILED, "HeapAlloc", ERROR_NOT_ENOUGH_MEMORY, "allocating the key object" };
		return throw_fail(env, &f);
	}
	g->hkey = hkey;
	g->bufBytes = 512;
	g->buf = (WCHAR*)HeapAlloc(GetProcessHeap(), 0, g->bufBytes);
	if (g->buf == NULL) {
		gadget_cleanup(g);
		HeapFree(GetProcessHeap(), 0, g);
		HwsmFail f = { CODE_REG_FAILED, "HeapAlloc", ERROR_NOT_ENOUGH_MEMORY, "allocating the value buffer" };
		return throw_fail(env, &f);
	}

	napi_value obj = NULL;
	const napi_property_descriptor props[] = {
		{ "queryString", NULL, gadget_query_string, NULL, NULL, NULL, napi_default, NULL },
		{ "close", NULL, gadget_close, NULL, NULL, NULL, napi_default, NULL },
	};
	if (napi_create_object(env, &obj) != napi_ok ||
		napi_define_properties(env, obj, sizeof(props) / sizeof(props[0]), props) != napi_ok ||
		napi_type_tag_object(env, obj, &GADGET_TYPE_TAG) != napi_ok ||
		napi_wrap(env, obj, g, gadget_finalize, NULL, NULL) != napi_ok) {
		gadget_cleanup(g);
		HeapFree(GetProcessHeap(), 0, g);
		napi_throw_error(env, NULL, "hwsm: failed to construct the key object");
		return NULL;
	}
	return obj;
}

/* REG_SZ read with the reusable buffer. null = the value does not exist;
 * every other failure is a typed error. ERROR_MORE_DATA (the value grew
 * between calls) retries a bounded number of times, growing the reusable
 * buffer up to the 64 KiB cap. */
static napi_value gadget_query_string(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value args[1] = { NULL };
	GadgetKey* g = (GadgetKey*)unwrap_receiver(env, info, &GADGET_TYPE_TAG, "queryString must be called on a hwsm GadgetKey", &argc, args);
	if (g == NULL) {
		return NULL;
	}
	if (g->closed) {
		HwsmFail f = { CODE_SESSION_CLOSED, "queryString", 0, "the key is closed" };
		return throw_fail(env, &f);
	}
	if (argc < 1) {
		return throw_type(env, "queryString(valueName) requires a string argument");
	}
	WCHAR name[HWSM_MAX_NAME_CHARS + 1];
	if (!arg_name(env, args[0], name, HWSM_MAX_NAME_CHARS + 1, "valueName must be a non-empty string of at most 510 characters")) {
		return NULL;
	}

	DWORD type = 0;
	DWORD size = 0;
	LSTATUS status = ERROR_MORE_DATA;
	for (int attempt = 0; attempt < HWSM_REG_ATTEMPTS; attempt++) {
		size = g->bufBytes;
		status = RegQueryValueExW(g->hkey, name, NULL, &type, (LPBYTE)g->buf, &size);
		if (status != ERROR_MORE_DATA) {
			break;
		}
		/* `size` now holds the required byte count (local registry). Grow the
		 * reusable buffer; if the kernel did not report a size, double. */
		DWORD needed = size > g->bufBytes ? size : g->bufBytes * 2;
		if (needed > HWSM_REG_MAX_BYTES) {
			HwsmFail f = { CODE_REG_INVALID_DATA, "RegQueryValueExW", 0, "the value exceeds the 64 KiB limit" };
			return throw_fail(env, &f);
		}
		WCHAR* grown = (WCHAR*)HeapReAlloc(GetProcessHeap(), 0, g->buf, needed);
		if (grown == NULL) {
			HwsmFail f = { CODE_REG_FAILED, "HeapReAlloc", ERROR_NOT_ENOUGH_MEMORY, "growing the value buffer" };
			return throw_fail(env, &f);
		}
		g->buf = grown;
		g->bufBytes = needed;
	}
	if (status == ERROR_MORE_DATA) {
		HwsmFail f = { CODE_REG_FAILED, "RegQueryValueExW", ERROR_MORE_DATA, "the value kept growing across the bounded retries" };
		return throw_fail(env, &f);
	}
	if (status == ERROR_FILE_NOT_FOUND) {
		napi_value null = NULL;
		napi_get_null(env, &null);
		return null;
	}
	if (status == ERROR_ACCESS_DENIED) {
		HwsmFail f = { CODE_REG_ACCESS_DENIED, "RegQueryValueExW", (DWORD)status, NULL };
		return throw_fail(env, &f);
	}
	if (status != ERROR_SUCCESS) {
		HwsmFail f = { CODE_REG_FAILED, "RegQueryValueExW", (DWORD)status, NULL };
		return throw_fail(env, &f);
	}
	if (type != REG_SZ) {
		HwsmFail f = { CODE_REG_WRONG_TYPE, "RegQueryValueExW", 0, "the value is not REG_SZ" };
		return throw_fail(env, &f);
	}
	if ((size & 1u) != 0) {
		HwsmFail f = { CODE_REG_INVALID_DATA, "RegQueryValueExW", 0, "the value has an odd UTF-16 byte count" };
		return throw_fail(env, &f);
	}

	/* Registry strings may or may not carry a terminator, and stale bytes may
	 * follow an embedded one: the string ends at the FIRST NUL, or at the
	 * reported size when none exists. */
	size_t chars = size / sizeof(WCHAR);
	size_t len = 0;
	while (len < chars && g->buf[len] != L'\0') {
		len++;
	}
	napi_value out = NULL;
	if (napi_create_string_utf16(env, (const char16_t*)g->buf, len, &out) != napi_ok) {
		napi_throw_error(env, NULL, "hwsm: failed to create the result string");
		return NULL;
	}
	return out;
}

static napi_value gadget_close(napi_env env, napi_callback_info info) {
	size_t argc = 0;
	GadgetKey* g = (GadgetKey*)unwrap_receiver(env, info, &GADGET_TYPE_TAG, "close must be called on a hwsm GadgetKey", &argc, NULL);
	if (g == NULL) {
		return NULL;
	}
	gadget_cleanup(g); /* idempotent */
	napi_value undef = NULL;
	napi_get_undefined(env, &undef);
	return undef;
}

/* ------------------------------------------------------------------------- *
 * getBuildInfo: frozen startup metadata the loader verifies before polling.
 * ------------------------------------------------------------------------- */

/* Generated by scripts/native-source-id.mjs (a content hash over the native
 * sources); "unset" when node-gyp is invoked without the npm wrapper. */
#if defined(__has_include)
#if __has_include("source-id.h")
#include "source-id.h"
#endif
#endif
#ifndef HWSM_SOURCE_ID
#define HWSM_SOURCE_ID "unset"
#endif

static napi_value GetBuildInfo(napi_env env, napi_callback_info info) {
	(void)info;
	napi_value obj = NULL;
	napi_value v = NULL;
	if (napi_create_object(env, &obj) != napi_ok) {
		napi_throw_error(env, NULL, "hwsm: failed to create build info");
		return NULL;
	}
	int ok = 1;
	ok = ok && napi_create_uint32(env, HWSM_PROTOCOL_VERSION, &v) == napi_ok && napi_set_named_property(env, obj, "protocolVersion", v) == napi_ok;
	ok = ok && napi_create_uint32(env, NAPI_VERSION, &v) == napi_ok && napi_set_named_property(env, obj, "napiVersion", v) == napi_ok;
	ok = ok && napi_create_string_utf8(env, HWSM_ARCH, NAPI_AUTO_LENGTH, &v) == napi_ok && napi_set_named_property(env, obj, "architecture", v) == napi_ok;
	ok = ok && napi_create_string_utf8(env, HWSM_NATIVE_VERSION_STR, NAPI_AUTO_LENGTH, &v) == napi_ok && napi_set_named_property(env, obj, "nativeVersion", v) == napi_ok;
	ok = ok && napi_create_string_utf8(env, HWSM_SOURCE_ID, NAPI_AUTO_LENGTH, &v) == napi_ok && napi_set_named_property(env, obj, "nativeSourceId", v) == napi_ok;
	ok = ok && napi_object_freeze(env, obj) == napi_ok;
	if (!ok) {
		napi_throw_error(env, NULL, "hwsm: failed to populate build info");
		return NULL;
	}
	return obj;
}

/* ------------------------------------------------------------------------- */

static napi_value Init(napi_env env, napi_value exports) {
	const napi_property_descriptor props[] = {
		{ "getBuildInfo", NULL, GetBuildInfo, NULL, NULL, NULL, napi_default, NULL },
		{ "openSharedMemory", NULL, OpenSharedMemory, NULL, NULL, NULL, napi_default, NULL },
		{ "openGadgetKey", NULL, OpenGadgetKey, NULL, NULL, NULL, napi_default, NULL },
	};
	if (napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props) != napi_ok) {
		napi_throw_error(env, NULL, "hwsm: failed to define exports");
		return NULL;
	}
	return exports;
}

NAPI_MODULE(hwsm, Init)
