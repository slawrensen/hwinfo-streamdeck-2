---
title: Thresholds & Alerts
nav_order: 7
---

Thresholds turn a key (or dial bar) into a warning light. Set a **Warn at** and/or **Critical at** value, and the plugin colors the reading the moment its live value crosses the limit: amber for warn, red for critical.

Both fields are optional and independent: set one, the other, or neither. A key with no thresholds just shows its themed value.

## The two fields

| Field | Effect on a **key** | Effect on a **dial** |
| --- | --- | --- |
| **Warn at** | Whole face flips to amber field / black text | Range bar fill turns amber |
| **Critical at** | Whole face flips to red field / white text | Range bar fill turns red |
| **Direction** (*Alert when value drops below thresholds*) | Flips the comparison so a *low* value is the alarm | Same |

On a key the alert takes over the entire face; this is deliberate, aviation-style master caution/warning that reads across a whole wall of keys. On a Stream Deck + dial the touchscreen slot is too small for a full flip, so only the range bar's fill changes color; the label, value and range text stay themed. See [Sensor Dial](sensor-dial.md) for the rest of the dial.

![The property inspector showing the Warn at, Critical at and Direction settings with example values filled in.]({{ '/assets/img/settings-panel.png' | relative_url }})

## How the comparison works

Two rules matter, and both are easy to get wrong:

**1. Thresholds are in the *displayed* unit.** The value compared against your thresholds is the **live (current) reading in whatever unit the key shows**, after the °C→°F conversion, not before. So if you tick *Show temperatures in °F*, a **Warn at** of `100` fires on a 40 °C core (which displays as 104 °F). Leave °F off and the same sensor is compared in °C. Match your numbers to the unit on the face.

> **Note:** Alert color always tracks the *live* value, even when the key is showing MIN / MAX / AVG (press cycles the stat mode). Pressing a key to look at its max won't turn the alert off if the current value is still over the limit, and won't turn it on just because the historical max was.

**2. The trigger is "at or past" the limit.** Crossing means reaching the value, not exceeding it:

- Normal direction (higher is worse): alerts when `value ≥ threshold`.
- Below direction (lower is worse): alerts when `value ≤ threshold`.

Critical is checked before warn, so once a reading is past both limits it shows critical.

### Decimal commas are accepted

Both fields accept a period *or* a comma as the decimal separator, so `70.5` and `70,5` both mean seventy-and-a-half. Blank means "no threshold". Anything that isn't a number is ignored (treated as no threshold).

## Direction: alert when high vs. alert when low

By default higher is worse, the right setting for temperatures, power draw, and usage. Tick **Alert when value drops below thresholds** for readings where *low* is the problem:

- **Fan RPM**: a stalled or dying fan reads *low*.
- **Free disk space**: you want to know when it drops *under* a floor.
- **Battery %**, available memory, and similar "headroom" readings.

With the box ticked, your **Warn at** / **Critical at** values become floors: the alert fires when the reading falls to or below them.

## Colors are global and colorblind-safe

The warn and critical palettes are **never themed**. Amber-warn and red-crit look identical on Void, Paper, Ember, or any other [theme](themes.md): an alert must be unmistakable regardless of the surrounding look. The two states are separated by luminance as well as hue (bright amber field vs. deep red field), so they stay distinguishable under any color-vision deficiency. Type accents don't apply to an alerting key either; the alert owns the whole palette.

## Worked examples

### CPU temperature: warn 80, crit 90

A typical desktop-CPU key in °C:

- **Warn at** `80`
- **Critical at** `90`
- **Direction**: leave unticked (higher is worse)

Idle and under load the key stays themed. At 80 °C it goes amber; at 90 °C it goes red. If you'd rather read the face in Fahrenheit, tick *Show temperatures in °F* **and** enter the thresholds in °F (e.g. `176` / `194`); the numbers must match the displayed unit.

![HWiNFO Sensors on a Stream Deck: seven display themes across the top row (Void, Graphite, Ultraviolet, Midnight, Forest, Ember, Paper), each key showing a live value, unit and sparkline; below them the aviation-style amber warn and red critical alert states; and two Stream Deck + dials with session range bars.]({{ '/assets/img/themes-contact-sheet.png' | relative_url }})

### Fan RPM: alert when it drops

A fan you want to catch stalling:

- **Warn at** `500`
- **Critical at** `300`
- **Direction**: **ticked** (alert when below)

Above 500 RPM the key is normal; at 500 or under it warns; at 300 or under it goes critical (0 RPM = a stopped fan = red).

### Free disk space: alert on a low floor

Free space in GB, so you notice before a drive fills:

- **Warn at** `50`
- **Critical at** `20`
- **Direction**: **ticked** (alert when below)

Drops to 50 GB → amber; drops to 20 GB → red.

> **Tip:** When you use the *below* direction, set **Critical at** *lower* than **Warn at** (crit is the worse, deeper floor). Because critical is evaluated first, an inverted pair (e.g. warn 300, crit 500 with below on) makes the reading go straight to critical without ever showing warn.

## Where thresholds live

The **Warn at**, **Critical at** and **Direction** controls are on both the Sensor Reading (key) and Sensor Dial property inspectors, just below the display options. They're per-key / per-dial (each reading gets its own limits) and they persist with the rest of that button's [settings](sensor-reading.md).
