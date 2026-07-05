---
title: Sensor Dial (Stream Deck +)
nav_order: 5
---

The **Sensor Dial** action puts one HWiNFO reading on a Stream Deck + encoder. The touchscreen shows a label, the live value with its unit, the session low/high, and a range bar; the dial and touch surface let you switch readings and stats without opening settings.

It shares its data source, themes, thresholds, and formatting with [Sensor Reading](sensor-reading.md) keys — this page covers only what's specific to the dial. Windows only, HWiNFO required.

![A Stream Deck + touchscreen slot showing a themed dial readout: label top-left, large valu]({{ '/assets/img/dials.png' | relative_url }})

## The touchscreen readout

The slot draws four things, top to bottom:

| Element | Shows |
| --- | --- |
| **Label** | Your custom label, or the sensor's own (renamed) label if you leave it blank. |
| **Value + unit** | The live reading, formatted per **Decimals**, with the unit inline. A stat badge (`· MIN`, `· MAX`, `· AVG`) is appended when you're viewing a session stat instead of the live value. |
| **Stats line** | `▼ <low>   ▲ <high>   session` — the lowest and highest values seen this session. |
| **Range bar** | A fill showing where the **live** value sits between the bar's min and max. |

The bar always tracks the live value, even while you're touching through MIN / MAX / AVG on the number above it.

## Gestures

| Gesture | Effect |
| --- | --- |
| **Rotate** | Step through the readings of the *same sensor source* (e.g. every reading under one GPU), wrapping around at the ends. The new choice is saved. |
| **Push** (press the dial) | Reset the session min / max / average back to the current value. |
| **Touch** (tap the screen) | Cycle the displayed number: current → session min → session max → session average. |
| **Long touch** (touch and hold) | Jump straight back to the live current value. |

> **Note:** Rotate only walks readings that belong to the same physical sensor as your current pick, so you can spin through, say, all of one drive's temperatures without leaving that device. To jump to a different source entirely, use the sensor picker in settings.

### Session stats are the dial's own

Unlike keys — which read HWiNFO's own min/max/average — the dial tracks its **session** stats itself, starting from when the dial appeared (or its last **Push** reset). They accumulate in the reading's native unit while the dial is on a visible page, so:

- **Push** resets them; so does picking a different reading (rotate or the picker) or the dial reappearing.
- On the **Gadget** data source there is no HWiNFO min/max/avg at all, but the dial's session stats still work because it computes them from the live stream. See [Data sources](data-sources.md).

## Settings

Open the dial's Property Inspector to configure it. Most fields mirror the key action.

| Setting | What it does |
| --- | --- |
| **Sensor** | Searchable picker over every reading HWiNFO publishes, with a live value preview. Same picker as keys. |
| **Label** | Custom label; blank falls back to the sensor's name. |
| **Theme** | Preset gallery for this dial, or **Deck default** to follow the deck-wide theme. See [Themes](themes.md). |
| **Decimals** | Auto (magnitude-based; compacts large values, e.g. `48.7k`) or a fixed 0–3. |
| **Unit** | Show temperatures in °F instead of °C. |
| **Bar min** | Fixed low end of the range bar. Leave blank to auto-track the session low. |
| **Bar max** | Fixed high end of the range bar. Leave blank to auto-track the session high. |
| **Warn at** | Value at which the bar fill turns amber (in the displayed unit). |
| **Critical at** | Value at which the bar fill turns red (in the displayed unit). |
| **Direction** | "Alert when value drops below thresholds" flips the comparison — for fan RPM, free space, and other where-lower-is-worse readings. |

### Bar range: fixed vs. session

By default (both fields blank) the bar spans the **session low → high**, so the fill grows as new extremes appear and always uses the full width of the range you've actually seen. Set **Bar min** / **Bar max** to pin the bar to a fixed scale instead — e.g. `0` and `100` for a usage percentage, or `30` and `90` for a CPU temperature — so the fill position means the same thing every time you glance at it. You can set just one end; the other stays automatic.

## Alerts on a dial

Dials take the same **Warn at** / **Critical at** thresholds as keys, compared against the **live** value. But the alert shows differently: only the **range bar's fill** flips to the alert color (amber for warn, red for critical) — the label, value, and rest of the face stay in your chosen theme.

This is by design. The touchscreen slot is too small for the full field-flip that keys use (whole key to amber/red), so the bar carries the alert while the readout stays legible. The two alert colors are global and never tinted per theme, so they stay unmistakable. For the full alert model, see [Themes & alerts](themes.md).

> **Note:** Dials have **no sparkline**. Recent-history graphs are a key-only feature; the dial's range bar is its at-a-glance trend indicator.

## Status screens

When HWiNFO isn't delivering data, the touchscreen shows a short two-line message instead of a reading:

| Touchscreen | Meaning / fix |
| --- | --- |
| **Start HWiNFO** — not detected | HWiNFO isn't publishing on either interface. Start it (Shared Memory Support or Gadget reporting). |
| **Shared Memory off** — enable in HWiNFO | HWiNFO reports sharing disabled. Re-enable it, or rely on the Gadget fallback in Auto mode. |
| **HWiNFO stalled** — check sharing | Values frozen (Sensors window closed, or the free 12-hour timer expired). When the dial is on the Gadget source this reads **check Gadget** instead. |
| **Gadget empty** — tick sensors | Gadget reporting is on but no values are ticked. Right-click sensors in HWiNFO → "Report value in Gadget". |
| **Access denied** — un-elevate HWiNFO | HWiNFO and Stream Deck run at different privilege levels. Run both elevated or both normal. |
| **HWiNFO error** — unreadable | Shared memory didn't validate (mid-restart or an incompatible version). |

Before you've picked a sensor, the dial shows **HWiNFO — rotate to pick** with the hint *or use the settings panel*. If a saved sensor is no longer in HWiNFO's output, it shows **Sensor missing — rotate to pick**.

## Advanced (deck-wide)

The dial's Property Inspector also exposes the same global settings as keys, under **Dial gestures & advanced**: **Deck theme**, **Type accents**, **Data source**, and **Poll every**. These apply to the whole plugin, not just this dial — they're documented in [Data sources](data-sources.md) and [Themes](themes.md).
