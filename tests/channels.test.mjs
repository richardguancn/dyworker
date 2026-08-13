import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chunkText, createQqBotClient, normalizeQqEvent, normalizeQqMediaAttachment, parseApprovalReply } from "../electron/channels/qq-bot.mjs";
import { createWechatChannel, fetchWechatQrStatus, runWechatQrLogin, sniffImageExtension } from "../electron/channels/wechat.mjs";
import { chatKeyOf, createChannelManager, MAX_MEDIA_BYTES } from "../electron/channels/manager.mjs";
import { verifyChannelMediaPath } from "../electron/channels/media-tools.mjs";

// ---- chunkText ----

test("chunkText:短文本不切,长文本优先在换行处断开", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("你好"), ["你好"]);
  const long = "第一段内容。\n" + "x".repeat(1600);
  const chunks = chunkText(long, 1500);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1500));
  assert.equal(chunks.join(""), long);
  // 无断点的长文本硬切
  const solid = "y".repeat(3200);
  const solidChunks = chunkText(solid, 1500);
  assert.equal(solidChunks.length, 3);
  assert.equal(solidChunks.join(""), solid);
});

// ---- parseApprovalReply ----

test("parseApprovalReply:允许/拒绝/无效 三态", () => {
  for (const text of ["允许", "同意", "1", "y", " yes ", "OK", "确认"]) {
    assert.equal(parseApprovalReply(text), true, text);
  }
  for (const text of ["拒绝", "不同意", "取消", "2", "n", "No"]) {
    assert.equal(parseApprovalReply(text), false, text);
  }
  for (const text of ["允许执行这个", "好吧", "", "12", "允许吧"]) {
    assert.equal(parseApprovalReply(text), null, text);
  }
});

// ---- normalizeQqEvent ----

test("normalizeQqEvent:私聊/群@/频道私信归一化,过滤自身与无关事件", () => {
  const c2c = normalizeQqEvent({
    op: 0, t: "C2C_MESSAGE_CREATE", s: 7,
    d: { id: "m1", content: " 你好 ", author: { id: "u100" } },
  });
  assert.deepEqual(c2c, { channel: "qq", chatType: "dm", chatId: "u100", userId: "u100", userName: "", text: "你好", messageId: "m1" });

  const group = normalizeQqEvent({
    op: 0, t: "GROUP_AT_MESSAGE_CREATE",
    d: { id: "m2", content: "查一下台账", group_openid: "g200", author: { id: "u101", username: "张三" } },
  });
  assert.equal(group.chatType, "group");
  assert.equal(group.chatId, "g200");
  assert.equal(group.userName, "张三");

  const direct = normalizeQqEvent({
    op: 0, t: "DIRECT_MESSAGE_CREATE",
    d: { id: "m3", content: "hi", channel_id: "c300", author: { id: "u102" } },
  });
  assert.equal(direct.chatType, "dm");
  assert.equal(direct.chatId, "c300");

  // 非 dispatch、空文本、机器人自己的消息都忽略
  assert.equal(normalizeQqEvent({ op: 10, d: {} }), null);
  assert.equal(normalizeQqEvent({ op: 0, t: "C2C_MESSAGE_CREATE", d: { content: "  ", author: { id: "u1" } } }), null);
  assert.equal(normalizeQqEvent({ op: 0, t: "C2C_MESSAGE_CREATE", d: { content: "x", author: { id: "bot1" } } }, "bot1"), null);
  assert.equal(normalizeQqEvent({ op: 0, t: "GUILD_MESSAGE_CREATE", d: { content: "x", author: { id: "u1" } } }), null);
});

// ---- QQ 客户端:token 缓存 + WSS 状态机 + 出站切片 ----

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; this.onclose?.(); }
}

function qqFetchHarness() {
  const calls = [];
  let tokenExpiresIn = 7200;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: tokenExpiresIn }) };
    }
    if (url.endsWith("/gateway")) {
      return { ok: true, json: async () => ({ url: "wss://sandbox.qq/ws" }) };
    }
    return { ok: true, json: async () => ({ id: "out-1" }) };
  };
  return { calls, fetchImpl, setExpiresIn: (value) => { tokenExpiresIn = value; } };
}

