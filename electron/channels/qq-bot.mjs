// QQ 开放平台官方机器人客户端:appID + appSecret 鉴权,WebSocket 收事件,REST 发消息。
// 手写协议(参考 https://bot.q.qq.com/wiki/),零第三方依赖:Node 22 全局 fetch/WebSocket。
// 本文件不依赖 electron,fetch/WebSocket 均可注入,方便用 node --test 直接测试。

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_MEDIA_BYTES, chunkText, sniffImageExtension } from "./shared.mjs";

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";
// 私聊(C2C) + 群@消息 + 频道私信
const INTENTS = (1 << 25) | (1 << 12) | (1 << 30);
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;

export class QqBotError extends Error {}

// ---- 纯函数(协议归一化,供单测与 manager 复用)----

// chunkText 已移至 shared.mjs（消除与 wechat.mjs 的循环依赖），此处 re-export 保持对外 API
export { chunkText };

// IM 审批回复解析:true=允许,false=拒绝,null=不是审批回复
export function parseApprovalReply(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (/^(允许|同意|确认|执行|批准|1|y|yes|ok)$/.test(normalized)) return true;
  if (/^(拒绝|不同意|取消|驳回|不准|2|n|no)$/.test(normalized)) return false;
  return null;
}

// 单个 QQ 附件按 content_type 归一化（纯函数，供测试）：
// content_type 形如 image/jpeg、image/png、video/mp4、voice、file
export function normalizeQqMediaAttachment(attachment = {}) {
  const url = String(attachment.url || "").trim();
  if (!url) return null;
  const contentType = String(attachment.content_type || "").trim().toLowerCase();
  const fileName = String(attachment.filename || attachment.fileName || "").trim();
  const size = Number(attachment.size) || 0;
  let kind = "file";
  if (contentType.startsWith("image/")) kind = "image";
  else if (contentType.startsWith("video/")) kind = "video";
  else if (contentType === "voice" || contentType.includes("voice") || contentType.includes("silk")) kind = "voice";
  const mimeType = contentType || undefined;
  return { kind, url, size, fileName, ...(mimeType ? { mimeType } : {}) };
}

// 占位文案：纯媒体消息在模型侧用文字描述，桌面会话配合附件展示
function qqPlaceholderForMedia(media) {
  const first = Array.isArray(media) ? media[0] : null;
  if (!first) return "[附件]";
  if (first.kind === "image") return "[图片]";
  if (first.kind === "video") return "[视频]";
  if (first.kind === "voice") return "[语音]";
  return `[文件:${first.fileName || "附件"}]`;
}

