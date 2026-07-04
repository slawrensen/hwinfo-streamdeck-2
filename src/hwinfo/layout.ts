/**
 * Byte layout of HWiNFO's shared-memory sensor interface.
 *
 * The mapping begins with a fixed header describing two arrays: sensor
 * *sources* (e.g. "CPU [#0]: AMD Ryzen 9 9950X3D") and *readings* (e.g.
 * "CPU Package"). Field offsets below are fixed by the interface; element
 * strides and section offsets are NOT — they must always be taken from the
 * header, because HWiNFO extends the elements by appending fields. All values
 * are little-endian and packed.
 *
 * These definitions were written for this project from the publicly
 * documented field layout of the interface (see NOTICE.md).
 */

/** `Global\` kernel object names published by HWiNFO. */
export const MAPPING_NAME = "Global\\HWiNFO_SENS_SM2";
export const MUTEX_NAME = "Global\\HWiNFO_SM2_MUTEX";

/** Header magic `u32` — "HWiS" stored little-endian. */
export const MAGIC_ACTIVE = 0x53695748;
/** Magic left behind when HWiNFO disables shared-memory support ("DEAD"). */
export const MAGIC_DEAD = 0x44414544;

/** Fixed header: 3×u32, i64, 6×u32. */
export const HEADER_SIZE = 44;
export const HEADER = {
	magic: 0,
	version: 4,
	revision: 8,
	pollTime: 12, // i64, unix seconds of HWiNFO's last sensor poll
	sensorSectionOffset: 20,
	sensorElementSize: 24,
	sensorElementCount: 28,
	entrySectionOffset: 32,
	entryElementSize: 36,
	entryElementCount: 40
} as const;

/**
 * Sensor source element. Classic layout is 264 bytes; HWiNFO ≥ 7.x appends a
 * UTF-8 copy of the display name (observed stride 392).
 */
export const SENSOR = {
	id: 0, // u32
	instance: 4, // u32
	labelOrig: 8, // char[128], ANSI
	labelUser: 136, // char[128], ANSI
	labelUtf8: 264 // char[128], UTF-8 — only when the stride includes it
} as const;
export const SENSOR_CLASSIC_SIZE = 264;
export const SENSOR_UTF8_SIZE = SENSOR.labelUtf8 + 128; // 392

/**
 * Reading element. Classic layout is 316 bytes; HWiNFO ≥ 7.x appends UTF-8
 * copies of the label and unit (observed stride 460).
 */
export const ENTRY = {
	type: 0, // u32, see SensorType
	sensorIndex: 4, // u32 — INDEX into the sensor section, not an id
	id: 8, // u32
	labelOrig: 12, // char[128], ANSI
	labelUser: 140, // char[128], ANSI
	unit: 268, // char[16], ANSI
	value: 284, // f64
	valueMin: 292, // f64
	valueMax: 300, // f64
	valueAvg: 308, // f64
	labelUtf8: 316, // char[128], UTF-8 — only when the stride includes it
	unitUtf8: 444 // char[16], UTF-8 — only when the stride includes it
} as const;
export const ENTRY_CLASSIC_SIZE = 316;
export const ENTRY_UTF8_SIZE = ENTRY.unitUtf8 + 16; // 460

/** Sanity bounds for a header we are willing to trust. */
export const MAX_REGION_BYTES = 64 * 1024 * 1024;
export const MAX_ELEMENT_COUNT = 100_000;
