---
title: Themes & colors
nav_order: 6
---

Themes control how every key and dial looks: background, label, value, unit, accent and sparkline track. Seven presets ship with the plugin, and you can set one per key/dial or once for the whole deck. On top of that, **type accents** tint the accent color by sensor category, and **alerts** override everything when a value crosses a threshold.

## The seven presets

Pick a theme from the live gallery in any key's or dial's settings (the **Theme** row). Every chip previews its real colors.

| Preset | Character |
| --- | --- |
| **Void** *(default)* | True black (`#000000`): pixels off on OLED, only the data glows. |
| **Graphite** | Near-black slate (`#1A1C22`): the plugin's original look, retuned. Existing installs stay here after updating (see below). |
| **Ultraviolet** | Deep violet cast with lavender signal. |
| **Midnight** | Blue-black with ice-blue signal. |
| **Forest** | Green-black with spring-green signal. |
| **Ember** | Amber-on-black monochrome: VFD/nostalgia look, warm amber value on true black. |
| **Paper** | High-contrast light theme (near-black ink on warm paper `#E9E6DE`) for bright rooms and low vision. |

![A contact sheet of the seven themes (Void, Graphite, Ultraviolet, Midnight, Forest, Ember, Paper), each key showing a live value, unit and sparkline, with the amber warn and red critical alert states and two Stream Deck + dials with session range bars below.]({{ '/assets/img/themes-contact-sheet.png' | relative_url }})

> **Note:** Void is the default for new installs. Graphite is the pre-theme legacy look. If you had the plugin configured before themes existed, the deck default stays on **Graphite** so nothing changes visually; a genuinely fresh install starts on **Void**. Either way, the moment you pick any theme yourself, that choice takes over.

## Per-key vs. deck-wide

Every key and dial has its own **Theme** setting. You can:

- **Set a preset per key/dial**: that key uses exactly that theme, ignoring everything else.
- **Follow the deck default**: the key uses whatever the deck-wide theme is, so changing one setting re-skins the whole wall at once.

Set the deck-wide theme under **Advanced → Deck theme** in any key's settings, or under **Dial gestures & advanced → Deck theme** on a dial (it's a global setting; there's one value for the whole plugin).

### Precedence

> **The rule:** a per-key theme always wins. The Advanced *Deck theme* only affects keys and dials set to **Deck default**.

### The "Deck default" chip

The theme gallery leads with a **Deck default** chip, followed by the seven presets. Click it to make that key follow the deck-wide theme instead of pinning a preset.

Because that chip previews the *resolved* deck theme, it could look identical to the preset it currently follows. To keep it unmistakable, the Deck default chip (as of 1.1.5):

- wears a **dashed frame** and a small **link/follow badge** (a drawn glyph, not an emoji, so it stays legible on any palette),
- shows **"auto"** on its face instead of a sample value,
- names the resolved theme in its tooltip and in the help line under the gallery, e.g. *Deck default · Void* / "currently Void".

So even when the deck theme it follows renders an identical palette, the follow chip is never mistaken for the Void (or any) preset chip.

![The Theme gallery in the property inspector: the dashed "Deck default" chip with its link badge and "auto" face, followed by the seven preset chips, with the help line under the gallery naming the resolved theme.]({{ '/assets/img/settings-panel.png' | relative_url }})

## Text: Theme, Dim, or Custom

The dark themes use bright near-white values, and Ember uses amber. Both can be too much in a dark room or for light-sensitive eyes, so every key and dial has a **Text** setting directly under its theme gallery, with a deck-wide default under *Advanced → Deck text*:

- **Theme** *(deck-wide default)*: the selected theme's own text colors, exactly as before.
- **Dim**: a lower-intensity version of the theme's text. One fixed algorithm blends each text color toward the theme background, so it lands correctly on dark and light themes alike and keeps the value/label/unit hierarchy.
- **Custom**: your own color. **Text color** sets it, and the main value uses it **exactly as picked**, never adjusted. **Dim labels, units and stats** decides the secondary text: ticked, labels, units, suffixes and MIN/MAX/AVG badges take the same hue at lower intensity; unticked, every textual element uses the exact color.

Per-key and per-dial settings default to **Deck default**, which follows the deck-wide Text value; a local **Theme**, **Dim** or **Custom** wins over it, mirroring the theme precedence rule. An invalid custom color falls back to theme text.

![The Text select under the theme gallery, set to Custom, with the Text color well and the "Dim labels, units and stats" checkbox revealed.]({{ '/assets/img/pi-key-text.png' | relative_url }})

The setting recolors **text only**. Backgrounds, theme and type accents, sparklines, bars, rings, range bars, tracks and separators keep their theme colors, status screens keep their fixed safety colors, and the [alert palettes](#alerts-override-everything) always override it: a warning key is amber with black text whatever Text says, and a dial's alert-colored bar or overview row value is never recolored.

## Type accents

**Type accents** (*Advanced → Type accents*, **on by default**) color each key's accent (the sparkline, the corner badge, and the dial's range bar) by the sensor's type. Only the accent changes; label, value and unit keep the theme's own luminance rhythm.

| Sensor type | Accent |
| --- | --- |
| Temperature | Rose (`#FF7E8E`) |
| Fan | Cyan (`#3FBEDD`) |
| Power | Gold (`#D4AB33`) |
| Clock | Green (`#38CD89`) |
| Load / usage | Violet (`#B195FF`) |
| Network | Blue (`#6FA7FF`) |
| Memory | Magenta (`#CE8BE0`) |

Network and memory readings don't have a dedicated HWiNFO type, so they're recognized from the unit (throughput like `MB/s`, `Mbps`) or label (`memory`, `RAM`/`VRAM`). Anything the plugin can't classify keeps the theme's own accent.

Turn type accents **off** (*Advanced → Type accents → "Off (theme accent everywhere)"*) to use the theme's accent color everywhere instead.

> **Note:** **Paper** ignores type accents by design: its accent stays ink so the light theme keeps its high contrast. Switching to Paper effectively disables accents regardless of the toggle.

## Alerts override everything

When a value crosses a threshold (see [Alerts & thresholds](thresholds-alerts.md)), the theme steps aside for a global alert palette:

| Level | Field | Text |
| --- | --- | --- |
| **Warn** | Bright amber (`#E8940D`) | Black |
| **Critical** | Red (`#CB2114`) | White |

On **keys**, the whole face flips: background, label, value, accent and track all recolor from the alert palette. On **dials** (Stream Deck +), only the **range bar fill** flips to the alert color; the rest of the touchscreen stays themed, because the slot is too small for a full field flip.

The two alert palettes are **global, never tinted per theme**, and the warn/crit fields differ in luminance as well as hue. That aviation-style master-caution/master-warning treatment keeps warn and critical unmistakable on any theme and with any color-vision deficiency. Type accents don't apply while alerting.

---

Themes and colors are pure display: nothing here is sent anywhere. This is a Windows-only, HWiNFO-dependent plugin with no telemetry (MIT licensed). See [Sensor Reading (keys)](sensor-reading.md) and [Sensor Dial (Stream Deck +)](sensor-dial.md) for where each color lands on the face, and [Alerts & thresholds](thresholds-alerts.md) for the threshold rules that trigger the alert palette.
