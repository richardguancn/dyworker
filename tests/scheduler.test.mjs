// 调度域（ctx.scheduler）行为契约：定时计划存储/到期推进、唤醒登记与调度循环。
// 逐条对应 main.mts 收编前的语义；任务执行本身在壳层，这里用 hooks 假实现观察调用。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { nextOccurrence } from "../electron/host/services/scheduler.mts";
import { schedulesIpcPlugin } from "../electron/host/plugins/schedules-ipc.mts";

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

    // 重入保护：调度器自身标记运行中时不再触发
    // （真实入口会在本轮结束时推进 nextRun：正常收尾在 markFinished，
    //   主动挂起在 markSleeping——两处都必须推进，见下方回归用例）
    calls.scheduled.length = 0;
    scheduler.running = true;
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, []);
    scheduler.running = false;
  } finally {
    await disposeHost(ctx);
  }
});

// 回归：一个真实事故。计划执行中主动挂起等待长任务（3677 帧 ffmpeg 渲染），
// 挂起路径在壳层提前 return、不经过 markFinished，于是 nextRun 永远停在过去，
// 10s tick 每轮都判定"到期"并新建一个会话跑同一任务 —— 7 分钟内派生出 8 个并发会话。
test("回归：计划挂起后消耗本轮到期额度，tick 不得重复触发同一计划", async (t) => {
  const start = new Date("2026-10-02T08:40:51.127Z");
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "plan-1", name: "每日晨报", recurrence: "daily", nextRun: start.toISOString(), enabled: true, lastStatus: "" },
  ]), "utf8");

  const { ctx, scheduler, calls, setNow } = await makeScheduler(t, { dir, now: () => start });
  try {
    // 第一轮：到期 → 先落 running 再交给壳层
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, ["plan-1"]);
    assert.equal((await scheduler.list())[0].lastStatus, "running");

    // 壳层执行中主动挂起（等待后台渲染）
    await scheduler.markSleeping("plan-1", { wakeAt: "2026-10-02T09:41:00.000Z", reason: "等待渲染完成" }, "sess-1");
    const asleep = (await scheduler.list())[0];
    assert.equal(asleep.lastStatus, "sleeping");
    assert.ok(
      new Date(asleep.nextRun) > start,
      "挂起必须把 nextRun 推进到未来，否则下一 tick 会重复触发（本次事故根因）",
    );

    // 壳层 finally 释放全局 running 后，后续每个 tick 都不得再次触发
    scheduler.running = false;
    calls.scheduled.length = 0;
    for (const at of ["2026-10-02T09:00:00.000Z", "2026-10-02T09:31:00.000Z", "2026-10-02T13:00:00.000Z"]) {
      setNow(new Date(at));
      await scheduler.checkDueSchedules();
    }
    assert.deepEqual(calls.scheduled, [], "挂起期间不得重复触发同一计划");
    assert.equal((await scheduler.list())[0].lastStatus, "sleeping", "跳过时不得被改写成 running");

    // 唤醒续跑收尾：nextRun 已在未来，markFinished 不得二次推进
    const future = (await scheduler.list())[0].nextRun;
    await scheduler.markFinished("plan-1", true, "已完成", "sess-1");
    assert.equal((await scheduler.list())[0].nextRun, future, "已处于未来的 nextRun 不应被二次推进");

    // 到了下一次真实到期时间仍要正常触发：修复不能把计划卡死
    calls.scheduled.length = 0;
    setNow(new Date(new Date(future).getTime() + 1000));
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, ["plan-1"], "下一次真实到期应正常触发");
  } finally {
    await disposeHost(ctx);
  }
});

test("markSleeping：一次性计划挂起时不停用（续跑收尾才停用），且消耗本轮额度", async (t) => {
  const start = new Date("2026-10-02T08:40:51.127Z");
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "once-1", recurrence: "once", nextRun: start.toISOString(), enabled: true, lastStatus: "running" },
  ]), "utf8");

  const { ctx, scheduler, calls, setNow } = await makeScheduler(t, { dir, now: () => start });
  try {
    await scheduler.markSleeping("once-1", { wakeAt: "2026-10-02T09:00:00.000Z", reason: "等渲染" }, "sess-2");
    const item = (await scheduler.list())[0];
    assert.equal(item.lastStatus, "sleeping");
    assert.ok(new Date(item.nextRun) > start, "挂起同样要消耗本轮到期额度");
    // 关键：挂起只是"暂停"，不能在这里就停用。唤醒是"先落 fired 再执行"、
    // 失败不重试，若此刻停用，续跑一旦失败任务就永久丢失。
    assert.equal(item.enabled, true, "一次性计划挂起时不得提前停用");

    scheduler.running = false;
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, [], "nextRun 已推进，挂起期间不得再触发");

    // 续跑真正收尾时才停用（markFinished 对 once 的既有语义）
    setNow(new Date("2026-10-02T08:00:00.000Z"));
    await scheduler.markFinished("once-1", true, "已完成", "sess-2");
    assert.equal((await scheduler.list())[0].enabled, false, "续跑收尾后一次性计划应停用");
  } finally {
    await disposeHost(ctx);
  }
});

