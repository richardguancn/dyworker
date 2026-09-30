import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CHECKPOINT_MS,
  IDLE_TIMEOUT_MS,
  MAX_INTERVAL_MS,
  createActivityTracker,
  nextShanghaiMidnightUtc,
  shanghaiDayKey,
  splitIntervalByDay,
} from "../electron/telemetry.mjs";
import { createTelemetryStore } from "../electron/telemetry-store.mjs";
import { normalizeTelemetrySettings } from "../electron/settings.mjs";

// ---- 可控时钟的活动状态机（方案 §4.2/§12 用例）----

function makeClock(startWallMs) {
  const clock = { wall: startWallMs, mono: 0 };
  clock.now = () => clock.wall;
  clock.monotonicNow = () => clock.mono;
  clock.advance = (ms) => {
    clock.wall += ms;
    clock.mono += ms;
  };
  return clock;
}

// 前台默认态：可见、未最小化、聚焦
const FOREGROUND = { visible: true, minimized: false, focused: true };

function sumEvents(events) {
  return events.filter((event) => event.type === "usage_interval")
    .reduce((total, event) => total + event.duration_ms, 0);
}

test("上海时区工具：日期键、午夜边界与跨天拆分", () => {
  assert.equal(shanghaiDayKey(Date.parse("2026-09-28T16:00:00Z")), "2026-09-29"); // UTC 16点 = 上海次日 0 点
  const midnight = nextShanghaiMidnightUtc(Date.parse("2026-09-28T15:58:00Z")); // 上海 23:58
  assert.equal(midnight, Date.parse("2026-09-28T16:00:00Z")); // 上海 00:00 = UTC 16:00
  const segments = splitIntervalByDay(Date.parse("2026-09-28T15:58:00Z"), Date.parse("2026-09-28T16:03:00Z"));
  assert.equal(segments.length, 2);
  assert.equal(segments[0].end - segments[0].start, 2 * 60_000);
  assert.equal(segments[1].end - segments[1].start, 3 * 60_000);
  assert.equal(shanghaiDayKey(segments[0].start), "2026-09-28");
  assert.equal(shanghaiDayKey(segments[1].start), "2026-09-29");
});

test("首个合格交互立即产出 app_activity；随后交互不再重复产出", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const first = tracker.noteInteraction();
  assert.equal(first.length, 1);
  assert.equal(first[0].type, "app_activity");
  assert.equal(first[0].occurred_at, new Date(clock.now()).toISOString());
  clock.advance(5_000);
  assert.deepEqual(tracker.noteInteraction(), []);
  assert.equal(tracker.status().activityEmitted, true);
});

test("前台交互 10 分钟 + 切走 20 分钟 + 回来 5 分钟 ≈ 15 分钟", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  // 前 10 分钟：每 30 秒交互一次，每 5 秒 tick
  for (let elapsed = 0; elapsed < 10 * 60_000; elapsed += 5_000) {
    clock.advance(5_000);
    if (elapsed % 30_000 === 0) events.push(...tracker.noteInteraction());
    events.push(...tracker.tick());
  }
  // 切走 20 分钟：blur 立即封口，期间不计时
  events.push(...tracker.noteWindowState({ visible: true, minimized: false, focused: false }));
  for (let elapsed = 0; elapsed < 20 * 60_000; elapsed += 5_000) {
    clock.advance(5_000);
    events.push(...tracker.tick());
  }
  assert.equal(tracker.status().active, false);
  // 回来交互 5 分钟
  events.push(...tracker.noteWindowState(FOREGROUND));
  events.push(...tracker.noteInteraction());
  for (let elapsed = 0; elapsed < 5 * 60_000; elapsed += 5_000) {
    clock.advance(5_000);
    if (elapsed % 30_000 === 0) events.push(...tracker.noteInteraction());
    events.push(...tracker.tick());
  }
  events.push(...tracker.seal("end"));
  const total = sumEvents(events);
  // 目标 15 分钟；边界误差每次不超过 5 秒（切走/回来各一次）
  assert.ok(Math.abs(total - 15 * 60_000) <= 15_000, `总时长 ${total}ms 偏离 15 分钟超过 15 秒`);
  // 区间是左闭右开的分段并集：没有把切走的 20 分钟填上
  assert.ok(total < 20 * 60_000);
});

