/**
 * Redacted support report: what a bug report needs, nothing a bug report
 * doesn't. Built locally on request from the settings panel ("Copy support
 * report") and handed back over the PI message channel; there is no upload,
 * no network, no file drop.
 *
 * Action classes and the poller register their own sections so this module
 * depends on none of them; redaction of device identifiers goes through the
 * recorder's hash. Redaction rules are locked by test/diagnostics.test.ts.
 */
import { deviceCapabilities } from "./devices";
import { hashId, recentEvents, traceEnabled } from "./recorder";

type SectionProvider = () => unknown;

const sections = new Map<string, SectionProvider>();

export function registerDiagnostics(name: string, provider: SectionProvider): void {
	sections.set(name, provider);
}

export type SupportReportBase = {
	pluginVersion: string;
	appVersion: string;
	platformVersion: string;
};

export function buildSupportReport(base: SupportReportBase): string {
	const devices = [...deviceCapabilities.entries()].map(([id, caps]) => ({
		id: hashId(id),
		model: caps.model,
		type: caps.type,
		grid: `${caps.columns}x${caps.rows}`,
		encoders: caps.encoders,
		touchStrip: caps.touch !== null,
		kind: caps.kind,
		known: caps.known
	}));
	const report: Record<string, unknown> = {
		generatedAt: new Date().toISOString(),
		plugin: base.pluginVersion,
		streamDeckApp: base.appVersion,
		windows: base.platformVersion,
		eventTraceEnabled: traceEnabled(),
		devices,
		recentEvents: recentEvents()
	};
	for (const [name, provider] of sections) {
		try {
			report[name] = provider();
		} catch (err) {
			report[name] = `unavailable: ${String(err)}`;
		}
	}
	return JSON.stringify(report, null, "\t");
}
