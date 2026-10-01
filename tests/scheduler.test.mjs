// 调度域（ctx.scheduler）行为契约：定时计划存储/到期推进、唤醒登记与调度循环。
// 逐条对应 main.mts 收编前的语义；任务执行本身在壳层，这里用 hooks 假实现观察调用。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { nextOccurrence } from "../electron/host/services/scheduler.mts";

async function makeTmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-sched-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

// 只装调度服务（不启整台宿主），hooks 用假的，便于精确观察调度决策
async function makeScheduler(t, overrides = {}) {
  const dir = overrides.dir || await makeTmpDir(t);
  const calls = { scheduled: [], woke: [], broadcasts: 0 };
  let clock = overrides.now ? overrides.now() : new Date("2026-09-30T10:00:00.000Z");
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  const scheduler = ctx.get("scheduler");
  Object.assign(scheduler.hooks, {
    now: () => clock,
    isShuttingDown: () => false,
    isSessionBusy: () => false,
    isSystemBusy: () => false,
    runScheduledTask: async (record) => { calls.scheduled.push(record.id); },
    resumeWake: async (wake) => { calls.woke.push(wake.sessionId); },
    broadcast: () => { calls.broadcasts += 1; },
    ...overrides.hooks,
  });
  return { ctx, dir, calls, scheduler, setNow: (d) => { clock = d; } };
}

const readJson = async (dir, name) => JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));

test("nextOccurrence：按重复方式推进，结果严格大于 now，非法时间戳从 now 起算", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  assert.equal(nextOccurrence("hourly", "2026-09-30T09:00:00.000Z", now), "2026-09-30T11:00:00.000Z");
  // 当前时间正好等于 now：必须继续推进一天，不能停在 now
  assert.equal(nextOccurrence("daily", "2026-09-29T10:00:00.000Z", now), "2026-10-01T10:00:00.000Z");
  assert.ok(new Date(nextOccurrence("daily", "2026-09-29T10:00:00.000Z", now)) > now, "结果必须严格大于 now");
  // 09-23 + 7d 正好等于 now：必须再推一周
  assert.equal(nextOccurrence("weekly", "2026-09-23T10:00:00.000Z", now), "2026-10-07T10:00:00.000Z");
  // 未知/缺失重复方式按每天（同样要推到 now 之后）
  assert.equal(nextOccurrence(undefined, "2026-09-29T10:00:00.000Z", now), "2026-10-01T10:00:00.000Z");
  // 非法当前时间：从 now 起算一个周期
  assert.equal(nextOccurrence("hourly", "不是时间", now), "2026-09-30T11:00:00.000Z");
  // 已过期较久：一路推进到未来
  assert.ok(new Date(nextOccurrence("hourly", "2026-09-30T05:00:00.000Z", now)) > now);
});

test("计划存储：旧字段迁移（workspace/schedule.type/allowWorkspaceWrites）自动归一化并回写", async (t) => {
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "old-1", name: "旧计划", workspace: "/tmp/legacy", schedule: { type: "hourly" } },
  ]), "utf8");
  const { ctx, scheduler } = await makeScheduler(t, { dir });
  try {
    const list = await scheduler.list();
    assert.equal(list[0].workspacePath, "/tmp/legacy");
    assert.equal(list[0].recurrence, "hourly");
    assert.equal(list[0].allowWorkspaceWrites, false, "缺失写权限按只读处理");
    const onDisk = await readJson(dir, "schedules.json");
    assert.equal(onDisk[0].workspacePath, "/tmp/legacy", "迁移结果应回写");
  } finally {
    await disposeHost(ctx);
  }
});

