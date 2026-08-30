// Kimi 开放平台原生工具适配测试（node --test）。
// 覆盖：detectProvider / kimiFormulaBaseUrl / fetchKimiFormulaDefinitions（缓存与重试）/
// runKimiFormula（原样透传与两种 output 解析）/ runAgent 工具装配与全链路（formula web_search、
// $web_search 回传、失败容错、非 kimi 回归）/ 流式 tool_calls 多 index 拼接。
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deepseekAnthropicBaseUrl, detectProvider, fetchKimiFormulaDefinitions, isKimiFormulaToolName, kimiFormulaBaseUrl, qwenResponsesUrl, runKimiFormula, searchDeepseekNative, searchQwenNative } from "../electron/providers.mjs";
import { requestModel, runAgent } from "../electron/agent.mjs";

const KIMI_ENDPOINT = "https://api.moonshot.cn/v1/chat/completions";

// ---- mock 基础设施 ----
function formulaTool(uri) {
  const slug = String(uri).split("/")[1]?.split(":")[0] || "";
  const name = slug.replace(/-/g, "_");
  return {
    type: "function",
    function: {
      name,
      description: `Kimi 官方工具 ${name}`,
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => payload,
  };
}

function toolCall(id, name, args) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// 按 URL 路由的 mock fetch：
//   GET  {base}/formulas/{uri}/tools       → { tools: [formulaTool(uri)] }
//   POST {base}/formulas/{uri}/fibers      → fiberResponse
//   POST {base}/chat/completions           → 按顺序返回 scriptedMessages
function kimiFetch({ fiberResponse = { status: "succeeded", context: { output: "搜索结果" } }, scriptedMessages = [], calls = [] } = {}) {
  const messages = [...scriptedMessages];
  return async (url, options) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: target, method: options.method, body });
    if (options.method === "GET" && target.includes("/formulas/") && target.endsWith("/tools")) {
      const uri = target.split("/formulas/")[1].replace(/\/tools$/, "");
      return jsonResponse({ tools: [formulaTool(uri)] });
    }
    if (options.method === "POST" && target.includes("/formulas/") && target.endsWith("/fibers")) {
      return typeof fiberResponse === "function" ? fiberResponse(target, body) : jsonResponse(fiberResponse);
    }
    if (target.endsWith("/chat/completions")) {
      const message = messages.length > 1 ? messages.shift() : messages[0];
      return jsonResponse({ choices: [{ message }] });
    }
    throw new Error(`未预期的请求：${options.method} ${target}`);
  };
}

// 模型请求走 SSE（OpenAI Chat Completions 流式 chunk）
function sseFetch(events, calls = []) {
  return async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    });
    return { ok: true, headers: { get: () => "text/event-stream" }, body: stream };
  };
}

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dyworker-kimi-test-"));
}

function findTool(tools, name) {
  return (tools || []).find((tool) => tool?.function?.name === name);
}

function countTool(tools, name) {
  return (tools || []).filter((tool) => tool?.function?.name === name).length;
}

// ---- 1. detectProvider ----
test("detectProvider：厂商主机名识别，未知地址返回 null", () => {
  assert.equal(detectProvider(KIMI_ENDPOINT), "kimi-open");
  assert.equal(detectProvider("https://api.moonshot.ai/v1/chat/completions"), "kimi-open");
  assert.equal(detectProvider("https://api.moonshot.cn/v1"), "kimi-open");
  // Kimi 编程套餐：识别为 kimi（推理强度映射用），但不属于开放平台（无 Formula API）
  assert.equal(detectProvider("https://api.kimi.com/coding/v1/chat/completions"), "kimi");
  assert.equal(detectProvider("https://api.openai.com/v1/chat/completions"), "openai");
  assert.equal(detectProvider("https://api.deepseek.com/responses"), "deepseek");
  assert.equal(detectProvider("https://api.deepseek.com/v1/chat/completions"), "deepseek");
  assert.equal(detectProvider("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"), "qwen");
  assert.equal(detectProvider("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"), "qwen");
  assert.equal(detectProvider("https://open.bigmodel.cn/api/paas/v4/chat/completions"), "glm");
  assert.equal(detectProvider("https://api.minimaxi.com/v1/chat/completions"), "minimax");
  assert.equal(detectProvider("https://api.minimax.io/v1/chat/completions"), "minimax");
  assert.equal(detectProvider("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"), "gemini");
  assert.equal(detectProvider("https://api.x.ai/v1/chat/completions"), "xai");
  assert.equal(detectProvider("https://ark.cn-beijing.volces.com/api/v3/chat/completions"), "doubao");
  assert.equal(detectProvider("http://192.16.6.138:8000/v1/chat/completions"), null, "本地 vLLM 部署不路由到云端原生搜索");
  assert.equal(detectProvider(""), null);
  assert.equal(detectProvider("不是地址"), null);
});

