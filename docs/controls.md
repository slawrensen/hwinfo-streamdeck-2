---
title: Dial controls & presets
nav_order: 5.5
---

How the dial's physical inputs map to actions. Everything on this page is configured per dial in the [Sensor Dial](sensor-dial.md) settings panel; the preset, gesture, reset-reach and Link ID fields live under its **Dial gestures & advanced** section, and the rotation set, Ignore turns, Auto cycle and thresholds sit in the main panel.

## Control presets

| Preset | Rotate | Press+rotate | Push | Touch | Long touch |
| --- | --- | --- | --- | --- | --- |
| **Legacy** (default) | Cycle readings | Cycle readings | Reset session stats (fires the moment you press) | Cycle stat mode | Back to current |
| **Elite** | Cycle readings | Switch sensor or [rotation group](#rotation-groups) | Short: pause/resume auto cycle. Long (hold half a second): reset session stats | Cycle stat mode, or [touch zones](#touch-zones) | Back to current |
| **Custom** | Your pick | Your pick | Your pick, short and long separately | Your pick | Your pick |

Nothing remaps until you change it: every dial that existed before presets, and every new dial, runs **Legacy**, which keeps every earlier release's gesture map exactly. One 1.1.10.0 fix applies to all presets: rotating to a different reading clears a custom label, so the title can no longer name one reading while showing another's value. Set **Label mode** to "fixed title" if you want the old sticky-label behavior back.

Two Elite details worth knowing:

- **Press+rotate** jumps between sensor sources (CPU to GPU to drive), while plain rotate steps through readings. With a [rotation set](sensor-dial.md#rotation-set-ignore-turns-and-auto-cycle), press+rotate jumps between the sensors represented in your set. With [rotation groups](#rotation-groups), it jumps between your groups instead.
- A press that saw any rotation executes nothing on release. One physical interaction is one command, always.

The Stream Deck app's own gesture hints (shown when you hover a dial in the app) follow the preset you picked.

![The dial's settings panel with the "Dial gestures & advanced" section open: the Controls preset select on Elite with its help text, the Touch zones and Reset reach selects, and a Link ID field reading "cpu-dial".]({{ '/assets/img/pi-dial-presets.png' | relative_url }})

With **Custom** selected, one select per gesture appears (rotate, press+rotate, short push, long push, touch tap, long touch), plus the touch-zone picker. Switching from Elite to Custom copies Elite's map into every gesture you have not set yourself, so "Elite minus the one gesture you want different" is a single change; unset gestures on a dial that went straight to Custom keep their Legacy commands.

![The Custom preset's per-gesture selects in the settings panel: Rotate, Press+rotate, Short push, Long push, Touch tap and Long touch, each with its own command, above the Touch zones, Reset reach and Link ID fields.]({{ '/assets/img/pi-dial-custom.png' | relative_url }})

## Rotation groups

Optional, and nothing changes until you build them: split the rotation set into named groups (group A, group B, group C) and the dial gets two speeds. Plain rotate stays inside the active group; press+rotate on Elite (or any gesture set to "Switch sensor or group" on Custom) jumps to the next group, and the dial shows the landing group's name on its bottom line for a moment.

Build them in the dial's settings panel. **Split into groups** under the rotation set turns your current set into group 1 and adds an empty group 2. The radio in front of a group marks where ticks land: tick readings in the sensor list and they join that group. Each group has an optional name ("CPU", "GPU", "Cooling"); unnamed groups show as "group 2" and so on. **Add group** appends another, the × on a group removes it (its readings leave the rotation), and **Merge back into one set** flattens everything into a plain rotation set again.

![The rotation set split into two named groups: "Overview" holding CPU temperature, GPU temperature and pump chips with the CPU chip highlighted blue as the reading on the dial, and "GPU" holding GPU hot spot and GPU clock chips, each group with a name field and a remove button, the collector radio marked on "GPU", with the Add group and Merge back into one set buttons below.]({{ '/assets/img/pi-dial-groups.png' | relative_url }})

Details worth knowing:

- The active group is wherever the current reading lives. Jumping groups moves it, and so do the HWiNFO Control key and an alert interrupt; rotate after any of those and you are stepping inside the group you landed in. A group whose readings are all missing (sensor asleep, device gone) is skipped by the jump.
- Auto cycle steps inside the active group. With **On alert** ticked it still watches every group: a critical reading anywhere in the set pulls the cycle to it, group boundary or not.
- Plain rotate honors group boundaries only while the dial has a gesture that can cross them. Legacy has none, so Legacy rotates through all groups as one flat list, exactly as it always has. On Custom, assign "Switch sensor or group" to any gesture and the boundaries engage; assign it nowhere and the dial keeps one flat list, so no group can ever become unreachable.
- The [HWiNFO Control key](#the-hwinfo-control-key-action)'s "Next/Previous sensor or group" commands honor your groups on every preset.
- A single group behaves like a plain rotation set. **Reset reach** "set" keeps meaning the whole set: every group.
- Older plugin versions read the groups as one flat set (the set is stored alongside the groups), so downgrading loses nothing and the groups wake up again after re-updating.

## Touch zones

Off by default. With **two zones**, the left half of the touchscreen steps to the previous reading and the right half to the next. With **three zones**, left and right step and the center keeps the tap command (stat cycling by default). Zone edges sit at exact half or third boundaries of the 200 px touch segment; a tap exactly on a boundary counts as the zone to its right.

## Pause, pin, and reset reach

- **Pause/resume auto cycle** stops the auto cycle until you resume it (resuming waits one full interval before the next step). The dial's bottom line shows "cycle paused".
- **Pin** locks the selection completely: turns, taps and auto cycle cannot move the dial off its reading until you unpin. The bottom line shows "pinned".
- **Reset reach** decides what a stats reset clears: the current reading (default), the whole rotation set, or every dial. "Every dial" never rides on a default gesture; you have to pick it on purpose.

Pause and pin survive page switches and profile changes for up to 30 minutes off screen (the plugin parks the state of the 64 most recently hidden dials; past either bound a returning dial starts fresh). They also reset when the Stream Deck app restarts.

![Three dial faces rendered by the plugin: a CPU temperature dial whose bottom line reads "pinned", a pump dial whose bottom line reads "cycle paused", and a GPU hot spot dial at a forced critical value with the range bar fill in red, where an alert-aware auto cycle holds.]({{ '/assets/img/dial-states.png' | relative_url }})

## Session stats are per reading

Each reading keeps its own session min/max/average, keyed by HWiNFO's stable sensor identity. Rotate away and back and you find that reading's own session numbers again, not the neighbor's. Stats keep accumulating for every rotation-set member while other members are on screen, and while the dial is on another page (within the same 30-minute hidden window as pause and pin). One prerequisite: the plugin's poller only runs while at least one of its keys or dials is on screen somewhere, so a page with none of them pauses the accumulation too.

## Thresholds and mixed units

The mapping is yours to define: a reading is **warning** once it crosses **Warn at** and **critical** once it crosses **Critical at**, in the alert direction (above the value by default; below it with the Direction checkbox). Warn paints the face amber, critical paints it red, on keys and dials alike.

Warn/critical thresholds and the manual bar range apply only to readings measured in the unit they were configured against. Type a warn value of 80 while a °C reading is selected, and it will never fire on a 3000 RPM fan you rotate to; the alert and the manual bar simply stand down for readings in other units. Edit a threshold and it re-anchors to the unit of the reading on screen at that moment.

Unit scoping starts with the first threshold you edit after updating. Thresholds saved by earlier versions keep their old reach (they apply to whatever the dial shows) until you touch one; guessing which reading an old threshold was meant for would risk silently disabling it.

Alert-aware cycling is opt-in via the **On alert** setting. Ticked, the auto cycle follows alerts: it never rotates away from a reading that is currently critical (a manual turn releases it), and its next step goes to a critical member of your set instead of the next one in order. Unticked (the default), alerts do not steer the cycle at all; it keeps stepping in order, straight through critical readings.

## The HWiNFO Control key action

**HWiNFO Control** is a key action that drives Sensor Dials remotely: from a pedal, a G-key, a Multi Action step, a Key Logic slot (Stream Deck 7.0+), or a plain key, on any connected device. Pick a command (next/previous reading or sensor, stat mode, pause/resume, pin/unpin, reset) and optionally a **Target**.

Targeting is explicit. Give a dial a **Link ID** in its settings and put the same name in the control key's Target field; the key then drives only dials with that ID, wherever they live. An empty Target drives every dial. The key shows a tick when the command reached at least one matching dial (a pinned dial still counts as reached), and an alert icon when none matched. One reach limit: the target dial has to be on screen somewhere, on any connected deck. A dial hidden behind another page of its own deck is not reachable, which is why the sources listed above are other devices or automations, not a key that swaps the dial off screen as you press it. Pause/resume and pin/unpin have explicit one-way variants, so repeated presses in a Multi Action stay harmless.

![The HWiNFO Control key's settings panel with every section open: the "What this key does" intro, the Command select on "Next reading", the Target field reading "cpu-dial", the Reset reach select with the help text explaining Link ID targeting, and the Copy support report button.]({{ '/assets/img/pi-control.png' | relative_url }})

## Page swipe

Swiping sideways on the touch strip switches Stream Deck pages. That gesture belongs to the Stream Deck app itself; no plugin receives it, and this one does not pretend to. What the plugin does guarantee: selection and labels are persisted settings and always survive; session stats, pause and pin state survive the page switch within the 30-minute hidden window described above.

## Settings migration

Settings only ever gain fields; nothing existing is renamed or removed.

- Dials without a `controlPreset` field run Legacy, exactly as before.
- Rotation groups are a new optional field; dials without groups behave exactly as before on every preset. The flat rotation set is kept mirrored to the union of all groups, so a downgrade to an older plugin version runs the union as one set and loses nothing.
- The unit anchor for thresholds (`alertUnit`) is stamped the first time you edit a threshold after updating, from the reading on screen at that moment; until then thresholds behave exactly as they did.
- **Label mode** defaults to the existing behavior (a custom label clears when rotation moves to another reading). Pick "fixed title" to keep it through rotation.
- The dial's **View** and the key's **Layout** (1.2.0) are new optional fields too: anything other than their exact overview/dual markers, including values a newer version might write, renders the unchanged single face. A dual key also needs a usable second reading; without one it stays single.
- Per-reading names (`rotationNames`, 1.2.0) are another optional field: a map from reading identity to display name, written only by the chip rename in the settings panel. Junk entries are ignored one by one, and older plugin versions ignore the field entirely.
- The overview's **Row labels** field (`overviewLabels`, 1.2.0) shortens shared prefixes by default; only the exact value "full" turns that off. Anything else, including future values, keeps the default.
- Malformed or unexpected values in any field fall back to safe defaults instead of failing; a broken settings blob renders and keeps working.
