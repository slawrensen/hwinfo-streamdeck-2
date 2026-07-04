/**
 * Renders the 200×100 Stream Deck + touchscreen slot as a raw SVG string
 * (sent through `setFeedback` into a full-canvas pixmap layout item — layout
 * text items cannot mix font sizes on one line, which the spec's inline unit
 * requires).
 *
 * Spec geometry: title 18/600 x12 y24 · value 34/700 x12 y58 with inline
 * unit 17/600 · stats 12/600 x12 y78 · bar x12 y84 176×6 r3.
 */
import { truncateLabel } from "./format";
import { escapeXml } from "./key-renderer";
import type { Palette } from "./themes";

const FONT = "Segoe UI, Arial, sans-serif";

const BAR = { x: 12, y: 84, w: 176, h: 6, r: 3 } as const;
/** 18 px/600 runs ~10 px per glyph; 17 chars keeps clear of the right edge. */
const TITLE_MAX = 17;

export interface DialRenderOptions {
	title: string;
	valueText: string;
	/** Rendered inline after the value; empty to omit. */
	unitText: string;
	/** Single stats line under the value; empty to omit. */
	statsText: string;
	/** Bar fill fraction 0–1; NaN hides the fill. */
	fraction: number;
	/** Theme tokens — dials stay themed even while alerting. */
	palette: Palette;
	/** Bar fill: accent (or type accent) normally, the alert bg when alerting. */
	barColor: string;
}

export function renderDial(opts: DialRenderOptions): string {
	const { palette, barColor } = opts;
	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">`,
		`<rect width="200" height="100" fill="${palette.bg}"/>`,
		`<text x="12" y="24" text-anchor="start" font-family="${FONT}" font-size="18" font-weight="600" fill="${palette.label}">${escapeXml(truncateLabel(opts.title, TITLE_MAX))}</text>`
	];
	const unit = opts.unitText !== "" ? `<tspan dx="6" font-size="17" font-weight="600" fill="${palette.unit}">${escapeXml(opts.unitText)}</tspan>` : "";
	parts.push(`<text x="12" y="58" text-anchor="start" font-family="${FONT}" font-size="34" font-weight="700" fill="${palette.value}">${escapeXml(opts.valueText)}${unit}</text>`);
	if (opts.statsText !== "") {
		parts.push(`<text x="12" y="78" text-anchor="start" font-family="${FONT}" font-size="12" font-weight="600" fill="${palette.unit}">${escapeXml(opts.statsText)}</text>`);
	}
	parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="${BAR.r}" fill="${palette.track}"/>`);
	if (Number.isFinite(opts.fraction) && opts.fraction > 0) {
		const w = Math.max(BAR.h, Math.min(1, opts.fraction) * BAR.w);
		parts.push(`<rect x="${BAR.x}" y="${BAR.y}" width="${w.toFixed(1)}" height="${BAR.h}" rx="${BAR.r}" fill="${barColor}"/>`);
	}
	parts.push("</svg>");
	return parts.join("");
}
