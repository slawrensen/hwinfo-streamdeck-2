---
title: Sensor Reading (keys)
nav_order: 4
---

The **Sensor Reading** action puts one live HWiNFO reading on a Stream Deck key: a value, its unit, a custom label, an optional sparkline, and warn/critical coloring. Drag **HWiNFO Sensors → Sensor Reading** onto a key and pick a sensor to start.

This page documents every setting in the key's settings panel. For the Stream Deck + dial, see [Sensor Dial](sensor-dial.md).

![The full Sensor Reading settings panel in the Stream Deck property inspector, showing the ]({{ '/assets/img/settings-panel.png' | relative_url }})

## Settings

### Sensor

A searchable picker over every reading HWiNFO publishes (typically 500+), grouped by source (CPU, GPU, drives, network, and so on). Type in the **Search sensors…** box to filter; each row shows a live value so you can confirm you have the right one. The **⟳** button reloads the list if HWiNFO's sensor set changed.

The selected sensor is stored as HWiNFO's stable `sensor-id : instance : reading-id` identity, not a list position, so keys survive HWiNFO restarts and sensor reordering. If that identity later disappears from HWiNFO's output (a hardware, driver, or sensor-profile change), the key shows **Sensor missing / pick again** — reopen settings and pick it again.

> **Note:** With the picker open, pressing Enter with no search text typed does **not** change your selection (fixed in 1.1.5.0). Your saved sensor is left untouched.

The **Live value** row directly below the picker mirrors the current reading (and its min/max/avg where available) while the settings panel is open, so you can verify the choice without looking at the key.

### Label

Custom text for the key. Leave it blank to use the sensor's own (HWiNFO-renamed) label. Long labels are truncated to fit the 72 px key with an ellipsis: up to **16 characters** when centered, or **9 characters** when a stat badge (MIN/MAX/AVG) shares the top row.

### Theme

A live gallery of the seven presets — **Void** (default), **Graphite**, **Ultraviolet**, **Midnight**, **Forest**, **Ember**, and **Paper**. Pick one to theme **this key only**, or pick the **Deck default** chip to follow the deck-wide theme set under *Advanced → Deck theme*.

Precedence: a per-key theme always wins; the deck theme only affects keys set to Deck default. The Deck default chip is labelled with the theme it currently resolves to (e.g. *Deck default · Void*) and wears a dashed border and a link badge so it can't be mistaken for a preset chip. See [Themes](themes.md) for the full palette and type-accent details.

### Show (stat mode)

What the key displays, drawn from HWiNFO's own statistics since it started:

| Option | Shows |
| --- | --- |
| **Current value** *(default)* | The live reading. |
| **Minimum (since HWiNFO start)** | Lowest value HWiNFO has recorded. |
| **Maximum (since HWiNFO start)** | Highest value HWiNFO has recorded. |
| **Average (since HWiNFO start)** | Running average HWiNFO has computed. |

When a non-current mode is selected, a small **MIN / MAX / AVG** badge appears in the top-right corner of the key.

> **Note:** Min / max / average come from HWiNFO's Shared Memory interface. On the Gadget-registry fallback these statistics aren't available, so all four modes show the current value. See [Data sources](data-sources.md).

### Decimals

Controls value precision:

- **Auto** *(default)* — scales precision with magnitude and compacts large numbers so they never overflow the key: values ≥ 100,000 and ≥ 10,000 are shown in thousands (e.g. `48700` → `48.7k`); ≥ 100 shows 0 decimals; ≥ 10 shows 1; below 10 shows 2.
- **0 / 1 / 2 / 3** — a fixed number of decimal places.

### Unit

**Show temperatures in °F** converts °C readings to Fahrenheit for display. It only affects readings whose unit is °C; every other unit is left as HWiNFO reports it. Thresholds and the sparkline follow the displayed unit — see the notes below.

### Sparkline

**Show recent history** draws a filled line of the reading's recent values along the bottom of the key, tinted with the key's accent (or its sensor-type accent, if type accents are on).

- It holds the last **36 samples** and fills at **HWiNFO's own update rate** (default 2 s), not the plugin's poll rate — one new point per genuinely fresh HWiNFO snapshot.
- History **persists across page changes** (1.1.6.0): switching Stream Deck pages, waking the machine, or the app reconnecting no longer wipes the line — the graph stays drawn. A graph on a page you haven't viewed in a long while (over a minute) does rebuild from scratch.
- It **survives a °C/°F toggle** unchanged (same data, just relabelled), and a frozen HWiNFO holds the line's last real shape instead of flattening it.
- The sparkline self-scales to its own visible min/max, so the shape reflects recent variation, not absolute magnitude.

> **Note:** Changing the poll interval (*Advanced → Poll every*) resets sparkline history, because the ring is spaced by sample index and can't honestly span a cadence change.

### Warn at / Critical at

Thresholds in the **displayed unit**. When the live value crosses **Warn at**, the whole key flips to an amber field with black text; at **Critical at**, a red field with white text — aviation-style master caution/warning. These two alert palettes are global and never tinted per theme, so warn and crit stay unmistakable on any theme. Leave a field blank to disable it. Decimal commas are accepted (`70,5` works as `70.5`).

See [Thresholds & alerts](thresholds-alerts.md) for the full behavior.

> **Note:** Warn/critical always track the **live** value, even when the key is showing MIN, MAX, or AVG. The stat mode changes what number you see; it never changes what triggers the alert.

### Direction

**Alert when value drops below thresholds** flips the comparison so *lower is worse*. Use it for readings where a low number is the problem — fan RPM, free disk space, remaining battery. With it off (default), higher is worse (temperatures, power, load).

## Pressing the key

Pressing the key cycles the displayed stat: **current → MIN → MAX → AVG → current**. The corner badge updates to match, and the choice is saved back to the key's settings (so it's the same as changing **Show** in the panel). Warn/critical coloring keeps tracking the live value throughout.

## Status screens

If HWiNFO isn't providing data, the key shows a calm true-black status screen with a two-line message instead of a value:

| Key shows | Meaning / fix |
| --- | --- |
| **Start HWiNFO / not detected** | HWiNFO isn't publishing on either interface — start it with Shared Memory Support (or Gadget reporting) enabled. |
| **Shared Memory / is off** | HWiNFO reports sharing disabled — re-enable it in HWiNFO Settings (Auto mode falls back to Gadget by itself). |
| **Not updating / check sharing** *(or* **check Gadget***)* | Values are frozen — HWiNFO's Sensors window was closed, or the free version's 12-hour shared-memory timer expired. The sub-line names the source in use. |
| **Tick sensors / in Gadget** | Gadget reporting is on but no sensors are ticked — right-click values in HWiNFO and choose "Report value in Gadget". |
| **Access denied / un-elevate** | HWiNFO and Stream Deck run at different privilege levels — run both elevated or both normal. |
| **Pick a sensor / in settings** | No sensor selected yet — open the key's settings. |
| **Sensor missing / pick again** | The saved sensor isn't in HWiNFO's current output — pick it again. |

The settings panel shows the matching plain-language explanation and fix while the key is in one of these states. Full details are on [Status screens](status-screens.md).

## Advanced (deck-wide)

The **Advanced** section in this panel holds settings that apply to the whole deck, not just this key: **Deck theme**, **Type accents**, **Data source**, and **Poll every**. They're documented under [Themes](themes.md) and [Data sources](data-sources.md).
