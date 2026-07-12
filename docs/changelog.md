---
title: Changelog
nav_order: 12
---

# Changelog

The release history. Download any tagged version as a
`.streamDeckPlugin` from the
[GitHub releases](https://github.com/slawrensen/hwinfo-streamdeck/releases)
page. Generated from the repo's `CHANGELOG.md`; do not edit this page by
hand.

One entry per version. Tagged versions are published as GitHub releases; the
Elgato Marketplace listing is a separate track.

## 1.1.11.0 - 2026-07-12

- Named rotation groups for the dial, optional and off until you build
  them. "Split into groups" under the rotation set turns the set into
  group 1 and adds a collector group; tick readings into it, name the
  groups, and the dial gets two speeds: plain rotate stays inside the
  active group, while a gesture set to "Switch sensor or group" (Elite's
  press+rotate) jumps between groups and shows the landing group's name
  on the dial for a moment. The HWiNFO Control key's "Next/Previous
  sensor or group" commands honor the groups on every preset. The auto
  cycle steps inside the active group, and with "On alert" ticked it
  still watches every group: a critical reading anywhere in the set
  interrupts across group boundaries. Legacy keeps rotating through
  everything as one flat list, exactly as before, and a Custom map with
  no group-switching gesture does the same, so no group can ever become
  unreachable. Dials without groups behave exactly as they did, and
  older plugin versions read the groups as one flat rotation set, so
  downgrading loses nothing.
- The rotation set in the dial's settings panel now shows where the dial
  is: the chip of the reading on screen is highlighted in blue and
  follows rotation, group jumps and the auto cycle while the panel is
  open.
- Switching the Controls preset from Elite to Custom now copies Elite's
  gesture map into every select you have not set yourself, so "Elite
  minus the one gesture you want different" is a single change instead
  of rebuilding the whole map from the Legacy defaults. Gestures you
  already assigned are never touched.
- The Custom preset's command lists are aligned across gestures:
  Press+rotate gained "Cycle stat mode", and Short push, Long push and
  Long touch now offer the same full command set (reset session stats,
  pause/resume auto cycle, pin/unpin, cycle stat mode, back to current
  value) instead of each listing a different subset.
- Fixed: dial status faces ("Start HWiNFO, not detected", "Access
  denied" and the rest) and the "rotate to pick" face drew their message
  at the numeric value size and ran off the right edge of the
  touchscreen slot. Longer value text now steps down to a size that
  fits.

## 1.1.10.0 - 2026-07-11

- New dial rotation controls. A rotation set: tick readings in the dial's
  sensor picker and rotation moves through just those, in your order, even
  across different sensors. An "Ignore turns" switch: the dial ignores
  rotation entirely, so a bump can never move you off your reading. An auto
  cycle: the dial steps through the rotation set (or the picked sensor's
  readings) on a timer, from every 5 seconds to every 5 minutes, and it
  works with turns ignored for a hands-off tour.
- Rotating a dial whose saved sensor has temporarily vanished (HWiNFO
  restart, device dropout) no longer jumps to an unrelated reading and
  overwrites the selection. The dial shows "Sensor missing / waiting" and
  ignores turns until the sensor returns.
- Dial session stats are now kept per reading, keyed by HWiNFO's stable
  sensor identity: rotate away and back and that reading's own session
  min/max/average is still there, and no reading can ever show another
  one's numbers. Stats for rotation-set members keep accumulating while
  they are off screen (whenever any of the plugin's actions is visible,
  which is what keeps the poller running), and the whole set survives
  reconnects, wake replays, page switches and profile changes (up to 30
  minutes off screen).
- Fixed stale dial titles when rotating through readings: a custom label
  written for one reading stayed on as the touchscreen title after rotating
  to another, so the name no longer matched the value. Rotating now clears
  the custom label and the title follows the reading (a new "Label mode"
  setting keeps it instead, as a fixed title for the slot).
- New control presets for the dial. "Legacy" (the default, and what every
  existing dial keeps) is the exact previous behavior. "Elite" adds
  press+rotate to jump between sensors, a short press that pauses the auto
  cycle, and a long press (half a second) that resets session stats.
  "Custom" assigns each gesture individually, including optional two- or
  three-zone touch (left/right switch readings, center taps). Pressed
  rotation never triggers the plain-rotation action, and a press that saw
  rotation executes nothing on release. The Stream Deck app's own gesture
  hints follow the selected preset.
- New "HWiNFO Control" key action: drive Sensor Dials from any key, pedal,
  G-key or Multi Action step, on any connected device. Commands: previous/
  next reading or sensor, stat mode, pause/resume auto cycle, pin/unpin,
  reset session stats. Targeting is explicit (a per-dial "Link ID", or all
  dials), and the key ticks or alerts by whether any dial took the command.
- Thresholds and manual bar ranges are now unit-scoped: they only apply to
  readings in the unit they were typed against, so a warn level meant for
  a temperature can no longer fire on a fan RPM after rotating to it.
  Scoping starts with the first threshold you edit after updating;
  thresholds saved by earlier versions keep their old reach until then.
- Alert-aware auto cycle, opt-in via the "On alert" setting: ticked, the
  cycle holds instead of rotating away while the shown reading is critical
  and its next step goes to a critical member of the set instead of the
  next one in order. Unticked (the default), alerts do not steer the cycle.
- New pause and pin states (from Elite/Custom gestures or the Control key):
  pause stops the auto cycle timer, pin locks the selection against turns,
  taps and the cycle. Both survive page switches (up to 30 minutes off
  screen), both show on the dial's bottom line, and the display mode a
  dial was left in also survives page navigation now.
- A device capability registry derives each deck's grid, encoder count and
  touch geometry from the Stream Deck registration (Stream Deck + XL: six
  200x100 touch segments) and degrades safely for unknown and untested
  devices: they fall back to a keys-only profile and input is never gated.
  Hardware the plugin has not been proven on is not listed as supported.
- New redacted local diagnostics: a "Copy support report" button in every
  settings panel (devices by model and hashed ID, data-source state, action
  states; no sensor values, no names, no upload), and an opt-in event
  recorder (`HWINFO_TRACE_EVENTS=1`) whose traces replay through the test
  suite's gesture machine. See the new "Hardware compatibility" docs page.
- Verified on the Stream Deck + XL (9x4 keys, six dials): a full 36-key,
  6-dial layout ran live on real hardware with every theme, sparklines,
  alert states, and touchscreen dials rendering correctly at 0.1 % CPU.
  The e2e suite now registers a Stream Deck + XL mock device and drives the
  dial on its sixth encoder, so this coverage holds without the hardware.
- The plugin log now names each connected deck (model and key grid), so
  support logs say exactly what hardware was involved.
- New `HWINFO_LOG_LEVEL` environment override (`trace`/`debug`/`info`/
  `warn`/`error`) for support diagnostics; the default stays `info`. At
  `debug`, each key and dial logs where it appeared (device and position).
  `trace` needs a debug launch of the plugin; on a normal Stream Deck
  launch it falls back to `debug` and the log says so.
- The Marketplace listing, README, FAQ, installation guide, Sensor Dial
  page and troubleshooting page now name the Stream Deck + XL alongside
  the Stream Deck + when they describe dial support.

## 1.1.9.0 - 2026-07-05

- Fixed the key sparkline clipping the bottom edge. The strip sat too low, so
  at a session low the line and its end dot were scissored by the key edge with
  no margin beneath. Moved the strip up (now y 120-134) so the line and the r=5
  dot always clear the edge. Regenerated the marketing and docs images to match.

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

## 1.1.0.0 - 2026-07-04 (first tagged build)

The baseline feature set. Tag: `v1.1.0`.

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
