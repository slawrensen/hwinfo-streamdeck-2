/**
 * Native integration suite for the hwsm addon (Windows-only; skipped
 * cleanly elsewhere). Exercises the real binaries in
 * native/hwsm/build/Release against real Win32 named objects created by
 * scripts/native-test-producer.mjs: lifecycle, exact source bounds, every
 * mutex wait result, registry behavior, the JavaScript/native contract,
 * resource hygiene, and loaded-file replacement.
 *
 * The release addon (hwsm.node) is used everywhere except the controlled
 * WAIT_FAILED / ReleaseMutex-failure cases, which need the fault hooks that
 * only the hwsm_test target compiles in (and whose absence from the release
 * binary is itself asserted here).
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { bridgeProtocolFailure, type HwsmBridge, type HwsmGadgetKey, type HwsmNativeError, type HwsmSharedMemorySession } from "../src/hwinfo/hwsm-loader";

const onWindows = process.platform === "win32" && process.arch === "x64";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseAddonPath = path.join(repoRoot, "native", "hwsm", "build", "Release", "hwsm.node");
const testAddonPath = path.join(repoRoot, "native", "hwsm", "build", "Release", "hwsm_test.node");
const producerPath = path.join(repoRoot, "scripts", "native-test-producer.mjs");

interface TestSession extends HwsmSharedMemorySession {
	_testControl?(mode: string): void;
}
interface TestBridge extends HwsmBridge {
	openSharedMemory(mappingName: string, mutexName: string): TestSession;
}

const require = createRequire(import.meta.url);
const bridge: TestBridge | null = onWindows ? (require(releaseAddonPath) as TestBridge) : null;
const testBridge: TestBridge | null = onWindows ? (require(testAddonPath) as TestBridge) : null;

/** Fixed header field offsets (mirrors src/hwinfo/layout.ts). */
const MAGIC_ACTIVE = 0x53695748;
const MAGIC_DEAD = 0x44414544;
const HEADER_SIZE = 44;
const SENSOR_STRIDE = 264;
const ENTRY_STRIDE = 316;

interface HeaderSpec {
	magic?: number;
	sensorOffset?: number;
	sensorStride?: number;
	sensorCount?: number;
	entryOffset?: number;
	entryStride?: number;
	entryCount?: number;
}

/** 44-byte header; defaults describe 1 sensor + 2 entries => 940 bytes. */
function composeHeader(spec: HeaderSpec = {}): Buffer {
	const b = Buffer.alloc(HEADER_SIZE);
	b.writeUInt32LE(spec.magic ?? MAGIC_ACTIVE, 0);
	b.writeUInt32LE(1, 4); // version
	b.writeUInt32LE(0, 8); // revision
	b.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 12);
	b.writeUInt32LE(spec.sensorOffset ?? HEADER_SIZE, 20);
	b.writeUInt32LE(spec.sensorStride ?? SENSOR_STRIDE, 24);
	b.writeUInt32LE(spec.sensorCount ?? 1, 28);
	b.writeUInt32LE(spec.entryOffset ?? HEADER_SIZE + SENSOR_STRIDE, 32);
	b.writeUInt32LE(spec.entryStride ?? ENTRY_STRIDE, 36);
	b.writeUInt32LE(spec.entryCount ?? 2, 40);
	return b;
}
const DEFAULT_REQUIRED = HEADER_SIZE + SENSOR_STRIDE + 2 * ENTRY_STRIDE; // 940

let nameCounter = 0;
function freshNames(): { mapping: string; mutex: string } {
	nameCounter++;
	return {
		mapping: `Local\\HwsmNT_${process.pid}_${nameCounter}`,
		mutex: `Local\\HwsmNT_${process.pid}_${nameCounter}_MUTEX`
	};
}

interface ProducerReply {
	ok: boolean;
	error?: string;
	wait?: number;
	ready?: boolean;
}

class Producer {
	private readonly waiters: ((reply: ProducerReply) => void)[] = [];
	private constructor(readonly child: ChildProcess) {}

