---
title: Installation & requirements
nav_order: 2
---

Getting the plugin running is three things: the Stream Deck plugin itself, a working copy of HWiNFO, and a one-time toggle in HWiNFO so the plugin can read its sensors. This page covers all three.

> **Windows only.** HWiNFO is a Windows application and this plugin reads its shared-memory or Gadget-registry interface locally. There is no macOS or Windows-on-ARM build — the plugin needs 64-bit (x64) Windows. No ads, no telemetry, MIT licensed.

## System requirements

| Requirement | Notes |
| --- | --- |
| **Windows 10 or later**, 64-bit (x64) | Windows-on-ARM and macOS are not supported — the plugin shows a clear "Needs x64 Windows" screen on those. |
| **Stream Deck software 6.6+** | The Elgato desktop app that hosts plugins. Update it from within the app if you are on an older build. |
| **HWiNFO** (free or Pro) | Installer or portable. Download from [hwinfo.com](https://www.hwinfo.com/download/). The plugin does not bundle HWiNFO — you run it yourself. |

Any Stream Deck hardware works for the **Sensor Reading** key action. The **Sensor Dial** action needs a Stream Deck + (the model with dials and a touchscreen).

## Install the plugin

There are two ways to install, depending on where you got the plugin.

**From a GitHub Release (`.streamDeckPlugin` file)**

1. Download `com.lawrensen.hwinfo.streamDeckPlugin` from the [releases page](https://github.com/slawrensen/hwinfo-streamdeck/releases).
2. Double-click the file. The Stream Deck app opens and asks you to confirm the install.
3. Confirm. **HWiNFO Sensors** appears in the actions list on the right, under its own **HWiNFO Sensors** category.

**From the Elgato Marketplace**

Once the plugin is approved on the Marketplace, you can install it from there in one click — the Marketplace hands the same package to the Stream Deck app. Use whichever channel you prefer; the plugin is identical.

> **Note:** No admin rights are needed to install the plugin. If a key later shows **Access denied**, that is a privilege *mismatch* between HWiNFO and Stream Deck, not a permission you granted at install — see [Troubleshooting](troubleshooting.md).

### Updating and removing

- **Update** — double-click a newer `.streamDeckPlugin` (or install the newer version from the Marketplace) and the Stream Deck app replaces the old copy **in place**. Your keys keep their sensors, themes and thresholds.
- **Uninstall** — in the Stream Deck app, right-click the **HWiNFO Sensors** category (or any of its keys) in the actions list on the right and choose **Uninstall**, or manage it under the app's **Preferences → Plugins**. HWiNFO is a separate program — remove it on its own if you no longer need it.

## One-time HWiNFO setup

The plugin reads HWiNFO through one of two interfaces. You only need to enable **one** — the plugin picks the best available source automatically and falls back on its own (see [Data sources](data-sources.md)).

### Recommended: Shared Memory Support

Shared Memory exposes **every** reading HWiNFO measures, with min / max / average. It is the preferred source.

1. Install and start **HWiNFO**. On the startup dialog, choose **Sensors-only** (you don't need the summary window).
2. Open **Settings** (the gear icon).
3. Turn on **Shared Memory Support**.
4. Recommended, so HWiNFO is always feeding the deck without a window in your way:
   - **Auto Start** — HWiNFO launches with Windows.
   - **Minimize Sensors on Startup** — the Sensors window starts minimized.
   - (Combined with Sensors-only, HWiNFO runs quietly in the background.)
5. Click **OK**.

> **Free version — 12-hour limit.** On free HWiNFO, Shared Memory Support switches itself **off after 12 hours** (HWiNFO Pro removes the limit). When that happens the plugin automatically falls back to the Gadget registry if you have it enabled, and upgrades back to Shared Memory the next time it returns. To keep full Shared Memory data indefinitely on the free version, re-enable it (or restart HWiNFO); to remove the limit entirely, use HWiNFO Pro.

### Free path: Gadget reporting

Gadget reporting never expires on the free version, but it only exposes the sensors **you tick**, and only their current value (no min / max / average).

1. Start **HWiNFO** in Sensors mode.
2. In the HWiNFO **sensor window**, right-click a value you want on the deck and tick **"Report value in Gadget"**.
3. Repeat for each sensor you want to show.

The plugin reads these from `HKCU\Software\HWiNFO64\VSB`. If you enable Gadget reporting but don't tick any sensors, keys show **Tick sensors / in Gadget** until you do.

You can enable **both** interfaces — with the data source left on **Auto**, the plugin uses Shared Memory while it's available and quietly falls back to Gadget when it isn't.

## Portable HWiNFO caveats

The portable build of HWiNFO works identically, but there is no installer to wire things up for you:

- **Only publishes while its window is open.** Close the portable HWiNFO and the data stops; the plugin will show **Not updating** and then **Start HWiNFO**.
- **Add it to autostart yourself.** There's no installer to register Auto Start, so if you want it running at login you must add the executable to your own startup (e.g. a Startup-folder shortcut or Task Scheduler).
- **Watch the folder and elevation.** Don't run portable HWiNFO from a folder that requires admin rights (e.g. `Program Files`) unless Stream Deck is also elevated. If HWiNFO runs elevated and Stream Deck doesn't (or vice-versa), Windows blocks the plugin from reading shared memory and keys show **Access denied / un-elevate**. Run both elevated, or both normal.

## Verify it works

1. Drag **HWiNFO Sensors → Sensor Reading** onto a key.
2. In the settings panel (property inspector), open the **Sensor** picker and choose a reading. The list groups readings by source (CPU, GPU, drives, …) and shows live values — type to filter.
3. The key should immediately show the live value.

If instead the key shows a status screen like **Start HWiNFO** or **Shared Memory off**, HWiNFO isn't publishing yet — recheck the setup above, or see [Troubleshooting](troubleshooting.md) for what each screen means and how to fix it.

## Next steps

- [Sensor Reading (keys)](sensor-reading.md) — every key setting: label, theme, stat mode, decimals, sparkline, thresholds.
- [Sensor Dial (Stream Deck +)](sensor-dial.md) — the dial and touchscreen action.
- [Data sources](data-sources.md) — Shared Memory vs. Gadget, and how auto-fallback works.
- [Themes](themes.md) — the seven presets, type accents, and alert colors.
