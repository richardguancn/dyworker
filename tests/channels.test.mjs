import assert from "node:assert/strict";
import test from "node:test";

import { chunkText, createQqBotClient, normalizeQqEvent, parseApprovalReply } from "../electron/channels/qq-bot.mjs";
import { createWechatChannel, fetchWechatQrStatus, runWechatQrLogin } from "../electron/channels/wechat.mjs";
import { chatKeyOf, createChannelManager } from "../electron/channels/manager.mjs";

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
  await client.stop();
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

  // 图片等类型不进入任务流,回一句提示
  bot.handlers.message({ fromUserId: "wx-friend-1", message: { kind: "image", id: "mm3" }, reply: ctx.reply });
  assert.equal(received.length, 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(replies.some((text) => text.includes("只支持文字")));

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
