// 渠道管理层:协议适配器(QQ/微信)与 DyWork 任务引擎之间的胶水。
// 职责:按设置启停渠道、状态广播、渠道聊天 ↔ 会话映射持久化、每聊天串行队列、
// 审批/提问的 IM 侧决议路由(与桌面收件箱共用同一个决议入口)。
// 本文件不依赖 electron,方便用 node --test 直接测试。

import { randomUUID } from "node:crypto";
import { createQqBotClient, parseApprovalReply } from "./qq-bot.mjs";
import { createWechatChannel } from "./wechat.mjs";

export const CHANNEL_IDS = ["qq", "wechat"];
export const CHANNEL_LABELS = { qq: "QQ", wechat: "微信" };

// 渠道媒体大小上限（入站下载与出站发送共用，见设计文档第 2/4/9 节）
export { MAX_MEDIA_BYTES } from "./shared.mjs";

export function chatKeyOf(channel, chatId) {
  return `${channel}:${chatId}`;
}

// 渠道消息里的特殊指令(不走 agent)
const STOP_WORDS = new Set(["停止", "取消任务", "stop"]);

export function createChannelManager({
  readChats, // () => Promise<object>  持久化的 channel-chats 映射
  writeChats, // (chats) => Promise<void>
  onStatus = () => { }, // (statusMap) => void  广播给渲染端
  onRunTask = async () => { }, // ({ channel, chat, text, chatRecord, queueLength }) => void  由 main 执行 agent
  onResolvePending = async () => { }, // ({ chatRecord, pending, replyText }) => Promise<boolean>  IM 决议,返回是否命中
  onStopChat = async () => false, // ({ channel, chat, chatRecord, key, pending }) => Promise<boolean>  中止该聊天执行中/等待中的任务,返回是否存在
  queueWaitHint = () => "", // () => string  排队提示里附带的全局阻塞原因（电脑端任务/定时任务执行中等）
  onSaveWechatCredentials = async () => { }, // 微信扫码成功后落盘凭据
  defaultWorkspace = () => "", // 推导新渠道会话的工作区
  mediaDir = "", // 入站媒体暂存目录（userData/channel-media，由 main 注入）
  wechatStateRoot = "", // 微信 ClawBot SDK 本地状态目录（userData/wechat-state，由 main 注入）
  createQqClient = createQqBotClient,
  createWechat = createWechatChannel,
} = {}) {
  const adapters = new Map(); // channelId → adapter 实例
  const statusMap = {
    qq: { status: "disabled", detail: "" },
    wechat: { status: "disabled", detail: "" },
  };
  const queues = new Map(); // chatKey → Promise(队尾)
  const queueLengths = new Map(); // chatKey → 排队中的消息数
  const queueEpochs = new Map(); // chatKey → 队列代数,「停止」时 +1 使已排队消息失效
  const pendingByChat = new Map(); // chatKey → { itemId, kind: "approval"|"question", options }
  const lastInboundByKey = new Map(); // chatKey → 最近一条入站消息（replyMedia 出站用）
  let chats = null; // chatKey → { sessionId, workspacePath, title, createdAt, updatedAt }

  async function loadChats() {
    if (!chats) {
      const stored = await readChats();
      chats = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    }
    return chats;
  }

  async function chatRecordFor(message) {
    const all = await loadChats();
    const key = chatKeyOf(message.channel, message.chatId);
    if (all[key]) {
      const record = all[key];
      // 历史脏数据修复:旧代码把异步 defaultWorkspace 的 Promise 直接落盘,
      // 序列化后变成 {}（读取后是 [object Object] 工作区,所有工具失败）。
      // 非字符串或空值一律按当前工作区重新推导并回写。
      if (typeof record.workspacePath !== "string" || !record.workspacePath.trim()) {
        record.workspacePath = await defaultWorkspace();
        await writeChats(all);
      }
      return { key, record, created: false };
    }
    const label = CHANNEL_LABELS[message.channel] || message.channel;
    all[key] = {
      sessionId: randomUUID(),
      // defaultWorkspace 可能是异步函数,必须 await,否则 Promise 会被当路径使用/落盘
      workspacePath: await defaultWorkspace(),
      title: `${label}·${message.userName || message.chatId.slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeChats(all);
    return { key, record: all[key], created: true };
  }

  async function touchChat(key) {
    const all = await loadChats();
    if (all[key]) {
      all[key].updatedAt = new Date().toISOString();
      await writeChats(all);
    }
  }

  function emitStatus() {
    onStatus(JSON.parse(JSON.stringify(statusMap)));
  }

  function handleAdapterStatus(event) {
    const current = statusMap[event.channel] || {};
    statusMap[event.channel] = { status: event.status, detail: event.detail || "", ...(event.qrUrl ? { qrUrl: event.qrUrl } : {}) };
    if (event.status !== current.status || event.detail !== current.detail || event.qrUrl) emitStatus();
  }

  // 每聊天串行:同一聊天的任务排队执行,不同聊天共用全局 busy guard(由 main 侧仲裁)
  // 入队时记录队列代数:「停止」会把代数 +1,轮到已失效的消息时直接跳过不再执行
  function enqueue(key, task) {
    const epoch = queueEpochs.get(key) || 0;
    const tail = queues.get(key) || Promise.resolve();
    queueLengths.set(key, (queueLengths.get(key) || 0) + 1);
    const guarded = async () => {
      if ((queueEpochs.get(key) || 0) !== epoch) return;
      await task();
    };
    const next = tail.then(guarded, guarded);
    queues.set(key, next);
    void next.finally(() => {
      queueLengths.set(key, Math.max(0, (queueLengths.get(key) || 1) - 1));
      if (queues.get(key) === next) queues.delete(key);
    });
    return queueLengths.get(key);
  }

  async function handleInbound(message) {
    const adapter = adapters.get(message.channel);
    const reply = (text) => (adapter ? adapter.sendText(message, text) : Promise.resolve());
    // 正在输入状态：适配器不支持时静默跳过（QQ 群聊没有输入提示，也走这里）
    const sendTyping = () => {
      if (!adapter || typeof adapter.sendTyping !== "function") return Promise.resolve();
      return Promise.resolve(adapter.sendTyping(message)).catch(() => { });
    };
    const { key, record, created } = await chatRecordFor(message);
    lastInboundByKey.set(key, message);
    // 出站媒体：适配器支持 sendMedia 时原样发送；否则降级为逐条文字说明。
    // 契约见设计文档第 2 节：parts = [{ type:"text", text } | { type:"media", kind, filePath, fileName? }]
    const replyMedia = (parts) => {
      if (!adapter) return Promise.resolve();
      if (typeof adapter.sendMedia === "function") return adapter.sendMedia(message, parts);
      const lines = (Array.isArray(parts) ? parts : []).map((part) => {
        if (part && part.type === "text") return String(part.text || "");
        return `[${part?.fileName || "媒体文件"}]`;
      }).filter((line) => line.trim());
      return adapter.sendText(message, lines.join("\n"));
    };
    // 1. 特殊指令:停止优先于待决议——审批/提问等待中也能用它脱身
    if (STOP_WORDS.has(message.text.trim().toLowerCase())) {
      const queued = queueLengths.get(key) || 0;
      // 代数 +1:已排队但未开始的消息轮到时会直接跳过
      queueEpochs.set(key, (queueEpochs.get(key) || 0) + 1);
      const pending = pendingByChat.get(key) || null;
      if (pending) pendingByChat.delete(key);
      const running = await onStopChat({ channel: message.channel, chat: message, chatRecord: record, key, pending }).catch(() => false);
      // queueLengths 含正在执行的那一条,扣掉后才是被清空的排队消息数
      const cleared = Math.max(0, queued - (running ? 1 : 0));
      const parts = [];
      if (running) parts.push("已中止正在执行的任务");
      if (cleared > 0) parts.push(`已清空 ${cleared} 条排队消息`);
      if (pending) parts.push("已取消待处理的审批/提问");
      await reply(parts.length ? `${parts.join("，")}。` : "当前没有执行中或排队的任务。").catch(() => { });
      return;
    }
    // 2. 命中待决议(审批/提问)→ 直接决议,不进任务队列
    const pending = pendingByChat.get(key);
    if (pending) {
      const handled = await onResolvePending({ channel: message.channel, chatRecord: record, pending, replyText: message.text });
      if (handled) {
        pendingByChat.delete(key);
        await reply(pending.kind === "approval" ? "收到,已按您的决定继续执行。" : "收到,继续处理。").catch(() => { });
        return;
      }
      // 不是有效决议回复 → 提示后仍按待决议等待(避免审批被新任务淹没)
      await reply(pending.kind === "approval"
        ? "请先回复「允许」或「拒绝」处理上面的审批;也可以到电脑端的审批收件箱处理,或回复「停止」中止任务。"
        : "请先回复上面的问题(可回复选项序号),或到电脑端处理,或回复「停止」中止任务。").catch(() => { });
      return;
    }
    // 3. 正常任务:串行入队
    const position = enqueue(key, async () => {
      await touchChat(key);
      await onRunTask({
        channel: message.channel,
        chat: message,
        chatKey: key,
        text: message.text,
        media: message.media,
        chatRecord: record,
        isNewChat: created,
        reply,
        replyMedia,
        sendTyping,
        registerPending: (pending) => pendingByChat.set(key, pending),
        clearPending: () => pendingByChat.delete(key),
      });
    });
    if (position > 1) {
      const hint = String(queueWaitHint() || "").trim();
      await reply(`排队中,前面还有 ${position - 1} 个任务。${hint ? `（${hint}）` : ""}回复「停止」可清空队列。`).catch(() => { });
    }
  }

  function makeAdapter(channelId, config) {
    if (channelId === "qq") {
      return createQqClient({
        appId: config.appId,
        appSecret: config.appSecret,
        mediaDir: mediaDir ? `${mediaDir}/qq` : "",
        onMessage: (message) => void handleInbound(message).catch(() => { }),
        onStatus: handleAdapterStatus,
      });
    }
    if (channelId === "wechat") {
      return createWechat({
        token: config.token,
        userId: config.userId,
        baseUrl: config.baseUrl,
        mediaDir: mediaDir ? `${mediaDir}/wechat` : "",
        stateRoot: wechatStateRoot,
        onMessage: (message) => void handleInbound(message).catch(() => { }),
        onStatus: handleAdapterStatus,
        onLogin: onSaveWechatCredentials,
      });
    }
    return null;
  }

  return {
    // 按设置 diff 启停;settings.channels 形如 { qq: { enabled, appId, appSecret }, wechat: { enabled, token, userId, baseUrl } }
    async reconcile(channelsConfig = {}) {
      for (const channelId of CHANNEL_IDS) {
        const config = channelsConfig[channelId] || {};
        const existing = adapters.get(channelId);
        if (!config.enabled) {
          if (existing) {
            adapters.delete(channelId);
            await existing.stop().catch(() => { });
          }
          if (statusMap[channelId].status !== "disabled") {
            statusMap[channelId] = { status: "disabled", detail: "" };
            emitStatus();
          }
          continue;
        }
        // 启用:配置变化(凭据/账号)时重建适配器
        const signature = JSON.stringify(config);
        if (existing && existing._signature === signature) continue;
        if (existing) {
          adapters.delete(channelId);
          await existing.stop().catch(() => { });
        }
        try {
          const adapter = makeAdapter(channelId, config);
          if (!adapter) continue;
          adapter._signature = signature;
          adapters.set(channelId, adapter);
          await adapter.start();
        } catch (error) {
          statusMap[channelId] = { status: "error", detail: error instanceof Error ? error.message : String(error) };
          emitStatus();
        }
      }
    },

    async stopAll() {
      for (const adapter of adapters.values()) {
        await adapter.stop().catch(() => { });
      }
      adapters.clear();
    },

    status: () => JSON.parse(JSON.stringify(statusMap)),
    pendingCount: () => pendingByChat.size,
    // 测试/调试钩子
    _handleInbound: handleInbound,
    _pendingByChat: pendingByChat,
  };
}