test("kimiFormulaBaseUrl：由 chat/completions 端点推导 /v1 base", () => {
  assert.equal(kimiFormulaBaseUrl(KIMI_ENDPOINT), "https://api.moonshot.cn/v1");
  assert.equal(kimiFormulaBaseUrl("https://api.moonshot.cn/v1/chat/completions?x=1"), "https://api.moonshot.cn/v1");
  assert.equal(kimiFormulaBaseUrl("https://api.moonshot.ai/v1/chat/completions"), "https://api.moonshot.ai/v1");
});

// ---- 2. fetchKimiFormulaDefinitions ----
test("fetchKimiFormulaDefinitions：12 URI 全部映射、enabledUris 过滤、进程内缓存、GET 失败重试", async () => {
  const base = "https://api.moonshot.cn/v1-test-defs";
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    return jsonResponse({ tools: [formulaTool(url.split("/formulas/")[1].replace(/\/tools$/, ""))] });
  };

  // 12 个全部启用（不传 enabledUris）
  const all = await fetchKimiFormulaDefinitions(fetchImpl, { baseUrl: base, apiKey: "sk-test" });
  assert.equal(Object.keys(all.nameToUri).length, 12);
  assert.equal(all.nameToUri.web_search, "moonshot/web-search:latest");
  assert.equal(all.nameToUri.code_runner, "moonshot/code-runner:latest");
  assert.equal(all.nameToUri.memory, "moonshot/memory:latest");
  assert.equal(all.definitions.length, 12);
  assert.equal(calls.length, 12);
  assert.ok(calls.every((url) => url.endsWith("/tools")));

  // 进程内缓存：同 baseUrl+uri 二次调用不再发请求
  const again = await fetchKimiFormulaDefinitions(fetchImpl, { baseUrl: base, apiKey: "sk-test" });
  assert.equal(again.definitions.length, 12);
  assert.equal(calls.length, 12, "缓存命中时不应再次发起请求");

  // enabledUris 过滤（换一个 baseUrl 避开缓存）
  const base2 = "https://api.moonshot.cn/v1-test-enabled";
  const calls2 = [];
  const fetchImpl2 = async (url) => {
    calls2.push(String(url));
    return jsonResponse({ tools: [formulaTool(url.split("/formulas/")[1].replace(/\/tools$/, ""))] });
  };
  const filtered = await fetchKimiFormulaDefinitions(fetchImpl2, {
    baseUrl: base2,
    apiKey: "sk-test",
    enabledUris: ["moonshot/web-search:latest", "moonshot/fetch:latest"],
  });
  assert.deepEqual(Object.keys(filtered.nameToUri).sort(), ["fetch", "web_search"]);
  assert.equal(calls2.length, 2);

  // GET 失败重试：首次 500，重试成功
  const base3 = "https://api.moonshot.cn/v1-test-retry";
  let attempts = 0;
  const fetchImpl3 = async (url) => {
    attempts += 1;
    if (attempts === 1) return jsonResponse({ error: "boom" }, 500);
    return jsonResponse({ tools: [formulaTool(url.split("/formulas/")[1].replace(/\/tools$/, ""))] });
  };
  const retried = await fetchKimiFormulaDefinitions(fetchImpl3, {
    baseUrl: base3,
    apiKey: "sk-test",
    enabledUris: ["moonshot/date:latest"],
  });
  assert.equal(retried.nameToUri.date, "moonshot/date:latest");
  assert.equal(attempts, 2);

  // 全部失败抛错（调用方降级）
  const base4 = "https://api.moonshot.cn/v1-test-fail";
  const failing = async () => jsonResponse({ error: "x" }, 503);
  await assert.rejects(
    fetchKimiFormulaDefinitions(failing, { baseUrl: base4, apiKey: "sk-test", enabledUris: ["moonshot/date:latest"] }),
    /HTTP 503/,
  );
});

