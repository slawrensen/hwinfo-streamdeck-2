---
title: Sensor Dial (Stream Deck +)
nav_order: 5
---

The **Sensor Dial** action puts one HWiNFO reading on a Stream Deck + or Stream Deck + XL encoder. The touchscreen shows a label, the live value with its unit, the session low/high, and a range bar; the dial and touch surface let you switch readings and stats without opening settings. On the Stream Deck + XL, each of the six encoders can hold its own Sensor Dial.

It shares its data source, themes, thresholds, and formatting with [Sensor Reading](sensor-reading.md) keys; this page covers only what's specific to the dial. Windows only, HWiNFO required.

![Two Stream Deck + dials: CPU temperature with a range bar and session min/max, and GPU Hot Spot at its session maximum with the bar fill in red.]({{ '/assets/img/dials.png' | relative_url }})

## The touchscreen readout

The slot draws four things, top to bottom:

| Element | Shows |
| --- | --- |
| **Label** | Your custom label, or the sensor's own (renamed) label if you leave it blank. |
| **Value + unit** | The live reading, formatted per **Decimals**, with the unit inline. A stat badge (`· MIN`, `· MAX`, `· AVG`) is appended when you're viewing a session stat instead of the live value. |
| **Stats line** | `▼ <low>   ▲ <high>   session`: the lowest and highest values seen this session. |
| **Range bar** | A fill showing where the **live** value sits between the bar's min and max. |

The bar always tracks the live value, even while you're touching through MIN / MAX / AVG on the number above it.

## Gestures

These are the **Legacy** preset defaults, which every dial runs until you pick otherwise. The [Dial controls & presets](controls.md) page covers the Elite and Custom presets, press+rotate, touch zones, pause/pin, reset reach, and the HWiNFO Control key action.

