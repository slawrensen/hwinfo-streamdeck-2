/* The support-report copy button, shared by all three property inspectors
   (control, sensor-reading, sensor-dial): asks the plugin for the redacted
   report and puts it on the clipboard. Expects #support-report. */
/* global SDPIComponents */
(() => {
	"use strict";

	const { streamDeckClient } = SDPIComponents;
	const supportEl = document.getElementById("support-report");

	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			const scratch = document.createElement("textarea");
			scratch.value = text;
			document.body.appendChild(scratch);
			scratch.select();
			const ok = document.execCommand("copy");
			scratch.remove();
			return ok;
		}
	}

	supportEl.addEventListener("click", () => {
		supportEl.disabled = true;
		streamDeckClient.send("sendToPlugin", { event: "getSupportReport" });
	});

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object" || p.event !== "supportReport" || typeof p.report !== "string") return;
		copyText(p.report).then((ok) => {
			supportEl.disabled = false;
			supportEl.textContent = ok ? "Copied to clipboard" : "Copy failed";
			setTimeout(() => {
				supportEl.textContent = "Copy support report";
			}, 2000);
		});
	});
})();