test("QQ 客户端:identify→READY→收发消息,token 缓存复用", async () => {
  const { calls, fetchImpl } = qqFetchHarness();
  const received = [];
  const statuses = [];
  const client = createQqBotClient({
    appId: "app1",
    appSecret: "sec1",
    fetchImpl,
    webSocketImpl: FakeWebSocket,
    onMessage: (message) => received.push(message),
    onStatus: (status) => statuses.push(status),
  });
  try {
    await client.start();
    const ws = FakeWebSocket.instances.at(-1);
    assert.equal(ws.url, "wss://sandbox.qq/ws");

    ws.onmessage({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 30000 } }) });
    const identify = ws.sent.find((frame) => frame.op === 2);
    assert.ok(identify, "hello 后应发送 identify");
    assert.ok(identify.d.intents > 0);

    ws.onmessage({ data: JSON.stringify({ op: 0, t: "READY", d: { session_id: "s1", user: { id: "bot9" } } }) });
    assert.ok(statuses.some((entry) => entry.status === "online"));

    ws.onmessage({ data: JSON.stringify({ op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "m1", content: "你好", author: { id: "u1" } } }) });
    // 消息经 emitChain 串行化（微任务）处理，等待处理完成再断言
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(received.length, 1);
    assert.equal(received[0].chatId, "u1");

    // 出站:私聊被动回复,长文本切片 + msg_seq 递增
    await client.sendText({ chatType: "dm", chatId: "u1", messageId: "m1" }, "z".repeat(1600));
    const posts = calls.filter((call) => call.url.includes("/v2/users/u1/messages"));
    assert.equal(posts.length, 2);
    const first = JSON.parse(posts[0].options.body);
    const second = JSON.parse(posts[1].options.body);
    assert.equal(first.msg_seq, 1);
    assert.equal(second.msg_seq, 2);
    assert.equal(first.msg_id, "m1");
    assert.equal(first.content.length + second.content.length, 1600);

    // token 只取了一次(缓存命中)
    assert.equal(calls.filter((call) => call.url.includes("getAppAccessToken")).length, 1);
  } finally {
    // 无论断言是否失败都必须 stop，清掉心跳 setInterval，否则进程不退出（测试挂起）
    await client.stop();
  }
});

test("QQ 客户端:token 临近过期会重新获取;群聊出站走 groups 接口", async () => {
  const { calls, fetchImpl, setExpiresIn } = qqFetchHarness();
  setExpiresIn(100); // 100 秒 < 5 分钟刷新余量 → 每次调用都刷新
  const client = createQqBotClient({
    appId: "app1", appSecret: "sec1", fetchImpl, webSocketImpl: FakeWebSocket,
  });
  await client.start();
  await client.sendText({ chatType: "group", chatId: "g1", messageId: "m9" }, "群回复");
  assert.ok(calls.some((call) => call.url.includes("/v2/groups/g1/messages")));
  assert.ok(calls.filter((call) => call.url.includes("getAppAccessToken")).length >= 2);
  await client.stop();
});

test("QQ 客户端:凭据缺失直接报错;access_token 失败进入 error 状态", async () => {
  assert.throws(() => createQqBotClient({ appId: "", appSecret: "" }));
  const statuses = [];
  const client = createQqBotClient({
    appId: "a", appSecret: "s",
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: "invalid secret" }) }),
    webSocketImpl: FakeWebSocket,
    onStatus: (status) => statuses.push(status),
  });
  await client.start();
  assert.ok(statuses.some((entry) => entry.status === "error" && entry.detail.includes("invalid secret")));
  await client.stop();
});

// ---- 微信扫码登录 ----

