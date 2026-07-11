// Support-report redaction rules. The report may name models and hashed
// identifiers; it must never carry raw device IDs, device names, or sensor
// values. These tests lock that contract.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSupportReport, registerDiagnostics } from "../src/diagnostics";
import { deviceCapabilities } from "../src/devices";
import { describeGestureState, hashId, recentEvents, trace } from "../src/recorder";

const BASE = { pluginVersion: "1.1.10.0", appVersion: "7.4.2.22730", platformVersion: "10.0.19044" };

describe("hashId", () => {
	it("is deterministic, short, and never the raw id", () => {
		const raw = "A1B2C3D4E5F60708090A0B0C0D0E0F10";
		const hash = hashId(raw);
		assert.match(hash, /^[0-9a-f]{12}$/);
		assert.equal(hash, hashId(raw));
		assert.notEqual(hashId("other"), hash);
		assert.ok(!raw.includes(hash) && !hash.includes(raw.slice(0, 8).toLowerCase()));
	});

	it("erases the user text embedded in gadget reading keys and link IDs", () => {
		// Gadget-source keys are g:<sensor name>:<reading label>, both
		// user-renamable in HWiNFO; they must never appear raw in a trace.
		const gadgetKey = "g:AMD Ryzen 9 5950X:CPU - office rig";
		const hash = hashId(gadgetKey);
		assert.match(hash, /^[0-9a-f]{12}$/);
		assert.ok(!hash.includes("Ryzen") && !hash.includes("office"));
	});
});

describe("buildSupportReport", () => {
	it("lists devices by model and hashed id only", () => {
		const rawId = "RAWDEVICEID001";
		deviceCapabilities.ingest(rawId, { type: 13, columns: 9, rows: 4 });
		const report = buildSupportReport(BASE);
		assert.ok(!report.includes(rawId), "raw device id leaked");
		assert.ok(report.includes(hashId(rawId)));
		assert.ok(report.includes("Stream Deck + XL"));
		assert.ok(report.includes("9x4"));
	});

	it("is valid JSON and carries the version/app basics", () => {
		const parsed = JSON.parse(buildSupportReport(BASE)) as Record<string, unknown>;
		assert.equal(parsed.plugin, BASE.pluginVersion);
		assert.equal(parsed.streamDeckApp, BASE.appVersion);
		assert.ok(Array.isArray(parsed.devices));
		assert.ok(Array.isArray(parsed.recentEvents));
	});

	it("includes registered sections and survives a throwing provider", () => {
		registerDiagnostics("healthy", () => ({ answer: 42 }));
		registerDiagnostics("broken", () => {
			throw new Error("boom");
		});
		const parsed = JSON.parse(buildSupportReport(BASE)) as Record<string, unknown>;
		assert.deepEqual(parsed.healthy, { answer: 42 });
		assert.match(String(parsed.broken), /unavailable/);
	});
});

describe("event trace ring", () => {
	it("keeps only the most recent events, oldest first", () => {
		for (let i = 0; i < 30; i++) {
			trace({ event: `e${i}` });
		}
		const events = recentEvents();
		assert.equal(events.length, 24);
		assert.equal(events[0]?.event, "e6");
		assert.equal(events.at(-1)?.event, "e29");
	});

	it("stamps wall and monotonic times", () => {
		trace({ event: "stamped" });
		const last = recentEvents().at(-1);
		assert.equal(typeof last?.wall, "number");
		assert.equal(typeof last?.mono, "number");
	});
});

describe("describeGestureState", () => {
	it("compacts the machine state for traces", () => {
		assert.equal(describeGestureState({ downAt: null, rotatedWhileDown: false }), "idle");
		assert.equal(describeGestureState({ downAt: 123.4, rotatedWhileDown: false }), "down@123");
		assert.equal(describeGestureState({ downAt: 123.4, rotatedWhileDown: true }), "down@123+rotated");
	});
});
