/*
 * Native version facts shared by hwsm.c and the hwsm.rc version resource.
 *
 * HWSM_PROTOCOL_VERSION is the JavaScript/native contract number. It must
 * equal HWSM_PROTOCOL_VERSION in src/hwinfo/hwsm-loader.ts; the loader
 * refuses to run against an addon whose protocol differs (a mixed install:
 * new plugin.js with an old hwsm.node, or the reverse). Bump it ONLY when
 * the exported API's shape or meaning changes.
 *
 * HWSM_NATIVE_VERSION_* is the native binary's own version, independent of
 * the plugin package version. Bump it whenever native source behavior
 * changes; leave it alone for TypeScript-only releases so the shipped
 * hwsm.node bytes stay stable across those releases.
 */
#ifndef HWSM_VERSION_H
#define HWSM_VERSION_H

/* Overridable ONLY so the hwsm_protomm test target can build a deliberately
 * mismatched addon for the fail-closed loader e2e; the release target never
 * defines it externally. */
#ifndef HWSM_PROTOCOL_VERSION
#define HWSM_PROTOCOL_VERSION 1
#endif

#define HWSM_NATIVE_VERSION_STR "1.0.0"
#define HWSM_NATIVE_VERSION_COMMAS 1, 0, 0, 0

#endif
