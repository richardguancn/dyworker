// 模型请求传输、超时与重试。
import { MODEL_IDLE_TIMEOUT_MS,MODEL_NETWORK_RETRY_BASE_DELAY_MS,MODEL_NETWORK_RETRY_LIMIT,MODEL_STATUS_RETRY_BASE_DELAY_MS,MODEL_STATUS_RETRY_LIMIT,MODEL_STATUS_RETRY_MAX_DELAY_MS } from "./shared.mts";

// undici 把连接层失败统一报成 "fetch failed"，真正的错因（ECONNREFUSED/ECONNRESET/ETIMEDOUT 等）
// 在 error.cause 上。拼进消息方便用户与日志定位，同时保证上层按消息识别网络错误的正则
// （providers.mjs runKimiFormula 等）继续命中。
function decorateNetworkError(error, endpoint) {
  if (!(error instanceof Error)) return error;
  const cause = error.cause;
  if (!(cause instanceof Error)) return error;
  const target = cause.address ? `${cause.address}${cause.port ? `:${cause.port}` : ""}` : String(endpoint || "");
  const detail = [cause.code, cause.syscall, target].filter(Boolean).join(" ");
  if (!detail || error.message.includes(cause.code || "__none__")) return error;
  const wrapped = new Error(`${error.message}（${detail}）`);
  wrapped.cause = cause;
  if (error.status) wrapped.status = error.status;
  return wrapped;
}

export function modelTransportError(message, code) {
  return Object.assign(new Error(message), { name: "AbortError", code });
}

export function isModelTransportError(error) {
  if (Number.isFinite(Number(error?.status))) return false;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return true;
  const detail = `${error?.message || error} ${error?.code || ""} ${error?.cause?.code || ""}`;
  return /fetch failed|terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|socket hang up/i.test(detail);
}

// 重试等待也响应停止；仅提供 isCancelled 的后台任务最多 100ms 后停止等待。
export function waitModelRetry(delayMs, signal, isCancelled = () => false) {
  return new Promise<void>((resolve, reject) => {
    let timer;
    let poll;
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => { cleanup(); reject(modelTransportError("任务已停止", "MODEL_CANCELLED")); };
    if (signal?.aborted || isCancelled()) { cancel(); return; }
    signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => { cleanup(); resolve(); }, Math.max(0, delayMs));
    poll = setInterval(() => { if (isCancelled()) cancel(); }, 100);
  });
}

// 每次收到字节重置空闲计时；完成、断线、超时或取消都清理计时器和连接。
export function watchStreamIdle(reader, idleTimeoutMs = MODEL_IDLE_TIMEOUT_MS, signal = null) {
  let timer = null;
  let tripped = false;
  const cancelReader = () => { void reader.cancel?.().catch(() => { }); };
  const arm = () => {
    if (!(idleTimeoutMs > 0)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      tripped = true;
      cancelReader();
    }, idleTimeoutMs);
  };
  arm();
  if (signal?.aborted) cancelReader();
  else signal?.addEventListener("abort", cancelReader, { once: true });
  return {
    reset: arm,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelReader);
      cancelReader();
    },
    throwIfTripped() {
      if (signal?.aborted) throw signal.reason || modelTransportError("任务已停止", "MODEL_CANCELLED");
      if (!tripped) return;
      throw modelTransportError(`模型服务超过 ${Math.round(idleTimeoutMs / 1000)} 秒没有返回任何数据，连接已中断`, "MODEL_IDLE_TIMEOUT");
    },
  };
}

export function sanitizeEndpointUrl(endpoint) {
  try {
    const parsed = new URL(String(endpoint || "").trim());
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return String(endpoint || "").split("?")[0].slice(0, 120);
  }
}

export function isRetryableStatusError(status) {
  const code = Number(status);
  return code === 408 || code === 429 || (code >= 500 && code < 600);
}

