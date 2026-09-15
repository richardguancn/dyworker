import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCoalescedWriter } from "../electron/session-store.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Windows 磁盘（含杀毒实时扫描）写入耗时波动大，固定 sleep 后断言 written 会误报；
// 轮询等待条件成立，上限远超任何正常 I/O 延迟，且轮询本身不触发写入。
async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("等待写入完成超时");
    await sleep(10);
  }
}

// 通用合并写入器：requestSave 只保留最新快照，按间隔合并为尾沿写入。
// 回归背景：渲染端流式期间 180ms 防抖的整档保存曾把磁盘写出上百 MB/s
// （Linux 实测 194MB/s），这里锁定高频请求只产生少量写入的不变量。
async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-coalescer-"));
  return path.join(dir, "sessions.json");
}

// 用真实文件落盘做 write 回调，保证「最终内容等于最后快照」的断言真实可信
function fileWriter(file) {
  return async (value) => {
    await fs.writeFile(file, JSON.stringify(value), "utf8");
  };
}

test("高频 requestSave 合并为少量写入，最终内容等于最后快照", async () => {
  const file = await tempFile();
  const writer = createCoalescedWriter({ minIntervalMs: 300, write: fileWriter(file) });
  const archive = (marker) => [{ id: "s1", messages: [{ role: "assistant", content: marker }] }];

  for (let index = 0; index < 20; index += 1) writer.requestSave(archive(`分片-${index}`));
  await waitFor(() => writer.stats.written >= 1); // 低于合并间隔：同步突发只应产生一次立即写入
  assert.equal(writer.stats.requested, 20);
  assert.equal(writer.stats.written, 1);

  await sleep(400); // 越过合并间隔后，尾沿快照（若有积压）落盘
  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(persisted, archive("分片-19"));
  assert.ok(writer.stats.written <= 2, `写入次数应保持个位，实际 ${writer.stats.written}`);
});

test("间隔之外的保存正常落盘，不丢后续更新", async () => {
  const file = await tempFile();
  const writer = createCoalescedWriter({ minIntervalMs: 150, write: fileWriter(file) });
  const archive = (marker) => [{ id: "s1", messages: [{ role: "assistant", content: marker }] }];

  writer.requestSave(archive("第一次"));
  await waitFor(() => writer.stats.written >= 1); // 首个快照立即落盘

  await sleep(200); // 距上次写入完成已超过合并间隔
  writer.requestSave(archive("第二次"));
  await waitFor(() => writer.stats.written >= 2); // 间隔之外的保存应再次落盘
  assert.equal(writer.stats.written, 2);
  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(persisted, archive("第二次"));
});

test("flush 立即落盘积压快照，不等合并间隔", async () => {
  const file = await tempFile();
  const writer = createCoalescedWriter({ minIntervalMs: 5000, write: fileWriter(file) });
  const archive = [{ id: "s1", messages: [{ role: "assistant", content: "退出前快照" }] }];

  writer.requestSave(archive); // 定时器要等 5 秒
  await writer.flush(); // flush 必须绕过间隔立即写
  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(persisted, archive);
  assert.equal(writer.stats.written, 1);
  assert.equal(writer.stats.requested, 1);
});

test("首个快照立即写入，不因合并而延迟", async () => {
  const file = await tempFile();
  const writer = createCoalescedWriter({ minIntervalMs: 300, write: fileWriter(file) });
  const archive = [{ id: "s1", messages: [] }];

  writer.requestSave(archive);
  await waitFor(() => writer.stats.written >= 1); // 首个快照不等合并间隔即落盘
  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(persisted, archive);
});

test("并发 requestSave 与 flush 交错不产生交错损坏的文件", async () => {
  const file = await tempFile();
  const writer = createCoalescedWriter({ minIntervalMs: 20, write: fileWriter(file) });
  for (let round = 0; round < 10; round += 1) {
    for (let index = 0; index < 5; index += 1) {
      writer.requestSave([{ id: `s${round}`, messages: [{ role: "assistant", content: "x".repeat(100) }] }]);
    }
    await writer.flush();
  }
  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(persisted[0].id, "s9"); // 最后一次 flush 的快照完整在场
});

test("write 回调抛错不阻断后续写入", async () => {
  const file = await tempFile();
  let failing = true;
  let attempts = 0;
  const writer = createCoalescedWriter({
    minIntervalMs: 10,
    write: async (value) => {
      attempts += 1;
      if (failing) throw new Error("磁盘满");
      await fs.writeFile(file, JSON.stringify(value), "utf8");
    },
  });

  writer.requestSave([{ id: "s1" }]);
  await waitFor(() => attempts >= 1); // 第一次写入已尝试并失败
  assert.equal(writer.stats.written, 0);

  failing = false;
  writer.requestSave([{ id: "s2" }]);
  await waitFor(() => writer.stats.written >= 1);
  assert.equal(writer.stats.written, 1);
  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(persisted[0].id, "s2");
});