test("最后一次输入后一直不操作：最多计入 120 秒阅读宽限", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  for (let elapsed = 0; elapsed < 4 * 60_000; elapsed += 5_000) {
    clock.advance(5_000);
    events.push(...tracker.tick());
  }
  const total = sumEvents(events);
  assert.equal(total, IDLE_TIMEOUT_MS);
  assert.equal(tracker.status().active, false);
});

test("持续操作 23:58–次日 00:03：两天分别计 2 分钟、3 分钟，均活跃", () => {
  const clock = makeClock(Date.parse("2026-09-28T15:58:00Z")); // 上海 23:58
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  for (let elapsed = 0; elapsed < 5 * 60_000; elapsed += 5_000) {
    clock.advance(5_000);
    events.push(...tracker.noteInteraction());
    events.push(...tracker.tick());
  }
  events.push(...tracker.seal("end"));
  const intervals = events.filter((event) => event.type === "usage_interval");
  const byDate = new Map();
  for (const event of intervals) {
    byDate.set(event.date, (byDate.get(event.date) || 0) + event.duration_ms);
  }
  assert.equal(byDate.get("2026-09-28"), 2 * 60_000);
  assert.equal(byDate.get("2026-09-29"), 3 * 60_000);
});

test("检查间隔异常（卡顿/休眠脱钩）：保守丢弃不确定间隔并打质量标志", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  clock.advance(5_000);
  events.push(...tracker.tick());
  // 60 秒没有 tick：超过 15 秒无连续状态证据
  clock.advance(60_000);
  events.push(...tracker.tick());
  const sealed = events.filter((event) => event.type === "usage_interval");
  assert.equal(sealed.length, 1);
  assert.ok(sealed[0].quality_flags.includes("uncertain-gap-dropped"));
  // 不确定间隔不计入：只有已确认的 5 秒
  assert.equal(sumEvents(events), 5_000);
  // 恢复后需要新的人工交互才重新开始
  assert.equal(tracker.status().active, false);
  clock.advance(5_000);
  events.push(...tracker.tick());
  assert.equal(tracker.status().active, false);
  events.push(...tracker.noteInteraction());
  assert.equal(tracker.status().active, true);
});

test("墙上时间被改动（与单调时钟脱钩）：区间按已确认进度封口并打 clock-anomaly", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  clock.advance(5_000);
  events.push(...tracker.tick());
  clock.wall += 10 * 60_000; // 系统时间被拨快 10 分钟，单调时钟只走了 5 秒
  clock.mono += 5_000;
  events.push(...tracker.tick());
  const sealed = events.filter((event) => event.type === "usage_interval");
  assert.ok(sealed.some((event) => event.quality_flags.includes("clock-anomaly")));
  assert.ok(sumEvents(events) <= 15_000, "时钟跳变期间不多算时长");
});

test("睡眠立即封口；恢复后不把锁屏/睡眠间隔补记，需新交互才重新计时", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  clock.advance(10_000);
  events.push(...tracker.tick());
  events.push(...tracker.noteSuspend());
  assert.equal(tracker.status().active, false);
  // 睡眠 8 小时（墙上时间流逝、单调时钟同步推进模拟）
  clock.advance(8 * 60 * 60_000);
  tracker.noteResume();
  events.push(...tracker.tick());
  assert.equal(tracker.status().active, false);
  const total = sumEvents(events);
  assert.ok(total <= 15_000, `睡眠时间未被计入（实际 ${total}ms）`);
});

test("锁屏立即封口；解锁后重新锚定", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  clock.advance(10_000);
  events.push(...tracker.tick());
  events.push(...tracker.noteLocked());
  clock.advance(60_000);
  tracker.noteUnlocked();
  events.push(...tracker.tick());
  assert.equal(sumEvents(events), 10_000);
});

