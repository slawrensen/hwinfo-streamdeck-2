/**
 * The recent-value ring backing the key sparkline. Kept deliberately tiny and
 * pure so it can be unit-tested and owned by the poller (which outlives every
 * action's willAppear), rather than by per-key action state that is wiped on
 * every appear. Samples are stored in the reading's NATIVE unit — the key
 * renderer normalizes a sparkline over its own min/max, and °C→°F is a positive
 * affine map, so a unit conversion leaves the drawn shape pixel-identical.
 * Storing native therefore lets the series survive a °C/°F toggle unchanged.
 */

/** Samples retained per reading. Matches key-renderer's SPARK_SAMPLES. */
export const HISTORY_LENGTH = 36;

/** Appends one sample, dropping non-finite values and capping at HISTORY_LENGTH. */
export function pushSample(ring: number[], value: number): void {
	if (!Number.isFinite(value)) {
		return;
	}
	ring.push(value);
	if (ring.length > HISTORY_LENGTH) {
		ring.shift();
	}
}
