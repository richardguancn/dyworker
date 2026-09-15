// 厂商原生能力适配层（v1：Kimi 开放平台官方工具；v2：GLM 智谱开放平台原生搜索与 OCR）。
// 本文件不依赖 electron，方便用 node --test 直接测试。
//
// 背景：Kimi 有两套独立产品，官方工具（Formula API）与内置 $web_search 只文档化在
// 「Kimi 开放平台」（api.moonshot.cn / api.moonshot.ai，按量付费）上；
// 「Kimi 编程套餐」（api.kimi.com/coding/...，订阅制）不支持 Formula API。
// Kimi 部分只针对开放平台端点实现，非开放平台端点一律返回 null / 不启用。
//
// GLM（智谱开放平台 open.bigmodel.cn）按官方文档接入两项原生能力：
// - Web Search API（/paas/v4/web_search）：webSearch 链的厂商路由后端；
// - GLM-OCR 文档解析（/paas/v4/layout_parsing）：ocr_file 工具的识别引擎。
//
// 后续为 DeepSeek / 通义等厂商扩展原生能力时，在本文件按同样的
// detectProvider + 能力定义 + 执行函数的模式追加。

// Kimi 官方 12 个 Formula 工具（URI 列表可硬编码；function.name 需运行时 GET /tools 获取，
// 不要硬编码名字——官方声明才是一致性来源）
export const KIMI_FORMULA_URIS = Object.freeze([
  "moonshot/convert:latest",
  "moonshot/web-search:latest",
  "moonshot/rethink:latest",
  "moonshot/random-choice:latest",
  "moonshot/mew:latest",
  "moonshot/memory:latest",
  "moonshot/excel:latest",
  "moonshot/date:latest",
  "moonshot/base64:latest",
  "moonshot/fetch:latest",
  "moonshot/quickjs:latest",
  "moonshot/code-runner:latest",
]);

// Kimi 内置联网搜索（builtin_function）：$ 前缀是 Kimi 内置函数约定（普通 function 不允许 $），
// 不需要 parameters 说明，只声明 type + name 即可
export const KIMI_WEB_SEARCH_DEFINITION = Object.freeze({
  type: "builtin_function",
  function: { name: "$web_search" },
});

// Kimi 开放平台默认关闭的公式工具（会向服务端持久化数据 / 上传文件内容，safe-by-default）：
// memory 把对话历史与用户偏好持久化到 Kimi 服务端；excel 分析 Excel/CSV 可能需要上传文件内容
export const KIMI_DEFAULT_DISABLED_TOOLS = Object.freeze(["memory", "excel"]);

// 公式工具中需要本地联网审批语义的名字映射：kimi function.name → 本地审批用名。
// web_search 与本地同名（本地 web_search 在 kimi 开启时被剔除，不重名）；fetch 映射为本地 fetch_web_page。
export const KIMI_INTERNET_TOOL_MAP = Object.freeze({
  web_search: "web_search",
  fetch: "fetch_web_page",
});

// Kimi 开放平台主机名（官方文档 base_url = https://api.moonshot.cn/v1）
const KIMI_OPEN_HOSTS = new Set(["api.moonshot.cn", "api.moonshot.ai"]);

// Kimi 编程套餐主机名（订阅制，不支持 Formula API，但同样支持 reasoning_effort）
const KIMI_HOSTS = new Set(["api.kimi.com"]);

// DeepSeek 官方主机名（聊天走 /responses 或 /chat/completions；原生搜索走 Anthropic 兼容端点 /anthropic/v1/messages）
const DEEPSEEK_HOSTS = new Set(["api.deepseek.com"]);

// Qwen（阿里云百炼 DashScope）官方主机名：国内与国际站共用同一套 OpenAI 兼容协议
const QWEN_HOSTS = new Set(["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"]);

// GLM（智谱开放平台）主机名
const GLM_HOSTS = new Set(["open.bigmodel.cn"]);

// MiniMax 主机名：国内站 api.minimaxi.com，海外站 api.minimax.io
const MINIMAX_HOSTS = new Set(["api.minimaxi.com", "api.minimax.io"]);

// OpenAI 官方主机名
const OPENAI_HOSTS = new Set(["api.openai.com"]);

// Google Gemini OpenAI 兼容层主机名
const GEMINI_HOSTS = new Set(["generativelanguage.googleapis.com"]);

// xAI Grok 主机名
const XAI_HOSTS = new Set(["api.x.ai"]);

