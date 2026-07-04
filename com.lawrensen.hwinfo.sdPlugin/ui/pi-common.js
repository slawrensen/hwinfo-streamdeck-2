/* Shared property-inspector logic: the searchable sensor picker, the live
   preview line, and the status hint. Persists the selection through
   SDPIComponents.useSettings so sdpi-managed fields are never clobbered.

   Expected DOM (see sensor-reading.html / sensor-dial.html):
     #picker-search, #picker-refresh, #picker-list, #preview-value,
     #preview-stats, #status-hint                                      */
/* global SDPIComponents */
(() => {
	"use strict";

	const { streamDeckClient, useSettings } = SDPIComponents;

	const searchEl = document.getElementById("picker-search");
	const refreshEl = document.getElementById("picker-refresh");
	const listEl = document.getElementById("picker-list");
	const previewValueEl = document.getElementById("preview-value");
	const previewStatsEl = document.getElementById("preview-stats");
	const hintEl = document.getElementById("status-hint");

	const MAX_ROWS = 150;
	const SENSOR_TYPE_NAMES = ["", "Temp", "Voltage", "Fan", "Current", "Power", "Clock", "Usage", ""];

	let tree = null; // [{ name, readings: [{ key, label, unit, value, type }] }]
	let selectedKey = "";
	let listOpen = false;
	let suppressNextFocusOpen = false;

	// Immediate (non-debounced) persistence; third arg null disables debounce.
	const [getReadingKey, setReadingKey] = useSettings(
		"readingKey",
		(value) => {
			selectedKey = typeof value === "string" ? value : "";
			showSelection();
			renderList();
		},
		null
	);

	function fmt(value) {
		if (!Number.isFinite(value)) return "—";
		const abs = Math.abs(value);
		if (abs >= 10000) return `${(value / 1000).toFixed(1)}k`;
		if (abs >= 100) return value.toFixed(0);
		if (abs >= 10) return value.toFixed(1);
		return value.toFixed(2);
	}

	function findSelected() {
		if (tree === null || selectedKey === "") return null;
		for (const group of tree) {
			for (const reading of group.readings) {
				if (reading.key === selectedKey) return { group, reading };
			}
		}
		return null;
	}

	function showSelection() {
		if (document.activeElement === searchEl && listOpen) return; // don't fight the user mid-search
		const found = findSelected();
		if (found !== null) {
			searchEl.value = `${found.reading.label}  ·  ${found.group.name}`;
			searchEl.classList.remove("missing");
		} else if (selectedKey !== "") {
			searchEl.value = "⚠ selected sensor not present";
		} else {
			searchEl.value = "";
		}
	}

	function setHint(text) {
		hintEl.hidden = !text;
		hintEl.textContent = text || "";
	}

	function renderPreview(p) {
		if (p.reading) {
			previewValueEl.textContent = `${fmt(p.reading.value)} ${p.reading.unit}`.trim();
			previewStatsEl.textContent = `min ${fmt(p.reading.valueMin)} · max ${fmt(p.reading.valueMax)} · avg ${fmt(p.reading.valueAvg)}`;
		} else if (p.missing) {
			previewValueEl.textContent = "sensor missing";
			previewStatsEl.textContent = "";
		} else if (p.state !== "ok") {
			previewValueEl.textContent = "—";
			previewStatsEl.textContent = "";
		} else {
			previewValueEl.textContent = "pick a sensor";
			previewStatsEl.textContent = "";
		}
	}

	function tokensOf(text) {
		return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
	}

	function renderList() {
		if (!listOpen) return;
		if (tree === null) {
			listEl.innerHTML = `<div class="hw-more">Loading sensors…</div>`;
			return;
		}
		const raw = searchEl.value;
		// When the box still shows the selection display text, don't filter by it.
		const filtering = raw !== "" && findSelectedDisplay() !== raw;
		const tokens = filtering ? tokensOf(raw) : [];

		const frag = document.createDocumentFragment();
		let shown = 0;
		let hidden = 0;
		for (const group of tree) {
			const groupLower = group.name.toLowerCase();
			let header = null;
			for (const reading of group.readings) {
				const hay = `${groupLower} ${reading.label.toLowerCase()}`;
				if (tokens.length > 0 && !tokens.every((t) => hay.includes(t))) continue;
				if (shown >= MAX_ROWS) {
					hidden++;
					continue;
				}
				if (header === null) {
					header = document.createElement("div");
					header.className = "hw-group";
					header.textContent = group.name;
					frag.appendChild(header);
				}
				const row = document.createElement("div");
				row.className = "hw-row" + (reading.key === selectedKey ? " selected" : "");
				row.dataset.key = reading.key;
				const label = document.createElement("span");
				label.className = "hw-label";
				label.textContent = reading.label;
				const val = document.createElement("span");
				val.className = "hw-val";
				const typeName = SENSOR_TYPE_NAMES[reading.type] || "";
				val.textContent = `${fmt(reading.value)} ${reading.unit}${typeName ? " · " + typeName : ""}`;
				row.append(label, val);
				frag.appendChild(row);
				shown++;
			}
		}
		if (shown === 0) {
			const none = document.createElement("div");
			none.className = "hw-more";
			none.textContent = tokens.length > 0 ? "No sensors match." : "No sensors reported.";
			frag.appendChild(none);
		}
		if (hidden > 0) {
			const more = document.createElement("div");
			more.className = "hw-more";
			more.textContent = `…${hidden} more — refine the search.`;
			frag.appendChild(more);
		}
		listEl.replaceChildren(frag);
	}

	function findSelectedDisplay() {
		const found = findSelected();
		return found !== null ? `${found.reading.label}  ·  ${found.group.name}` : null;
	}

	function openList() {
		if (listOpen) return;
		listOpen = true;
		listEl.hidden = false;
		renderList();
		const sel = listEl.querySelector(".hw-row.selected");
		if (sel) sel.scrollIntoView({ block: "center" });
	}

	function closeList() {
		listOpen = false;
		listEl.hidden = true;
		showSelection();
	}

	function requestTree() {
		streamDeckClient.send("sendToPlugin", { event: "getSensorTree" });
	}

	// --- wiring -------------------------------------------------------------

	searchEl.addEventListener("focus", () => {
		if (suppressNextFocusOpen) {
			suppressNextFocusOpen = false;
			return;
		}
		searchEl.select();
		openList();
	});

	searchEl.addEventListener("input", () => {
		openList();
		renderList();
	});

	searchEl.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") {
			closeList();
			searchEl.blur();
		} else if (ev.key === "Enter") {
			const first = listEl.querySelector(".hw-row");
			if (first) first.dispatchEvent(new MouseEvent("mousedown"));
		}
	});

	// mousedown fires before the input's blur, keeping selection handling simple.
	listEl.addEventListener("mousedown", (ev) => {
		const row = ev.target.closest(".hw-row");
		if (!row) return;
		ev.preventDefault();
		selectedKey = row.dataset.key;
		setReadingKey(selectedKey);
		suppressNextFocusOpen = true;
		closeList();
	});

	document.addEventListener("mousedown", (ev) => {
		if (listOpen && !ev.target.closest(".hw-picker")) closeList();
	});

	if (refreshEl) {
		refreshEl.addEventListener("click", () => {
			tree = null;
			renderList();
			requestTree();
		});
	}

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object") return;
		if (p.event === "sensorTree") {
			tree = p.groups;
			setHint(p.hint);
			showSelection();
			renderList();
		} else if (p.event === "preview") {
			renderPreview(p);
			setHint(p.hint);
		}
	});

	getReadingKey().then((value) => {
		selectedKey = typeof value === "string" ? value : "";
		showSelection();
	});
	requestTree();
})();
