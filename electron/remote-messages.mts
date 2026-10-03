import { promises as fs } from "node:fs";
import path from "node:path";

// DYWorker 运营消息中心（方案 §6）：
// - SSE 只是加速手段：主进程用支持请求头的流式客户端建立连接，凭据放
//   Authorization 请求头；数据库消息记录才是补收依据，每 5 分钟轮询兜底。
// - 游标推进与本地消息保存在同一文件原子落盘；(message_id) 去重；
//   回执可重传且不会倒退已读状态。
// - 系统通知受用户设置约束（营销类开关、免打扰时段、每日弹窗上限），
//   消息中心始终可查。
// 服务端（安全监管平台）不在本项目实现，客户端按方案约定的接口对接。

export const POLL_INTERVAL_MS = 5 * 60_000;
export const MESSAGE_STORE_VERSION = 1;

// ---- SSE 解析（text/event-stream 最小实现：event/data/id/retry + 注释心跳）----

export function createSseParser(onEvent) {
  let buffer = "";
  return {
    feed(text) {
      buffer += String(text || "");
      // 事件以空行分隔；CR LF 统一处理
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        let event = "message";
        const dataLines = [];
        let lastEventId = "";
        for (const line of rawEvent.split(/\r?\n/)) {
          if (!line || line.startsWith(":")) continue; // 注释行 = 心跳
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") event = value || "message";
          else if (field === "data") dataLines.push(value);
          else if (field === "id") lastEventId = value;
          else if (field === "retry") {
            const retry = Number(value);
            if (Number.isFinite(retry) && retry >= 0) this.retryMs = Math.min(retry, 120_000);
          }
        }
        if (dataLines.length) onEvent({ event, data: dataLines.join("\n"), id: lastEventId });
      }
    },
    retryMs: null,
  };
}

// ---- 免打扰时段（本地时间 HH:mm-HH:mm，支持跨零点）----

export function parseQuietHours(value) {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 23 || Number(match[4]) > 59) return null;
  if (start === end) return null;
  return { start, end, raw: `${match[1]}:${match[2]}-${match[3]}:${match[4]}` };
}

export function quietHoursActive(quietHours, now = new Date()) {
  const window = parseQuietHours(quietHours);
  if (!window) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (window.start < window.end) return minutes >= window.start && minutes < window.end;
  // 跨零点时段：22:00-08:00
  return minutes >= window.start || minutes < window.end;
}

