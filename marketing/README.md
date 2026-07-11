# Marketing assets

The Elgato Marketplace listing images for HWiNFO Sensors. Nothing here is a
mockup: every key face, dial, sparkline and value is drawn by the plugin's own
renderers (`src/ui/`) from live HWiNFO readings on the dev machine. The
marketing is the product output. That is the point, and it is why these files
live in the open repo instead of a private drive.

| File | Use | Spec |
| --- | --- | --- |
| `app-icon-288.png` | Marketplace app icon | 288x288 |
| `thumbnail.png` | Listing thumbnail | 1920x960 |
| `shot-1-hero.png` | Gallery: full deck of live readings | 1920x960 |
| `shot-2-themes.png` | Gallery: all seven themes + alert states | 1920x960 |
| `shot-3-settings.png` | Gallery: the real settings panel | 1920x960 |
| `shot-4-dials.png` | Gallery: Stream Deck + dials | 1920x960 |

`scripts/validate-release-copy.mjs` checks every file above exists at the
dimensions listed, so a missing or wrong-sized asset fails `npm run
release:validate`.

## Regenerate

Shots 1, 2, 4 and the thumbnail render straight from the renderers with live
HWiNFO running:

```bash
npx tsx scripts/marketplace-shots.mjs marketing
```

Shot 3 composites two real property-inspector screenshots, so it needs a
capture directory. Full pipeline:

```bash
npm run build
node scripts/pi-harness.mjs                 # keep running in its own terminal
node scripts/capture-pi.mjs <dir>           # six captures: pi-settings, pi-picker,
                                            # pi-dial-rotation, pi-dial-presets,
                                            # pi-dial-custom, pi-control
npx tsx scripts/marketplace-shots.mjs marketing <dir>
```

Shot 3 uses `pi-settings.png` and `pi-picker.png`; the four dial/control
captures feed the docs site (`docs/assets/img/`).

The app icon is resized from the plugin's own marketplace icon:

```bash
npm run icons                               # renders imgs/plugin/marketplace(@2x).png
# then: sharp-resize marketplace@2x.png -> app-icon-288.png (288x288)
```

All copy baked into these images follows `docs/release/COPY_RULES.md` (no em
dashes, no "telemetry", claims that map to real behavior). The validator cannot
read text inside a PNG, so check rendered strings by eye after regenerating.
