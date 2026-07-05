/**
 * Message shapes exchanged with the property inspector pages (ui/pi-common.js).
 * All are `type` aliases (not interfaces) so they satisfy the SDK's JsonValue.
 */
import type { JsonValue } from "@elgato/streamdeck";

import type { PollerStatus } from "./poller";
import { statusSentence } from "./ui/state-screens";
import { getDeckTheme } from "./ui/theme-store";
import { loadThemes } from "./ui/themes";

export type TreeReading = {
	key: string;
	label: string;
	unit: string;
	value: number;
	type: number;
};

export type TreeGroup = {
	name: string;
	readings: TreeReading[];
};

export type SensorTreePayload = {
	event: "sensorTree";
	groups: TreeGroup[];
	/** Poller state at fetch time — lets the PI refetch after HWiNFO comes up. */
	state: PollerStatus["state"];
	/** Active data source ("shared-memory" | "gadget"); absent when unavailable. */
	source?: string;
	/** Guidance sentence when data is unavailable; empty when ok via shared memory. */
	hint: string;
};

export type PreviewPayload = {
	event: "preview";
	state: PollerStatus["state"];
	/** Active data source ("shared-memory" | "gadget"); absent when unavailable. */
	source?: string;
	hint: string;
	/** Selected reading's live numbers; absent when nothing valid is selected. */
	reading?: {
		key: string;
		label: string;
		group: string;
		unit: string;
		value: number;
		valueMin: number;
		valueMax: number;
		valueAvg: number;
	};
	/** True when a reading is selected but absent from the current snapshot. */
	missing: boolean;
};

/**
 * The theme tokens for the PI's preset gallery — served over the message
 * channel because the PI webview cannot reliably fetch local files. The
 * plugin's schema-validated themes.json stays the single source of truth,
 * and `effectiveDeckTheme` is the RESOLVED deck default from the theme
 * store — the PI must never guess it from raw global settings (stale or
 * invalid values there made the "Deck default" chip lie).
 */
export function buildThemesPayload(): JsonValue {
	return JSON.parse(JSON.stringify({ event: "themes", effectiveDeckTheme: getDeckTheme(), ...loadThemes() })) as JsonValue;
}

/** The full sensor list, grouped by source — sent on PI request. */
export function buildSensorTree(status: PollerStatus): SensorTreePayload {
	const groups: TreeGroup[] = [];
	if (status.state !== "unavailable") {
		const { snapshot } = status;
		const byIndex = new Map<number, TreeGroup>();
		for (const reading of snapshot.readings) {
			let group = byIndex.get(reading.sensorIndex);
			if (group === undefined) {
				const name = snapshot.sensors[reading.sensorIndex]?.name ?? "Unknown sensor";
				group = { name, readings: [] };
				byIndex.set(reading.sensorIndex, group);
				groups.push(group);
			}
			group.readings.push({
				key: reading.key,
				label: reading.label,
				unit: reading.unit,
				value: reading.value,
				type: reading.type
			});
		}
	}
	const payload: SensorTreePayload = { event: "sensorTree", groups, state: status.state, hint: statusSentence(status) };
	if (status.state !== "unavailable") {
		payload.source = status.source;
	}
	return payload;
}

/** Live preview of the selected reading — pushed to the open PI every tick. */
export function buildPreview(status: PollerStatus, readingKey: string | undefined): PreviewPayload {
	const payload: PreviewPayload = {
		event: "preview",
		state: status.state,
		hint: statusSentence(status),
		missing: false
	};
	if (status.state !== "unavailable") {
		payload.source = status.source;
	}
	if (status.state === "unavailable" || readingKey === undefined || readingKey === "") {
		return payload;
	}
	const reading = status.snapshot.byKey.get(readingKey);
	if (reading === undefined) {
		payload.missing = true;
		return payload;
	}
	payload.reading = {
		key: reading.key,
		label: reading.label,
		group: status.snapshot.sensors[reading.sensorIndex]?.name ?? "Unknown sensor",
		unit: reading.unit,
		value: reading.value,
		valueMin: reading.valueMin,
		valueMax: reading.valueMax,
		valueAvg: reading.valueAvg
	};
	return payload;
}
