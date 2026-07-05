# Notices and credits

This plugin is free software (MIT licensed) with **no ads and no telemetry**.

- **HWiNFO** is a product of Martin Malík / REALiX, s.r.o. (<https://www.hwinfo.com>).
  This plugin is an independent project and is not affiliated with or endorsed by REALiX.
  It reads HWiNFO's *Shared Memory Support* interface and its Gadget-registry
  reporting, features HWiNFO itself provides for third-party integrations.
- The **shared-memory struct definitions** in `src/hwinfo/` were written for this project
  from the publicly documented field layout of the HWiNFO shared-memory interface
  (header magic, section offsets/sizes taken from the live header at runtime). No
  third-party source code was copied.
- UX inspiration: **shayne/hwinfo-streamdeck** (archived Oct 2024), the original
  Go-based HWiNFO Stream Deck plugin, <https://github.com/shayne/hwinfo-streamdeck>.
  This project is a ground-up rewrite on the official Elgato SDK and shares no code with it.
- Built with the official **Elgato Stream Deck SDK** (`@elgato/streamdeck`),
  **koffi** (FFI, MIT, <https://koffi.dev>; the vendored `@koromix/koffi-win32-x64`
  native binary is part of the same MIT-licensed project) and
  **sdpi-components** (MIT, Elgato, <https://sdpi-components.dev>; vendored as
  `ui/sdpi-components.js` from the official distribution).