	static async spawn(): Promise<Producer> {
		const child = spawn(process.execPath, [producerPath], { stdio: ["pipe", "pipe", "inherit"] });
		const producer = new Producer(child);
		let acc = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			acc += chunk;
			let nl;
			while ((nl = acc.indexOf("\n")) >= 0) {
				const line = acc.slice(0, nl).trim();
				acc = acc.slice(nl + 1);
				if (line.length > 0) {
					producer.waiters.shift()?.(JSON.parse(line) as ProducerReply);
				}
			}
		});
		const ready = await producer.expectReply(5000);
		assert.equal(ready.ok, true, "producer failed to start");
		return producer;
	}

	private expectReply(timeoutMs: number): Promise<ProducerReply> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("producer reply timeout")), timeoutMs);
			this.waiters.push((reply) => {
				clearTimeout(timer);
				resolve(reply);
			});
		});
	}

	async send(cmd: Record<string, unknown>): Promise<ProducerReply> {
		this.child.stdin?.write(JSON.stringify(cmd) + "\n");
		const reply = await this.expectReply(10_000);
		assert.equal(reply.ok, true, `producer ${String(cmd.cmd)} failed: ${reply.error ?? ""}`);
		return reply;
	}

	/** For commands EXPECTED to fail. */
	async sendRaw(cmd: Record<string, unknown>): Promise<ProducerReply> {
		this.child.stdin?.write(JSON.stringify(cmd) + "\n");
		return this.expectReply(10_000);
	}

	kill(): void {
		this.child.kill();
	}

	async exit(): Promise<void> {
		try {
			await this.send({ cmd: "exit" });
		} catch {
			this.child.kill();
		}
	}
}

const producers: Producer[] = [];
async function producerWith(spec: HeaderSpec | null, opts: { size?: number; mutex?: boolean; denyMapping?: boolean; denyMutex?: boolean } = {}): Promise<{ p: Producer; mapping: string; mutex: string }> {
	const { mapping, mutex } = freshNames();
	const p = await Producer.spawn();
	producers.push(p);
	await p.send({ cmd: "create", size: opts.size ?? 4096, mapping, mutex: opts.mutex === false ? undefined : mutex, denyMapping: opts.denyMapping, denyMutex: opts.denyMutex });
	if (spec !== null) {
		await p.send({ cmd: "write", offset: 0, dataBase64: composeHeader(spec).toString("base64") });
	}
	return { p, mapping, mutex };
}

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (err) {
		return (err as HwsmNativeError).code ?? `<no code: ${(err as Error).message}>`;
	}
	return "<no throw>";
}

after(async () => {
	for (const p of producers) {
		await p.exit().catch(() => p.kill());
	}
});

