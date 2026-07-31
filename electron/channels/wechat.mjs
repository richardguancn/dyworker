// 微信 ClawBot 渠道适配器:官方 iLink 通道(ilinkai.weixin.qq.com),扫码登录后长轮询收发消息。
// 登录二维码流程手写(两个 GET 接口,参考官方文档与 weixin-clawbot CLI);
// 消息通道复用 weixin-clawbot SDK(Bot 长轮询),懒加载,渠道未启用时不引入。
// 本文件不依赖 electron,fetch / Bot 工厂均可注入,方便用 node --test 直接测试。

import { chunkText } from "./qq-bot.mjs";
import qrcode from "qrcode";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const QR_POLL_INTERVAL_MS = 1000;
const QR_LOGIN_TIMEOUT_MS = 480_000;
const MAX_QR_REFRESH_COUNT = 3;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

export class WechatChannelError extends Error {}

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

export function createWechatChannel({ token = "", userId = "", baseUrl = "", stateRoot = "", fetchImpl = fetch, createBotImpl = defaultCreateBot, onMessage = () => { }, onStatus = () => { }, onLogin = async () => { } } = {}) {
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
      if (message.kind === "text" && String(message.text || "").trim()) {
        lastContextByChat.set(String(ctx.fromUserId), ctx);
        onMessage({
          channel: "wechat",
          chatType: "dm",
          chatId: String(ctx.fromUserId),
          userId: String(ctx.fromUserId),
          userName: "",
          text: String(message.text).trim(),
          messageId: String(message.id || ""),
        });
        return;
      }
      if (message.kind === "voice" && message.transcript) {
        lastContextByChat.set(String(ctx.fromUserId), ctx);
        onMessage({
          channel: "wechat",
          chatType: "dm",
          chatId: String(ctx.fromUserId),
          userId: String(ctx.fromUserId),
          userName: "",
          text: String(message.transcript).trim(),
          messageId: String(message.id || ""),
        });
        return;
      }
      // v1 只处理文本/语音转写,其余类型回一句提示
      lastContextByChat.set(String(ctx.fromUserId), ctx);
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
    async sendTyping(chat) {
      const ctx = lastContextByChat.get(String(chat.chatId));
      if (ctx) await ctx.sendTyping().catch(() => { });
    },
  };
}
