import assert from "node:assert/strict";
import test from "node:test";

// 原生轨迹模型：把我们的 TraceEvent 流归一成"轮次 → 步进 → 请求 → 工具调用"。
// 用与真实落盘事件同形的合成数据，覆盖配对、时长、标记、指标与搜索。

const { buildTraceModel, traceMatches, formatDuration, formatTokens, layoutTraceSpans } = await import("../src/traceModel.ts");

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

// —— 对齐官方「轨迹」新增的部分：请求计时 / 泳道跨度 / 思考 / 状态 ——

test("轨迹模型：首 token 事件把总时长拆成首 token 延迟 + 生成，并算吞吐量", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-04T10:24:14.752Z", { user: "去掉两个入口" }),
    // 首个流式增量（正文或思考）到达
    { seq: 2, turn: 1, step: 0, time: "2026-10-04T10:24:15.645Z", kind: "model-first-token", direction: "out", target: "model", title: "首个 token", content: "", parentSeq: 1 },
    { seq: 3, turn: 1, step: 0, time: "2026-10-04T10:24:17.754Z", kind: "model-response", direction: "out", target: "model", title: "模型响应", parentSeq: 1, content: JSON.stringify({ role: "assistant", content: "已按红框去掉顶栏那两个入口。", reasoning_content: "先看顶栏结构。" }) },
    { seq: 4, turn: 1, step: 0, time: "2026-10-04T10:24:17.800Z", kind: "token-usage", direction: "out", target: "model", title: "token 用量", content: "", parentSeq: 1, usage: { prompt: 18000, completion: 458, estimated: false } },
  ];
  const model = buildTraceModel(events);
  const request = model.turns[0].steps[0].requests[0];
  assert.equal(request.turn, 1, "检查面板标题要「第 N 轮」");
  assert.equal(request.step, 0);
  assert.equal(request.firstTokenMs, 893, "首 token 延迟 = 首个增量 - 请求");
  assert.equal(request.generationMs, 2109, "生成 = 响应 - 首个增量");
  assert.equal(request.durationMs, 3002);
  assert.equal(request.reasoning, "先看顶栏结构。", "思考在响应载荷里");
  assert.equal(request.status, "completed");
  const throughput = Math.round(request.throughput);
  assert.equal(throughput, 217, "吞吐量 = 输出 token / 生成秒数");
  // 时间条「模型」块要能画两段色：浅色段到首 token 为止
  const span = model.spans.find((item) => item.ref.kind === "request" && item.ref.seq === 1);
  assert.ok(span.firstTokenMs, "跨度上要带首 token 时刻");
  assert.ok(span.firstTokenMs > span.startMs && span.firstTokenMs < span.endMs);
});

test("轨迹模型：没有首 token 事件时不编数（生成退化为总时长、TTFT 留空）", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-04T11:00:00.000Z"),
    { seq: 2, turn: 1, step: 0, time: "2026-10-04T11:00:03.000Z", kind: "model-response", direction: "out", target: "model", title: "模型响应", parentSeq: 1, content: JSON.stringify({ role: "assistant", content: "好" }) },
  ];
  const request = buildTraceModel(events).turns[0].steps[0].requests[0];
  assert.equal(request.firstTokenMs, null, "没采到就留空，界面写「首 token 时间不可用」");
  assert.equal(request.firstTokenAt, null);
  assert.equal(request.generationMs, 3000, "退化为总时长");
});

