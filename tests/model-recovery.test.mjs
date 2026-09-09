import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { requestModel, runAgent } from "../electron/agent.mjs";

const settings = { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "" };
const encoder = new TextEncoder();
const flush = () => new Promise((resolve) => setImmediate(resolve));
const jsonReply = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content } }] }) });
const chunk = (delta, finish_reason = null) => ({ choices: [{ delta, finish_reason }] });
const sseReply = (events, { close = true, separator = "\n\n", onCancel = () => {} } = {}) => ({
  ok: true,
  headers: { get: () => "text/event-stream" },
  body: new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${typeof event === "string" ? event : JSON.stringify(event)}${separator}`));
      if (close) controller.close();
    },
    cancel: onCancel,
  }),
});
async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-recovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("模型思考两分钟后返回结果，不应在 90 秒时被误判为断流", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stream;
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { stream = controller; },
    cancel() { cancelled = true; },
  });
  const pending = requestModel({
    settings, messages: [{ role: "user", content: "汇总刚才阅读的材料" }], tools: false,
    fetchImpl: async () => ({ ok: true, headers: { get: () => "text/event-stream" }, body }),
  });
  const outcome = pending.then((message) => ({ message }), (error) => ({ error }));
  await flush();
  t.mock.timers.tick(120_000);
  await flush();
  if (!cancelled) {
    stream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"总结完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    stream.close();
  }
  const result = await outcome;
  assert.equal(cancelled, false, result.error?.message);
  assert.equal(result.message?.content, "总结完成");
});

test("连续两次临时中断后服务恢复，任务应自动继续完成", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-recovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let attempts = 0;
  const result = await runAgent({
    settings, workspacePath: root, conversation: [{ role: "user", content: "完成总结" }],
    transportRetryBaseDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts <= 2) throw Object.assign(new Error("连接暂时中断"), { name: "AbortError" });
      return jsonReply("总结完成");
    },
  });
  assert.equal(result.status, "done", result.reason);
  assert.equal(result.finalText, "总结完成");
  assert.equal(attempts, 3);
});

for (const api of ["chat/completions", "responses"]) {
  const modelSettings = { ...settings, endpoint: `http://mock.local/v1/${api}` };
  const delta = api === "responses" ? { type: "response.output_text.delta", delta: "半句" } : chunk({ content: "半句" });
  const terminal = api === "responses"
    ? { type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "完整答案" }] }] } }
    : "[DONE]";

  test(`${api}：静默思考超过 90 秒及后续持续输出不应误中断`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let stream;
    let cancelled = false;
    const body = new ReadableStream({ start(c) { stream = c; }, cancel() { cancelled = true; } });
    const outcome = requestModel({ settings: modelSettings, messages: [], tools: false,
      fetchImpl: async () => ({ ok: true, headers: { get: () => "text/event-stream" }, body }),
    }).then((message) => ({ message }), (error) => ({ error }));
    await flush();
    for (let i = 0; i < 4; i++) {
      t.mock.timers.tick(120_000);
      await flush();
      assert.equal(cancelled, false, "有输出的连接应从最近一次数据重新计算等待时间");
      stream.enqueue(encoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
      await flush();
    }
    stream.enqueue(encoder.encode(`data: ${typeof terminal === "string" ? terminal : JSON.stringify(terminal)}\n\n`));
    const result = await outcome;
    assert.ok(result.message?.content, result.error?.message);
    assert.equal(cancelled, true, "结束后应释放仍保持打开的连接");
  });

  test(`${api}：半截回复正常断开也必须重试，不能误报完成`, async (t) => {
    let attempts = 0;
    const texts = [];
    const result = await runAgent({ settings: modelSettings, workspacePath: await workspace(t), conversation: [],
      transportRetryBaseDelayMs: 0,
      emit: (event) => { if (event.type === "assistant-text") texts.push(event.text); },
      fetchImpl: async () => {
        attempts++;
        return attempts <= 2 ? sseReply([delta]) : sseReply([delta, terminal]);
      },
    });
    assert.equal(result.status, "done", result.reason);
    assert.equal(attempts, 3);
    assert.ok(texts.includes(""), "重试前应清掉失败请求的半截正文");
    assert.equal(result.finalText, api === "responses" ? "完整答案" : "半句");
  });

  test(`${api}：收到完成标记即结束，无需等待服务器关闭连接`, async () => {
    let cancelled = false;
    const message = await requestModel({ settings: modelSettings, messages: [], tools: false, idleTimeoutMs: 20,
      fetchImpl: async () => sseReply([delta, terminal], { close: false, onCancel: () => { cancelled = true; } }),
    });
    assert.ok(message.content);
    assert.equal(cancelled, true);
  });

  test(`${api}：等待中的流可以立即取消，且不会重发`, async (t) => {
    const controller = new AbortController();
    let attempts = 0;
    const result = await runAgent({ settings: modelSettings, workspacePath: await workspace(t), conversation: [],
      signal: controller.signal,
      fetchImpl: async () => {
        attempts++;
        setImmediate(() => controller.abort());
        return sseReply([], { close: false });
      },
    });
    assert.equal(result.status, "cancelled");
    assert.equal(attempts, 1);
  });
}

