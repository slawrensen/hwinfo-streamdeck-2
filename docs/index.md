---
title: Home
nav_order: 1
description: >-
  Live HWiNFO sensor readings on your Elgato Stream Deck.
---

**HWiNFO Sensors** puts live [HWiNFO](https://www.hwinfo.com) readings (temperatures, clocks, fan speeds, usage, power, voltages and everything else HWiNFO measures) directly onto your Elgato Stream Deck. A key shows one value with an optional warn/critical color and a recent-history sparkline, stacks two readings as compact rows, or splits into a quad grid of four; on a Stream Deck + or Stream Deck + XL each dial gets a touchscreen readout with a range bar and per-reading session min/max, and you rotate to switch readings or list them in a two- or three-row overview. Seven display themes (per key or deck-wide) keep every key on the same visual language.

![HWiNFO Sensors on a Stream Deck: seven display themes across the top row (Void, Graphite, Ultraviolet, Midnight, Forest, Ember, Paper), each key showing a live value, unit and sparkline, below them the aviation-style amber warn and red critical alert states, and two Stream Deck + dials with session range bars.]({{ '/assets/img/themes-contact-sheet.png' | relative_url }})

## What you get

- **Live keys.** One HWiNFO reading per key: value, unit, custom label, and a live preview while you pick.
- **Multi-readout layouts.** Stack a [second reading](sensor-reading.md#layout-two-readings-on-one-key) under the first, or split a key into a [quad grid](sensor-reading.md#layout-four-readings-the-quad-grid) of four color-coded cells; a dial can list its rotation as a [two- or three-row overview](sensor-dial.md#overview-view), the two-row face with live trend sparklines.
- **Stream Deck + and + XL dials.** Touchscreen value with a range bar and session ▼min/▲max kept per reading; rotate to step through readings, push to reset the session, touch to cycle stats.
- **Rotation on your terms.** Build a [rotation set](sensor-dial.md#rotation-set-ignore-turns-and-auto-cycle) (any readings, in your order, across sensors), tick **Ignore turns** so a bump can't move the dial, or let the **auto cycle** tour the set on a timer that holds while a reading is critical. Three [control presets](controls.md) (Legacy, Elite, Custom) map the gestures, up to three-zone touch.
- **HWiNFO Control key.** Drive Sensor Dials from any key, pedal, G-key or Multi Action step: switch readings, pause or pin, reset session stats, targeted at one [Link ID](controls.md#the-hwinfo-control-key-action) or every dial.
- **Seven themes.** Void, Graphite, Ultraviolet, Midnight, Forest, Ember and Paper, set per key or once for the whole deck, plus optional sensor-type accent colors.
- **Thresholds and alerts.** Set a warn and critical value; the key flips to amber, then red (aviation-style master caution/warning). Alert colors are global and never themed, so they stay unmistakable.
- **Sparklines.** Recent history drawn along the bottom of a key; it persists across page changes, wake and reconnect.
- **Stat modes.** Show the current value or HWiNFO's min / max / average; press a key to cycle through them.
- **Dual data source with auto-fallback.** Reads HWiNFO's Shared Memory (full min/max/avg) when available and silently falls back to the Gadget registry (no 12-hour limit on the free version), then upgrades back on its own.

## Facts

> **Windows only, HWiNFO-dependent.** HWiNFO is a Windows application; this plugin reads its Shared Memory or Gadget-registry interface locally. It needs 64-bit Windows 10 or later and Stream Deck software 6.9+. **MIT licensed, no ads, no telemetry.** Independent project, not affiliated with or endorsed by REALiX/HWiNFO.

## Start here

New to the plugin? Follow these two pages in order:

1. **[Installation](installation.md)**: install the plugin and enable Shared Memory Support (or Gadget reporting) in HWiNFO.
2. **[Getting started](getting-started.md)**: drop a **Sensor Reading** key, pick a sensor, and set a label, theme and thresholds.

From there:

- **[Sensor Reading (keys)](sensor-reading.md)**: every key setting and the press-to-cycle behavior.
- **[Sensor Dial (Stream Deck +)](sensor-dial.md)**: the dial's rotate / push / touch controls, rotation sets, auto cycle and range bar.
- **[Dial controls & presets](controls.md)**: the Legacy, Elite and Custom presets, touch zones, pause/pin, reset reach, and the HWiNFO Control key action.
- **[Themes and alerts](themes.md)**: the seven presets, type accents, and how alerts override everything.
- **[Data sources](data-sources.md)**: Shared Memory vs. Gadget registry, and how auto-fallback works.
- **[Hardware compatibility](hardware.md)**: what is physically verified, what is SDK simulated, and how to report your device.
- **[Troubleshooting](troubleshooting.md)**: what each status screen (*Start HWiNFO*, *Shared Memory off*, *Not updating*, *Access denied*, …) means and how to fix it.