test("微信扫码:二维码链接先转成本地图片,confirmed 直接返回凭据", async () => {
  const qrImages = [];
  const credentials = await runWechatQrLogin({
    onQr: (qrImage) => qrImages.push(qrImage),
    fetchImpl: async (url) => {
      if (url.includes("get_bot_qrcode")) {
        return { ok: true, json: async () => ({ qrcode: "qr-1", qrcode_img_content: "https://qr.img/1.png" }) };
      }
      return { ok: true, json: async () => ({ status: "confirmed", bot_token: "bt-1", ilink_user_id: "wxu-1", baseurl: "" }) };
    },
  });
  assert.equal(qrImages.length, 1);
  assert.match(qrImages[0], /^data:image\/png;base64,/);
  assert.deepEqual(credentials, { token: "bt-1", userId: "wxu-1", baseUrl: "https://ilinkai.weixin.qq.com" });

  // 轮询接口异常超时 → wait
  const status = await fetchWechatQrStatus({
    qrcode: "qr-1",
    fetchImpl: async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
  });
  assert.deepEqual(status, { status: "wait" });
});

// ---- 微信渠道适配器(假 Bot)----

test("微信渠道:baseUrl 为空字符串时回落到默认通道地址", async () => {
  const urls = [];
  const { factory } = fakeBotClass();
  const channel = createWechatChannel({
    token: "", userId: "", baseUrl: "",
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("get_bot_qrcode")) {
        return { ok: true, json: async () => ({ qrcode: "qr-1", qrcode_img_content: "https://qr.img/1.png" }) };
      }
      return { ok: true, json: async () => ({ status: "confirmed", bot_token: "bt-1", ilink_user_id: "wxu-1" }) };
    },
    createBotImpl: factory,
  });
  await channel.start();
  assert.ok(urls.length >= 2);
  assert.ok(urls.every((url) => url.startsWith("https://ilinkai.weixin.qq.com/")), urls.join(","));
  await channel.stop();
});

function fakeBotClass(handlers = {}) {
  const instances = [];
  return {
    instances,
    factory: async (options) => {
      const bot = {
        options,
        handlers: {},
        replies: [],
        started: false,
        on(event, handler) { this.handlers[event] = handler; return bot; },
        start() { this.started = true; this.handlers.start?.(); },
        end() { this.handlers.end?.(); },
      };
      instances.push(bot);
      Object.assign(bot, handlers);
      return bot;
    },
  };
}

test("微信渠道:文本/语音转写归一化,其余类型回提示;回复按聊天缓存上下文", async () => {
  const { instances, factory } = fakeBotClass();
  const received = [];
  const channel = createWechatChannel({
    token: "bt-1", userId: "wxu-1",
    createBotImpl: factory,
    onMessage: (message) => received.push(message),
  });
  await channel.start();
  const bot = instances.at(-1);
  assert.ok(bot.started);
  assert.equal(bot.options.token, "bt-1");

  const replies = [];
  const ctx = {
    fromUserId: "wx-friend-1",
    message: { kind: "text", text: " 帮我写个通知 ", id: "mm1" },
    reply: async (text) => { replies.push(text); return { messageId: "r1" }; },
  };
  bot.handlers.message(ctx);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    channel: "wechat", chatType: "dm", chatId: "wx-friend-1",
    userId: "wx-friend-1", userName: "", text: "帮我写个通知", messageId: "mm1",
  });

  // 语音转写按文本处理
  bot.handlers.message({ fromUserId: "wx-friend-1", message: { kind: "voice", transcript: "语音内容", id: "mm2" }, reply: ctx.reply });
  assert.equal(received.length, 2);
  assert.equal(received[1].text, "语音内容");

  // 图片等类型进入下载分支：假 Bot 没有 downloadMedia → 降级提示，不进任务流
  bot.handlers.message({ fromUserId: "wx-friend-1", message: { kind: "image", id: "mm3" }, reply: ctx.reply });
  assert.equal(received.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(replies.some((text) => text.includes("读不了")));

  // sendText 用最近上下文回复并切片
  await channel.sendText({ chatId: "wx-friend-1" }, "q".repeat(1600));
  assert.equal(replies.filter((text) => text.startsWith("q")).length, 2);

  await channel.stop();
  // stop 后无上下文,回复报可理解的错误
  await assert.rejects(() => channel.sendText({ chatId: "wx-friend-1" }, "hi"), /先发一条消息/);
});

