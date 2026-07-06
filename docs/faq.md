---
title: FAQ
nav_order: 10
---

Straight answers to the questions people file issues about. If your question isn't here, check [Data sources](data-sources.md), [Themes](themes.md), or [Troubleshooting](troubleshooting.md).

## Platform and requirements

### Does it work on macOS or Linux?

No. **Windows only**, and that isn't going to change. The plugin reads HWiNFO's data locally, and HWiNFO is a Windows-only application. There is no HWiNFO build for macOS or Linux for the plugin to read from, and the interfaces it uses (a named shared-memory section, the `HKCU\Software\HWiNFO64\VSB` registry key) are Windows constructs. On a Mac the action would have nothing to read.

You also need **64-bit (x64) Windows**. On Windows-on-ARM the key shows a `Needs x64 / Windows` screen: HWiNFO's interfaces aren't readable there.

### What are the exact requirements?

- Windows 10 or later, x64
- Stream Deck software **6.9+**
- [HWiNFO](https://www.hwinfo.com/download/) (installer or portable) running, publishing on **Shared Memory Support** or **Gadget reporting**

Stream Deck + dials are optional: they add the [Sensor Dial](sensor-dial.md) action, but the key action works on any Stream Deck.

### Is this the official HWiNFO plugin? Is it affiliated with REALiX?

No. It's an independent, MIT-licensed project, not affiliated with or endorsed by REALiX/HWiNFO. It's a ground-up TypeScript rewrite inspired by the archived `shayne/hwinfo-streamdeck` (no code shared).

## HWiNFO editions and the 12-hour limit

### Do I need HWiNFO Pro?

**No.** The free version works. The only difference that affects this plugin:

- **HWiNFO free**: Shared Memory Support auto-disables after **12 hours** of runtime. After that, in the default **Auto** mode the plugin falls back to the Gadget registry by itself (Gadget reporting has no time limit) and upgrades back to Shared Memory automatically if you re-enable it.
- **HWiNFO Pro**: no 12-hour limit; Shared Memory stays on permanently, so you keep min/max/avg and full sensor coverage indefinitely without touching anything.

If you never leave HWiNFO running longer than ~12 hours between restarts, free + Shared Memory is fully equivalent. If you run HWiNFO 24/7 and want min/max/avg to stay available, either buy Pro or enable **Gadget reporting** for the sensors you care about (see below).

### Why did my values freeze / stop updating after about 12 hours?

That's the free version's Shared Memory timer expiring. HWiNFO stops publishing to shared memory after 12 hours of runtime and marks the mapping disabled. What you see depends on your data source:

- **Auto mode** (default): the plugin detects the dead mapping and falls back to the **Gadget registry**, *if* you've enabled Gadget reporting for those sensors. If you haven't, keys show `Shared Memory / is off`.
- **Shared Memory only mode**: no fallback; keys show `Shared Memory / is off` until you re-enable Shared Memory Support in HWiNFO (Settings → Shared Memory Support) or restart HWiNFO.

Fixes, cheapest first:

1. In HWiNFO **Settings → Shared Memory Support**, toggle it back on (resets the 12-hour clock).
2. Enable **Gadget reporting** on the sensors you use, so Auto mode has something to fall back to permanently.
3. Buy HWiNFO Pro to remove the limit entirely.

> **Note:** The plugin considers data "stale" when HWiNFO's poll timestamp hasn't advanced for **15 seconds**, then shows the `Not updating` screen. So a frozen value shows up as a status screen within seconds, not as silently wrong numbers.

## Data sources

### Which data source should I use?

Leave it on **Auto** (the default) unless you have a specific reason not to. Auto uses Shared Memory whenever it's available (full data), and silently falls back to the Gadget registry when it isn't (e.g. after the free 12-hour timeout), then upgrades back when Shared Memory returns.

| | Shared Memory (preferred) | Gadget registry (fallback) |
| --- | --- | --- |
| Sensor coverage | everything HWiNFO measures (~500+) | only sensors you tick in HWiNFO |
| Min / max / average | yes (from HWiNFO) | no (current value only) |
| Free-version limit | disables after 12 h | none |
| Enable in HWiNFO | Settings → Shared Memory Support | right-click a sensor → *Report value in Gadget* |

Set it under **Advanced → Data source** in any key's settings, or under **Dial gestures & advanced → Data source** on a dial (`Auto`, `Shared Memory only`, `Gadget registry only`). It's a global setting: it applies to every key and dial.

See [Data sources](data-sources.md) for the full breakdown.

### Why are min / max / avg showing the current value?

Because you're reading from the **Gadget registry**, which only exposes the current value; HWiNFO doesn't write min/max/avg to the Gadget registry at all. The plugin fills those in with the current value, so a MIN/MAX/AVG stat mode on a key just repeats the live number.

This happens when Shared Memory isn't available, most commonly after the free version's 12-hour timeout in Auto mode, or if you've forced `Gadget registry only`. When it's active, the settings panel shows a note. To get real min/max/avg back, re-enable Shared Memory Support in HWiNFO (or use Pro).

> **Note:** On a **dial**, min/max/avg always work regardless of source: the dial tracks its own **session** stats in the plugin (see next question), so it never depends on HWiNFO's fields.

### What's the difference between the key's min/max/avg and the dial's?

They're two different things:

- **Key** (Sensor Reading): the `Show` setting and the key-press cycle display **HWiNFO's own** min/max/avg, measured since HWiNFO started (or since you last reset them *inside HWiNFO*). These come from the shared-memory data, so they're empty (equal to current) on the Gadget source.
- **Dial** (Sensor Dial): min/max/avg are a **session** the plugin accumulates itself while the dial is visible. They reset when you push the dial, change its reading, or it reappears. This works on any data source.

## Sparklines

### Why do my sparklines look different / fill in slowly after switching pages?

As of **1.1.6**, sparkline history lives with the poller and persists across page changes, wake, and app reconnects; switching away and back keeps the line drawn. But there are two things worth knowing:

1. **A graph on a page you haven't viewed in a while rebuilds from empty.** History is kept for a grace window after a key leaves the screen; past that, an unseen key's ring is dropped, so when you return it starts filling again.
2. **It fills at HWiNFO's own update rate, not the plugin's poll rate.** The sparkline only gains a new point when HWiNFO produces a genuinely fresh reading; a frozen source never pushes duplicate points (that would flatten the line). HWiNFO's default sensor polling period is 2 seconds, and the sparkline holds 36 samples, so a full graph takes ~72 seconds to build from scratch. To fill faster, lower HWiNFO's polling period in **HWiNFO → Settings → Polling period**.

Two more sparkline behaviors:

- Toggling **°C/°F** no longer resets the graph: it stores native values and just relabels.
- A **frozen** HWiNFO holds the line's last real shape instead of flattening it.

Changing the plugin's **Poll every** interval (Advanced) *does* clear the ring: the history is index-spaced, not time-stamped, so it can't honestly span a cadence change.

## Performance and resource use

### Does it slow down my PC? How much CPU and RAM?

Effectively no. Measured on a live 12-key page at a 1-second poll (see [PERF.md](https://github.com/slawrensen/hwinfo-streamdeck/blob/main/PERF.md) in the repo):

- **CPU: ~0.07 %** average (about 0.08 % with keys visible; **0.00 %** when its keys aren't on screen).
- **RAM: ~37–40 MB** RSS, stable over a 35-minute soak (the slope was slightly *negative*).

The parse path is incremental: one poll tick to decode ~516 readings costs about **6 µs** with near-zero allocation. Most of that 37 MB is the Node runtime and the native FFI module, not the plugin's own data.

### Does it get slower or use more CPU if I add more keys?

No. There is **one** reader regardless of how many keys and dials are visible: it opens a single data source, reads once per poll tick, and fans the result out to every key. Adding keys costs only the tiny per-key render. A load test with one key for **every** live reading (518) plus 8 dials at a 250 ms poll stayed stable.

And when none of the plugin's keys are on screen (you switched to another page/profile), the poller **stops entirely** (zero CPU, flat RAM) and restarts when a key reappears.

### How many sensors / keys can I use?

There's no practical limit you'll hit. HWiNFO typically exposes 500+ readings; the picker lists all of them. You can place as many keys and dials as your Stream Deck hardware has, all reading from the same single poller. The load test above ran 518 key contexts + 8 dials without trouble.

### Can multiple keys show the same sensor?

Yes. Put the same sensor on as many keys as you like; each can have its own label, theme, decimals, unit, stat mode, sparkline and thresholds. They all read from the shared poller, so extra copies cost nothing meaningful.

## Alerts, thresholds and colors

### Why is a key amber or red?

It's crossed a threshold you set. In the key's settings:

- **Warn at** → the whole key flips to an **amber** field with black text.
- **Critical at** → a **red** field with white text.

Alerts always track the **live** value (not the displayed stat: a key showing MAX still colors by the current reading). By default higher is worse; tick **Direction → Alert when value drops below thresholds** to flip the comparison (for fan RPM, free disk space, etc.).

On a **dial**, the alert colors the range-bar fill instead of the whole face; the touchscreen slot is too small for a full field flip.

If a key is amber/red and you didn't mean to set a threshold, clear the **Warn at** / **Critical at** fields. The two alert palettes are global and never themed, so warn and crit stay unmistakable on any theme and with any color-vision deficiency.

### How do I reset a dial's session min/max?

**Push** the dial (press it in). That resets its session min/max/avg to the current value. The session also resets when you rotate to a different reading or the dial reappears. There's no reset for the *key's* stats; those are HWiNFO's own, reset inside HWiNFO.

## Themes

### Why isn't "Deck default" the same as Void?

"Deck default" isn't a theme; it's a **link**. It means "this key follows whatever the deck-wide theme is set to," which you set under **Advanced → Deck theme**. It happens to *resolve* to Void on a fresh install because Void is the default deck theme, but they're not the same choice:

- Pick the **Void** chip → this key is pinned to Void forever, even if you later change the deck theme.
- Pick the **Deck default** chip → this key changes whenever you change the deck-wide theme.

In the gallery the Deck default chip is drawn with a dashed border and a small link badge so it's structurally distinct from the preset it currently resolves to (its label reads e.g. *Deck default · Void*).

Also note: **existing installs that predate the theme system stay on Graphite** after updating, not Void, so the deck default you inherit may be Graphite, not the fresh-install Void. That's deliberate, so an update never changes how your deck already looks. See [Themes](themes.md).

### A per-key theme won't follow my deck theme: why?

Because a per-key pick always wins. The **Deck theme** (Advanced) only affects keys set to **Deck default**. If a key has its own theme selected, changing the deck theme won't touch it; pick the **Deck default** chip on that key to make it follow again.

## Privacy

### Is my data sent anywhere? Any telemetry?

**No.** No ads, no telemetry, no network calls. The plugin reads HWiNFO's shared memory / registry **locally** and renders to your Stream Deck. Nothing about your hardware, sensors or usage leaves your machine. It's [MIT-licensed](https://github.com/slawrensen/hwinfo-streamdeck/blob/main/LICENSE); the source is auditable.

## Setup and portability

### Can I use the free / portable HWiNFO?

Yes to both. The **free** version works (with the 12-hour Shared Memory caveat above). The **portable** build also works identically, but only while its window is open. The portable build has no installer to add it to autostart, so:

- Add HWiNFO to Windows autostart yourself if you want the deck populated at login.
- Don't run portable HWiNFO from a folder that needs admin rights unless Stream Deck is also elevated (see the elevation question below).

### Do keys survive reboots, HWiNFO restarts, or reordering sensors in HWiNFO?

Yes. A key stores HWiNFO's **stable identity** for the reading (`sensor-id : instance : reading-id`), not a position in a list. So keys keep working across restarts and if you reorder sensors in HWiNFO. If a saved sensor genuinely disappears (hardware/driver change, or you renamed a sensor profile), the key shows `Sensor missing / pick again`: reopen its settings and pick it again.

### Can I use Stream Deck + dials without HWiNFO Pro?

Yes. Dials have the same requirements as keys: free HWiNFO with Shared Memory or Gadget reporting is enough. The dial's session min/max/avg are computed in the plugin, so they work on any data source, Pro or not.

### A key says "Access denied": what's wrong?

HWiNFO and Stream Deck are running at **different privilege levels**. Windows blocks reading the shared memory across that boundary. Fix it by running **both elevated or both normal**; most people just restart HWiNFO *without* "Run as administrator." (On the free version, Gadget reporting also works across privilege levels.) See [Troubleshooting](troubleshooting.md) for the full status-screen list.

### What do the two-line screens on my keys mean?

They're status screens telling you exactly what to fix. As of 1.1.6 they're pure-black, two lines of soft-white text:

| Key shows | Meaning / fix |
| --- | --- |
| `Start HWiNFO / not detected` | HWiNFO isn't publishing on either interface. Start it with Shared Memory or Gadget reporting on. |
| `Shared Memory / is off` | HWiNFO reports sharing disabled (including after the free version's 12-hour timer): re-enable it (or use Gadget; Auto falls back by itself). |
| `Not updating / check sharing` | Values frozen for 15 seconds (e.g. the Sensors window is closed). `check Gadget` instead when reading from Gadget. |
| `Access denied / un-elevate` | Privilege mismatch: run HWiNFO and Stream Deck at the same level. |
| `Tick sensors / in Gadget` | Gadget reporting is on but no sensors are ticked; tick some in HWiNFO. |
| `Pick a sensor / in settings` | No sensor selected yet: open the key's settings. |
| `Sensor missing / pick again` | The saved sensor isn't in HWiNFO's current output; pick it again. |
| `Needs x64 / Windows` | Not a 64-bit Windows machine (Windows-on-ARM / other); unsupported. |

![The plugin's status screens rendered as clean OLED-black key faces, each with a two-line message: Start HWiNFO, Shared Memory off, Access denied, Tick sensors in Gadget, Not updating, Pick a sensor, and Sensor missing.]({{ '/assets/img/status-screens.png' | relative_url }})
