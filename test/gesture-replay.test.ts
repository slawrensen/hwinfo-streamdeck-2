// Replays every checked-in event trace (test/traces/*.json) through the
// production gesture machine + control schemes + rotation math and asserts
// the commands and final state per context. Synthetic today; the fixture
// format matches the recorder's output so a real hardware capture can
// replace any of these without changing this test.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { replayTrace, type TraceFixture } from "./replay";

const tracesDir = join(fileURLToPath(new URL(".", import.meta.url)), "traces");
const files = readdirSync(tracesDir).filter((f) => f.endsWith(".json")).sort();

describe("event trace replay", () => {
	assert.ok(files.length >= 11, `expected the full synthetic trace set, found ${files.length}`);

	for (const file of files) {
		const fixture = JSON.parse(readFileSync(join(tracesDir, file), "utf8")) as TraceFixture;
		it(`${file}: ${fixture.name}`, () => {
			const outcomes = replayTrace(fixture);
			for (const [context, expected] of Object.entries(fixture.expect)) {
				const outcome = outcomes.get(context);
				assert.notEqual(outcome, undefined, `no outcome for ${context}`);
				if (outcome === undefined) {
					continue;
				}
				if (expected.commands !== undefined) {
					assert.deepEqual(outcome.commands, expected.commands, `${context} commands`);
				}
				if (expected.selection !== undefined) {
					assert.equal(outcome.selection, expected.selection, `${context} selection`);
				}
				if (expected.statMode !== undefined) {
					assert.equal(outcome.statMode, expected.statMode, `${context} statMode`);
				}
				if (expected.paused !== undefined) {
					assert.equal(outcome.paused, expected.paused, `${context} paused`);
				}
				if (expected.pinned !== undefined) {
					assert.equal(outcome.pinned, expected.pinned, `${context} pinned`);
				}
			}
		});
	}
});