| Gesture | Effect |
| --- | --- |
| **Rotate** | Step through your [rotation set](#rotation-set-ignore-turns-and-auto-cycle) if you built one, otherwise through the readings of the *same sensor source* (e.g. every reading under one GPU), wrapping around at the ends. The new choice is saved. Does nothing while **Ignore turns** is on. |
| **Push** (press the dial) | Reset the session min / max / average back to the current value. |
| **Touch** (tap the screen) | Cycle the displayed number: current → session min → session max → session average. |
| **Long touch** (touch and hold) | Jump straight back to the live current value. |

> **Note:** Without a rotation set, Rotate only walks readings that belong to the same physical sensor as your current pick, so you can spin through, say, all of one drive's temperatures without leaving that device. To jump to a different source entirely, use the sensor picker in settings, build a rotation set that crosses sensors, or use the Elite preset's press+rotate sensor jump.

## Rotation set, Ignore turns, and Auto cycle

Three settings control what rotation can reach:

- **Rotation set.** Tick the checkbox on any rows in the sensor picker to build a custom list; the dial then rotates through *only* those readings, in the order you picked them, wrapping at the ends. The set can mix readings from different sensors. Picked readings show as removable chips under the picker. Leave the set empty for the default same-sensor behavior.

  ![The dial's sensor picker open with "cpu" typed, each row carrying a rotation-set checkbox with its live value: two rows ticked, the rest unticked.]({{ '/assets/img/pi-dial-picker.png' | relative_url }})

  ![The dial's settings panel with a rotation set of three readings from three different sensors (CPU temperature, GPU temperature, pump) shown as removable chips, above the Ignore turns checkbox, the Auto cycle select and the On alert option.]({{ '/assets/img/pi-dial-rotation.png' | relative_url }})
- **Ignore turns.** A checkbox that makes the dial ignore rotation entirely, so a bump against the deck can never move you off the reading you chose. Push, touch, and the settings panel still work.
- **Auto cycle.** Steps to the next reading in the rotation set (or the picked sensor's readings) on a timer, from every 5 seconds to every 5 minutes. It runs even while turns are ignored, which makes a hands-off tour of your picked readings: build a set, ignore turns, set a cycle time. A manual turn restarts the timer, and each step clears the custom label just like a manual turn (unless **Label mode** is set to fixed). Timing rides the poll interval, so a step can land up to one poll late. While the shown reading is critical, the cycle holds instead of rotating away; the **On alert** checkbox additionally makes the next step go to a critical member of the set instead of the next one in order.

Rotation also protects your selection when HWiNFO temporarily stops publishing the saved sensor (a restart, a device dropout): turns are ignored until the sensor returns, instead of jumping to an unrelated reading.

### Session stats are the dial's own, per reading

Unlike keys (which read HWiNFO's own min/max/average), the dial tracks its **session** stats itself, and it keeps a separate session per reading, keyed by HWiNFO's stable sensor identity:

- Rotate away and back, and you find that reading's own session numbers again; no reading ever shows another one's min/max. Stats for your rotation-set members keep accumulating while they are off screen (as long as any of the plugin's keys or dials is on screen to keep the poller running), and the whole set survives page switches and profile changes for up to 30 minutes off screen (see [controls](controls.md#pause-pin-and-reset-reach)).
- **Push** resets the current reading's stats (the **Reset reach** setting can widen that to the set or every dial).
- On the **Gadget** data source there is no HWiNFO min/max/avg at all, but the dial's session stats still work because it computes them from the live stream. See [Data sources](data-sources.md).

## Settings

Open the dial's Property Inspector to configure it. Most fields mirror the key action.

| Setting | What it does |
| --- | --- |
| **Sensor** | Searchable picker over every reading HWiNFO publishes, with a live value preview. Same picker as keys, plus a checkbox per row for the rotation set. |
| **Rotation set** | The readings rotation is limited to, shown as removable chips. Empty means the picked sensor's readings. |
| **Rotation** | "Ignore turns" disables rotation for bump protection. |
| **Auto cycle** | Timer that steps through the rotation set automatically. Off by default. |
| **Label** | Custom label; blank falls back to the sensor's name. |
| **Theme** | Preset gallery for this dial, or **Deck default** to follow the deck-wide theme. See [Themes](themes.md). |
| **Decimals** | Auto (magnitude-based; compacts large values, e.g. `48.7k`) or a fixed 0–3. |
| **Unit** | Show temperatures in °F instead of °C. |
| **Bar min** | Fixed low end of the range bar. Leave blank to auto-track the session low. |
| **Bar max** | Fixed high end of the range bar. Leave blank to auto-track the session high. |
| **On alert** | Auto cycle jumps to a critical member of the rotation set instead of waiting its turn. |
| **Label mode** | Whether a custom label clears when rotation moves to another reading (default), or stays as a fixed title. |
| **Warn at** | Value at which the bar fill turns amber (in the displayed unit). |
| **Critical at** | Value at which the bar fill turns red (in the displayed unit). |
| **Direction** | "Alert when value drops below thresholds" flips the comparison: for fan RPM, free space, and other where-lower-is-worse readings. |

Thresholds and the manual bar range are **unit-scoped**: they only apply to readings in the unit they were typed against, so a °C threshold can never misfire on an RPM reading you rotate to. Details on the [controls page](controls.md#thresholds-and-mixed-units).

### Bar range: fixed vs. session

By default (both fields blank) the bar spans the **session low → high**, so the fill grows as new extremes appear and always uses the full width of the range you've actually seen. Set **Bar min** / **Bar max** to pin the bar to a fixed scale instead (e.g. `0` and `100` for a usage percentage, or `30` and `90` for a CPU temperature) so the fill position means the same thing every time you glance at it. You can set just one end; the other stays automatic.

## Alerts on a dial

Dials take the same **Warn at** / **Critical at** thresholds as keys, compared against the **live** value. But the alert shows differently: only the **range bar's fill** flips to the alert color (amber for warn, red for critical); the label, value, and rest of the face stay in your chosen theme.

This is by design. The touchscreen slot is too small for the full field-flip that keys use (whole key to amber/red), so the bar carries the alert while the readout stays legible. The two alert colors are global and never tinted per theme, so they stay unmistakable. For the full alert model, see [Themes & alerts](themes.md).

> **Note:** Dials have **no sparkline**. Recent-history graphs are a key-only feature; the dial's range bar is its at-a-glance trend indicator.

## Status screens

When HWiNFO isn't delivering data, the touchscreen shows a short two-line message instead of a reading:

| Touchscreen | Meaning / fix |
| --- | --- |
| **Start HWiNFO** / not detected | HWiNFO isn't publishing on either interface. Start it (Shared Memory Support or Gadget reporting). |
| **Shared Memory off** / enable in HWiNFO | HWiNFO reports sharing disabled. Re-enable it, or rely on the Gadget fallback in Auto mode. |
| **HWiNFO stalled** / check sharing | Values frozen (Sensors window closed or HWiNFO stopped polling). When the dial is on the Gadget source this reads **check Gadget** instead. |
| **Gadget empty** / tick sensors | Gadget reporting is on but no values are ticked. Right-click sensors in HWiNFO → "Report value in Gadget". |
| **Access denied** / un-elevate HWiNFO | HWiNFO and Stream Deck run at different privilege levels. Run both elevated or both normal. |
| **HWiNFO error** / restart HWiNFO | Shared memory didn't validate (mid-restart or an incompatible version). |

Before you've picked a sensor, the dial shows **HWiNFO** / **rotate to pick** with the hint *or use the settings panel*. If a saved sensor is no longer in HWiNFO's output, it shows **Sensor missing** / **waiting**, and turns are ignored so your saved pick survives the outage; reselect in settings if the sensor is gone for good.

## Advanced (deck-wide)

The dial's Property Inspector also exposes the same global settings as keys, under **Dial gestures & advanced**: **Deck theme**, **Type accents**, **Data source**, and **Poll every**. These apply to the whole plugin rather than to this dial alone; they're documented in [Data sources](data-sources.md) and [Themes](themes.md).
