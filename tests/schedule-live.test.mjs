// 定时计划「立即执行」的可见性契约：
// 以前一次运行只在结束（完成/挂起）时才用 sessions:prepend 把整段转录丢给渲染端，
// 一个跑几十分钟的计划在这段时间里界面上什么都没有——用户点了「立即执行」只能干等。
// 现在起跑前先发 schedules:run-started 建会话，运行期用 agent:event（scheduleRun 打标）
// 实时填充，收尾仍用 sessions:prepend，但渲染端按会话 id 归并（不再重复插一条）。
import assert from "node:assert/strict";
import { build } from "esbuild";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createHost } from "../electron/host/context.mts";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyworker-schedule-live-"));
const outfile = path.join(tempDir, "channelStream.mjs");
await build({
  entryPoints: ["src/channelStream.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const { isScheduleRunEnvelope, mergePrependedSession } = await import(pathToFileURL(outfile).href);
test.after(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}); });

// 统一读成 LF，避免 Windows 检出 CRLF 时多行正则失效（同 desktop-contract/channel-stream）
const readSource = (url) => fs.readFileSync(url, "utf8").replace(/\r\n/g, "\n");
const main = readSource(new URL("../electron/main.mts", import.meta.url));
const app = readSource(new URL("../src/App.tsx", import.meta.url));
const preload = readSource(new URL("../electron/preload.cjs", import.meta.url));
const types = readSource(new URL("../src/types.ts", import.meta.url));
const schedulerSource = readSource(new URL("../electron/host/services/scheduler.mts", import.meta.url));

// ---- 纯函数 ----

test("isScheduleRunEnvelope:只有打了 scheduleRun 标记的计划运行事件才消费", () => {
  assert.equal(isScheduleRunEnvelope({ scheduleRun: true }), true);
  assert.equal(isScheduleRunEnvelope({ sessionId: "s1", runId: "r1" }), false, "桌面运行没有标记，必须被拒");
  assert.equal(isScheduleRunEnvelope({ channelRun: true }), false, "渠道运行不是计划运行");
  assert.equal(isScheduleRunEnvelope({ scheduleRun: false }), false);
  assert.equal(isScheduleRunEnvelope(null), false);
  assert.equal(isScheduleRunEnvelope(undefined), false);
});

test("mergePrependedSession:运行开始时建的会话被收尾转录原位归并，不重复插入", () => {
  const optimistic = {
    id: "s1",
    title: "计划：晨报",
    workspacePath: "/w",
    createdAt: "2026-10-02T15:00:00.000Z",
    updatedAt: "2026-10-02T15:00:00.000Z",
    messages: [{ id: "m-user", role: "user", content: "写晨报" }, { id: "m-ph", role: "assistant", content: "" }],
  };
  const other = { id: "s0", title: "别的会话", messages: [] };
  const authoritative = {
    id: "s1",
    title: "计划：晨报",
    workspacePath: "/w",
    createdAt: "2026-10-02T15:00:00.000Z",
    updatedAt: "2026-10-02T15:03:11.000Z",
    messages: [{ id: "m-user", role: "user", content: "写晨报" }, { id: "m-final", role: "assistant", content: "做完了" }],
  };
  const { sessions, merged } = mergePrependedSession([optimistic, other], authoritative);
  assert.equal(merged, true);
  assert.equal(sessions.length, 2, "同 id 会话只能有一条");
  assert.equal(sessions[0].id, "s1", "原位替换：顺序不变");
  assert.equal(sessions[0].messages.length, 2);
  assert.equal(sessions[0].messages[1].content, "做完了", "权威转录必须覆盖流式占位");
  assert.equal(sessions[1].id, "s0");
});

