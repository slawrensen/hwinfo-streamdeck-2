---
title: Status screens
nav_order: 9
---

When a key or dial can't show a live reading, it shows a **status screen** instead of a value. Each one names the problem on the first line and the fix on the second. They aren't errors to dismiss: they're the plugin telling you exactly what to do next, and every one clears itself the moment HWiNFO is back.

> **New in 1.1.6: OLED-black redesign.** The key status screens are now a true-black background with two short lines: a soft-white headline and a dim fix line (previously three lines of hard white on dark grey). Same guidance, far less glare on OLED Stream Deck hardware. The examples below use the exact 1.1.6 wording.

## Key screens

Each key screen is two short lines. The first names the state; the second is the fix.

![The plugin's status screens rendered as clean OLED-black key faces, each with a two-line message: Start HWiNFO, Shared Memory off, Access denied, Tick sensors in Gadget, Not updating, Pick a sensor, and Sensor missing]({{ '/assets/img/status-screens.png' | relative_url }})

| Key shows | What it means | How to fix it |
| --- | --- | --- |
| **Start HWiNFO** / *not detected* | HWiNFO isn't running, or isn't publishing on either interface. | Start HWiNFO in Sensors-only mode with **Shared Memory Support** enabled; or, on the free version, enable **Gadget reporting** (no 12-hour limit) and tick the sensors you need. |
| **Shared Memory** / *is off* | HWiNFO reports Shared Memory Support as disabled. | Re-enable it in HWiNFO **Settings**. On the free version it switches off after 12 hours. In **Auto** mode the plugin also falls back to the Gadget registry on its own; no action strictly required. |
| **Not updating** / *check sharing* | Data is frozen: the same values keep coming back. Shown when reading **Shared Memory**. | The Sensors window was closed or HWiNFO stopped polling. Reopen the Sensors window; if it keeps happening, restart HWiNFO. (The free version's 12-hour expiry shows **Shared Memory off** instead, or falls back to Gadget in Auto mode.) |
| **Not updating** / *check Gadget* | Same frozen state, but shown when reading the **Gadget registry**. | Check that HWiNFO is still running with Gadget reporting enabled. |
| **Access denied** / *un-elevate* | Windows blocked access to the shared memory: a privilege mismatch. HWiNFO is running elevated ("Run as administrator") while Stream Deck isn't. | Restart HWiNFO **without** elevation, or run **both** elevated. On the free version, Gadget reporting works across privilege levels. |
| **Tick sensors** / *in Gadget* | Gadget reporting is enabled but the registry is empty: nothing is ticked. | In the HWiNFO sensor window, right-click each value you want on the deck and tick **"Report value in Gadget"**. |
| **Needs x64** / *Windows* | Unsupported platform: HWiNFO's interfaces aren't readable here. | This plugin needs 64-bit (x64) Windows. macOS and Windows-on-ARM are unsupported. |
| **Pick a sensor** / *in settings* | The key works, but no sensor is selected yet. | Open the key's settings and choose a sensor from the picker. |
| **Sensor missing** / *pick again* | The saved sensor isn't in HWiNFO's current output. | A hardware/driver change or a renamed sensor profile dropped it. Open settings and pick the sensor again. |
| **HWiNFO error** / *restart HWiNFO* | Rare. The shared memory didn't validate: HWiNFO may be mid-restart or an incompatible/corrupt layout. | Usually clears on the next poll; if it persists, restart HWiNFO. |

> **Note:** *Start HWiNFO*, *Not updating*, and the rest come from the data source (see [Data sources](data-sources.md)). *Pick a sensor* and *Sensor missing* are about this specific key's selection; the data source is fine.

## Dial screens (Stream Deck +)

Dials show the same states in the touchscreen's two-slot layout (a title and a value line). The wording is shortened to fit:

| Dial title | Dial value |
| --- | --- |
| Start HWiNFO | not detected |
| Shared Memory off | enable in HWiNFO |
| HWiNFO stalled | check sharing *(shared memory)* / check Gadget *(gadget)* |
| Access denied | un-elevate HWiNFO |
| Gadget empty | tick sensors |
| Needs x64 Windows | "—" (placeholder glyph) |
| HWiNFO error | restart HWiNFO |
| HWiNFO | rotate to pick *(no sensor selected yet; the hint line says "or use the settings panel")* |
| Sensor missing | waiting *(the saved sensor isn't in HWiNFO's output; the hint says "reselect in settings")* |

Like the key screens, the frozen-data message is **source-aware**: a dial reading from the Gadget registry says *check Gadget*, never *check sharing*.

While **Sensor missing / waiting** shows, the dial ignores turns so a temporary dropout (an HWiNFO restart, a device asleep) can't bump you off the saved reading; it recovers on its own when the sensor returns. Separately, a live dial can carry a small **"cycle paused"** or **"pinned"** label on its bottom line: those aren't status screens, they're the pause and pin states described on [Dial controls & presets](controls.md#pause-pin-and-reset-reach).

## Recovery is automatic

You never have to remove and re-add a key. The plugin keeps probing in the background:

- When HWiNFO is gone, it re-attempts a full open on **every** poll tick (a cheap failing call), so keys light up again within a second or two of HWiNFO returning.
- When data goes **stale** (frozen for more than ~15 s), it probes a fresh connection every ~5 s to tell "frozen but alive" apart from "HWiNFO exited."
- In **Auto** mode, while running on the Gadget fallback it probes shared memory every ~15 s and silently **upgrades** back to it the moment it returns.

So the fix is always on the HWiNFO side (re-enable sharing, tick a sensor, un-elevate) and the deck catches up by itself. No restart of Stream Deck or the plugin is needed.

> **Related:** the *Shared Memory off*, *Not updating*, and *Tick sensors* screens all trace back to how HWiNFO is publishing; see [Data sources](data-sources.md) for the Shared Memory vs. Gadget trade-offs and the 12-hour free-version timer.
