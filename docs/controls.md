---
title: Dial controls & presets
nav_order: 5.5
---

How the dial's physical inputs map to actions. Everything on this page is configured per dial in the [Sensor Dial](sensor-dial.md) settings panel; the preset, gesture, reset-reach and Link ID fields live under its **Dial gestures & advanced** section, and the rotation set, Ignore turns, Auto cycle and thresholds sit in the main panel.

## Control presets

| Preset | Rotate | Press+rotate | Push | Touch | Long touch |
| --- | --- | --- | --- | --- | --- |
| **Legacy** (default) | Cycle readings | Cycle readings | Reset session stats (fires the moment you press) | Cycle stat mode | Back to current |
| **Elite** | Cycle readings | Switch sensor | Short: pause/resume auto cycle. Long (hold half a second): reset session stats | Cycle stat mode, or [touch zones](#touch-zones) | Back to current |
| **Custom** | Your pick | Your pick | Your pick, short and long separately | Your pick | Your pick |

Nothing remaps until you change it: every dial that existed before presets, and every new dial, runs **Legacy**, which keeps every earlier release's gesture map exactly. One 1.1.10.0 fix applies to all presets: rotating to a different reading clears a custom label, so the title can no longer name one reading while showing another's value. Set **Label mode** to "fixed title" if you want the old sticky-label behavior back.

Two Elite details worth knowing:

- **Press+rotate** jumps between sensor sources (CPU to GPU to drive), while plain rotate steps through readings. With a [rotation set](sensor-dial.md#rotation-set-ignore-turns-and-auto-cycle), press+rotate jumps between the sensors represented in your set.
- A press that saw any rotation executes nothing on release. One physical interaction is one command, always.

The Stream Deck app's own gesture hints (shown when you hover a dial in the app) follow the preset you picked.

![The dial's settings panel with the "Dial gestures & advanced" section open: the Controls preset select on Elite with its help text, the Touch zones and Reset reach selects, and a Link ID field reading "cpu-dial".]({{ '/assets/img/pi-dial-presets.png' | relative_url }})

With **Custom** selected, one select per gesture appears (rotate, press+rotate, short push, long push, touch tap, long touch), plus the touch-zone picker:

![The Custom preset's per-gesture selects in the settings panel: Rotate, Press+rotate, Short push, Long push, Touch tap and Long touch, each with its own command, above the Touch zones, Reset reach and Link ID fields.]({{ '/assets/img/pi-dial-custom.png' | relative_url }})

## Touch zones

Off by default. With **two zones**, the left half of the touchscreen steps to the previous reading and the right half to the next. With **three zones**, left and right step and the center keeps the tap command (stat cycling by default). Zone edges sit at exact half or third boundaries of the 200 px touch segment; a tap exactly on a boundary counts as the zone to its right.

## Pause, pin, and reset reach

- **Pause/resume auto cycle** stops the auto cycle until you resume it (resuming waits one full interval before the next step). The dial's bottom line shows "cycle paused".
- **Pin** locks the selection completely: turns, taps and auto cycle cannot move the dial off its reading until you unpin. The bottom line shows "pinned".
- **Reset reach** decides what a stats reset clears: the current reading (default), the whole rotation set, or every dial. "Every dial" never rides on a default gesture; you have to pick it on purpose.

Pause and pin survive page switches and profile changes for up to 30 minutes off screen (the plugin parks the state of the 64 most recently hidden dials; past either bound a returning dial starts fresh). They also reset when the Stream Deck app restarts.

![Three dial faces rendered by the plugin: a CPU temperature dial whose bottom line reads "pinned", a pump dial whose bottom line reads "cycle paused", and a GPU hot spot dial at a forced critical value with the range bar fill in red, where the auto cycle holds.]({{ '/assets/img/dial-states.png' | relative_url }})

## Session stats are per reading

Each reading keeps its own session min/max/average, keyed by HWiNFO's stable sensor identity. Rotate away and back and you find that reading's own session numbers again, not the neighbor's. Stats keep accumulating for every rotation-set member while other members are on screen, and while the dial is on another page (within the same 30-minute hidden window as pause and pin). One prerequisite: the plugin's poller only runs while at least one of its keys or dials is on screen somewhere, so a page with none of them pauses the accumulation too.

## Thresholds and mixed units

Warn/critical thresholds and the manual bar range apply only to readings measured in the unit they were configured against. Type a warn value of 80 while a °C reading is selected, and it will never fire on a 3000 RPM fan you rotate to; the alert and the manual bar simply stand down for readings in other units. Edit a threshold and it re-anchors to the unit of the reading on screen at that moment.

Unit scoping starts with the first threshold you edit after updating. Thresholds saved by earlier versions keep their old reach (they apply to whatever the dial shows) until you touch one; guessing which reading an old threshold was meant for would risk silently disabling it.

The auto cycle also respects alerts: it never rotates away from a reading that is currently critical (a manual turn releases it), and the optional **On alert** setting makes its next step go to a critical member of your set instead of the next one in order.

## The HWiNFO Control key action

**HWiNFO Control** is a key action that drives Sensor Dials remotely: from a pedal, a G-key, a Multi Action step, a Key Logic slot (Stream Deck 7.0+), or a plain key, on any connected device. Pick a command (next/previous reading or sensor, stat mode, pause/resume, pin/unpin, reset) and optionally a **Target**.

Targeting is explicit. Give a dial a **Link ID** in its settings and put the same name in the control key's Target field; the key then drives only dials with that ID, wherever they live. An empty Target drives every dial. The key shows a tick when the command reached at least one matching dial (a pinned dial still counts as reached), and an alert icon when none matched. Pause/resume and pin/unpin have explicit one-way variants, so repeated presses in a Multi Action stay harmless.

![The HWiNFO Control key's settings panel with every section open: the "What this key does" intro, the Command select on "Next reading", the Target field reading "cpu-dial", the Reset reach select with the help text explaining Link ID targeting, and the Copy support report button.]({{ '/assets/img/pi-control.png' | relative_url }})

## Page swipe

Swiping sideways on the touch strip switches Stream Deck pages. That gesture belongs to the Stream Deck app itself; no plugin receives it, and this one does not pretend to. What the plugin does guarantee: selection and labels are persisted settings and always survive; session stats, pause and pin state survive the page switch within the 30-minute hidden window described above.

## Settings migration

Settings only ever gain fields; nothing existing is renamed or removed.

- Dials without a `controlPreset` field run Legacy, exactly as before.
- The unit anchor for thresholds (`alertUnit`) is stamped the first time you edit a threshold after updating, from the reading on screen at that moment; until then thresholds behave exactly as they did.
- **Label mode** defaults to the existing behavior (a custom label clears when rotation moves to another reading). Pick "fixed title" to keep it through rotation.
- Malformed or unexpected values in any field fall back to safe defaults instead of failing; a broken settings blob renders and keeps working.