// ---- 渠道管理层 ----

function managerHarness(overrides = {}) {
  const sentTexts = [];
  const tasks = [];
  const resolves = [];
  const chatsFile = { value: {} };
  const adapter = {
    _signature: "",
    started: false,
    opts: null,
    start: async () => {
      adapter.started = true;
      adapter.opts?.onStatus({ channel: "qq", status: "online" });
    },
    stop: async () => { adapter.started = false; },
    sendText: async (chat, text) => { sentTexts.push({ chatId: chat.chatId, text }); },
  };
  const manager = createChannelManager({
    readChats: async () => chatsFile.value,
    writeChats: async (chats) => { chatsFile.value = chats; },
    onRunTask: async (task) => { tasks.push(task); await task.text?.length; },
    onResolvePending: async ({ replyText }) => {
      resolves.push(replyText);
      return replyText === "允许";
    },
    createQqClient: (opts) => { adapter.opts = opts; return adapter; },
    defaultWorkspace: () => "/tmp/ws",
    ...overrides,
  });
  return { manager, adapter, sentTexts, tasks, resolves, chatsFile };
}

const qqMessage = (text, chatId = "u1") => ({
  channel: "qq", chatType: "dm", chatId, userId: chatId, userName: "张三", text, messageId: `m-${text}`,
});

test("manager:reconcile 启停适配器,状态广播", async () => {
  const statuses = [];
  const { manager, adapter } = managerHarness({ onStatus: (map) => statuses.push(map) });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  assert.ok(adapter.started);
  assert.ok(statuses.some((map) => map.qq.status === "online"));
  // 配置不变不重建
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager.reconcile({ qq: { enabled: false } });
  assert.ok(!adapter.started);
  assert.equal(manager.status().qq.status, "disabled");
  assert.ok(statuses.some((map) => map.qq.status === "disabled"));
});

test("manager:新聊天建会话映射,同一聊天复用 sessionId", async () => {
  const { manager, tasks, chatsFile } = managerHarness();
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager._handleInbound(qqMessage("第一个任务"));
  await manager._handleInbound(qqMessage("第二个任务"));
  // 队列是微任务驱动,等它跑完
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].isNewChat, true);
  assert.equal(tasks[1].isNewChat, false);
  assert.equal(tasks[0].chatRecord.sessionId, tasks[1].chatRecord.sessionId);
  const record = chatsFile.value[chatKeyOf("qq", "u1")];
  assert.equal(record.workspacePath, "/tmp/ws");
  assert.ok(record.title.startsWith("QQ·"));
});

test("manager:同一聊天串行排队并提示,不同聊天各自成行", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const { manager, sentTexts } = managerHarness({
    onRunTask: async (task) => {
      started.push(task.text);
      if (task.text === "任务A") await gate;
    },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager._handleInbound(qqMessage("任务A"));
  await manager._handleInbound(qqMessage("任务B"));
  // B 排队中,只开始了 A;B 收到排队提示
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["任务A"]);
  assert.ok(sentTexts.some((entry) => entry.text.includes("排队中")));
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(started, ["任务A", "任务B"]);
});

test("manager:待决期间,有效决议直接处理不进任务;无效回复被拦截提示", async () => {
  const { manager, tasks, resolves, sentTexts } = managerHarness();
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  manager._pendingByChat.set(chatKeyOf("qq", "u1"), { itemId: "inbox-1", kind: "approval" });
  await manager._handleInbound(qqMessage("允许"));
  assert.deepEqual(resolves, ["允许"]);
  assert.equal(tasks.length, 0);
  assert.equal(manager._pendingByChat.size, 0);
  assert.ok(sentTexts.some((entry) => entry.text.includes("继续执行")));

  manager._pendingByChat.set(chatKeyOf("qq", "u1"), { itemId: "inbox-2", kind: "approval" });
  await manager._handleInbound(qqMessage("随便说点别的"));
  assert.equal(tasks.length, 0, "无效回复不能变成新任务");
  assert.equal(manager._pendingByChat.size, 1, "仍保持待决");
  assert.ok(sentTexts.some((entry) => entry.text.includes("允许」或「拒绝")));
});