// 回归：checkDueSchedules 在「读盘 → 挑 due → 写回 running」之间有两处 await，
// 10s tick / 1.5s bootTimer / 系统唤醒事件 / triggerNow 四个调用方可并发进入，
// 各自读到同一个 due 项并各执行一次。真实事故里两次派生会话只隔 5.301s。
test("回归：checkDueSchedules 并发调用只允许触发一次", async (t) => {
  const dir = await makeTmpDir(t);
  const now = new Date("2026-09-30T10:00:00.000Z");
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "p1", recurrence: "daily", nextRun: "2026-09-30T09:00:00.000Z", enabled: true, lastStatus: "" },
  ]), "utf8");

  const { ctx, scheduler, calls } = await makeScheduler(t, { dir, now: () => now });
  try {
    await Promise.all([
      scheduler.checkDueSchedules(),
      scheduler.checkDueSchedules(),
      scheduler.checkDueSchedules(),
    ]);
    assert.deepEqual(calls.scheduled, ["p1"], "并发进入也只能执行一次");
    assert.equal((await scheduler.list())[0].lastStatus, "running");
  } finally {
    await disposeHost(ctx);
  }
});

// 回归：计划挂起、唤醒仍在册时，到期判定必须跳过它（否则与挂起中的会话并行跑同一任务）。
// 但唤醒一旦被消费/取消，挂起即不成立，计划要能按 nextRun 正常恢复，不能永久卡死。
test("回归：挂起中的计划凭 pending 唤醒免于重复触发，唤醒消失后恢复", async (t) => {
  const start = new Date("2026-09-30T10:00:00.000Z");
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "p2", recurrence: "hourly", nextRun: start.toISOString(), enabled: true, lastStatus: "" },
  ]), "utf8");
  await fs.writeFile(path.join(dir, "wakes.json"), JSON.stringify([
    { id: "w1", sessionId: "sess-2", scheduleId: "p2", workspacePath: "/w", wakeAt: "2026-09-30T12:00:00.000Z", status: "pending" },
  ]), "utf8");

  const { ctx, scheduler, calls, setNow } = await makeScheduler(t, { dir, now: () => start });
  try {
    // 第一轮触发并挂起
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, ["p2"]);
    await scheduler.markSleeping("p2", { wakeAt: "2026-09-30T12:00:00.000Z", reason: "等很久" }, "sess-2");
    scheduler.running = false;

    // hourly 的下一个周期点到达：挂起 + pending 唤醒 → 必须跳过
    calls.scheduled.length = 0;
    setNow(new Date("2026-09-30T11:00:00.000Z"));
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, [], "挂起中且有 pending 唤醒时不得并行再起一轮");
    assert.equal((await scheduler.list())[0].lastStatus, "sleeping", "跳过时不得改写成 running");

    // 唤醒被消费后，挂起不再成立：计划按 nextRun 恢复，不永久卡死
    const wakes = await scheduler.readWakes();
    wakes[0].status = "fired";
    await scheduler.writeWakes(wakes);
    setNow(new Date("2026-09-30T11:30:00.000Z"));
    await scheduler.checkDueSchedules();
    assert.deepEqual(calls.scheduled, ["p2"], "唤醒消失后计划应能恢复触发");
  } finally {
    await disposeHost(ctx);
  }
});

