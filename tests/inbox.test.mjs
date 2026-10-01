// 收件箱（ctx.inbox）行为契约：无人值守任务的审批/提问挂起-恢复语义。
// 这些断言逐条对应 main.mts 收编前的实现语义（提取前先钉住，防止搬运时走样）。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { CHANNEL_PENDING_TIMEOUT_MS, UNATTENDED_PENDING_TIMEOUT_MS } from "../electron/host/services/inbox.mts";

async function makeTmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-inbox-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

// 落盘是队列化的：等队列真正排空再断言文件内容。
// 固定 sleep 在慢盘/加载高的机器上会 flaky（曾出现 12 条并发创建只落 11 条）。
const flushInbox = (ctx) => Promise.resolve(ctx.get("inbox").persistQueue);

// 生产语义里挂起等待的超时计时器是 unref 的（不拖住进程退出）。在最小测试环境下，
// 若事件循环只剩这个 unref 计时器就会被判定为空转、计时器不触发——用一个 ref'd
// 计时器把循环撑到等待结束，既保留生产语义又能测到超时分支。
async function withLoopAlive(fn, ms = 300) {
  const keepAlive = setTimeout(() => {}, ms);
  try {
    return await fn();
  } finally {
    clearTimeout(keepAlive);
  }
}
const readFile = async (dir) => JSON.parse(await fs.readFile(path.join(dir, "inbox.json"), "utf8"));

test("超时常量：渠道 10 分钟、无人值守 2 小时", () => {
  assert.equal(CHANNEL_PENDING_TIMEOUT_MS, 10 * 60 * 1000);
  assert.equal(UNATTENDED_PENDING_TIMEOUT_MS, 2 * 3600 * 1000);
});

test("create：返回的 promise 带 itemId 且落盘为 pending；决议后 promise 以结果恢复", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const pending = ctx.inbox.create({ kind: "approval", sessionId: "s1", tool: "run_command", title: "跑命令", details: "npm test" });
    assert.equal(typeof pending.then, "function");
    assert.ok(pending.itemId, "promise 上必须挂 itemId（渠道按它路由 IM 回复）");
    await flushInbox(ctx);
    const stored = await readFile(dir);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, pending.itemId);
    assert.equal(stored[0].status, "pending");
    assert.equal(stored[0].kind, "approval");
    assert.ok(stored[0].createdAt);

    const resolved = await ctx.inbox.resolve(pending.itemId, { approved: true });
    assert.equal(resolved.ok, true);
    assert.deepEqual(await pending, { ok: true, reason: "" });
  } finally {
    await disposeHost(ctx);
  }
});

test("question 决议需要非空回答，回答留痕带来源标注", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const q = ctx.inbox.create({ kind: "question", sessionId: "s1", question: "选哪个方案？", options: ["A", "B"] });
    await flushInbox(ctx);
    assert.equal((await ctx.inbox.resolve(q.itemId, { answer: "   " })).ok, false, "空回答不允许");
    const ok = await ctx.inbox.resolve(q.itemId, { answer: "B", via: "企业微信·张三" });
    assert.equal(ok.ok, true);
    assert.deepEqual(await q, { ok: true, answer: "B" });
    await flushInbox(ctx);
    const stored = await readFile(dir);
    assert.equal(stored[0].status, "resolved");
    assert.match(stored[0].resolution, /已回答：B/);
    assert.match(stored[0].resolution, /\(来自 企业微信·张三\)/);
    assert.ok(stored[0].resolvedAt);
  } finally {
    await disposeHost(ctx);
  }
});

test("重复决议 / 失效条目决议：返回固定错误且不重复落盘", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const p = ctx.inbox.create({ kind: "approval", sessionId: "s1" });
    await flushInbox(ctx);
    assert.equal((await ctx.inbox.resolve(p.itemId, { approved: true })).ok, true);
    const again = await ctx.inbox.resolve(p.itemId, { approved: true });
    assert.deepEqual(again, { ok: false, error: "该事项已处理或已失效" });
    assert.deepEqual(await ctx.inbox.resolve("不存在的 id", { approved: true }), { ok: false, error: "该事项已处理或已失效" });
  } finally {
    await disposeHost(ctx);
  }
});

test("dismiss：待处理不可移除，已处理可移除", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const p = ctx.inbox.create({ kind: "approval", sessionId: "s1" });
    await flushInbox(ctx);
    const denied = await ctx.inbox.dismiss(p.itemId);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /待处理事项不能移除/);
    await ctx.inbox.resolve(p.itemId, { approved: false });
    await flushInbox(ctx);
    assert.equal((await ctx.inbox.dismiss(p.itemId)).ok, true);
    await flushInbox(ctx);
    assert.deepEqual(await readFile(dir), []);
  } finally {
    await disposeHost(ctx);
  }
});

