// Device capability derivation: one fixture per hardware family the plugin
// can meet, plus the unknown-future-device fallback. The table must never
// gate live events, so these tests only assert derived facts (grid, encoder
// count, touch geometry, kind), not behavior.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveCapabilities, tapCanvasWidth, TOUCH_SEGMENT } from "../src/devices";

describe("deriveCapabilities", () => {
	it("Stream Deck + XL: 9x4 keys, six encoders, 200x100 touch segments", () => {
		const caps = deriveCapabilities({ type: 13, columns: 9, rows: 4 });
		assert.equal(caps.model, "Stream Deck + XL");
		assert.equal(caps.keys, 36);
		assert.equal(caps.encoders, 6);
		assert.deepEqual(caps.touch, { width: 200, height: 100 });
		assert.equal(caps.kind, "keys+dials");
		assert.equal(caps.known, true);
	});

	it("Stream Deck +: 4x2 keys, four encoders, touch strip", () => {
		const caps = deriveCapabilities({ type: 7, columns: 4, rows: 2 });
		assert.equal(caps.encoders, 4);
		assert.deepEqual(caps.touch, TOUCH_SEGMENT);
		assert.equal(caps.kind, "keys+dials");
	});

	it("Stream Deck XL: 8x4 key grid, no encoders", () => {
		const caps = deriveCapabilities({ type: 2, columns: 8, rows: 4 });
		assert.equal(caps.keys, 32);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.touch, null);
		assert.equal(caps.kind, "keys");
	});

	it("15-key family: 5x3", () => {
		const caps = deriveCapabilities({ type: 0, columns: 5, rows: 3 });
		assert.equal(caps.keys, 15);
		assert.equal(caps.kind, "keys");
	});

	it("Stream Deck Mini: 3x2, no encoders", () => {
		const caps = deriveCapabilities({ type: 1, columns: 3, rows: 2 });
		assert.equal(caps.model, "Stream Deck Mini");
		assert.equal(caps.keys, 6);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.touch, null);
		assert.equal(caps.kind, "keys");
	});

	it("Stream Deck Neo: 4x2", () => {
		const caps = deriveCapabilities({ type: 9, columns: 4, rows: 2 });
		assert.equal(caps.keys, 8);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.kind, "keys");
	});

	it("Mobile and Virtual decks take the grid the app reports, not a table", () => {
		assert.equal(deriveCapabilities({ type: 3, columns: 3, rows: 5 }).keys, 15);
		assert.equal(deriveCapabilities({ type: 11, columns: 8, rows: 8 }).keys, 64);
		assert.equal(deriveCapabilities({ type: 11, columns: 1, rows: 1 }).keys, 1);
	});

	it("Pedal and G-keys are headless: key input without a display", () => {
		for (const type of [5, 4, 8]) {
			const caps = deriveCapabilities({ type, columns: 3, rows: 1 });
			assert.equal(caps.displayCapable, false, `type ${type}`);
			assert.equal(caps.kind, "headless", `type ${type}`);
		}
	});

	it("Studio and Galleon stay unclaimed until hardware-verified: unknown fallback", () => {
		// Not in the table: the Studio has no drawable dial strip, and the
		// Galleon's 720x384 screen is not the 200x100-per-encoder strip
		// class this plugin renders (and takes no touch input). Unknown
		// fallback until a real support pass; see docs/hardware.md.
		for (const [type, columns, rows] of [
			[10, 16, 2],
			[12, 3, 4]
		] as const) {
			const caps = deriveCapabilities({ type, columns, rows });
			assert.equal(caps.known, false, `type ${type}`);
			assert.equal(caps.encoders, 0, `type ${type}`);
			assert.equal(caps.touch, null, `type ${type}`);
			assert.equal(caps.kind, "keys", `type ${type}`);
		}
	});

	it("an unknown future device degrades to a safe keys profile", () => {
		const caps = deriveCapabilities({ type: 99, columns: 6, rows: 6 });
		assert.equal(caps.known, false);
		assert.equal(caps.model, "Unknown device (type 99)");
		assert.equal(caps.keys, 36);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.touch, null);
		assert.equal(caps.displayCapable, true); // rendering is a harmless no-op
		assert.equal(caps.kind, "keys");
	});

	it("a device event with nothing usable still yields a capability object", () => {
		const caps = deriveCapabilities({});
		assert.equal(caps.known, false);
		assert.equal(caps.keys, 0);
		assert.equal(caps.kind, "headless");
	});
});

describe("tapCanvasWidth", () => {
	it("uses the touch segment width, falling back to the SDK's 200", () => {
		assert.equal(tapCanvasWidth(deriveCapabilities({ type: 13, columns: 9, rows: 4 })), 200);
		// An unlisted/unknown device can still surprise us with a tap.
		assert.equal(tapCanvasWidth(deriveCapabilities({ type: 10, columns: 16, rows: 2 })), 200);
		assert.equal(tapCanvasWidth(deriveCapabilities({})), 200);
	});
});
