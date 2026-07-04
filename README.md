# HWiNFO Sensors for Stream Deck

Live [HWiNFO](https://www.hwinfo.com) sensor readings on your Elgato Stream Deck —
temperatures, clocks, fan speeds, usage, power and more. Keys show a value with
optional warn/critical coloring and a sparkline; on Stream Deck + the dials get a
touchscreen readout with rotate-to-switch and session min/max.

> **Windows only.** HWiNFO is a Windows application; this plugin reads its
> shared-memory interface locally. No ads, no telemetry, MIT licensed.

A ground-up TypeScript rewrite on the official Elgato SDK, inspired by the
archived [shayne/hwinfo-streamdeck](https://github.com/shayne/hwinfo-streamdeck)
(no code shared — see [NOTICE.md](NOTICE.md)).

## Requirements

- Windows 10 or later, Stream Deck software **6.6+**
- [HWiNFO](https://www.hwinfo.com/download/) (installer or portable) with
  **Shared Memory Support** enabled

## Quick start

1. Install the plugin (double-click the `.streamDeckPlugin` file, or Marketplace
   once published).
2. Start HWiNFO → **Settings**:
   - ✅ **Shared Memory Support**
   - recommended: ✅ **Sensors-only**, ✅ **Auto Start**, ✅ **Minimize Sensors on Startup**
3. Drag **HWiNFO Sensors → Sensor Reading** onto a key and pick a sensor in the
   searchable list. The list groups readings by source (CPU, GPU, drives, …) and
   shows live values; type to filter.

## Sensor Reading (keys)

| Setting | What it does |
| --- | --- |
| **Sensor** | Searchable picker over every reading HWiNFO publishes, with a live preview. |
| **Label** | Custom key label; defaults to the sensor's (renamed) label. |
| **Show** | Current value, or HWiNFO's min / max / average since it started. |
| **Decimals** | Auto (magnitude-based, compacts 48 700 → `48.7k`) or fixed 0–3. |
| **Unit** | Show temperatures in °F instead of °C. |
| **Sparkline** | Draws recent history along the bottom of the key. |
| **Warn / Critical at** | Key turns amber / red at these values (in the displayed unit). |
| **Direction** | "Alert when below" flips the comparison — for fan RPM, free space, etc. |

**Pressing the key** cycles what's shown: current → MIN → MAX → AVG (badge in the
corner). The warn/critical colors always track the *live* value.

## Sensor Dial (Stream Deck +)

The touchscreen shows the label, live value, session ▼min/▲max and a range bar.

- **Rotate** — step through the readings of the same sensor source
- **Push** — reset the session min/max/avg
- **Touch** — cycle current / session-min / session-max / session-avg
- **Long touch** — back to the current value
- **Bar range** — fixed min/max for the bar, or automatic from the session range

## Key states you might see

| Key shows | Meaning / fix |
| --- | --- |
| **Start HWiNFO** | HWiNFO isn't running (or sharing is off). Start it with Shared Memory Support enabled. |
| **Shared Memory off** | HWiNFO reports sharing disabled — re-enable it in HWiNFO Settings. |
| **Not updating** | Values frozen: HWiNFO's Sensors window was closed, or the free version's **12-hour shared-memory timer** expired — toggle Shared Memory Support back on (HWiNFO Pro removes the limit). |
| **Access denied** | HWiNFO and Stream Deck run at different privilege levels — run both elevated or both normal. |
| **Pick a sensor** | No sensor selected yet — open the key's settings. |
| **Sensor missing** | The saved sensor isn't in HWiNFO's current output (hardware/driver change, or a renamed sensor profile) — pick it again. |

More notes:

- **Portable build**: works identically, but only while its window is open — add
  it to autostart yourself (no installer to do it for you), and don't run it
  from a folder that requires admin rights unless Stream Deck is elevated too.
- **Polling**: the plugin reads shared memory once per second by default
  (configurable 250 ms–5 s under *Advanced*), one reader regardless of how many
  keys are visible. HWiNFO itself updates on its own poll cycle (default 2 s).
- Sensor identity is stored as HWiNFO's stable `sensor-id : instance :
  reading-id`, so keys survive restarts and reordering — not as list positions.

## Building from source

```bash
npm ci              # Node 20+
npm run build       # bundles to com.lawrensen.hwinfo.sdPlugin/bin/plugin.js
npm run probe       # standalone smoke test: dumps live readings, no Stream Deck needed
npm run lint && npm run typecheck
npm run e2e         # drives the built plugin over a mock Stream Deck WebSocket
npm run pack        # emits release/com.lawrensen.hwinfo.streamDeckPlugin
```

Dev loop: `streamdeck dev` once, `streamdeck link com.lawrensen.hwinfo.sdPlugin`,
then `npm run watch` (rebuilds and restarts the plugin on save).

Native access uses [koffi](https://koffi.dev) (prebuilt FFI, no node-gyp) to call
`OpenFileMappingW`/`MapViewOfFile` on `Global\HWiNFO_SENS_SM2` under HWiNFO's
consistency mutex; strides and offsets are read from the live header, never
hardcoded, so newer HWiNFO layouts (e.g. the UTF-8 label extensions) decode
correctly.

## License

[MIT](LICENSE) — free software, no ads, no telemetry. Credits in
[NOTICE.md](NOTICE.md): HWiNFO (REALiX), the original plugin by
[@shayne](https://github.com/shayne/hwinfo-streamdeck), koffi, sdpi-components.