function localDayKey(now) {
  const date = now instanceof Date ? now : new Date(now);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isExpired(message, now) {
  const expires = message?.expires_at ? Date.parse(message.expires_at) : NaN;
  return Number.isFinite(expires) && expires <= now;
}

async function fetchJsonWithToken(fetchImpl, url, { method = "GET", token = "", body, timeoutMs = 15_000 } = {} as any) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: any = { Accept: "application/json" };
    if (token) headers.Authorization = `Device ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let payload = null;
    try {
      // 平台的雪花消息编号超过 JS 安全整数，保留原始数字文本再转为字符串。
      payload = (JSON.parse as any)(await response.text(), (_key, value, context) =>
        typeof value === "number" && !Number.isSafeInteger(value) && /^-?\d+$/.test(context?.source || "")
          ? context.source : value);
    } catch {
      payload = null;
    }
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}

function responseData(result) {
  const payload = result.payload;
  if (!payload || typeof payload !== "object") throw new Error("服务响应格式无效");
  if (payload.code != null && payload.code !== 0 && payload.code !== 200) throw new Error(String(payload.message || "消息请求失败"));
  if (payload && typeof payload === "object" && "data" in payload) {
    const code = payload.code;
    if (code !== 0 && code !== 200 && code !== null && code !== undefined) return null;
    return payload.data && typeof payload.data === "object" ? payload.data : {};
  }
  return payload && typeof payload === "object" ? payload : null;
}

export function createRemoteMessagesManager({
  file,
  client, // createInstallationClient 实例：configure/setToken 由统计控制器共享
  fetchImpl = (url, init) => fetch(url, init),
  now = () => Date.now(),
  showNotification = (_message, _onClick) => {},
  onNotificationClick = (_message) => {},
  onChanged = () => {},
  pollIntervalMs = POLL_INTERVAL_MS,
  log = (_msg) => {},
}) {
  const filePath = String(file || "");
  let state = {
    version: MESSAGE_STORE_VERSION,
    scope: "",
    cursor: "",
    messages: [],
    pending_receipts: [],
    daily: { date: "", notified: 0 },
  };
  let loaded = null;
  let writeChain = Promise.resolve();
  let settings = null;
  let started = false;
  let pollTimer = null;
  let sseAbort = null;
  let sseReconnectTimer = null;
  let sseBackoffMs = 1_000;
  let pulling = false;
  let receiptBackoffUntil = 0;
  let flushing = false;
  let epoch = 0;
  let pollingOnly = false;

  const messagesEnabled = () => settings?.messagesEnabled === true;
  const notifyPrefs = () => settings || {};
  const baseUrl = () => client?.getBaseUrl?.() || "";
  const token = () => client?.getToken?.() || "";

  function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  }

  async function persist() {
    if (!filePath) return;
    await enqueueWrite(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(state), "utf8");
      await fs.rename(temporary, filePath);
    });
  }

  function loadOnce() {
    loaded ??= (async () => {
      if (!filePath) return;
      try {
        const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
        if (raw && typeof raw === "object" && Array.isArray(raw.messages)) {
          state = {
            version: MESSAGE_STORE_VERSION,
            scope: String(raw.scope || ""),
            cursor: String(raw.cursor || ""),
            messages: raw.messages.filter((item) => item && typeof item.message_id === "string"),
            pending_receipts: Array.isArray(raw.pending_receipts) ? raw.pending_receipts : [],
            daily: raw.daily && typeof raw.daily === "object"
              ? { date: String(raw.daily.date || ""), notified: Math.max(0, Number(raw.daily.notified) || 0) }
              : { date: "", notified: 0 },
          };
        }
      } catch {
        // 文件缺失或损坏时从空消息中心开始（下次补拉会重新同步）
      }
    })();
    return loaded;
  }

  // 服务端历史时间字符串采用北京时间；转换后客户端不再受本机时区影响。
  const serverTime = (value) => {
    const text = String(value || "");
    return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text) ? text.replace(" ", "T") + "+08:00" : text;
  };

  async function ensureScope() {
    await loadOnce();
    if (!token() || !baseUrl()) return;
    const scope = `${baseUrl()}|${token().split(".")[0]}`;
    if (state.scope === scope) return;
    epoch += 1;
    stopStream();
    pollingOnly = false;
    state = { version: MESSAGE_STORE_VERSION, scope, cursor: "", messages: [], pending_receipts: [], daily: { date: "", notified: 0 } };
    await persist();
    onChanged();
  }

  function normalizeIncoming(raw) {
    const link = String(raw?.action_url || raw?.link || "");
    const message = {
      message_id: String(raw?.message_id || raw?.id || ""),
      category: raw?.category === "update" ? "version" : String(raw?.category || "announcement"),
      title: String(raw?.title || "").slice(0, 200),
      body: String(raw?.content ?? raw?.body ?? "").slice(0, 20_000),
      link: /^https:\/\//i.test(link) ? link : "",
      published_at: serverTime(raw?.published_at),
      expires_at: serverTime(raw?.expires_at),
      read_at: serverTime(raw?.read_at),
      clicked_at: serverTime(raw?.clicked_at),
      revoked: raw?.revoked === true || raw?.status === "revoked",
    };
    return message.message_id ? message : null;
  }

  function mergeReceipt(messageId, patch) {
    const existing = state.pending_receipts.find((receipt) => receipt.message_id === messageId)
      || { message_id: messageId };
    Object.assign(existing, patch);
    if (!state.pending_receipts.some((receipt) => receipt.message_id === messageId)) {
      state.pending_receipts.push(existing);
    }
  }

  // 系统通知资格：受营销开关、免打扰时段、每日上限约束；过期/撤回不弹
  function maybeNotify(message) {
    const prefs = notifyPrefs();
    if (prefs.notifyNewMessages === false) return;
    if (message.category === "marketing" && prefs.notifyMarketing !== true) return;
    if (prefs.quietHours && quietHoursActive(prefs.quietHours, new Date(now()))) return;
    if (isExpired(message, now()) || message.revoked) return;
    const today = localDayKey(new Date(now()));
    if (state.daily.date !== today) state.daily = { date: today, notified: 0 };
    const limit = Math.max(0, Math.floor(Number(prefs.dailyPopupLimit ?? 3)));
    if (limit > 0 && state.daily.notified >= limit) return;
    if (limit === 0) return;
    state.daily.notified += 1;
    message.notified = true;
    try {
      showNotification(message, () => onNotificationClick(message));
    } catch (error: any) {
      log(`[remote-messages] 通知展示失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function flushReceipts() {
    if (!messagesEnabled() || !token() || !state.pending_receipts.length || flushing) return;
    if (receiptBackoffUntil > now()) return;
    flushing = true;
    const requestEpoch = epoch;
    try {
      const receipts = state.pending_receipts.slice(0, 100).map((receipt) => ({ ...receipt }));
      const result = await fetchJsonWithToken(fetchImpl, `${baseUrl().replace(/\/+$/, "")}/api/v1/dyworker/messages/receipts`, {
        method: "POST", token: token(), timeoutMs: 15_000,
        body: { receipts: receipts.map((receipt) => ({ message_id: receipt.message_id,
          received: Boolean(receipt.received_at || receipt.read_at || receipt.clicked_at),
          read: Boolean(receipt.read_at || receipt.clicked_at), clicked: Boolean(receipt.clicked_at) })) },
      });
      if (requestEpoch !== epoch || !messagesEnabled()) return;
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const data = responseData(result);
      if (!Array.isArray(data?.results)) throw new Error("回执响应缺少逐条确认");
      const acknowledged = new Set(data.results.filter((item) => item.status === "ok").map((item) => String(item.message_id)));
      state.pending_receipts = state.pending_receipts.filter((receipt) => {
        const sent = receipts.find((item) => item.message_id === receipt.message_id);
        // 发送期间新增的已读/点击状态必须留下，不能被旧确认一并删掉。
        return !acknowledged.has(receipt.message_id) || !sent ||
          receipt.received_at !== sent.received_at || receipt.read_at !== sent.read_at || receipt.clicked_at !== sent.clicked_at;
      });
      await persist();
      receiptBackoffUntil = acknowledged.size ? 0 : now() + 60_000;
    } catch (error: any) {
      receiptBackoffUntil = now() + 60_000;
      log(`[remote-messages] 回执发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      flushing = false;
    }
  }

  async function pull(reason = "manual") {
    if (!messagesEnabled() || !token() || !baseUrl() || pulling) return { ok: false, skipped: true };
    pulling = true;
    try {
      await ensureScope();
      const requestEpoch = epoch;
      let received = 0;
      for (let page = 0; page < 100; page += 1) {
        const result = await fetchJsonWithToken(fetchImpl,
          `${baseUrl().replace(/\/+$/, "")}/api/v1/dyworker/messages?cursor=${encodeURIComponent(state.cursor)}&limit=100`,
          { token: token(), timeoutMs: 15_000 });
        if (requestEpoch !== epoch || !messagesEnabled()) return { ok: false, skipped: true };
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        const data = responseData(result);
        if (!Array.isArray(data?.items)) throw new Error("消息响应缺少消息列表，保留原游标");
        const incoming = data.items.map(normalizeIncoming).filter(Boolean);
        for (const message of incoming) {
          const existing = state.messages.find((item) => item.message_id === message.message_id);
          if (!existing) {
            const record = { ...message, received_at: new Date(now()).toISOString(), notified: false };
            state.messages.push(record);
            mergeReceipt(record.message_id, { message_id: record.message_id, received_at: record.received_at });
            if (!record.read_at) maybeNotify(record);
          } else {
            Object.assign(existing, { ...message, read_at: existing.read_at || message.read_at,
              clicked_at: existing.clicked_at || message.clicked_at });
          }
        }
        const oldCursor = state.cursor;
        const nextCursor = String(data?.cursor || "");
        if (!nextCursor) throw new Error("消息响应缺少游标");
        state.cursor = nextCursor;
        await persist();
        received += incoming.length;
        onChanged();
        if (!data.has_more) break;
        if (oldCursor === nextCursor) throw new Error("消息分页未推进");
      }
      await flushReceipts();
      return { ok: true, received };
    } catch (error: any) {
      log(`[remote-messages] 拉取失败（${reason}）：${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      pulling = false;
    }
  }

  // ---- SSE：带 Authorization 头的流式连接 ----

  async function connectStream() {
    if (!started || !messagesEnabled() || !token() || !baseUrl() || pollingOnly || sseAbort) return;
    const abort = new AbortController();
    sseAbort = abort;
    try {
      const response = await fetchImpl(`${baseUrl().replace(/\/+$/, "")}/api/v1/dyworker/messages/stream`, {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Device ${token()}`,
          "Cache-Control": "no-cache",
        },
        signal: abort.signal,
      });
      if (response.status === 501) { pollingOnly = true; return; }
      if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
      sseBackoffMs = 1_000; // 连接成功后重置退避
      const parser = createSseParser((event) => {
        // 服务端可用 retry: 字段建议重连间隔
        if (parser.retryMs && Number.isFinite(parser.retryMs)) sseBackoffMs = parser.retryMs;
        // 收到“有新消息”的提示后走带鉴权接口拉取正文；SSE 本身不承载数据
        if (event.event === "new-message" || event.event === "message" || event.event === "ping") {
          void pull("sse");
        }
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (error: any) {
      if (abort.signal.aborted) return;
      log(`[remote-messages] SSE 断开：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (sseAbort === abort) sseAbort = null;
    }
    if (!abort.signal.aborted) scheduleReconnect();
  }

  function scheduleReconnect() {
    if (!started || !messagesEnabled() || pollingOnly) return;
    const delay = Math.min(sseBackoffMs, 60_000);
    sseBackoffMs = Math.min(sseBackoffMs * 2, 60_000);
    sseReconnectTimer = setTimeout(() => {
      sseReconnectTimer = null;
      void connectStream();
    }, delay);
    sseReconnectTimer.unref?.();
  }

  function stopStream() {
    if (sseAbort) sseAbort.abort();
    sseAbort = null;
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
    sseBackoffMs = 1_000;
  }

  return {
    async configure(nextSettings) {
      const wasEnabled = messagesEnabled();
      settings = { ...nextSettings };
      epoch += 1;
      await ensureScope();
      if (started && !wasEnabled && messagesEnabled()) {
        // 开启订阅：立即补拉并建立实时连接
        void pull("enabled");
        void connectStream();
      }
      if (started && wasEnabled && !messagesEnabled()) stopStream();
    },
    start() {
      if (started) return;
      started = true;
      // 即使启动时订阅关闭，也保留轮询调度，稍后开启能持续收消息。
      if (messagesEnabled()) void pull("startup").then(() => connectStream());
      pollTimer = setInterval(() => {
        if (messagesEnabled()) void pull("poll");
      }, pollIntervalMs);
      pollTimer.unref?.();
    },
    stop() {
      started = false;
      epoch += 1;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      stopStream();
    },
    // 睡眠恢复/解锁/网络恢复后立即补拉未过期消息
    noteOnline() {
      if (started && messagesEnabled()) {
        void pull("online").then(() => connectStream());
      }
    },
    pull,
    flushReceipts,
    async listMessages() {
      await loadOnce();
      return [...state.messages].sort((a, b) => String(b.published_at || b.received_at).localeCompare(String(a.published_at || a.received_at)));
    },
    async unreadCount() {
      await loadOnce();
      return state.messages.filter((message) => !message.read_at && !message.revoked && !isExpired(message, now())).length;
    },
    // 只有用户实际打开对应消息才记「已读」
    async markRead(messageId) {
      await loadOnce();
      const message = state.messages.find((item) => item.message_id === String(messageId));
      if (!message || message.read_at) return { ok: true };
      message.read_at = new Date(now()).toISOString();
      mergeReceipt(message.message_id, { message_id: message.message_id, read_at: message.read_at });
      await persist();
      onChanged();
      void flushReceipts();
      return { ok: true };
    },
    // 用户点击消息内的跳转才记「已点击」
    async markClicked(messageId) {
      await loadOnce();
      const message = state.messages.find((item) => item.message_id === String(messageId));
      if (!message) return { ok: false };
      const stamp = new Date(now()).toISOString();
      if (!message.read_at) message.read_at = stamp;
      message.clicked_at = stamp;
      mergeReceipt(message.message_id, { message_id: message.message_id, read_at: message.read_at, clicked_at: stamp });
      await persist();
      onChanged();
      void flushReceipts();
      return { ok: true };
    },
    async status() {
      await loadOnce();
      const unread = await this.unreadCount();
      return {
        enabled: messagesEnabled(),
        cursor: state.cursor,
        total: state.messages.length,
        unread,
        pendingReceipts: state.pending_receipts.length,
        dailyNotified: state.daily.notified,
      };
    },
  };
}
