import assert from "node:assert/strict";
import test from "node:test";

// 原生轨迹模型：把我们的 TraceEvent 流归一成"轮次 → 步进 → 请求 → 工具调用"。
// 用与真实落盘事件同形的合成数据，覆盖配对、时长、标记、指标与搜索。

const { buildTraceModel, traceMatches, formatDuration, formatTokens } = await import("../src/traceModel.ts");

function requestEvent(seq, turn, step, time, payload = {}) {
  return {
    seq, turn, step, time, kind: "model-request", direction: "in", target: "model",
    title: `请求模型（第 ${turn} 轮）`,
    content: JSON.stringify({
      endpoint: payload.endpoint ?? "https://api.example/v1/responses",
      model: payload.model ?? "glm-4.6",
      messages: payload.messages ?? [{ role: "user", content: payload.user ?? "你好" }],
    }),
  };
}

test("轨迹模型：请求 / 响应 / 用量按 parentSeq 配对，并算出时长", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-01T18:00:00.000Z", { user: "帮我写个脚本" }),
    { seq: 2, turn: 1, step: 0, time: "2026-10-01T18:00:04.000Z", kind: "token-usage", direction: "out", target: "model", title: "token 用量", content: "", parentSeq: 1, usage: { prompt: 1200, completion: 340, estimated: false } },
    { seq: 3, turn: 1, step: 0, time: "2026-10-01T18:00:05.000Z", kind: "model-response", direction: "out", target: "model", title: "模型响应", parentSeq: 1, content: JSON.stringify({ role: "assistant", content: "好的，这是脚本" }) },
  ];
  const model = buildTraceModel(events);
  assert.equal(model.turns.length, 1);
  const turn = model.turns[0];
  assert.equal(turn.turn, 1);
  assert.equal(turn.steps.length, 1);
  const request = turn.steps[0].requests[0];
  assert.equal(request.model, "glm-4.6");
  assert.equal(request.prompt, "帮我写个脚本", "用户输入从请求载荷里取");
  assert.equal(request.reply, "好的，这是脚本");
  assert.equal(request.promptTokens, 1200);
  assert.equal(request.completionTokens, 340);
  assert.equal(request.durationMs, 5000, "响应时间 - 请求时间");
  assert.equal(turn.durationMs, 5000);
  assert.equal(model.metrics.requests, 1);
  assert.equal(model.metrics.promptTokens, 1200);
  assert.deepEqual(model.metrics.models, ["glm-4.6"]);
});

test("轨迹模型：工具调用与结果配对、标记失败、算耗时", () => {
  const events = [
    requestEvent(1, 2, 0, "2026-10-01T19:00:00.000Z"),
    { seq: 2, turn: 2, step: 0, time: "2026-10-01T19:00:01.000Z", kind: "model-response", direction: "out", target: "model", title: "模型响应", parentSeq: 1, content: JSON.stringify({ role: "assistant", content: "我来执行" }) },
    { seq: 3, turn: 2, step: 1, time: "2026-10-01T19:00:02.000Z", kind: "tool-call", direction: "in", target: "tool", title: "调用工具 run_command", content: JSON.stringify({ command: "ls" }) },
    { seq: 4, turn: 2, step: 1, time: "2026-10-01T19:00:03.500Z", kind: "tool-result", direction: "out", target: "tool", title: "工具 run_command 成功", content: "a.txt\nb.txt", parentSeq: 3 },
    { seq: 5, turn: 2, step: 2, time: "2026-10-01T19:00:04.000Z", kind: "tool-call", direction: "in", target: "tool", title: "调用工具 read_file", content: JSON.stringify({ path: "nope" }) },
    { seq: 6, turn: 2, step: 2, time: "2026-10-01T19:00:05.000Z", kind: "tool-result", direction: "out", target: "tool", title: "工具 read_file 失败", content: "文件不存在", parentSeq: 5 },
  ];
  const model = buildTraceModel(events);
  // 工具挂在**发起它的那次请求**上（工具事件自己的 step 往往更大，不该另起一步）
  const request = model.turns[0].steps[0].requests[0];
  assert.equal(request.tools.length, 2, "两次调用都归属到这次请求");
  const call = request.tools[0];
  assert.equal(call.name, "run_command", "工具名从 title 解析");
  assert.equal(call.result, "a.txt\nb.txt");
  assert.equal(call.error, false);
  assert.equal(call.durationMs, 1500);
  const failed = request.tools[1];
  assert.equal(failed.error, true, "title 里带失败要标记 error");
  assert.equal(model.turns[0].toolCount, 2);
  assert.deepEqual(model.turns[0].toolNames.sort(), ["read_file", "run_command"]);
  assert.equal(model.metrics.calls, 2);
});

