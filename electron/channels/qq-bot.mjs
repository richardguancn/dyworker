// QQ 开放平台官方机器人客户端:appID + appSecret 鉴权,WebSocket 收事件,REST 发消息。
// 手写协议(参考 https://bot.q.qq.com/wiki/),零第三方依赖:Node 22 全局 fetch/WebSocket。
// 本文件不依赖 electron,fetch/WebSocket 均可注入,方便用 node --test 直接测试。

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";
// 私聊(C2C) + 群@消息 + 频道私信
const INTENTS = (1 << 25) | (1 << 12) | (1 << 30);
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;
const QQ_TEXT_CHUNK = 1500;

export class QqBotError extends Error {}

// ---- 纯函数(协议归一化,供单测与 manager 复用)----

// 长文本按 IM 限制切片;优先在换行/句号处断开
export function chunkText(text, limit = QQ_TEXT_CHUNK) {
  const source = String(text || "");
  if (source.length <= limit) return source ? [source] : [];
  const chunks = [];
  let rest = source;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("。", limit);
    if (cut < limit * 0.5) cut = limit;
    else cut += 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// IM 审批回复解析:true=允许,false=拒绝,null=不是审批回复
export function parseApprovalReply(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (/^(允许|同意|确认|执行|批准|1|y|yes|ok)$/.test(normalized)) return true;
  if (/^(拒绝|不同意|取消|驳回|不准|2|n|no)$/.test(normalized)) return false;
  return null;
}

// QQ WSS dispatch 事件 → 归一化渠道消息;不关心的返回 null
export function normalizeQqEvent(event, botId = "") {
  if (!event || event.op !== 0) return null;
  const data = event.d || {};
  const text = String(data.content || "").trim();
  if (!text) return null;
  const authorId = String(data.author?.id || data.author?.member_openid || data.author?.union_openid || "");
  if (botId && authorId && authorId === botId) return null;
  const base = { channel: "qq", userId: authorId, userName: String(data.author?.username || ""), text, messageId: String(data.id || "") };
  if (event.t === "C2C_MESSAGE_CREATE") {
    return { ...base, chatType: "dm", chatId: authorId };
  }
  if (event.t === "GROUP_AT_MESSAGE_CREATE") {
    const groupId = String(data.group_openid || "");
    if (!groupId) return null;
    return { ...base, chatType: "group", chatId: groupId };
  }
  if (event.t === "DIRECT_MESSAGE_CREATE") {
    return { ...base, chatType: "dm", chatId: String(data.channel_id || authorId) };
  }
  return null;
}

// ---- 客户端 ----

export function createQqBotClient({ appId, appSecret, fetchImpl = fetch, webSocketImpl = globalThis.WebSocket, onMessage = () => { }, onStatus = () => { }, now = () => Date.now() } = {}) {
  if (!appId || !appSecret) throw new QqBotError("QQ 渠道缺少 appId 或 appSecret");
  let token = "";
  let tokenExpiresAt = 0;
  let ws = null;
  let sessionId = "";
  let lastSeq = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let stopped = false;
  let botId = "";
  const msgSeqByChat = new Map();

  function setStatus(status, detail = "") {
    onStatus({ channel: "qq", status, detail });
  }

  async function accessToken() {
    if (token && now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return token;
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: String(appId), clientSecret: String(appSecret) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new QqBotError(`QQ access_token 获取失败:${payload.message || payload.code || response.status}`);
    }
    token = String(payload.access_token);
    tokenExpiresAt = now() + Number(payload.expires_in || 7200) * 1000;
    return token;
  }

  async function api(path, { method = "GET", body } = {}) {
    const auth = await accessToken();
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `QQBot ${auth}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new QqBotError(`QQ API ${method} ${path} 失败:${payload.message || payload.code || response.status}`);
    }
    return payload;
  }

  function clearTimers() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeatTimer = null;
    reconnectTimer = null;
  }

  function send(payload) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    setStatus("connecting", `连接断开,${Math.round(delay / 1000)} 秒后重连`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  function handleEvent(raw) {
    let event;
    try {
      event = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (typeof event.s === "number") lastSeq = event.s;
    if (event.op === 10) {
      // hello → identify 或 resume,并按服务端间隔启动心跳
      const interval = Number(event.d?.heartbeat_interval) || 30000;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => send({ op: 1, d: lastSeq }), interval);
      if (sessionId) send({ op: 6, d: { token: `QQBot ${token}`, session_id: sessionId, seq: lastSeq } });
      else send({ op: 2, d: { token: `QQBot ${token}`, intents: INTENTS, shard: [0, 1], properties: {} } });
      return;
    }
    if (event.op === 11) return; // heartbeat ack
    if (event.op === 7) {
      // 服务端要求重连
      void reconnectSocket();
      return;
    }
    if (event.op === 9) {
      // 无效会话,重新 identify
      sessionId = "";
      lastSeq = null;
      void reconnectSocket();
      return;
    }
    if (event.op !== 0) return;
    if (event.t === "READY") {
      sessionId = String(event.d?.session_id || "");
      botId = String(event.d?.user?.id || "");
      reconnectAttempts = 0;
      setStatus("online");
      return;
    }
    if (event.t === "RESUMED") {
      reconnectAttempts = 0;
      setStatus("online");
      return;
    }
    const message = normalizeQqEvent(event, botId);
    if (message) onMessage(message);
  }

  async function connect() {
    if (stopped) return;
    setStatus("connecting");
    try {
      const auth = await accessToken();
      const gateway = await api("/gateway");
      const url = String(gateway.url || "");
      if (!url) throw new QqBotError("QQ 网关地址为空");
      if (!webSocketImpl) throw new QqBotError("当前环境没有 WebSocket 支持");
      ws = new webSocketImpl(url);
      ws.onopen = () => { };
      ws.onmessage = (message) => handleEvent(message.data);
      ws.onclose = () => {
        clearTimers();
        if (!stopped) scheduleReconnect();
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* 忽略 */ }
      };
      token = auth;
    } catch (error) {
      setStatus("error", error instanceof Error ? error.message : String(error));
      scheduleReconnect();
    }
  }

  async function reconnectSocket() {
    try { ws?.close(); } catch { /* 忽略 */ }
    ws = null;
    scheduleReconnect();
  }

  // 发送文本到私聊/群聊;被动回复(带 msg_id)平台不计主动消息配额
  async function sendText(chat, text) {
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      const seq = (msgSeqByChat.get(chat.chatId) || 0) + 1;
      msgSeqByChat.set(chat.chatId, seq);
      const body = { content: chunk, msg_type: 0, msg_seq: seq };
      if (chat.messageId) body.msg_id = chat.messageId;
      const path = chat.chatType === "group"
        ? `/v2/groups/${encodeURIComponent(chat.chatId)}/messages`
        : `/v2/users/${encodeURIComponent(chat.chatId)}/messages`;
      try {
        await api(path, { method: "POST", body });
      } catch (error) {
        // msg_id 过期(用户太久没发消息)时被动回复会失败,提示用户在 IM 里再说一句
        if (chat.messageId) {
          await api(path, { method: "POST", body: { content: chunk, msg_type: 0, msg_seq: seq + 1 } }).catch(() => {
            throw error;
          });
        } else {
          throw error;
        }
      }
    }
  }

  return {
    id: "qq",
    async start() {
      stopped = false;
      await connect();
    },
    async stop() {
      stopped = true;
      clearTimers();
      try { ws?.close(); } catch { /* 忽略 */ }
      ws = null;
      sessionId = "";
      setStatus("disabled");
    },
    sendText,
    // 测试钩子:直接注入一帧 WSS 数据
    _handleEvent: handleEvent,
  };
}