test("长区间最多每 5 分钟封口一次；封口后继续交互则续开新区间", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  // 进度封口调大到 10 分钟，让 5 分钟上限先触发（默认 15 秒进度封口时上限是兜底）
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow, checkpointMs: 10 * 60_000 });
  const events = [...tracker.noteInteraction()];
  for (let elapsed = 0; elapsed < 11 * 60_000; elapsed += 5_000) {
    clock.advance(5_000);
    events.push(...tracker.noteInteraction());
    events.push(...tracker.tick());
  }
  events.push(...tracker.seal("end"));
  const intervals = events.filter((event) => event.type === "usage_interval");
  for (const event of intervals) {
    assert.ok(event.duration_ms <= MAX_INTERVAL_MS, `区间 ${event.duration_ms}ms 超过 5 分钟上限`);
  }
  const capped = intervals.find((event) => event.quality_flags.includes("capped"));
  assert.ok(capped, "存在因 5 分钟上限封口的区间");
  assert.equal(capped.duration_ms, MAX_INTERVAL_MS);
  // 封口后继续交互：仍有后续区间（续开）
  assert.ok(intervals.length >= 2);
  // 总时长按并集：11 分钟不被封口吃掉
  const total = sumEvents(events);
  assert.ok(Math.abs(total - 11 * 60_000) <= 5_000, `总时长 ${total}ms`);
});

test("每 15 秒封口一次已确认进度（强杀进程最多损失 15 秒）", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  clock.advance(CHECKPOINT_MS);
  events.push(...tracker.tick());
  const sealed = events.filter((event) => event.type === "usage_interval");
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0].duration_ms, CHECKPOINT_MS);
  assert.ok(sealed[0].quality_flags.includes("checkpoint"));
  // 封口后仍在交互：续开新区间
  assert.equal(tracker.status().active, true);
});

test("电脑操控期间保守暂停人工计时，结束后需重新交互", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({ now: clock.now, monotonicNow: clock.monotonicNow });
  const events = [...tracker.noteInteraction()];
  clock.advance(5_000);
  events.push(...tracker.tick());
  events.push(...tracker.setAutomationActive(true));
  for (let elapsed = 0; elapsed < 60_000; elapsed += 5_000) {
    clock.advance(5_000);
    events.push(...tracker.tick());
  }
  assert.equal(sumEvents(events), 5_000);
  events.push(...tracker.setAutomationActive(false));
  clock.advance(5_000);
  events.push(...tracker.tick());
  assert.equal(tracker.status().active, false);
  events.push(...tracker.noteInteraction());
  assert.equal(tracker.status().active, true);
});