test("save/remove/setEnabled：校验错误文案不变，写盘后广播", async (t) => {
  const { ctx, scheduler, calls, dir } = await makeScheduler(t);
  try {
    assert.equal((await scheduler.save({ name: "", prompt: "x", workspacePath: "/w", nextRun: "2026-10-01T00:00:00Z" })).error, "计划名称和任务内容不能为空");
    assert.equal((await scheduler.save({ name: "n", prompt: "p", workspacePath: "", nextRun: "2026-10-01T00:00:00Z" })).error, "请先选择工作文件夹");
    assert.equal((await scheduler.save({ name: "n", prompt: "p", workspacePath: "/w", recurrence: "nope", nextRun: "2026-10-01T00:00:00Z" })).error, "重复方式无效");
    assert.equal((await scheduler.save({ name: "n", prompt: "p", workspacePath: "/w", nextRun: "不是时间" })).error, "首次执行时间无效");

    const saved = await scheduler.save({ name: "日报", prompt: "写日报", workspacePath: "/w", recurrence: "daily", nextRun: "2026-10-01T00:00:00Z", allowWorkspaceWrites: true });
    assert.equal(saved.ok, true);
    const items = await scheduler.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "日报");
    assert.equal(items[0].enabled, true);
    assert.equal(items[0].allowWorkspaceWrites, true);
    assert.ok(items[0].id && items[0].createdAt);

    // 更新同一条（按 id）
    await scheduler.save({ id: items[0].id, name: "日报 v2", prompt: "写日报", workspacePath: "/w", recurrence: "weekly", nextRun: "2026-10-02T00:00:00Z" });
    assert.equal((await scheduler.list())[0].name, "日报 v2");
    assert.equal((await scheduler.list()).length, 1);

    // 启停
    assert.equal((await scheduler.setEnabled({ id: items[0].id, enabled: false })).ok, true);
    assert.equal((await scheduler.list())[0].enabled, false);
    assert.equal((await scheduler.setEnabled({ id: "不存在", enabled: true })).ok, false);

    // 删除
    await scheduler.remove(items[0].id);
    assert.deepEqual(await scheduler.list(), []);
    assert.ok(calls.broadcasts >= 4, "每次写操作都应广播 schedules:changed");
    assert.ok((await readJson(dir, "schedules.json")).length === 0);
  } finally {
    await disposeHost(ctx);
  }
});

test("recoverInterrupted：上次运行中被关掉的计划恢复为待重跑", async (t) => {
  const dir = await makeTmpDir(t);
  const now = new Date("2026-09-30T10:00:00.000Z");
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "s1", name: "跑着的", recurrence: "daily", nextRun: "2026-09-30T09:00:00.000Z", enabled: true, lastStatus: "running" },
    { id: "s2", name: "正常的", recurrence: "daily", nextRun: "2026-10-01T09:00:00.000Z", enabled: true, lastStatus: "success" },
  ]), "utf8");
  const { ctx, scheduler } = await makeScheduler(t, { dir, now: () => now });
  try {
    await scheduler.recoverInterrupted();
    const items = await scheduler.list();
    const recoveredItem = items.find((item) => item.id === "s1");
    assert.equal(recoveredItem.lastStatus, "failed");
    assert.match(recoveredItem.lastSummary, /应用在上次执行过程中关闭/);
    assert.equal(recoveredItem.nextRun, now.toISOString());
    assert.equal(recoveredItem.enabled, true);
    assert.equal(items.find((item) => item.id === "s2").lastStatus, "success", "正常计划不受影响");
  } finally {
    await disposeHost(ctx);
  }
});

test("markFinished：状态/历史/下一次时间推进，once 执行完自动停用", async (t) => {
  const dir = await makeTmpDir(t);
  const now = new Date("2026-09-30T10:00:00.000Z");
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "daily-1", recurrence: "daily", nextRun: "2026-09-30T09:00:00.000Z", enabled: true, lastStatus: "running" },
    { id: "once-1", recurrence: "once", nextRun: "2026-09-30T09:00:00.000Z", enabled: true, lastStatus: "running" },
  ]), "utf8");
  const { ctx, scheduler } = await makeScheduler(t, { dir, now: () => now });
  try {
    await scheduler.markFinished("daily-1", true, "干完了", "sess-1");
    const daily = (await scheduler.list()).find((item) => item.id === "daily-1");
    assert.equal(daily.lastStatus, "success");
    assert.equal(daily.lastSummary, "干完了");
    assert.equal(daily.nextRun, "2026-10-01T09:00:00.000Z", "按重复方式推进");
    assert.equal(daily.enabled, true);
    assert.equal(daily.history[0].status, "success");
    assert.equal(daily.history[0].sessionId, "sess-1");

    await scheduler.markFinished("once-1", false, "失败了");
    const once = (await scheduler.list()).find((item) => item.id === "once-1");
    assert.equal(once.lastStatus, "failed");
    assert.equal(once.enabled, false, "一次性任务执行后停用");

    // 历史只保留最近 10 条
    for (let i = 0; i < 12; i += 1) await scheduler.markFinished("daily-1", true, `第${i}次`);
    assert.equal((await scheduler.list()).find((item) => item.id === "daily-1").history.length, 10);
    // 不存在的 id 静默返回
    await scheduler.markFinished("nope", true, "x");
  } finally {
    await disposeHost(ctx);
  }
});