test("list：读取前自动把孤儿 pending 落盘为已失效", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    // 直接构造一条有等待 promise 的条目，再手工丢弃等待者，模拟任务提前退出
    const p = ctx.inbox.create({ kind: "approval", sessionId: "s1" });
    await flushInbox(ctx);
    assert.equal((await ctx.inbox.list())[0].status, "pending", "有等待者时不应被判为孤儿");
    ctx.get("inbox").pending.delete(p.itemId);
    const listed = await ctx.inbox.list();
    assert.equal(listed[0].status, "expired");
    assert.equal(listed[0].resolution, "任务已结束，该事项自动失效");
  } finally {
    await disposeHost(ctx);
  }
});

test("expireNow / awaitWithTimeout：超时按拒绝收尾并把条目置为已失效", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const p = ctx.inbox.create({ kind: "approval", sessionId: "s1" });
    await flushInbox(ctx);
    const raced = await withLoopAlive(() => ctx.inbox.awaitWithTimeout(p, "审批等待超时，已自动取消", 20));
    // 超时回调先 expireNow（解决 pending）再 resolve(timeout)，Promise.race 由 pending
    // 先胜出——所以调用方拿到的是 {ok,reason}，timeout 分支里的 timedOut:true 在当前
    // 实现下不可达（收编前即如此）。这里钉住真实行为，将来要改是有意变更。
    assert.deepEqual(raced, { ok: false, reason: "审批等待超时，已自动取消" });
    assert.deepEqual(await p, { ok: false, reason: "审批等待超时，已自动取消" });
    await flushInbox(ctx);
    const stored = await readFile(dir);
    assert.equal(stored[0].status, "expired");
    assert.equal(stored[0].resolution, "审批等待超时，已自动取消");
  } finally {
    await disposeHost(ctx);
  }
});

test("awaitWithTimeout：先决议的一方胜出，不产生超时残留", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const p = ctx.inbox.create({ kind: "question", sessionId: "s1" });
    await flushInbox(ctx);
    const raced = ctx.inbox.awaitWithTimeout(p, "超时", 5000);
    await ctx.inbox.resolve(p.itemId, { answer: "A" });
    assert.deepEqual(await raced, { ok: true, answer: "A" });
  } finally {
    await disposeHost(ctx);
  }
});

test("expireAll（退出）/ expireOrphaned（启动）：挂起项一律以拒绝解决并留痕", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const p = ctx.inbox.create({ kind: "approval", sessionId: "s1" });
    await flushInbox(ctx);
    await ctx.inbox.expireAll("应用在等待处理期间关闭，任务已终止");
    assert.deepEqual(await p, { ok: false, reason: "应用在等待处理期间关闭，任务已终止" });
    await flushInbox(ctx);
    assert.equal((await readFile(dir))[0].status, "expired");
  } finally {
    await disposeHost(ctx);
  }

  // 重启后：残留的 pending 条目（无等待者）标记为已失效
  const ctx2 = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    await ctx2.inbox.expireOrphaned();
    await flushInbox(ctx2);
    const stored = await readFile(dir);
    assert.equal(stored[0].status, "expired");
    assert.equal(stored[0].resolution, "应用在等待处理期间关闭，任务已终止");
  } finally {
    await disposeHost(ctx2);
  }
});

test("落盘保留策略：pending 永不丢弃，已处理只留最近 100 条", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const settled = Array.from({ length: 130 }, (_, index) => ({
      id: `old-${index}`, kind: "approval", status: "resolved", resolution: "已允许",
    }));
    const livePending = ctx.inbox.create({ kind: "approval", sessionId: "s1" });
    await flushInbox(ctx);
    const items = await ctx.inbox.read();
    await ctx.inbox.write([...settled, ...items]);
    const after = await ctx.inbox.read();
    assert.equal(after.filter((item) => item.status === "pending").length, 1, "pending 不能被裁掉");
    assert.equal(after.filter((item) => item.status !== "pending").length, 100, "已处理只保留最近 100 条");
    assert.ok(livePending.itemId);
  } finally {
    await disposeHost(ctx);
  }
});

test("并发创建不丢条目：落盘队列串行化 read-modify-write", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  try {
    const all = Array.from({ length: 12 }, (_, index) => ctx.inbox.create({ kind: "approval", sessionId: `s${index}` }));
    await flushInbox(ctx);
    const stored = await readFile(dir);
    assert.equal(stored.length, 12, "并发创建不应互相覆盖");
    assert.equal(new Set(stored.map((item) => item.id)).size, 12);
    assert.equal(all.every((p) => typeof p.itemId === "string"), true);
  } finally {
    await disposeHost(ctx);
  }
});