test("triggerNow：挂起中且唤醒在册时拒绝立即执行，避免与等待唤醒的会话双跑", async (t) => {
  const start = new Date("2026-09-30T10:00:00.000Z");
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "schedules.json"), JSON.stringify([
    { id: "p3", recurrence: "daily", nextRun: "2026-12-01T00:00:00.000Z", enabled: true, lastStatus: "sleeping" },
  ]), "utf8");
  await fs.writeFile(path.join(dir, "wakes.json"), JSON.stringify([
    { id: "w2", sessionId: "sess-3", scheduleId: "p3", workspacePath: "/w", wakeAt: "2026-09-30T12:00:00.000Z", status: "pending" },
  ]), "utf8");

  const { ctx, scheduler } = await makeScheduler(t, { dir, now: () => start });
  try {
    const blocked = await scheduler.triggerNow("p3");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /已挂起等待唤醒/);
    assert.equal((await scheduler.list())[0].nextRun, "2026-12-01T00:00:00.000Z", "被拒时不得改动 nextRun");

    // 唤醒取消后允许立即执行
    const wakes = await scheduler.readWakes();
    wakes[0].status = "cancelled";
    await scheduler.writeWakes(wakes);
    assert.equal((await scheduler.triggerNow("p3")).ok, true);
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

// 回归：到期的唤醒若因会话忙碌被推迟，定时器必须**退避**而不是 0 延迟重试。
// 真实事故：0 延迟自旋 → 每秒上千次读 wakes.json → 27K 打开句柄 + 主进程 100% CPU + 内存暴涨。
test("唤醒退避：会话忙碌时推迟的到期唤醒不会 0 延迟自旋", async (t) => {
  const { scheduler, calls } = await makeScheduler(t, { hooks: { isSessionBusy: () => true } });
  // 造一条已到期的唤醒
  const wake = {
    id: "w-busy", sessionId: "s-busy", workspacePath: "/tmp", approvalMode: "interactive",
    wakeAt: "2026-09-30T09:59:00.000Z", reason: "测试", status: "pending",
  };
  await fs.writeFile(path.join(scheduler.file("wakes.json")), JSON.stringify([wake]), "utf8");

  // 记录 setTimeout 被武装的延迟。注意 checkDueWakes 内部是 `void scheduleNextWakeCheck(...)`，
  // 要等它跑完（含一次文件读）再撤钩子，否则观察不到武装动作。
  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...rest) => { delays.push(delay); return realSetTimeout(fn, delay, ...rest); };
  try {
    await scheduler.checkDueWakes();
    for (let i = 0; i < 30 && !delays.length; i += 1) {
      await new Promise((resolve) => realSetTimeout(resolve, 10));
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }

  assert.equal(calls.woke.length, 0, "忙碌时不应真的唤醒");
  assert.ok(delays.length >= 1, "应重新武装定时器");
  assert.ok(delays.every((d) => d >= 10_000), `推迟重试必须退避，实际延迟：${JSON.stringify(delays)}`);

  // 唤醒仍然是 pending（被推迟、没有丢失）
  const wakes = await readJson(scheduler.dir, "wakes.json");
  assert.equal(wakes[0].status, "pending");
});

test("唤醒退避：不忙碌时到期唤醒立即触发（退避不误伤正常路径）", async (t) => {
  const { scheduler, calls } = await makeScheduler(t);
  await fs.writeFile(path.join(scheduler.file("wakes.json")), JSON.stringify([{
    id: "w-ok", sessionId: "s-ok", workspacePath: "/tmp", approvalMode: "interactive",
    wakeAt: "2026-09-30T09:59:00.000Z", reason: "测试", status: "pending",
  }]), "utf8");
  await scheduler.checkDueWakes();
  assert.deepEqual(calls.woke, ["s-ok"], "不忙碌时应正常唤醒");
});

test("唤醒退避：scheduleNextWakeCheck 显式最小延迟会压过 0", async (t) => {
  const { scheduler } = await makeScheduler(t);
  await fs.writeFile(path.join(scheduler.file("wakes.json")), JSON.stringify([{
    id: "w-due", sessionId: "s", workspacePath: "/tmp", approvalMode: "interactive",
    wakeAt: "2026-09-30T09:00:00.000Z", reason: "已到期", status: "pending",
  }]), "utf8");

  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay, ...rest) => { delays.push(delay); return realSetTimeout(fn, delay, ...rest); };
  try {
    await scheduler.scheduleNextWakeCheck({ minDelayMs: 10_000 });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.deepEqual(delays, [10_000], "到期唤醒 + 最小延迟 → 退避 10s，而不是 0");
});

