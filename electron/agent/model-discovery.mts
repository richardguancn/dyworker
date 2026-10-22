// 模型端点规范化和服务能力查询。


// DeepSeek 官方 Responses API 的 base_url 是 https://api.deepseek.com（不带路径），
// 实际请求地址是 https://api.deepseek.com/responses；用户按文档只填根地址时自动补齐。
export function normalizeModelEndpoint(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname === "api.deepseek.com" && (url.pathname === "" || url.pathname === "/")) {
      url.pathname = "/responses";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {
    // 非合法 URL 时保持原样，交由请求阶段报错
  }
  return value;
}

export function isResponsesEndpoint(endpoint) {
  const value = normalizeModelEndpoint(endpoint);
  try {
    return /\/responses\/?$/.test(new URL(value).pathname);
  } catch {
    return /\/responses\/?(?:[?#].*)?$/.test(value);
  }
}

// 模型名上下文覆盖语法：k3[1M]、Qwen3.8-27B[256K]、model[131072]（与渲染端 parseModelContextOverride 一致）。
// 方括号后缀只用于本地上下文管理；发给服务端的请求一律剥离后缀，避免服务端识别不了模型名。
export function bareModelName(model) {
  const raw = String(model || "").trim();
  const match = raw.match(/^(.*?)\s*\[([0-9]+(?:\.[0-9]+)?)\s*([kKmM])?\]$/);
  return match ? match[1].trim() : raw;
}

// 服务器自报的上下文上限探测：OpenAI 兼容服务的 GET /models 通常带 max_model_len（vLLM 等）。
// 本地/自建模型的实际上限往往远小于静态表的 128k 默认值（如 32k），按默认值累积上下文会把
// 超出服务器能力的请求发出去——轻则 400，重则打垮引擎导致连接被批量重置（ECONNRESET）。
// 按 endpoint+model 缓存（含失败结果），探测失败静默返回 null，调用方回退既有默认值。
const serverContextLimitCache = new Map();
const SERVER_CONTEXT_PROBE_TIMEOUT_MS = 5000;
const SERVER_LIST_MODELS_TIMEOUT_MS = 15_000;

function modelsUrlFromEndpoint(endpoint) {
  try {
    const url = new URL(normalizeModelEndpoint(endpoint));
    if (!/^https?:$/.test(url.protocol)) return "";
    if (!/\/(chat\/completions|responses|completions)\/?$/.test(url.pathname)) return "";
    url.pathname = url.pathname.replace(/\/(chat\/completions|responses|completions)\/?$/, "/models");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export async function probeServerContextLimit({ endpoint, model, apiKey = "", fetchImpl = fetch }) {
  const url = modelsUrlFromEndpoint(endpoint);
  const name = bareModelName(model);
  if (!url || !name) return null;
  const key = `${url}\n${name}`;
  if (serverContextLimitCache.has(key)) return serverContextLimitCache.get(key);
  let limit = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_CONTEXT_PROBE_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (response?.ok) {
      const result = await response.json();
      const item = (Array.isArray(result?.data) ? result.data : [])
        .find((entry) => String(entry?.id || "") === name);
      const value = Number(item?.max_model_len);
      if (Number.isFinite(value) && value > 0) limit = Math.floor(value);
    }
  } catch {
    // 探测失败（端点不支持 /models、网络异常等）：静默回退，不影响任务
  }
  if (serverContextLimitCache.size >= 50) serverContextLimitCache.delete(serverContextLimitCache.keys().next().value);
  serverContextLimitCache.set(key, limit);
  return limit;
}

// 拉取同一密钥下的可用模型列表（GET /models，OpenAI 兼容约定）：
// 设置页填好服务地址与密钥后即可列出该账号可用的全部模型，在同一 Key 下直接切换，
// 不必等厂商清单更新预设。地址推导与 probeServerContextLimit 同一套（含 DeepSeek 根地址补全）。
// 部分服务不提供 /models（如某些中转），按状态码给出可操作的错误信息；本地服务空 Key 不带鉴权头。
export async function listServerModels({ endpoint, apiKey = "", fetchImpl = fetch }) {
  const url = modelsUrlFromEndpoint(endpoint);
  if (!url) {
    return {
      ok: false,
      error: "无法从服务地址推导模型列表接口：请填写完整的 Chat Completions 地址（如 https://api.example.com/v1/chat/completions）",
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_LIST_MODELS_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
  } catch (error: any) {
    const aborted = error?.name === "AbortError";
    return { ok: false, error: aborted ? "获取模型列表超时（15 秒无响应），服务地址可能不可达" : `无法连接服务地址：${error?.message || error}` };
  } finally {
    clearTimeout(timer);
  }
  // 先完整读文本再解析（不能先截断：真实厂商的模型列表普遍超过 300 字符，截断后 JSON.parse 必失败）；
  // 截断只用于错误提示里展示响应片段
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  const detail = text.replace(/\s+/g, " ").slice(0, 300);
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, error: `密钥被拒绝（HTTP ${response.status}）：${detail || "请检查 API Key 是否正确、是否过期或权限不足"}` };
    }
    if (response.status === 404) {
      return { ok: false, status: response.status, error: `该服务未提供模型列表接口（HTTP 404）：${detail || "可手动填写模型名称，或确认服务地址是否正确"}` };
    }
    if (response.status === 429) {
      return { ok: false, status: response.status, error: `请求被限流（HTTP 429）：${detail || "请稍后重试"}` };
    }
    return { ok: false, status: response.status, error: `获取模型列表失败（HTTP ${response.status}）：${detail || "服务可达，但请求未被接受"}` };
  }
  // OpenAI 约定 { data: [...] }；部分网关返回 { models: [...] } 或裸数组，一并兼容
  const rows = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
      : Array.isArray(payload) ? payload
        : null;
  if (!rows) {
    return { ok: false, error: `服务返回的内容不是模型列表（缺少 data 字段）：${detail ? `${detail.slice(0, 120)}…` : "响应为空"}，请手动填写模型名称` };
  }
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    // 条目 id 为主；个别网关用 name（Gemini 原生风格带 models/ 前缀，剥掉保持可直接用作模型名）
    const id = String(row?.id || String(row?.name || "").replace(/^models\//, "")).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // vLLM 等会在列表里带 max_model_len，顺带提取给渲染端展示
    const limit = Number(row?.max_model_len);
    models.push({ id, ...(Number.isFinite(limit) && limit > 0 ? { contextLimit: Math.floor(limit) } : {}) });
  }
  if (!models.length) {
    return { ok: false, error: "服务返回的模型列表为空：请确认该密钥名下有可用模型（如百炼需先开通对应模型服务）" };
  }
  return { ok: true, count: models.length, models };
}