// ---- 3. runKimiFormula ----
test("runKimiFormula：URL/body 原样透传、两种 output 解析、非 succeeded 抛错、连接失败重试", async () => {
  const base = "https://api.moonshot.cn/v1";
  // context.output
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return jsonResponse({ status: "succeeded", context: { output: "转换结果" } });
  };
  const output = await runKimiFormula(fetchImpl, {
    baseUrl: base, apiKey: "sk-test", uri: "moonshot/convert:latest", name: "convert",
    arguments: '{"value":"100","from":"USD","to":"CNY"}',
  });
  assert.equal(output, "转换结果");
  assert.equal(calls[0].url, `${base}/formulas/moonshot/convert:latest/fibers`);
  assert.deepEqual(calls[0].body, { name: "convert", arguments: '{"value":"100","from":"USD","to":"CNY"}' });

  // context.encrypted_output（web-search 是 protected，返回密文，原样塞给模型）
  const encrypted = await runKimiFormula(async () => jsonResponse({
    status: "succeeded",
    context: { encrypted_output: "----MOONSHOT ENCRYPTED BEGIN----xxx----END----" },
  }), { baseUrl: base, apiKey: "sk-test", uri: "moonshot/web-search:latest", name: "web_search", arguments: '{"query":"天气"}' });
  assert.match(encrypted, /MOONSHOT ENCRYPTED/);

  // status !== succeeded 抛错
  await assert.rejects(
    runKimiFormula(async () => jsonResponse({ status: "failed", error: "输入不合法" }), {
      baseUrl: base, apiKey: "sk-test", uri: "moonshot/quickjs:latest", name: "quickjs", arguments: "{}",
    }),
    /status=failed.*输入不合法/,
  );

  // 连接层失败重试 1 次：第一次 fetch 抛错，第二次成功
  let attempt = 0;
  const retryImpl = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("fetch failed");
    return jsonResponse({ status: "succeeded", context: { output: "ok" } });
  };
  const retried = await runKimiFormula(retryImpl, { baseUrl: base, apiKey: "sk-test", uri: "moonshot/date:latest", name: "date", arguments: "{}" });
  assert.equal(retried, "ok");
  assert.equal(attempt, 2);
});

test("isKimiFormulaToolName：公式工具名下划线命名识别", () => {
  assert.equal(isKimiFormulaToolName("web_search"), true);
  assert.equal(isKimiFormulaToolName("random_choice"), true);
  assert.equal(isKimiFormulaToolName("code_runner"), true);
  assert.equal(isKimiFormulaToolName("$web_search"), false);
  assert.equal(isKimiFormulaToolName("web-search"), false);
  assert.equal(isKimiFormulaToolName("read_file"), false);
  assert.equal(isKimiFormulaToolName(""), false);
});

// ---- 4. runAgent 集成：kimi 开启时工具装配 ----
test("runAgent：kimi 开启时公式工具注入、本地 web_search 剔除无重名、memory/excel 默认关、$web_search 默认关", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    scriptedMessages: [{ role: "assistant", content: "你好" }],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test" },
    workspacePath: root,
    conversation: [{ role: "user", content: "你好" }],
    fetchImpl,
  });
  assert.equal(result.status, "done");
  const first = calls.find((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const tools = first.body.tools;
  assert.ok(tools, "请求应携带 tools");
  // 公式 web_search 存在且唯一（本地 web_search 被剔除，无重名 400 风险）
  assert.equal(countTool(tools, "web_search"), 1);
  assert.equal(findTool(tools, "web_search").function.description, "Kimi 官方工具 web_search");
  assert.ok(findTool(tools, "convert"), "应含公式 convert");
  assert.ok(findTool(tools, "fetch"), "应含公式 fetch");
  // memory/excel 默认关闭
  assert.equal(findTool(tools, "memory"), undefined);
  assert.equal(findTool(tools, "excel"), undefined);
  // 本地工具仍在
  assert.ok(findTool(tools, "update_plan"));
  assert.ok(findTool(tools, "read_file"));
  // 内置 $web_search 默认关
  assert.equal(findTool(tools, "$web_search"), undefined);
  // K3 reasoning_effort 固定 high
  assert.equal(first.body.reasoning_effort, "high");
});