// 渲染端"挂起中"卡片与「立即继续」按钮的数据出口：listPending 只列待唤醒，
// claimPendingForSession 一次性把 pending 转成 fired 并交给壳层立刻续跑。
test("待唤醒查询与立即继续：listPending 只列 pending，claim 一次性取走且不可重复", async (t) => {
  const dir = await makeTmpDir(t);
  await fs.writeFile(path.join(dir, "wakes.json"), JSON.stringify([
    { id: "w-1", sessionId: "s-1", workspacePath: "/w", wakeAt: "2026-10-01T09:00:00.000Z", reason: "等接口恢复", status: "pending" },
    { id: "w-2", sessionId: "s-2", workspacePath: "/w", wakeAt: "2026-10-02T09:00:00.000Z", reason: "已取消", status: "cancelled" },
    { id: "w-3", sessionId: "s-1", workspacePath: "/w", wakeAt: "2026-10-03T09:00:00.000Z", reason: "历史已触发", status: "fired" },
  ]), "utf8");
  const { ctx, scheduler } = await makeScheduler(t, { dir });
  // 屏蔽近邻定时器自续期，避免断言之间异步再跑
  scheduler.scheduleNextWakeCheck = async () => {};
  try {
    assert.deepEqual(await scheduler.listPending(), [
      { sessionId: "s-1", wakeAt: "2026-10-01T09:00:00.000Z", reason: "等接口恢复" },
    ], "只列 status=pending，取消/已触发的历史条目不能当成挂起中");

    const claimed = await scheduler.claimPendingForSession("s-1");
    assert.equal(claimed.id, "w-1");
    assert.equal(claimed.status, "fired");
    assert.ok(claimed.firedAt, "取走时必须落 fired 时间");
    assert.equal(await scheduler.claimPendingForSession("s-1"), null, "同一条不能被取两次（否则会重复续跑）");
    assert.deepEqual(await scheduler.listPending(), []);
    assert.equal(await scheduler.claimPendingForSession("不存在"), null);
  } finally {
    await disposeHost(ctx);
  }
});

// 挂起卡片两个按钮的服务端契约。schedulesIpcPlugin 是纯工厂（不 import electron），
// 可以直接喂假 ctx/trustedHandle 调用，观察守卫是否在"取走待唤醒"之前生效。
test("wakes IPC：「立即继续」受会话占用与后台锁双重守卫，通过后取走待唤醒再续跑", async () => {
  const handlers = new Map();
  const calls = { woke: [], claimed: [] };
  const scheduler = {
    running: false,
    listPending: async () => [{ sessionId: "s-1", wakeAt: "2026-10-01T09:00:00.000Z", reason: "等接口恢复" }],
    claimPendingForSession: async (sid) => {
      calls.claimed.push(sid);
      return sid === "s-1" ? { id: "w-1", sessionId: "s-1" } : null;
    },
    cancelForSession: async () => {},
  };
  schedulesIpcPlugin({
    trustedHandle: (channel, handler) => handlers.set(channel, handler),
    resumeWake: async (wake, options) => { calls.woke.push(wake.id); calls.lastOptions = options; },
    isSessionBusy: (sid) => sid === "s-busy",
  }).apply({ scheduler });

  assert.deepEqual(await handlers.get("wakes:list-pending")(), [
    { sessionId: "s-1", wakeAt: "2026-10-01T09:00:00.000Z", reason: "等接口恢复" },
  ]);

  // 会话自己还在跑：不能插队
  const busy = await handlers.get("wakes:resume-now")(null, "s-busy");
  assert.equal(busy.ok, false);
  assert.match(busy.error, /正在执行任务/);

  // 后台任务占着调度锁：同样不能插队（resumeWake 收尾会把 running 误置 false，等于替别人解锁）
  scheduler.running = true;
  const locked = await handlers.get("wakes:resume-now")(null, "s-1");
  assert.equal(locked.ok, false);
  assert.match(locked.error, /后台任务正在执行/);
  assert.deepEqual(calls.claimed, [], "被守卫拦下时绝不能先取走待唤醒（取走即丢失，到点也不会再唤醒）");

  // 守卫放行：取走 pending 并交给壳层立刻续跑
  scheduler.running = false;
  assert.equal((await handlers.get("wakes:resume-now")(null, "s-1")).ok, true);
  assert.deepEqual(calls.claimed, ["s-1"]);
  assert.deepEqual(calls.woke, ["w-1"]);
  assert.deepEqual(calls.lastOptions, { manual: true }, "手动续跑必须带 manual 标记：界面不能说成「已到点自动唤醒」");

  // 没有待唤醒：给出明确失败而不是静默什么都不做
  const missing = await handlers.get("wakes:resume-now")(null, "s-none");
  assert.equal(missing.ok, false);
  assert.match(missing.error, /没有待唤醒/);
});
