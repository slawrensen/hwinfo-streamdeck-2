# Changelog

Every Marketplace submission corresponds to one entry here and one git tag.

## 1.1.4.0 — 2026-07-04

- Theme gallery: the "Deck default" chip face now reads "auto" (in the
  resolved theme's colors) instead of a sample value, so it no longer looks
  like a duplicate of the theme it currently resolves to.

## 1.1.3.0 — 2026-07-04

- Fixed the theme gallery layout: the longer "Deck default" label introduced
  in 1.1.2.0 blew its grid column wide (CSS grid min-width:auto). Chips are
  equal-width again; the resolved deck theme now appears in the help line
  under the gallery ("currently Void") and in the chip tooltip.

## 1.1.2.0 — 2026-07-04

- Theme system truthfulness: the settings panel's "Deck default" chip now
  shows the plugin's actual resolved deck theme (labelled with its name,
  e.g. "Deck default · Void") instead of guessing from raw global settings,
  and updates live when the deck-wide theme changes. Added help text making
  the precedence rule explicit: a per-key theme always wins; the Advanced
  "Deck theme" only affects keys set to Deck default.
- Fixed: an empty or invalid stored deck theme could permanently block the
  legacy-migration default while silently failing to apply; the migration
  can no longer overwrite a theme the user picked concurrently.
- The effective deck theme is now logged at startup and on every change.

## 1.1.1.0 — 2026-07-04

- Hardening: the plugin now watches its parent process and exits if the
  Stream Deck app dies without cleaning up (hard-crash scenario found during
  competitive benchmarking — previously the poller could keep the process
  alive with nobody to render for; normal operation already relied on the
  app's job object). No functional changes.

## 1.1.0.0 — 2026-07-04 (initial Marketplace release)

First public release. Tag: `v1.1.0`.

**Features**

- Live HWiNFO sensor readings on Stream Deck keys: value, unit, custom label,
  sparkline history, stat modes (current/min/max/avg — key press cycles).
- Stream Deck + dial/touchscreen action: live value with session min/max and
  a range bar; rotate to switch readings, push to reset session stats, touch
  to cycle stat modes.
- Seven display themes (per key or deck-wide) with sensor-type accent colors
  and aviation-style alerting: amber/black at warn, red/white at critical —
  alert colors are global and never themed.
- Searchable sensor picker in the settings panel with live values for all
  ~500+ readings, grouped by source.
- Dual data source with auto-fallback: HWiNFO Shared Memory (full stats)
  preferred, Gadget registry (free version, no 12-hour limit) as fallback,
  automatic upgrade back to shared memory when it returns.
- Resilient status screens for every failure mode: HWiNFO not running,
  Shared Memory disabled or expired, privilege mismatch (with the concrete
  fix), Gadget reporting enabled but no sensors ticked, stale data.
- First-run setup guide inside the settings panel.

**Performance** (measured, see PERF.md)

- Incremental shared-memory decoder: ~6 µs and near-zero allocation per poll
  tick for ~516 readings (62× faster than the naive decode).
- ~0.07 % average CPU with a 12-key live page at a 1-second poll.
- Memory-stable under a 35-minute soak (RSS slope negative); the plugin
  process exits cleanly when Stream Deck stops and idles when no keys are
  visible.

**Notes**

- Requires HWiNFO (free or Pro) with Shared Memory Support or Gadget
  reporting enabled. Windows x64 only (Windows-on-ARM shows a clear
  unsupported-platform screen).
- This is an independent project, not affiliated with or endorsed by
  REALiX/HWiNFO. No ads, no telemetry.
