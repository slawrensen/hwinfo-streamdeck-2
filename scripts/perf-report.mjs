// One-command perf report: pack + bundle sizes (raw and gzip), per-component
// disk usage, the live plugin process (PID attributed by command line, RSS /
// private bytes / CPU), and the parse-path microbenchmark (bench-parse.ts)
// against the live HWiNFO mapping. Prints a markdown section ready to append
// to PERF.md.
//
//   node scripts/perf-report.mjs [--no-bench] [--no-proc] [--json]
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdPlugin = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const packPath = path.join(repoRoot, "release", "com.lawrensen.hwinfo.streamDeckPlugin");

const args = new Set(process.argv.slice(2));
const wantBench = !args.has("--no-bench");
const wantProc = !args.has("--no-proc");

function gzipSize(file) {
	return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

function duBytes(target) {
	const st = fs.statSync(target, { throwIfNoEntry: false });
	if (!st) {
		return 0;
	}
	if (st.isFile()) {
		return st.size;
	}
	let total = 0;
	for (const entry of fs.readdirSync(target, { recursive: true, withFileTypes: true })) {
		if (entry.isFile()) {
			total += fs.statSync(path.join(entry.parentPath ?? entry.path, entry.name)).size;
		}
	}
	return total;
}

function collectSizes() {
	const bundle = path.join(sdPlugin, "bin", "plugin.js");
	const packExists = fs.existsSync(packPath);
	return {
		packB: packExists ? fs.statSync(packPath).size : null,
		packGzipB: packExists ? gzipSize(packPath) : null,
		bundleB: duBytes(bundle),
		bundleGzipB: fs.existsSync(bundle) ? gzipSize(bundle) : null,
		components: {
			"bin/node_modules (total)": duBytes(path.join(sdPlugin, "bin", "node_modules")),
			"bin/hwsm.node": duBytes(path.join(sdPlugin, "bin", "hwsm.node")),
			"ui/": duBytes(path.join(sdPlugin, "ui")),
			"imgs/": duBytes(path.join(sdPlugin, "imgs")),
			"layouts/ + manifest + themes":
				duBytes(path.join(sdPlugin, "layouts")) + duBytes(path.join(sdPlugin, "manifest.json")) + duBytes(path.join(sdPlugin, "themes.json"))
		}
	};
}

/** The plugin's node.exe, attributed by command line — never by process name. */
function collectProc() {
	// @() + -InputObject keeps single matches as a JSON array on PowerShell 5.1.
	const ps = [
		"$procs = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
		"Where-Object { $_.CommandLine -match 'com\\.lawrensen\\.hwinfo' } |",
		"Select-Object ProcessId,WorkingSetSize,PrivatePageCount,UserModeTime,KernelModeTime,CreationDate);",
		"ConvertTo-Json -InputObject $procs -Depth 3"
	].join(" ");
	try {
		const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 30_000 });
		const rows = JSON.parse(out.trim() || "[]");
		return rows.map((r) => {
			// CIM *ModeTime are 100 ns units; CreationDate round-trips as /Date(ms)/.
			const cpuSec = (Number(r.UserModeTime) + Number(r.KernelModeTime)) / 1e7;
			const createdMs = Number(/\d+/.exec(String(r.CreationDate ?? ""))?.[0] ?? NaN);
			const uptimeMin = Number.isFinite(createdMs) ? (Date.now() - createdMs) / 60_000 : null;
			return {
				pid: r.ProcessId,
				rssMB: Number(r.WorkingSetSize) / 1048576,
				privateMB: Number(r.PrivatePageCount) / 1048576,
				cpuSec,
				uptimeMin,
				cpuPct: uptimeMin ? (cpuSec / (uptimeMin * 60)) * 100 : null
			};
		});
	} catch (err) {
		return { error: String(err) };
	}
}

async function collectBench() {
	try {
		const { stdout } = await execFileAsync(process.execPath, ["--expose-gc", "--import", "tsx", "scripts/bench-parse.ts"], {
			cwd: repoRoot,
			timeout: 180_000
		});
		const lines = stdout.trim().split("\n");
		return JSON.parse(lines[lines.length - 1]);
	} catch (err) {
		return { error: String(err) };
	}
}

const kb = (b) => (b === null || b === undefined ? "n/a" : `${(b / 1024).toFixed(1)} KB`);
const bytes = (b) => (b === null || b === undefined ? "n/a" : `${b.toLocaleString("en-US")} B`);

function renderMarkdown(report) {
	const { sizes, proc, bench } = report;
	const lines = [];
	lines.push(`### ${report.date}: ${report.label}`);
	lines.push("");
	lines.push("| Artifact | Bytes | gzip |");
	lines.push("| --- | ---: | ---: |");
	lines.push(`| .streamDeckPlugin pack | ${bytes(sizes.packB)} | ${bytes(sizes.packGzipB)} |`);
	lines.push(`| bin/plugin.js | ${bytes(sizes.bundleB)} | ${bytes(sizes.bundleGzipB)} |`);
	for (const [name, size] of Object.entries(sizes.components)) {
		lines.push(`| ${name} | ${bytes(size)} (${kb(size)}) | |`);
	}
	lines.push("");

	if (proc) {
		if (proc.error) {
			lines.push(`Process: unavailable (${proc.error})`);
		} else if (proc.length === 0) {
			lines.push("Process: plugin not running.");
		} else {
			lines.push("| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |");
			lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
			for (const p of proc) {
				lines.push(
					`| PID ${p.pid} | ${p.rssMB.toFixed(1)} MB | ${p.privateMB.toFixed(1)} MB | ${p.cpuSec.toFixed(1)} s | ${p.uptimeMin?.toFixed(0) ?? "?"} min | ${p.cpuPct?.toFixed(2) ?? "?"}% |`
				);
			}
		}
		lines.push("");
	}

	if (bench) {
		if (bench.error) {
			lines.push(`Bench: failed (${bench.error})`);
		} else {
			lines.push(`Parse bench (${bench.iters} iters, live mapping${bench.regionBytes ? `, region ${kb(bench.regionBytes)}` : ""}):`);
			lines.push("");
			lines.push("| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |");
			lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
			if (bench.readUs) {
				lines.push(`| raw copy (session.read) | ${bench.readUs.mean} | ${bench.readUs.p50} | ${bench.readUs.p95} | | |`);
			}
			for (const [name, key] of [
				["shared-memory tick", "sharedMemory"],
				["gadget tick", "gadget"]
			]) {
				const s = bench[key];
				if (s) {
					lines.push(
						`| ${name} (${s.readings} readings) | ${s.tickUs.mean} | ${s.tickUs.p50} | ${s.tickUs.p95} | ${bytes(s.allocPerTickB)} | ${bytes(s.retainedB)} |`
					);
				} else if (bench[`${key}Error`]) {
					// Plain "n/a:" joiner: this output gets pasted into PERF.md,
					// which the release-copy validator holds to the no-em-dash rule.
					lines.push(`| ${name} | n/a: ${bench[`${key}Error`]} | | | | |`);
				}
			}
		}
		lines.push("");
	}
	return lines.join("\n");
}

const report = {
	date: new Date().toISOString().slice(0, 16).replace("T", " "),
	label: [...args].filter((a) => !a.startsWith("--")).join(" ") || "snapshot",
	sizes: collectSizes(),
	proc: wantProc ? collectProc() : null,
	bench: wantBench ? await collectBench() : null
};

if (args.has("--json")) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(renderMarkdown(report));
}
