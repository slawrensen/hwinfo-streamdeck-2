// Full-suite runner with orphan detection: snapshots node/chrome processes,
// runs every process-spawning suite (e2e ×3, contact-sheet, marketplace
// shots, pi-harness + capture-pi), snapshots again, and FAILS if any process
// spawned during the run is still alive — fake-hwinfo, plugin instances,
// headless chrome, anything. Run with `npm run suite:full`.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "hwinfo-suite-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** pid → command line for every node.exe / chrome.exe on the box. */
function processSnapshot() {
	const ps =
		"$procs = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='chrome.exe'\" | Select-Object ProcessId,CommandLine); ConvertTo-Json -InputObject $procs -Depth 2";
	const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 30_000 });
	const map = new Map();
	for (const row of JSON.parse(out.trim() || "[]")) {
		map.set(row.ProcessId, row.CommandLine ?? "");
	}
	return map;
}

function run(name, args, opts = {}) {
	console.log(`\n=== ${name} ===`);
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"], ...opts });
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with code ${code}`))));
		child.on("error", reject);
	});
}

/** pi-harness (long-running server) + capture-pi, with graceful stdin exit. */
async function runPiCapture() {
	console.log("\n=== pi-harness + capture-pi ===");
	const harness = spawn(process.execPath, ["scripts/pi-harness.mjs"], { cwd: repoRoot, stdio: ["pipe", "inherit", "inherit"] });
	const exited = new Promise((resolve) => harness.once("exit", resolve));
	try {
		let up = false;
		for (let i = 0; i < 40 && !up; i++) {
			await sleep(500);
			try {
				up = (await fetch("http://127.0.0.1:28997/ui/sensor-reading.html")).ok;
			} catch {
				/* not up yet */
			}
		}
		if (!up) {
			throw new Error("pi-harness never came up on :28997");
		}
		await run("capture-pi", ["scripts/capture-pi.mjs", path.join(outRoot, "pi")]);
	} finally {
		harness.stdin.write("exit\n");
		const code = await Promise.race([exited, sleep(5000).then(() => "timeout")]);
		if (code === "timeout") {
			console.error("pi-harness ignored stdin exit — killing (will show as orphan if children leak)");
			harness.kill();
			await Promise.race([exited, sleep(2000)]);
		}
	}
}

const before = processSnapshot();
const failures = [];
for (const dir of ["pi", "contact", "shots"]) {
	fs.mkdirSync(path.join(outRoot, dir), { recursive: true });
}

const steps = [
	["e2e", () => run("e2e", ["scripts/e2e-harness.mjs"])],
	["e2e:resilience", () => run("e2e:resilience", ["scripts/e2e-resilience.mjs"])],
	["e2e:gadget", () => run("e2e:gadget", ["scripts/e2e-gadget.mjs"])],
	["e2e:load", () => run("e2e:load", ["scripts/e2e-load.mjs"], { env: { ...process.env, LOAD_SOAK_SEC: "45" } })],
	["contact-sheet", () => run("contact-sheet", ["--import", "tsx", "scripts/contact-sheet.mjs", path.join(outRoot, "contact")])],
	["marketplace-shots", () => run("marketplace-shots", ["--import", "tsx", "scripts/marketplace-shots.mjs", path.join(outRoot, "shots")])],
	["pi-capture", runPiCapture]
];
for (const [name, step] of steps) {
	try {
		await step();
	} catch (err) {
		failures.push(`${name}: ${err.message}`);
		console.error(String(err));
	}
}

await sleep(1500); // give just-killed trees a moment to reap
const after = processSnapshot();
// Only processes WE could have spawned count as orphans — an unrelated
// desktop-Chrome renderer appearing during the window must not fail the run.
const OURS = /hwinfo-streamdeck|com\.lawrensen\.hwinfo|fake-hwinfo|pi-capture-profile|--headless/i;
const orphans = [];
const bystanders = [];
for (const [pid, cmd] of after) {
	if (!before.has(pid)) {
		(OURS.test(cmd) ? orphans : bystanders).push({ pid, cmd });
	}
}

console.log(`\n=== hygiene ===`);
console.log(`processes before: ${before.size}, after: ${after.size}, new: ${orphans.length + bystanders.length} (${orphans.length} ours, ${bystanders.length} unrelated)`);
for (const o of orphans) {
	console.error(`ORPHAN pid ${o.pid}: ${o.cmd}`);
	try {
		execFileSync("taskkill", ["/PID", String(o.pid), "/T", "/F"], { stdio: "ignore" });
	} catch {
		/* already gone */
	}
}

if (failures.length > 0 || orphans.length > 0) {
	console.error(`\nSUITE: FAILED — ${failures.length} step failure(s), ${orphans.length} orphan(s)`);
	for (const f of failures) {
		console.error(`  ${f}`);
	}
	process.exit(1);
}
console.log(`\nSUITE: ALL GREEN, ZERO ORPHANS (artifacts in ${outRoot})`);
