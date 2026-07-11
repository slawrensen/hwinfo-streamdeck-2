/**
 * Per-reading session statistics for a dial. Keyed by the stable reading
 * identity (sensor-id:instance:reading-id), never a list position, so
 * rotating away and back restores that member's own numbers and no reading
 * can ever inherit another's min/max.
 *
 * Bounding is by relevance, not insertion age: prune() keeps every reading
 * the dial actively samples (its rotation set + selection, any size) plus a
 * slack of stray sessions from past reselections. An insert-time cap would
 * thrash the moment the sampled set outgrew it, silently resetting every
 * session each tick.
 */
export type SessionStats = {
	min: number;
	max: number;
	sum: number;
	count: number;
};

export class SessionStatsStore {
	private readonly byKey = new Map<string, SessionStats>();

	/** Folds one native-unit sample into the reading's session. */
	sample(key: string, value: number): void {
		if (!Number.isFinite(value)) {
			return;
		}
		const stats = this.byKey.get(key);
		if (stats === undefined) {
			this.byKey.set(key, { min: value, max: value, sum: value, count: 1 });
			return;
		}
		stats.min = Math.min(stats.min, value);
		stats.max = Math.max(stats.max, value);
		stats.sum += value;
		stats.count++;
	}

	/**
	 * Drops sessions for readings outside `keep`, oldest first, until at most
	 * `keep.size + slack` remain. Sessions for kept readings are never touched,
	 * whatever the size of the set.
	 */
	prune(keep: ReadonlySet<string>, slack: number): void {
		const limit = keep.size + slack;
		if (this.byKey.size <= limit) {
			return;
		}
		for (const key of this.byKey.keys()) {
			if (this.byKey.size <= limit) {
				break;
			}
			if (!keep.has(key)) {
				this.byKey.delete(key);
			}
		}
	}

	get(key: string): SessionStats | undefined {
		return this.byKey.get(key);
	}

	/**
	 * Resets the given readings (or everything when omitted). A reset entry
	 * is deleted outright; the next sample reseeds it from the live value,
	 * which is exactly the "back to current" reset the dial always had.
	 */
	reset(keys?: readonly string[]): void {
		if (keys === undefined) {
			this.byKey.clear();
			return;
		}
		for (const key of keys) {
			this.byKey.delete(key);
		}
	}

	get size(): number {
		return this.byKey.size;
	}
}
