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
	const galleryEl = document.getElementById("theme-gallery");
	const rotationSetEl = document.getElementById("rotation-set"); // dial PI only
	const controlsCustomEl = document.getElementById("controls-custom"); // dial PI only
	const controlsZonesEl = document.getElementById("controls-zones"); // dial PI only
	const supportEl = document.getElementById("support-report");

	const MAX_ROWS = 150;
	const SENSOR_TYPE_NAMES = ["", "Temp", "Voltage", "Fan", "Current", "Power", "Clock", "Usage", ""];

	let tree = null; // [{ name, readings: [{ key, label, unit, value, type }] }]
	let treeFetchedOk = false; // last sensorTree arrived while HWiNFO was up
	let treeRequestPending = false;
	let selectedKey = "";
	let listOpen = false;
	// True only after a real keystroke in the search box; cleared whenever the
	// box is programmatically rewritten. The old proxy (box text differs from
	// the selection display) misfired when rotation moved the selection under
	// a focused box: the stale display text filtered the list to nothing.
	let searchTyped = false;

	// Immediate (non-debounced) persistence; third arg null disables debounce.
	const [getReadingKey, setReadingKey] = useSettings(
		"readingKey",
		(value) => {
			selectedKey = typeof value === "string" ? value : "";
			showSelection();
			renderList();
			renderRotationSet(); // the current-chip highlight follows the move
			// Rotating the dial (or autocycle) moves the selection while the
			// list is open: keep the highlighted row in view so the movement
			// is visible. "nearest" only scrolls when it left the viewport,
			// and a hand-typed filter is never yanked around.
			if (listOpen && !searchTyped) {
				listEl.querySelector(".hw-row.selected")?.scrollIntoView({ block: "nearest" });
			}
		},
		null
	);

	// Rotation set (dial PI only): the readings dial rotation is limited to,
	// ticked in the picker rows. Shown under the picker as one flat chips row,
	// or split into named groups (plain rotate stays inside a group, a gesture
	// set to "Switch sensor or group" jumps between them). rotationKeys is
	// kept mirrored to the union of all group keys, so set-wide consumers
	// (stats, reset reach) and older plugin versions after a rollback keep
	// reading the flat set unchanged. The plugin ignores anything under two
	// non-empty groups; the PI still renders those editing states.
	let rotationKeys = [];
	let rotationGroups = null; // null = flat set; else [{ name, keys }]
	let collectorIndex = 0; // which group new ticks land in (PI-local, not persisted)
	const rotationBinding =
		rotationSetEl === null
			? null
			: useSettings(
					"rotationKeys",
					(value) => {
						rotationKeys = Array.isArray(value) ? value.filter((k) => typeof k === "string") : [];
						renderRotationSet();
						renderList();
					},
					null
				);
	const groupsBinding =
		rotationSetEl === null
			? null
			: useSettings(
					"rotationGroups",
					(value) => {
						rotationGroups = parseGroupsSetting(value);
						clampCollector();
						renderRotationSet();
						renderList();
					},
					null
				);

	// Settings are untyped JSON: keep what renders (name string, string keys)
	// and treat an empty or non-array value as "no groups" (the flat set).
	function parseGroupsSetting(value) {
		if (!Array.isArray(value) || value.length === 0) return null;
		const groups = [];
		for (const entry of value) {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
			const keys = Array.isArray(entry.keys) ? entry.keys.filter((k) => typeof k === "string" && k !== "") : [];
			groups.push({ name: typeof entry.name === "string" ? entry.name : "", keys });
		}
		return groups.length > 0 ? groups : null;
	}

	function unionKeys(groups) {
		const keys = [];
		for (const group of groups) {
			for (const key of group.keys) {
				if (!keys.includes(key)) keys.push(key);
			}
		}
		return keys;
	}

	function clampCollector() {
		const last = rotationGroups === null ? 0 : rotationGroups.length - 1;
		collectorIndex = Math.max(0, Math.min(collectorIndex, last));
	}

	function memberOfRotation(key) {
		return rotationGroups !== null ? rotationGroups.some((g) => g.keys.includes(key)) : rotationKeys.includes(key);
	}

	/**
	 * One write path for every set/group edit: persists the groups (when
	 * `writeGroups`; flat-set edits skip it so dials that never used groups
	 * never gain the field) AND the union mirror in rotationKeys, then
	 * refreshes the chips and syncs the list ticks in place, so the open
	 * list keeps its scroll position and every box matches the model.
	 */
	function writeRotation(writeGroups) {
		if (rotationGroups !== null) rotationKeys = unionKeys(rotationGroups);
		clampCollector();
		if (writeGroups) {
			// [] persists "no groups": the field is only ever written, never
			// removed, and the plugin ignores anything under two groups.
			groupsBinding[1](rotationGroups === null ? [] : rotationGroups.map((g) => ({ name: g.name, keys: [...g.keys] })));
		}
		rotationBinding[1](rotationKeys);
		renderRotationSet();
		for (const row of listEl.querySelectorAll(".hw-row")) {
			const tick = row.querySelector(".hw-tick");
			if (tick !== null) tick.checked = memberOfRotation(row.dataset.key);
		}
	}

	function setRotationMembership(key, present) {
		if (rotationBinding === null || !key) return;
		if (present === memberOfRotation(key)) return;
		if (rotationGroups === null) {
			rotationKeys = present ? [...rotationKeys, key] : rotationKeys.filter((k) => k !== key);
		} else if (present) {
			// New ticks land in the marked collector group.
			const target = rotationGroups[collectorIndex];
			if (target !== undefined && !target.keys.includes(key)) target.keys.push(key);
		} else {
			// Unticking removes the reading from every group holding it.
			for (const group of rotationGroups) {
				group.keys = group.keys.filter((k) => k !== key);
			}
		}
		writeRotation(rotationGroups !== null);
	}

	function readingLabelOf(key) {
		if (tree !== null) {
			for (const group of tree) {
				for (const reading of group.readings) {
					if (reading.key === key) return reading.label;
				}
			}
		}
		return null;
	}

	function setChip(key, groupIndex) {
		const label = readingLabelOf(key);
		const chip = document.createElement("span");
		// "current" paints the chip of the reading on the dial right now, so
		// the open panel shows where rotation (and a group jump) landed.
		chip.className = "hw-set-chip" + (tree !== null && label === null ? " missing" : "") + (key === selectedKey ? " current" : "");
		const name = document.createElement("span");
		name.textContent = label ?? key;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-set-remove";
		remove.dataset.key = key;
		if (groupIndex !== null) remove.dataset.group = String(groupIndex);
		remove.title = groupIndex !== null ? "Remove from this group" : "Remove from the rotation set";
		remove.textContent = "×";
		chip.append(name, remove);
		return chip;
	}

	function setNote(text) {
		const note = document.createElement("div");
		note.className = "hw-set-note";
		note.textContent = text;
		return note;
	}

	function setActions(actions) {
		const row = document.createElement("div");
		row.className = "hw-set-actions";
		for (const [action, label] of actions) {
			const button = document.createElement("button");
			button.type = "button";
			button.dataset.setAction = action;
			button.textContent = label;
			row.appendChild(button);
		}
		return row;
	}

	function groupHeader(group, index) {
		const head = document.createElement("div");
		head.className = "hw-group-head";
		const collector = document.createElement("input");
		collector.type = "radio";
		collector.name = "hw-collector";
		collector.className = "hw-collector";
		collector.checked = index === collectorIndex;
		collector.dataset.group = String(index);
		collector.title = "New ticks land in this group";
		const name = document.createElement("input");
		name.type = "text";
		name.className = "hw-group-name";
		name.value = group.name;
		name.placeholder = `Group ${index + 1}`;
		name.dataset.group = String(index);
		name.title = "Group name; the dial shows it when a jump lands here";
		name.spellcheck = false;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-group-remove";
		remove.dataset.group = String(index);
		remove.title = "Remove this group (its readings leave the rotation)";
		remove.textContent = "×";
		head.append(collector, name, remove);
		return head;
	}

	function updateRotationHelp() {
		const help = document.getElementById("rotation-help");
		if (help === null) return;
		help.textContent =
			rotationGroups === null
				? "Tick readings in the sensor list above to limit rotation to just those. Leave the set empty to rotate through every reading of the picked sensor."
				: "Ticks land in the group marked by the radio. Plain rotate stays inside a group; a gesture set to “Switch sensor or group” (Elite press+rotate) jumps between groups and shows the group name on the dial. Legacy rotates through all groups as one list.";
	}

	function renderRotationSet() {
		if (rotationSetEl === null) return;
		// Never rebuild under a focused name field: a settings echo (rotation
		// moved, autocycle stepped) would clobber the typing mid-word.
		if (rotationSetEl.contains(document.activeElement) && document.activeElement.classList.contains("hw-group-name")) return;
		const frag = document.createDocumentFragment();
		if (rotationGroups === null) {
			for (const key of rotationKeys) {
				frag.appendChild(setChip(key, null));
			}
			frag.appendChild(
				setNote(
					rotationKeys.length === 0
						? "Empty: rotation moves through all readings of the picked sensor."
						: rotationKeys.length === 1
							? "Only one reading picked. Rotation needs two or more to move."
							: `Rotation moves through these ${rotationKeys.length} readings only.`
				)
			);
			frag.appendChild(setActions([["split", "Split into groups"]]));
		} else {
			rotationGroups.forEach((group, index) => {
				frag.appendChild(groupHeader(group, index));
				const chips = document.createElement("div");
				chips.className = "hw-set-chips";
				for (const key of group.keys) {
					chips.appendChild(setChip(key, index));
				}
				if (group.keys.length === 0) {
					chips.appendChild(setNote("Empty: tick readings above to fill this group."));
				}
				frag.appendChild(chips);
			});
			const populated = rotationGroups.filter((g) => g.keys.length > 0).length;
			frag.appendChild(
				setNote(
					rotationGroups.length === 1
						? "One group only: it acts as a plain rotation set until you add a second."
						: populated < 2
							? `${rotationGroups.length} groups. They take effect once two of them hold readings; until then rotation runs as one flat list.`
							: `${rotationGroups.length} groups. Rotation needs two or more readings in a group to move inside it.`
				)
			);
			frag.appendChild(setActions([["add", "Add group"], ["merge", "Merge back into one set"]]));
		}
		rotationSetEl.replaceChildren(frag);
		updateRotationHelp();
	}

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
		if (document.activeElement === searchEl && listOpen && searchTyped) return; // don't fight the user mid-search
		searchTyped = false;
		const found = findSelected();
		if (found !== null) {
			searchEl.value = `${found.reading.label}  ·  ${found.group.name}`;
			searchEl.placeholder = "Search sensors…";
			searchEl.classList.remove("missing");
		} else if (selectedKey !== "") {
			// Never put the warning into .value; it would act as a search filter.
			searchEl.value = "";
			searchEl.placeholder = "⚠ selected sensor not present. Pick again";
			searchEl.classList.add("missing");
		} else {
			searchEl.value = "";
			searchEl.placeholder = "Search sensors…";
			searchEl.classList.remove("missing");
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
		// The stats line clips to one line (pi.css); the title carries the full text.
		previewStatsEl.title = previewStatsEl.textContent;
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
		// Only a filter the user actually typed filters the list.
		const filtering = searchTyped && raw !== "";
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
				if (rotationSetEl !== null) {
					const tick = document.createElement("input");
					tick.type = "checkbox";
					tick.className = "hw-tick";
					tick.checked = memberOfRotation(reading.key);
					tick.title = rotationGroups === null ? "Include in the rotation set" : "Include in the marked rotation group";
					row.appendChild(tick);
				}
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
			none.textContent = tokens.length > 0 ? "No sensors match." : "No sensors reported. Check HWiNFO's sensor window.";
			frag.appendChild(none);
		}
		if (hidden > 0) {
			const more = document.createElement("div");
			more.className = "hw-more";
			more.textContent = `…${hidden} more. Refine the search.`;
			frag.appendChild(more);
		}
		listEl.replaceChildren(frag);
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
		treeRequestPending = true;
		streamDeckClient.send("sendToPlugin", { event: "getSensorTree" });
	}

	function selectRow(row) {
		if (!row || !row.dataset.key) return;
		selectedKey = row.dataset.key;
		setReadingKey(selectedKey);
		closeList();
		renderRotationSet(); // own writes are not echoed back: move the highlight here
	}

	// --- wiring -------------------------------------------------------------

	searchEl.addEventListener("focus", () => {
		searchEl.select();
		openList();
	});

	// After a selection the input keeps focus (the row's mousedown is
	// preventDefault-ed), so no focus event fires; reopen on click too.
	searchEl.addEventListener("mousedown", () => {
		if (!listOpen && document.activeElement === searchEl) {
			searchEl.select();
			openList();
		}
	});

	searchEl.addEventListener("input", () => {
		searchTyped = true;
		openList();
		renderList();
	});

	searchEl.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") {
			closeList();
			searchEl.blur();
		} else if (ev.key === "Enter" && listOpen) {
			// Only treat Enter as "pick the top row" when the user actually typed
			// a filter (same condition renderList uses). With the box still showing
			// the current selection (or the ⚠ missing-sensor placeholder), the list
			// is the full unfiltered tree, whose top row is unrelated; picking it
			// would silently swap the user's saved sensor. Just close instead.
			if (searchTyped && searchEl.value !== "") {
				selectRow(listEl.querySelector(".hw-row"));
			} else {
				closeList();
			}
		}
	});

	// mousedown fires before the input's blur, keeping selection handling simple.
	listEl.addEventListener("mousedown", (ev) => {
		const row = ev.target.closest(".hw-row");
		if (!row) return;
		// Membership ticks toggle natively on the CLICK that follows; fighting
		// that from mousedown left the box visually inverted. Let it be.
		if (ev.target.classList.contains("hw-tick")) return;
		ev.preventDefault();
		selectRow(row);
	});

	// The checkbox's own activation already flipped it; adopt its new state.
	listEl.addEventListener("click", (ev) => {
		if (!ev.target.classList.contains("hw-tick")) return;
		const row = ev.target.closest(".hw-row");
		setRotationMembership(row?.dataset.key, ev.target.checked);
	});

	document.addEventListener("mousedown", (ev) => {
		// composedPath, not target.closest: toggling a rotation tick re-renders
		// the rows mid-bubble, detaching ev.target; closest() on a detached node
		// would misread the click as outside the picker and close the list.
		const insidePicker = ev.composedPath().some((el) => el instanceof Element && el.classList.contains("hw-picker"));
		if (listOpen && !insidePicker) closeList();
	});

	if (refreshEl) {
		refreshEl.addEventListener("click", () => {
			tree = null;
			renderList();
			requestTree();
		});
	}

	// Control preset (dial PI only): the custom gesture rows only exist for
	// "custom", the touch-zone picker for anything beyond legacy. The sdpi
	// store notifies subscribers on didReceiveSettings only, and the app does
	// NOT echo a PI's own setSettings back to it, so picking a preset in this
	// very panel never fires the subscription. Poll the LOCAL settings cache
	// (no round trip) so the rows follow the select while the panel is open.
	if (controlsCustomEl !== null) {
		// Switching Elite to Custom seeds Elite's map into every gesture field
		// still unset, so "Elite minus one gesture" is a one-select change
		// instead of rebuilding the whole map from the Legacy fallbacks.
		// Fields the user ever set are never touched, and Legacy to Custom
		// needs no writes because the unset fallbacks ARE the Legacy commands.
		const ELITE_MAP = [
			["gestureRotate", "step"],
			["gesturePressedRotate", "stepGroup"],
			["gestureShortPress", "pauseResume"],
			["gestureLongPress", "resetStats"],
			["gestureTap", "cycleStat"],
			["gestureTouchHold", "backToCurrent"]
		];
		const gestureBindings = ELITE_MAP.map(([setting]) => useSettings(setting, () => {}, null));
		const seedFromElite = () => {
			ELITE_MAP.forEach(([setting, command], index) => {
				const [getGesture, setGesture] = gestureBindings[index];
				getGesture().then((value) => {
					if (typeof value === "string" && value !== "") return; // user-set: keep
					setGesture(command);
					// The sdpi store does not notify components of the PI's own
					// writes; poke the select so it displays the seeded command.
					const el = document.querySelector(`sdpi-select[setting="${setting}"]`);
					if (el) el.value = command;
				});
			});
		};
		let lastPreset = null;
		const applyPreset = (value) => {
			const preset = value === "elite" || value === "custom" ? value : "legacy";
			if (lastPreset === "elite" && preset === "custom") seedFromElite();
			lastPreset = preset;
			controlsCustomEl.hidden = preset !== "custom";
			if (controlsZonesEl !== null) controlsZonesEl.hidden = preset === "legacy";
		};
		const [getPreset] = useSettings("controlPreset", applyPreset, null);
		getPreset().then(applyPreset);
		setInterval(() => getPreset().then(applyPreset), 400);
	}

	// "Copy support report": ask the plugin for the redacted report, copy it.
	if (supportEl !== null) {
		supportEl.addEventListener("click", () => {
			supportEl.disabled = true;
			streamDeckClient.send("sendToPlugin", { event: "getSupportReport" });
		});
	}

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

	function deliverSupportReport(report) {
		if (supportEl === null) return;
		copyText(report).then((ok) => {
			supportEl.disabled = false;
			supportEl.textContent = ok ? "Copied to clipboard" : "Copy failed";
			setTimeout(() => {
				supportEl.textContent = "Copy support report";
			}, 2000);
		});
	}

	// --- theme preset gallery -------------------------------------------------
	// Tokens come from the plugin (parsed themes.json) over the message channel;
	// the deck-wide default renders as the leading "Deck default" chip and the
	// seven presets follow. Clicking writes the per-key "theme" setting ("" =
	// follow deck default); the key/dial re-renders immediately: live preview.

	let themesConfig = null; // { defaultTheme, effectiveDeckTheme, themes: { id: { bg, ... } } }
	let themeOverride = "";

	const setThemeOverride =
		galleryEl === null
			? null
			: useSettings(
					"theme",
					(value) => {
						themeOverride = typeof value === "string" ? value : "";
						renderGallery();
					},
					null
				)[1];

	// A monochrome "link" glyph marking the follow chip. Drawn (not an emoji or
	// theme color) so it stays legible on any resolved palette, sitting on a
	// translucent dark badge.
	const FOLLOW_GLYPH =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
		'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
		'<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

	function themeChip(id, palette, name, selected) {
		// The leading chip (id "") follows the deck-wide theme. It must preview
		// the resolved palette truthfully yet never read as a twin of the preset
		// it currently resolves to, so it gets a dashed frame + link badge
		// (structure, not typography). It follows; it doesn't pin.
		const isDeck = id === "";
		const chip = document.createElement("button");
		chip.type = "button";
		chip.className = "hw-theme" + (selected ? " selected" : "") + (isDeck ? " hw-theme-deck" : "");
		chip.dataset.theme = id;
		chip.title = name;
		const face = document.createElement("span");
		face.className = "hw-theme-face";
		face.style.background = palette.bg;
		const value = document.createElement("span");
		value.className = "hw-theme-value";
		value.style.color = palette.value;
		value.textContent = isDeck ? "auto" : "64";
		const spark = document.createElement("span");
		spark.className = "hw-theme-spark";
		spark.style.background = palette.accent;
		face.append(value, spark);
		if (isDeck) {
			const badge = document.createElement("span");
			badge.className = "hw-theme-badge";
			badge.innerHTML = FOLLOW_GLYPH;
			face.appendChild(badge);
		}
		const label = document.createElement("span");
		label.className = "hw-theme-name";
		label.textContent = name;
		chip.append(face, label);
		return chip;
	}

	function renderGallery() {
		if (galleryEl === null || themesConfig === null) return;
		const frag = document.createDocumentFragment();
		// The plugin resolves the effective deck default (theme store, incl.
		// legacy migration); never guess it from raw global settings here.
		const deckId = themesConfig.themes[themesConfig.effectiveDeckTheme] ? themesConfig.effectiveDeckTheme : themesConfig.defaultTheme;
		const deckDisplay = deckId.charAt(0).toUpperCase() + deckId.slice(1);
		const deckChip = themeChip("", themesConfig.themes[deckId], "Deck default", themeOverride === "");
		deckChip.title = "Deck default · " + deckDisplay;
		frag.appendChild(deckChip);
		const help = document.getElementById("theme-help");
		if (help !== null) {
			help.textContent = "Pick a preset for this " + (document.title.includes("Dial") ? "dial" : "key") + " only, or the dashed “Deck default” chip (currently " + deckDisplay + ") to follow the deck-wide theme set under Advanced.";
		}
		for (const [id, palette] of Object.entries(themesConfig.themes)) {
			frag.appendChild(themeChip(id, palette, id.charAt(0).toUpperCase() + id.slice(1), themeOverride === id));
		}
		galleryEl.replaceChildren(frag);
	}

	if (galleryEl !== null) {
		galleryEl.addEventListener("click", (ev) => {
			const chip = ev.target.closest(".hw-theme");
			if (!chip) return;
			themeOverride = chip.dataset.theme;
			setThemeOverride(themeOverride);
			renderGallery();
		});
		// The plugin pushes a fresh themes payload (with effectiveDeckTheme)
		// whenever the deck theme changes; no global-settings guessing here.
		streamDeckClient.send("sendToPlugin", { event: "getThemes" });
	}

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object") return;
		if (p.event === "themes") {
			themesConfig = p;
			renderGallery();
			return;
		}
		if (p.event === "supportReport" && typeof p.report === "string") {
			deliverSupportReport(p.report);
			return;
		}
		if (p.event === "sensorTree") {
			tree = p.groups;
			treeFetchedOk = p.state === "ok";
			treeRequestPending = false;
			setHint(p.hint);
			showSelection();
			renderList();
			renderRotationSet(); // chip labels resolve once the tree is here
		} else if (p.event === "preview") {
			renderPreview(p);
			setHint(p.hint);
			// The tree was fetched while HWiNFO was down; refresh it now that
			// data is flowing, so the picker isn't stuck on "No sensors reported".
			if (p.state === "ok" && !treeFetchedOk && !treeRequestPending) {
				requestTree();
			}
		}
	});

	getReadingKey().then((value) => {
		selectedKey = typeof value === "string" ? value : "";
		showSelection();
		renderRotationSet(); // the set may have rendered before the key arrived
	});
	if (rotationBinding !== null) {
		rotationSetEl.addEventListener("click", (ev) => {
			const groupRemove = ev.target.closest(".hw-group-remove");
			if (groupRemove) {
				const index = Number(groupRemove.dataset.group);
				if (rotationGroups !== null && rotationGroups[index] !== undefined) {
					rotationGroups.splice(index, 1);
					if (rotationGroups.length === 0) {
						// Removing the last group keeps the button's promise
						// ("its readings leave the rotation"): back to flat
						// mode with an empty set, not a silent merge.
						rotationGroups = null;
						rotationKeys = [];
					}
					writeRotation(true);
				}
				return;
			}
			const remove = ev.target.closest(".hw-set-remove");
			if (remove) {
				// A grouped chip leaves its own group only (the editor never
				// creates overlap, but hand-edited settings may hold a reading
				// in several groups); a flat chip leaves the set entirely.
				const index = Number(remove.dataset.group);
				if (remove.dataset.group !== undefined && rotationGroups !== null && rotationGroups[index] !== undefined) {
					rotationGroups[index].keys = rotationGroups[index].keys.filter((k) => k !== remove.dataset.key);
					writeRotation(true);
				} else {
					setRotationMembership(remove.dataset.key, false);
				}
				return;
			}
			const collector = ev.target.closest(".hw-collector");
			if (collector) {
				const index = Number(collector.dataset.group);
				if (Number.isInteger(index)) collectorIndex = index;
				return;
			}
			const action = ev.target.closest("button[data-set-action]");
			if (action === null) return;
			if (action.dataset.setAction === "split") {
				// Group 1 inherits the current set; new ticks land in group 2.
				rotationGroups = [
					{ name: "", keys: [...rotationKeys] },
					{ name: "", keys: [] }
				];
				collectorIndex = 1;
				writeRotation(true);
			} else if (action.dataset.setAction === "add") {
				rotationGroups = rotationGroups ?? [{ name: "", keys: [...rotationKeys] }];
				rotationGroups.push({ name: "", keys: [] });
				collectorIndex = rotationGroups.length - 1;
				writeRotation(true);
			} else if (action.dataset.setAction === "merge") {
				rotationKeys = unionKeys(rotationGroups ?? []);
				rotationGroups = null;
				writeRotation(true);
			}
		});
		// Group names commit on change (blur or Enter); Enter blurs so the
		// deferred re-render (skipped while the field is focused) happens.
		rotationSetEl.addEventListener("change", (ev) => {
			if (!(ev.target instanceof HTMLInputElement) || !ev.target.classList.contains("hw-group-name")) return;
			const index = Number(ev.target.dataset.group);
			if (rotationGroups === null || rotationGroups[index] === undefined) return;
			rotationGroups[index].name = ev.target.value.trim();
			writeRotation(true);
		});
		rotationSetEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-group-name")) {
				ev.target.blur();
				renderRotationSet();
			}
		});
		rotationBinding[0]().then((value) => {
			rotationKeys = Array.isArray(value) ? value.filter((k) => typeof k === "string") : [];
			renderRotationSet();
		});
		groupsBinding[0]().then((value) => {
			rotationGroups = parseGroupsSetting(value);
			clampCollector();
			renderRotationSet();
		});
	}
	requestTree();
})();
