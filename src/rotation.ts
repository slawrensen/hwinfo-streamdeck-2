/**
 * Which readings a dial rotation (or autocycle) steps through, and where a
 * step lands. Pure and tiny (like the series ring) so the wrap and fallback
 * behavior is unit-testable without the Stream Deck runtime.
 */
import type { Reading, SensorSnapshot } from "./hwinfo/types";

/**
 * The list a dial moves through. A rotation set (readings ticked in the
 * settings panel) wins, in picked order, skipping entries the snapshot does
 * not currently publish. Without a set: every reading of the sensor that owns
 * the current pick, or the whole snapshot when nothing is picked yet (so the
 * first turn adopts a reading).
 */
export function rotationReadings(setKeys: readonly string[] | undefined, currentKey: string | undefined, snapshot: SensorSnapshot): readonly Reading[] {
	// Settings arrive as untyped JSON: a malformed rotationKeys (a string has
	// a truthy .length too) must degrade to "no set", never throw mid-tick.
	if (Array.isArray(setKeys) && setKeys.length > 0) {
		return setKeys.map((key) => snapshot.byKey.get(key)).filter((r): r is Reading => r !== undefined);
	}
	const current = currentKey !== undefined && currentKey !== "" ? snapshot.byKey.get(currentKey) : undefined;
	if (current !== undefined) {
		return snapshot.readings.filter((r) => r.sensorIndex === current.sensorIndex);
	}
	return snapshot.readings;
}

/**
 * Steps `ticks` from the current reading, wrapping at both ends; enters at the
 * first entry when the current reading is not in the list.
 */
export function stepReading(list: readonly Reading[], currentKey: string | undefined, ticks: number): Reading | undefined {
	if (list.length === 0) {
		return undefined;
	}
	const index = currentKey === undefined ? -1 : list.findIndex((r) => r.key === currentKey);
	if (index === -1) {
		return list[0];
	}
	return list[(((index + ticks) % list.length) + list.length) % list.length];
}

/**
 * Steps `ticks` whole sensor sources instead of readings: lands on the first
 * list entry of the previous/next sensor represented in the list, wrapping.
 * This is the coarse jump behind the elite preset's pressed rotation. With
 * one sensor in the list there is nowhere to jump and it returns undefined.
 */
export function stepSensorSource(list: readonly Reading[], currentKey: string | undefined, ticks: number): Reading | undefined {
	if (list.length === 0) {
		return undefined;
	}
	const sources: number[] = [];
	for (const reading of list) {
		if (!sources.includes(reading.sensorIndex)) {
			sources.push(reading.sensorIndex);
		}
	}
	const current = currentKey === undefined ? undefined : list.find((r) => r.key === currentKey);
	if (current === undefined) {
		return list[0];
	}
	if (sources.length < 2) {
		return undefined;
	}
	const index = sources.indexOf(current.sensorIndex);
	const target = sources[(((index + ticks) % sources.length) + sources.length) % sources.length];
	return list.find((r) => r.sensorIndex === target);
}

/**
 * Where an auto-cycle step should land, or undefined to hold this tick.
 *
 * Safety defaults: the cycle never rotates away from a member that is
 * currently critical (a manual turn is the acknowledgement that releases
 * it). With `interrupt`, the due step goes to an alerting member instead of
 * the next one in order; criticals are evaluated for every listed member,
 * visible or not, each time a step is due.
 */
export function autoCycleTarget(list: readonly Reading[], currentKey: string | undefined, criticalKeys: ReadonlySet<string>, interrupt: boolean): Reading | undefined {
	if (currentKey !== undefined && criticalKeys.has(currentKey)) {
		return undefined;
	}
	if (interrupt) {
		const alerting = list.find((r) => r.key !== currentKey && criticalKeys.has(r.key));
		if (alerting !== undefined) {
			return alerting;
		}
	}
	return stepReading(list, currentKey, 1);
}