// ---- 渠道媒体：入站下载 / 归一化 / 出站发送（设计文档第 3/4/6 节）----

test("sniffImageExtension 按文件头识别 jpg/png/gif/webp", () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00]);
  assert.equal(sniffImageExtension(jpg), ".jpg");
  assert.equal(sniffImageExtension(png), ".png");
  assert.equal(sniffImageExtension(gif), ".gif");
  assert.equal(sniffImageExtension(webp), ".webp");
  assert.equal(sniffImageExtension(Buffer.from([0x00, 0x00, 0x00, 0x00])), null);
  assert.equal(sniffImageExtension(Buffer.alloc(0)), null);
  assert.equal(sniffImageExtension(null), null);
});

test("normalizeQqMediaAttachment 按 content_type 分类", () => {
  const image = normalizeQqMediaAttachment({ url: "https://cdn.qq/a.jpg", content_type: "image/jpeg", size: 1024, filename: "a.jpg" });
  assert.equal(image.kind, "image");
  assert.equal(image.url, "https://cdn.qq/a.jpg");
  assert.equal(image.size, 1024);
  assert.equal(image.fileName, "a.jpg");
  assert.equal(image.mimeType, "image/jpeg");

  const video = normalizeQqMediaAttachment({ url: "https://cdn.qq/v.mp4", content_type: "video/mp4" });
  assert.equal(video.kind, "video");

  const voice = normalizeQqMediaAttachment({ url: "https://cdn.qq/v.silk", content_type: "voice" });
  assert.equal(voice.kind, "voice");
  const voiceSilk = normalizeQqMediaAttachment({ url: "https://cdn.qq/v.silk", content_type: "application/x-silk" });
  assert.equal(voiceSilk.kind, "voice");

  const file = normalizeQqMediaAttachment({ url: "https://cdn.qq/f.zip", content_type: "file" });
  assert.equal(file.kind, "file");

  // 没有 url 的附件不归一化
  assert.equal(normalizeQqMediaAttachment({ content_type: "image/png" }), null);
  assert.equal(normalizeQqMediaAttachment({}), null);
});

test("normalizeQqEvent 纯媒体消息带占位文案与 media 数组", () => {
  const event = normalizeQqEvent({
    op: 0, t: "C2C_MESSAGE_CREATE",
    d: {
      id: "m-img", content: " ",
      author: { id: "u1", username: "李四" },
      attachments: [{ url: "https://cdn.qq/a.png", content_type: "image/png", size: 512, filename: "a.png" }],
    },
  });
  assert.equal(event.chatType, "dm");
  assert.equal(event.text, "[图片]");
  assert.equal(event.media.length, 1);
  assert.equal(event.media[0].kind, "image");
  assert.equal(event.media[0].fileName, "a.png");

  // 多附件：文字 + 图片
  const mixed = normalizeQqEvent({
    op: 0, t: "C2C_MESSAGE_CREATE",
    d: {
      id: "m-mix", content: "看这张图",
      author: { id: "u1" },
      attachments: [{ url: "https://cdn.qq/b.jpg", content_type: "image/jpeg" }, { url: "", content_type: "image/png" }],
    },
  });
  assert.equal(mixed.text, "看这张图");
  assert.equal(mixed.media.length, 1, "无 url 的附件应被过滤");
});