test("mergePrependedSession:没有乐观会话时插到最前；用户改过标题不被覆盖", () => {
  const incoming = { id: "s9", title: "计划：日报", messages: [] };
  const { sessions, merged } = mergePrependedSession([], incoming);
  assert.equal(merged, false);
  assert.deepEqual(sessions, [incoming]);

  const renamed = { id: "s9", title: "我的日报", titleCustom: true, messages: [] };
  const again = mergePrependedSession([renamed], { ...incoming, title: "计划：日报" });
  assert.equal(again.sessions[0].title, "我的日报", "用户手动改过的标题不能被下发标题盖掉");
  assert.equal(again.sessions[0].titleCustom, true);
});

// ---- 调度服务：立即执行到底有没有派发 ----

async function makeScheduler(t, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dyworker-schedule-live-sched-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  const calls = { scheduled: [] };
  const ctx = await createHost({ userDataDir: dir, safeStorage: undefined });
  const scheduler = ctx.get("scheduler");
  Object.assign(scheduler.hooks, {
    now: () => new Date("2026-10-02T10:00:00.000Z"),
    isShuttingDown: () => false,
    isSessionBusy: () => false,
    isSystemBusy: () => false,
    runScheduledTask: async (record, meta) => { calls.scheduled.push({ id: record.id, meta }); },
    broadcast: () => {},
    ...overrides.hooks,
  });
  const saved = await scheduler.save({
    name: "晨报",
    prompt: "写晨报",
    workspacePath: "/w",
    recurrence: "daily",
    nextRun: "2026-10-03T10:00:00.000Z",
  });
  assert.equal(saved.ok, true);
  const [plan] = await scheduler.list();
  return { ctx, scheduler, calls, plan };
}

test("立即执行：空闲时立刻派发，返回值 started=true 且带 manual 标记", async (t) => {
  const { ctx, scheduler, calls, plan } = await makeScheduler(t);
  const result = await scheduler.triggerNow(plan.id);
  assert.equal(result.ok, true);
  assert.equal(result.started, true, "空闲时点击应当立刻派发");
  assert.equal(calls.scheduled.length, 1);
  assert.equal(calls.scheduled[0].id, plan.id);
  assert.equal(calls.scheduled[0].meta.manual, true, "手动触发要打 manual 标记（界面据此打开会话）");
  const [after] = await scheduler.list();
  assert.equal(after.lastStatus, "running");
  ctx.dispose?.();
});

test("立即执行：忙碌守卫拦下时不谎报已开始，started=false 且额度留给下一个 tick", async (t) => {
  const { scheduler, calls, plan } = await makeScheduler(t, { hooks: { isSystemBusy: () => true } });
  const result = await scheduler.triggerNow(plan.id);
  assert.equal(result.ok, true, "点按本身不报错");
  assert.equal(result.started, false, "被忙碌守卫推迟：界面必须说已排队");
  assert.equal(calls.scheduled.length, 0, "这一轮不派发");
  const [after] = await scheduler.list();
  // nextRun 已拨到现在：忙碌结束后下一个 tick 仍会把它跑起来，不会丢
  assert.equal(after.nextRun, "2026-10-02T10:00:00.000Z");
  assert.equal(after.lastStatus, "", "没派发就不该落 running");
});

// ---- 源码契约 ----