test("轨迹模型：时间条三道跨度（输入 / 模型 / 工具）与时间域", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-04T12:00:01.000Z", { user: "跑一下测试" }),
    { seq: 2, turn: 1, step: 0, time: "2026-10-04T12:00:02.000Z", kind: "model-response", direction: "out", target: "model", title: "模型响应", parentSeq: 1, content: JSON.stringify({ role: "assistant", content: "开始" }) },
    { seq: 3, turn: 1, step: 1, time: "2026-10-04T12:00:03.000Z", kind: "tool-call", direction: "in", target: "tool", title: "调用工具 run_command", content: JSON.stringify({ command: "npm test" }) },
    { seq: 4, turn: 1, step: 1, time: "2026-10-04T12:00:07.000Z", kind: "tool-result", direction: "out", target: "tool", title: "工具 run_command 失败", content: "1 failed", parentSeq: 3 },
  ];
  const model = buildTraceModel(events, { messages: [{ role: "user", content: "跑一下测试", createdAt: "2026-10-04T12:00:00.000Z" }] });
  const lanes = model.spans.reduce((acc, span) => ({ ...acc, [span.lane]: (acc[span.lane] || 0) + 1 }), {});
  assert.deepEqual(lanes, { input: 1, model: 1, tool: 1 });
  const input = model.spans.find((span) => span.lane === "input");
  assert.equal(input.startMs, Date.parse("2026-10-04T12:00:00.000Z"), "输入块定位到用户消息时刻");
  assert.equal(input.endMs - input.startMs, 1, "输入是一次时刻，画成最小宽度的标记（不是画到第一次请求）");
  const tool = model.spans.find((span) => span.lane === "tool");
  assert.equal(tool.error, true, "失败的工具块要标红");
  assert.equal(tool.endMs - tool.startMs, 4000);
  assert.equal(model.domain.startMs, Date.parse("2026-10-04T12:00:00.000Z"));
  assert.equal(model.domain.endMs, Date.parse("2026-10-04T12:00:07.000Z"));
  assert.equal(model.turns[0].inputAt, "2026-10-04T12:00:00.000Z");
});

test("轨迹模型：工具结果时间落在跨度上，等待中的调用标 running", () => {
  const events = [
    requestEvent(1, 1, 0, "2026-10-04T13:00:00.000Z"),
    { seq: 2, turn: 1, step: 1, time: "2026-10-04T13:00:01.000Z", kind: "tool-call", direction: "in", target: "tool", title: "调用工具 read_file", content: "{}" },
    { seq: 3, turn: 1, step: 2, time: "2026-10-04T13:00:02.000Z", kind: "tool-call", direction: "in", target: "tool", title: "调用工具 write_file", content: "{}" },
  ];
  const request = buildTraceModel(events).turns[0].steps[0].requests[0];
  assert.equal(request.tools[0].endedAt, null, "没有结果就没有结束时间");
  assert.equal(request.tools[0].durationMs, null);
  assert.equal(request.status, "running");
  const spans = buildTraceModel(events).spans.filter((span) => span.lane === "tool");
  assert.equal(spans.length, 2);
});

test("轨迹模型：时间条布局压缩空闲（隔天的空档不会把活跃段挤成一堆）", () => {
  const spans = [
    { id: "a", lane: "model", turn: 1, label: "请求", startMs: 0, endMs: 1000, firstTokenMs: 500, error: false, ref: { kind: "request", seq: 1 } },
    { id: "b", lane: "tool", turn: 2, label: "工具", startMs: 100_000, endMs: 101_000, firstTokenMs: null, error: false, ref: { kind: "tool", seq: 2 } },
  ];
  const compressed = layoutTraceSpans(spans, { compressIdle: true });
  assert.equal(compressed.endMs, 2000, "100 秒空档被折掉，只留下活跃段");
  assert.equal(compressed.items[1].offsetStartMs, 1000);
  assert.equal(compressed.items[0].offsetFirstTokenMs, 500, "首 token 也要按压缩后的坐标走");
  const raw = layoutTraceSpans(spans, { compressIdle: false });
  assert.equal(raw.endMs, 101_000, "不压缩时保留真实墙钟");
  assert.equal(layoutTraceSpans([], {}), null);
});

test('DSH 轨迹按实际消息来源显示用户要求，运行说明仍完整保留在请求记录',()=>{
  const event=requestEvent(1,1,0,'2026-10-06T00:00:00.000Z');const payload=JSON.parse(event.content);
  payload.messages=[{role:'user',content:'实际子任务要求'},{role:'user',content:'运行说明与工作模板'}];payload.dshMessageSources=['user','runtime-context'];event.content=JSON.stringify(payload);
  const request=buildTraceModel([event]).turns[0].steps[0].requests[0];assert.equal(request.prompt,'实际子任务要求');assert.match(request.raw.request.content,/运行说明与工作模板/);
  delete payload.dshMessageSources;event.content=JSON.stringify(payload);assert.equal(buildTraceModel([event]).turns[0].steps[0].requests[0].prompt,'运行说明与工作模板');
});
