# hwsm native testing

How the native addon is proven, and the manual host-condition matrix that
automation cannot reach.

## Automated layers

| Layer | Command | What it proves |
| --- | --- | --- |
| Native integration | `npm run test:native` | Real named mappings/mutexes/registry keys via `scripts/native-test-producer.mjs`: lifecycle, exact bounds (page-granular sections, 64 MiB cap, overflow math), every wait result (busy, abandoned, injected WAIT_FAILED/release-failure via `hwsm_test.node`), registry variants (empty, no terminator, embedded NUL, growth, over-cap, wrong type, odd bytes, deleted-underneath), receiver forgery, hygiene soak (10k reads + 2k open/close, handle and RSS bounds), finalizer/teardown child, loaded-file locking |
| Boundary e2e | `npm run e2e:native-edge` | Full plugin: mapping-without-mutex never reads unguarded, recovery when the mutex appears, mid-run layout growth invalidates and reopens, a protocol-mismatched `hwsm.node` fails closed to the "Plugin damaged" screen |
| State machine e2e | `e2e:resilience` / `e2e:gadget` / `e2e:dead-fallback` | Poller staleness, DEAD magic, producer exit/restart, Gadget digest freshness, fallback and upgrade probes |
| ABI matrix | CI `abi-matrix` job / `node scripts/abi-check.mjs` | The SAME Node-20-built binary (no rebuild) completes require → getBuildInfo → open → read → close under Node 20, 22, and 24 |
| Packaging gate | `node scripts/validate-native.mjs` | `bin/hwsm.node` present, protocol/ABI/source-id consistent, no test addons, staging files, PDBs, or koffi in the pack |

Test-only builds: `hwsm_test.node` (compiled with `HWSM_TEST_HOOKS`; adds
`_testControl` fault injection) and `hwsm_protomm.node`
(`HWSM_PROTOCOL_VERSION=999`). Both exist only under
`native/hwsm/build/Release/`, are absent from the release addon's compile,
and are blocked from the pack by the packaging gate.

## Manual host-condition matrix

Conditions that depend on real elevation, sessions, or power transitions.
Expected results follow from the access model: the mapping and mutex are
opened with `FILE_MAP_READ` / `SYNCHRONIZE` only, and an elevated producer's
objects are not readable from a non-elevated consumer (shown as the
"Access denied / un-elevate" screen, reason `access-denied`).

Record for each executed row: date, Windows/Stream Deck/HWiNFO versions,
session and elevation relationship, observed error code. Never mark an
unexecuted row as passed.

| # | Condition | Expected | Status |
| --- | --- | --- | --- |
| 1 | Standard HWiNFO / standard Stream Deck | Live readings via shared memory | PASS 2026-07-22, Win 10.0.19044, SD dev-linked, HWiNFO SM v2.1: 21 sensors / 515 readings via probe + live deck |
| 2 | Elevated HWiNFO / standard Stream Deck | `access-denied` screen; Gadget fallback works if enabled | not executed |
| 3 | Standard HWiNFO / elevated Stream Deck | Live readings (elevated consumer may read non-elevated objects) | not executed |
| 4 | Elevated HWiNFO / elevated Stream Deck | Live readings | not executed |
| 5 | Different Windows user runs HWiNFO | `Global\` mapping readable only with rights; typically `access-denied` or `not-running` | not executed |
| 6 | Fast User Switching (plugin session inactive) | Polling continues or idles; recovery after switch-back | not executed |
| 7 | Separate interactive session (console + RDP concurrently) | Same-session objects only; `Global\` namespace readable per ACLs | not executed |
| 8 | RDP session | Live readings within the session | not executed |
| 9 | Producer using `Global\` namespace | Default production path; live readings | PASS 2026-07-22 (row 1 is the `Global\` producer) |
| 10 | Test helper using `Local\` namespace | Native suite and e2e producers use `Local\`; all suites green | PASS 2026-07-22 (`test:native` 43/43, all e2e suites) |
| 11 | Stream Deck restart while HWiNFO keeps running | Fresh session opens on restart; live readings resume | PASS 2026-07-22 (plugin stopped and restarted during addon vendor) |
| 12 | HWiNFO restart while Stream Deck keeps running | stale → reopen probe → live (resilience e2e mirrors this synthetically) | not executed against real HWiNFO this date |
| 13 | Sleep and resume | Frozen pollTime → stale → recovery on resume | not executed |
| 14 | Sign out and sign in | Plugin process restarts with the session; live readings | not executed |
| 15 | Plugin reinstall/update while the old plugin process is active | Replacement fails cleanly; old binary byte-identical; clear stop-the-plugin message | PASS 2026-07-22 (`copy-hwsm.mjs` against the live plugin: EPERM path, dest hash unchanged, no staging leftovers) |
| 16 | Plugin reinstall/update after the old process exits | Replacement succeeds; new hash verified | PASS 2026-07-22 (post-stop vendor + `test:native` locking case) |

## Local ABI runs (2026-07-22)

Node-20.20.0-header build `sha256 ff72a2ab878f5bfa…` (the vendored release binary):

- Node 20.20.0 (the Stream Deck bundled runtime): PASS (napi 9, modules 115)
- Node 24.16.0: PASS (napi 10, modules 137)
- Node 22: no local runtime on this machine; covered by the CI `abi-matrix` job
