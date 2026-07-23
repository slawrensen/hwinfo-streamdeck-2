/**
 * Pack-time version floor. Part of `npm run pack`.
 *
 * Stream Deck installs a .streamDeckPlugin over an existing copy only when
 * the incoming version is strictly higher, so a pack whose version does not
 * clear the newest released tag looks like it installs and silently changes
 * nothing. The first 1.4 preview shipped as 1.3.0.0 and did exactly that
 * over a 1.3.0 install (issue #3); this gate makes that unrepeatable.
 *
 * Rule: manifest Version must compare strictly greater than the newest v*
 * tag, all four segments (a vX.Y.Z tag counts as X.Y.Z.0). Preview builds
 * use the 1.X.9n.0 band above the stable they branched from (runbook,
 * "Preview releases"), so the following stable upgrades every preview.
 * When no v* tags are visible (shallow CI checkout) this warns and passes;
 * the release workflow has its own manifest-matches-tag gate.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function quad(version) {
	const parts = version.replace(/^v/, "").split(".").map(Number);
	if (parts.length < 3 || parts.length > 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
	while (parts.length < 4) parts.push(0);
	return parts;
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];

const manifest = JSON.parse(readFileSync(join(ROOT, "com.lawrensen.hwinfo.sdPlugin", "manifest.json"), "utf8"));
const packed = quad(manifest.Version);
if (packed === null) {
	console.error(`verify-pack-version: manifest Version "${manifest.Version}" is not X.Y.Z.W`);
	process.exit(1);
}

const tags = execSync('git tag --list "v*"', { cwd: ROOT, encoding: "utf8" })
	.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
const released = tags.map(quad).filter((q) => q !== null).sort(compare);
if (released.length === 0) {
	console.error("verify-pack-version: no v* tags visible (shallow checkout?); skipping the floor check");
	process.exit(0);
}

const newest = released[released.length - 1];
if (compare(packed, newest) <= 0) {
	console.error(`verify-pack-version: manifest Version ${manifest.Version} does not clear the newest release (${newest.join(".")}).`);
	console.error("Stream Deck replaces an installed plugin only when the pack's version is higher, so this pack would install as a no-op.");
	console.error("Bump the version first: previews use the 1.X.9n.0 band, stable releases match their tag.");
	process.exit(1);
}
console.error(`verify-pack-version: ${manifest.Version} clears the newest release (${newest.join(".")})`);
