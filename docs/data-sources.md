---
title: Data sources
nav_order: 8
---

The plugin reads HWiNFO through one of two local interfaces. It picks the best one automatically, so most people never touch this — but knowing the trade-offs explains why some keys can't show min/max/avg, and why readings keep working after HWiNFO's free 12-hour timer.

## Shared Memory vs. Gadget registry

| | **Shared Memory** (preferred) | **Gadget registry** (fallback) |
| --- | --- | --- |
| What it reads | `Global\HWiNFO_SENS_SM2` mapping | `HKCU\Software\HWiNFO64\VSB` registry key |
| Sensor coverage | **everything** HWiNFO measures (~500+ readings) | only the sensors you tick in HWiNFO |
| Min / max / average | ✅ full stats since HWiNFO started | — current value only (min/max/avg **show the current value**) |
| Free version | auto-disables after **12 hours** (HWiNFO Pro: unlimited) | ✅ no time limit |
| Works across privilege levels | usually — fails only when HWiNFO is elevated and Stream Deck is not (see [Troubleshooting](troubleshooting.md)) | ✅ yes |
| Enable in HWiNFO | Settings → **Shared Memory Support** | sensor right-click → **Report value in Gadget** |

Shared Memory is richer in every way except licensing: on the free version it switches itself off after 12 hours of runtime. The Gadget registry has none of that time pressure but only carries the current value of the specific readings you ticked, with no historical min/max/avg.

> **Note:** Because the Gadget source has no historical stats, a key set to **Show: Minimum / Maximum / Average** displays the current value while reading from it. When a key is on the Gadget source, the settings panel shows a small note explaining this.

### Enabling Shared Memory

In HWiNFO → **Settings** → tick **Shared Memory Support**. This is the recommended setup and gives you full stats. See [Getting started](getting-started.md) for the full first-run checklist.

### Enabling Gadget reporting

In HWiNFO's Sensors window, right-click each reading you want and tick **Report value in Gadget**. Only ticked readings appear to the plugin — an enabled-but-empty Gadget key surfaces a **Tick sensors / in Gadget** screen on the key.

## Auto mode

The **Data source** setting defaults to **Auto**, and it's what most setups should stay on. In Auto mode the plugin:

1. Uses **Shared Memory** whenever it's available.
2. **Silently falls back to the Gadget registry** when Shared Memory isn't usable — for example after the free version's 12-hour timer expires, or if you turned Shared Memory Support off but still have Gadget reporting on.
3. **Upgrades back to Shared Memory** on its own once it returns (probed roughly every 15 seconds while on the fallback), so restarting HWiNFO or re-enabling sharing quietly restores full stats with no clicks.

There's one exception to the "prefer Shared Memory" rule: if Shared Memory is simply not running *and* you have Gadget reporting enabled but no sensors ticked, the plugin shows the more helpful **Tick sensors / in Gadget** guidance rather than a generic "Start HWiNFO".

> **Note:** When the free version disables Shared Memory it leaves the named mapping behind flagged with a `DEAD` marker rather than removing it. As of 1.1.5/1.1.6 the plugin validates that marker the moment it opens the mapping, so Auto mode reliably falls back to the Gadget registry instead of getting stuck on the **Shared Memory / is off** screen. (Earlier versions could strand there.)

The plugin runs **one reader** for the whole deck regardless of how many keys and dials are visible, so all of them share the same source at any moment.

## Advanced settings

Both the Sensor Reading (key) and Sensor Dial actions expose the same two data-source controls under **Advanced**. They are **global** — one setting for the whole plugin, not per key.

### Data source

| Option | Behavior |
| --- | --- |
| **Auto (Shared Memory, else Gadget)** *(default)* | The fallback/upgrade logic above. Recommended. |
| **Shared Memory only** | Never touches the Gadget registry. If Shared Memory is off or expired, keys show a status screen instead of falling back. |
| **Gadget registry only** | Reads only the registry. Current values only, but immune to the 12-hour limit. |

### Poll every

How often the plugin reads the source, from **250 ms** to **5 seconds** (default **1 second**). One reader serves every visible key and dial, so this is the plugin's total read rate, not per-key.

> **Note:** HWiNFO updates its own sensors on a separate poll cycle (default **2 seconds**, set in HWiNFO's own settings). That cycle is the real ceiling on how fast values and sparklines change — polling the plugin faster than HWiNFO refreshes just re-reads the same numbers. Match or slightly under-run HWiNFO's interval for the freshest data without wasted reads. A slower plugin poll is a fine way to trim CPU further if you don't need sub-second updates.

## How this shows up elsewhere

- On the Gadget source, key **Show: Min/Max/Average** modes and the dial's session bar still work from live values, but there's no HWiNFO-provided historical min/max/avg to draw on — see [Sensor Reading](sensor-reading.md) and [Sensor Dial](sensor-dial.md).
- If the current source stops updating (HWiNFO's Sensors window closed, or the shared-memory timer expired), keys switch to a **Not updating** screen whose second line matches the source — **check sharing** on Shared Memory, **check Gadget** on the Gadget registry. Full list in [Troubleshooting](troubleshooting.md).