test("runAgent：enableNativeTools=false 时关闭公式工具与 $web_search，本地工具保留（reasoning_effort 仍按端点设置）", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    scriptedMessages: [{ role: "assistant", content: "你好" }],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test", enableNativeTools: false },
    workspacePath: root,
    conversation: [{ role: "user", content: "你好" }],
    fetchImpl,
  });
  assert.equal(result.status, "done");
  const first = calls.find((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const tools = first.body.tools;
  assert.equal(findTool(tools, "web_search").function.description.includes("Kimi"), false, "应保留本地 web_search");
  assert.equal(findTool(tools, "convert"), undefined);
  assert.equal(findTool(tools, "$web_search"), undefined);
  // reasoning_effort 只依赖端点（kimi-open 固定 high 控费），与原生工具开关无关
  assert.equal(first.body.reasoning_effort, "high");
});

test("runAgent：公式 web-search 被禁用时保留本地 web_search（回退到厂商路由后端）", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    scriptedMessages: [{ role: "assistant", content: "你好" }],
    calls,
  });
  const result = await runAgent({
    settings: {
      endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test",
      nativeToolsDisabled: ["memory", "excel", "web-search"],
    },
    workspacePath: root,
    conversation: [{ role: "user", content: "你好" }],
    fetchImpl,
  });
  assert.equal(result.status, "done");
  const first = calls.find((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const tools = first.body.tools;
  assert.equal(countTool(tools, "web_search"), 1, "web_search 应存在且唯一");
  assert.equal(findTool(tools, "web_search").function.description.includes("Kimi"), false, "保留的应是本地 web_search");
  assert.ok(findTool(tools, "convert"), "其余公式工具仍注入");
});

test("runAgent：enableWebSearchBuiltin=true 时注入内置 $web_search（builtin_function）", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    scriptedMessages: [{ role: "assistant", content: "你好" }],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test", enableWebSearchBuiltin: true },
    workspacePath: root,
    conversation: [{ role: "user", content: "你好" }],
    fetchImpl,
  });
  assert.equal(result.status, "done");
  const first = calls.find((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const builtin = findTool(first.body.tools, "$web_search");
  assert.ok(builtin, "应注入 $web_search");
  assert.equal(builtin.type, "builtin_function");
  assert.deepEqual(builtin.function, { name: "$web_search" });
});

// ---- 5. 全链路：公式 web_search → fibers → 回填 → 最终回答 ----
test("runAgent 全链路：公式 web_search 走 fibers（arguments 原样透传），role=tool 回填对齐后得到最终回答", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fiberBodies = [];
  const fetchImpl = kimiFetch({
    fiberResponse: (url, body) => {
      fiberBodies.push(body);
      return jsonResponse({ status: "succeeded", context: { output: "北京 晴 25℃" } });
    },
    scriptedMessages: [
      { role: "assistant", content: "", tool_calls: [toolCall("call_1", "web_search", { query: "北京天气" })] },
      { role: "assistant", content: "北京今天晴，25 度。" },
    ],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test" },
    workspacePath: root,
    conversation: [{ role: "user", content: "查一下北京天气" }],
    fetchImpl,
    requestApproval: async () => true, // 联网工具 interactive 模式需审批，测试直接批准
  });
  assert.equal(result.status, "done");
  assert.equal(result.finalText, "北京今天晴，25 度。");
  // fibers 请求：URL 正确、name 与 arguments 原样透传
  const fiberCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/fibers"));
  assert.ok(fiberCall, "应发起 fibers 请求");
  assert.equal(fiberCall.url, "https://api.moonshot.cn/v1/formulas/moonshot/web-search:latest/fibers");
  assert.deepEqual(fiberBodies[0], { name: "web_search", arguments: '{"query":"北京天气"}' });
  // 第二轮请求：role=tool 回填且 tool_call_id 对齐
  const chatCalls = calls.filter((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  assert.equal(chatCalls.length, 2);
  const toolMessage = chatCalls[1].body.messages.find((message) => message.role === "tool");
  assert.equal(toolMessage.tool_call_id, "call_1");
  assert.equal(toolMessage.content, "北京 晴 25℃");
  const assistantCall = chatCalls[1].body.messages.find((message) => message.role === "assistant" && message.tool_calls);
  assert.equal(assistantCall.tool_calls[0].id, "call_1");
});

// ---- 6. $web_search 回传 ----
test("runAgent：内置 $web_search 把 arguments 原样回传（不发起 fibers 请求）", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    scriptedMessages: [
      { role: "assistant", content: "", tool_calls: [toolCall("call_2", "$web_search", { query: "今日新闻" })] },
      { role: "assistant", content: "这是今天的新闻摘要。" },
    ],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test", enableWebSearchBuiltin: true },
    workspacePath: root,
    conversation: [{ role: "user", content: "搜索新闻" }],
    fetchImpl,
    requestApproval: async () => true,
  });
  assert.equal(result.status, "done");
  assert.equal(result.finalText, "这是今天的新闻摘要。");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith("/fibers")), false, "$web_search 不应发起 fibers 请求");
  const chatCalls = calls.filter((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const toolMessage = chatCalls[1].body.messages.find((message) => message.role === "tool");
  assert.equal(toolMessage.tool_call_id, "call_2");
  assert.equal(toolMessage.content, JSON.stringify({ query: "今日新闻" }), "content 应为 arguments 原样 JSON");
});