// 豆包（火山方舟）主机名：ark.{region}.volces.com
function isDoubaoHost(host) {
  return String(host || "").endsWith(".volces.com");
}

// Qwen 原生联网搜索（官方 OpenAI 兼容-Responses 内建工具 {"type":"web_search"}）。
// 注意协议差异（官方文档《联网搜索》）：OpenAI 兼容-ChatCompletions 的 enable_search
// 只回正文、不回搜索来源；只有 Responses 协议会自动返回来源（message 的 url_citation
// 角标与 web_search_call 的 action.sources），所以这里走 /responses。
// 每次搜索计一次模型调用 + 服务端搜索费用。本函数只做云端端点路由；
// 本地 vLLM 部署没有服务端搜索后端，应继续走 webSearch 链的其他后端。
export const QWEN_SEARCH_FALLBACK_MODEL = "qwen-plus";

// 由 Qwen 聊天端点推导 Responses URL（…/compatible-mode/v1/chat/completions → …/responses）
export function qwenResponsesUrl(endpoint) {
  const value = String(endpoint || "").trim();
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/chat\/completions\/?$/, "")}/responses`;
  } catch {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1/responses";
  }
}

// 执行一次 Qwen 原生搜索，返回归一化结果数组 [{ title, url, snippet, publishedAt }] 与答案正文。
// 既无 url_citation 也无 sources 视为错误（说明未触发服务端搜索），由调用方回退其他后端。
export async function searchQwenNative(fetchImpl, { apiKey, model, query, maxResults = 10, signal, baseUrl }) {
  const response = await fetchImpl(baseUrl, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: String(model || "").trim() || QWEN_SEARCH_FALLBACK_MODEL,
      input: query,
      tools: [{ type: "web_search" }],
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Qwen 搜索返回错误（HTTP ${response.status}）`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`Qwen 搜索返回错误：${payload.error.message || JSON.stringify(payload.error)}`);
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const seen = new Set();
  const items = [];
  const push = (url, title) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push({ url, title: String(title || ""), snippet: "", publishedAt: "" });
  };
  let answer = "";
  for (const item of output) {
    if (item?.type === "web_search_call") {
      for (const source of Array.isArray(item.action?.sources) ? item.action.sources : []) push(source?.url, "");
    }
    if (item?.type === "message") {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if ((part?.type === "output_text" || part?.type === "text") && typeof part.text === "string") answer += part.text;
        for (const cite of Array.isArray(part?.annotations) ? part.annotations : []) {
          if (cite?.type === "url_citation" && cite.url) push(cite.url, cite.title);
        }
      }
    }
  }
  if (!items.length) throw new Error("Qwen 未返回搜索结果（可能未触发服务端搜索）");
  return { answer: answer.trim(), items: items.slice(0, Math.min(Math.max(maxResults, 1), 20)) };
}

// DeepSeek 原生搜索（官方 Anthropic 兼容端点 + 服务端工具 web_search_20250305）。
// 参考 deepseek-ai/deepseek-harness 的 dsh-web-search-deepseek 实现：
// 搜索本质是额外发一次带服务端搜索工具的 Messages 请求，搜索在 DeepSeek 服务端执行，
// 本地只解析 web_search_tool_result 块；摘要不在结果项里，而在 text 块的 citations[].cited_text，
// 需按 url 拼回。每次搜索计一次模型调用（deepseek-v4-flash）+ 服务端搜索工具费用。
export const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic/v1";
export const DEEPSEEK_SEARCH_MODEL = "deepseek-v4-flash";
const DEEPSEEK_SEARCH_MAX_USES = 5;
const DEEPSEEK_SEARCH_MAX_TOKENS = 4096;
const DEEPSEEK_API_VERSION = "2023-06-01";

// 由 DeepSeek 聊天端点推导 Anthropic 兼容 base（/responses、/chat/completions 都在 origin 下）
export function deepseekAnthropicBaseUrl(endpoint) {
  try {
    return `${new URL(String(endpoint || "").trim()).origin}/anthropic/v1`;
  } catch {
    return DEEPSEEK_ANTHROPIC_BASE_URL;
  }
}

