---
title: Getting started
nav_order: 3
---

This page gets one live sensor onto a Stream Deck key in about a minute, then points you at everything else.

> **Before you start.** This is a Windows-only plugin that reads a running copy of [HWiNFO](https://www.hwinfo.com/download/). You need Windows 10 or later, Stream Deck software **6.6+**, and HWiNFO publishing data on either **Shared Memory Support** (preferred) or **Gadget reporting**. If HWiNFO isn't running yet, do that first — see [Install & requirements](installation.md).

## 1. Install the plugin

Double-click the `.streamDeckPlugin` file (or install from the Marketplace once published). Stream Deck restarts and adds an **HWiNFO Sensors** category to the actions list on the right.

## 2. Drag "Sensor Reading" onto a key

In the actions list, open **HWiNFO Sensors** and drag **Sensor Reading** onto any empty key.

The key immediately shows a blue **"Pick a sensor / in settings"** screen — that's the plugin working, just waiting for you to choose what to display. The settings panel (the property inspector) opens below the canvas at the same time.

> **First run?** The settings panel starts with a collapsible **"First time? HWiNFO setup"** tip that walks through the three HWiNFO steps: install and start HWiNFO in Sensors mode, enable **Shared Memory Support** (or, on the free version, right-click sensors and tick **"Report value in Gadget"** — no 12-hour limit), then pick a sensor. Expand it if you haven't set HWiNFO up yet.

## 3. Pick a sensor

Click the **Sensor** search box to open the picker. It lists every reading HWiNFO is currently publishing:

- **Grouped by source** — CPU, GPU, drives, motherboard and so on, under headings that match HWiNFO's own sensor names.
- **Live values** — each row shows the reading's current value, unit, and type (Temp, Fan, Power…), refreshed as you look.
- **Type to filter** — search is multi-token: `cpu die` matches a row only if it contains *both* words, in any order, across the group name and the label. So `gpu hot` narrows straight to the GPU hotspot temperature.
- **⟳ refresh** — reload the list if you just enabled a sensor in HWiNFO and want it to appear.

![The Sensor picker open with a query like "cpu" typed, showing grouped results (CPU / GPU h]({{ '/assets/img/sensor-picker.png' | relative_url }})

Click a row to select it. The **Live value** line just under the picker previews the chosen reading (current value plus min / max / avg), and the key on your deck switches from the blue prompt to the live number straight away.

That's the whole loop: drag, pick, done. The key now updates roughly once a second (see [Polling & performance](data-sources.md) to change the rate). Your choice is stored by HWiNFO's stable sensor identity, not by list position, so the key survives restarts and hardware reordering.

## Where to go next

Everything below is optional — the defaults already give you a clean live reading.

- **[Sensor Reading (keys)](sensor-reading.md)** — every key setting: custom **Label**, **Show** (current / min / max / average), **Decimals**, **°F**, **Sparkline**, and press-to-cycle stat modes.
- **[Sensor Dial (Stream Deck +)](sensor-dial.md)** — the dial/touchscreen action, with rotate-to-switch, push-to-reset, and a session range bar.
- **[Themes](themes.md)** — the seven presets (Void, Graphite, Ultraviolet, Midnight, Forest, Ember, Paper), per-key vs. deck-wide, and type accents.
- **[Thresholds & alerts](thresholds-alerts.md)** — **Warn at** / **Critical at** and the **Direction** flip for fan RPM, free space, and other alert-when-low readings.
- **[Data sources](data-sources.md)** — Shared Memory vs. Gadget registry, what each gives you, and the automatic fallback.
- **[Status screens](status-screens.md)** — what "Start HWiNFO", "Shared Memory is off", "Not updating", "Access denied", and "Sensor missing" mean and how to fix each.
