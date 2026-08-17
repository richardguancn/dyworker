// taskTrace 归约层单测（process-chain Phase 2）：
// src/taskTrace.ts 是 TypeScript，Node 18 无法直接加载，用 esbuild（vite 依赖）转译为 ESM 后测试。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "dyworker-tasktrace-test-"));
const outfile = path.join(tempDir, "taskTrace.mjs");
await build({
  entryPoints: ["src/taskTrace.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const { buildTaskTrace, traceEventsToAgentEvents } = await import(pathToFileURL(outfile).href);

const act = (id, kind, title, extra = {}) => ({
  type: "activity",
  activity: { id, kind, title, detail: "", status: "running", ...extra },
});
const upd = (id, status, extra = {}) => ({ type: "activity-update", id, status, ...extra });

test("taskTrace：计划步骤、活动挂接、verify 失败后 fix 配对重试组", () => {
  const events = [
    {
      type: "plan-update",
      steps: [
        { id: "p1", title: "查看文件", status: "in_progress" },
        { id: "p2", title: "修改文件", status: "pending" },
      ],
    },
    act("a1", "list_files", "查看文件夹", { stepId: "p1", phase: "execute" }),
    upd("a1", "success"),
    act("a2", "run_command", "运行命令：npm run verify", { stepId: "p1", phase: "verify" }),
    upd("a2", "error"),
    act("a3", "run_command", "运行命令：npm run verify", { stepId: "p1", phase: "fix" }),
    upd("a3", "success"),
    act("a4", "write_file", "写入 notes.md", { stepId: "p2", phase: "execute" }),
    upd("a4", "success"),
    { type: "file-change", changes: [{ path: "notes.md", added: 3, removed: 0 }] },
    { type: "agent-finished", result: { status: "done", finalText: "已完成。" } },
  ];
  const trace = buildTaskTrace(events, "完成一个任务");
  assert.equal(trace.hasTrace, true, "带新字段的事件应标记为有轨迹");
  assert.equal(trace.request, "完成一个任务");
  assert.equal(trace.steps.length, 2, "两个计划步骤");
  assert.equal(trace.steps[0].id, "p1");
  // 活动按步骤挂接
  assert.ok(trace.steps[0].activities.some((a) => a.id === "a1"), "list_files 挂在步骤 p1");
  assert.ok(!trace.steps[0].activities.some((a) => a.id === "a4"), "write_file 不挂在 p1");
  assert.ok(trace.steps[1].activities.some((a) => a.id === "a4"), "write_file 挂在 p2");
  // 失败→修复重试组
  assert.equal(trace.steps[0].retries.length, 1, "应配对一个重试组");
  assert.equal(trace.steps[0].retries[0].failed.id, "a2");
  assert.equal(trace.steps[0].retries[0].fixed.id, "a3");
  // 交付信息
  assert.ok(trace.deliver, "应有交付信息");
  assert.equal(trace.deliver?.text, "已完成。");
  // 无分支
  assert.equal(trace.branches.length, 0);
});

test("taskTrace：子代理分支归并、老会话降级", () => {
  const events = [
    act("m1", "dispatch_agent", "派发子任务甲", { stepId: "p1", phase: "execute" }),
    upd("m1", "success"),
    // 子代理分支活动（带 branch）
    act("s1", "read_file", "读取资料", { branch: { parentId: "m1", title: "子任务甲", depth: 1 }, phase: "execute" }),
    upd("s1", "success", { branch: { parentId: "m1", title: "子任务甲", depth: 1 } }),
    act("s2", "web_search", "搜索资料", { branch: { parentId: "m1", title: "子任务甲", depth: 1 }, phase: "execute" }),
    upd("s2", "success", { branch: { parentId: "m1", title: "子任务甲", depth: 1 } }),
    { type: "agent-finished", result: { status: "done", finalText: "完成。" } },
  ];
  const trace = buildTaskTrace(events, "并行调研");
  assert.equal(trace.branches.length, 1, "应归并出一个子代理分支");
  assert.equal(trace.branches[0].title, "子任务甲");
  assert.equal(trace.branches[0].depth, 1);
  assert.equal(trace.branches[0].activities.length, 2, "分支内两个活动");
  // 分支活动不进主步骤
  const mainActivities = trace.steps.flatMap((step) => step.activities);
  assert.ok(!mainActivities.some((a) => a.id === "s1"), "子代理活动不混入主活动流");

  // 老会话：只有旧字段 → hasTrace=false
  const legacy = buildTaskTrace([
    act("l1", "list_files", "查看文件夹"),
    upd("l1", "success"),
    { type: "agent-finished", result: { status: "done", finalText: "完成。" } },
  ]);
  assert.equal(legacy.hasTrace, false, "无新字段的老会话应降级");
  assert.equal(legacy.steps.length, 1, "老会话退化为默认步骤");
});

test("taskTrace：trace 事件回放可还原归约（历史会话回放路径）", () => {
  const traces = [
    { seq: 1, kind: "activity", title: "查看文件夹", content: "", activityId: "a1", phase: "execute", stepId: "p1" },
    { seq: 2, kind: "activity-update", title: "a1", content: "success", activityId: "a1", status: "success" },
    { seq: 3, kind: "plan-update", title: "计划更新", content: JSON.stringify([{ id: "p1", title: "查看文件", status: "in_progress" }]) },
    { seq: 4, kind: "agent-finished", title: "任务结束", content: JSON.stringify({ status: "done", finalText: "完成。" }) },
  ];
  const events = traceEventsToAgentEvents(traces);
  const trace = buildTaskTrace(events);
  assert.equal(trace.hasTrace, true);
  assert.ok(trace.steps.some((step) => step.id === "p1"), "回放的 plan 步骤应还原");
  assert.ok(trace.steps[0].activities.some((a) => a.id === "a1"), "回放的活动应挂到步骤");
  assert.equal(trace.deliver?.text, "完成。");
});