// ---- 7. 容错：fiber 失败不中断任务 ----
test("runAgent 容错：fiber 返回 500 → tool 消息「失败…」，任务继续并正常完成", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    fiberResponse: () => jsonResponse({ error: "internal" }, 500),
    scriptedMessages: [
      { role: "assistant", content: "", tool_calls: [toolCall("call_3", "web_search", { query: "北京天气" })] },
      { role: "assistant", content: "搜索暂时不可用，我直接回答：北京今天晴。" },
    ],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test" },
    workspacePath: root,
    conversation: [{ role: "user", content: "查天气" }],
    fetchImpl,
    requestApproval: async () => true,
  });
  assert.equal(result.status, "done");
  assert.equal(result.finalText, "搜索暂时不可用，我直接回答：北京今天晴。");
  const chatCalls = calls.filter((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const toolMessage = chatCalls[1].body.messages.find((message) => message.role === "tool");
  assert.match(toolMessage.content, /^失败\n/);
});

test("runAgent 容错：fiber status=error → tool 消息「失败…」，任务继续", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    fiberResponse: () => jsonResponse({ status: "error", error: "服务端执行出错" }),
    scriptedMessages: [
      { role: "assistant", content: "", tool_calls: [toolCall("call_4", "date", { format: "iso" })] },
      { role: "assistant", content: "好的，我换个方式。" },
    ],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: KIMI_ENDPOINT, model: "kimi-k3", apiKey: "sk-test" },
    workspacePath: root,
    conversation: [{ role: "user", content: "获取日期" }],
    fetchImpl,
  });
  assert.equal(result.status, "done");
  assert.equal(result.finalText, "好的，我换个方式。");
  const chatCalls = calls.filter((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const toolMessage = chatCalls[1].body.messages.find((message) => message.role === "tool");
  assert.match(toolMessage.content, /^失败\n/);
  assert.match(toolMessage.content, /status=error/);
});

// ---- 8. 非 kimi 端点回归 ----
test("runAgent 回归：非 kimi 端点行为不变（本地 web_search 保留、无公式工具、无 reasoning_effort）", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = kimiFetch({
    scriptedMessages: [{ role: "assistant", content: "好的" }],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "k" },
    workspacePath: root,
    conversation: [{ role: "user", content: "你好" }],
    fetchImpl,
  });
  assert.equal(result.status, "done");
  const first = calls.find((call) => call.method === "POST" && call.url.endsWith("/chat/completions"));
  const tools = first.body.tools;
  assert.ok(findTool(tools, "web_search"), "本地 web_search 保留");
  assert.equal(findTool(tools, "convert"), undefined);
  assert.equal(findTool(tools, "$web_search"), undefined);
  assert.equal(first.body.reasoning_effort, undefined);
  assert.equal(calls.some((call) => call.url.includes("/formulas/")), false, "非 kimi 端点不应请求 Formula 接口");
});

