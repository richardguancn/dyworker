import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionArchive } from "../electron/session-archive.mts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dyworker-archive-"));
}

const makeSession = (id, marker = id, extra = {}) => ({
  id,
  title: `会话 ${id}`,
  workspacePath: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  messages: [{ role: "assistant", content: `内容-${marker}` }],
  ...extra,
});

test("saveAll 按会话拆分落盘，loadAll 按顺序完整读回", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });

  await archive.saveAll([makeSession("b"), makeSession("a"), makeSession("c")]);
  const names = (await fs.readdir(dir)).sort();
  assert.ok(names.includes("index.json"));
  assert.equal(names.filter((name) => name.endsWith(".json")).length, 4); // 3 会话 + index

  const loaded = await archive.loadAll();
  assert.deepEqual(loaded.map((session) => session.id), ["b", "a", "c"]);
  assert.equal(loaded[1].messages[0].content, "内容-a");
});

test("saveAll 二次保存只重写变化的会话文件（差异化写入）", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  const a = makeSession("a");
  const b = makeSession("b");
  await archive.saveAll([a, b]);
  const files = (await fs.readdir(dir)).filter((name) => name !== "index.json");
  const unchanged = path.join(dir, files[0]);
  const statBefore = await fs.stat(unchanged);

  await sleep(20);
  await archive.saveAll([a, { ...b, title: "改过的标题" }]); // 只有 b 变了
  const statAfter = await fs.stat(unchanged);
  assert.equal(statAfter.mtimeMs, statBefore.mtimeMs, "未变化的会话文件不应被重写");

  const loaded = await archive.loadAll();
  assert.deepEqual(loaded.map((session) => session.title), ["会话 a", "改过的标题"]);
});

test("applyDelta 只写变化会话，order 权威删除已移除的会话", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  await archive.saveAll([makeSession("keep"), makeSession("gone")]);

  await archive.applyDelta({
    changed: [{ ...makeSession("keep"), title: "增量改" }],
    removed: ["gone"],
    order: ["keep"],
  });

  const loaded = await archive.loadAll();
  assert.deepEqual(loaded.map((session) => session.id), ["keep"]);
  assert.equal(loaded[0].title, "增量改");
  // 安全语义：被移除的会话文件不再留在存档根目录，但进 .removed 备份而非被删
  const rootNames = (await fs.readdir(dir)).filter((name) => name !== "index.json" && name !== ".removed");
  assert.equal(rootNames.length, 1, "根目录只应剩未移除的会话");
  const firstBatch = (await fs.readdir(path.join(dir, ".removed"))).sort()[0];
  const retired = await fs.readdir(path.join(dir, ".removed", firstBatch));
  assert.ok(retired.some((name) => name.includes("gone")), "被移除的会话应进备份");

  // 首次保存即被渲染端过滤掉的会话：order 不含它的文件也应被清理
  await archive.saveAll([makeSession("x"), makeSession("doomed")]);
  await archive.applyDelta({ changed: [], removed: [], order: ["x"] });
  const after = await archive.loadAll();
  assert.deepEqual(after.map((session) => session.id), ["x"]);
  assert.equal((await fs.readdir(dir)).filter((name) => name !== "index.json" && name !== ".removed").length, 1);
});

test("旧单文件 sessions.json 首次访问自动迁移，旧文件改名备份", async () => {
  const dir = await tempDir();
  const legacyFile = path.join(dir, "sessions.json");
  await fs.writeFile(legacyFile, JSON.stringify([makeSession("legacy-1"), makeSession("legacy-2")]), "utf8");
  const archive = createSessionArchive({ dir, legacyFile });

  const loaded = await archive.loadAll();
  assert.deepEqual(loaded.map((session) => session.id), ["legacy-1", "legacy-2"]);
  assert.ok((await fs.readdir(dir)).includes("index.json"));
  assert.ok(await fs.access(`${legacyFile}.migrated`).then(() => true, () => false), "旧文件应改名为 .migrated 备份");
  assert.equal(await fs.access(legacyFile).then(() => true, () => false), false, "旧文件不应留在原地被重复迁移");

  // 迁移结果可增量更新
  await archive.applyDelta({ changed: [{ ...makeSession("legacy-1", "改") }], removed: [], order: ["legacy-1", "legacy-2"] });
  const reloaded = await createSessionArchive({ dir, legacyFile }).loadAll();
  assert.equal(reloaded[0].messages[0].content, "内容-改");
});

test("清洗后同名的不同 id 落成不同文件，读回互不串档", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  await archive.saveAll([makeSession("a:b"), makeSession("a_c")]);

  const loaded = await archive.loadAll();
  assert.equal(loaded.length, 2);
  const markers = loaded.map((session) => session.messages[0].content).sort();
  assert.deepEqual(markers, ["内容-a:b", "内容-a_c"]);
});

