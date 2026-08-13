// 微信 ClawBot 渠道适配器:官方 iLink 通道(ilinkai.weixin.qq.com),扫码登录后长轮询收发消息。
// 登录二维码流程手写(两个 GET 接口,参考官方文档与 weixin-clawbot CLI);
// 消息通道复用 weixin-clawbot SDK(Bot 长轮询),懒加载,渠道未启用时不引入。
// 本文件不依赖 electron,fetch / Bot 工厂均可注入,方便用 node --test 直接测试。

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_MEDIA_BYTES, chunkText, sniffImageExtension } from "./shared.mjs";
import qrcode from "qrcode";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const QR_POLL_INTERVAL_MS = 1000;
const QR_LOGIN_TIMEOUT_MS = 480_000;
const MAX_QR_REFRESH_COUNT = 3;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

export class WechatChannelError extends Error {}

// sniffImageExtension 已移至 shared.mjs（消除与 qq-bot.mjs 的循环依赖），此处 re-export 保持对外 API
export { sniffImageExtension };

// 微信收到的 image/video 落盘扩展名：image 按魔数识别，识别不出用消息自带信息回退
function extensionForKind(kind, buffer, fileName) {
  if (kind === "image") return sniffImageExtension(buffer) || ".jpg";
  if (kind === "video") return ".mp4";
  const fallback = fileName ? path.extname(String(fileName)) : "";
  return fallback || sniffImageExtension(buffer) || ".bin";
}

