// 飞书开放平台官方长连接客户端：AppID + AppSecret 鉴权，WebSocket (pbbp2 Protobuf 二进制帧) 收事件，REST 发消息/传文件。
// 零第三方依赖：基于 Node 22 全局 fetch / WebSocket / FormData / Blob 手写实现。
// 本文件不依赖 electron，fetch / WebSocket 均可注入，方便用 node --test 直接单测。

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_MEDIA_BYTES, chunkText, sniffImageExtension } from "./shared.mts";

export const FEISHU_OPEN_BASE = "https://open.feishu.cn";
const TOKEN_PATH = "/open-apis/auth/v3/tenant_access_token/internal";
const WS_ENDPOINT_PATH = "/callback/ws/endpoint";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_RECONNECT_DELAY_MS = 2 * 60 * 1000;
const FEISHU_TEXT_CHUNK = 2000;
// 分片缓存清理上限（超过 30 秒未收齐的分片丢弃）
const FRAGMENT_TTL_MS = 30_000;

export class FeishuChannelError extends Error {
  unsafeToRetry?: boolean;
  code?: number;
}

// ---- 共享 tenant_access_token 缓存（渠道与云文档工具共用） ----

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearFeishuTokenCache() {
  tokenCache.clear();
}

export async function getFeishuTenantToken({
  appId,
  appSecret,
  baseUrl = FEISHU_OPEN_BASE,
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 30_000,
}: {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}): Promise<string> {
  const id = String(appId || "").trim();
  const secret = String(appSecret || "").trim();
  if (!id || !secret) {
    throw new FeishuChannelError("飞书渠道缺少 App ID 或 App Secret");
  }
  const cacheKey = `${baseUrl}|${id}|${secret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cached.token;
  }
  const url = `${baseUrl.replace(/\/+$/, "")}${TOKEN_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 30_000));
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: id, app_secret: secret }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new FeishuChannelError(`飞书 tenant_access_token 获取超时（${timeoutMs / 1000} 秒无响应）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new FeishuChannelError(`飞书 tenant_access_token 获取失败：${payload.msg || payload.message || payload.code || response.status}`);
  }
  const token = String(payload.tenant_access_token);
  const expireSeconds = Number(payload.expire || payload.expires_in || 7200);
  tokenCache.set(cacheKey, {
    token,
    expiresAt: now() + expireSeconds * 1000,
  });
  return token;
}

// ---- pbbp2.Frame Protobuf 二进制编解码器 ----
// message Header { string key = 1; string value = 2; }
// message Frame {
//   uint64 SeqID = 1;
//   uint64 LogID = 2;
//   int32 service = 3;
//   int32 method = 4;
//   repeated Header headers = 5;
//   string payloadEncoding = 6;
//   string payloadType = 7;
//   bytes payload = 8;
//   string LogIDNew = 9;
// }

export interface PbHeader {
  key: string;
  value: string;
}

export interface PbFrame {
  seqId: bigint;
  logId: bigint;
  service: number;
  method: number;
  headers: PbHeader[];
  payloadEncoding: string;
  payloadType: string;
  payload: Buffer;
  logIdNew: string;
}

function encodeVarint(value: bigint | number): Buffer {
  let v = typeof value === "bigint" ? BigInt.asUintN(64, value) : BigInt(value >>> 0);
  const bytes: number[] = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function decodeVarint(buf: Buffer, offset: number): { value: bigint; next: number } {
  let result = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buf.length) {
    const byte = buf[cursor];
    cursor += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, next: cursor };
    }
    shift += 7n;
    if (shift > 70n) throw new FeishuChannelError("pbbp2 varint 溢出");
  }
  throw new FeishuChannelError("pbbp2 varint 数据截断");
}

function encodeTag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeBytesField(fieldNumber: number, data: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(data.length), data]);
}

function encodeStringField(fieldNumber: number, text: string): Buffer {
  if (!text) return Buffer.alloc(0);
  return encodeBytesField(fieldNumber, Buffer.from(String(text), "utf8"));
}

function encodeHeader(header: PbHeader): Buffer {
  const parts: Buffer[] = [];
  if (header.key) parts.push(encodeStringField(1, header.key));
  if (header.value) parts.push(encodeStringField(2, header.value));
  return Buffer.concat(parts);
}

export function encodePbFrame(frame: Partial<PbFrame>): Buffer {
  const parts: Buffer[] = [];
  const seqId = frame.seqId ?? 0n;
  const logId = frame.logId ?? 0n;
  const service = frame.service ?? 0;
  const method = frame.method ?? 0;
  parts.push(Buffer.concat([encodeTag(1, 0), encodeVarint(seqId)]));
  parts.push(Buffer.concat([encodeTag(2, 0), encodeVarint(logId)]));
  parts.push(Buffer.concat([encodeTag(3, 0), encodeVarint(service)]));
  parts.push(Buffer.concat([encodeTag(4, 0), encodeVarint(method)]));
  for (const header of frame.headers || []) {
    const encoded = encodeHeader(header);
    parts.push(encodeBytesField(5, encoded));
  }
  if (frame.payloadEncoding) parts.push(encodeStringField(6, frame.payloadEncoding));
  if (frame.payloadType) parts.push(encodeStringField(7, frame.payloadType));
  if (frame.payload && frame.payload.length > 0) parts.push(encodeBytesField(8, frame.payload));
  if (frame.logIdNew) parts.push(encodeStringField(9, frame.logIdNew));
  return Buffer.concat(parts);
}

function skipWireField(buf: Buffer, offset: number, wireType: number): number {
  if (wireType === 0) return decodeVarint(buf, offset).next;
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const { value: len, next } = decodeVarint(buf, offset);
    return next + Number(len);
  }
  if (wireType === 5) return offset + 4;
  throw new FeishuChannelError(`不支持的 Protobuf wireType: ${wireType}`);
}

function decodeHeader(buf: Buffer): PbHeader {
  let cursor = 0;
  let key = "";
  let value = "";
  while (cursor < buf.length) {
    const { value: tag, next } = decodeVarint(buf, cursor);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    cursor = next;
    if (wireType === 2 && (fieldNumber === 1 || fieldNumber === 2)) {
      const { value: len, next: dataOffset } = decodeVarint(buf, cursor);
      const end = dataOffset + Number(len);
      const str = buf.subarray(dataOffset, end).toString("utf8");
      if (fieldNumber === 1) key = str;
      else value = str;
      cursor = end;
    } else {
      cursor = skipWireField(buf, cursor, wireType);
    }
  }
  return { key, value };
}

export function decodePbFrame(raw: Buffer | Uint8Array | ArrayBuffer): PbFrame {
  const buf = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof ArrayBuffer
      ? Buffer.from(raw)
      : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  let cursor = 0;
  let seqId = 0n;
  let logId = 0n;
  let service = 0;
  let method = 0;
  const headers: PbHeader[] = [];
  let payloadEncoding = "";
  let payloadType = "";
  let payload: Buffer = Buffer.alloc(0);
  let logIdNew = "";

  while (cursor < buf.length) {
    const { value: tag, next } = decodeVarint(buf, cursor);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    cursor = next;
    if (wireType === 0 && (fieldNumber === 1 || fieldNumber === 2 || fieldNumber === 3 || fieldNumber === 4)) {
      const { value, next: afterVal } = decodeVarint(buf, cursor);
      cursor = afterVal;
      if (fieldNumber === 1) seqId = value;
      else if (fieldNumber === 2) logId = value;
      else if (fieldNumber === 3) service = Number(BigInt.asIntN(32, value));
      else if (fieldNumber === 4) method = Number(BigInt.asIntN(32, value));
    } else if (wireType === 2 && (fieldNumber >= 5 && fieldNumber <= 9)) {
      const { value: len, next: dataOffset } = decodeVarint(buf, cursor);
      const end = dataOffset + Number(len);
      const slice = buf.subarray(dataOffset, end);
      cursor = end;
      if (fieldNumber === 5) headers.push(decodeHeader(slice));
      else if (fieldNumber === 6) payloadEncoding = slice.toString("utf8");
      else if (fieldNumber === 7) payloadType = slice.toString("utf8");
      else if (fieldNumber === 8) payload = Buffer.from(slice);
      else if (fieldNumber === 9) logIdNew = slice.toString("utf8");
    } else {
      cursor = skipWireField(buf, cursor, wireType);
    }
  }

  return {
    seqId,
    logId,
    service,
    method,
    headers,
    payloadEncoding,
    payloadType,
    payload,
    logIdNew,
  };
}

export function pbHeadersToMap(headers: PbHeader[] = []): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    if (h && h.key) map[h.key] = h.value ?? "";
  }
  return map;
}

// ---- 事件归一化（纯函数，供单测与客户端复用） ----

function feishuPlaceholderForMedia(media: any[]) {
  const first = Array.isArray(media) ? media[0] : null;
  if (!first) return "[附件]";
  if (first.kind === "image") return "[图片]";
  if (first.kind === "video") return "[视频]";
  if (first.kind === "voice") return "[语音]";
  return `[文件:${first.fileName || "附件"}]`;
}

// 解析飞书 post 富文本结构：提取文本、超链接、内嵌图片与文件
function parseFeishuPostContent(parsed: any): { text: string; media: any[] } {
  if (!parsed || typeof parsed !== "object") return { text: "", media: [] };
  // 兼容直接 { title, content } 或多语言包装 { zh_cn: { title, content }, en_us: ... }
  let body = parsed;
  if (!Array.isArray(parsed.content)) {
    const langKey = Object.keys(parsed).find((k) => parsed[k] && Array.isArray(parsed[k].content));
    if (langKey) body = parsed[langKey];
  }
  const title = String(body?.title || "").trim();
  const lines: string[] = title ? [title] : [];
  const media: any[] = [];
  const paragraphs = Array.isArray(body?.content) ? body.content : [];
  for (const para of paragraphs) {
    if (!Array.isArray(para)) continue;
    const segs: string[] = [];
    for (const node of para) {
      if (!node || typeof node !== "object") continue;
      const tag = String(node.tag || "");
      if (tag === "text") {
        segs.push(String(node.text || ""));
      } else if (tag === "a") {
        const label = String(node.text || "").trim();
        const href = String(node.href || "").trim();
        segs.push(label && href && label !== href ? `${label} (${href})` : href || label);
      } else if (tag === "at") {
        // 群内 @ 占位符由外层统一清理，这里若非 @_user_ 保留用户名
        const userId = String(node.user_id || "");
        if (userId && !userId.startsWith("@_user_")) {
          segs.push(`@${node.user_name || userId}`);
        }
      } else if (tag === "img" && node.image_key) {
        media.push({
          kind: "image",
          fileKey: String(node.image_key).trim(),
          resourceType: "image",
        });
      } else if (tag === "media" && node.file_key) {
        media.push({
          kind: "video",
          fileKey: String(node.file_key).trim(),
          fileName: String(node.file_name || "").trim(),
          resourceType: "file",
        });
      }
    }
    const line = segs.join("").trim();
    if (line) lines.push(line);
  }
  return { text: lines.join("\n").trim(), media };
}

// 清理飞书消息里的 @_user_1 等提及占位符
function stripFeishuMentions(text: string, mentions: any[] = []): string {
  let output = String(text || "");
  for (const mention of Array.isArray(mentions) ? mentions : []) {
    const key = String(mention?.key || "").trim();
    if (!key) continue;
    output = output.split(key).join("");
  }
  return output.replace(/@_user_\d+/g, "").trim();
}

// 将飞书事件 v2.0 载荷（im.message.receive_v1）归一化为渠道统一入站消息格式
export function normalizeFeishuEvent(payload: any): any | null {
  if (!payload || typeof payload !== "object") return null;
  const eventType = String(payload?.header?.event_type || payload?.type || "");
  if (eventType !== "im.message.receive_v1") return null;
  const event = payload.event || {};
  const sender = event.sender || {};
  if (sender.sender_type === "app") return null;
  const senderIdObj = sender.sender_id || {};
  const userId = String(senderIdObj.open_id || senderIdObj.user_id || senderIdObj.union_id || "").trim();
  const message = event.message || {};
  const messageId = String(message.message_id || "").trim();
  const chatId = String(message.chat_id || userId).trim();
  if (!chatId) return null;
  const chatType = message.chat_type === "group" ? "group" : "dm";
  const msgType = String(message.message_type || "").trim().toLowerCase();
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];

  let rawContent: any = {};
  if (typeof message.content === "string" && message.content.trim()) {
    try {
      rawContent = JSON.parse(message.content);
    } catch {
      rawContent = { text: message.content };
    }
  } else if (message.content && typeof message.content === "object") {
    rawContent = message.content;
  }

  let text = "";
  const media: any[] = [];

  if (msgType === "text") {
    text = stripFeishuMentions(String(rawContent.text || ""), mentions);
  } else if (msgType === "post") {
    const parsedPost = parseFeishuPostContent(rawContent);
    text = stripFeishuMentions(parsedPost.text, mentions);
    media.push(...parsedPost.media);
  } else if (msgType === "image") {
    const imageKey = String(rawContent.image_key || "").trim();
    if (imageKey) {
      media.push({ kind: "image", fileKey: imageKey, resourceType: "image" });
    }
  } else if (msgType === "file") {
    const fileKey = String(rawContent.file_key || "").trim();
    if (fileKey) {
      media.push({
        kind: "file",
        fileKey,
        fileName: String(rawContent.file_name || "").trim(),
        resourceType: "file",
      });
    }
  } else if (msgType === "audio") {
    const fileKey = String(rawContent.file_key || "").trim();
    const rawDuration = Number(rawContent.duration) || 0;
    const duration = rawDuration > 100 ? Math.max(1, Math.round(rawDuration / 1000)) : rawDuration || undefined;
    if (fileKey) {
      media.push({
        kind: "voice",
        fileKey,
        fileName: "语音.ogg",
        ...(duration ? { duration } : {}),
        resourceType: "file",
      });
    }
  } else if (msgType === "media") {
    const fileKey = String(rawContent.file_key || "").trim();
    if (fileKey) {
      media.push({
        kind: "video",
        fileKey,
        fileName: String(rawContent.file_name || "").trim(),
        resourceType: "file",
      });
    }
  } else {
    return null;
  }

  if (!text && !media.length) return null;

  return {
    channel: "feishu",
    chatType,
    chatId,
    userId: userId || chatId,
    userName: String(sender.sender_name || ""),
    text: text || feishuPlaceholderForMedia(media),
    messageId,
    ...(media.length ? { media } : {}),
  };
}

// 飞书文件上传时的 file_type 映射
function feishuUploadFileType(filePath: string, kind: string): string {
  if (kind === "voice") return "opus";
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".opus" || ext === ".ogg") return "opus";
  if (ext === ".mp4") return "mp4";
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc" || ext === ".docx") return "doc";
  if (ext === ".xls" || ext === ".xlsx" || ext === ".csv") return "xls";
  if (ext === ".ppt" || ext === ".pptx") return "ppt";
  return "stream";
}

// ---- 客户端实现 ----

export function createFeishuClient({
  appId,
  appSecret,
  baseUrl = FEISHU_OPEN_BASE,
  mediaDir = "",
  fetchImpl = fetch,
  webSocketImpl = globalThis.WebSocket,
  onMessage = () => {},
  onStatus = () => {},
  now = () => Date.now(),
  timeoutMs = 30_000,
}: any = {}) {
  const cleanAppId = String(appId || "").trim();
  const cleanAppSecret = String(appSecret || "").trim();
  if (!cleanAppId || !cleanAppSecret) {
    throw new FeishuChannelError("飞书渠道缺少 App ID 或 App Secret");
  }
  const effectiveBaseUrl = String(baseUrl || FEISHU_OPEN_BASE).replace(/\/+$/, "");

  let ws: any = null;
  let pingTimer: any = null;
  let reconnectTimer: any = null;
  let reconnectAttempts = 0;
  let stopped = false;
  let serviceId = 0;
  let pingIntervalMs = 120_000;
  let emitChain = Promise.resolve();

  // 分片重组表：message_id → { parts: Buffer[], total: number, createdAt: number }
  const fragmentBuckets = new Map<string, { parts: (Buffer | null)[]; received: number; total: number; createdAt: number }>();

  function setStatus(status: string, detail = "") {
    onStatus({ channel: "feishu", status, detail });
  }

  function clearTimers() {
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pingTimer = null;
    reconnectTimer = null;
  }

  function withTimeout(url: string, options: any = {}) {
    const controller = new AbortController();
    const merged = { ...options, signal: controller.signal };
    let timer: any = null;
    return Promise.race([
      Promise.resolve().then(() => fetchImpl(url, merged)),
      new Promise<any>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error("timeout");
          error.name = "TimeoutError";
          reject(error);
        }, Math.max(1, Number(timeoutMs) || 30_000));
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function accessToken() {
    return getFeishuTenantToken({
      appId: cleanAppId,
      appSecret: cleanAppSecret,
      baseUrl: effectiveBaseUrl,
      fetchImpl,
      now,
      timeoutMs,
    });
  }

  async function api(apiPath: string, { method = "GET", body, headers = {}, isForm = false }: any = {}) {
    const auth = await accessToken();
    let response: Response;
    try {
      response = await withTimeout(`${effectiveBaseUrl}${apiPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${auth}`,
          ...(isForm ? {} : { "Content-Type": "application/json; charset=utf-8" }),
          ...headers,
        },
        ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}),
      });
    } catch (error: any) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        const wrapped = new FeishuChannelError(`飞书 API ${method} ${apiPath} 请求超时（${timeoutMs / 1000} 秒无响应）`);
        wrapped.unsafeToRetry = true;
        throw wrapped;
      }
      try { error.unsafeToRetry = true; } catch { /* 忽略 */ }
      throw error;
    }
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
      const err = new FeishuChannelError(`飞书 API ${method} ${apiPath} 失败：${payload.msg || payload.message || payload.code || response.status}`);
      err.code = payload.code || response.status;
      throw err;
    }
    return payload.data !== undefined ? payload.data : payload;
  }

  async function fetchWsEndpoint() {
    let response: Response;
    try {
      response = await withTimeout(`${effectiveBaseUrl}${WS_ENDPOINT_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", locale: "zh" },
        body: JSON.stringify({ AppID: cleanAppId, AppSecret: cleanAppSecret }),
      });
    } catch (error: any) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new FeishuChannelError(`飞书长连接网关获取超时（${timeoutMs / 1000} 秒无响应）`);
      }
      throw error;
    }
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0 || !payload.data?.URL) {
      throw new FeishuChannelError(`飞书长连接网关获取失败：${payload.msg || payload.message || payload.code || response.status}`);
    }
    return {
      url: String(payload.data.URL),
      clientConfig: payload.data.ClientConfig || {},
    };
  }

  function startPingTimer(intervalMs: number) {
    if (pingTimer) clearInterval(pingTimer);
    pingIntervalMs = Math.max(15_000, Number(intervalMs) || 120_000);
    pingTimer = setInterval(() => {
      if (!ws || ws.readyState !== 1) return;
      try {
        const pingFrame = encodePbFrame({
          seqId: 0n,
          logId: 0n,
          service: serviceId,
          method: 0,
          headers: [{ key: "type", value: "ping" }],
        });
        ws.send(pingFrame);
      } catch {
        // 忽略单次心跳发送错误
      }
    }, pingIntervalMs);
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts, 7), MAX_RECONNECT_DELAY_MS);
    setStatus("connecting", `连接已断开，${Math.round(delay / 1000)} 秒后重连`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  function mergeFragments(messageId: string, sum: number, seq: number, chunk: Buffer): Buffer | null {
    if (sum <= 1) return chunk;
    const currentNow = now();
    for (const [id, item] of fragmentBuckets) {
      if (currentNow - item.createdAt > FRAGMENT_TTL_MS) {
        fragmentBuckets.delete(id);
      }
    }
    let bucket = fragmentBuckets.get(messageId);
    if (!bucket || bucket.total !== sum) {
      bucket = { parts: new Array(sum).fill(null), received: 0, total: sum, createdAt: currentNow };
      fragmentBuckets.set(messageId, bucket);
    }
    if (seq >= 0 && seq < sum && !bucket.parts[seq]) {
      bucket.parts[seq] = chunk;
      bucket.received += 1;
    }
    if (bucket.received < sum) return null;
    fragmentBuckets.delete(messageId);
    return Buffer.concat(bucket.parts.filter(Boolean) as Buffer[]);
  }

  function sendAck(frame: PbFrame, startMs: number) {
    if (!ws || ws.readyState !== 1) return;
    try {
      const bizRt = Math.max(0, now() - startMs);
      const ackHeaders = [
        ...frame.headers.filter((h) => h.key !== "biz_rt"),
        { key: "biz_rt", value: String(bizRt) },
      ];
      const ackFrame = encodePbFrame({
        seqId: frame.seqId,
        logId: frame.logId,
        service: frame.service,
        method: frame.method,
        headers: ackHeaders,
        payloadEncoding: frame.payloadEncoding,
        payloadType: frame.payloadType,
        payload: Buffer.from(JSON.stringify({ code: 200 }), "utf8"),
        logIdNew: frame.logIdNew,
      });
      ws.send(ackFrame);
    } catch {
      // 忽略 ACK 异常
    }
  }

  function handleFrameData(rawData: any) {
    const startMs = now();
    let frame: PbFrame;
    try {
      if (typeof rawData === "string") {
        // 兼容测试直接注入 JSON 字符串的情况
        const parsed = JSON.parse(rawData);
        const normalized = normalizeFeishuEvent(parsed);
        if (normalized) {
          emitChain = emitChain.then(async () => {
            const prepared = await prepareMessageMedia(normalized);
            await onMessage(prepared);
          }).catch(() => {});
        }
        return;
      }
      frame = decodePbFrame(rawData);
    } catch {
      return;
    }

    const headerMap = pbHeadersToMap(frame.headers);

    // 控制帧（method = 0）：处理 pong 中的 ClientConfig 更新
    if (frame.method === 0) {
      if (headerMap.type === "pong" && frame.payload && frame.payload.length > 0) {
        try {
          const config = JSON.parse(frame.payload.toString("utf8"));
          if (Number(config?.PingInterval) > 0) {
            const nextInterval = Number(config.PingInterval) * 1000;
            if (nextInterval !== pingIntervalMs) startPingTimer(nextInterval);
          }
        } catch {
          // 忽略非 JSON pong 载荷
        }
      }
      return;
    }

    // 数据帧（method = 1）：处理事件推送
    if (frame.method !== 1) return;
    const sum = Math.max(1, Number(headerMap.sum) || 1);
    const seq = Math.max(0, Number(headerMap.seq) || 0);
    const msgId = String(headerMap.message_id || frame.seqId);
    const fullPayload = mergeFragments(msgId, sum, seq, frame.payload);
    if (!fullPayload) return;

    // 必须在 3 秒内回发 200 ACK，防止飞书服务端重复投递
    sendAck(frame, startMs);

    if (headerMap.type && headerMap.type !== "event") return;
    let parsedEvent: any;
    try {
      parsedEvent = JSON.parse(fullPayload.toString("utf8"));
    } catch {
      return;
    }

    const message = normalizeFeishuEvent(parsedEvent);
    if (message) {
      emitChain = emitChain
        .then(async () => {
          const prepared = await prepareMessageMedia(message);
          await onMessage(prepared);
        })
        .catch(() => {});
    }
  }

  // 下载飞书消息中的图片/文件/音频资源到 mediaDir
  async function downloadAttachment(media: any, dir: string, messageId: string): Promise<string> {
    const fileKey = String(media?.fileKey || "").trim();
    const msgId = String(messageId || "").trim();
    if (!fileKey || !msgId) throw new FeishuChannelError("飞书附件缺少 messageId 或 fileKey");
    if (!dir) throw new FeishuChannelError("媒体暂存目录未配置");
    const resourceType = media.resourceType === "image" || media.kind === "image" ? "image" : "file";
    const auth = await accessToken();
    const url = `${effectiveBaseUrl}/open-apis/im/v1/messages/${encodeURIComponent(msgId)}/resources/${encodeURIComponent(fileKey)}?type=${resourceType}`;
    let response: Response;
    try {
      response = await withTimeout(url, {
        headers: { Authorization: `Bearer ${auth}` },
      });
    } catch (error: any) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new FeishuChannelError(`飞书附件下载超时（${timeoutMs / 1000} 秒无响应）`);
      }
      throw error;
    }
    if (!response.ok) {
      throw new FeishuChannelError(`飞书附件下载失败：HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_MEDIA_BYTES) {
      throw new FeishuChannelError("文件超过 50 MB，暂不支持");
    }
    const ext = sniffImageExtension(buffer)
      || (media.kind === "voice" ? ".ogg" : "")
      || (media.kind === "video" ? ".mp4" : "")
      || (media.fileName ? path.extname(String(media.fileName)) : "")
      || ".bin";
    await fs.mkdir(dir, { recursive: true });
    const safeMsgId = msgId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-24) || "msg";
    const filePath = path.join(dir, `${safeMsgId}-${randomUUID().slice(0, 8)}${ext}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  async function prepareMessageMedia(message: any) {
    const media = Array.isArray(message.media) ? message.media : [];
    if (!media.length || !mediaDir) return message;
    const prepared = [];
    for (const item of media) {
      if (!item?.fileKey) {
        prepared.push(item);
        continue;
      }
      try {
        const filePath = await downloadAttachment(item, mediaDir, message.messageId);
        const { fileKey, resourceType, ...rest } = item;
        prepared.push({ ...rest, filePath, size: rest.size || (await fs.stat(filePath).then((s) => s.size).catch(() => 0)) });
      } catch {
        prepared.push(item);
      }
    }
    return { ...message, media: prepared };
  }

  async function connect() {
    if (stopped) return;
    setStatus("connecting");
    try {
      // 先验证凭据有效性并预热 tenant_access_token
      await accessToken();
      const { url, clientConfig } = await fetchWsEndpoint();
      if (!webSocketImpl) throw new FeishuChannelError("当前环境没有 WebSocket 支持");
      try {
        const parsedUrl = new URL(url);
        serviceId = Number(parsedUrl.searchParams.get("service_id")) || 0;
      } catch {
        serviceId = 0;
      }
      const initialPingMs = Number(clientConfig?.PingInterval) > 0
        ? Number(clientConfig.PingInterval) * 1000
        : 120_000;

      const socket = new webSocketImpl(url);
      ws = socket;
      try {
        socket.binaryType = "arraybuffer";
      } catch {
        // 部分测试桩只读或无需设置
      }
      socket.onopen = () => {
        if (stopped || ws !== socket) return;
        reconnectAttempts = 0;
        setStatus("online");
        startPingTimer(initialPingMs);
      };
      socket.onmessage = (event: any) => {
        if (stopped || ws !== socket) return;
        handleFrameData(event?.data ?? event);
      };
      socket.onclose = () => {
        if (ws === socket) clearTimers();
        if (!stopped && ws === socket) scheduleReconnect();
      };
      socket.onerror = () => {
        try { socket?.close(); } catch { /* 忽略 */ }
      };
    } catch (error: any) {
      setStatus("error", error instanceof Error ? error.message : String(error));
      scheduleReconnect();
    }
  }

  // 发送单条飛书消息（优先 reply 被动回复原消息，失败且可安全重试时回退到按 chat_id 主动发送）
  async function sendSingleMessage(chat: any, msgType: string, contentObj: any) {
    const content = JSON.stringify(contentObj);
    const chatId = String(chat?.chatId || "").trim();
    const messageId = String(chat?.messageId || "").trim();
    if (messageId) {
      try {
        await api(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
          method: "POST",
          body: { msg_type: msgType, content },
        });
        return;
      } catch (error: any) {
        if (error?.unsafeToRetry || !chatId) throw error;
        // 原消息可能已被撤回或超时，回退到主动向会话发送
      }
    }
    if (!chatId) throw new FeishuChannelError("飞书会话缺少 chatId");
    const receiveIdType = chatId.startsWith("ou_") ? "open_id" : "chat_id";
    await api(`/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: "POST",
      body: {
        receive_id: chatId,
        msg_type: msgType,
        content,
      },
    });
  }

  async function sendText(chat: any, text: string) {
    const chunks = chunkText(text, FEISHU_TEXT_CHUNK);
    for (const chunk of chunks) {
      await sendSingleMessage(chat, "text", { text: chunk });
    }
  }

  // 上传图片获取 image_key
  async function uploadImage(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath).catch(() => {
      throw new FeishuChannelError(`图片文件不存在：${filePath}`);
    });
    const fileName = path.basename(filePath);
    const form = new FormData();
    form.append("image_type", "message");
    form.append("image", new Blob([buffer]), fileName);
    const data = await api("/open-apis/im/v1/images", {
      method: "POST",
      body: form,
      isForm: true,
    });
    const imageKey = String(data?.image_key || "").trim();
    if (!imageKey) throw new FeishuChannelError("飞书图片上传响应缺少 image_key");
    return imageKey;
  }

  // 上传文件或语音获取 file_key
  async function uploadFile(filePath: string, kind: string): Promise<string> {
    const buffer = await fs.readFile(filePath).catch(() => {
      throw new FeishuChannelError(`附件文件不存在：${filePath}`);
    });
    const fileName = path.basename(filePath);
    const fileType = feishuUploadFileType(filePath, kind);
    const form = new FormData();
    form.append("file_type", fileType);
    form.append("file_name", fileName);
    form.append("file", new Blob([buffer]), fileName);
    const data = await api("/open-apis/im/v1/files", {
      method: "POST",
      body: form,
      isForm: true,
    });
    const fileKey = String(data?.file_key || "").trim();
    if (!fileKey) throw new FeishuChannelError("飞书文件上传响应缺少 file_key");
    return fileKey;
  }

  async function sendMedia(chat: any, parts: any[]) {
    for (const part of parts || []) {
      if (!part) continue;
      if (part.type === "text") {
        await sendText(chat, String(part.text || ""));
        continue;
      }
      const kind = ["image", "video", "voice", "file"].includes(part.kind) ? part.kind : "file";
      if (part.caption) {
        await sendText(chat, String(part.caption));
      }
      if (kind === "image") {
        const imageKey = await uploadImage(part.filePath);
        await sendSingleMessage(chat, "image", { image_key: imageKey });
      } else if (kind === "voice") {
        const fileKey = await uploadFile(part.filePath, "voice");
        await sendSingleMessage(chat, "audio", { file_key: fileKey });
      } else {
        const fileKey = await uploadFile(part.filePath, kind);
        await sendSingleMessage(chat, "file", { file_key: fileKey });
      }
    }
  }

  return {
    id: "feishu",
    async start() {
      stopped = false;
      await connect();
    },
    async stop() {
      stopped = true;
      clearTimers();
      fragmentBuckets.clear();
      try { ws?.close(); } catch { /* 忽略 */ }
      ws = null;
      setStatus("disabled");
    },
    sendText,
    sendMedia,
    downloadAttachment,
    // 测试钩子：直接注入一帧二进制或事件对象
    _handleFrameData: handleFrameData,
  };
}