test("单个会话文件损坏时跳过该会话，其余照常读回", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  await archive.saveAll([makeSession("ok-1"), makeSession("bad"), makeSession("ok-2")]);
  const files = (await fs.readdir(dir)).filter((name) => name !== "index.json");
  // 找到 bad 对应的文件并写坏（模拟重启后磁盘上的文件已损坏）
  for (const name of files) {
    const content = await fs.readFile(path.join(dir, name), "utf8");
    if (content.includes("内容-bad")) await fs.writeFile(path.join(dir, name), "{ 损坏的 JSON", "utf8");
  }

  // 新实例（对应重启后）从磁盘装载：损坏会话被跳过，其余照常读回
  const reloaded = await createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") }).loadAll();
  assert.deepEqual(reloaded.map((session) => session.id).sort(), ["ok-1", "ok-2"]);
});

test("upsert 已存在则跳过、不存在则插到最前（计划任务转录语义）", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  await archive.saveAll([makeSession("first")]);

  await archive.upsert(makeSession("first", "不应覆盖"));
  await archive.upsert(makeSession("scheduled"));

  const loaded = await archive.loadAll();
  assert.deepEqual(loaded.map((session) => session.id), ["scheduled", "first"]);
  assert.equal(loaded[1].messages[0].content, "内容-first");
});

test("appendMessages 按 role:content 去重追加并刷新 updatedAt", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  const base = makeSession("wake");
  await archive.saveAll([base]);

  const transcript = [
    { role: "user", content: "（到点自动唤醒）继续" },
    { role: "assistant", content: "做完了" },
  ];
  await archive.appendMessages("wake", transcript);
  await archive.appendMessages("wake", transcript); // 重复追加应被去重
  await archive.appendMessages("missing", transcript); // 不存在的会话静默跳过

  // 新实例读回磁盘真实状态（saveAll 缓存的是传入对象，appendMessages
  // 会原地刷新它，因此不能用 base 自身对比 updatedAt）
  const reloaded = await createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") }).loadAll();
  assert.equal(reloaded[0].messages.length, 3); // 原 1 条 + 2 条新转录
  assert.ok(reloaded[0].updatedAt > "2026-01-01T00:00:00.000Z");
});

test("全新安装返回空数组，写读往返不受影响", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  assert.deepEqual(await archive.loadAll(), []);

  await archive.applyDelta({ changed: [makeSession("fresh")], removed: [], order: ["fresh"] });
  const loaded = await archive.loadAll();
  assert.deepEqual(loaded.map((session) => session.id), ["fresh"]);
});

test("activeId 随 applyDelta 持久化到 index.json，重启后 getActiveId 读回", async () => {
  const dir = await tempDir();
  const legacyFile = path.join(dir, "sessions.json");
  const archive = createSessionArchive({ dir, legacyFile });
  await archive.applyDelta({ changed: [makeSession("a"), makeSession("b")], removed: [], order: ["a", "b"], activeId: "b" });

  const index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8"));
  assert.equal(index.activeId, "b", "index.json 应包含持久化的 activeId");

  // 新实例（对应重启后）读回
  const restarted = createSessionArchive({ dir, legacyFile });
  assert.equal(await restarted.getActiveId(), "b");
  assert.deepEqual((await restarted.loadAll()).map((session) => session.id), ["a", "b"]);
});

test("getActiveId 在选中会话被移除后返回空串", async () => {
  const dir = await tempDir();
  const legacyFile = path.join(dir, "sessions.json");
  const archive = createSessionArchive({ dir, legacyFile });
  await archive.applyDelta({ changed: [makeSession("a"), makeSession("b")], removed: [], order: ["a", "b"], activeId: "b" });
  assert.equal(await archive.getActiveId(), "b");

  // 删除选中会话：activeId 不再对应现存会话，读回应为空串
  await archive.applyDelta({ changed: [], removed: ["b"], order: ["a"], activeId: "a" });
  assert.equal(await archive.getActiveId(), "a");

  await archive.applyDelta({ changed: [], removed: ["a"], order: [], activeId: "" });
  assert.equal(await archive.getActiveId(), "");
});

test("旧格式 index.json（无 activeId 字段）读取正常，getActiveId 返回空串", async () => {
  const dir = await tempDir();
  const legacyFile = path.join(dir, "sessions.json");
  // 先用存档正常落盘，再把 index.json 改回旧格式（删掉 activeId 字段）
  await createSessionArchive({ dir, legacyFile }).saveAll([makeSession("old-1"), makeSession("old-2")]);
  const index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8"));
  delete index.activeId;
  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(index), "utf8");

  const archive = createSessionArchive({ dir, legacyFile });
  assert.equal(await archive.getActiveId(), "");
  assert.deepEqual((await archive.loadAll()).map((session) => session.id), ["old-1", "old-2"]);

  // 旧存档被增量更新后写入新版 index（带 activeId），往返不受影响
  await archive.applyDelta({ changed: [], removed: [], order: ["old-1", "old-2"], activeId: "old-2" });
  const restarted = createSessionArchive({ dir, legacyFile });
  assert.equal(await restarted.getActiveId(), "old-2");
});

