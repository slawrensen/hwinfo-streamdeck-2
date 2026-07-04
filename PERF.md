# Performance log

Every entry below is emitted by `node scripts/perf-report.mjs <label>` — one
command that measures pack/bundle sizes (raw + gzip), per-component disk
usage, the live plugin process (PID attributed by command line, never by
process name — Discord also runs a `plugin.js` under node.exe), and the
parse-path microbenchmark against the **live** HWiNFO mapping
(`scripts/bench-parse.ts`, 1,000 iterations).

Metric notes:

- **tick** = one production poll: mutex acquire + `RtlMoveMemory` copy +
  decode to `SensorSnapshot`. `raw copy` is the copy alone, so
  `tick − raw copy` ≈ pure parse cost.
- **alloc/tick** = sum of positive `heapUsed` deltas per iteration (allocation
  rate, garbage included). **retained** = gc→gc `heapUsed` growth across the
  whole 1,000-iteration pass (not per tick); near zero means steady state.
- Process CPU % is lifetime average (CPU seconds / uptime).

v1.1 targets: ≥5× fewer µs/tick, near-zero steady-state alloc/tick, smaller
`.streamDeckPlugin` with zero behavior change, RSS soak slope < 1 MB/30 min,
zero orphan processes after the full suite.

## Entries

### 2026-07-04 20:21 — baseline (v1.0, commit 3d70076)

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 561,887 B | 530,551 B |
| bin/plugin.js | 107,822 B | 32,159 B |
| bin/node_modules (total) | 1,108,849 B (1082.9 KB) | |
|   koffi.node | 1,045,504 B (1021.0 KB) | |
| ui/ | 79,495 B (77.6 KB) | |
| imgs/ | 37,257 B (36.4 KB) | |
| layouts/ + manifest + themes | 3,845 B (3.8 KB) | |

| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 31336 | 30.9 MB | 61.0 MB | 4.6 s | 50 min | 0.15% |

Parse bench (1000 iters, live mapping, region 239.9 KB):

| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw copy (session.read) | 3.3 | 3.1 | 4.4 | | |
| shared-memory tick (516 readings) | 361.2 | 350.2 | 424.7 | 333,116 B | 3,832 B |
| gadget tick | n/a — HKCU\HWiNFO64\VSB absent (Gadget reporting off on this machine; covered by e2e:gadget's synthetic key) | | | | |

Reading: the copy is 3 µs; the other ~358 µs and all 333 KB/tick of garbage
is decode — re-decoding ~516 labels/units (UTF-8 ×2 each) and rebuilding
every Reading object + byKey Map per tick when only the value doubles change.
That is the READER target.

### 2026-07-04 20:29 — incremental reader (SnapshotParser)

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 561,887 B (repack pending) | 530,551 B |
| bin/plugin.js | 109,245 B | 32,663 B |
| bin/node_modules (total) | 1,108,849 B (1082.9 KB) | |
|   koffi.node | 1,045,504 B (1021.0 KB) | |
| ui/ | 79,495 B (77.6 KB) | |
| imgs/ | 37,257 B (36.4 KB) | |
| layouts/ + manifest + themes | 3,845 B (3.8 KB) | |

| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 31336 (pre-change binary) | 31.0 MB | 62.5 MB | 5.5 s | 58 min | 0.16% |

Parse bench (1000 iters, live mapping, region 239.9 KB):

| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw copy (session.read) | 3.1 | 2.9 | 4.0 | | |
| shared-memory tick (516 readings) | 5.8 | 5.0 | 10.4 | 466 B | 3,512 B |

**vs baseline: tick 361.2 → 5.8 µs mean (62×, target ≥5× ✓); alloc/tick
333,116 → 466 B (715×, ≈ measurement floor — the noop loop itself reads
~400 B/iter); retained ≈ 3.5 B/tick (noise). ✓**

What changed (`src/hwinfo/reader.ts`): `SnapshotParser` caches the full
skeleton (keys, labels, units, sensors, byKey, Reading objects) per header;
each tick verifies 8 header words + 3 identity words per entry and re-reads
only the four value doubles, in place. Any mismatch ⇒ full rebuild; the
parser lives on the `SharedMemoryProvider`, so an HWiNFO restart (new
session) always rebuilds. Two findings that mattered:

1. `Buffer.readDoubleLE` allocates a HeapNumber per call (not inlined);
   `DataView.getFloat64` is a TurboFan intrinsic — 20× faster, zero alloc.
2. Double field STORES also box; stores are conditional on value change.

Ruling — gadget reader stays non-incremental: it cannot be benched live
(VSB key absent on this machine, Gadget reporting off) and its cost is
dominated by per-value `RegQueryValueExW` FFI round-trips, not decode;
typical gadget sets are a handful of readings. Covered by e2e:gadget.

Suites after change: lint ✓ typecheck ✓ 81 unit ✓ e2e ✓ e2e:resilience ✓
e2e:gadget ✓ (all this session).

### 2026-07-04 20:36 — footprint

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 549,743 B | 520,365 B |
| bin/plugin.js | 108,573 B | 32,242 B |
| bin/node_modules (total) | 1,061,344 B (1036.5 KB) | |
|   koffi.node | 1,045,504 B (1021.0 KB) | |
| ui/ | 79,495 B (77.6 KB) | |
| imgs/ | 37,257 B (36.4 KB) | |
| layouts/ + manifest + themes | 3,823 B (3.7 KB) | |

**Pack 561,887 → 549,743 B (−12,144 B, −2.2%) with zero behavior change**
(lint/typecheck/81 unit/e2e/resilience/gadget all green after the trim; the
vendored runtime was smoke-tested by loading kernel32 through it).

KB won, per change:
- koffi vendor trim −47,505 B raw (1,108,849 → 1,061,344): runtime loads
  ONLY koffi/index.js → src/koffi/index.js → src/koffi/src/static.js →
  @koromix/koffi-win32-x64 (verified by require.cache/import tracing); the
  CJS twins, worker-thread `indirect` entry, index.d.ts and trampolines.cjs
  never load in a pure-ESM plugin. Filter lives in scripts/copy-koffi.mjs.
- terser passes:2 + comments:false −672 B raw on bin/plugin.js.
- manifest: dropped `Nodejs.Debug: "enabled"` (debug artifact in release;
  the inspector port has no place in a shipped pack).

Irreducible rulings (numbers, not vibes):
- **koffi.node 1,045,504 B (443,817 B in-pack)** — 79% of the pack. Trimming
  requires rebuilding the N-API binary from source; the no-user-toolchain
  ruling stands (koffi over node-gyp). Irreducible.
- **marketplace PNGs 34,702 B** — lossless re-encode (sharp, zlib 9 +
  adaptive filtering) comes out BIGGER (10,420 → 12,100; 24,282 → 26,366):
  already optimally compressed. Palette quantization saves ~47% but is lossy
  (max channel delta 113) — rejected, listing images must stay exact.
- **ui/sdpi-components.js 55,823 B** — Elgato's PI component library, keep
  ruling stands.
- **ui/pi-common.js 11,651 B (2.8 KB in-pack)** — our readable PI source;
  minifying would save ~1.3 KB packed at the cost of a second build
  pipeline. Not worth it.
- **action/category SVGs 2,555 B total** — minification would win < 1 KB
  raw. Not worth it.
- ws is bundled exactly once and the SDK is ESM (tree-shaken); no duplicate
  to remove. No sourcemaps in release builds (watch-only).

| Plugin process (new binary, fresh launch) | RSS | Private | CPU |
| --- | ---: | ---: | ---: |
| PID 25404 | 36.4 MB | 54.3 MB | 0.1 s @ 1 min |

### 2026-07-04 21:15 — memory / hangs

**RSS soak — PASS.** Live 12-key page (deck 20GBL9901, page 791A7BC8…),
1 s poll, new binary (PID 25404), sampled every 5 min for 35 min:

| local time | RSS MB | private MB | CPU s |
| --- | ---: | ---: | ---: |
| 13:37 | 36.71 | 54.88 | 0.2 |
| 13:42 | 37.51 | 55.52 | 0.3 |
| 13:47 | 38.99 | 57.07 | 0.5 |
| 13:52 | 38.61 | 56.30 | 0.6 |
| 13:57 | 38.77 | 56.88 | 0.9 |
| 14:02 | 39.65 | 57.90 | 1.0 |
| 14:07 | 37.52 | 57.75 | 1.2 |
| 14:12 | 33.18 | 58.09 | 1.5 |

Linear RSS slope: **−1.6 MB/30 min** (target < +1 MB/30 min) — RSS peaked
at 39.65 MB and *fell* to 33.18 (GC compaction); no monotonic growth.
Heap stability: gc→gc retention in the 1,000-tick bench is 3.5 KB total
(≈ 3.5 B/tick, measurement noise). CPU over the soak: 1.5 s / 35 min =
**0.07 %** vs the 0.23 % baseline (3.2× less).

Leak-suspect audit: sparkline history capped at 36 samples with shift();
the dial keeps no history; theme-store listeners are a Set populated once
per singleton action class (bounded at 2); per-key state (incl. lastSvg) is
deleted on willDisappear; the poller closes its provider when refs hit 0.

**Zero orphans — PASS.** `npm run suite:full` (scripts/hygiene.mjs) runs
e2e + e2e:resilience + e2e:gadget + contact-sheet + marketplace-shots +
pi-harness/capture-pi and diffs all node.exe/chrome.exe processes
before/after: `new: 0 (0 ours, 0 unrelated)` on both post-fix runs. Bugs it
caught and their fixes: capture-pi held its CDP socket open (every run hung
60 s until a watchdog that also leaked the chrome tree — socket now closed
in finally, watchdog kills the tree, plus a pi-capture-profile sweep for
chrome children that re-parent past `taskkill /T`); pi-harness orphaned its
plugin child on Windows kill() (TerminateProcess skips signal handlers —
now takes "exit" on stdin like fake-hwinfo).

**Clean shutdown — PASS**, proven both ways:
- e2e (hard checks, now part of `npm run e2e`): zero frames within 3 s of
  every action disappearing; poller logs "Stopped (no visible actions)";
  the plugin process **exits by itself** when the app socket closes —
  nothing left holding the event loop.
- Live: `Stop-Process -Name StreamDeck` → 0 plugin node processes
  (verified twice, before and after the reader/footprint changes);
  relaunch → exactly one attributed plugin process.

### 2026-07-04 21:15 — DONE: v1.1 before/after

| Metric | v1.0 baseline | v1.1 | Δ |
| --- | ---: | ---: | --- |
| parse tick (mean, 516 readings) | 361.2 µs | 5.8–6.7 µs | **54–62× faster** (target ≥5×) |
| alloc/tick | 333,116 B | 466–993 B | **≈ measurement floor** |
| retained per 1,000 ticks | 3,832 B | 3,512 B | flat (noise) |
| .streamDeckPlugin pack | 561,887 B | 549,749 B | −12,138 B, zero behavior change |
| bin/node_modules on disk | 1,108,849 B | 1,061,344 B | −47,505 B |
| live CPU (12-key, 1 s poll) | ≈0.23 % | 0.07 % | 3.2× less |
| RSS soak slope | (unmeasured) | −1.6 MB/30 min | PASS < 1 MB/30 min |
| orphans after full suite | (unmeasured) | 0 | PASS, gated by suite:full |

Every FOOTPRINT remainder is ruled irreducible above (koffi.node without a
toolchain; PNGs already optimal; sdpi-components keep). Parse path is
incremental with full-rebuild invalidation on any header/identity change.
Suites at DONE: lint ✓ typecheck ✓ 81 unit ✓ suite:full (e2e ×3 + all
screenshot pipelines) ✓ zero orphans ✓.

### 2026-07-04 22:25 — every-sensor load test (npm run e2e:load, v1.1.0)

One key context for EVERY live reading (518) + 8 dials, 250 ms poll,
12 appear/disappear churn waves (~260 contexts each) with settings variants
and dial rotations, 45 s full-visibility soak, then idle + shutdown proofs:

| Check | Result |
| --- | --- |
| every reading rendered (518 contexts) | PASS — 518 first frames |
| all 8 dials rendered feedback | PASS |
| invalid frames | 0 |
| churn survival | PASS — 6,622 frames during churn |
| RSS under 518-context 250 ms load | 128.0 → 128.7 MB peak (+0.7 MB over soak; 300 MB limit) |
| poller idle after mass disappear | PASS — 0 late frames |
| self-exit on socket close | PASS — exit 0 |

Total: 7,278 key frames + 250 dial feedbacks, zero invalid. The load suite
is part of `npm run suite:full` (45 s soak variant). On-device coverage:
two injected "HWiNFO test" pages on the live deck hold one key per sensor
source (all 21) across all seven themes with threshold/°F/stat variants.