test("markSleeping：挂起状态与摘要落盘", async (t) => {
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "s1", recurrence: "daily", enabled: true, lastStatus: "running" },
  ]), "utf8");
  const { ctx, scheduler } = await makeScheduler(t, { dir });
  try {
    await scheduler.markSleeping("s1", { wakeAt: "2026-10-01T00:00:00.000Z", reason: "等对方回复" }, "sess-9");
    const item = (await scheduler.list())[0];
    assert.equal(item.lastStatus, "sleeping");
    assert.match(item.lastSummary, /已挂起，将于/);
    assert.match(item.lastSummary, /等对方回复/);
    assert.equal(item.history[0].sessionId, "sess-9");
  } finally {
    await disposeHost(ctx);
  }
});

test("registerWake：按会话去重、字段归一化、落盘保留策略", async (t) => {
  const { ctx, scheduler, dir } = await makeScheduler(t);
  try {
    // 缺关键字段直接忽略
    await scheduler.registerWake({ sessionId: "", workspacePath: "/w", wake: { wakeAt: "2026-10-01T00:00:00.000Z" } });
    await scheduler.registerWake({ sessionId: "s1", workspacePath: "", wake: { wakeAt: "2026-10-01T00:00:00.000Z" } });
    await scheduler.registerWake({ sessionId: "s1", workspacePath: "/w", wake: {} });
    assert.deepEqual(await scheduler.readWakes(), []);

    await scheduler.registerWake({
      sessionId: "s1", scheduleId: "plan-1", workspacePath: "/w", approvalMode: "full-access",
      wake: { wakeAt: "2026-10-01T00:00:00.000Z", reason: "等两小时" }, prompt: "继续", finalText: "已完成一半",
    });
    const wakes = await scheduler.readWakes();
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].status, "pending");
    assert.equal(wakes[0].scheduleId, "plan-1");
    assert.equal(wakes[0].approvalMode, "full-access");
    assert.equal(wakes[0].workspacePath, "/w");

    // 同一会话再登记：去重（保留先到的那条）
    await scheduler.registerWake({ sessionId: "s1", workspacePath: "/w2", wake: { wakeAt: "2026-10-02T00:00:00.000Z" } });
    assert.equal((await scheduler.readWakes()).length, 1);
    assert.equal((await scheduler.readWakes())[0].workspacePath, "/w");

    assert.equal(await scheduler.hasPendingForSession("s1"), true);
    assert.equal(await scheduler.hasPendingForSession("s2"), false);

    // cancelForSession：pending → cancelled
    await scheduler.cancelForSession("s1");
    assert.equal((await scheduler.readWakes())[0].status, "cancelled");
    assert.equal(await scheduler.hasPendingForSession("s1"), false);

    // 落盘保留：pending 永不丢弃，已结束只留最近 50 条
    const settled = Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, sessionId: `x${i}`, status: "fired" }));
    await scheduler.registerWake({ sessionId: "s9", workspacePath: "/w", wake: { wakeAt: "2026-10-03T00:00:00.000Z" } });
    const current = await scheduler.readWakes();
    await scheduler.writeWakes([...settled, ...current]);
    const after = await scheduler.readWakes();
    assert.equal(after.filter((wake) => wake.status === "pending").length, 1);
    assert.equal(after.filter((wake) => wake.status !== "pending").length, 50);
    assert.ok(dir);
  } finally {
    await disposeHost(ctx);
  }
});

test("checkDueSchedules：忙碌时跳过；到期则先落 running 再交给壳层执行", async (t) => {
  const dir = await makeTmpDir(t);
  const now = new Date("2026-09-30T10:00:00.000Z");
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "due-1", recurrence: "daily", nextRun: "2026-09-30T09:00:00.000Z", enabled: true, lastStatus: "" },
  ]), "utf8");

  let busy = true;
  const { ctx, scheduler, calls } = await makeScheduler(t, { dir, now: () => now, hooks: { isSystemBusy: () => busy } });
  try {
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, [], "忙碌时不应触发");
    assert.equal((await scheduler.list())[0].lastStatus, "", "跳过时不应改状态");

    busy = false;
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, ["due-1"], "到期应交由壳层执行");
    assert.equal((await scheduler.list())[0].lastStatus, "running", "执行前先落 running（防重入）");
    assert.equal((await scheduler.list())[0].lastRun, now.toISOString());

    // 重入保护：调度器自身标记运行中时不再触发（真实入口会在这期间推进 nextRun）
    calls.scheduled.length = 0;
    scheduler.running = true;
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, []);
    scheduler.running = false;
  } finally {
    await disposeHost(ctx);
  }
});

