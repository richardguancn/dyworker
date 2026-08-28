import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SESSION_TOOL_NAMES, handleSessionTool, sessionToolDefinitions } from "../electron/session-tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// 固定桩数据：s2 置顶但更旧，s3 无消息应被过滤，s1/s4 用于排序与检索断言
const fixtureSessions = [
  {
    id: "s1",
    title: "请款函修订",
    updatedAt: "2026-08-25T02:00:00Z",
    messages: [
      { role: "user", content: "帮我看下请款函 V5 的付款条件", createdAt: "2026-08-25T01:58:00Z" },
      { role: "tool", content: "read file", createdAt: "2026-08-25T01:59:00Z" },
      { role: "assistant", content: "已修订完成，付款条件已写明。", createdAt: "2026-08-25T02:00:00Z", taskStatus: "done" },
    ],
  },
  {
    id: "s2",
    title: "周报整理",
    pinned: true,
    updatedAt: "2026-08-24T02:00:00Z",
    messages: [
      { role: "user", content: "整理本周周报", createdAt: "2026-08-24T01:58:00Z" },
      { role: "assistant", content: "周报生成失败，模型连接超时。", createdAt: "2026-08-24T02:00:00Z", taskStatus: "error" },
    ],
  },
  { id: "s3", title: "空会话", updatedAt: "2026-08-26T02:00:00Z", messages: [] },
  {
      id: "s4",
      title: "合同检索",
      updatedAt: "2026-08-23T02:00:00Z",
      messages: [
        { role: "user", content: "我们之前讨论过解除协议的条款，里面提到乙方放弃 9 万追索权的表述需要彻底删除，请帮我确认现在的版本还有没有残留这个问题，如果有请标出具体位置", createdAt: "2026-08-23T01:58:00Z" },
        { role: "assistant", content: "解除协议 V2 已删除「已全部结清、不得追索」的旧条款。", createdAt: "2026-08-23T02:00:00Z" },
      ],
    },
];

const call = (name, args) => handleSessionTool(name, args, { sessions: fixtureSessions });

// ---- 工具定义 ----

test("sessionToolDefinitions:三个只读工具,定义形状与内置一致", () => {
  const definitions = sessionToolDefinitions();
  assert.deepEqual(definitions.map((tool) => tool.function.name), ["list_sessions", "search_sessions", "read_session"]);
  assert.ok(definitions.every((tool) => tool.type === "function"));
  assert.ok(definitions.every((tool) => tool.function.description.length >= 10));
  assert.deepEqual(definitions.find((tool) => tool.function.name === "search_sessions").function.parameters.required, ["keyword"]);
  assert.deepEqual(definitions.find((tool) => tool.function.name === "read_session").function.parameters.required, ["sessionId"]);
  // 定义的名字集合与分发白名单一致
  assert.deepEqual(new Set(definitions.map((tool) => tool.function.name)), SESSION_TOOL_NAMES);
});

// ---- list_sessions ----

test("list_sessions:置顶优先再按更新时间倒序,过滤无消息会话,带最近任务状态", () => {
  const { ok, result } = call("list_sessions", {});
  assert.equal(ok, true);
  const lines = result.split("\n").filter((line) => /^\d+\./.test(line));
  assert.deepEqual(lines.map((line) => line.includes("s2") ? "s2" : line.includes("s1") ? "s1" : line.includes("s4") ? "s4" : "?"), ["s2", "s1", "s4"]);
  assert.ok(result.includes("最近任务:done"));
  assert.ok(result.includes("最近任务:error"));
  assert.ok(result.includes("帮我看下请款函 V5 的付款条件"));
  // 无消息的空会话不出现
  assert.ok(!result.includes("空会话"));
});

test("list_sessions:query 按标题或正文过滤", () => {
  const byTitle = call("list_sessions", { query: "请款函" });
  assert.equal(byTitle.ok, true);
  assert.ok(byTitle.result.includes("s1"));
  assert.ok(!byTitle.result.includes("s2"));
  const byContent = call("list_sessions", { query: "追索权" });
  assert.equal(byContent.ok, true);
  assert.ok(byContent.result.includes("s4"));
  assert.ok(!byContent.result.includes("s1"));
});

test("list_sessions:limit 截断并提示剩余数量;无命中时给出引导文案", () => {
  const limited = call("list_sessions", { limit: 2 });
  assert.equal(limited.ok, true);
  assert.ok(limited.result.includes("还有 1 个更早的会话未列出"));
  const none = call("list_sessions", { query: "不存在的关键词xyz" });
  assert.equal(none.ok, true);
  assert.ok(none.result.includes("没有找到匹配的会话"));
});

// ---- search_sessions ----

