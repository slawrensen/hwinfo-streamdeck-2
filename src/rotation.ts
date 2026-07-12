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

/** One parsed rotation group: a display name ("" renders as "group N"), its
 *  reading keys in picked order, and the 1-based position among the raw
 *  object entries, so the numbered fallback matches the PI's row numbering
 *  even when the projection skips draft rows (empty or fully duplicated). */
export type RotationGroup = {
	readonly name: string;
	readonly keys: readonly string[];
	readonly ordinal: number;
};

/**
 * Salvage-parses the rotationGroups setting into the runtime projection.
 * Settings are untyped JSON: keep object entries whose keys salvage to at
 * least one usable string, trim names, and require two or more surviving
 * groups; anything less returns undefined and the flat set keeps driving.
 * Membership is deduplicated across the WHOLE projection, not just within
 * a group: the first group containing a key owns it and later occurrences
 * are dropped. The active group is derived from the current reading, so an
 * overlapping key would otherwise re-resolve its earlier group right after
 * a jump landed on it, making the target group impossible to stay in. The
 * raw setting is never mutated or written back; only explicit PI edits
 * normalize what the user sees.
 */
export function rotationGroupsOf(raw: unknown): readonly RotationGroup[] | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const groups: RotationGroup[] = [];
	const claimed = new Set<string>();
	let ordinal = 0;
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			continue;
		}
		ordinal++;
		const { name, keys } = entry as { name?: unknown; keys?: unknown };
		if (!Array.isArray(keys)) {
			continue;
		}
		const salvaged: string[] = [];
		for (const key of keys) {
			if (typeof key === "string" && key.trim() !== "" && !claimed.has(key)) {
				claimed.add(key);
				salvaged.push(key);
			}
		}
		if (salvaged.length === 0) {
			continue;
		}
		groups.push({ name: typeof name === "string" ? name.trim() : "", keys: salvaged, ordinal });
	}
	return groups.length >= 2 ? groups : undefined;
}

/** Lowest-index group containing the key; -1 with no owner (or no key). */
export function activeGroupIndex(groups: readonly RotationGroup[], currentKey: string | undefined): number {
	if (currentKey === undefined || currentKey === "") {
		return -1;
	}
	return groups.findIndex((g) => g.keys.includes(currentKey));
}

/** The group's display name for overlays and hints: as typed, or "group N".
 *  N is the group's ordinal among the raw rows, not its projection index,
 *  so the fallback matches the PI's "Group N" placeholders. */
export function groupDisplayName(groups: readonly RotationGroup[], index: number): string {
	const group = groups[index];
	if (group === undefined) {
		return `group ${index + 1}`;
	}
	return group.name !== "" ? group.name : `group ${group.ordinal}`;
}

/**
 * The list plain stepping moves through when groups apply: the active
 * group's members the snapshot publishes, in picked order. A current reading
 * outside every group enters at group 0, so rotation pulls a stray selection
 * into the groups instead of stranding it.
 */
export function groupReadings(groups: readonly RotationGroup[], currentKey: string | undefined, snapshot: SensorSnapshot): readonly Reading[] {
	const index = activeGroupIndex(groups, currentKey);
	const group = groups[index === -1 ? 0 : index];
	return group === undefined ? [] : group.keys.map((key) => snapshot.byKey.get(key)).filter((r): r is Reading => r !== undefined);
}

/**
 * Steps `ticks` whole groups: lands on the first snapshot-present member of
 * the target group, wrapping at both ends. The user-defined analog of
 * stepSensorSource, behind pressed rotation once groups exist. Groups whose
 * members the snapshot does not publish (sensor asleep, dropout) cannot be
 * landed in and are skipped; with fewer than two groups present there is
 * nowhere to jump and it returns undefined. A current reading outside every
 * present group enters at the first one.
 */
export function stepGroup(groups: readonly RotationGroup[], currentKey: string | undefined, ticks: number, snapshot: SensorSnapshot): Reading | undefined {
	const present: { index: number; first: Reading }[] = [];
	for (const [index, group] of groups.entries()) {
		const first = group.keys.map((key) => snapshot.byKey.get(key)).find((r): r is Reading => r !== undefined);
		if (first !== undefined) {
			present.push({ index, first });
		}
	}
	if (present.length === 0) {
		return undefined;
	}
	const position = present.findIndex((p) => p.index === activeGroupIndex(groups, currentKey));
	if (position === -1) {
		return present[0]?.first;
	}
	if (present.length < 2) {
		return undefined;
	}
	return present[(((position + ticks) % present.length) + present.length) % present.length]?.first;
}

/**
 * Steps `ticks` whole sensor sources instead of readings: lands on the first
 * list entry of the previous/next sensor represented in the list, wrapping.
 * This is the coarse jump behind the elite preset's pressed rotation while
 * no rotation groups are defined (stepGroup takes over once they are). With
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
 * Plain cycling ignores alerts entirely. With `alertAware` (the "On alert"
 * setting), the cycle never rotates away from a member that is currently
 * critical (a manual turn is the acknowledgement that releases it), and a
 * due step goes to an alerting member instead of the next one in order;
 * criticals are evaluated for every listed member, visible or not, each
 * time a step is due. The alert hunt runs over `alertList`, a superset of
 * `list`: with rotation groups the cycle steps inside the active group but
 * an alert anywhere in the set still interrupts, and landing on it makes
 * its group the active one. Ungrouped callers pass the same list twice.
 */
export function autoCycleTarget(list: readonly Reading[], alertList: readonly Reading[], currentKey: string | undefined, criticalKeys: ReadonlySet<string>, alertAware: boolean): Reading | undefined {
	if (alertAware) {
		if (currentKey !== undefined && criticalKeys.has(currentKey)) {
			return undefined;
		}
		const alerting = alertList.find((r) => r.key !== currentKey && criticalKeys.has(r.key));
		if (alerting !== undefined) {
			return alerting;
		}
	}
	return stepReading(list, currentKey, 1);
}
