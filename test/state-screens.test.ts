// Status-screen copy: the recovery hint must match the source actually in use.
// Regression guard for v1.1.5 — the dial's stale text used to say "check
// sharing" for every source, wrongly pointing gadget-source dials at Shared
// Memory. statusScreen and statusSentence already branch on source; this locks
// statusDialText to the same behavior.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { statusDialText, statusScreen, statusSentence } from "../src/ui/state-screens";

const EMPTY_SNAPSHOT: SensorSnapshot = {
	pollTime: 1,
	version: 1,
	revision: 0,
	sensors: [],
	readings: [],
	byKey: new Map()
};

function stale(source: "shared-memory" | "gadget"): PollerStatus {
	return { state: "stale", snapshot: EMPTY_SNAPSHOT, source, staleForMs: 20_000 };
}

describe("state-screens: stale recovery hint follows the source", () => {
	it("dial stale on gadget points at Gadget, not Shared Memory", () => {
		const text = statusDialText(stale("gadget"));
		assert.equal(text?.title, "HWiNFO stalled");
		assert.equal(text?.value, "check Gadget");
		assert.doesNotMatch(text?.value ?? "", /sharing/i);
	});

	it("dial stale on shared memory still points at sharing", () => {
		const text = statusDialText(stale("shared-memory"));
		assert.equal(text?.value, "check sharing");
	});

	it("key stale screen branches on source", () => {
		assert.deepEqual(statusScreen(stale("gadget"))?.lines, ["Not updating", "check Gadget"]);
		assert.deepEqual(statusScreen(stale("shared-memory"))?.lines, ["Not updating", "check sharing"]);
	});

	it("PI sentence already branches on source", () => {
		assert.match(statusSentence(stale("gadget")), /Gadget/);
		assert.match(statusSentence(stale("shared-memory")), /Shared Memory/);
	});
});
