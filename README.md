# HWiNFO Sensors for Stream Deck

Live [HWiNFO](https://www.hwinfo.com) sensor readings on your Elgato Stream Deck —
temperatures, clocks, fan speeds, usage, power and more. Keys show a value with
optional thresholds and a sparkline; on Stream Deck + the dials get a touchscreen
readout with rotate-to-switch.

> **Windows only.** HWiNFO is a Windows application; this plugin reads its
> shared-memory interface locally. No ads, no telemetry, MIT licensed.

<!-- TODO(phase 6): screenshots -->

## Requirements

- Windows 10 or later
- [Stream Deck software](https://www.elgato.com/downloads) 6.6+
- [HWiNFO](https://www.hwinfo.com/download/) running with **Shared Memory Support** enabled

## Quick start

1. Install the plugin (Marketplace, or double-click the `.streamDeckPlugin` file).
2. Start HWiNFO and open **Settings**:
   - enable **Shared Memory Support**
   - recommended: enable **Sensors-only** and **Minimize Sensors on Startup**, plus
     **Auto Start** so readings survive a reboot.
3. Drag **HWiNFO Sensors → Sensor Reading** onto a key, open the key's settings and
   pick a sensor in the searchable list.

_Sections below are completed in later milestones: configuration reference,
Stream Deck + dials, troubleshooting (12-hour shared-memory limit of the free
version, portable build quirks), and building from source._

## License

[MIT](LICENSE) — see [NOTICE.md](NOTICE.md) for credits (HWiNFO, the original
archived plugin by @shayne, and the libraries used).