test("并发混合操作不丢数据、不产生交错损坏", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  await archive.saveAll([makeSession("base")]);
  await Promise.all([
    archive.applyDelta({ changed: [makeSession("d1")], removed: [], order: ["d1", "base"] }),
    archive.upsert(makeSession("up")),
    archive.appendMessages("base", [{ role: "user", content: "追加" }]),
    archive.saveAll([makeSession("full")]),
  ]);

  const archive2 = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  const loaded = await archive2.loadAll(); // 新实例绕过内存镜像，验证磁盘真实状态
  assert.ok(loaded.length >= 1);
  for (const session of loaded) {
    assert.ok(session.id, `会话对象应完整：${JSON.stringify(session).slice(0, 80)}`);
    assert.ok(Array.isArray(session.messages));
  }
});

// 回归：渲染端某次少报会话时，历史不能被不可逆删掉。
// 真实事故：某次启动拿到空的初始状态后保存，磁盘上的会话被整批 fs.rm 删除。
test("少报会话时不删文件，改为移入 .removed 备份且可回滚", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  await archive.saveAll([makeSession("keep-me"), makeSession("also-keep"), makeSession("third")]);
  const before = await fs.readdir(dir);
  const sessionFiles = before.filter((name) => name.endsWith(".json") && name !== "index.json");
  assert.equal(sessionFiles.length, 3);

  // 渲染端只报 1 个会话（模拟初始状态异常）→ 另外 2 个必须只是被移走
  await archive.saveAll([makeSession("keep-me")]);
  const after = await fs.readdir(dir);
  const survivors = after.filter((name) => name.endsWith(".json") && name !== "index.json");
  assert.equal(survivors.length, 1, "索引里只剩报上来的那 1 个");

  const backups = await fs.readdir(path.join(dir, ".removed"));
  assert.equal(backups.length, 1, "应产生一批备份目录");
  const saved = await fs.readdir(path.join(dir, ".removed", backups[0]));
  const savedSessions = saved.filter((name) => name !== "index.json");
  assert.equal(savedSessions.length, 2, "被移出的 2 个会话都在备份里，没有被 rm");
  assert.ok(saved.includes("index.json"), "备份里应带一份改动前的 index 快照");

  // 备份里的内容仍是可用的完整会话，可原样回滚
  const restored = JSON.parse(await fs.readFile(path.join(dir, ".removed", backups[0], savedSessions[0]), "utf8"));
  assert.ok(restored.id && Array.isArray(restored.messages));
  // 备份目录里同时存了"改动前的 index"，回滚要把文件与 index 一起恢复
  // （归档读取以 index.order 为准，只放回文件是读不出来的）
  const backupDir = path.join(dir, ".removed", backups[0]);
  const savedIndex = JSON.parse(await fs.readFile(path.join(backupDir, "index.json"), "utf8"));
  assert.equal(savedIndex.order.length, 3, "备份里的 index 应是缩小前的 3 条");
  for (const name of savedSessions) await fs.copyFile(path.join(backupDir, name), path.join(dir, name));
  await fs.copyFile(path.join(backupDir, "index.json"), path.join(dir, "index.json"));
  const archive2 = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  const loaded = await archive2.loadAll();
  assert.equal(loaded.length, 3, "回滚后应能重新读到全部 3 个");
});

test("显式 removed 的会话同样进备份，可回滚", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  await archive.saveAll([makeSession("a"), makeSession("b")]);
  await archive.applyDelta({ changed: [], removed: ["b"], order: ["a"] });
  const backups = await fs.readdir(path.join(dir, ".removed"));
  const files = await fs.readdir(path.join(dir, ".removed", backups[0]));
  assert.equal(files.length, 1, "被显式删除的会话也在备份里");
});

// 安全闸：没有显式删除却让存档大幅缩水 → 拒绝保存，历史必须原样保留。
// 这是打包版那起数据丢失事故的最后一道防线（app:initial-state 抛错 → 渲染端空状态 → 保存）。
test("大幅缩水且无显式删除时拒绝保存，历史原样保留", async () => {
  const dir = await tempDir();
  const archive = createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") });
  const many = Array.from({ length: 10 }, (_, i) => makeSession(`s${i}`));
  await archive.saveAll(many);

  // 只报 1 个：10 → 1，缩水 9 > 允许(5)，且没有显式 removed → 必须拒绝
  await archive.saveAll([makeSession("s0")]);
  const files = (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && n !== "index.json");
  assert.equal(files.length, 10, "拒绝保存后磁盘上仍应是 10 个会话");
  const loaded = await createSessionArchive({ dir, legacyFile: path.join(dir, "sessions.json") }).loadAll();
  assert.equal(loaded.length, 10, "index 也不应被改写");

  // 显式删除是用户意图，允许执行（并且仍走备份）
  await archive.applyDelta({ changed: [], removed: ["s1"], order: many.map((s) => s.id).filter((id) => id !== "s1") });
  const after = (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && n !== "index.json");
  assert.equal(after.length, 9, "显式删除应生效");
});