test("QQ 客户端:sendMedia 先上传拿 file_info 再以 msg_type=7 发送", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    if (url.endsWith("/gateway")) {
      return { ok: true, json: async () => ({ url: "wss://sandbox.qq/ws" }) };
    }
    if (url.includes("/files")) {
      return { ok: true, json: async () => ({ file_info: "fi-1" }) };
    }
    return { ok: true, json: async () => ({ id: "out-1" }) };
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "图.png");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await client.sendMedia({ chatType: "dm", chatId: "u1", messageId: "m1" }, [
      { type: "media", kind: "image", filePath, fileName: "图.png" },
    ]);
    const upload = calls.find((call) => call.url.includes("/v2/users/u1/files"));
    assert.ok(upload, "应先调用文件上传接口");
    assert.ok(upload.options.body instanceof FormData, "上传应使用 multipart 表单");
    assert.equal(upload.options.body.get("file_type"), "1", "图片对应 file_type=1");
    const post = calls.find((call) => call.url.includes("/v2/users/u1/messages"));
    assert.ok(post, "上传后应发送富媒体消息");
    const body = JSON.parse(post.options.body);
    assert.equal(body.msg_type, 7);
    assert.equal(body.content, " ");
    assert.deepEqual(body.media, { file_info: "fi-1" });
    assert.equal(body.msg_id, "m1");
    assert.equal(body.msg_seq, 1);
  } finally {
    await client.stop();
  }
});

test("QQ 客户端:sendMedia 群聊走 groups 接口且 file_type 按 kind 映射", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    if (url.endsWith("/gateway")) {
      return { ok: true, json: async () => ({ url: "wss://sandbox.qq/ws" }) };
    }
    if (url.includes("/files")) {
      return { ok: true, json: async () => ({ file_info: "fi-g" }) };
    }
    return { ok: true, json: async () => ({ id: "out-1" }) };
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "doc.pdf");
    await fs.writeFile(filePath, Buffer.from("%PDF-1.4"));
    await client.sendMedia({ chatType: "group", chatId: "g1", messageId: "m9" }, [
      { type: "media", kind: "file", filePath, fileName: "doc.pdf" },
    ]);
    const upload = calls.find((call) => call.url.includes("/v2/groups/g1/files"));
    assert.ok(upload, "群聊上传应走 groups 接口");
    assert.equal(upload.options.body.get("file_type"), "4", "文件对应 file_type=4");
    const post = calls.find((call) => call.url.includes("/v2/groups/g1/messages"));
    assert.equal(JSON.parse(post.options.body).msg_type, 7);
  } finally {
    await client.stop();
  }
});

test("QQ 客户端:sendMedia 上传 4xx 时抛错", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    if (url.endsWith("/gateway")) {
      return { ok: true, json: async () => ({ url: "wss://sandbox.qq/ws" }) };
    }
    if (url.includes("/files")) {
      return { ok: false, status: 403, json: async () => ({ message: "file_type 未开放" }) };
    }
    return { ok: true, json: async () => ({ id: "out-1" }) };
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "a.png");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await assert.rejects(
      () => client.sendMedia({ chatType: "dm", chatId: "u1" }, [{ type: "media", kind: "file", filePath }]),
      /上传失败/,
    );
  } finally {
    await client.stop();
  }
});

test("微信渠道:image/file 消息触发 downloadMedia 并落盘带 media 进任务流", async () => {
  const { instances, factory } = fakeBotClass();
  const received = [];
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-wx-media-"));
  const channel = createWechatChannel({
    token: "bt-1", userId: "wxu-1", mediaDir,
    createBotImpl: factory,
    onMessage: (message) => received.push(message),
  });
  await channel.start();
  const bot = instances.at(-1);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let downloads = 0;
  const ctx = {
    fromUserId: "wx-friend-1",
    message: { kind: "image", id: "mm-img", sizeBytes: png.length },
    reply: async () => ({}),
    downloadMedia: async () => { downloads += 1; return png; },
  };
  bot.handlers.message(ctx);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(downloads, 1, "图片消息应触发 downloadMedia");
  assert.equal(received.length, 1);
  assert.equal(received[0].text, "[图片]");
  assert.equal(received[0].media.length, 1);
  assert.equal(received[0].media[0].kind, "image");
  assert.match(received[0].media[0].filePath, /\.png$/);
  assert.ok(await fs.stat(received[0].media[0].filePath), "媒体文件应已落盘");

  // 文件类型带文件名,文本占位带文件名
  const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const ctxFile = {
    fromUserId: "wx-friend-1",
    message: { kind: "file", id: "mm-xlsx", fileName: "报表.xlsx", sizeBytes: xlsx.length },
    reply: async () => ({}),
    downloadMedia: async () => xlsx,
  };
  bot.handlers.message(ctxFile);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(received.length, 2);
  assert.equal(received[1].text, "[文件:报表.xlsx]");
  assert.match(received[1].media[0].filePath, /\.xlsx$/);
  assert.equal(received[1].media[0].fileName, "报表.xlsx");

  await channel.stop();
});