test("search_sessions:大小写不敏感,命中片段带会话与角色标注", () => {
  const { ok, result } = call("search_sessions", { keyword: "追索权" });
  assert.equal(ok, true);
  assert.ok(result.includes("s4"));
  assert.ok(result.includes("合同检索"));
  assert.ok(result.includes("[用户"));
  assert.ok(result.includes("…"));
  const upper = call("search_sessions", { keyword: "V5" });
  assert.equal(upper.ok, true);
  assert.ok(upper.result.includes("s1"));
});

test("search_sessions:缺关键词报错,无命中友好提示", () => {
  const missing = call("search_sessions", {});
  assert.equal(missing.ok, false);
  assert.ok(missing.result.includes("缺少搜索关键词"));
  const none = call("search_sessions", { keyword: "绝不存在的词xyz" });
  assert.equal(none.ok, true);
  assert.ok(none.result.includes("没有找到"));
});

test("search_sessions:limit 截断命中条数", () => {
  const sessions = [
    {
      id: "a",
      title: "多命中会话",
      updatedAt: "2026-08-25T02:00:00Z",
      messages: Array.from({ length: 5 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `关键词出现第${index}次`,
        createdAt: `2026-08-25T0${index}:00:00Z`,
      })),
    },
  ];
  const { ok, result } = handleSessionTool("search_sessions", { keyword: "关键词", limit: 2 }, { sessions });
  assert.equal(ok, true);
  assert.equal(result.split("\n").filter((line) => line.startsWith("- [")).length, 2);
  assert.ok(result.includes("已截断"));
});

// ---- read_session ----

test("read_session:按时间顺序输出正文,过滤工具消息,缺参会报错", () => {
  const { ok, result } = call("read_session", { sessionId: "s1" });
  assert.equal(ok, true);
  const userIndex = result.indexOf("[用户");
  const assistantIndex = result.indexOf("[助手");
  assert.ok(userIndex >= 0 && assistantIndex > userIndex);
  assert.ok(result.includes("付款条件已写明"));
  // tool 消息不进正文
  assert.ok(!result.includes("read file"));
  const missing = call("read_session", {});
  assert.equal(missing.ok, false);
  assert.ok(missing.result.includes("缺少会话 id"));
});

test("read_session:未知 id 友好提示;lastN 只取最近 N 条", () => {
  const unknown = call("read_session", { sessionId: "nope" });
  assert.equal(unknown.ok, true);
  assert.ok(unknown.result.includes("没有找到 id 为 nope"));
  const sessions = [
    {
      id: "b",
      title: "长对话",
      updatedAt: "2026-08-25T02:00:00Z",
      messages: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `消息${index}`,
        createdAt: `2026-08-25T0${index % 10}:00:00Z`,
      })),
    },
  ];
  const { ok, result } = handleSessionTool("read_session", { sessionId: "b", lastN: 3 }, { sessions });
  assert.equal(ok, true);
  assert.ok(result.includes("共 10 条消息"));
  assert.ok(result.includes("消息9"));
  assert.ok(!result.includes("消息6"));
});

test("read_session:单条超长正文截断且总体积受预算约束", () => {
  const longText = "长".repeat(3000);
  const sessions = [
    {
      id: "c",
      title: "超长消息",
      updatedAt: "2026-08-25T02:00:00Z",
      messages: [
        { role: "user", content: longText, createdAt: "2026-08-25T01:00:00Z" },
        { role: "assistant", content: "收到", createdAt: "2026-08-25T02:00:00Z" },
      ],
    },
  ];
  const { ok, result } = handleSessionTool("read_session", { sessionId: "c" }, { sessions });
  assert.equal(ok, true);
  assert.ok(result.includes("该条已截断"));
  assert.ok(result.length < longText.length);
});

// ---- 分发与主进程接线 ----

test("handleSessionTool:未知工具与异常输入都返回 ok:false 文本,不抛出", () => {
  const unknown = call("nope", {});
  assert.equal(unknown.ok, false);
  assert.ok(unknown.result.includes("没有找到会话工具"));
  const nullArgs = handleSessionTool("list_sessions", null, { sessions: null });
  assert.equal(nullArgs.ok, true);
  assert.ok(nullArgs.result.includes("没有找到匹配的会话"));
});

test("main.mjs 接线契约:extraTools 含会话工具,路由优先于浏览器/MCP,渠道 fall through 可达", () => {
  const source = readFileSync(path.join(here, "../electron/main.mjs"), "utf8");
  // 工具定义注入 agentExtraTools(四处 runAgent 共用)
  assert.match(source, /function agentExtraTools\(mcpTools\) \{[\s\S]*?sessionToolDefinitions\(\)/);
  // createExtraToolRouter 的路由里会话工具先于 browser__/MCP 判定
  assert.match(source, /SESSION_TOOL_NAMES\.has\(String\(name\)\)[\s\S]*?handleSessionTool\(name, args, \{ sessions \}\)[\s\S]*?name\.startsWith\("browser__"\)/);
  // 渠道自定义路由最终 fall through 到 baseRouter(createExtraToolRouter 实例),会话工具可达
  assert.match(source, /return baseRouter\(name, args\);/);
});
