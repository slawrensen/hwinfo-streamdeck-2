// The recent-value ring backing the key sparkline. Pure and tiny so the
// poller can own it (surviving action appear/disappear churn) with confidence.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HISTORY_LENGTH, pushSample } from "../src/series";

describe("series ring (pushSample)", () => {
	it("caps at HISTORY_LENGTH, dropping the oldest (FIFO)", () => {
		const r: number[] = [];
		for (let i = 0; i < HISTORY_LENGTH + 10; i++) {
			pushSample(r, i);
		}
		assert.equal(r.length, HISTORY_LENGTH);
		assert.equal(r[0], 10);
		assert.equal(r[r.length - 1], HISTORY_LENGTH + 9);
	});

	it("drops non-finite values (NaN / ±Infinity) without disturbing the ring", () => {
		const r: number[] = [];
		pushSample(r, 1);
		pushSample(r, Number.NaN);
		pushSample(r, Number.POSITIVE_INFINITY);
		pushSample(r, Number.NEGATIVE_INFINITY);
		pushSample(r, 2);
		assert.deepEqual(r, [1, 2]);
	});
});
