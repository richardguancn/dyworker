import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { enforceDirTotalSize, halveFileIfOversized } from "../electron/log-rotation.mjs";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dyworker-rotation-"));
}

const writeFile = async (dir, name, content, mtimeOffsetMs = 0) => {
  const file = path.join(dir, name);
  await fs.writeFile(file, content, "utf8");
  const time = new Date(Date.now() + mtimeOffsetMs);
  await fs.utimes(file, time, time);
  return file;
};

test("enforceDirTotalSize 超限后从最旧开始删除，保留 keep 名单", async () => {
  const dir = await tempDir();
  // 每个文件 10KB；mtime 从旧到新：oldest → current
  await writeFile(dir, "oldest.jsonl", "x".repeat(10 * 1024), -40_000);
  await writeFile(dir, "middle.jsonl", "x".repeat(10 * 1024), -20_000);
  const current = await writeFile(dir, "current.jsonl", "x".repeat(10 * 1024));

  await enforceDirTotalSize(dir, 25 * 1024, { keep: [current] });

  const remaining = (await fs.readdir(dir)).sort();
  assert.deepEqual(remaining, ["current.jsonl", "middle.jsonl"], "最旧的 oldest 应被清理，keep 与较新的 middle 保留");
});

test("enforceDirTotalSize 未超限时不删除任何文件", async () => {
  const dir = await tempDir();
  await writeFile(dir, "a.jsonl", "x".repeat(100));
  await writeFile(dir, "b.jsonl", "x".repeat(100));
  await enforceDirTotalSize(dir, 10 * 1024 * 1024);
  assert.equal((await fs.readdir(dir)).length, 2);
});

test("enforceDirTotalSize 目录不存在时静默返回，keep 文件永不删除", async () => {
  const dir = path.join(await tempDir(), "不存在");
  await assert.doesNotReject(() => enforceDirTotalSize(dir, 1024));

  const real = await tempDir();
  const only = await writeFile(real, "only.jsonl", "x".repeat(2048));
  await enforceDirTotalSize(real, 1024, { keep: [only] });
  assert.deepEqual(await fs.readdir(real), ["only.jsonl"]);
});

test("halveFileIfOversized 超限时截掉前半保留近期记录", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "channel-debug.log");
  const lines = Array.from({ length: 100 }, (_, index) => `[line-${index}] x`.padEnd(40)).join("\n");
  await fs.writeFile(file, lines, "utf8");
  const before = (await fs.readFile(file, "utf8")).length;

  await halveFileIfOversized(file, before - 1); // 强制超限 1 字节触发截半
  const after = await fs.readFile(file, "utf8");
  assert.ok(after.length < before, "截半后应明显变小");
  assert.ok(after.includes("[line-99]"), "最新记录必须保留");
  assert.ok(!after.includes("[line-0]"), "最旧记录应被截掉");
});

test("halveFileIfOversized 未超限或文件不存在时原样保留", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "small.log");
  await fs.writeFile(file, "hello", "utf8");
  await halveFileIfOversized(file, 1024);
  assert.equal(await fs.readFile(file, "utf8"), "hello");

  await assert.doesNotReject(() => halveFileIfOversized(path.join(dir, "缺失.log"), 1));
});
