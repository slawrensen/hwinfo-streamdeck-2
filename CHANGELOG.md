# Changelog

Every Marketplace submission corresponds to one entry here and one git tag.

## 1.1.8.0 - 2026-07-05

- Meets the current Marketplace intake requirements (surfaced in the live
  Maker Console): manifest `SDKVersion` 3 and minimum Stream Deck app 6.9.
  **The plugin now requires Stream Deck software 6.9 or later.**
- Upgraded the runtime SDK from `@elgato/streamdeck` 1.4.1 to 2.1.0, which
  SDKVersion 3 requires. Migrated the property-inspector messaging off the
  removed `streamDeck.ui.current` onto `streamDeck.ui`, and moved the
  `JsonValue`/log-level imports to their new homes. Same behavior: all unit,
  e2e (harness, resilience, gadget, dead-fallback, load), and live-load
  checks pass, and the poller/render/status paths are unchanged.
- The plugin URL and the docs links now point at the documentation site
  (docs.slawrensen.com/hwinfo-streamdeck) instead of the raw GitHub repo.

## 1.1.7.0 - 2026-07-05

- Copy pass over everything a user reads, ahead of the Marketplace
  submission: manifest description, settings-panel text, status-screen and
  probe wording, README and docs. Plain punctuation throughout. No
  functional changes.
- New icons across the board: the app, category, and action icons now show
  what the plugin actually renders (a key face with a value and sparkline;
  a knob for the dial action) instead of a radial gauge it never draws.
- Repo: added `npm run release:validate` (lint, typecheck, tests, plus a
  copy/manifest/asset/version validator).

## 1.1.6.0 - 2026-07-05

- Sparklines now persist across page changes. The recent-history graph used to
  reset to empty every time a key reappeared (switching pages, waking the
  machine, the app reconnecting) and had to rebuild from scratch. History now
  lives with the poller and survives those, so switching away and back keeps
  the graph drawn. It also survives a °C/°F toggle now (same data, just
  relabelled), and a frozen HWiNFO no longer flattens the line; it holds its
  last real shape. (A graph on a page you haven't viewed in a while still
  rebuilds, and fills at HWiNFO's own update rate.)
- Redesigned the status screens (Start HWiNFO, Shared Memory off, Not updating,
  etc.) to be calmer and OLED-friendly: a true-black background instead of dark
  grey, two lines of soft-white text instead of three lines of hard white. Same
  guidance, much less glare.

## 1.1.5.0 - 2026-07-05

- Theme gallery: the "Deck default" chip is now **structurally** distinct from
  the preset it resolves to. It keeps its truthful resolved-palette face but
  wears a dashed accent border and a small link/follow badge, so it can never
  be mistaken for the Void (or any) preset chip at a glance, even when the
  deck theme it follows happens to render an identical palette. (v1.1.3/v1.1.4
  tried text-only cues that still failed the eye.)
- Fixed a data-source fallback bug: when free HWiNFO disables shared memory
  after 12 hours it leaves the named mapping behind with a "DEAD" marker. The
  reader now validates that marker at open time, so "auto" mode correctly falls
  back to the Gadget registry instead of getting stuck on the "Shared Memory
  off" screen, and a shared-memory upgrade probe no longer closes a working
  gadget provider for the dead mapping. (New `e2e:dead-fallback` regression.)
- Fixed the sensor picker silently replacing your saved sensor: pressing Enter
  with the picker open but no search text typed used to select the first
  sensor in the list. It now leaves the current selection untouched.
- The dial's "HWiNFO stalled" touchscreen text now says "check Gadget" when the
  dial is reading from the Gadget registry, matching the key screen and PI hint
  instead of always pointing at Shared Memory.

## 1.1.4.0 - 2026-07-04

- Theme gallery: the "Deck default" chip face now reads "auto" (in the
  resolved theme's colors) instead of a sample value, so it no longer looks
  like a duplicate of the theme it currently resolves to.

## 1.1.3.0 - 2026-07-04

- Fixed the theme gallery layout: the longer "Deck default" label introduced
  in 1.1.2.0 blew its grid column wide (CSS grid min-width:auto). Chips are
  equal-width again; the resolved deck theme now appears in the help line
  under the gallery ("currently Void") and in the chip tooltip.

## 1.1.2.0 - 2026-07-04

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

## 1.1.1.0 - 2026-07-04

- Hardening: the plugin now watches its parent process and exits if the
  Stream Deck app dies without cleaning up (hard-crash scenario found during
  competitive benchmarking; previously the poller could keep the process
  alive with nobody to render for; normal operation already relied on the
  app's job object). No functional changes.

## 1.1.0.0 - 2026-07-04 (initial Marketplace release)

First public release. Tag: `v1.1.0`.

**Features**

- Live HWiNFO sensor readings on Stream Deck keys: value, unit, custom label,
  sparkline history, stat modes (current/min/max/avg; a key press cycles).
- Stream Deck + dial/touchscreen action: live value with session min/max and
  a range bar; rotate to switch readings, push to reset session stats, touch
  to cycle stat modes.
- Seven display themes (per key or deck-wide) with sensor-type accent colors
  and aviation-style alerting: amber/black at warn, red/white at critical.
  Alert colors are global and never themed.
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
  tick for ~516 readings (up to 62× faster than the naive decode).
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