test("事件字段：同一 run_id、递增序号、口径版本与版本信息齐全", () => {
  const clock = makeClock(Date.parse("2026-09-28T02:00:00Z"));
  const tracker = createActivityTracker({
    now: clock.now,
    monotonicNow: clock.monotonicNow,
    appVersion: "0.2.2",
    platform: "darwin",
    arch: "arm64",
    releaseChannel: "stable",
  });
  const events = [...tracker.noteInteraction()];
  clock.advance(15_000);
  events.push(...tracker.tick());
  clock.advance(15_000);
  events.push(...tracker.noteInteraction());
  events.push(...tracker.tick());
  clock.advance(5_000);
  events.push(...tracker.seal("end"));
  const runIds = new Set(events.map((event) => event.run_id));
  assert.equal(runIds.size, 1);
  const seqs = events.map((event) => event.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  for (const event of events) {
    assert.equal(event.schema_version, 1);
    assert.equal(event.metric_version, 1);
    assert.equal(event.app_version, "0.2.2");
    assert.equal(event.platform, "darwin");
    assert.equal(event.timezone, "Asia/Shanghai");
    assert.ok(/^[0-9a-f-]{36}$/.test(event.event_id));
  }
  for (const event of events.filter((item) => item.type === "usage_interval")) {
    assert.ok(event.started_at < event.ended_at);
  }
});

// ---- 本地队列存储 ----

async function tmpStore(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-telemetry-"));
  const store = createTelemetryStore({ file: path.join(dir, "queue.json"), ...options });
  return { store, dir };
}

function makeEvent(id, sizePad = "") {
  return { event_id: id, type: "usage_interval", duration_ms: 5_000, pad: sizePad };
}

test("队列：入队、逐条确认删除、重复 event_id 不重复入队", async () => {
  const { store } = await tmpStore();
  await store.enqueue([makeEvent("a"), makeEvent("b"), makeEvent("c")]);
  assert.equal(await store.count(), 3);
  // 同一 event_id 重试入队不产生新记录
  await store.enqueue([makeEvent("a")]);
  assert.equal(await store.count(), 3);
  const pending = await store.pending();
  assert.deepEqual(pending.map((event) => event.event_id), ["a", "b", "c"]);
  // accepted + duplicate 都确认删除
  await store.acknowledge({ accepted: ["a"], rejected: [] });
  await store.acknowledge({ accepted: [], rejected: [] });
  assert.equal(await store.count(), 2);
  // rejected 的无效记录单独移除，不阻塞整批
  await store.acknowledge({ accepted: ["b"], rejected: ["c"] });
  assert.equal(await store.count(), 0);
});

test("队列：字节数超限丢弃最旧并累计覆盖缺口", async () => {
  const { store } = await tmpStore({ maxBytes: 300, maxAgeMs: 60_000 });
  await store.enqueue([makeEvent("old", "x".repeat(200))]);
  await store.enqueue([makeEvent("new", "y".repeat(150))]);
  const stats = await store.stats();
  assert.equal(stats.pending, 1);
  assert.ok(stats.droppedOverflow >= 1, "超限丢弃应计数");
  const pending = await store.pending();
  assert.equal(pending[0].event_id, "new");
});

test("队列：超过保留期（7 天）的记录被淘汰", async () => {
  let nowMs = Date.parse("2026-09-28T00:00:00Z");
  const { store } = await tmpStore({ now: () => nowMs, maxAgeMs: 7 * 24 * 60 * 60_000 });
  await store.enqueue([makeEvent("stale"), makeEvent("fresh")]);
  nowMs += 8 * 24 * 60 * 60_000;
  // 触发一次入队以执行容量检查
  await store.enqueue([makeEvent("later")]);
  const pending = await store.pending();
  assert.ok(pending.some((event) => event.event_id === "later"));
  assert.ok(!pending.some((event) => event.event_id === "stale"), "超过 7 天的旧记录被淘汰");
  assert.ok(!pending.some((event) => event.event_id === "fresh"), "fresh 入队已 8 天同样过期");
});

test("队列：关闭统计时清空且缺口计数归零；内容持久化到磁盘", async () => {
  const { store, dir } = await tmpStore();
  await store.enqueue([makeEvent("a")]);
  const raw = JSON.parse(await fs.readFile(path.join(dir, "queue.json"), "utf8"));
  assert.equal(raw.records.length, 1);
  await store.clear();
  assert.equal(await store.count(), 0);
  const stats = await store.stats();
  assert.equal(stats.droppedOverflow, 0);
});

// ---- 设置规范化 ----

test("统计与消息设置规范化：HTTPS 限制、尾斜杠清理、免打扰校验", () => {
  const normalized = normalizeTelemetrySettings({
    statsEnabled: true,
    messagesEnabled: true,
    serviceUrl: "https://ops.example.com/",
    quietHours: "22:00-08:00",
    dailyPopupLimit: 5,
  });
  assert.equal(normalized.serviceUrl, "https://ops.example.com");
  assert.equal(normalized.quietHours, "22:00-08:00");
  assert.equal(normalized.dailyPopupLimit, 5);

  assert.equal(normalizeTelemetrySettings({ serviceUrl: "http://ops.example.com" }).serviceUrl, "");
  assert.equal(normalizeTelemetrySettings({ serviceUrl: "https://ops.example.com/?x=1" }).serviceUrl, "");
  assert.equal(normalizeTelemetrySettings({ serviceUrl: "not a url" }).serviceUrl, "");

  const defaults = normalizeTelemetrySettings(undefined);
  assert.equal(defaults.statsEnabled, false, "统计默认关闭");
  assert.equal(defaults.messagesEnabled, false, "消息订阅默认关闭");
  assert.equal(defaults.notifyNewMessages, true);
  assert.equal(defaults.notifyMarketing, false, "营销类默认只进消息中心");
  assert.equal(defaults.dailyPopupLimit, 3);
  assert.equal(normalizeTelemetrySettings({ quietHours: "25:00-99:00" }).quietHours, "");
});
