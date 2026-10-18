import assert from "node:assert/strict";
import test from "node:test";

import { findWorkspaceBlockers, normalizeWorkspacePath } from "../electron/workspace-busy.mts";

// 渠道任务判忙的判定逻辑：只有同一工作区才互斥。
// 回归点：早前渠道消息等的是"整机空闲"，任何工作区的桌面任务都会把它挡到 10 分钟超时。

test("normalizeWorkspacePath:末尾分隔符与首尾空白不影响同一目录判定", () => {
  assert.equal(normalizeWorkspacePath("/Users/a/app/"), "/Users/a/app");
  assert.equal(normalizeWorkspacePath("  /Users/a/app///  "), "/Users/a/app");
  assert.equal(normalizeWorkspacePath("C:\\work\\proj\\"), "C:\\work\\proj");
  assert.equal(normalizeWorkspacePath(""), "");
  assert.equal(normalizeWorkspacePath(null), "");
});

test("findWorkspaceBlockers:不同工作区的任务不再挡住渠道消息", () => {
  const entries = [
    { sessionId: "desktop-1", workspacePath: "/Users/gdy/Documents/My/App/jie2", kind: "电脑端任务" },
    { sessionId: "schedule-1", workspacePath: "/Users/gdy/Documents/My/App/other", kind: "定时任务" },
  ];
  assert.deepEqual(findWorkspaceBlockers(entries, "/Users/gdy/Documents/My/App/dyworker"), []);
});

test("findWorkspaceBlockers:同工作区的任务、含末尾分隔符写法，仍算占用", () => {
  const entries = [
    { sessionId: "desktop-1", workspacePath: "/Users/gdy/Documents/My/App/dyworker/", kind: "电脑端任务" },
  ];
  const blockers = findWorkspaceBlockers(entries, "/Users/gdy/Documents/My/App/dyworker");
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].sessionId, "desktop-1");
  assert.equal(blockers[0].kind, "电脑端任务");
});

test("findWorkspaceBlockers:同工作区的定时任务与其他渠道任务也被识别", () => {
  const entries = [
    { sessionId: "schedule-1", workspacePath: "/w", kind: "定时任务" },
    { sessionId: "channel-1", workspacePath: "/w", kind: "渠道任务" },
  ];
  const kinds = findWorkspaceBlockers(entries, "/w").map((item) => item.kind);
  assert.deepEqual(kinds, ["定时任务", "渠道任务"]);
});

test("findWorkspaceBlockers:可忽略自身占用，避免自锁", () => {
  const entries = [{ sessionId: "self", workspacePath: "/w", kind: "渠道任务" }];
  assert.deepEqual(findWorkspaceBlockers(entries, "/w", "self"), []);
  assert.equal(findWorkspaceBlockers(entries, "/w", "other").length, 1);
});

test("findWorkspaceBlockers:工作区未知时不阻塞，交给后续的空工作区报错", () => {
  const entries = [{ sessionId: "desktop-1", workspacePath: "/w", kind: "电脑端任务" }];
  assert.deepEqual(findWorkspaceBlockers(entries, ""), []);
  assert.deepEqual(findWorkspaceBlockers(entries, null), []);
  assert.deepEqual(findWorkspaceBlockers(entries, "   "), []);
});

test("findWorkspaceBlockers:缺少 kind 时给出通用标签，条目为空也不崩", () => {
  const entries = [null, { sessionId: "d", workspacePath: "/w" }];
  const blockers = findWorkspaceBlockers(entries, "/w");
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].kind, "任务");
  assert.deepEqual(findWorkspaceBlockers(undefined, "/w"), []);
});
