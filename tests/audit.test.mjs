import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAuditLog } from "../electron/audit.mjs";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dyworker-audit-"));
}

test("审计日志追加 JSONL，每行可解析", async () => {
  const dir = await tempDir();
  const filePath = path.join(dir, "audit.jsonl");
  const log = createAuditLog({ filePath });
  await log.record({ tool: "write_file", summary: "写入 材料/总结.docx", riskClass: "write_local", decision: "approved", approvalMode: "interactive", sessionId: "s1", model: "本地内置 Qwen3-0.6B" });
  await log.record({ tool: "run_command", summary: "运行命令：rm -rf x", riskClass: "exec", decision: "denied" });
  const lines = (await fs.readFile(filePath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.tool, "write_file");
  assert.equal(first.decision, "approved");
  assert.equal(first.sessionId, "s1");
  assert.equal(first.model, "本地内置 Qwen3-0.6B");
  assert.ok(first.time);
  const second = JSON.parse(lines[1]);
  assert.equal(second.decision, "denied");
  assert.equal(second.model, undefined);
});

test("summary/detail 超长截断", async () => {
  const dir = await tempDir();
  const filePath = path.join(dir, "audit.jsonl");
  const log = createAuditLog({ filePath });
  await log.record({ tool: "run_command", summary: "x".repeat(500), detail: "y".repeat(900), decision: "failed" });
  const [entry] = (await fs.readFile(filePath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(entry.summary.length <= 201);
  assert.ok(entry.detail.length <= 501);
});

test("超过 maxBytes 后轮转保留较新一半", async () => {
  const dir = await tempDir();
  const filePath = path.join(dir, "audit.jsonl");
  const log = createAuditLog({ filePath, maxBytes: 2000 });
  // 每条记录约 100+ 字节，写 60 条（超过 50 条触发一次轮转检查）
  for (let index = 0; index < 60; index++) {
    await log.record({ tool: "write_file", summary: `第 ${index} 次写入 ${"z".repeat(80)}`, decision: "executed" });
  }
  const content = await fs.readFile(filePath, "utf8");
  // 60 条全量约 10KB；第 50 条触发一次轮转砍掉较旧一半，应显著小于全量
  assert.ok(content.length < 7500, `轮转后大小 ${content.length} 应显著小于总写入量`);
  const lines = content.trim().split("\n");
  for (const line of lines) JSON.parse(line); // 每行仍是完整 JSON
  const last = JSON.parse(lines[lines.length - 1]);
  assert.match(last.summary, /第 59 次写入/);
});

test("文件不可写时静默降级不抛错", async () => {
  const log = createAuditLog({ filePath: path.join("/nonexistent-root-\0", "audit.jsonl") });
  await log.record({ tool: "write_file", decision: "executed" }); // 不应抛错
});