export async function postChat({ settings, payload, fetchImpl, signal = null, endpoint = null, apiKey = settings.apiKey, retryBaseDelayMs = MODEL_NETWORK_RETRY_BASE_DELAY_MS, retryLimit = MODEL_NETWORK_RETRY_LIMIT, statusRetryBaseDelayMs = MODEL_STATUS_RETRY_BASE_DELAY_MS, statusRetryLimit = MODEL_STATUS_RETRY_LIMIT, onRetry = null }) {
  // 状态码重试在外层：429/5xx 等瞬时故障按退避重发，最多 statusRetryLimit 次；
  // 每次重发都完整走一遍内层连接重试。等待期间响应取消信号，取消立即停止。
  for (let statusAttempt = 0; ; statusAttempt += 1) {
    let response;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await fetchImpl(endpoint || settings.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // 本地推理服务（vLLM/Ollama/LM Studio）常无需 Key，空 Key 时不带 Authorization 头
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(payload),
          signal,
        });
        break;
      } catch (error: any) {
        // 只有连接层失败才重试；已取消/超时中止或重试次数用完时直接抛出。
        if (signal?.aborted || error?.name === "AbortError") {
          // 超时/断流（AbortError）不在本层重试，抛给外层按传输层失败处理。
          throw decorateNetworkError(error, endpoint || settings.endpoint);
        }
        if (attempt >= retryLimit) {
          // 连接层网络错误重试已耗尽：打标记，外层识别后不再整体重发一轮（否则 6 次×2 轮叠加）
          const decorated = decorateNetworkError(error, endpoint || settings.endpoint);
          if (decorated instanceof Error) decorated.networkRetried = true;
          throw decorated;
        }
        await waitModelRetry(retryBaseDelayMs * 2 ** attempt, signal);
        if (signal?.aborted) throw error;
      }
    }
    if (response.ok) return response;
    const detail = (await response.text()).slice(0, 1200);
    // 服务商内容安全拦截（如百炼 content_filter、Kimi risk_control 等）：输入或模型输出均可能触发，
    // 给出客观指引并脱敏端点，避免武断判定
    if (/content_filter|considered high risk|data_inspection_failed|risk_control/i.test(detail)) {
      const sanitizedTarget = sanitizeEndpointUrl(endpoint || settings?.endpoint);
      let safeDetail = detail;
      try {
        const parsed = JSON.parse(detail);
        const redactObj = (obj) => {
          if (!obj || typeof obj !== "object") return;
          for (const key of Object.keys(obj)) {
            if (/(api[_-]?key|token|secret|password|auth|authorization|credential)/i.test(key)) {
              obj[key] = "[REDACTED]";
            } else if (typeof obj[key] === "object") {
              redactObj(obj[key]);
            }
          }
        };
        redactObj(parsed);
        safeDetail = JSON.stringify(parsed);
      } catch {
        // 非标准 JSON 走正则
      }
      safeDetail = safeDetail.replace(/(["']?(?:api[_-]?key|token|secret|password|auth|authorization|credential)["']?\s*[:=]\s*)(["'][^"']+["']|[^\s,;}{]+)/gi, "$1\"[REDACTED]\"");
      safeDetail = safeDetail.replace(/[a-zA-Z0-9_-]{20,}/g, "[REDACTED]").slice(0, 300);
      const error = new Error(
        `服务商内容安全审核拒绝了本次请求（输入提示词、历史上下文或模型生成内容均可能触发审核）。`
        + `端点：${sanitizedTarget}，状态码：HTTP ${response.status}。`
        + `建议：1) 调整提示词或新建一个任务重试；2) 检查输入或历史材料中是否包含可能触发敏感审核的词句；3) 必要时切换其他模型服务商。`
        + (safeDetail ? `\n服务端返回摘要：${safeDetail}` : "")
      );
      error.status = response.status;
      error.contentFiltered = true;
      throw error;
    }
    // 不可重试的状态码（401/403/400 等）、重试次数用完或已取消：直接抛出。
    // 报错注明已重试次数，外层传输层看到带 status 的错误也不再整体重发，避免叠加。
    if (!isRetryableStatusError(response.status) || statusAttempt >= statusRetryLimit || signal?.aborted) {
      const suffix = statusAttempt > 0 ? `（已自动重试 ${statusAttempt} 次仍失败）` : "";
      const error = new Error(`模型请求失败（${response.status}）：${detail}${suffix}`);
      error.status = response.status;
      if (statusAttempt > 0) error.statusRetries = statusAttempt;
      throw error;
    }
    // 服务端 Retry-After 优先（秒），否则指数退避；两者都不超过单次等待上限
    const retryAfterSeconds = Number(response.headers?.get?.("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(MODEL_STATUS_RETRY_MAX_DELAY_MS, retryAfterSeconds * 1000)
      : Math.min(MODEL_STATUS_RETRY_MAX_DELAY_MS, statusRetryBaseDelayMs * 2 ** statusAttempt);
    onRetry?.({ status: response.status, attempt: statusAttempt + 1, limit: statusRetryLimit, delayMs, detail });
    await waitModelRetry(delayMs, signal);
  }
}

// 模型类接口统一响应解析：中转网关/WAF 有时用 200 状态返回 HTML 错误页
// （拦截页、限流页、欠费页），response.json() 会抛出 "Unexpected token '<' ..."
// 这种看不懂的报错；这里翻译成可读提示，并允许点名是哪个服务/地址出错。
// label 形如「模型服务」「视觉服务」「语音转写服务」，detail 通常填端点地址。
export async function parseModelJson(response, label = "模型服务", detail = "") {
  try {
    return await response.json();
  } catch (parseError: any) {
    // 已收到响应头之后，JSON 正文也可能断线；保留错误类型才能触发重试。
    if (isModelTransportError(parseError)) throw parseError;
    const contentType = response.headers?.get?.("content-type") || "";
    const where = detail ? `（${detail}）` : "";
    throw new Error(
      `${label}返回的不是 JSON${where}（HTTP ${response.status}，${contentType || "未知类型"}）。`
      + "这通常是中转网关/代理返回了 HTML 错误页（限流、欠费、WAF 拦截或地址配置错误），而不是模型本身的回复。"
      + `原始解析错误：${parseError instanceof Error ? parseError.message : String(parseError)}`,
    );
  }
}
