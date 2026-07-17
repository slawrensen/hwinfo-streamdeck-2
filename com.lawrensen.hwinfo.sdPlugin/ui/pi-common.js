/* Shared property-inspector logic: the searchable sensor picker(s), the live
   preview line, and the status hint. Persists selections through
   SDPIComponents.useSettings so sdpi-managed fields are never clobbered.

   Expected DOM (see sensor-reading.html / sensor-dial.html):
     #picker-search, #picker-refresh, #picker-list, #preview-value,
     #preview-stats, #status-hint, #theme-gallery
   Optional (sensor-reading.html dual and quad layouts, Display select):
     #picker2-search, #picker2-refresh, #picker2-list, #second-slot,
     #dual-rows, #display-item, #display-mode, #quad-rows, #picker3-*,
     #picker4-*, #quad-color-preset, #quad-color-1..4
   Optional (both sensor PIs, Text setting):
     #text-custom, #text-color, #deck-text-custom, #deck-text-color
   Optional (sensor-dial.html overview views):
     #overview-rows, #overview-three-rows
   Optional (sensor-dial.html single-view bar range):
     #bar-range                                                        */
/* global SDPIComponents */
(() => {
	"use strict";

	const { streamDeckClient, useSettings, useGlobalSettings } = SDPIComponents;

	const previewValueEl = document.getElementById("preview-value");
	const previewStatsEl = document.getElementById("preview-stats");
	const hintEl = document.getElementById("status-hint");
	const galleryEl = document.getElementById("theme-gallery");
	const rotationSetEl = document.getElementById("rotation-set"); // dial PI only
	const controlsCustomEl = document.getElementById("controls-custom"); // dial PI only
	const controlsZonesEl = document.getElementById("controls-zones"); // dial PI only
	const dualRowsEl = document.getElementById("dual-rows"); // reading PI only

	const MAX_ROWS = 150;
	const SENSOR_TYPE_NAMES = ["", "Temp", "Voltage", "Fan", "Current", "Power", "Clock", "Usage"];

	let tree = null; // [{ name, readings: [{ key, label, unit, value, type }] }]
	let treeFetchedOk = false; // last sensorTree arrived while HWiNFO was up
	let treeRequestPending = false;

	function requestTree() {
		treeRequestPending = true;
		streamDeckClient.send("sendToPlugin", { event: "getSensorTree" });
	}

	// All value formatting comes from the plugin (its measurement authority):
	// tree rows carry a `display` string and the preview a `display` object,
	// so the panel can never drift from what the key or dial face shows.

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

	// --- rotation set (dial PI only) -----------------------------------------
	// The readings dial rotation is limited to, ticked in the primary picker's
	// rows. Shown under the picker as one flat chips row, or split into named
	// groups (plain rotate stays inside a group, a gesture set to "Switch
	// sensor or group" jumps between them). rotationKeys is kept mirrored to
	// the union of all group keys, so set-wide consumers (stats, reset reach)
	// and older plugin versions after a rollback keep reading the flat set
	// unchanged. The plugin ignores anything under two non-empty groups; the
	// PI still renders those editing states. Declared before the pickers so
	// every reference below is initialized by the time async callbacks fire.
	let rotationKeys = [];
	let rotationGroups = null; // null = flat set; else [{ name, keys }]
	let rotationNames = {}; // per-reading display names, keyed by reading key
	let collectorIndex = 0; // which group new ticks land in (PI-local, not persisted)

	function adoptRotationKeys(value) {
		rotationKeys = Array.isArray(value) ? value.filter((k) => typeof k === "string") : [];
		renderRotationSet();
		primaryPicker.renderList();
	}

	function adoptRotationGroups(value) {
		rotationGroups = parseGroupsSetting(value);
		clampCollector();
		renderRotationSet();
		primaryPicker.renderList();
	}

	function adoptRotationNames(value) {
		rotationNames = parseNamesSetting(value);
		renderRotationSet();
	}

	const rotationBinding = rotationSetEl === null ? null : useSettings("rotationKeys", adoptRotationKeys, null);
	const groupsBinding = rotationSetEl === null ? null : useSettings("rotationGroups", adoptRotationGroups, null);
	// Per-reading names: shown on the chip, the overview rows, and as the
	// dial title while that reading is selected. Unticking a reading keeps
	// its name, so re-adding it restores the rename.
	const namesBinding = rotationSetEl === null ? null : useSettings("rotationNames", adoptRotationNames, null);

	// Settings are untyped JSON: keep non-empty string names only.
	function parseNamesSetting(value) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
		const names = {};
		for (const [key, name] of Object.entries(value)) {
			if (typeof name === "string" && name.trim() !== "") names[key] = name;
		}
		return names;
	}

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
		for (const row of primaryPicker.list.querySelectorAll(".hw-row")) {
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

	function setChip(key, groupIndex) {
		const label = readingLabelOf(key);
		const chip = document.createElement("span");
		// "current" paints the chip of the reading on the dial right now, so
		// the open panel shows where rotation (and a group jump) landed.
		chip.className = "hw-set-chip" + (tree !== null && label === null ? " missing" : "") + (key === primaryPicker.selectedKey() ? " current" : "");
		chip.dataset.key = key;
		const name = document.createElement("span");
		name.className = "hw-set-name";
		name.textContent = rotationNames[key] ?? label ?? key;
		name.title = "Click to rename how this reading shows on the dial";
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
		// Keep the flat-mode sentence order in sync with the static fallback
		// in sensor-dial.html (empty-set default leads).
		help.textContent =
			rotationGroups === null
				? "Leave the set empty to rotate through every reading of the picked sensor. Tick readings in the sensor list above to limit rotation to just those."
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

	// --- sensor pickers -------------------------------------------------------
	// One factory, one instance per search box. The tree is shared; rotation
	// ticks exist only on the dial PI's primary picker. Each picker owns its
	// open/typed state so the reading PI's two pickers never fight.
	const pickers = [];

	function createPicker(config) {
		const searchEl = config.search;
		const listEl = config.list;
		let selectedKey = "";
		let listOpen = false;
		// True only after a real keystroke in the search box; cleared whenever
		// the box is programmatically rewritten. The old proxy (box text
		// differs from the selection display) misfired when rotation moved the
		// selection under a focused box: the stale display text filtered the
		// list to nothing.
		let searchTyped = false;

		// Immediate (non-debounced) persistence; third arg null disables debounce.
		const [getKey, setKey] = useSettings(
			config.setting,
			(value) => {
				selectedKey = typeof value === "string" ? value : "";
				showSelection();
				renderList();
				config.onSelectionEcho?.(); // chip highlight follows the move
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
					if (config.withTicks) {
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
					val.textContent = `${reading.display ?? ""}${typeName ? " · " + typeName : ""}`;
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

		function selectRow(row) {
			if (!row || !row.dataset.key) return;
			selectedKey = row.dataset.key;
			setKey(selectedKey);
			closeList();
			config.onSelectionEcho?.(); // own writes are not echoed back
		}

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

		if (config.withTicks) {
			// The checkbox's own activation already flipped it; adopt its new state.
			listEl.addEventListener("click", (ev) => {
				if (!ev.target.classList.contains("hw-tick")) return;
				const row = ev.target.closest(".hw-row");
				setRotationMembership(row?.dataset.key, ev.target.checked);
			});
		}

		if (config.refresh) {
			config.refresh.addEventListener("click", () => {
				tree = null;
				renderList();
				requestTree();
			});
		}

		const picker = {
			root: searchEl.closest(".hw-picker"),
			list: listEl,
			isOpen: () => listOpen,
			close: closeList,
			selectedKey: () => selectedKey,
			renderList,
			/** Refresh after the shared tree changed (labels resolve, rows fill). */
			onTree: () => {
				showSelection();
				renderList();
			},
			/** Pull the initial value (useSettings callbacks fire on echoes only). */
			init: () =>
				getKey().then((value) => {
					selectedKey = typeof value === "string" ? value : "";
					showSelection();
					config.onSelectionEcho?.(); // the set may render before the key arrives
				})
		};
		pickers.push(picker);
		return picker;
	}

	const primaryPicker = createPicker({
		search: document.getElementById("picker-search"),
		refresh: document.getElementById("picker-refresh"),
		list: document.getElementById("picker-list"),
		setting: "readingKey",
		withTicks: rotationSetEl !== null,
		onSelectionEcho: renderRotationSet
	});

	// The extra-slot pickers (reading PI only in the markup): slot 2 serves
	// the dual AND quad layouts, slots 3 and 4 are quad-only.
	const extraPicker = (n, setting) => {
		const searchEl = document.getElementById(`picker${n}-search`);
		return searchEl === null
			? null
			: createPicker({
					search: searchEl,
					refresh: document.getElementById(`picker${n}-refresh`),
					list: document.getElementById(`picker${n}-list`),
					setting
				});
	};
	const secondaryPicker = extraPicker(2, "secondaryReadingKey");
	const quadPicker3 = extraPicker(3, "quadReadingKey3");
	const quadPicker4 = extraPicker(4, "quadReadingKey4");

	document.addEventListener("mousedown", (ev) => {
		// composedPath, not target.closest: toggling a rotation tick re-renders
		// the rows mid-bubble, detaching ev.target; closest() on a detached node
		// would misread the click as outside the picker and close the list.
		// Checked per picker so opening one never strands the other open.
		const path = ev.composedPath();
		for (const picker of pickers) {
			if (picker.isOpen() && !path.includes(picker.root)) picker.close();
		}
	});

	function setHint(text) {
		hintEl.hidden = !text;
		hintEl.textContent = text || "";
	}

	function renderPreview(p) {
		const live = previewValueEl.closest(".hw-preview-live");
		if (p.display) {
			// Plugin-formatted and plugin-colored: the same measurement text and
			// resolved theme/Text colors the face itself renders with.
			previewValueEl.textContent = `${p.display.value} ${p.display.unit}`.trim();
			previewStatsEl.textContent = p.display.stats;
			previewValueEl.style.color = p.display.valueColor;
			previewStatsEl.style.color = p.display.statsColor;
			if (live !== null) {
				live.classList.add("themed");
				live.style.background = p.display.bg;
			}
		} else {
			previewValueEl.style.color = "";
			previewStatsEl.style.color = "";
			if (live !== null) {
				live.classList.remove("themed");
				live.style.background = "";
			}
			if (p.missing) {
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
		// The stats line clips to one line (pi.css); the title carries the full text.
		previewStatsEl.title = previewStatsEl.textContent;
	}

	// The sdpi store notifies subscribers on didReceiveSettings only, and the
	// app does NOT echo a PI's own setSettings back to it, so picking a value
	// in this very panel never fires the subscription. Poll the LOCAL settings
	// cache (no round trip) so dependent rows follow while the panel is open.
	const followSetting = (setting, apply) => {
		const [get] = useSettings(setting, apply, null);
		get().then(apply);
		setInterval(() => get().then(apply), 400);
	};

	// Control preset (dial PI only): the custom gesture rows only exist for
	// "custom", the touch-zone picker for anything beyond legacy.
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
		followSetting("controlPreset", applyPreset);
	}

	// Key layout (reading PI only): the second-slot rows serve every multi
	// layout (slots 1 and 2 ARE the single/dual fields, so switching layouts
	// keeps both sensors), the "Second shows" pin is dual-only, the third
	// slot serves "triple" and "quad" (the triple's third row IS quad slot
	// 3), the quad rows (slot 4, cell colors, micro-labels) are quad-only,
	// and the Display row hides on every multi layout (their faces have no
	// sparkline/bar/ring strip). All of this is visibility only: no setting
	// is ever written by a layout change.
	if (dualRowsEl !== null) {
		const secondSlotEl = document.getElementById("second-slot");
		const thirdSlotEl = document.getElementById("third-slot");
		const tripleHelpEl = document.getElementById("triple-help");
		const thirdLabelEl = document.getElementById("third-label");
		const quadRowsEl = document.getElementById("quad-rows");
		const displayItemEl = document.getElementById("display-item");
		// quadLabel3 doubles as the triple's third-row label: full length
		// there, first 4 characters in the quad grid. Swap the placeholder
		// with the mode (display only, never a settings write). The sdpi
		// textfield can't be driven through its own placeholder property
		// (it wants a localized-message object; a plain string throws inside
		// its update cycle and wedges the whole panel) and its attribute
		// observer never repaints a changed value, so write the rendered
		// input directly; the 400 ms layout poll re-asserts it if the
		// component re-renders over it. The host attribute is kept in sync
		// so the markup stays truthful.
		const thirdLabelHint = (quad) => {
			if (thirdLabelEl === null) return;
			const hint = quad ? "Short name; 4 characters show" : "Custom label (default: sensor name)";
			if (thirdLabelEl.getAttribute("placeholder") !== hint) thirdLabelEl.setAttribute("placeholder", hint);
			const input = (thirdLabelEl.shadowRoot ?? thirdLabelEl).querySelector("input");
			if (input !== null && input.placeholder !== hint) input.placeholder = hint;
		};
		const applyLayout = (value) => {
			const dual = value === "dual";
			const triple = value === "triple";
			const quad = value === "quad";
			if (secondSlotEl !== null) secondSlotEl.hidden = !dual && !triple && !quad;
			dualRowsEl.hidden = !dual;
			if (thirdSlotEl !== null) thirdSlotEl.hidden = !triple && !quad;
			if (tripleHelpEl !== null) tripleHelpEl.hidden = !triple;
			if (quadRowsEl !== null) quadRowsEl.hidden = !quad;
			if (displayItemEl !== null) displayItemEl.hidden = dual || triple || quad;
			thirdLabelHint(quad);
		};
		followSetting("keyLayout", applyLayout);
	}

	// Display select (reading PI only): one control for the single layout's
	// extra strip. It shows the EFFECTIVE mode (a valid displayMode wins,
	// else the legacy sparkline checkbox's state), and any change writes only
	// displayMode, so pre-Display profiles are never rewritten on read.
	const displayModeEl = document.getElementById("display-mode");
	if (displayModeEl !== null) {
		const [getDisplayMode, setDisplayMode] = useSettings("displayMode", () => {}, null);
		const [getSparkline] = useSettings("sparkline", () => {}, null);
		// Assign only on a real change: rewriting a select's value can dismiss
		// its open popup in this webview.
		const show = (mode) => {
			if (displayModeEl.value !== mode) displayModeEl.value = mode;
		};
		const showDisplayMode = () => {
			getDisplayMode().then((mode) => {
				if (mode === "sparkline" || mode === "bar" || mode === "ring" || mode === "none") {
					show(mode);
					return;
				}
				getSparkline().then((sparkline) => {
					show(sparkline === true ? "sparkline" : "none");
				});
			});
		};
		displayModeEl.addEventListener("change", () => {
			setDisplayMode(displayModeEl.value);
		});
		showDisplayMode();
		setInterval(showDisplayMode, 400);
	}

	// Dial view (dial PI only): the overview rows serve both multi-row
	// views; the Context line and Separators selects are three-row only.
	// The bar-range section hides on the multi-row views. Hide-on-match
	// polarity on purpose: an unset dialView (legacy single) stays visible;
	// a `!== "single"` check would hide it for every legacy profile.
	const overviewRowsEl = document.getElementById("overview-rows");
	if (overviewRowsEl !== null) {
		const overviewThreeEl = document.getElementById("overview-three-rows");
		const barRangeEl = document.getElementById("bar-range");
		const applyView = (value) => {
			overviewRowsEl.hidden = value !== "overview" && value !== "tworow";
			if (overviewThreeEl !== null) overviewThreeEl.hidden = value !== "overview";
			if (barRangeEl !== null) barRangeEl.hidden = value === "tworow" || value === "overview";
		};
		followSetting("dialView", applyView);
	}

	// Quad cell colors (reading PI only): one preset select plus four
	// per-cell wells, all writing the single quadColors setting. The plugin
	// salvages per entry, so a bad hex costs exactly that cell; the select
	// snaps to "Custom" whenever the wells match no preset.
	const quadPresetEl = document.getElementById("quad-color-preset");
	if (quadPresetEl !== null) {
		// Mirrors QUAD_DEFAULT_COLORS in src/ui/key-renderer.ts.
		const QUAD_DEFAULTS = ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"];
		const QUAD_PRESETS = {
			signal: QUAD_DEFAULTS,
			pairs: ["#4CC2FF", "#4CC2FF", "#FF7E8E", "#FF7E8E"],
			uniform: ["#4CC2FF", "#4CC2FF", "#4CC2FF", "#4CC2FF"]
		};
		const QUAD_HEX = /^#[0-9A-Fa-f]{6}$/;
		const cellInputs = [1, 2, 3, 4].map((n) => document.getElementById(`quad-color-${n}`));
		let quadColors = [...QUAD_DEFAULTS];
		const adoptQuadColors = (value) => {
			const raw = Array.isArray(value) ? value : [];
			quadColors = QUAD_DEFAULTS.map((fallback, i) => (typeof raw[i] === "string" && QUAD_HEX.test(raw[i]) ? raw[i] : fallback));
		};
		const showQuadColors = () => {
			cellInputs.forEach((input, i) => {
				if (input !== null) input.value = quadColors[i].toLowerCase();
			});
			const match = Object.keys(QUAD_PRESETS).find((name) => QUAD_PRESETS[name].every((c, i) => c.toLowerCase() === quadColors[i].toLowerCase()));
			quadPresetEl.value = match ?? "custom";
		};
		const applyQuadColors = (value) => {
			adoptQuadColors(value);
			showQuadColors();
		};
		const [getQuadColors, writeQuadColors] = useSettings("quadColors", applyQuadColors, null);
		quadPresetEl.addEventListener("change", () => {
			const preset = QUAD_PRESETS[quadPresetEl.value];
			if (preset === undefined) return; // "Custom" is a display state, not a preset
			quadColors = [...preset];
			writeQuadColors([...quadColors]);
			showQuadColors();
		});
		cellInputs.forEach((input, i) => {
			if (input === null) return;
			// change (picker closed), not input: no write per drag frame.
			input.addEventListener("change", () => {
				quadColors[i] = input.value;
				writeQuadColors([...quadColors]);
				showQuadColors();
			});
		});
		getQuadColors().then(applyQuadColors);
	}

	// --- theme preset gallery -------------------------------------------------
	// Tokens come from the plugin (parsed themes.json) over the message channel;
	// the deck-wide default renders as the leading "Deck default" chip and the
	// seven presets follow. Clicking writes the per-key "theme" setting ("" =
	// follow deck default); the key/dial re-renders immediately: live preview.

	let themesConfig = null; // { defaultTheme, effectiveDeckTheme, themes: { id: { bg, ... } } }
	let themeOverride = "";

	const setThemeOverride = useSettings(
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
		if (themesConfig === null) return;
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
			// The deck row lives under a different fold per PI; keep the static
			// HTML fallbacks in both PIs in sync with these two strings.
			const isDial = document.title.includes("Dial");
			help.textContent = "Pick a preset for this " + (isDial ? "dial" : "key") + " only, or the dashed “Deck default” chip (currently " + deckDisplay + ") to follow the deck-wide theme set under " + (isDial ? "Dial gestures & advanced" : "Advanced") + ".";
		}
		for (const [id, palette] of Object.entries(themesConfig.themes)) {
			frag.appendChild(themeChip(id, palette, id.charAt(0).toUpperCase() + id.slice(1), themeOverride === id));
		}
		galleryEl.replaceChildren(frag);
	}

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

	// --- Text setting (issue #2) ----------------------------------------------
	// The Text selects are sdpi-managed; this block reveals the conditional
	// Custom rows (color well + dim checkbox) for the local and the deck-wide
	// scope, and binds the color wells. Wells write only on change, so absent
	// settings stay absent; an unset well shows the resolved theme's value
	// color: the truthful "custom starts from what you see" seed.
	const TEXT_HEX = /^#[0-9A-Fa-f]{6}$/;

	function themeValueSeed() {
		if (themesConfig === null) return "#ffffff";
		const deckId = themesConfig.themes[themesConfig.effectiveDeckTheme] ? themesConfig.effectiveDeckTheme : themesConfig.defaultTheme;
		const palette = themesConfig.themes[themeOverride] ?? themesConfig.themes[deckId];
		return palette ? palette.value.toLowerCase() : "#ffffff";
	}

	function bindTextControls(customEl, colorEl, useStore) {
		if (customEl === null || colorEl === null) return;
		const [getMode] = useStore("textMode", () => {}, null);
		const [getColor, setColor] = useStore("textColor", () => {}, null);
		const refresh = () => {
			getMode().then((mode) => {
				customEl.hidden = mode !== "custom";
			});
			getColor().then((color) => {
				if (document.activeElement === colorEl) return; // picker open: don't fight it
				const shown = typeof color === "string" && TEXT_HEX.test(color) ? color.toLowerCase() : themeValueSeed();
				if (colorEl.value !== shown) colorEl.value = shown;
			});
		};
		// change (picker closed), not input: no write per drag frame.
		colorEl.addEventListener("change", () => setColor(colorEl.value));
		refresh();
		setInterval(refresh, 400);
	}

	bindTextControls(document.getElementById("text-custom"), document.getElementById("text-color"), useSettings);
	bindTextControls(document.getElementById("deck-text-custom"), document.getElementById("deck-text-color"), useGlobalSettings);

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object") return;
		if (p.event === "themes") {
			themesConfig = p;
			renderGallery();
			return;
		}
		if (p.event === "sensorTree") {
			tree = p.groups;
			treeFetchedOk = p.state === "ok";
			treeRequestPending = false;
			setHint(p.hint);
			for (const picker of pickers) picker.onTree();
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

	primaryPicker.init();
	if (secondaryPicker !== null) secondaryPicker.init();
	if (quadPicker3 !== null) quadPicker3.init();
	if (quadPicker4 !== null) quadPicker4.init();
	if (rotationBinding !== null) {
		rotationSetEl.addEventListener("click", (ev) => {
			// Chip rename: the name swaps to an inline input; commit on
			// change (Enter blurs, like group names), empty restores the
			// HWiNFO label.
			const nameEl = ev.target.closest(".hw-set-name");
			if (nameEl) {
				const key = nameEl.closest(".hw-set-chip")?.dataset.key;
				if (!key) return;
				const input = document.createElement("input");
				input.type = "text";
				input.className = "hw-group-name hw-chip-rename";
				input.value = rotationNames[key] ?? "";
				input.placeholder = readingLabelOf(key) ?? key;
				input.dataset.key = key;
				input.spellcheck = false;
				nameEl.replaceWith(input);
				input.focus();
				input.select();
				return;
			}
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
		// Group and chip names commit on change (blur or Enter); Enter blurs
		// so the deferred re-render (skipped while a field is focused) happens.
		rotationSetEl.addEventListener("change", (ev) => {
			if (!(ev.target instanceof HTMLInputElement)) return;
			if (ev.target.classList.contains("hw-chip-rename")) {
				const key = ev.target.dataset.key;
				const name = ev.target.value.trim();
				if (name === "") delete rotationNames[key];
				else rotationNames[key] = name;
				namesBinding[1]({ ...rotationNames });
				renderRotationSet();
				return;
			}
			if (!ev.target.classList.contains("hw-group-name")) return;
			const index = Number(ev.target.dataset.group);
			if (rotationGroups === null || rotationGroups[index] === undefined) return;
			rotationGroups[index].name = ev.target.value.trim();
			writeRotation(true);
		});
		// A rename abandoned unchanged (blur without an edit) fires no change
		// event; restore the chip's span once focus has left the input.
		rotationSetEl.addEventListener("focusout", (ev) => {
			if (ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-chip-rename")) {
				setTimeout(renderRotationSet, 0);
			}
		});
		rotationSetEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-group-name")) {
				ev.target.blur();
				renderRotationSet();
			}
		});
		rotationBinding[0]().then(adoptRotationKeys);
		groupsBinding[0]().then(adoptRotationGroups);
		namesBinding[0]().then(adoptRotationNames);
	}
	requestTree();
})();
