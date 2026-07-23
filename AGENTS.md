# Agent & contributor guide

Windows-only Elgato Stream Deck plugin that renders live [HWiNFO](https://www.hwinfo.com)
sensor readings on keys and Stream Deck + / + XL dials (single or dual key
readouts, a three-row dial overview, rotation sets with named groups,
Legacy/Elite/Custom control presets, themes, alert thresholds, an HWiNFO
Control key action). TypeScript on the Elgato Stream Deck SDK
(`@elgato/streamdeck` v2), the `hwsm` N-API addon (`native/hwsm`) for the
shared-memory reader, dual data source (Shared Memory preferred, Gadget
registry fallback). Solo project, MIT, no ads, no telemetry.

This is the canonical guide for anyone, human or AI agent, working in the repo.

## Requirements

- Windows 10+ (x64), Node 20+, an Elgato Stream Deck install for live testing.
- HWiNFO running (Shared Memory Support or Gadget reporting) for anything that
  reads real sensors: `probe`, live e2e, the image pipelines.

## Build, test, run

| Command | What it does |
| --- | --- |
| `npm run build` | Bundle `src/plugin.ts` to `com.lawrensen.hwinfo.sdPlugin/bin/plugin.js` (rollup) and vendor `hwsm.node` + legal files (`npm run build:native` builds the addon first; a loaded `bin/hwsm.node` fails the vendor step cleanly with a stop-the-plugin hint) |
| `npm run build:native` | Build the hwsm addon (Node 20 headers, `/W4 /WX`, CFG/CET, reproducible link) plus its test-only variants; see `native/hwsm/TESTING.md` |
| `npm run lint` / `npm run typecheck` | ESLint (zero warnings) / `tsc --noEmit` |
| `npm test` | Unit suites (node:test via tsx): themes, key/dial renderers, shared-memory decode, status screens, series, rotation and groups, gestures, control schemes, devices, stats, diagnostics, density, and replayed gesture traces |
| `npm run test:native` | Windows-only native integration suite: real named mappings/mutexes/registry keys, every wait result, bounds, contract, hygiene soak, loaded-file locking |
| `npm run e2e` | Drive the built plugin over a mock Stream Deck WebSocket |
| `e2e:resilience` / `e2e:gadget` / `e2e:dead-fallback` / `e2e:native-edge` / `e2e:load` | Force failure states, the Gadget fallback, the free-version 12h DEAD-mapping fallback, native-boundary edges (missing mutex, layout growth, protocol mismatch), and a soak |
| `npm run suite:full` | Every suite plus the screenshot pipeline; fails on any leftover process |
| `npm run probe` | Standalone reader smoke test against live HWiNFO (`-- --gadget` forces the registry backend) |
| `npm run changelog:page` | Regenerate the docs-site Changelog page from `CHANGELOG.md` (a committed derived file) |
| `npm run release:validate` | lint + typecheck + unit + the release-copy validator; the validator needs internal release docs, so it passes only on the maintainer's full checkout |
| `npm run pack` | Emit `release/com.lawrensen.hwinfo.streamDeckPlugin` (Elgato CLI) |

The UI e2e suites need a live plugin process against a mock Stream Deck
socket, so they run locally (`npm run suite:full`). CI (pinned windows-2025
runner) runs lint + typecheck + unit + build + the native integration suite,
plus an ABI matrix that loads the same Node-20-built `hwsm.node` under Node
20, 22, and 24 without rebuilding.

## Native addon (hwsm)

`native/hwsm` is a first-party stable Node-API (version 8, pinned) C addon
with a capability API: `getBuildInfo()`, `openSharedMemory(mapping, mutex)`
returning an opaque session (`byteLength`, `readInto(Buffer)`, `close()`),
and `openGadgetKey(subkey)` returning an opaque HKCU query-only key
(`queryString(name)`, `close()`). No handle, pointer, address, or generic
Win32 call crosses the JavaScript boundary; sessions are type-tagged
`napi_wrap` objects JavaScript cannot forge. Failures carry a stable
`code` (`HWSM_*`), the failing `operation`, and `win32Error`.

Rules that keep it sound:

- The JS/native contract is `HWSM_PROTOCOL_VERSION`, defined in
  `native/hwsm/hwsm-version.h` and mirrored in `src/hwinfo/hwsm-loader.ts`.
  The loader refuses a mismatched addon (fails closed as "bridge-failed").
  Bump BOTH on any API shape/meaning change.
- The native version (`HWSM_NATIVE_VERSION_*`, also the version resource)
  changes only when native source behavior changes, so TypeScript-only
  releases ship byte-identical native bytes.
- The consistency mutex is mandatory; there is no unguarded read path. The
  header is re-validated under the mutex on every read against the
  session's exact mapped length (checked arithmetic, 64 MiB bound).
- `hwsm_test.node` (fault-injection hooks) and `hwsm_protomm.node`
  (deliberate protocol mismatch) build alongside for tests and must never
  ship; `scripts/validate-native.mjs` enforces that plus protocol/hash
  consistency in the pack.
- `node scripts/native-manifest.mjs` writes `release-native-manifest.json`
  (hash, size, PE hardening, imports, versions); the release workflow
  attaches it next to the pack and re-proves build reproducibility.
- Manual host-condition coverage (elevation, sessions, RDP, sleep) lives in
  `native/hwsm/TESTING.md`.

Dev loop: `streamdeck link com.lawrensen.hwinfo.sdPlugin` once, then
`npm run watch` (rebuilds and restarts the plugin on save).

## Layout

- `src/` plugin source. `src/ui/` renderers (pure functions to SVG), state
  screens, themes, format. `src/hwinfo/` the shared-memory and Gadget readers.
  Dial behavior is layered pure modules: `gestures.ts` (input classification),
  `controls.ts` (preset schemes), `rotation.ts` (step math, rotation groups),
  `stats.ts`, `commands.ts` (the Control key bus), wired by
  `actions/sensor-dial.ts`.
- `com.lawrensen.hwinfo.sdPlugin/` manifest, property inspector (`ui/`), assets
  (`imgs/`), `themes.json`. `bin/` is build output (gitignored).
- `test/` node:test suites; `test/traces/` replayable gesture fixtures in the
  recorder's format, replayed through the production gesture/control/rotation
  code by `gesture-replay.test.ts`. `scripts/` build, e2e harnesses, image
  pipelines.
- `docs/` GitHub Pages site (just-the-docs), served at
  <https://docs.slawrensen.com/hwinfo-streamdeck/>.
- `marketing/` Elgato Marketplace listing images.

## Conventions

- **Tabs** for indentation. TypeScript strict: no `any`, explicit boundary
  types, `console.error` only (the probe and build scripts are exempt).
- **No em dashes** in prose or user-facing strings. The lone em dash on an empty
  key face (a "no value" placeholder glyph) is the only exception.
- **Themes live in `com.lawrensen.hwinfo.sdPlugin/themes.json`** as the single
  source of truth; `src/ui/themes.ts` validates and resolves. Renderer geometry
  is locked by `test/key-renderer.test.ts`: change the test alongside the
  geometry.
- **Marketing and docs images are real output, never mockups**: renderer-drawn
  boards regenerated by scripts, plus one photograph of the plugin running on
  real hardware (see `marketing/README.md`). Keep it that way.
- **Sensor identity** is HWiNFO's stable `sensor-id : instance : reading-id`,
  never a list position, so keys survive restarts and reordering.
- **Settings are append-only** (fields are added, never renamed or removed),
  and the runtime salvage-parses them: malformed values degrade to safe
  defaults, are never thrown on mid-tick, and are never rewritten back.
- **A version bump touches four files together**: `package.json`, the
  manifest (`X.Y.Z.0`), `CHANGELOG.md`, and `package-lock.json`
  (`npm install --package-lock-only`); CI's `npm ci` fails on a stale lock.
- Performance claims are backed by measurements in `PERF.md`
  (`node scripts/perf-report.mjs` regenerates the numbers).

## Verifying a change

The renderers are pure functions with geometry-guard tests, so most visual
changes are provable with `npm test` plus a scratch render. Dial gesture or
rotation behavior belongs in a trace under `test/traces/` (the replay layer
proves commands and final state without hardware). Anything touching
the poller, the property-inspector protocol, or the data sources: run the
matching e2e suite. Before calling it done, `npm run suite:full` should be green
with zero orphaned processes.

For release soaks, `node scripts/soak-monitor.mjs` watches the live plugin
from outside the process (kernel-level sampling plus a log tail, nothing
in-process, so the soaked build stays the exact shipping configuration) and
prints a PERF.md-ready summary: RSS/handle slopes, restarts, and gaps.

## Distribution

- **GitHub Releases** (un-DRM'd, direct download): push a `vX.Y.Z` tag and
  `.github/workflows/release.yml` builds, packs, hashes, and publishes.
- **Elgato Marketplace** (DRM applied on Elgato's side): a separate submission.
- `CHANGELOG.md` is the release history; `docs/changelog.md` mirrors it on the
  site (`npm run changelog:page` regenerates it).

Some internal release-ops notes are kept out of this public repo by design.
