---
title: Sensor Dial (Stream Deck +)
nav_order: 5
---

The **Sensor Dial** action puts an HWiNFO reading on a Stream Deck + or Stream Deck + XL encoder. The touchscreen shows a label, the live value with its unit, the session low/high, and a range bar; the dial and touch surface let you switch readings and stats without opening settings. A second view, the [overview](#overview-view), lists up to three readings of your rotation set at once. On the Stream Deck + XL, each of the six encoders can hold its own Sensor Dial.

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

## Overview view

**View** offers two multi-row layouts besides the single readout, both listing what rotation moves through:

- **Overview (two rows, big values + trend)**: two tall rows, each with its label on its own line and a large value in the shared right-aligned column, the reading on the dial marked by a full-width highlight band and an accent bar. The space left of the value earns its keep: a long label word-wraps onto it, and a label that fits one line frees it for a **sparkline** of that reading's recent values (the same recent-history line the keys draw, fed live for the two visible rows). The bottom line keeps the single view's stats slot.
- **Overview (three rows)**: the wide tile, one line per reading. The reading on the dial is a small accent **thumb riding the left rail**, which also shows where the three-row window sits in the full list. One **context line** carries the shared name and the session `▼ low ▲ high`: the numbers always render in full, right-anchored, and only the name shortens, so a long name can never eat a stat. The context line sits above the rows by default or below them (**Context line** setting), and thin separator lines between rows can be turned off (**Separators** setting). The `pinned` / `cycle paused` tags and the stat badge share the context line's name region; a transient hint (a group name on a jump, "cycle paused", a reset confirmation) briefly takes the whole line, then the name and numbers return.

![The dial's View setting in the settings panel set to the three-row overview, with the Row labels, Context line and Separators selects it reveals below it.]({{ '/assets/img/pi-dial-overview.png' | relative_url }})

Three things keep the short labels readable:

- **Shared prefixes move to the context line.** When the visible rows' labels start with the same words ("GPU Temperature / GPU Hot Spot / GPU Thermal Limit"), the shared part is lifted out and shown once beside the stats: the rows read "Temperature / Hot Spot / Thermal Limit" with `GPU` in the context line (the two-row face keeps it in its bottom line). You keep the context without paying for it three times. Names you type yourself are never altered, and a reading whose whole label IS the shared word (a plain "GPU" row) keeps it. Prefer the untouched names? Set **Row labels** to "Always full labels".
- **Values share one right-aligned column.** Every value's ones digit lands on the same column edge, with units in their own column beside it. The three-row face fixes the column and steps the value size down a ladder until the widest visible value fits, so numbers never move; the two-row face places its columns by the widest visible value, so a short value donates its slack to the labels.
- **You can rename any reading.** Click a chip's name under **Rotation set** and type a new one (Enter or click away to save; clear it to go back to the HWiNFO name). The name shows on that row and as the dial's title whenever that reading is selected, in both views. Unticking a reading keeps its name for later.

![Multi-readout key and dial faces rendered by the plugin, including the three-row overview with its rail thumb and context line shown before and after rotation moved the marked row.]({{ '/assets/img/multi-readouts.png' | relative_url }})

The overview does not get its own list to manage. It shows exactly what rotation already steps through, in the same order:

- your **rotation set**, if you built one (any size; the view shows a two- or three-row window of it),
- the **active rotation group** when [groups](controls.md#rotation-groups) are in charge of plain rotate,
- otherwise the **picked sensor's readings**.

Rotating works exactly as in the single view: the selection steps through the full list (saved as always), the mark follows it, and the three-row window scrolls with the selection, clamped at the ends. Auto cycle, alert interrupts, pin, pause, group jumps, touch taps and the HWiNFO Control key all keep working unchanged; a touch tap through MIN / MAX / AVG switches every row to that session stat and notes it beside the stats (the context line on three rows, the bottom line on two).

A few details specific to the view:

- The range bar and the big value belong to the single view; the overview trades them for the extra rows. Bar min/max settings are simply not used while the overview is active.
- **Warn / Critical** still apply (unit-scoped as always): a row whose reading trips a threshold shows its value in the alert color, and the alert-aware auto cycle can pull the selection (and so the window) to it.
- A custom **Label** renames the marked row only (and clears on rotation unless Label mode is fixed); per-reading chip names persist per reading instead.
- Values truncate at 12 characters and keep the shared **Decimals** setting; units truncate at 4 characters on the three-row face (its unit column is fixed) and 5 on the two-row face.
- With fewer than three readings in reach, the overview lists what there is; the status faces (HWiNFO down, no selection, sensor missing) are the same as the single view's.

Switching back to **One reading** restores the exact single-view face.

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

- **Rotation set.** Tick the checkbox on any rows in the sensor picker to build a custom list; the dial then rotates through *only* those readings, in the order you picked them, wrapping at the ends. The set can mix readings from different sensors. Picked readings show as removable chips under the picker, and the chip of the reading on the dial right now is highlighted in blue: rotate, jump groups or let the auto cycle run with the panel open and the highlight moves with it. Leave the set empty for the default same-sensor behavior. The set can also be [split into named rotation groups](controls.md#rotation-groups): plain rotate then stays inside one group and press+rotate (Elite) jumps between groups.

  ![The dial's sensor picker open with "cpu" typed, each row carrying a rotation-set checkbox with its live value: two rows ticked, the rest unticked.]({{ '/assets/img/pi-dial-picker.png' | relative_url }})

  ![The dial's settings panel with a rotation set of three readings from three different sensors (CPU temperature, GPU temperature, pump) shown as removable chips with a Split into groups button, the CPU temperature chip highlighted blue as the reading on the dial, above the Ignore turns checkbox, the Auto cycle select and the On alert option.]({{ '/assets/img/pi-dial-rotation.png' | relative_url }})
- **Ignore turns.** A checkbox that makes the dial ignore rotation entirely, so a bump against the deck can never move you off the reading you chose. Push, touch, and the settings panel still work.
- **Auto cycle.** Steps to the next reading in the rotation set (or the picked sensor's readings) on a timer, from every 5 seconds to every 5 minutes. It runs even while turns are ignored, which makes a hands-off tour of your picked readings: build a set, ignore turns, set a cycle time. A manual turn restarts the timer, and each step clears the custom label just like a manual turn (unless **Label mode** is set to fixed). Timing rides the poll interval, so a step can land up to one poll late. Ticking **On alert** makes the cycle alert-aware: it holds instead of rotating away while the shown reading is critical, and its next step goes to a critical member of the set instead of the next one in order. Left unticked (the default), alerts do not steer the cycle; see [Dial controls & presets](controls.md#thresholds-and-mixed-units).

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
| **Rotation set** | The readings rotation is limited to, shown as removable chips. Empty means the picked sensor's readings. Can be split into named [rotation groups](controls.md#rotation-groups). |
| **View** | **One reading** (default), or an [overview](#overview-view) of the rotation list: two rows with big values and trend sparklines, or three compact rows. |
| **Row labels** | Overview only: shorten shared prefixes into the context line (default), or always show full labels. |
| **Context line** | Three-row overview only: the shared name and session stats line sits above the rows (default) or below them. |
| **Separators** | Three-row overview only: thin lines between rows (default), or none. |
| **Rotation** | "Ignore turns" disables rotation for bump protection. |
| **Auto cycle** | Timer that steps through the rotation set automatically. Off by default. |
| **Label** | Custom label; blank falls back to the sensor's name. |
| **Theme** | Preset gallery for this dial, or **Deck default** to follow the deck-wide theme. See [Themes](themes.md). |
| **Decimals** | Auto (magnitude-based; compacts large values, e.g. `48.7k`) or a fixed 0–3. |
| **Unit** | Show temperatures in °F instead of °C. |
| **Bar min** | Fixed low end of the range bar. Leave blank to auto-track the session low. |
| **Bar max** | Fixed high end of the range bar. Leave blank to auto-track the session high. |
| **On alert** | Makes the auto cycle alert-aware: it jumps to a critical member of the rotation set instead of waiting its turn, and holds there while the reading stays critical. Off by default. |
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

> **Note:** The single view has no sparkline; its range bar is the at-a-glance indicator there. The two-row [overview](#overview-view) draws real sparklines for its visible readings.

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
