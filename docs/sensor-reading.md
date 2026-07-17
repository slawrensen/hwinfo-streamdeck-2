---
title: Sensor Reading (keys)
nav_order: 4
---

The **Sensor Reading** action puts a live HWiNFO reading on a Stream Deck key: a value, its unit, a custom label, an optional [sparkline, bar, or ring display](#display-sparkline-bar-ring), and warn/critical coloring. A key can also [stack two readings](#layout-two-readings-on-one-key) as two compact rows, or show [four readings in a quad grid](#layout-four-readings-the-quad-grid). Drag **HWiNFO Sensors → Sensor Reading** onto a key and pick a sensor to start.

This page documents every setting in the key's settings panel. For the Stream Deck + dial, see [Sensor Dial](sensor-dial.md).

![The full Sensor Reading settings panel in the Stream Deck property inspector, its rows grouped under flat Sensor, Format, Appearance, Layout and Alerts headers: the sensor picker with a live value and the label field, the stat, decimals and unit rows, the theme gallery with the Text select under it, the layout and Display selects, the threshold controls, and the expanded Advanced section headed Deck defaults (deck theme, Deck text, type accents, data units), Connection (data source, poll rate) and Support (the Copy support report button).]({{ '/assets/img/settings-panel.png' | relative_url }})

## Settings

### Sensor

A searchable picker over every reading HWiNFO publishes (typically 500+), grouped by source (CPU, GPU, drives, network, and so on). Type in the **Search sensors…** box to filter; each row shows a live value so you can confirm you have the right one. The **⟳** button reloads the list if HWiNFO's sensor set changed.

The selected sensor is stored as HWiNFO's stable `sensor-id : instance : reading-id` identity, not a list position, so keys survive HWiNFO restarts and sensor reordering. If that identity later disappears from HWiNFO's output (a hardware, driver, or sensor-profile change), the key shows **Sensor missing / pick again**: reopen settings and pick it again.

> **Note:** With the picker open, pressing Enter with no search text typed does **not** change your selection (fixed in 1.1.5.0). Your saved sensor is left untouched.

The **Live value** row directly below the picker mirrors the current reading (and its min/max/avg where available) while the settings panel is open, so you can verify the choice without looking at the key.

### Label

Custom text for the key. Leave it blank to use the sensor's own (HWiNFO-renamed) label. Long labels are truncated to fit the 72 px key with an ellipsis: up to **16 characters** when centered, or **9 characters** when a stat badge (MIN/MAX/AVG) shares the top row.

### Theme

A live gallery of the seven presets: **Void** (default), **Graphite**, **Ultraviolet**, **Midnight**, **Forest**, **Ember**, and **Paper**. Pick one to theme **this key only**, or pick the **Deck default** chip to follow the deck-wide theme set under *Advanced → Deck theme*.

Precedence: a per-key theme always wins; the deck theme only affects keys set to Deck default. The Deck default chip wears a dashed border and a link badge so it can't be mistaken for a preset chip, and names the theme it currently resolves to in its tooltip and the help line under the gallery (e.g. *Deck default · Void*). See [Themes](themes.md) for the full palette and type-accent details.

### Text

How bright the key's text draws, directly under the theme gallery:

- **Deck default** *(default)*: follows the **Deck text** setting under *Advanced*.
- **Theme**: the selected theme's own text colors, bypassing a deck-wide Dim or Custom.
- **Dim**: a lower-intensity version of the theme's text, for dark rooms and light-sensitive eyes.
- **Custom**: your exact color. Two extra controls appear: **Text color** (the main value uses it exactly as picked) and **Dim labels, units and stats** (secondary text takes the same hue at lower intensity; untick it to paint every textual element the exact color).

The setting recolors text only: backgrounds, accents, sparklines, bars and rings keep their theme colors, and a warn or critical alert always overrides it. Existing keys keep their current look until you change the setting. Details on [Themes](themes.md#text-theme-dim-or-custom).

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

### Layout: two readings on one key

**Layout → Two readings, stacked** splits the key into two rows, each with its own small label and a value with the unit inline, separated by a thin divider. Pick the second reading in the **Second sensor** picker that appears (same searchable picker as the first), and give it an optional **Second label**. While the layout is dual, the Display row hides.

**Second shows** decides the second row's stat:

- **Follows the first reading** *(default)*: both rows show the same stat, and the key press cycles them together. When that stat isn't the current value, **one MIN / MAX / AVG badge sits centered in the divider gap**, the key's most visible spot.
- **Always current / min / max / avg**: pins the second row to a fixed stat. A pinned row whose stat differs from the first row's shows its own small badge inline after its unit (the same idiom the dial uses), never in the key's corner, so row labels always keep their full width.

![The key's settings panel with Layout set to Two readings, stacked: the Second sensor picker holding a GPU temperature, the Second label field and the Second shows select below it.]({{ '/assets/img/pi-key-dual.png' | relative_url }})

![Multi-readout key and dial faces rendered by the plugin: CPU and GPU temperature stacked on one key, the same CPU sensor as a min and max pair, a press-cycled pair showing MAX, a quad grid key with four color-coded readings, and the dial overview and two-row views.]({{ '/assets/img/multi-readouts.png' | relative_url }})

Two stacked rows are this layout's limit; for more, the [quad grid](#layout-four-readings-the-quad-grid) shows four readings per key, which is the ceiling (there is no three-value layout: a quad with three sensors picked leaves its fourth cell empty). Some useful pairs:

- Two related sensors: CPU and GPU temperature, both RAM sticks, two drives.
- The **same sensor twice** with a pinned second stat: current above a pinned maximum, or **Show = min** with **Second shows = Always maximum** for the min/max pair in the image above (framerate lows and highs work the same way).
- A download/upload rate pair for one adapter.

What carries over, and what stays with the first reading:

- **Decimals** and **°F** apply to both rows.
- **Warn at / Critical at** watch the **first** reading only, and an alert recolors the whole key exactly like the single layout. There are no per-row thresholds; put the reading you want alerts on first (or use two keys).
- The sensor-type accent (badge color) follows the first reading.
- The **Display strip is a single-layout feature**: the second row takes its space, so the Display row hides while the layout is dual (the setting is kept for when you switch back).
- Row labels truncate at **16 characters**; badges never cost label space.
- If one row's sensor drops out of HWiNFO's output, that row shows an em-dash placeholder while the other keeps updating; if both drop out, the key shows the usual **Sensor missing** screen.

Switching back to **One reading** restores the exact single-layout face; the second reading's settings are remembered.

### Layout: four readings, the quad grid

**Layout → Four readings, quad grid** splits the key into a 2x2 grid, one reading per cell, behind a hairline cross. The first sensor is the top left cell and the **Second sensor** the top right (the same fields the stacked layout uses, so switching between two and four readings keeps both sensors), with **Third sensor** and **Fourth sensor** pickers below. A quad needs the first sensor plus at least one more; unpicked cells stay empty, so a three-sensor quad is fine.

Four values on a 72 px key leave no room for full labels, so the quad has two ways to keep the cells identifiable:

- **Cell colors** *(default)*: each value is drawn in its cell's color. The preset select offers **Signal** (four distinct hues), **Pairs** (top row one hue, bottom row another, for two related pairs), and **Uniform** (accent blue everywhere); the four color wells beside it recolor any single cell, and the select reads *Custom* when the wells match no preset.
- **Cell labels**: ticking **Show a small label in each cell** switches to a short uppercase label above each value; the label takes the cell color and the value the theme's text color. Labels come from the **Label** and **Second label** fields for the top cells and **Third label / Fourth label** for the bottom ones, defaulting to the sensor name's first word; the first 4 characters show.

Values compact to at most **four characters** per cell: decimals drop first, then large numbers shorten (`48700` shows as `49k`), so a cell never overflows.

![The key's settings panel with Layout set to Four readings, quad grid: the Third and Fourth sensor pickers holding a GPU clock and a pump speed, the Cell colors row with its preset select and four color wells, and the Cell labels toggle below them.]({{ '/assets/img/pi-key-quad.png' | relative_url }})

What carries over from the other layouts, and what stays with the first sensor:

- All cells show the **same stat**, and pressing the key cycles them together; a non-current stat shows one MIN / MAX / AVG badge centered on the cross. Per-cell stat pins are a dual-layout feature.
- **Decimals** and **°F** apply to every cell.
- **Warn at / Critical at** watch the **first** sensor only, and an alert recolors the whole key in the global alert palette, over the cell colors, exactly like the other layouts; no cell color can be mistaken for an alert.
- The sensor-type accent (badge color) follows the first sensor, and the **Display strip stays a single-layout feature**.
- A cell whose sensor drops out of HWiNFO's output shows an em-dash placeholder while the rest keep updating; if every picked sensor drops out, the key shows the usual **Sensor missing** screen.

Switching back to **One reading** or **Two readings, stacked** restores that exact face; the extra sensors, labels and colors are remembered for the next switch to quad.

### Decimals

Controls value precision:

- **Auto** *(default)*: scales precision with magnitude and compacts large numbers through **k, M, G and T** so they never overflow the key (`48700` → `48.7k`, `48700000` → `48.7M`): ≥ 100 shows 0 decimals; ≥ 10 shows 1; below 10 shows 2, at every tier.
- **0 / 1 / 2 / 3**: a fixed number of decimal places.

Byte quantities and transfer rates scale by their real units instead of the generic ladder; see [Data units](#advanced-deck-wide).

### Unit

**Show temperatures in °F** converts °C readings to Fahrenheit for display. It only affects readings whose unit is °C; every other unit is left as HWiNFO reports it. Thresholds and the Display strip follow the displayed unit; see the notes below.

### Display: sparkline, bar, ring

One strip under the value, on the single layout only:

- **None (value only)** *(default)*: just the value.
- **Sparkline (recent history)**: a filled line of the reading's recent values along the bottom of the key, tinted with the key's accent (or its sensor-type accent).
- **Bar (value in its range)**: a horizontal gauge in the sparkline's spot showing where the live value sits in its range.
- **Ring (value in its range)**: the same gauge as a radial arc around the value.

![Display modes and the Text setting rendered by the plugin: a sparkline key, a percentage bar, a bar with amber and red threshold zones, a ring, a dial bar sharing the zones, and theme, dim, custom and secondary-dimmed text faces.]({{ '/assets/img/display-text.png' | relative_url }})

![The Display selector in the key's settings panel, set to Bar, with its help line.]({{ '/assets/img/pi-key-display.png' | relative_url }})

Bar and Ring find their range automatically:

- **Percentages** (and duty cycles) run 0 to 100.
- **Yes/No readings** run 0 to 1.
- Everything else spans the **values actually seen**: HWiNFO's session min/max plus the plugin's own recent samples, so the gauge settles as the session accumulates. There are no manual bounds to type.
- **Warn at / Critical at** draw amber and red zones that escalate **toward the alarmed end**: amber then red at the high side normally, mirrored to the low side when *Direction* alerts below, the classic instrument convention (a fuel gauge is red at empty, a tachometer at the top). The range widens to keep the zones visible.

The zones are **fixed landmarks**, drawn as muted shades so they read as markers, not state; the **moving fill is the live value**, and it keeps its full color (accent normally, amber/red while alerting) so it always stands out over them. The gauge follows the **live** value even while the key's text shows MIN, MAX, or AVG, exactly like alert coloring. Dual and quad layouts have no strip, so the Display row hides there.

Sparkline notes:

- It holds the last **36 samples** and fills at **HWiNFO's own update rate** (default 2 s), not the plugin's poll rate: one new point per genuinely fresh HWiNFO snapshot.
- History **persists across page changes** (1.1.6.0): switching Stream Deck pages, waking the machine, or the app reconnecting no longer wipes the line; the graph stays drawn. A graph on a page you haven't viewed in a long while (over a minute) does rebuild from scratch.
- It **survives a °C/°F toggle** unchanged (same data, just relabelled), and a frozen HWiNFO holds the line's last real shape instead of flattening it.
- The sparkline self-scales to its own visible min/max, so the shape reflects recent variation, not absolute magnitude.

> **Note:** Changing the poll interval (*Advanced → Poll every*) resets sparkline history, because the ring is spaced by sample index and can't honestly span a cadence change. Keys configured before 1.2.x keep their old Sparkline checkbox behavior until you touch the Display select.

### Warn at / Critical at

Thresholds in the **displayed unit**. When the live value crosses **Warn at**, the whole key flips to an amber field with black text; at **Critical at**, a red field with white text (aviation-style master caution/warning). These two alert palettes are global and never tinted per theme, so warn and crit stay unmistakable on any theme. Leave a field blank to disable it. Decimal commas are accepted (`70,5` works as `70.5`).

See [Thresholds & alerts](thresholds-alerts.md) for the full behavior.

> **Note:** Warn/critical always track the **live** value, even when the key is showing MIN, MAX, or AVG. The stat mode changes what number you see; it never changes what triggers the alert.

### Direction

**Alert when value drops below thresholds** flips the comparison so *lower is worse*. Use it for readings where a low number is the problem: fan RPM, free disk space, remaining battery. With it off (default), higher is worse (temperatures, power, load).

## Pressing the key

Pressing the key cycles the displayed stat: **current → MIN → MAX → AVG → current**. The corner badge updates to match, and the choice is saved back to the key's settings (so it's the same as changing **Show** in the panel). Warn/critical coloring keeps tracking the live value throughout.

On a dual key with **Second shows** at its default (follows the first reading), the press cycles **both rows together**, one shared badge centered on the divider. A second row pinned to a fixed stat stays put while the first row cycles, so a configured pair (say a pinned maximum under a live value) survives any press.

On a quad key every cell shows the same stat, so the press cycles **all four together**, with the one badge at the cross center updating.

## Status screens

If HWiNFO isn't providing data, the key shows a calm true-black status screen with a two-line message instead of a value:

| Key shows | Meaning / fix |
| --- | --- |
| **Start HWiNFO / not detected** | HWiNFO isn't publishing on either interface. Start it with Shared Memory Support (or Gadget reporting) enabled. |
| **Shared Memory / is off** | HWiNFO reports sharing disabled. Re-enable it in HWiNFO Settings (Auto mode falls back to Gadget by itself). |
| **Not updating / check sharing** *(or* **check Gadget***)* | Values are frozen: HWiNFO's Sensors window was closed or HWiNFO stopped polling. The sub-line names the source in use. (The free version's 12-hour expiry shows **Shared Memory / is off** instead, or falls back to Gadget in Auto mode.) |
| **Tick sensors / in Gadget** | Gadget reporting is on but no sensors are ticked. Right-click values in HWiNFO and choose "Report value in Gadget". |
| **Access denied / un-elevate** | HWiNFO and Stream Deck run at different privilege levels. Run both elevated or both normal. |
| **Pick a sensor / in settings** | No sensor selected yet. Open the key's settings. |
| **Sensor missing / pick again** | The saved sensor isn't in HWiNFO's current output. Pick it again. |

The settings panel shows the matching plain-language explanation and fix while the key is in one of these states. Full details are on [Status screens](status-screens.md).

## Advanced (deck-wide)

The **Advanced** section in this panel holds plugin-wide settings shared by every key and dial, in three headed groups: **Deck defaults (every key and dial)** with **Deck theme**, **Deck text**, **Type accents** and **Data units**; **Connection** with **Data source** and **Poll every**; and **Support**. Themes and Deck text are documented under [Themes](themes.md), the sources under [Data sources](data-sources.md).

![The expanded Advanced section in the Stream Deck app: the Deck defaults header over Deck theme, Deck text, Type accents and Data units rows, then Connection with Data source and Poll every, and Support with the Copy support report button.]({{ '/assets/img/pi-live-key-advanced.png' | relative_url }})

**Data units** decides how byte quantities and transfer rates read, everywhere at once:

- **Decimal** *(default)*: bytes in **B / KB / MB / GB / TB** (steps of 1000) and rates as **bits: bps / kbps / Mbps / Gbps / Tbps** (byte rates multiply by 8), so `12000000 B/s` reads **96.0 Mbps**.
- **Binary**: bytes in **B / KiB / MiB / GiB / TiB** (steps of 1024) and rates as **bytes: B/s through TiB/s** (bit rates divide by 8), so the same reading reads **11.4 MiB/s**.

The value is converted whenever the label changes; a `12345.6 MB` reading shows as `12.3 GB` in Decimal and `11.5 GiB` in Binary, never as a relabeled raw number. This is display only: **Warn at**, **Critical at**, and the dial's bar range keep working against the number HWiNFO reports (the displayed unit before this re-tiering), exactly as before.
