/**
 * Release copy + packaging validator. Part of `npm run release:validate`.
 *
 * Checks the things a human forgets at 11pm before a Marketplace upload:
 * banned copy patterns in user-facing text, manifest sanity, asset presence
 * and dimensions, version agreement across the repo. Read-only; exits 1 on
 * any failure with a file:line list. See docs/release/COPY_RULES.md for the
 * writing rules this enforces.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SD = "com.lawrensen.hwinfo.sdPlugin";

const failures = [];
const warnings = [];
let checkedFiles = 0;
const fail = (file, line, msg) => failures.push(`${file}${line ? `:${line}` : ""}  ${msg}`);
const warn = (file, msg) => warnings.push(`${file}  ${msg}`);

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

function mdFilesUnder(rel) {
	const out = [];
	for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
		const p = join(rel, entry.name);
		if (entry.isDirectory()) out.push(...mdFilesUnder(p));
		else if (entry.name.endsWith(".md")) out.push(p);
	}
	return out;
}

// ---------------------------------------------------------------------------
// 1. Copy rules: no em dash, no slop phrases, in everything a user can read.
// ---------------------------------------------------------------------------

// A lone em dash rendered as a "no value yet" glyph is typography, not prose.
// Only these exact shapes are allowed; an em dash inside a sentence never is.
const GLYPH_ALLOW = [/"—"/g, /'—'/g, />—</g];

const BANNED = [
	{ re: /—/, why: "em dash (use a period, comma, colon or parentheses)" },
	{ re: /\bnot just\b/i, why: '"not just X" construction' },
	{ re: /whether you.re/i, why: '"whether you\'re"' },
	{ re: /in today.s world/i, why: '"in today\'s world"' },
	{ re: /let.s dive in/i, why: '"let\'s dive in"' },
	{ re: /\bgame-?chang/i, why: '"game-changing"' },
	{ re: /\brevolutionary\b/i, why: '"revolutionary"' },
	{ re: /\bseamless/i, why: '"seamless"' },
	{ re: /\brobust\b/i, why: '"robust"' },
	{ re: /\bcomprehensive\b/i, why: '"comprehensive"' },
	{ re: /\bempower/i, why: '"empower"' },
	{ re: /\bunlock\b/i, why: '"unlock"' },
	{ re: /\bdelve\b/i, why: '"delve"' },
	{ re: /\bleverag(e|es|ed|ing)\b/i, why: '"leverage"' },
	{ re: /\butiliz/i, why: '"utilize"' },
	{ re: /(?<![\w-])elevate\b/i, why: '"elevate" (marketing sense; "elevated"/"un-elevate" are fine)' },
	{ re: /\bstreamline\b/i, why: '"streamline"' },
	{ re: /boost your productivity/i, why: '"boost your productivity"' },
];

function checkCopy(rel, { emDashOnly = false } = {}) {
	if (!exists(rel)) return fail(rel, 0, "file missing");
	checkedFiles++;
	const lines = read(rel).split(/\r?\n/);
	lines.forEach((raw, i) => {
		let line = raw;
		for (const allow of GLYPH_ALLOW) line = line.replace(allow, "");
		const rules = emDashOnly ? BANNED.slice(0, 1) : BANNED;
		for (const { re, why } of rules) {
			if (re.test(line)) fail(rel, i + 1, why);
		}
	});
}

// COPY_RULES.md names the banned words in order to ban them; it gets the
// em-dash check only, like the runtime-string files below.
const RULES_DOC = "docs/release/COPY_RULES.md";
const PROSE_FILES = [
	"README.md",
	"AGENTS.md",
	"CHANGELOG.md",
	"MARKETPLACE.md",
	"NOTICE.md",
	"PERF.md",
	"native/hwsm/TESTING.md",
	...mdFilesUnder("docs").filter((f) => !f.replaceAll("\\", "/").endsWith(RULES_DOC.slice(5))),
	"docs/_config.yml",
	`${SD}/manifest.json`,
	`${SD}/ui/sensor-reading.html`,
	`${SD}/ui/sensor-dial.html`,
	`${SD}/ui/control.html`,
];
for (const f of PROSE_FILES) checkCopy(f);
checkCopy(RULES_DOC, { emDashOnly: true });

// Runtime strings users see on keys, dials and the settings panel. Em-dash
// check only: identifiers like unlock() would false-positive the word list.
for (const f of ["src/ui/state-screens.ts", "src/probe.ts", `${SD}/ui/pi-common.js`, `${SD}/ui/pi-control.js`]) {
	checkCopy(f, { emDashOnly: true });
}

// ---------------------------------------------------------------------------
// 2. Manifest sanity + referenced assets.
// ---------------------------------------------------------------------------

let manifest;
try {
	manifest = JSON.parse(read(`${SD}/manifest.json`));
} catch (err) {
	fail(`${SD}/manifest.json`, 0, `does not parse: ${err.message}`);
}

if (manifest) {
	if (manifest.UUID !== "com.lawrensen.hwinfo") fail(`${SD}/manifest.json`, 0, `unexpected UUID ${manifest.UUID}`);
	if (!manifest.Description || manifest.Description.length < 250) {
		fail(`${SD}/manifest.json`, 0, `Description under the 250-char Marketplace minimum (${manifest.Description?.length ?? 0})`);
	}
	const imageRef = (ref, where) => {
		const ok = [".svg", ".png", "@2x.png"].some((ext) => exists(`${SD}/${ref}${ext}`)) || exists(`${SD}/${ref}`);
		if (!ok) fail(`${SD}/manifest.json`, 0, `${where} "${ref}" resolves to no file`);
	};
	imageRef(manifest.Icon, "Icon");
	imageRef(manifest.CategoryIcon, "CategoryIcon");
	for (const action of manifest.Actions ?? []) {
		imageRef(action.Icon, `${action.UUID} Icon`);
		if (!action.UUID?.startsWith(manifest.UUID)) fail(`${SD}/manifest.json`, 0, `action UUID ${action.UUID} not under plugin UUID`);
		if (!action.Tooltip) fail(`${SD}/manifest.json`, 0, `${action.UUID} has no Tooltip`);
		if (!exists(`${SD}/${action.PropertyInspectorPath}`)) fail(`${SD}/manifest.json`, 0, `PI ${action.PropertyInspectorPath} missing`);
		for (const state of action.States ?? []) imageRef(state.Image, `${action.UUID} state Image`);
		if (action.Encoder?.layout && !exists(`${SD}/${action.Encoder.layout}`)) {
			fail(`${SD}/manifest.json`, 0, `Encoder layout ${action.Encoder.layout} missing`);
		}
	}
	if (!exists(`${SD}/${manifest.CodePath}`)) {
		warn(`${SD}/manifest.json`, `CodePath ${manifest.CodePath} missing (run \`npm run build\` before packing)`);
	}
}

// ---------------------------------------------------------------------------
// 3. Version agreement: package.json, manifest, CHANGELOG, submission log.
// ---------------------------------------------------------------------------

const pkg = JSON.parse(read("package.json"));
if (manifest && manifest.Version !== `${pkg.version}.0`) {
	fail("package.json", 0, `version ${pkg.version} does not match manifest Version ${manifest.Version}`);
}
if (manifest && !new RegExp(`^## ${manifest.Version.replaceAll(".", "\\.")}\\b`, "m").test(read("CHANGELOG.md"))) {
	fail("CHANGELOG.md", 0, `no entry for ${manifest.Version}`);
}
if (manifest && exists("MARKETPLACE.md") && !read("MARKETPLACE.md").includes(manifest.Version)) {
	warn("MARKETPLACE.md", `submission log has no row for ${manifest.Version} yet (added at pack time)`);
}

// ---------------------------------------------------------------------------
// 4. Release collateral: legal files, docs, marketing assets at portal specs.
// ---------------------------------------------------------------------------

for (const f of ["LICENSE", "NOTICE.md", "README.md", "CHANGELOG.md",
	"docs/release/RELEASE_RUNBOOK.md", "docs/release/STREAM_DECK_MARKETPLACE.md", "docs/release/COPY_RULES.md"]) {
	if (!exists(f)) fail(f, 0, "required release file missing");
}

// Trademark hygiene: public-facing copy keeps the REALiX non-affiliation line.
for (const f of ["README.md", "docs/release/STREAM_DECK_MARKETPLACE.md"]) {
	if (exists(f) && !/not affiliated/i.test(read(f))) {
		fail(f, 0, "missing the REALiX non-affiliation line");
	}
}

function pngSize(rel) {
	const buf = readFileSync(join(ROOT, rel));
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const MARKETING = [
	["marketing/app-icon-288.png", 288, 288],
	["marketing/thumbnail.png", 1920, 960],
	["marketing/shot-1-hero.png", 1920, 960],
	["marketing/shot-2-hardware.png", 1920, 960],
	["marketing/shot-3-themes.png", 1920, 960],
	["marketing/shot-4-settings.png", 1920, 960],
	["marketing/shot-5-dials.png", 1920, 960],
];
for (const [rel, w, h] of MARKETING) {
	if (!exists(rel)) { fail(rel, 0, "marketing asset missing"); continue; }
	const size = pngSize(rel);
	if (size.w !== w || size.h !== h) fail(rel, 0, `is ${size.w}x${size.h}, portal spec is ${w}x${h}`);
}

// ---------------------------------------------------------------------------
// 5. Cheap secret scan over files that ship or get pasted into the portal.
// ---------------------------------------------------------------------------

const SECRET = /(api[_-]?key|secret|token|passw(or)?d)["']?\s*[:=]\s*["'][^"']{12,}["']/i;
for (const f of PROSE_FILES) {
	if (!exists(f)) continue;
	read(f).split(/\r?\n/).forEach((line, i) => {
		if (SECRET.test(line)) fail(f, i + 1, "looks like a credential");
	});
}

// ---------------------------------------------------------------------------

for (const w of warnings) console.error(`warn  ${w}`);
if (failures.length) {
	for (const f of failures) console.error(`FAIL  ${f}`);
	console.error(`\n${failures.length} release-copy failure(s).`);
	process.exit(1);
}
console.error(`release copy OK: ${checkedFiles} files checked, ${warnings.length} warning(s).`);
