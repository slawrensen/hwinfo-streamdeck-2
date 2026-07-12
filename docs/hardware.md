---
title: Hardware compatibility
nav_order: 9.5
---

What this plugin has actually been proven on, and how. I distinguish four levels of confidence and never blur them:

- **Physically verified**: ran on the real device in my hands, with a recorded result.
- **SDK simulated**: exercised end to end against a mock Stream Deck WebSocket that replays the device's exact registration and events. Strong evidence, not hardware.
- **Community verified**: a user ran the [test procedure](#hardware-test-procedure) on real hardware and reported back. None yet; reports welcome.
- **Compatible with limitations**: expected to work from the SDK contract, with the listed caveats, but unproven.

## Compatibility matrix

| Device | Keys | Dials | Status |
| --- | --- | --- | --- |
| Stream Deck + XL (9x4, 6 dials) | Yes | Yes | **Physically verified** 2026-07-09: 36 keys + 6 dials live, all themes, alerts, sparklines, touchscreen dials, 0.1 % CPU (see PERF.md). Elite/Custom preset gestures and rotation groups are newer than that session and are SDK simulated until the next hardware pass. |
| Stream Deck +, 15-key, MK.2 | Yes | Yes (+) | SDK simulated: the e2e suite registers a 15-key (type 0) and a + (type 7) and drives keys on the former; every dial event is driven on the + XL, whose dials share the + code path. The + 4x2/4-encoder shape is locked by capability fixtures. |
| Stream Deck XL, Mini, Neo | Yes | n/a | Compatible with limitations: XL, Mini and Neo grids are locked by capability fixtures (`test/devices.test.ts`), and the key rendering they share is device-independent and e2e-driven on a mock 5x3 deck. Neo's info bar and touch points are not used. |
| Stream Deck Mobile / Virtual | Yes | n/a | Compatible with limitations: grids are taken from what the app reports; grid changes while running need Stream Deck 7.0 (below that, reconnect refreshes them). |
| Pedal, Corsair G-Keys, SCUF controllers | HWiNFO Control only | n/a | Compatible with limitations: these have no display, so the sensor actions are pointless there, but the Control key action drives dials on other decks from them. Their device types are covered by capability fixtures only; the Control key path itself is e2e-driven from a mock 15-key deck (the command code never consults the key's device). |
| Stream Deck Studio, Galleon 100 SD | Untested | Not claimed | No support is claimed for either, and the reasons differ. Studio (32 keys 16x2, 2 dials): the Stream Deck app ships encoder strip backgrounds for the +, the + XL and the Galleon, but not the Studio, so its dials have no drawable strip and a Sensor Dial there would render nowhere. Galleon 100 SD (a gaming keyboard with a built-in 12-key 3x4 deck, a screen and 2 dials): its screen does take encoder backgrounds, but at 720x384, a different class from the 200x100 per-encoder faces this plugin draws, and it has no touch input; supporting it properly is a rendering task, not a compatibility row. Both take the unknown-device fallback (keys and input still handled, "Unknown device" in logs and reports). A [hardware report](#hardware-test-procedure) is the first step. |
| Unknown future devices | Fallback | Fallback | Nothing is claimed in advance: capabilities derive from the reported grid, input events are always handled, and rendering degrades to a no-op where there is no display. |

Stream Deck software floor is **6.9**. Features from newer apps are detected at runtime and degrade: dynamic gesture hints use a 6.4-era API, `deviceDidChange` (7.0) falls back to connect-time device info, Key Logic (7.0) simply appears when the app supports it. Basic monitoring depends on none of them.

![Six dial faces rendered by the plugin at the Stream Deck + XL's six-encoder strip geometry (one 200 by 100 segment per encoder): CPU temperature, GPU temperature, a pinned CPU fan, CPU power, CPU load, and a GPU hot spot at a forced critical value with a red bar, with drawn knob markers beneath.]({{ '/assets/img/plusxl-dials.png' | relative_url }})

And the same claim as a photograph, not a render: my Stream Deck + XL running the validation page, 36 keys and six dial readouts live from HWiNFO (iPhone photo, perspective straightened).

![Photograph of a Stream Deck + XL on a desk running HWiNFO Sensors: 36 keys showing live temperatures, clocks, usage and voltages with sparklines, amber warn and red critical demo keys, the touchstrip showing six per-dial readouts including pump RPM and CPU package power, and six metal knobs below.]({{ '/assets/img/plusxl-photo.jpg' | relative_url }})

## Page swipe

Sideways swipes on the touch strip are page navigation and belong to the Stream Deck app; there is no plugin swipe event to receive. The plugin's job is narrower and it does it: selection and labels always survive the swipe away and back (they are persisted settings), and session stats, pause and pin state survive for up to 30 minutes off screen.

## Hardware test procedure

To verify a device and have it listed as community verified:

1. Install the plugin and put at least one Sensor Dial (if the device has dials) and one Sensor Reading key on it.
2. Quit the Stream Deck app, then start it with the recorder armed so the plugin process inherits it: set the user environment variable `HWINFO_TRACE_EVENTS=1` and restart the app.
3. Perform, in order: two slow turns each way, one fast spin, a short press, a half-second press, press+turn, a tap, a long touch, a page swipe away and back.
4. Note what the dial did for each step (the [controls page](controls.md) says what it should do for your preset).
5. Collect `logs/trace-<pid>.jsonl` from the plugin folder (`%APPDATA%\Elgato\StreamDeck\Plugins\com.lawrensen.hwinfo.sdPlugin\logs`) and the "Copy support report" output from the settings panel.
6. Open a GitHub issue titled "Hardware report: <device>" with the notes, the trace and the report.

The trace is redacted at the source: device identifiers are hashed, and no sensor values, sensor names, computer names or file paths are recorded. It exists so a capture from your hardware can be replayed, event for event, through the same state machine the test suite uses (`test/traces/` holds the synthetic versions a real capture can replace).

## Event recorder and replay

For development: `HWINFO_TRACE_EVENTS=1` makes the plugin append one JSON line per input, lifecycle and render event to `logs/trace-<pid>.jsonl`. The field names match the fixtures in `test/traces/`, and `test/gesture-replay.test.ts` replays every fixture through the production gesture router, control schemes and rotation math. To turn a real capture into a regression test, trim the JSONL to the events of interest, wrap them in the fixture envelope (`name`, `contexts`, `events`, `expect`) and drop the file into `test/traces/`.

## Support report

Every settings panel has **Copy support report** under its advanced section. It builds a local JSON summary (plugin and app version, devices by model and hashed ID, data-source state, sample age, Sensor Dial and HWiNFO Control action state, recent input events) and copies it to the clipboard. Nothing is uploaded anywhere: the plugin makes no network requests, and its only connection is the local WebSocket to the Stream Deck app.
