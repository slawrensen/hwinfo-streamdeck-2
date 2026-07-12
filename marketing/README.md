# Marketing assets

The Elgato Marketplace listing images for HWiNFO Sensors. Nothing here is a
mockup: the boards are drawn by the plugin's own renderers (`src/ui/`) from
live HWiNFO readings on the dev machine, and the one photograph is the plugin
running on real hardware, perspective-straightened and nothing staged. The
marketing is the product output. That is the point, and it is why these files
live in the open repo instead of a private drive.

| File | Use | Spec |
| --- | --- | --- |
| `app-icon-288.png` | Marketplace app icon | 288x288 |
| `thumbnail.png` | Listing thumbnail | 1920x960 |
| `shot-1-hero.png` | Gallery 1: full deck of live readings | 1920x960 |
| `shot-2-hardware.png` | Gallery 2: real Stream Deck + XL photograph board | 1920x960 |
| `shot-3-themes.png` | Gallery 3: all seven themes + alert states | 1920x960 |
| `shot-4-settings.png` | Gallery 4: the real settings panel | 1920x960 |
| `shot-5-dials.png` | Gallery 5: Stream Deck + dials | 1920x960 |
| `hwinfo-streamdeckxlplus.png` | Photo master: Photoshop grade of the iPhone ProRAW capture | source |
| `hwinfo-streamdeckxlplus-squared.png` | Photo master, perspective-rectified; the board's default source | source |

`scripts/validate-release-copy.mjs` checks every fixed-spec asset above exists
at the dimensions listed, so a missing or wrong-sized asset fails `npm run
release:validate`. The two photo masters are sources, not portal uploads, and
are not size-checked.

## Regenerate

Shots 1, 3, 5 and the thumbnail render straight from the renderers with live
HWiNFO running:

```bash
npx tsx scripts/marketplace-shots.mjs marketing
```

Shot 4 composites two real property-inspector screenshots, so it needs a
capture directory. Full pipeline:

```bash
npm run build
node scripts/pi-harness.mjs                 # keep running in its own terminal
node scripts/capture-pi.mjs <dir>           # captures: pi-settings, pi-picker,
                                            # pi-dial-rotation, pi-dial-groups,
                                            # pi-dial-presets, pi-dial-custom,
                                            # pi-control
npx tsx scripts/marketplace-shots.mjs marketing <dir>
```

Shot 4 uses `pi-settings.png` and `pi-picker.png`; the dial/control captures
feed the docs site (`docs/assets/img/`).

Shot 2 wraps the real-hardware photograph in the standard board chrome:

```bash
node scripts/shot2-hardware.mjs             # rebuilds from the squared master
node scripts/shot2-hardware.mjs <photo>     # or from any new export
```

The photo masters are `hwinfo-streamdeckxlplus.png` (Photoshop grade of the
iPhone 17 Pro Max ProRAW capture) and its perspective-rectified twin
`hwinfo-streamdeckxlplus-squared.png`.

The app icon is resized from the plugin's own marketplace icon:

```bash
npm run icons                               # renders imgs/plugin/marketplace(@2x).png
# then: sharp-resize marketplace@2x.png -> app-icon-288.png (288x288)
```

All copy baked into these images follows `docs/release/COPY_RULES.md` (no em
dashes, no "telemetry", claims that map to real behavior). The validator cannot
read text inside a PNG, so check rendered strings by eye after regenerating.