// 执行一次 DeepSeek 原生搜索，返回归一化结果数组 [{ title, url, snippet, publishedAt }]。
// 没有 web_search_tool_result 块视为错误（说明未触发服务端搜索），由调用方回退其他后端。
export async function searchDeepseekNative(fetchImpl, { apiKey, query, maxResults = 10, signal, baseUrl = DEEPSEEK_ANTHROPIC_BASE_URL }) {
  const response = await fetchImpl(`${baseUrl}/messages`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // 官方端点认 x-api-key；Anthropic 兼容代理可能认 Authorization，两个都发
      "x-api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": DEEPSEEK_API_VERSION,
    },
    body: JSON.stringify({
      model: DEEPSEEK_SEARCH_MODEL,
      max_tokens: DEEPSEEK_SEARCH_MAX_TOKENS,
      messages: [{ role: "user", content: [{ type: "text", text: `Perform a web search for the query: ${query}` }] }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: DEEPSEEK_SEARCH_MAX_USES }],
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`DeepSeek 搜索返回错误（HTTP ${response.status}）`);
  const payload = await response.json();
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const resultBlocks = blocks.filter((block) => block?.type === "web_search_tool_result");
  if (!resultBlocks.length) throw new Error("DeepSeek 未返回搜索结果（可能未触发服务端搜索）");
  // 摘要在 text 块的 citations 里，按 url 建映射（首次出现为准）
  const snippetByUrl = new Map();
  for (const block of blocks) {
    if (block?.type !== "text") continue;
    for (const cite of Array.isArray(block.citations) ? block.citations : []) {
      if (cite?.url && cite?.cited_text && !snippetByUrl.has(cite.url)) {
        snippetByUrl.set(cite.url, cite.cited_text);
      }
    }
  }
  const seen = new Set();
  const items = [];
  for (const block of resultBlocks) {
    for (const item of Array.isArray(block?.content) ? block.content : []) {
      if (item?.type !== "web_search_result" || !item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      items.push({
        url: item.url,
        title: String(item.title || ""),
        snippet: String(snippetByUrl.get(item.url) || ""),
        publishedAt: String(item.page_age || ""),
      });
    }
  }
  return items.slice(0, Math.min(Math.max(maxResults, 1), 20));
}

// GLM 原生联网搜索（智谱 Web Search API，独立于聊天的工具接口）。
// 官方文档《联网搜索》：POST /paas/v4/web_search，返回结构化 search_result
// （标题/摘要/链接/网站名/发布时间），比公开网页抓取稳定，且结果可溯源。
// 搜索引擎默认 search_std（智谱基础版引擎，按次计费最低）；search_result
// 空视为失败，由调用方回退 webSearch 链的其他后端。不接入 Chat Completions
// 内置 web_search 工具（tools:[{type:"web_search"}]）：服务端隐式搜索绕过
// 本地联网审批与审计口径，本地工具 + 搜索 API 的组合全程可审计。
export const GLM_SEARCH_ENGINE = "search_std";
const GLM_SEARCH_QUERY_MAX_CHARS = 70;

// 由 GLM 聊天端点推导工具 API base：
//   https://open.bigmodel.cn/api/paas/v4/chat/completions → https://open.bigmodel.cn/api/paas/v4
export function glmToolBaseUrl(endpoint) {
  const value = String(endpoint || "").trim();
  const marker = "/chat/completions";
  const index = value.indexOf(marker);
  if (index > 0) return value.slice(0, index);
  try {
    const url = new URL(value);
    return `${url.origin}/api/paas/v4`;
  } catch {
    return "https://open.bigmodel.cn/api/paas/v4";
  }
}

// 执行一次 GLM 原生搜索，返回归一化结果数组 [{ title, url, snippet, publishedAt }]。
export async function searchGlmNative(fetchImpl, { apiKey, query, maxResults = 10, signal, baseUrl, searchEngine = GLM_SEARCH_ENGINE }) {
  const response = await fetchImpl(`${baseUrl || glmToolBaseUrl("")}/web_search`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    // 官方限制 search_query ≤ 70 字符，超长截断（关键词都在前部，截断不改变意图）
    body: JSON.stringify({
      search_query: String(query || "").slice(0, GLM_SEARCH_QUERY_MAX_CHARS),
      search_engine: searchEngine,
      search_intent: false,
      count: Math.min(Math.max(Number(maxResults) || 10, 1), 50),
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`GLM 搜索返回错误（HTTP ${response.status}）`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`GLM 搜索返回错误：${payload.error.message || JSON.stringify(payload.error)}`);
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(payload?.search_result) ? payload.search_result : []) {
    if (!item?.link || seen.has(item.link)) continue;
    seen.add(item.link);
    const title = item.media ? `${String(item.title || "").trim()} - ${item.media}` : String(item.title || "").trim();
    items.push({
      url: item.link,
      title,
      snippet: String(item.content || ""),
      publishedAt: String(item.publish_date || ""),
    });
  }
  if (!items.length) throw new Error("GLM 搜索未返回结果");
  return items.slice(0, Math.min(Math.max(Number(maxResults) || 10, 1), 50));
}

// GLM-OCR 文档解析（官方文档《文档解析》：POST /paas/v4/layout_parsing）。
// 0.9B 专业 OCR 模型，支持图片（PNG/JPG，单张 ≤10MB）与 PDF（≤50MB、≤100 页），
// 印刷体/手写体/表格/公式/印章均可识别，md_results 返回 Markdown（复杂表格转 HTML 表格）。
// file 字段官方支持 URL 与 base64；本地文件按 GLM 视觉系约定编码为 Data URL 传入。
export const GLM_OCR_MODEL = "glm-ocr";

// 执行一次 GLM-OCR 识别，返回 { markdown, usage }。md_results 为空视为失败。
export async function glmOcrFile(fetchImpl, { apiKey, file, startPage, endPage, signal, baseUrl }) {
  const response = await fetchImpl(`${baseUrl || glmToolBaseUrl("")}/layout_parsing`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GLM_OCR_MODEL,
      file,
      // 页码参数仅 PDF 有效；从 1 起，未提供时不传
      ...(Number(startPage) >= 1 ? { start_page_id: Math.floor(Number(startPage)) } : {}),
      ...(Number(endPage) >= 1 ? { end_page_id: Math.floor(Number(endPage)) } : {}),
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`GLM-OCR 返回错误（HTTP ${response.status}）`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`GLM-OCR 返回错误：${payload.error.message || JSON.stringify(payload.error)}`);
  const markdown = String(payload?.md_results || "").trim();
  if (!markdown) throw new Error("GLM-OCR 未返回识别结果");
  return { markdown, usage: payload?.usage || null };
}

// GLM 多模态模型（原生处理 image_url，无需视觉服务改写）：
// GLM-5.3-Flash（原生多模态 VLM）、GLM-4.5V、GLM-4.1V 系（thinking）与
// 历史 GLM-4V 系（4v / 4v-plus / 4v-flash）。纯文本模型（glm-5.3、glm-4.6 等）不在其列。
const GLM_NATIVE_VISION_MODEL_PATTERN = /^glm-(5\.3-flash|4\.5v|4\.1v|4v)(?=[-_]|$)/i;

export function isGlmNativeVisionModel(model) {
  return GLM_NATIVE_VISION_MODEL_PATTERN.test(String(model || "").trim());
}

// 由 URI slug 推导 function.name（slug 用连字符，function.name 用下划线，如 web-search → web_search）
export function kimiFormulaToolNameFor(uri) {
  const slug = String(uri || "").split("/")[1]?.split(":")[0] || "";
  return slug.replace(/-/g, "_");
}

const KIMI_FORMULA_TOOL_NAMES = new Set(KIMI_FORMULA_URIS.map(kimiFormulaToolNameFor));

// 判断名字是否属于 Kimi 公式工具（静态推导集合；运行时以 fetchKimiFormulaDefinitions 返回的
// nameToUri 为准，本函数只用于展示与兜底）
export function isKimiFormulaToolName(name) {
  return KIMI_FORMULA_TOOL_NAMES.has(String(name || ""));
}

// 检测 endpoint 属于哪个厂商：用于原生能力集（Kimi 开放平台 Formula API）与推理强度参数映射
export function detectProvider(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value) return null;
  try {
    const host = new URL(value).hostname;
    if (KIMI_OPEN_HOSTS.has(host)) return "kimi-open";
    if (KIMI_HOSTS.has(host)) return "kimi";
    if (DEEPSEEK_HOSTS.has(host)) return "deepseek";
    if (QWEN_HOSTS.has(host)) return "qwen";
    if (GLM_HOSTS.has(host)) return "glm";
    if (MINIMAX_HOSTS.has(host)) return "minimax";
    if (OPENAI_HOSTS.has(host)) return "openai";
    if (GEMINI_HOSTS.has(host)) return "gemini";
    if (XAI_HOSTS.has(host)) return "xai";
    if (isDoubaoHost(host)) return "doubao";
    return null;
  } catch {
    return null;
  }
}

// 由 chat/completions 端点推导 Formula API base：
//   https://api.moonshot.cn/v1/chat/completions → https://api.moonshot.cn/v1
export function kimiFormulaBaseUrl(endpoint) {
  const value = String(endpoint || "").trim();
  const marker = "/chat/completions";
  const index = value.indexOf(marker);
  if (index > 0) return value.slice(0, index);
  try {
    const url = new URL(value);
    return `${url.origin}/v1`;
  } catch {
    return value;
  }
}

// Formula 工具声明进程内缓存：key = baseUrl|uri，值 = { tools, fetchedAt }
const kimiDefinitionCache = new Map();
const KIMI_DEFINITION_CACHE_TTL_MS = 10 * 60 * 1000;

function readKimiDefinitionCache(baseUrl, uri) {
  const entry = kimiDefinitionCache.get(`${baseUrl}|${uri}`);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > KIMI_DEFINITION_CACHE_TTL_MS) {
    kimiDefinitionCache.delete(`${baseUrl}|${uri}`);
    return null;
  }
  return entry.tools;
}