test("源码契约:主进程起跑前建会话、运行期实时转发、收尾归并", () => {
  // 起跑前下发 schedules:run-started（渲染端据此立刻建出会话）
  assert.match(main, /webContents\.send\("schedules:run-started",\s*payload\)/);
  assert.match(main, /sendScheduleRunStarted\(\{[\s\S]*?sessionId: scheduleSessionId/);
  // 运行开始就在 try 之外（早于 readSettings 抛错也要发）
  assert.match(main, /const scheduleSessionId = crypto\.randomUUID\(\);[\s\S]*?sendScheduleRunStarted\(/);
  // 运行期实时转发：信封必须打 scheduleRun 标记，事件白名单与渠道共用
  assert.match(main, /scheduleRun:\s*true/);
  assert.match(main, /if \(!CHANNEL_STREAM_EVENT_TYPES\.has\(agentEvent\?\.type\)\) return;/);
  assert.match(main, /emit: \(agentEvent\) => \{[\s\S]*?collector\.handle\(agentEvent\);[\s\S]*?forwardRunEvent\(agentEvent\);/);
  // 收尾三条路径（完成/挂起/失败）都走同一个 finishSession，失败也要收口
  assert.match(main, /const finishSession = async \(messages\) => \{/);
  assert.match(main, /await finishSession\(sleepingMessages\)/);
  assert.match(main, /await finishSession\(collector\.buildMessages\(record\.prompt, result\)\)/);
  assert.match(main, /计划执行失败：\$\{message\}/);
  // manual 透传链路：调度服务 → 壳层
  assert.match(schedulerSource, /checkDueSchedules\(\{ awaitRun: false, manual: true \}\)/);
  assert.match(schedulerSource, /runScheduledTask\(due, \{ manual \}\)/);
  assert.match(main, /runScheduledTask: \(record, meta\) => runScheduledTask\(record, meta\)/);
  // 调度服务必须回传"这一轮到底派发了没有"
  assert.match(schedulerSource, /return \{ ok: true, started: Boolean\(due\) \}/);
});

test("源码契约:渲染端立刻建会话、实时归约、按 id 归并收尾、运行中锁输入", () => {
  // 预加载暴露订阅，类型层声明
  assert.match(preload, /onScheduleRunStarted: \(callback\)/);
  assert.match(preload, /ipcRenderer\.on\("schedules:run-started", listener\)/);
  assert.match(types, /onScheduleRunStarted\?\(callback: \(payload: ScheduleRunStarted\) => void\)/);
  assert.match(types, /interface ScheduleRunStarted \{/);
  assert.match(types, /triggerSchedule\(id: string\): Promise<\{ ok: boolean; error\?: string; started\?: boolean \}>/);
  // 运行开始：立刻建出会话 + 占位气泡 + 运行标记，并登记订阅
  assert.match(app, /onScheduleRunStarted\?\.\(\(payload\) => \{/);
  assert.match(app, /registerStreamMessage\(channelStreamRunsRef\.current, runId, \{ sessionId, messageId: assistantId \}\)/);
  assert.match(app, /setScheduledRunSessions\(\(current\) => new Set\(current\)\.add\(sessionId\)\)/);
  // 实时归约：计划运行的信封走同一套（按 scheduleRun 打标过滤）
  assert.match(app, /isScheduleRunEnvelope\(sessionAgentEvent\)/);
  // 收尾：sessions:prepend 必须按 id 归并 + 清流式登记/运行标记
  assert.match(app, /setSessions\(\(current\) => mergePrependedSession<SessionRecord>\(current, incoming\)\.sessions\)/);
  assert.match(app, /forgetSessionStream\(channelStreamRunsRef\.current, session\.id\)/);
  assert.match(app, /const activeScheduledRun = Boolean\(activeSession\?\.id && scheduledRunSessions\.has\(activeSession\.id\)\)/);
  assert.match(app, /&& !activeScheduledRun/);
  // 手动触发的计划：run-started 到了就把会话推到眼前；被忙碌守卫拦下时说清已排队
  assert.match(app, /manualRunScheduleRef\.current = id/);
  assert.match(app, /result\.started === false/);
  assert.match(app, /这个计划已排队，等它结束后自动开始/);
  // 自动打开走和点侧栏列表项同一条路（切工作区、刷新工作区文件），不是只改 activeId
  assert.match(app, /setPendingAutoOpenSessionId\(sessionId\)/);
  assert.match(app, /const target = sessions\.find\(\(session\) => session\.id === pendingAutoOpenSessionId\)/);
  assert.match(app, /setPendingAutoOpenSessionId\(""\);\s*\n\s*selectSession\(target\)/);
});