test("轨迹模型：压缩与会话结束成为标记，计划阶段进展不标记", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-01T20:00:00.000Z"),
    { seq: 2, turn: 1, step: 0, time: "2026-10-01T20:00:01.000Z", kind: "context-compacted", direction: "out", target: "system", title: "上下文已压缩", content: "摘要：早前工作" },
    { seq: 3, turn: 1, step: 0, time: "2026-10-01T20:00:02.000Z", kind: "plan-update", direction: "out", target: "system", title: "计划更新", content: "3 步" },
    { seq: 4, turn: 1, step: 0, time: "2026-10-01T20:00:03.000Z", kind: "activity", direction: "in", target: "system", title: "思考过程", content: "…", activityKind: "thinking", phase: "execute" },
    { seq: 5, turn: 1, step: 0, time: "2026-10-01T20:00:04.000Z", kind: "agent-finished", direction: "out", target: "system", title: "任务结束", content: "{}" },
  ];
  const model = buildTraceModel(events);
  const kinds = model.markers.map((marker) => marker.kind);
  assert.deepEqual(kinds, ["compaction", "plan-update", "session-end"]);
  // 标记按轮次分组：轮次存在则内嵌，否则算会话级
  assert.equal(model.markersByTurn.get(1).length, 3, "三个标记都属于第 1 轮");
  assert.equal(model.sessionMarkers.length, 0);
  assert.equal(model.markers[0].title, "上下文已压缩");
});

test("轨迹模型：多个轮次按序聚合，空输入不炸", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-01T21:00:00.000Z", { user: "第一轮" }),
    requestEvent(5, 2, 0, "2026-10-01T21:01:00.000Z", { user: "第二轮" }),
  ];
  const model = buildTraceModel(events);
  assert.deepEqual(model.turns.map((turn) => turn.turn), [1, 2]);
  assert.equal(model.turns[1].prompt, "第二轮");
  assert.equal(model.turns[0].toolCount, 0);
  assert.equal(buildTraceModel([]).turns.length, 0);
  assert.equal(buildTraceModel([], {}).metrics.spanMs, 0);
  assert.equal(buildTraceModel([], {}).metrics.activeMs, 0);
});

test("轨迹：搜索命中用户输入 / 回复 / 工具参数与结果", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-01T22:00:00.000Z", { user: "帮我查大亚湾的隐患" }),
    { seq: 2, turn: 1, step: 0, time: "2026-10-01T22:00:01.000Z", kind: "model-response", direction: "out", target: "model", title: "模型响应", parentSeq: 1, content: JSON.stringify({ role: "assistant", content: "已检索到 3 条" }) },
    { seq: 3, turn: 1, step: 1, time: "2026-10-01T22:00:02.000Z", kind: "tool-call", direction: "in", target: "tool", title: "调用工具 gov_search", content: JSON.stringify({ keyword: "隐患" }) },
    { seq: 4, turn: 1, step: 1, time: "2026-10-01T22:00:03.000Z", kind: "tool-result", direction: "out", target: "tool", title: "工具 gov_search 成功", content: "命中 3 条记录", parentSeq: 3 },
  ];
  const model = buildTraceModel(events);
  const turn = model.turns[0];
  assert.equal(traceMatches(turn, ""), true, "空关键词全通过");
  assert.equal(traceMatches(turn, "大亚湾"), true);
  assert.equal(traceMatches(turn, "已检索"), true);
  assert.equal(traceMatches(turn, "gov_search"), true);
  assert.equal(traceMatches(turn, "命中 3 条"), true);
  assert.equal(traceMatches(turn, "肯定搜不到"), false);
});

test("轨迹：时长与 token 的展示格式", () => {
  assert.equal(formatDuration(900), "900ms");
  assert.equal(formatDuration(5200), "5.2s");
  assert.equal(formatDuration(125000), "2m05s");
  assert.equal(formatDuration(null), "—");
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(9500), "9.5k");
  assert.equal(formatTokens(54282), "54k");
  assert.equal(formatTokens(95_428_000), "95M", "百万级用 M");
  assert.equal(formatTokens(2_500_000), "2.5M");
});