test("微信渠道:媒体下载失败时回复可读提示且不崩溃", async () => {
  const { instances, factory } = fakeBotClass();
  const received = [];
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-wx-media-"));
  const channel = createWechatChannel({
    token: "bt-1", userId: "wxu-1", mediaDir,
    createBotImpl: factory,
    onMessage: (message) => received.push(message),
  });
  await channel.start();
  const bot = instances.at(-1);
  const replies = [];
  bot.handlers.message({
    fromUserId: "wx-friend-1",
    message: { kind: "image", id: "mm-bad", sizeBytes: 10 },
    reply: async (text) => { replies.push(text); return {}; },
    downloadMedia: async () => { throw new Error("解密失败"); },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(received.length, 0, "下载失败不应进任务流");
  assert.ok(replies.some((text) => text.includes("读不了")), "应回复可读降级文案");
  await channel.stop();
});

test("微信渠道:sendMedia 按 parts 逐条发送 text 与媒体", async () => {
  const { instances, factory } = fakeBotClass();
  const channel = createWechatChannel({ token: "bt-1", userId: "wxu-1", createBotImpl: factory });
  await channel.start();
  const bot = instances.at(-1);
  const replies = [];
  const ctx = {
    fromUserId: "wx-friend-1",
    message: { kind: "text", text: "hi", id: "mm0" },
    reply: async (payload) => { replies.push(payload); return { messageId: "r1" }; },
  };
  bot.handlers.message(ctx);
  await channel.sendMedia({ chatId: "wx-friend-1" }, [
    { type: "text", text: "结果如下" },
    { type: "media", kind: "image", filePath: "/tmp/a.png", fileName: "a.png", caption: "图表" },
  ]);
  assert.equal(replies[0], "结果如下");
  assert.deepEqual(replies[1], { kind: "image", filePath: "/tmp/a.png", fileName: "a.png", text: "图表" });
  await channel.stop();
  await assert.rejects(
    () => channel.sendMedia({ chatId: "wx-friend-1" }, [{ type: "text", text: "hi" }]),
    /先发一条消息/,
  );
});

test("manager:handleInbound 把 media 透传给 onRunTask", async () => {
  const { manager, tasks } = managerHarness();
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  const media = [{ kind: "image", filePath: "/tmp/x.png", fileName: "x.png", size: 10 }];
  await manager._handleInbound({ ...qqMessage("看图"), media });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].media, media);
});

