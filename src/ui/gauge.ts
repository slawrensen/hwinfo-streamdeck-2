/**
 * The shared range model behind every bounded-value display: the key Bar and
 * Ring gauges and the dial's range bar all normalize through here, so
 * "where is this value in its range, and where do the alert zones sit" has
 * exactly one implementation. Geometry stays in the renderers.
 *
 * All inputs are display-unit values (°C→°F already applied by the caller,
 * which keeps value, bounds and thresholds in one domain). Magnitude
 * compaction never happens here: gauges and alerts work on real numbers.
 */
import { mixToward } from "./text-colors";

export type GaugeZoneLevel = "warn" | "crit";

/** A normalized [from..to] span of the track drawn in an alert color. */
export type GaugeZone = { from: number; to: number; level: GaugeZoneLevel };

export type GaugeInput = {
	/** Live current value; the fill follows it even while the text shows a stat. */
	value: number;
	/** Manual bounds (the dial's barMin/barMax): each side wins independently
	 * when finite, exactly like the dial always resolved them. */
	manualMin?: number;
	manualMax?: number;
	/** Values actually visited: session or HWiNFO min/max, series extremes. */
	evidence?: { min: number; max: number };
	/** Display unit; "%" fixes the automatic range to 0..100, and "" with
	 * 0..1 evidence fixes it to 0..1 (HWiNFO's yes/no readings). Omit to
	 * keep bounds purely evidence-based (the dial's established behavior). */
	unit?: string;
	warn?: number;
	crit?: number;
	alertBelow: boolean;
};

export type Gauge = {
	/** Fill fraction 0..1; 0.5 for a degenerate range (the dial's long-standing
	 * fallback), NaN when the live value itself is not finite. */
	fraction: number;
	/** Threshold zones inside the visible domain, warn before crit. */
	zones: GaugeZone[];
};

/** Headroom added when a threshold sits at (or past) the range edge, so its
 * zone renders as a visible band instead of a zero-width line. */
const EDGE_PAD = 0.06;

/**
 * Zones draw as SHADES of the warn/critical colors, blended toward the face
 * background: they are fixed landmarks, not state, and the full-strength
 * alert fill must stay visible on top of them. At full strength a critical
 * fill sitting inside its own critical zone disappeared entirely
 * (hardware-verified 2026-07-16 on a below-alerting PSU dial).
 */
export const ZONE_BG_BLEND = 0.45;

/** Resolves model zones onto renderer fills: the matching alert color,
 * stepped toward the face background so the live fill outranks it. */
export function drawnZones(zones: readonly GaugeZone[], alerts: Readonly<Record<GaugeZoneLevel, { readonly bg: string }>>, faceBg: string): Array<{ from: number; to: number; color: string }> {
	return zones.map((zone) => ({ from: zone.from, to: zone.to, color: mixToward(alerts[zone.level].bg, faceBg, ZONE_BG_BLEND) }));
}

function finiteOr(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/**
 * Resolves bounds and thresholds into a clamped fill fraction and zone spans.
 * Deterministic on every degenerate input: reversed/equal bounds, constant
 * evidence, non-finite values, thresholds in either order.
 */
export function computeGauge(input: GaugeInput): Gauge {
	const { value, alertBelow } = input;
	const warn = finiteOr(input.warn, NaN);
	const crit = finiteOr(input.crit, NaN);
	const manualMin = finiteOr(input.manualMin, NaN);
	const manualMax = finiteOr(input.manualMax, NaN);

	// Automatic bounds: fixed domains for percent and boolean readings, else
	// the values actually visited (evidence unioned with the live value).
	let evMin = Number.POSITIVE_INFINITY;
	let evMax = Number.NEGATIVE_INFINITY;
	if (input.evidence !== undefined && Number.isFinite(input.evidence.min) && Number.isFinite(input.evidence.max)) {
		evMin = Math.min(evMin, input.evidence.min);
		evMax = Math.max(evMax, input.evidence.max);
	}
	if (Number.isFinite(value)) {
		evMin = Math.min(evMin, value);
		evMax = Math.max(evMax, value);
	}
	let autoLo = evMin;
	let autoHi = evMax;
	if (input.unit === "%") {
		autoLo = Math.min(0, evMin === Number.POSITIVE_INFINITY ? 0 : evMin);
		autoHi = Math.max(100, evMax === Number.NEGATIVE_INFINITY ? 100 : evMax);
	} else if (input.unit === "" && evMin >= 0 && evMax <= 1) {
		autoLo = 0;
		autoHi = 1;
	}

	// Each manual side wins on its own; automatic sides expand to cover the
	// thresholds (with edge headroom) so no zone can fall outside the domain.
	let lo = Number.isFinite(manualMin) ? manualMin : autoLo;
	let hi = Number.isFinite(manualMax) ? manualMax : autoHi;
	const thrLo = Math.min(Number.isFinite(warn) ? warn : Number.POSITIVE_INFINITY, Number.isFinite(crit) ? crit : Number.POSITIVE_INFINITY);
	const thrHi = Math.max(Number.isFinite(warn) ? warn : Number.NEGATIVE_INFINITY, Number.isFinite(crit) ? crit : Number.NEGATIVE_INFINITY);
	if (!Number.isFinite(manualMin) && Number.isFinite(lo) && thrLo <= lo) {
		lo = thrLo;
	}
	if (!Number.isFinite(manualMax) && Number.isFinite(hi) && thrHi >= hi) {
		hi = thrHi;
	}
	const span = hi - lo;
	if (Number.isFinite(span) && span > 0) {
		if (!Number.isFinite(manualMin) && thrLo <= lo) {
			lo -= span * EDGE_PAD;
		}
		if (!Number.isFinite(manualMax) && thrHi >= hi) {
			hi += span * EDGE_PAD;
		}
	}

	if (!Number.isFinite(hi - lo) || hi - lo <= 0) {
		return { fraction: Number.isFinite(value) ? 0.5 : NaN, zones: [] };
	}
	const norm = (v: number): number => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
	const fraction = Number.isFinite(value) ? norm(value) : NaN;

	// Zones mirror alertLevel's semantics exactly: crit owns its side outright,
	// warn covers the remainder up to it. Reversed inputs (warn beyond crit)
	// leave the warn zone empty rather than inventing an inverted band.
	const zones: GaugeZone[] = [];
	const warnN = Number.isFinite(warn) ? norm(warn) : undefined;
	const critN = Number.isFinite(crit) ? norm(crit) : undefined;
	if (alertBelow) {
		const warnTo = warnN ?? NaN;
		const warnFrom = critN ?? 0;
		if (warnN !== undefined && warnTo > warnFrom) {
			zones.push({ from: warnFrom, to: warnTo, level: "warn" });
		}
		if (critN !== undefined && critN > 0) {
			zones.push({ from: 0, to: critN, level: "crit" });
		}
	} else {
		const warnFrom = warnN ?? NaN;
		const warnTo = critN ?? 1;
		if (warnN !== undefined && warnTo > warnFrom) {
			zones.push({ from: warnFrom, to: warnTo, level: "warn" });
		}
		if (critN !== undefined && critN < 1) {
			zones.push({ from: critN, to: 1, level: "crit" });
		}
	}
	return { fraction, zones };
}