// ---- 10. DeepSeek 原生搜索（Anthropic Messages + web_search_20250305）----
test("deepseekAnthropicBaseUrl：由聊天端点推导 Anthropic 兼容 base", () => {
  assert.equal(deepseekAnthropicBaseUrl("https://api.deepseek.com/responses"), "https://api.deepseek.com/anthropic/v1");
  assert.equal(deepseekAnthropicBaseUrl("https://api.deepseek.com/v1/chat/completions"), "https://api.deepseek.com/anthropic/v1");
  assert.equal(deepseekAnthropicBaseUrl("不是地址"), "https://api.deepseek.com/anthropic/v1");
});

function deepseekSearchPayload() {
  return {
    content: [
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://a.com/x", title: "结果 A", page_age: "2026-08-01" },
          { type: "web_search_result", url: "https://b.com/y", title: "结果 B" },
          { type: "web_search_result", url: "https://a.com/x", title: "结果 A 重复" },
        ],
      },
      { type: "text", text: "找到两条结果", citations: [{ url: "https://a.com/x", cited_text: "A 的引用摘要" }] },
    ],
  };
}

test("searchDeepseekNative：请求形状正确，citations 拼回摘要、按 URL 去重", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    return jsonResponse(deepseekSearchPayload());
  };
  const items = await searchDeepseekNative(fetchImpl, { apiKey: "sk-ds", query: "某企业联系电话", maxResults: 10 });
  assert.equal(calls[0].url, "https://api.deepseek.com/anthropic/v1/messages");
  assert.equal(calls[0].headers["x-api-key"], "sk-ds");
  assert.equal(calls[0].headers.Authorization, "Bearer sk-ds");
  assert.equal(calls[0].body.tools[0].type, "web_search_20250305");
  assert.equal(calls[0].body.tools[0].name, "web_search");
  assert.equal(items.length, 2, "同一 URL 应去重");
  assert.deepEqual(items[0], { url: "https://a.com/x", title: "结果 A", snippet: "A 的引用摘要", publishedAt: "2026-08-01" });
  assert.deepEqual(items[1], { url: "https://b.com/y", title: "结果 B", snippet: "", publishedAt: "" });
});

test("searchDeepseekNative：maxResults 截断、无结果块与 HTTP 错误都抛错", async () => {
  const fetchImpl = async () => jsonResponse(deepseekSearchPayload());
  const items = await searchDeepseekNative(fetchImpl, { apiKey: "k", query: "q", maxResults: 1 });
  assert.equal(items.length, 1);
  await assert.rejects(
    () => searchDeepseekNative(async () => jsonResponse({ content: [{ type: "text", text: "没搜" }] }), { apiKey: "k", query: "q" }),
    /未返回搜索结果/,
  );
  await assert.rejects(
    () => searchDeepseekNative(async () => jsonResponse({}, 401), { apiKey: "k", query: "q" }),
    /HTTP 401/,
  );
});

// ---- Qwen 原生联网搜索 ----

function qwenSearchPayload() {
  return {
    output: [
      { type: "web_search_call", action: { type: "search", query: "某企业电话", sources: [{ url: "https://s.com/only-source" }] } },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "找到两条结果。",
            annotations: [
              { type: "url_citation", url: "https://a.com/x", title: "结果 A" },
              { type: "url_citation", url: "https://b.com/y", title: "结果 B" },
              { type: "url_citation", url: "https://a.com/x", title: "结果 A 重复" },
            ],
          },
        ],
      },
    ],
  };
}

test("qwenResponsesUrl：由聊天端点推导 Responses URL", () => {
  assert.equal(
    qwenResponsesUrl("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
    "https://dashscope.aliyuncs.com/compatible-mode/v1/responses",
  );
  assert.equal(
    qwenResponsesUrl("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"),
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/responses",
  );
  assert.equal(qwenResponsesUrl("不是地址"), "https://dashscope.aliyuncs.com/compatible-mode/v1/responses");
});

test("searchQwenNative：请求形状正确，annotations 与 sources 合并去重", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    return jsonResponse(qwenSearchPayload());
  };
  const { answer, items } = await searchQwenNative(fetchImpl, {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/responses",
    apiKey: "sk-qw", model: "qwen-plus", query: "某企业电话", maxResults: 10,
  });
  assert.equal(calls[0].body.tools[0].type, "web_search");
  assert.equal(calls[0].body.model, "qwen-plus");
  assert.equal(calls[0].headers.Authorization, "Bearer sk-qw");
  assert.equal(answer, "找到两条结果。");
  assert.deepEqual(items.map((item) => item.url), ["https://s.com/only-source", "https://a.com/x", "https://b.com/y"]);
  assert.equal(items[1].title, "结果 A");
});