test("checkDueWakes：先落 fired 再执行；活跃/运行中的会话跳过；忙碌时串行等待", async (t) => {
  const dir = await makeTmpDir(t);
  const now = new Date("2026-09-30T10:00:00.000Z");
  await fs.writeFile(path.join(dir, "wakes.json"), JSON.stringify([
    { id: "w-due", sessionId: "s-due", workspacePath: "/w", wakeAt: "2026-09-30T09:00:00.000Z", status: "pending" },
    { id: "w-active", sessionId: "s-active", workspacePath: "/w", wakeAt: "2026-09-30T09:00:00.000Z", status: "pending" },
    { id: "w-future", sessionId: "s-future", workspacePath: "/w", wakeAt: "2026-10-01T09:00:00.000Z", status: "pending" },
  ]), "utf8");

  let busySessions = new Set(["s-active"]);
  let systemBusy = false;
  const { ctx, scheduler, calls } = await makeScheduler(t, {
    dir,
    now: () => now,
    hooks: { isSessionBusy: (sid) => busySessions.has(sid), isSystemBusy: () => systemBusy },
  });
  // 本用例只测"到期判定"本身：屏蔽近邻定时器的自续期，否则它可能在断言之间异步再跑一次
  // （全量套件里事件循环更忙，unref 定时器会真的触发 → 断言飘）
  scheduler.scheduleNextWakeCheck = async () => {};
  try {
    await scheduler.checkDueWakes();
    assert.deepEqual(calls.woke, ["s-due"], "只应唤醒真正到点且会话空闲的那条");
    const wakes = await scheduler.readWakes();
    assert.equal(wakes.find((wake) => wake.id === "w-due").status, "fired", "执行后应已落 fired");
    assert.ok(wakes.find((wake) => wake.id === "w-due").firedAt);
    assert.equal(wakes.find((wake) => wake.id === "w-active").status, "pending", "活跃会话暂缓");
    assert.equal(wakes.find((wake) => wake.id === "w-future").status, "pending", "未到点不动");

    // 会话恢复空闲后，下一次检查会补上
    busySessions = new Set();
    await scheduler.checkDueWakes();
    assert.deepEqual(calls.woke, ["s-due", "s-active"]);

    // 已有后台调度任务在跑：串行等待，不触发
    await fs.writeFile(path.join(dir, "wakes.json"), JSON.stringify([
      { id: "w-2", sessionId: "s-2", workspacePath: "/w", wakeAt: "2026-09-30T09:00:00.000Z", status: "pending" },
    ]), "utf8");
    scheduler.running = true;
    calls.woke.length = 0;
    await scheduler.checkDueWakes();
    assert.deepEqual(calls.woke, [], "有调度任务在跑时应让路");
    assert.equal((await scheduler.readWakes())[0].status, "pending");
  } finally {
    await disposeHost(ctx);
  }
});

test("dispose 清掉调度定时器（10s tick / 首帧补偿 / 近邻唤醒）", async (t) => {
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "wakes.json"), JSON.stringify([
    { id: "w", sessionId: "s", workspacePath: "/w", wakeAt: "2026-10-01T00:00:00.000Z", status: "pending" },
  ]), "utf8");
  const { ctx, scheduler } = await makeScheduler(t, { dir });
  await scheduler.start();
  assert.ok(scheduler.schedulerTimer, "应挂上 10s tick");
  assert.ok(scheduler.bootTimer, "应有首帧补偿");
  assert.ok(scheduler.wakeTimer, "应挂上近邻唤醒定时器");
  await disposeHost(ctx);
  assert.equal(scheduler.schedulerTimer, null);
  assert.equal(scheduler.bootTimer, null);
  assert.equal(scheduler.wakeTimer, null);
});

test("triggerNow：把 nextRun 拨到现在并触发检查；运行中拒绝", async (t) => {
  const dir = await makeTmpDir(t);
  const now = new Date("2026-09-30T10:00:00.000Z");
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "p1", recurrence: "daily", nextRun: "2026-10-05T09:00:00.000Z", enabled: false, lastStatus: "" },
  ]), "utf8");
  const { ctx, scheduler } = await makeScheduler(t, { dir, now: () => now });
  try {
    assert.equal((await scheduler.triggerNow("不存在")).ok, false);
    assert.equal((await scheduler.triggerNow("p1")).ok, true);
    const item = (await scheduler.list())[0];
    assert.equal(item.enabled, true);
    assert.equal(item.nextRun, now.toISOString());

    item.lastStatus = "running";
    await scheduler.writeScheduleList([item]);
    const denied = await scheduler.triggerNow("p1");
    assert.equal(denied.ok, false);
    assert.match(denied.error, /正在执行/);
  } finally {
    await disposeHost(ctx);
  }
});
