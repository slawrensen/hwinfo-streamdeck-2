/**
 * Device capability registry: the one place that knows what each connected
 * deck physically is. Action handlers, renderers and diagnostics ask this
 * module instead of switching on DeviceType themselves.
 *
 * The Stream Deck app reports only { id, name, type, size } per device, and
 * `size` explicitly excludes dials and touch strips, so encoder counts and
 * touch geometry come from the model table below (values from Elgato's
 * per-device documentation). Unknown or future device types degrade to a
 * safe keys-only profile sized by the reported grid.
 *
 * Capabilities inform derived behavior (tap-zone geometry, trigger
 * descriptions, diagnostics, logging); they never gate live event handling.
 * A dial event from a device we believe has no dials is still handled, so a
 * missing or wrong table entry can never break input.
 */
import { DeviceType } from "@elgato/schemas/streamdeck/plugins";

export type DeviceKind = "keys" | "keys+dials" | "dials" | "headless";

export type DeviceCapabilities = {
	/** DeviceType as reported by the app; undefined when it sent none. */
	readonly type: number | undefined;
	/** Model name from the table, or a safe "Unknown device" fallback. */
	readonly model: string;
	/** Key grid as the app reports it (dials and touch strips excluded). */
	readonly columns: number;
	readonly rows: number;
	readonly keys: number;
	readonly encoders: number;
	/** Per-encoder touch canvas in px; null when there is no touch strip. */
	readonly touch: { readonly width: number; readonly height: number } | null;
	/** False for devices with no plugin-drawable display (Pedal, G-keys). */
	readonly displayCapable: boolean;
	readonly kind: DeviceKind;
	/** False when the type is not in the model table (future hardware). */
	readonly known: boolean;
};

/**
 * The SDK's per-encoder layout canvas is 200x100 on both touch-strip devices
 * (the + strip is 800x100 over 4 encoders, the + XL strip 1200x100 over 6:
 * both are 200x100 per segment). touchTap positions arrive relative to this
 * canvas.
 */
export const TOUCH_SEGMENT = { width: 200, height: 100 } as const;

type ModelSpec = {
	readonly model: string;
	readonly encoders?: number;
	readonly touch?: boolean;
	/** Only set false: devices with no display the plugin can draw on. */
	readonly display?: false;
};

/** Known models. */
const MODELS: Readonly<Record<number, ModelSpec>> = {
	[DeviceType.StreamDeck]: { model: "Stream Deck" },
	[DeviceType.StreamDeckMini]: { model: "Stream Deck Mini" },
	[DeviceType.StreamDeckXL]: { model: "Stream Deck XL" },
	[DeviceType.StreamDeckMobile]: { model: "Stream Deck Mobile" },
	[DeviceType.CorsairGKeys]: { model: "Corsair G-Keys", display: false },
	[DeviceType.StreamDeckPedal]: { model: "Stream Deck Pedal", display: false },
	[DeviceType.CorsairVoyager]: { model: "Corsair Voyager" },
	[DeviceType.StreamDeckPlus]: { model: "Stream Deck +", encoders: 4, touch: true },
	[DeviceType.SCUFController]: { model: "SCUF controller", display: false },
	[DeviceType.StreamDeckNeo]: { model: "Stream Deck Neo" },
	// Stream Deck Studio (10) and Galleon 100 SD (12, model code GRETSCH)
	// are deliberately NOT listed. Studio: 16x2 keys plus 2 dials with no
	// drawable strip (the app ships encoder strip backgrounds for the +,
	// + XL and GRETSCH only), so a dial face would render nowhere. Galleon:
	// its screen does take encoder backgrounds, but at 720x384, a different
	// class from the 200x100-per-encoder strips this plugin draws for, and
	// it has no touch input. Neither is hardware-verified; both take the
	// unknown-device fallback (input still handled, honest "Unknown device"
	// in logs and reports) until a real support pass.
	[DeviceType.VirtualStreamDeck]: { model: "Virtual Stream Deck" },
	[DeviceType.StreamDeckPlusXL]: { model: "Stream Deck + XL", encoders: 6, touch: true }
};

/** Derives a safe capability object from what a device event carries. */
export function deriveCapabilities(info: { type?: number; columns?: number; rows?: number }): DeviceCapabilities {
	const spec = info.type !== undefined ? MODELS[info.type] : undefined;
	const columns = info.columns ?? 0;
	const rows = info.rows ?? 0;
	const keys = columns * rows;
	const encoders = spec?.encoders ?? 0;
	// Unknown devices with a key grid are assumed drawable: rendering to a
	// display-less key is a harmless no-op, while refusing to render on a
	// future display device would be a real failure.
	const displayCapable = spec !== undefined ? spec.display !== false : keys > 0;
	const kind: DeviceKind = keys > 0 && encoders > 0 ? "keys+dials" : encoders > 0 ? "dials" : keys > 0 && displayCapable ? "keys" : "headless";
	return {
		type: info.type,
		model: spec?.model ?? (info.type !== undefined ? `Unknown device (type ${info.type})` : "Unknown device"),
		columns,
		rows,
		keys,
		encoders,
		touch: spec?.touch === true ? TOUCH_SEGMENT : null,
		displayCapable,
		kind,
		known: spec !== undefined
	};
}

/**
 * The tap-zone canvas width for an action on this device. Falls back to the
 * SDK's universal 200 px segment so tap routing stays deterministic even for
 * an unknown device that surprises us with touch events.
 */
export function tapCanvasWidth(caps: DeviceCapabilities): number {
	return caps.touch?.width ?? TOUCH_SEGMENT.width;
}

/**
 * Runtime store, keyed by device ID. Filled from the SDK's device events by
 * plugin.ts (this module stays SDK-free so it is unit-testable); read by
 * the actions and diagnostics. Lookups for a device we never saw return the
 * unknown-device fallback rather than throwing.
 */
class DeviceCapabilityRegistry {
	private readonly byId = new Map<string, DeviceCapabilities>();

	ingest(id: string, info: { type?: number; columns?: number; rows?: number }): DeviceCapabilities {
		const caps = deriveCapabilities(info);
		this.byId.set(id, caps);
		return caps;
	}

	get(id: string): DeviceCapabilities {
		return this.byId.get(id) ?? deriveCapabilities({});
	}

	/** Stable snapshot for diagnostics (device IDs are hashed there). */
	entries(): ReadonlyMap<string, DeviceCapabilities> {
		return this.byId;
	}
}

export const deviceCapabilities = new DeviceCapabilityRegistry();