test("默认空闲保护仍在五分钟后中止真正挂起的连接", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = requestModel({ settings, messages: [], tools: false, fetchImpl: async () => sseReply([], { close: false }) });
  const rejected = assert.rejects(pending, (error) => error.code === "MODEL_IDLE_TIMEOUT" && /300 秒/.test(error.message));
  await flush();
  t.mock.timers.tick(300_000);
  await rejected;
});

test("持续空闲失败有明确原因、次数和停止上限", async (t) => {
  let attempts = 0;
  const events = [];
  const result = await runAgent({ settings, workspacePath: await workspace(t), conversation: [],
    modelIdleTimeoutMs: 10, transportRetryBaseDelayMs: 0,
    emit: (event) => events.push(event),
    fetchImpl: async () => { attempts++; return sseReply([], { close: false }); },
  });
  assert.equal(result.status, "error");
  assert.equal(attempts, 4);
  assert.match(result.reason, /已尝试 4 次.*没有返回任何数据/);
  assert.equal(events.filter((event) => event.type === "debug-log" && /正在自动重试/.test(event.entry.title)).length, 3);
});

test("单次请求总超时仍有效，并保留具体的超时原因", async (t) => {
  const result = await runAgent({ settings, workspacePath: await workspace(t), conversation: [],
    modelTimeoutMs: 15, transportRetryLimit: 0,
    fetchImpl: async () => sseReply([], { close: false }),
  });
  assert.equal(result.status, "error");
  assert.match(result.reason, /单次请求超过.*仍未完成/);
});

test("恢复等待逐次延长，不会在服务尚未恢复时立即连续重发", async (t) => {
  const root = await workspace(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  let onRetry;
  const nextRetry = () => new Promise((resolve) => { onRetry = resolve; });
  let retrying = nextRetry();
  const pending = runAgent({ settings, workspacePath: root, conversation: [],
    emit: (event) => { if (event.type === "debug-log" && /正在自动重试/.test(event.entry.title)) onRetry(); },
    fetchImpl: async () => {
      attempts++;
      if (attempts <= 3) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return jsonReply("恢复完成");
    },
  });
  for (const [index, delay] of [1000, 2000, 4000].entries()) {
    await retrying;
    retrying = nextRetry();
    t.mock.timers.tick(delay - 1);
    await flush();
    assert.equal(attempts, index + 1, "等待期间不能提前重发");
    t.mock.timers.tick(1);
    await flush();
  }
  assert.equal((await pending).status, "done");
  assert.equal(attempts, 4);
});

test("重试耗尽后保留已完成的工作记录，后续继续时可使用", async (t) => {
  const root = await workspace(t);
  await fs.writeFile(path.join(root, "material.txt"), "需要保留的材料内容");
  let attempts = 0;
  const result = await runAgent({ settings, workspacePath: root, conversation: [], transportRetryBaseDelayMs: 0,
    fetchImpl: async () => {
      attempts++;
      if (attempts === 1) return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", tool_calls: [
        { id: "read1", type: "function", function: { name: "read_file", arguments: '{"path":"material.txt"}' } },
      ] } }] }) };
      return sseReply([chunk({ content: "未完成总结" })]);
    },
  });
  assert.equal(result.status, "error");
  assert.equal(attempts, 5);
  assert.match(result.workingContext, /需要保留的材料内容/);
  let continuedMessages;
  const continued = await runAgent({ settings, workspacePath: root, workingContext: result.workingContext,
    conversation: [{ role: "user", content: "继续" }],
    fetchImpl: async (_url, options) => { continuedMessages = JSON.parse(options.body).messages; return jsonReply("根据材料完成总结"); },
  });
  assert.equal(continued.status, "done");
  assert.match(JSON.stringify(continuedMessages), /需要保留的材料内容/);
});