test("manager:replyMedia 在适配器不支持时降级为文字说明", async () => {
  let captured = null;
  const harness = managerHarness({
    onRunTask: async (task) => {
      captured = task;
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  });
  await harness.manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await harness.manager._handleInbound(qqMessage("发个文件"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(captured, "应捕获到任务");
  await captured.replyMedia([
    { type: "text", text: "文件如下" },
    { type: "media", kind: "file", filePath: "/tmp/a.xlsx", fileName: "a.xlsx" },
  ]);
  // 测试 harness 的 adapter 没有 sendMedia → 降级为 sendText 文字说明
  assert.ok(harness.sentTexts.some((entry) => entry.text.includes("文件如下") && entry.text.includes("[a.xlsx]")));
});

// ---- 渠道公共模块（shared.mjs）：消除适配器互导，re-export 保持对外 API ----

test("shared 模块统一承载渠道公共纯函数,适配器不再互相依赖", async () => {
  const shared = await import("../electron/channels/shared.mjs");
  assert.equal(typeof shared.chunkText, "function");
  assert.equal(typeof shared.sniffImageExtension, "function");
  assert.equal(shared.MAX_MEDIA_BYTES, 50 * 1024 * 1024);
  assert.deepEqual(shared.chunkText("abc"), ["abc"]);
  assert.equal(shared.sniffImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), ".jpg");
});

test("QQ 客户端:sendMedia 的 msg_id 过期时去掉引用重发一次", async () => {
  const messageBodies = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    if (url.endsWith("/gateway")) {
      return { ok: true, json: async () => ({ url: "wss://sandbox.qq/ws" }) };
    }
    if (url.includes("/files")) {
      return { ok: true, json: async () => ({ file_info: "fi-1" }) };
    }
    if (url.includes("/v2/users/u1/messages")) {
      messageBodies.push(JSON.parse(options.body));
      if (messageBodies.length === 1) {
        return { ok: false, status: 400, json: async () => ({ message: "msg_id 不存在" }) };
      }
      return { ok: true, json: async () => ({ id: "out-2" }) };
    }
    return { ok: true, json: async () => ({ id: "out-1" }) };
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "a.png");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await client.sendMedia({ chatType: "dm", chatId: "u1", messageId: "m1" }, [
      { type: "media", kind: "image", filePath },
    ]);
    assert.equal(messageBodies.length, 2, "第一次失败后应去掉 msg_id 重发一次");
    assert.equal(messageBodies[0].msg_id, "m1");
    assert.equal(messageBodies[1].msg_id, undefined, "重试应去掉过期的消息引用");
    assert.equal(messageBodies[1].msg_seq, 2, "重试的 msg_seq 递增");
    assert.deepEqual(messageBodies[1].media, { file_info: "fi-1" }, "重试仍携带媒体 file_info");
  } finally {
    await client.stop();
  }
});

test("verifyChannelMediaPath 拒绝指向工作区外的快捷链接,正常文件放行", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-ws-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-outside-"));
  const secret = path.join(outside, "secret.txt");
  await fs.writeFile(secret, "top secret");
  // 软链接：工作区内的名字指向工作区外文件 → 应被拒绝
  const link = path.join(root, "leak.txt");
  try {
    await fs.symlink(secret, link);
  } catch {
    assert.ok(true, "跳过:当前环境不支持软链接");
    return;
  }
  const denied = await verifyChannelMediaPath(root, "leak.txt");
  assert.equal(denied.ok, false, "快捷链接应被拒绝");
  assert.match(denied.error, /工作区外/);
  // 正常文件放行
  const normal = path.join(root, "正常.txt");
  await fs.writeFile(normal, "ok");
  const allowed = await verifyChannelMediaPath(root, "正常.txt");
  assert.equal(allowed.ok, true);
  assert.equal(allowed.path, normal);
  // 目录穿越仍然被拒（字符串层校验）
  const traverse = await verifyChannelMediaPath(root, "../outside/secret.txt");
  assert.equal(traverse.ok, false);
  // 绝对路径仍然被拒
  const absolute = await verifyChannelMediaPath(root, secret);
  assert.equal(absolute.ok, false);
});

test("verifyChannelMediaPath 待写入路径(mustExist=false)只校验已存在祖先", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-ws-"));
  // 新文件尚不存在：其祖先在工作区内 → 放行
  const pending = await verifyChannelMediaPath(root, "output/语音.silk", { mustExist: false });
  assert.equal(pending.ok, true);
  // 已存在文件在 mustExist=false 下同样通过
  const existing = path.join(root, "已存在.txt");
  await fs.writeFile(existing, "x");
  const ok = await verifyChannelMediaPath(root, "已存在.txt", { mustExist: false });
  assert.equal(ok.ok, true);
  // 祖先本身是软链接指向工作区外 → 拒绝
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-outside-"));
  const aliasDir = path.join(root, "alias");
  try {
    await fs.symlink(outside, aliasDir);
  } catch {
    assert.ok(true, "跳过:当前环境不支持软链接");
    return;
  }
  const denied = await verifyChannelMediaPath(root, "alias/语音.silk", { mustExist: false });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /工作区外/);
});