test("searchQwenNative：model 缺省回退、无来源与 HTTP 错误都抛错", async () => {
  const calls = [];
  await searchQwenNative(async (url, options) => {
    calls.push(JSON.parse(options.body));
    return jsonResponse(qwenSearchPayload());
  }, { apiKey: "k", query: "q" });
  assert.equal(calls[0].model, "qwen-plus", "未传 model 时应回退 qwen-plus");
  await assert.rejects(
    () => searchQwenNative(async () => jsonResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "没搜" }] }] }), { apiKey: "k", query: "q" }),
    /未返回搜索结果/,
  );
  await assert.rejects(
    () => searchQwenNative(async () => jsonResponse({}, 401), { apiKey: "k", query: "q" }),
    /HTTP 401/,
  );
  await assert.rejects(
    () => searchQwenNative(async () => jsonResponse({ error: { message: "bad key" } }), { apiKey: "k", query: "q" }),
    /bad key/,
  );
});

test("runAgent：Qwen 云端端点下 web_search 走 Qwen 原生搜索并复用会话密钥", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const messages = [
    { role: "assistant", content: "", tool_calls: [toolCall("call_qw", "web_search", { query: "某企业电话" })] },
    { role: "assistant", content: "找到了，电话见结果 A。" },
  ];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null });
    if (target.endsWith("/responses")) return jsonResponse(qwenSearchPayload());
    if (target.endsWith("/chat/completions")) {
      const message = messages.length > 1 ? messages.shift() : messages[0];
      return jsonResponse({ choices: [{ message }] });
    }
    throw new Error(`未预期的请求：${target}`);
  };
  const result = await runAgent({
    settings: { endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", apiKey: "sk-qwen-session" },
    workspacePath: root,
    conversation: [{ role: "user", content: "查企业电话" }],
    fetchImpl,
    requestApproval: async () => true,
  });
  assert.equal(result.status, "done");
  const searchCall = calls.find((call) => call.url.endsWith("/responses"));
  assert.ok(searchCall, "应发起 Qwen 原生搜索请求");
  assert.equal(searchCall.url, "https://dashscope.aliyuncs.com/compatible-mode/v1/responses");
  assert.equal(searchCall.headers.Authorization, "Bearer sk-qwen-session", "Qwen 端点应复用会话密钥");
  const chatCalls = calls.filter((call) => call.url.endsWith("/chat/completions"));
  const toolMessage = chatCalls[1].body.messages.find((message) => message.role === "tool");
  assert.match(toolMessage.content, /搜索来源：Qwen 联网搜索（服务端）/);
  assert.match(toolMessage.content, /综合答复：找到两条结果。/);
  assert.match(toolMessage.content, /\d+\. 结果 A\nhttps:\/\/a\.com\/x/);
});

// 搜索路由 mock：chat/completions 按脚本返回，/anthropic/v1/messages 返回 DeepSeek 搜索，博查返回固定结果
function routingFetch({ scriptedMessages, calls, searchPayload = deepseekSearchPayload() }) {
  const messages = [...scriptedMessages];
  return async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || "GET", headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null });
    if (target.endsWith("/anthropic/v1/messages")) return jsonResponse(searchPayload);
    if (target.endsWith("/chat/completions")) {
      const message = messages.length > 1 ? messages.shift() : messages[0];
      return jsonResponse({ choices: [{ message }] });
    }
    if (target.includes("bochaai.com")) {
      return jsonResponse({ data: { webPages: { value: [{ url: "https://b.cn/p", name: "博查结果", snippet: "博查摘要" }] } } });
    }
    throw new Error(`未预期的请求：${target}`);
  };
}