for (const layer of ["transport", "network"]) {
  test(`${layer}：重试等待过程中停止任务会立即退出`, async (t) => {
    const controller = new AbortController();
    let attempts = 0;
    const start = performance.now();
    const result = await runAgent({ settings, workspacePath: await workspace(t), conversation: [],
      signal: controller.signal, transportRetryBaseDelayMs: 10_000, networkRetryBaseDelayMs: 10_000,
      fetchImpl: async () => {
        attempts++;
        setTimeout(() => controller.abort(), 10);
        throw layer === "transport" ? Object.assign(new Error("aborted"), { name: "AbortError" }) : new TypeError("fetch failed");
      },
    });
    assert.equal(result.status, "cancelled");
    assert.equal(attempts, 1);
    assert.ok(performance.now() - start < 2000, "不应等到十秒的重试间隔结束才停止");
  });
}

test("重试保留已完成的文件操作，未完成的工具回复不会执行", async (t) => {
  const root = await workspace(t);
  const requests = [];
  const events = [];
  const tool = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const write = tool("w1", "write_file", { path: "result.txt", content: "准备" });
  const edit = tool("e1", "edit_file", { path: "result.txt", find: "准备", replace: "完成" });
  const result = await runAgent({ settings, workspacePath: root, conversation: [{ role: "user", content: "写好总结" }],
    approvalMode: "full-access", transportRetryBaseDelayMs: 0,
    emit: (event) => events.push(event),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const attempt = requests.length;
      if (attempt === 1) return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", tool_calls: [write] } }] }) };
      if (attempt < 5) return sseReply([chunk({ tool_calls: [{ index: 0, ...edit }] }), ...(attempt === 4 ? ["[DONE]"] : [])]);
      return jsonReply("总结完成");
    },
  });
  assert.equal(result.status, "done", result.reason);
  assert.equal(requests.length, 5);
  assert.deepEqual(requests[1], requests[2]);
  assert.deepEqual(requests[2], requests[3]);
  assert.ok(requests[3].messages.some((message) => message.role === "tool" && message.tool_call_id === "w1"));
  assert.equal(events.filter((event) => event.type === "activity" && event.activity.kind === "write_file").length, 1);
  assert.equal(events.filter((event) => event.type === "activity" && event.activity.kind === "edit_file").length, 1);
  assert.equal(await fs.readFile(path.join(root, "result.txt"), "utf8"), "完成");
});

test("兼容 CRLF 分隔、跨数据块及结尾没有空行的回复", async () => {
  const wire = `data: ${JSON.stringify(chunk({ content: "第一句" }))}\r\n\r\ndata: ${JSON.stringify(chunk({ content: "第二句" }, "stop"))}`;
  const bytes = encoder.encode(wire);
  const body = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const message = await requestModel({ settings, messages: [], tools: false,
    fetchImpl: async () => ({ ok: true, headers: { get: () => "text/event-stream" }, body }),
  });
  assert.equal(message.content, "第一句第二句");
});

test("普通回复的正文读取中断后也能自动恢复", async (t) => {
  let attempts = 0;
  const result = await runAgent({ settings, workspacePath: await workspace(t), conversation: [], transportRetryBaseDelayMs: 0,
    fetchImpl: async () => {
      attempts++;
      if (attempts === 1) return { ok: true, json: async () => { throw new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }); } };
      return jsonReply("恢复成功");
    },
  });
  assert.equal(result.status, "done", result.reason);
  assert.equal(attempts, 2);
});

test("真实本地连接传输中被关闭后，重试请求可以完成", async (t) => {
  let attempts = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _ of request) { /* 消费请求正文 */ }
    attempts++;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify(chunk({ content: attempts === 1 ? "未完" : "完成" }))}\n\n`);
    if (attempts === 1) setTimeout(() => response.destroy(), 10);
    else response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const result = await runAgent({ settings: { ...settings, endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions` },
    workspacePath: await workspace(t), conversation: [], transportRetryBaseDelayMs: 0,
  });
  assert.equal(result.status, "done", result.reason);
  assert.equal(result.finalText, "完成");
  assert.equal(attempts, 2);
});
