// 启动快照：异常启动覆盖数据后的最后一道兜底
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotCriticalFiles } from "../electron/host/boot-backup.mts";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-bootbackup-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

test("启动快照：复制会话与设置，且不碰大目录", async (t) => {
  const dir = await tempDir(t);
  await fs.mkdir(path.join(dir, "sessions"), { recursive: true });
  await fs.writeFile(path.join(dir, "sessions", "index.json"), JSON.stringify({ version: 1, order: ["a"], activeId: "a" }), "utf8");
  await fs.writeFile(path.join(dir, "sessions", "a-1.json"), JSON.stringify({ id: "a", messages: [{ role: "user", content: "hi" }] }), "utf8");
  await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ endpoint: "https://x", model: "m" }), "utf8");
  await fs.mkdir(path.join(dir, "memory-wiki", "pages"), { recursive: true });
  await fs.writeFile(path.join(dir, "memory-wiki", "pages", "facts.md"), "# 事实\n长期记忆", "utf8");
  await fs.mkdir(path.join(dir, "models", "big"), { recursive: true });
  await fs.writeFile(path.join(dir, "models", "big", "w.bin"), Buffer.alloc(1024), "utf8");

  const result = await snapshotCriticalFiles({ dir, now: () => new Date("2026-10-01T10:00:00Z") });
  assert.equal(result.ok, true);
  assert.equal(result.copied, 4, "index + 1 个会话 + settings + memory-wiki");
  const snap = path.join(dir, ".backups", "2026-10-01T10-00-00-000Z");
  assert.ok((await fs.readdir(path.join(snap, "sessions"))).includes("a-1.json"));
  assert.equal(JSON.parse(await fs.readFile(path.join(snap, "settings.json"), "utf8")).model, "m");
  assert.equal(await fs.stat(path.join(snap, "models")).catch(() => null), null, "不应快照 models 这类可再生目录");
  assert.match(await fs.readFile(path.join(snap, "memory-wiki", "pages", "facts.md"), "utf8"), /长期记忆/, "记忆 wiki 应被快照");
  // 会话文件用硬链接：内容一致且不额外占盘（同一 inode）
  const srcIno = (await fs.stat(path.join(dir, "sessions", "a-1.json"))).ino;
  const snapIno = (await fs.stat(path.join(snap, "sessions", "a-1.json"))).ino;
  assert.equal(snapIno, srcIno, "会话快照应与源文件是同一 inode（硬链接），避免多份拷贝占盘");
});

test("启动快照：只保留最近 3 份", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, "settings.json"), "{}", "utf8");
  for (const iso of ["2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z", "2026-10-01T03:00:00Z", "2026-10-01T04:00:00Z"]) {
    await snapshotCriticalFiles({ dir, now: () => new Date(iso) });
  }
  const stamps = await fs.readdir(path.join(dir, ".backups"));
  assert.equal(stamps.length, 3, `应只保留 3 份，实际 ${stamps.length}`);
  assert.ok(!stamps.includes("2026-10-01T01-00-00-000Z"), "最旧的应被清理");
});

test("启动快照：没有数据时不留下空目录；失败不影响启动", async (t) => {
  const dir = await tempDir(t);
  const result = await snapshotCriticalFiles({ dir });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(await fs.stat(path.join(dir, ".backups")).catch(() => null), null, "全新安装不应产生 .backups");

  // 用真实文件阻挡目标目录；root 下 chmod 仍可写，/proc 的递归目录操作也因系统而异。
  const blockedPath = path.join(dir, 'blocked');
  await fs.writeFile(blockedPath, '此处是普通文件，不能创建备份目录');
  const blocked = await snapshotCriticalFiles({ dir: blockedPath });
  assert.equal(blocked.ok, false);
});