function writeKimiDefinitionCache(baseUrl, uri, tools) {
  kimiDefinitionCache.set(`${baseUrl}|${uri}`, { tools, fetchedAt: Date.now() });
}

// 并发拉取启用中的 Formula 工具声明（GET /formulas/{uri}/tools，幂等）。
// 429/5xx 重试 1 次；单个 URI 失败不影响其余 URI，全部失败才抛错（由调用方降级）。
// 返回 { definitions: [OpenAI function tool], nameToUri: { functionName: uri } }
export async function fetchKimiFormulaDefinitions(fetchImpl, { baseUrl, apiKey, signal, enabledUris }) {
  const uris = Array.isArray(enabledUris) && enabledUris.length ? enabledUris : [...KIMI_FORMULA_URIS];
  const settled = await Promise.allSettled(uris.map(async (uri) => {
    const cached = readKimiDefinitionCache(baseUrl, uri);
    if (cached) return { uri, tools: cached };
    let lastError = null;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        const response = await fetchImpl(`${baseUrl}/formulas/${uri}/tools`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          ...(signal ? { signal } : {}),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Formula 定义拉取被限流或服务暂不可用（HTTP ${response.status}）`);
          continue;
        }
        if (!response.ok) {
          lastError = new Error(`Formula 定义拉取失败（HTTP ${response.status}）`);
          break;
        }
        const body = await response.json();
        const tools = Array.isArray(body?.tools) ? body.tools : [];
        writeKimiDefinitionCache(baseUrl, uri, tools);
        return { uri, tools };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (signal?.aborted) throw error;
      }
    }
    throw lastError;
  }));
  const definitions = [];
  const nameToUri = {};
  let firstError = null;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      const { uri, tools } = result.value;
      for (const tool of tools) {
        const name = tool?.function?.name;
        if (!name) continue;
        definitions.push(tool);
        nameToUri[name] = uri;
      }
    } else {
      firstError ||= result.reason;
    }
  }
  if (!definitions.length && firstError) throw firstError;
  return { definitions, nameToUri };
}

// 执行 Formula fiber（POST /formulas/{uri}/fibers）：body = { name, arguments }，
// arguments 原样透传（不二次转义、不解析重排）。fiber 是一次性计费动作，
// 只对连接层失败保守重试 1 次；服务端已返回的状态（HTTP 错误、status !== "succeeded"）不重试。
// 返回 fiber 的 context.output（或 context.encrypted_output 原样透传，如 web-search 的密文结果）。
export async function runKimiFormula(fetchImpl, { baseUrl, apiKey, uri, name, arguments: argsText, signal }) {
  let lastError = null;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const response = await fetchImpl(`${baseUrl}/formulas/${uri}/fibers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name, arguments: argsText }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        lastError = new Error(`Kimi 官方工具执行失败（HTTP ${response.status}）`);
        break;
      }
      const body = await response.json();
      if (String(body?.status || "") !== "succeeded") {
        lastError = new Error(
          `Kimi 官方工具执行未成功（status=${String(body?.status || "unknown")}）${body?.error ? `：${String(body.error)}` : ""}`,
        );
        break;
      }
      const output = body?.context?.output ?? body?.context?.encrypted_output ?? "";
      return output;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (signal?.aborted) throw error;
      // 只有连接层失败才重试；业务错误（fiber 状态、HTTP 4xx）立即抛出
      if (!/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|网络|连接|超时|timeout|abort/i.test(lastError.message)) {
        throw lastError;
      }
    }
  }
  throw lastError;
}