// QQ WSS dispatch 事件 → 归一化渠道消息;不关心的返回 null
export function normalizeQqEvent(event, botId = "") {
  if (!event || event.op !== 0) return null;
  const data = event.d || {};
  const text = String(data.content || "").trim();
  const media = Array.isArray(data.attachments)
    ? data.attachments.map(normalizeQqMediaAttachment).filter(Boolean)
    : [];
  if (!text && !media.length) return null;
  const authorId = String(data.author?.id || data.author?.member_openid || data.author?.union_openid || "");
  if (botId && authorId && authorId === botId) return null;
  const base = {
    channel: "qq",
    userId: authorId,
    userName: String(data.author?.username || ""),
    text: text || qqPlaceholderForMedia(media),
    messageId: String(data.id || ""),
    ...(media.length ? { media } : {}),
  };
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

export function createQqBotClient({ appId, appSecret, mediaDir = "", fetchImpl = fetch, webSocketImpl = globalThis.WebSocket, onMessage = () => { }, onStatus = () => { }, now = () => Date.now() } = {}) {
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
  // 附件下载与消息上送串行化：保持事件到达顺序，避免后到的消息先上送
  let emitChain = Promise.resolve();

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
    if (message) {
      // 附件下载与上送串行化，保持事件顺序；下载失败只保留 url，不阻塞消息流转
      emitChain = emitChain
        .then(async () => {
          const prepared = await prepareMessageMedia(message);
          await onMessage(prepared);
        })
        .catch(() => { });
    }
  }

  // 入站媒体：逐条下载附件落盘到暂存目录；失败保留 url（main 侧只展示文件名）
  async function prepareMessageMedia(message) {
    const media = Array.isArray(message.media) ? message.media : [];
    if (!media.length) return message;
    const prepared = [];
    for (const item of media) {
      if (!item?.url) {
        prepared.push(item);
        continue;
      }
      try {
        const filePath = await downloadAttachment(item, mediaDir, message.messageId);
        const { url, ...rest } = item;
        prepared.push({ ...rest, filePath });
      } catch {
        prepared.push(item);
      }
    }
    return { ...message, media: prepared };
  }

  // 下载 QQ 附件到 mediaDir/<messageId>-<rand><ext>；大小上限与图片魔数识别与其他渠道一致
  async function downloadAttachment(media, dir, messageId) {
    if (!media?.url) throw new QqBotError("附件没有下载地址");
    const auth = await accessToken();
    const response = await fetchImpl(String(media.url), {
      headers: { Authorization: `QQBot ${auth}` },
    });
    if (!response.ok) throw new QqBotError(`QQ 附件下载失败：${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_MEDIA_BYTES) throw new QqBotError("文件超过 50 MB，暂不支持");
    const mime = String(media.mimeType || "").toLowerCase();
    const ext = sniffImageExtension(buffer)
      || (mime.startsWith("video/") ? ".mp4" : "")
      || (media.fileName ? path.extname(String(media.fileName)) : "")
      || ".bin";
    if (!dir) throw new QqBotError("媒体暂存目录未配置");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${String(messageId || "msg")}-${randomUUID().slice(0, 8)}${ext}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
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

  // 富媒体上传：先拿 file_info 再以 msg_type=7 发送（file_type: 1 图片 2 视频 3 语音 4 文件）
  async function uploadFile(chat, filePath, fileType) {
    const auth = await accessToken();
    const buffer = await fs.readFile(filePath).catch(() => {
      throw new QqBotError(`附件文件不存在：${filePath}`);
    });
    const form = new FormData();
    form.append("file_type", String(fileType));
    form.append("file", new Blob([buffer]), path.basename(filePath));
    const uploadPath = chat.chatType === "group"
      ? `/v2/groups/${encodeURIComponent(chat.chatId)}/files`
      : `/v2/users/${encodeURIComponent(chat.chatId)}/files`;
    const response = await fetchImpl(`${API_BASE}${uploadPath}`, {
      method: "POST",
      headers: { Authorization: `QQBot ${auth}` },
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new QqBotError(`QQ 文件上传失败：${payload.message || payload.code || response.status}`);
    }
    const fileInfo = String(payload.file_info || payload.file_uuid || "");
    if (!fileInfo) throw new QqBotError("QQ 文件上传响应缺少 file_info");
    return fileInfo;
  }

  const KIND_TO_FILE_TYPE = { image: 1, video: 2, voice: 3, file: 4 };

  // 出站媒体：parts = [{ type:"text", text } | { type:"media", kind, filePath, fileName? }]
  async function sendMedia(chat, parts) {
    for (const part of parts || []) {
      if (!part) continue;
      if (part.type === "text") {
        await sendText(chat, String(part.text || ""));
        continue;
      }
      const kind = ["image", "video", "voice", "file"].includes(part.kind) ? part.kind : "file";
      const fileInfo = await uploadFile(chat, part.filePath, KIND_TO_FILE_TYPE[kind]);
      const seq = (msgSeqByChat.get(chat.chatId) || 0) + 1;
      msgSeqByChat.set(chat.chatId, seq);
      const body = { content: " ", msg_type: 7, msg_seq: seq, media: { file_info: fileInfo } };
      if (chat.messageId) body.msg_id = chat.messageId;
      const messagePath = chat.chatType === "group"
        ? `/v2/groups/${encodeURIComponent(chat.chatId)}/messages`
        : `/v2/users/${encodeURIComponent(chat.chatId)}/messages`;
      try {
        await api(messagePath, { method: "POST", body });
      } catch (error) {
        // msg_id 过期(用户太久没发消息)时被动回复会失败 → 去掉消息引用重发一次（与 sendText 一致）
        if (chat.messageId) {
          const retryBody = { ...body, msg_seq: seq + 1 };
          delete retryBody.msg_id;
          await api(messagePath, { method: "POST", body: retryBody }).catch(() => {
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
    sendMedia,
    downloadAttachment,
    // 测试钩子:直接注入一帧 WSS 数据
    _handleEvent: handleEvent,
  };
}