test("runAgent：DeepSeek 端点下 web_search 走 DeepSeek 原生搜索并复用会话密钥", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = routingFetch({
    scriptedMessages: [
      { role: "assistant", content: "", tool_calls: [toolCall("call_ds", "web_search", { query: "某企业电话" })] },
      { role: "assistant", content: "找到了，电话见结果 A。" },
    ],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-v4-flash", apiKey: "sk-session-ds" },
    workspacePath: root,
    conversation: [{ role: "user", content: "查企业电话" }],
    fetchImpl,
    requestApproval: async () => true,
  });
  assert.equal(result.status, "done");
  assert.equal(result.finalText, "找到了，电话见结果 A。");
  const searchCall = calls.find((call) => call.url.endsWith("/anthropic/v1/messages"));
  assert.ok(searchCall, "应发起 DeepSeek 原生搜索请求");
  assert.equal(searchCall.url, "https://api.deepseek.com/anthropic/v1/messages");
  assert.equal(searchCall.headers["x-api-key"], "sk-session-ds", "DeepSeek 端点应复用会话密钥");
  const chatCalls = calls.filter((call) => call.url.endsWith("/chat/completions"));
  const toolMessage = chatCalls[1].body.messages.find((message) => message.role === "tool");
  assert.match(toolMessage.content, /搜索来源：DeepSeek 联网搜索（服务端）/);
  assert.match(toolMessage.content, /1\. 结果 A（2026-08-01）\nhttps:\/\/a\.com\/x\n摘要：A 的引用摘要/);
});

test("runAgent：其他端点默认走 DeepSeek 搜索（用独立配置密钥，非会话密钥）", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = routingFetch({
    scriptedMessages: [
      { role: "assistant", content: "", tool_calls: [toolCall("call_o", "web_search", { query: "某企业电话" })] },
      { role: "assistant", content: "查好了。" },
    ],
    calls,
  });
  const result = await runAgent({
    settings: {
      endpoint: "http://mock.local/v1/chat/completions",
      model: "mock-model",
      apiKey: "sk-other-session",
      deepseekSearchApiKey: "sk-ds-search",
    },
    workspacePath: root,
    conversation: [{ role: "user", content: "查企业电话" }],
    fetchImpl,
    requestApproval: async () => true,
  });
  assert.equal(result.status, "done");
  const searchCall = calls.find((call) => call.url.endsWith("/anthropic/v1/messages"));
  assert.ok(searchCall, "应发起 DeepSeek 原生搜索请求");
  assert.equal(searchCall.headers["x-api-key"], "sk-ds-search", "其他端点应使用 deepseekSearchApiKey");
  assert.equal(calls.some((call) => call.url.includes("bochaai.com")), false, "有 DeepSeek 密钥时不应走博查");
});

test("runAgent：未配置 DeepSeek 搜索密钥时回退博查", async () => {
  const root = await makeWorkspace();
  const calls = [];
  const fetchImpl = routingFetch({
    scriptedMessages: [
      { role: "assistant", content: "", tool_calls: [toolCall("call_b", "web_search", { query: "某企业电话" })] },
      { role: "assistant", content: "查好了。" },
    ],
    calls,
  });
  const result = await runAgent({
    settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "k", bochaApiKey: "bk" },
    workspacePath: root,
    conversation: [{ role: "user", content: "查企业电话" }],
    fetchImpl,
    requestApproval: async () => true,
  });
  assert.equal(result.status, "done");
  assert.equal(calls.some((call) => call.url.endsWith("/anthropic/v1/messages")), false, "无 DeepSeek 密钥不应发起 DeepSeek 搜索");
  assert.equal(calls.some((call) => call.url.includes("bochaai.com")), true, "应回退到博查");
  const chatCalls = calls.filter((call) => call.url.endsWith("/chat/completions"));
  const toolMessage = chatCalls[1].body.messages.find((message) => message.role === "tool");
  assert.match(toolMessage.content, /搜索来源：博查 API/);
  assert.match(toolMessage.content, /博查结果/);
});

// ---- 9. 流式 tool_calls 多 index 拼接（锁现有解析器行为）----
test("requestModel 流式：delta.tool_calls 按 index 累积 id/name/arguments（含多 index）", async () => {
  const calls = [];
  const events = [
    { choices: [{ delta: { role: "assistant", content: "" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "web_search", arguments: "" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"北京天气"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
  const message = await requestModel({
    settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "k" },
    messages: [{ role: "user", content: "查天气" }],
    fetchImpl: sseFetch(events, calls),
  });
  assert.ok(message.tool_calls, "应识别出 tool_calls");
  assert.equal(message.tool_calls.length, 1);
  assert.equal(message.tool_calls[0].id, "call_1");
  assert.equal(message.tool_calls[0].function.name, "web_search");
  assert.equal(message.tool_calls[0].function.arguments, '{"query":"北京天气"}');
});