// 占位文案：纯媒体消息在模型侧用文字描述，桌面会话配合附件展示
function placeholderTextForKind(kind, fileName) {
  if (kind === "image") return "[图片]";
  if (kind === "video") return "[视频]";
  if (kind === "voice") return "[语音]";
  return `[文件:${fileName || "附件"}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createWechatQrImage(content) {
  const value = String(content || "").trim();
  if (!value) throw new WechatChannelError("微信二维码内容为空");
  return qrcode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 320 });
}

// ---- 扫码登录(纯函数式,可注入 fetch 测试)----

export async function fetchWechatQrCode({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.qrcode) {
    throw new WechatChannelError(`微信二维码获取失败:${payload.errmsg || payload.message || response.status}`);
  }
  return { qrcode: String(payload.qrcode), qrUrl: String(payload.qrcode_img_content || "") };
}

// 长轮询扫码状态;服务端 35s 无变化会超时,超时按 wait 处理
export async function fetchWechatQrStatus({ baseUrl = DEFAULT_BASE_URL, qrcode, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: AbortSignal.timeout(QR_LONG_POLL_TIMEOUT_MS + 5000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { status: "wait" };
    return payload;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return { status: "wait" };
    throw error;
  }
}

// 完整扫码登录流程:onQr(qrUrl) 回调展示二维码;成功返回 { token, userId, baseUrl }
export async function runWechatQrLogin({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, onQr = () => { }, onScan = () => { }, isCancelled = () => false, now = () => Date.now() } = {}) {
  let { qrcode, qrUrl } = await fetchWechatQrCode({ baseUrl, fetchImpl });
  onQr(await createWechatQrImage(qrUrl));
  let refreshCount = 1;
  let scanNotified = false;
  const deadline = now() + QR_LOGIN_TIMEOUT_MS;
  while (now() < deadline) {
    if (isCancelled()) throw new WechatChannelError("登录已取消");
    const status = await fetchWechatQrStatus({ baseUrl, qrcode, fetchImpl });
    if (status.status === "wait") {
      await sleep(QR_POLL_INTERVAL_MS);
      continue;
    }
    if (status.status === "scaned") {
      if (!scanNotified) {
        scanNotified = true;
        onScan();
      }
      await sleep(QR_POLL_INTERVAL_MS);
      continue;
    }
    if (status.status === "expired") {
      refreshCount += 1;
      if (refreshCount > MAX_QR_REFRESH_COUNT) throw new WechatChannelError("二维码多次过期,请重新登录");
      const refreshed = await fetchWechatQrCode({ baseUrl, fetchImpl });
      qrcode = refreshed.qrcode;
      scanNotified = false;
      onQr(await createWechatQrImage(refreshed.qrUrl));
      continue;
    }
    if (status.status === "confirmed") {
      const token = String(status.bot_token || "");
      const userId = String(status.ilink_user_id || "");
      if (!token || !userId) throw new WechatChannelError("登录凭据不完整");
      return { token, userId, baseUrl: String(status.baseurl || "").trim() || baseUrl };
    }
    await sleep(QR_POLL_INTERVAL_MS);
  }
  throw new WechatChannelError("登录超时,请重新扫码");
}

// ---- 渠道适配器 ----

// createBotImpl 可注入(测试用假 Bot);生产用 weixin-clawbot 的 Bot
async function defaultCreateBot(options) {
  const { Bot } = await import("weixin-clawbot");
  return new Bot(options);
}

export function createWechatChannel({ token = "", userId = "", baseUrl = "", stateRoot = "", mediaDir = "", fetchImpl = fetch, createBotImpl = defaultCreateBot, onMessage = () => { }, onStatus = () => { }, onLogin = async () => { } } = {}) {
  // 空字符串不算配置:凭据缺失时也要落到默认通道地址
  const effectiveBaseUrl = String(baseUrl || "").trim() || DEFAULT_BASE_URL;
  let bot = null;
  let stopped = false;
  let loginTask = null;
  const lastContextByChat = new Map();

  function setStatus(status, detail = "", extra = {}) {
    onStatus({ channel: "wechat", status, detail, ...extra });
  }

  async function startWithCredentials(credentials) {
    bot = await createBotImpl({
      token: credentials.token,
      userId: credentials.userId,
      baseUrl: String(credentials.baseUrl || "").trim() || effectiveBaseUrl,
      ...(stateRoot ? { stateRoot } : {}),
    });
    bot.on("message", (ctx) => {
      const message = ctx?.message || {};
      const chatId = String(ctx.fromUserId);
      lastContextByChat.set(chatId, ctx);
      if (message.kind === "text" && String(message.text || "").trim()) {
        onMessage({
          channel: "wechat",
          chatType: "dm",
          chatId,
          userId: chatId,
          userName: "",
          text: String(message.text).trim(),
          messageId: String(message.id || ""),
        });
        return;
      }
      if (message.kind === "voice") {
        // 语音自带平台转写；有 transcript 直接当文本，否则按占位文案进任务
        const transcript = String(message.transcript || "").trim();
        onMessage({
          channel: "wechat",
          chatType: "dm",
          chatId,
          userId: chatId,
          userName: "",
          text: transcript || placeholderTextForKind("voice"),
          messageId: String(message.id || ""),
          ...(transcript ? {} : { media: [{ kind: "voice", transcript: "", size: Number(message.sizeBytes) || 0 }] }),
        });
        return;
      }
      if (message.kind === "image" || message.kind === "file" || message.kind === "video") {
        // 下载并解密收到的媒体，写进暂存目录（userData/channel-media/wechat）
        void (async () => {
          try {
            if (Number(message.sizeBytes) > MAX_MEDIA_BYTES) {
              await ctx.reply("文件超过 50 MB，暂不支持。").catch(() => { });
              return;
            }
            const buffer = await ctx.downloadMedia();
            if (!buffer || !buffer.length) throw new WechatChannelError("媒体内容为空");
            if (buffer.byteLength > MAX_MEDIA_BYTES) {
              await ctx.reply("文件超过 50 MB，暂不支持。").catch(() => { });
              return;
            }
            const fileName = String(message.fileName || "");
            const extension = extensionForKind(message.kind, buffer, fileName);
            const messageId = String(message.id || crypto.randomUUID());
            const dir = mediaDir || "";
            if (!dir) throw new WechatChannelError("媒体暂存目录未配置");
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, `${messageId}${extension}`);
            await fs.writeFile(filePath, buffer);
            onMessage({
              channel: "wechat",
              chatType: "dm",
              chatId,
              userId: chatId,
              userName: "",
              text: placeholderTextForKind(message.kind, fileName),
              messageId,
              media: [{
                kind: message.kind,
                filePath,
                fileName: fileName || `消息${extension}`,
                size: buffer.byteLength,
              }],
            });
          } catch (error) {
            await ctx.reply("这个文件暂时读不了，请换个方式发给我。").catch(() => { });
          }
        })();
        return;
      }
      // 未知类型回一句提示
      void ctx.reply("目前只支持文字消息,请用文字描述您的需求。").catch(() => { });
    });
    bot.on("error", (error) => {
      setStatus("error", error instanceof Error ? error.message : String(error));
    });
    bot.on("start", () => setStatus("online"));
    bot.on("end", () => {
      if (!stopped) setStatus("connecting", "连接已断开");
    });
    bot.start();
    setStatus("connecting");
  }

  async function startLogin() {
    setStatus("awaiting-scan");
    try {
      const credentials = await runWechatQrLogin({
        baseUrl: effectiveBaseUrl,
        fetchImpl,
        isCancelled: () => stopped,
        onQr: (qrUrl) => setStatus("awaiting-scan", "请用微信扫码登录", { qrUrl }),
        onScan: () => setStatus("awaiting-scan", "已扫码,请在微信中确认"),
      });
      await onLogin(credentials);
      await startWithCredentials(credentials);
    } catch (error) {
      if (!stopped) setStatus("error", error instanceof Error ? error.message : String(error));
    }
  }

  return {
    id: "wechat",
    hasCredentials: Boolean(token && userId),
    async start() {
      stopped = false;
      if (token && userId) {
        await startWithCredentials({ token, userId, baseUrl });
        return;
      }
      loginTask = startLogin();
      await loginTask;
    },
    async stop() {
      stopped = true;
      try { bot?.end(); } catch { /* 忽略 */ }
      bot = null;
      lastContextByChat.clear();
      setStatus("disabled");
    },
    async sendText(chat, text) {
      const ctx = lastContextByChat.get(String(chat.chatId));
      if (!ctx) throw new WechatChannelError("没有可回复的微信会话,请对方先发一条消息");
      for (const chunk of chunkText(text)) {
        await ctx.reply(chunk);
      }
    },
    // 出站媒体：parts = [{ type:"text", text } | { type:"media", kind, filePath, fileName?, caption? }]
    async sendMedia(chat, parts) {
      const ctx = lastContextByChat.get(String(chat.chatId));
      if (!ctx) throw new WechatChannelError("请对方先发一条消息再让助手发文件");
      for (const part of parts || []) {
        if (!part) continue;
        if (part.type === "text") {
          for (const chunk of chunkText(String(part.text || ""))) {
            await ctx.reply(chunk);
          }
          continue;
        }
        const kind = part.kind === "video" ? "video" : part.kind === "voice" ? "voice" : part.kind === "file" ? "file" : "image";
        await ctx.reply({
          kind,
          filePath: String(part.filePath || ""),
          ...(part.fileName ? { fileName: String(part.fileName) } : {}),
          ...(part.caption ? { text: String(part.caption) } : {}),
        });
      }
    },
    async sendTyping(chat) {
      const ctx = lastContextByChat.get(String(chat.chatId));
      if (ctx) await ctx.sendTyping().catch(() => { });
    },
  };
}
