/* HWiNFO Control settings panel: everything persists through sdpi
   components; the only scripted part is the support-report copy button.
   (pi-common.js is the picker-page script and expects picker DOM.) */
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