describe("hwsm native suite", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	const b = bridge as TestBridge;
	const tb = testBridge as TestBridge;

	describe("A. normal shared-memory lifecycle", () => {
		test("open, byteLength, repeated reads, idempotent close, read-after-close", async () => {
			const { p, mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			assert.equal(s.byteLength, DEFAULT_REQUIRED);

			const dest = Buffer.alloc(s.byteLength);
			for (let i = 0; i < 5; i++) {
				const n = s.readInto(dest);
				assert.equal(n, DEFAULT_REQUIRED);
			}
			assert.equal(dest.readUInt32LE(0), MAGIC_ACTIVE);
			assert.equal(dest.readUInt32LE(28), 1); // sensor count
			assert.equal(dest.readUInt32LE(40), 2); // entry count

			// Copied contents match what the producer wrote beyond the header.
			const marker = Buffer.from("HELLO-SENSOR");
			await p.send({ cmd: "write", offset: 100, dataBase64: marker.toString("base64") });
			assert.equal(s.readInto(dest), DEFAULT_REQUIRED);
			assert.equal(dest.subarray(100, 100 + marker.length).toString(), "HELLO-SENSOR");

			s.close();
			s.close(); // idempotent
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_SESSION_CLOSED");
		});
	});

	describe("B. mapping and mutex startup states", () => {
		test("mapping absent -> HWSM_NOT_FOUND", () => {
			assert.equal(codeOf(() => b.openSharedMemory(`Local\\HwsmNT_absent_${process.pid}`, `Local\\HwsmNT_absent_${process.pid}_M`)), "HWSM_NOT_FOUND");
		});
		test("mapping present, mutex absent -> HWSM_MUTEX_NOT_FOUND (no unguarded read)", async () => {
			const { mapping, mutex } = await producerWith({}, { mutex: false });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_MUTEX_NOT_FOUND");
		});
		test("mutex exists, mapping absent -> HWSM_NOT_FOUND", async () => {
			const { mutex } = await producerWith({}, {});
			assert.equal(codeOf(() => b.openSharedMemory(`Local\\HwsmNT_gone_${process.pid}`, mutex)), "HWSM_NOT_FOUND");
		});
		test("mapping access denied -> HWSM_ACCESS_DENIED", async () => {
			const { mapping, mutex } = await producerWith({}, { denyMapping: true });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_ACCESS_DENIED");
		});
		test("mapping readable, mutex denied -> HWSM_ACCESS_DENIED", async () => {
			const { mapping, mutex } = await producerWith({}, { denyMutex: true });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_ACCESS_DENIED");
		});
	});

	describe("C. exact source bounds", () => {
		test("sub-page mapping with unwritten (zero) header -> HWSM_INVALID_LAYOUT", async () => {
			// Windows rounds sections up to page granularity, so a 16-byte
			// section still maps 44 header bytes; the zero garbage inside is
			// what gets rejected. Genuinely-too-small sections are caught the
			// moment the claim exceeds the page-rounded size (next test).
			const { mapping, mutex } = await producerWith(null, { size: 16 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("44-byte section whose header claims past the page -> HWSM_MAP_FAILED", async () => {
			const { p, mapping, mutex } = await producerWith(null, { size: HEADER_SIZE });
			// 44 + 264 + 25*316 = 8208 bytes claimed vs one 4096-byte page.
			await p.send({ cmd: "write", offset: 0, dataBase64: composeHeader({ entryCount: 25 }).toString("base64") });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_MAP_FAILED");
		});
		test("mapping smaller than the claimed complete layout -> HWSM_MAP_FAILED", async () => {
			const { mapping, mutex } = await producerWith({ entryCount: 100 }, { size: 4096 }); // claims 44+264+31600
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_MAP_FAILED");
		});
		test("region above the 64 MiB bound -> HWSM_INVALID_LAYOUT", async () => {
			const { mapping, mutex } = await producerWith({ entryStride: 0xffff, entryCount: 99_999 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("checked multiplication rejects huge sensor section", async () => {
			const { mapping, mutex } = await producerWith({ sensorStride: 0xffffffff, sensorCount: 100_000 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("checked addition rejects offset+size past the bound", async () => {
			const { mapping, mutex } = await producerWith({ entryOffset: 0xffffff00, entryStride: ENTRY_STRIDE, entryCount: 1 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("section offset inside the header -> HWSM_INVALID_LAYOUT", async () => {
			const { mapping, mutex } = await producerWith({ sensorOffset: 0 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("overlapping sections -> HWSM_INVALID_LAYOUT", async () => {
			const { mapping, mutex } = await producerWith({ entryOffset: HEADER_SIZE + 10 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("sensor stride below the classic minimum -> HWSM_INVALID_LAYOUT", async () => {
			const { mapping, mutex } = await producerWith({ sensorStride: 100 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("entry stride below the classic minimum -> HWSM_INVALID_LAYOUT", async () => {
			const { mapping, mutex } = await producerWith({ entryStride: 100 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("extreme element counts -> HWSM_INVALID_LAYOUT", async () => {
			const { mapping, mutex } = await producerWith({ entryCount: 100_001 });
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_INVALID_LAYOUT");
		});
		test("zero counts form a valid empty layout of exactly the header", async () => {
			const { mapping, mutex } = await producerWith({ sensorCount: 0, entryCount: 0 });
			const s = b.openSharedMemory(mapping, mutex);
			assert.equal(s.byteLength, HEADER_SIZE);
			const dest = Buffer.alloc(HEADER_SIZE);
			assert.equal(s.readInto(dest), HEADER_SIZE);
			s.close();
		});
		test("future-style larger strides are accepted and sized exactly", async () => {
			const { mapping, mutex } = await producerWith({ sensorStride: 400, entryStride: 500, entryOffset: HEADER_SIZE + 400 });
			const s = b.openSharedMemory(mapping, mutex);
			assert.equal(s.byteLength, HEADER_SIZE + 400 + 2 * 500);
			s.close();
		});
		test("destination one byte too small -> RangeError HWSM_BUFFER_TOO_SMALL", async () => {
			const { mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			try {
				assert.throws(
					() => s.readInto(Buffer.alloc(DEFAULT_REQUIRED - 1)),
					(err: HwsmNativeError) => err instanceof RangeError && err.code === "HWSM_BUFFER_TOO_SMALL"
				);
				// Exact size and oversize both succeed with the exact count.
				assert.equal(s.readInto(Buffer.alloc(DEFAULT_REQUIRED)), DEFAULT_REQUIRED);
				assert.equal(s.readInto(Buffer.alloc(DEFAULT_REQUIRED + 512)), DEFAULT_REQUIRED);
			} finally {
				s.close();
			}
		});
		test("wrong destination type -> TypeError; Uint8Array storage is accepted", async () => {
			const { mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			try {
				assert.throws(() => s.readInto("nope" as unknown as Buffer), TypeError);
				assert.throws(() => s.readInto({ length: 4096 } as unknown as Buffer), TypeError);
				assert.throws(() => (s.readInto as unknown as () => number)(), TypeError);
				// Buffer IS a Uint8Array in Node; any Uint8Array-backed storage
				// is a memory-safe destination and follows the same size rule.
				assert.equal(s.readInto(new Uint8Array(4096) as Buffer), DEFAULT_REQUIRED);
				assert.throws(() => s.readInto(new Uint8Array(8) as Buffer), RangeError);
			} finally {
				s.close();
			}
		});
	});

	describe("D. mutex wait semantics", () => {
		test("held mutex -> readInto returns 0, copies nothing, releases nothing", async () => {
			const { p, mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			try {
				await p.send({ cmd: "hold" });
				const dest = Buffer.alloc(s.byteLength, 0xaa);
				assert.equal(s.readInto(dest), 0);
				assert.equal(dest.every((byte) => byte === 0xaa), true, "busy read must not touch the destination");
				await p.send({ cmd: "release" });
				// The mutex is usable again: we never touched its state.
				assert.equal(s.readInto(dest), DEFAULT_REQUIRED);
			} finally {
				s.close();
			}
		});
		test("abandoned mutex -> HWSM_ABANDONED, no data, session invalidated, reopen works", async () => {
			const { p, mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			// A second process takes the mutex and dies holding it.
			const holder = await Producer.spawn();
			producers.push(holder);
			await holder.send({ cmd: "openMutex", name: mutex });
			await holder.send({ cmd: "hold" });
			holder.kill();
			await new Promise((r) => setTimeout(r, 300));

			const dest = Buffer.alloc(s.byteLength, 0xaa);
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_ABANDONED");
			assert.equal(dest.every((byte) => byte === 0xaa), true, "abandoned snapshot bytes must never be returned");
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_SESSION_INVALIDATED");
			s.close(); // close after invalidation stays safe

			// Ownership was released exactly once: a fresh session acquires the
			// same mutex immediately and reads.
			const s2 = b.openSharedMemory(mapping, mutex);
			assert.equal(s2.readInto(dest), DEFAULT_REQUIRED);
			s2.close();
			void p;
		});
		test("controlled WAIT_FAILED -> real Win32 error, session invalidated", async () => {
			const { mapping, mutex } = await producerWith({});
			const s = tb.openSharedMemory(mapping, mutex);
			s._testControl?.("failNextWait");
			const dest = Buffer.alloc(s.byteLength);
			try {
				s.readInto(dest);
				assert.fail("expected HWSM_WAIT_FAILED");
			} catch (err) {
				assert.equal((err as HwsmNativeError).code, "HWSM_WAIT_FAILED");
				assert.equal((err as HwsmNativeError).win32Error, 6); // ERROR_INVALID_HANDLE injected
			}
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_SESSION_INVALIDATED");
		});
		test("controlled ReleaseMutex failure -> HWSM_RELEASE_FAILED, no result, invalidated, mutex stays healthy", async () => {
			const { mapping, mutex } = await producerWith({});
			const s = tb.openSharedMemory(mapping, mutex);
			s._testControl?.("failNextRelease");
			const dest = Buffer.alloc(s.byteLength);
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_RELEASE_FAILED");
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_SESSION_INVALIDATED");
			// The hook released for real, so the object is not poisoned for others.
			const s2 = b.openSharedMemory(mapping, mutex);
			assert.equal(s2.readInto(dest), DEFAULT_REQUIRED);
			s2.close();
		});
	});

	describe("E. layout changes and producer lifecycle", () => {
		test("layout change after open -> HWSM_LAYOUT_CHANGED, invalidated; reopen sees the new exact size", async () => {
			const { p, mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			assert.equal(s.byteLength, DEFAULT_REQUIRED);
			await p.send({ cmd: "write", offset: 0, dataBase64: composeHeader({ entryCount: 3 }).toString("base64") });
			const dest = Buffer.alloc(8192);
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_LAYOUT_CHANGED");
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_SESSION_INVALIDATED");
			s.close();
			const s2 = b.openSharedMemory(mapping, mutex);
			assert.equal(s2.byteLength, DEFAULT_REQUIRED + ENTRY_STRIDE);
			assert.equal(s2.readInto(dest), DEFAULT_REQUIRED + ENTRY_STRIDE);
			s2.close();
		});
		test("DEAD magic mid-session -> HWSM_DISABLED; DEAD at open -> HWSM_DISABLED", async () => {
			const { p, mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			await p.send({ cmd: "write", offset: 0, dataBase64: composeHeader({ magic: MAGIC_DEAD }).toString("base64") });
			const dest = Buffer.alloc(s.byteLength);
			assert.equal(codeOf(() => s.readInto(dest)), "HWSM_DISABLED");
			s.close();
			assert.equal(codeOf(() => b.openSharedMemory(mapping, mutex)), "HWSM_DISABLED");
		});
		test("producer restart with smaller layout -> fresh session sizes exactly", async () => {
			const { p, mapping, mutex } = await producerWith({});
			const s1 = b.openSharedMemory(mapping, mutex);
			assert.equal(s1.byteLength, DEFAULT_REQUIRED);
			s1.close();
			await p.exit();
			producers.splice(producers.indexOf(p), 1);
			const again = await producerWith({ sensorCount: 0, entryCount: 1, entryOffset: HEADER_SIZE });
			const s2 = b.openSharedMemory(again.mapping, again.mutex);
			assert.equal(s2.byteLength, HEADER_SIZE + ENTRY_STRIDE);
			s2.close();
		});
		test("unknown magic mid-session -> HWSM_LAYOUT_CHANGED", async () => {
			const { p, mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			await p.send({ cmd: "write", offset: 0, dataBase64: composeHeader({ magic: 0xdeadbeef }).toString("base64") });
			assert.equal(codeOf(() => s.readInto(Buffer.alloc(s.byteLength))), "HWSM_LAYOUT_CHANGED");
			s.close();
		});
	});

	describe("F. gadget registry", () => {
		const subkey = `Software\\HwsmNT_${process.pid}`;
		const utf16 = (text: string, terminator = true) => Buffer.from(text + (terminator ? "\0" : ""), "utf16le");

		test("key absent -> HWSM_REGISTRY_NOT_FOUND", () => {
			assert.equal(codeOf(() => b.openGadgetKey(`Software\\HwsmNT_absent_${process.pid}`)), "HWSM_REGISTRY_NOT_FOUND");
		});
		test("key access denied -> HWSM_REGISTRY_ACCESS_DENIED", async () => {
			const p = await Producer.spawn();
			producers.push(p);
			const denied = `${subkey}_denied`;
			await p.send({ cmd: "regCreate", subkey: denied, deny: true });
			try {
				assert.equal(codeOf(() => b.openGadgetKey(denied)), "HWSM_REGISTRY_ACCESS_DENIED");
			} finally {
				await p.send({ cmd: "regDeleteKey", subkey: denied });
			}
		});
		test("REG_SZ variants: valid, empty, absent, terminators, embedded NUL, growth, huge, wrong type, odd bytes", async () => {
			const p = await Producer.spawn();
			producers.push(p);
			await p.send({ cmd: "regCreate", subkey });
			try {
				const REG_SZ = 1;
				const REG_DWORD = 4;
				await p.send({ cmd: "regSet", subkey, name: "Plain", type: REG_SZ, dataBase64: utf16("CPU Package").toString("base64") });
				await p.send({ cmd: "regSet", subkey, name: "Empty", type: REG_SZ, dataBase64: utf16("").toString("base64") });
				await p.send({ cmd: "regSet", subkey, name: "NoTerm", type: REG_SZ, dataBase64: utf16("no-terminator", false).toString("base64") });
				await p.send({ cmd: "regSet", subkey, name: "Embedded", type: REG_SZ, dataBase64: utf16("abc\0hidden").toString("base64") });
				await p.send({ cmd: "regSet", subkey, name: "Grown", type: REG_SZ, dataBase64: utf16("x".repeat(600)).toString("base64") });
				await p.send({ cmd: "regSet", subkey, name: "Huge", type: REG_SZ, dataBase64: utf16("y".repeat(40_000)).toString("base64") });
				await p.send({ cmd: "regSet", subkey, name: "Dword", type: REG_DWORD, dataBase64: Buffer.from([1, 0, 0, 0]).toString("base64") });
				await p.send({ cmd: "regSet", subkey, name: "OddBytes", type: REG_SZ, dataBase64: Buffer.from([0x41, 0x00, 0x42]).toString("base64") });

				const key = b.openGadgetKey(subkey);
				try {
					assert.equal(key.queryString("Plain"), "CPU Package");
					assert.equal(key.queryString("Empty"), "");
					assert.equal(key.queryString("Absent"), null);
					assert.equal(key.queryString("NoTerm"), "no-terminator");
					assert.equal(key.queryString("Embedded"), "abc");
					assert.equal(key.queryString("Grown"), "x".repeat(600)); // exceeds the initial 512-byte native buffer
					assert.equal(codeOf(() => key.queryString("Huge")), "HWSM_REGISTRY_INVALID_DATA"); // above the 64 KiB cap
					assert.equal(codeOf(() => key.queryString("Dword")), "HWSM_REGISTRY_WRONG_TYPE");
					assert.equal(codeOf(() => key.queryString("OddBytes")), "HWSM_REGISTRY_INVALID_DATA");
					assert.throws(() => key.queryString(123 as unknown as string), TypeError);
					// Reads after buffer growth keep working (buffer reuse).
					for (let i = 0; i < 50; i++) {
						assert.equal(key.queryString("Grown"), "x".repeat(600));
						assert.equal(key.queryString("Plain"), "CPU Package");
					}
				} finally {
					key.close();
					key.close(); // idempotent
					assert.equal(codeOf(() => key.queryString("Plain")), "HWSM_SESSION_CLOSED");
				}
			} finally {
				await p.send({ cmd: "regDeleteKey", subkey });
			}
		});
		test("key deleted underneath an open GadgetKey -> HWSM_REGISTRY_FAILED with ERROR_KEY_DELETED", async () => {
			const p = await Producer.spawn();
			producers.push(p);
			const doomed = `${subkey}_doomed`;
			await p.send({ cmd: "regCreate", subkey: doomed });
			await p.send({ cmd: "regSet", subkey: doomed, name: "Sensor0", type: 1, dataBase64: utf16("X").toString("base64") });
			const key = b.openGadgetKey(doomed);
			await p.send({ cmd: "regDeleteKey", subkey: doomed });
			try {
				key.queryString("Sensor0");
				assert.fail("expected ERROR_KEY_DELETED");
			} catch (err) {
				assert.equal((err as HwsmNativeError).code, "HWSM_REGISTRY_FAILED");
				assert.equal((err as HwsmNativeError).win32Error, 1018);
			} finally {
				key.close();
			}
		});
	});

	describe("G. JavaScript/native contract", () => {
		test("getBuildInfo shape, frozen, matches loader protocol", () => {
			const info = b.getBuildInfo();
			assert.equal(info.protocolVersion, 1);
			assert.equal(info.napiVersion, 8);
			assert.equal(info.architecture, "x64");
			assert.match(info.nativeVersion, /^\d+\.\d+\.\d+$/);
			assert.match(info.nativeSourceId, /^[0-9a-f]{16}$|^unset$/);
			assert.equal(Object.isFrozen(info), true);
			assert.equal(bridgeProtocolFailure(b), null);
		});
		test("receiver forgery is rejected: invented, prototype-chained, cross-type", async () => {
			const { mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			const dest = Buffer.alloc(s.byteLength);
			try {
				assert.throws(() => s.readInto.call({}, dest), TypeError);
				assert.throws(() => s.readInto.call(Object.create(s) as object, dest), TypeError);
				assert.throws(() => s.readInto.call(undefined, dest), TypeError);
				assert.throws(() => s.close.call(42 as unknown as object), TypeError);
				// A GadgetKey is not a session, even though both are wrapped.
				const p = await Producer.spawn();
				producers.push(p);
				const sub = `Software\\HwsmNT_${process.pid}_x`;
				await p.send({ cmd: "regCreate", subkey: sub });
				const key = b.openGadgetKey(sub);
				assert.throws(() => s.readInto.call(key, dest), TypeError);
				assert.throws(() => key.queryString.call(s, "Name"), TypeError);
				key.close();
				await p.send({ cmd: "regDeleteKey", subkey: sub });
			} finally {
				s.close();
			}
		});
		test("argument validation: missing, extra, wrong types, empty names", () => {
			assert.throws(() => (b.openSharedMemory as unknown as () => unknown)(), TypeError);
			assert.throws(() => b.openSharedMemory(5 as unknown as string, "m"), TypeError);
			assert.throws(() => b.openSharedMemory("", "m"), RangeError);
			assert.throws(() => b.openSharedMemory("x".repeat(600), "m"), RangeError);
			assert.throws(() => (b.openGadgetKey as unknown as () => unknown)(), TypeError);
			assert.throws(() => b.openGadgetKey(null as unknown as string), TypeError);
			assert.throws(() => b.openGadgetKey(""), RangeError);
			// Extra arguments are ignored consistently.
			assert.equal(codeOf(() => (b.openSharedMemory as unknown as (a: string, b: string, c: number) => unknown)(`Local\\HwsmNT_extra_${process.pid}`, "m", 42)), "HWSM_NOT_FOUND");
		});
		test("no BigInt or pointer-like value crosses the production interface", async () => {
			const { mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			const own = Object.getOwnPropertyNames(s);
			assert.deepEqual(own.sort(), ["byteLength", "close", "readInto"]);
			assert.equal(typeof s.byteLength, "number");
			for (const name of own) {
				assert.notEqual(typeof (s as unknown as Record<string, unknown>)[name], "bigint");
			}
			const info = b.getBuildInfo();
			for (const value of Object.values(info)) {
				assert.notEqual(typeof value, "bigint");
			}
			s.close();
		});
		test("release addon compiles no test hooks; test addon does", async () => {
			const { mapping, mutex } = await producerWith({});
			const s = b.openSharedMemory(mapping, mutex);
			assert.equal((s as TestSession)._testControl, undefined);
			s.close();
			const st = tb.openSharedMemory(mapping, mutex);
			assert.equal(typeof st._testControl, "function");
			st.close();
		});
		test("loader protocol gate fails closed on every mismatch", () => {
			const good = { getBuildInfo: () => ({ protocolVersion: 1, napiVersion: 8, architecture: "x64", nativeVersion: "1.0.0", nativeSourceId: "abc" }), openSharedMemory: () => ({}), openGadgetKey: () => ({}) };
			assert.equal(bridgeProtocolFailure(good), null);
			assert.match(bridgeProtocolFailure({}) ?? "", /missing required methods/);
			assert.match(bridgeProtocolFailure(null) ?? "", /did not export an object/);
			assert.match(bridgeProtocolFailure({ ...good, getBuildInfo: () => ({ ...good.getBuildInfo(), protocolVersion: 2 }) }) ?? "", /protocol 2 does not match/);
			assert.match(bridgeProtocolFailure({ ...good, getBuildInfo: () => ({ ...good.getBuildInfo(), napiVersion: 7 }) }) ?? "", /Node-API 7/);
			assert.match(bridgeProtocolFailure({ ...good, getBuildInfo: () => ({ ...good.getBuildInfo(), architecture: "arm64" }) }) ?? "", /architecture arm64/);
			assert.match(bridgeProtocolFailure({ ...good, getBuildInfo: () => { throw new Error("boom"); } }) ?? "", /threw/);
			assert.match(bridgeProtocolFailure(good, "7") ?? "", /below the required 8/);
			assert.match(bridgeProtocolFailure(good, "") ?? "", /below the required 8/);
		});
	});

	describe("H. resource hygiene", () => {
		test("10,000 read soak + 2,000 open/close cycles: no handle or RSS growth", async () => {
			const { mapping, mutex } = await producerWith({});
			const handleCount = () => {
				const out = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${process.pid}).HandleCount`], { encoding: "utf8" });
				return Number(out.stdout.trim());
			};

			const warm = b.openSharedMemory(mapping, mutex);
			const dest = Buffer.alloc(warm.byteLength);
			for (let i = 0; i < 100; i++) warm.readInto(dest); // warm-up before baselining
			const handlesBefore = handleCount();
			const rssBefore = process.memoryUsage().rss;

			for (let i = 0; i < 10_000; i++) {
				assert.equal(warm.readInto(dest), DEFAULT_REQUIRED);
			}
			warm.close();
			for (let i = 0; i < 2_000; i++) {
				const s = b.openSharedMemory(mapping, mutex);
				s.readInto(dest);
				s.close();
			}
			const handlesAfter = handleCount();
			const rssAfter = process.memoryUsage().rss;
			assert.ok(handlesAfter <= handlesBefore + 24, `handle growth: ${handlesBefore} -> ${handlesAfter}`);
			assert.ok(rssAfter - rssBefore < 32 * 1024 * 1024, `RSS growth: ${((rssAfter - rssBefore) / 1048576).toFixed(1)} MB`);
		});
		test("finalizer-only cleanup, close+finalize, and env teardown stay safe (child with --expose-gc)", async () => {
			const { mapping, mutex } = await producerWith({});
			const script = `
				const b = require(${JSON.stringify(releaseAddonPath)});
				const dest = Buffer.alloc(65536);
				for (let i = 0; i < 500; i++) {
					const s = b.openSharedMemory(${JSON.stringify(mapping)}, ${JSON.stringify(mutex)});
					s.readInto(dest);
					if (i % 2 === 0) s.close(); // half closed, half left to the finalizer
				}
				globalThis.gc();
				const open = b.openSharedMemory(${JSON.stringify(mapping)}, ${JSON.stringify(mutex)});
				open.readInto(dest); // leaked deliberately: env teardown must clean it
				console.log("CHILD-OK");
			`;
			const result = spawnSync(process.execPath, ["--expose-gc", "-e", script], { encoding: "utf8", timeout: 30_000 });
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /CHILD-OK/);
		});
	});

	describe("I. loaded-file locking", () => {
		test("replacement of a loaded hwsm.node fails cleanly and succeeds after unload", async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwsm-lock-"));
			const dest = path.join(dir, "hwsm.node");
			fs.copyFileSync(releaseAddonPath, dest);
			const originalHash = createHash("sha256").update(fs.readFileSync(dest)).digest("hex");

			const child = spawn(process.execPath, ["-e", `require(${JSON.stringify(dest)}); console.log("LOADED"); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
			await new Promise<void>((resolve, reject) => {
				child.stdout.on("data", (d: Buffer) => { if (d.toString().includes("LOADED")) resolve(); });
				setTimeout(() => reject(new Error("child load timeout")), 10_000);
			});

			// Stage different bytes, attempt the same swap copy-hwsm.mjs performs.
			const staging = path.join(dir, `hwsm.node.staging-${process.pid}`);
			fs.copyFileSync(testAddonPath, staging);
			assert.throws(() => fs.renameSync(staging, dest), "replacing a loaded addon must fail");
			fs.rmSync(staging, { force: true });
			const afterFail = createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
			assert.equal(afterFail, originalHash, "failed replacement must leave the original byte-identical");
			assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(".staging-")), [], "no staging leftovers");

			child.kill();
			await new Promise((r) => setTimeout(r, 500));
			fs.copyFileSync(testAddonPath, staging);
			fs.renameSync(staging, dest);
			const afterSwap = createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
			assert.equal(afterSwap, createHash("sha256").update(fs.readFileSync(testAddonPath)).digest("hex"), "post-unload replacement installs the new bytes");
			fs.rmSync(dir, { recursive: true, force: true });
		});
	});
});

describe("gadget key close-vs-provider parity", { skip: !onWindows ? "win32-x64 only" : false }, () => {
	test("openGadgetKey exposes exactly queryString and close", async () => {
		const p = await Producer.spawn();
		producers.push(p);
		const sub = `Software\\HwsmNT_${process.pid}_shape`;
		await p.send({ cmd: "regCreate", subkey: sub });
		const key: HwsmGadgetKey = (bridge as TestBridge).openGadgetKey(sub);
		assert.deepEqual(Object.getOwnPropertyNames(key).sort(), ["close", "queryString"]);
		key.close();
		await p.send({ cmd: "regDeleteKey", subkey: sub });
	});
});
