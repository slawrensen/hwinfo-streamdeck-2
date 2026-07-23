// Status-screen copy: the recovery hint must match the source actually in use.
// Regression guard for v1.1.5 — the dial's stale text used to say "check
// sharing" for every source, wrongly pointing gadget-source dials at Shared
// Memory. statusScreen and statusSentence already branch on source; this locks
// statusDialText to the same behavior.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HwinfoUnavailableReason, SensorSnapshot } from "../src/hwinfo/types";
import type { PollerStatus } from "../src/poller";
import { keyLabel, statusDialText, statusScreen, statusSentence } from "../src/ui/state-screens";

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

describe("state-screens: every unavailable reason has its own guidance", () => {
	const unavailable = (reason: HwinfoUnavailableReason): PollerStatus => ({ state: "unavailable", reason, message: "" });
	const REASONS: readonly HwinfoUnavailableReason[] = ["unsupported-platform", "not-running", "gadget-empty", "access-denied", "disabled", "invalid", "bridge-failed"];

	it("key, dial and PI sentence cover all reasons", () => {
		for (const reason of REASONS) {
			const status = unavailable(reason);
			assert.equal(statusScreen(status)?.lines.length, 2, reason);
			assert.ok((statusDialText(status)?.title ?? "") !== "", reason);
			assert.ok(statusSentence(status).length > 20, reason);
		}
	});

	it("a bridge load failure says reinstall, never restart HWiNFO", () => {
		// An AV-quarantined or missing bin/hwsm.node cannot be fixed by
		// restarting HWiNFO; the screens must not borrow "invalid"'s advice.
		const status = unavailable("bridge-failed");
		assert.deepEqual(statusScreen(status)?.lines, ["Plugin damaged", "reinstall"]);
		assert.equal(statusDialText(status)?.value, "reinstall it");
		assert.match(statusSentence(status), /[Rr]einstall/);
		assert.match(statusSentence(status), /antivirus/);
		assert.doesNotMatch(statusSentence(status), /restart HWiNFO/);
	});
});

describe("keyLabel salvage", () => {
	it("uses a trimmed custom label, falls back on blank or non-string junk", () => {
		assert.equal(keyLabel(" CCD1 ", "fallback"), "CCD1");
		assert.equal(keyLabel("", "fallback"), "fallback");
		assert.equal(keyLabel("   ", "fallback"), "fallback");
		assert.equal(keyLabel(undefined, "fallback"), "fallback");
		// Settings are untyped JSON at runtime: junk shapes degrade, never throw.
		assert.equal(keyLabel(42, "fallback"), "fallback");
		assert.equal(keyLabel({ junk: true }, "fallback"), "fallback");
		assert.equal(keyLabel(null, "fallback"), "fallback");
	});
});
