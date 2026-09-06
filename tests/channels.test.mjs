import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chunkText, createQqBotClient, normalizeQqEvent, normalizeQqMediaAttachment, parseApprovalReply } from "../electron/channels/qq-bot.mjs";
import { createWechatChannel, fetchWechatQrStatus, runWechatQrLogin, sniffImageExtension } from "../electron/channels/wechat.mjs";
import { chatKeyOf, createChannelManager, isNewSessionCommand, MAX_MEDIA_BYTES } from "../electron/channels/manager.mjs";
import { verifyChannelMediaPath } from "../electron/channels/media-tools.mjs";
import { isWorkspaceSwitchRequest, looksLikePathDirective, parseWorkspaceSwitch, resolveWorkspaceSwitch } from "../electron/channels/workspace.mjs";

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
  for (const text of ["拒绝", "不同意", "取消", "0", "n", "No"]) {
    assert.equal(parseApprovalReply(text), false, text);
  }
  // "2" 表示停止,由 manager 在待决审批时拦截,解析层返回 null
  for (const text of ["允许执行这个", "好吧", "", "12", "允许吧", "2"]) {
    assert.equal(parseApprovalReply(text), null, text);
  }
});

// ---- parseWorkspaceSwitch / resolveWorkspaceSwitch ----

test("parseWorkspaceSwitch:识别整条更换工作目录指令,忽略无关消息", () => {
  for (const text of [
    "请更换工作目录至xxx/xxx/xx/",
    "更换工作目录至/Users/me/project",
    "切换工作目录到 ./frontend",
    "把工作目录改为/opt/app",
    "设置工作目录为 \"My Docs/Project\"",
    "工作目录：/workspace/next",
    "切换到ai-learning目录",
    "切换到 /Users/me/project 目录",
    "把工作区切换到 ai-learning 目录",
    "切换至 frontend 文件夹",
    "切换到目录ai-learning",
    "把工作目录换到/Users/me/project",
  ]) {
    assert.ok(parseWorkspaceSwitch(text), text);
  }
  assert.equal(parseWorkspaceSwitch("请更换工作目录至xxx/xxx/xx/"), "xxx/xxx/xx/");
  assert.equal(parseWorkspaceSwitch("设置工作目录为 \"My Docs/Project\""), "My Docs/Project");
  assert.equal(parseWorkspaceSwitch("切换到ai-learning目录"), "ai-learning");
  assert.equal(parseWorkspaceSwitch("切换到 /Users/me/project 目录"), "/Users/me/project");
  assert.equal(parseWorkspaceSwitch("把工作区切换到 ai-learning 目录"), "ai-learning");
  assert.equal(parseWorkspaceSwitch("切换至 frontend 文件夹"), "frontend");
  assert.equal(parseWorkspaceSwitch("切换到目录ai-learning"), "ai-learning");
  assert.equal(looksLikePathDirective("xxx/xxx/xx/"), true);
  assert.equal(looksLikePathDirective("./frontend"), true);
  assert.equal(looksLikePathDirective("frontend"), false);
  for (const text of ["把项目的工作目录改成 frontend 后再构建", "随便聊聊工作目录", ""]) {
    assert.equal(parseWorkspaceSwitch(text), null, text);
  }
  // 任务正文里出现“切换”字样的普通消息不能被误拦截
  for (const text of ["把文件从 A 目录切换到 B 目录保存", "帮我看看工作目录在哪里", "切换到安全模式试试"]) {
    assert.equal(parseWorkspaceSwitch(text), null, text);
  }
});

test("isWorkspaceSwitchRequest:识别用户要求切换工作目录的说法", () => {
  for (const text of [
    "切换到ai-learning目录",
    "请帮我切换工作目录至 /Users/me/project",
    "把工作目录改成frontend",
    "帮我把工作区换到新项目",
  ]) {
    assert.equal(isWorkspaceSwitchRequest(text), true, text);
  }
  for (const text of ["今天天气怎么样", "把文件保存到 output 目录", ""]) {
    assert.equal(isWorkspaceSwitchRequest(text), false, text);
  }
});

test("resolveWorkspaceSwitch:绝对/相对/~/不存在目录", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-channel-ws-"));
  const target = path.join(root, "sub");
  await fs.mkdir(target);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  // macOS 上 /var 是 /private/var 的软链接，realpath 后路径会带 /private 前缀
  const realRoot = await fs.realpath(root);
  const realTarget = path.join(realRoot, "sub");
  assert.equal((await resolveWorkspaceSwitch(root, "")).path, realRoot);
  assert.equal((await resolveWorkspaceSwitch("sub", root)).path, realTarget);
  assert.equal((await resolveWorkspaceSwitch("./sub/", root)).path, realTarget);
  const notFound = await resolveWorkspaceSwitch(path.join(root, "missing"), root);
  assert.equal(notFound.ok, false);
  assert.match(notFound.error, /没有找到这个文件夹/);
  const relativeWithoutBase = await resolveWorkspaceSwitch("sub", "");
  assert.equal(relativeWithoutBase.ok, false);
  assert.match(relativeWithoutBase.error, /绝对路径/);
});

test("manager:updateChatWorkspaceBySession 同步电脑端更换的工作区", async () => {
  const chatsFile = {
    value: {
      [chatKeyOf("qq", "u1")]: {
        sessionId: "s-qq-1",
        workspacePath: "/old/a",
        title: "QQ·张三",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
      [chatKeyOf("qq", "u2")]: {
        sessionId: "s-qq-2",
        workspacePath: "/old/b",
        title: "QQ·李四",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    },
  };
  const manager = createChannelManager({
    readChats: async () => chatsFile.value,
    writeChats: async (chats) => { chatsFile.value = chats; },
  });
  const changed = await manager.updateChatWorkspaceBySession("s-qq-1", "/new/a");
  assert.equal(changed, true);
  assert.equal(chatsFile.value[chatKeyOf("qq", "u1")].workspacePath, "/new/a");
  assert.equal(chatsFile.value[chatKeyOf("qq", "u2")].workspacePath, "/old/b", "其他会话不受影响");
  // 找不到对应会话时返回 false 且不写盘
  const missing = await manager.updateChatWorkspaceBySession("s-none", "/x");
  assert.equal(missing, false);
  assert.equal(chatsFile.value[chatKeyOf("qq", "u1")].workspacePath, "/new/a");
  // 空路径 = 清除工作区（桌面端“移除工作目录”的语义）
  await manager.updateChatWorkspaceBySession("s-qq-2", "");
  assert.equal(chatsFile.value[chatKeyOf("qq", "u2")].workspacePath, "");
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

// QQ 富媒体分片上传链路 mock：upload_prepare → 预签名 PUT → upload_part_finish → /files 合并
function qqMediaUploadHarness({ failUploadPrepare = null, failFirstMessage = false } = {}) {
  const calls = [];
  let messageAttempts = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    if (url.endsWith("/gateway")) {
      return { ok: true, json: async () => ({ url: "wss://sandbox.qq/ws" }) };
    }
    if (url.startsWith("https://cos.test/")) {
      return { ok: true, text: async () => "", json: async () => ({}) };
    }
    if (url.includes("/upload_prepare")) {
      if (failUploadPrepare) {
        return { ok: false, status: 403, json: async () => ({ message: failUploadPrepare }) };
      }
      return {
        ok: true,
        json: async () => ({
          upload_id: "up-1",
          block_size: "4",
          parts: [
            { index: 0, presigned_url: "https://cos.test/part0", block_size: "4" },
            { index: 1, presigned_url: "https://cos.test/part1", block_size: "4" },
          ],
          upload_config: {},
        }),
      };
    }
    if (url.includes("/upload_part_finish")) {
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes("/files")) {
      return { ok: true, json: async () => ({ file_info: "fi-1" }) };
    }
    if (url.includes("/messages")) {
      messageAttempts += 1;
      if (failFirstMessage && messageAttempts === 1) {
        return { ok: false, status: 400, json: async () => ({ message: "msg_id 不存在" }) };
      }
      return { ok: true, json: async () => ({ id: "out-1" }) };
    }
    return { ok: true, json: async () => ({ id: "out-1" }) };
  };
  return { calls, fetchImpl };
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

test("微信渠道:Bot 启动完成后状态为已连接,不被启动时的连接中覆盖", async () => {
  const { factory } = fakeBotClass();
  const statuses = [];
  const channel = createWechatChannel({
    token: "bt-1", userId: "wxu-1",
    createBotImpl: factory,
    onStatus: (entry) => statuses.push(entry),
  });
  await channel.start();
  assert.equal(statuses.at(-1).status, "online", "启动完成后的最后状态应为已连接");
  await channel.stop();
});

test("微信渠道:会话过期(errcode -14)自动清凭据并重新扫码登录", async () => {
  const { instances, factory } = fakeBotClass();
  const statuses = [];
  const saved = [];
  let cleared = 0;
  const channel = createWechatChannel({
    token: "bt-old", userId: "wxu-1",
    createBotImpl: factory,
    onStatus: (entry) => statuses.push(entry),
    onLogin: async (credentials) => { saved.push(credentials); },
    onSessionExpired: async () => { cleared += 1; },
    fetchImpl: async (url) => {
      if (url.includes("get_bot_qrcode")) {
        return { ok: true, json: async () => ({ qrcode: "qr-2", qrcode_img_content: "https://qr.img/2.png" }) };
      }
      return { ok: true, json: async () => ({ status: "confirmed", bot_token: "bt-new", ilink_user_id: "wxu-1" }) };
    },
  });
  await channel.start();
  assert.equal(instances.length, 1);
  const first = instances[0];
  first.handlers.error(new Error("session expired (errcode -14), paused for 60 min"));
  // 暂停期内的重复错误事件不应叠出第二个扫码流程
  first.handlers.error(new Error("session expired (errcode -14), paused for 60 min"));
  // 等自动重登完成:清凭据 → 二维码 → confirmed → 新 Bot
  for (let i = 0; i < 100 && instances.length < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(cleared, 1, "失效凭据只清一次");
  assert.deepEqual(saved.map((item) => item.token), ["bt-new"], "重登成功后落盘新凭据");
  assert.equal(instances.length, 2, "重登后创建新 Bot");
  assert.equal(instances[1].options.token, "bt-new");
  assert.ok(statuses.some((entry) => entry.status === "awaiting-scan" && entry.detail.includes("已过期")), "状态提示重新扫码");
  assert.ok(!statuses.some((entry) => entry.status === "error" && entry.detail.includes("errcode")), "不再把 SDK 原始报错写进状态栏");
  assert.equal(statuses.at(-1).status, "online");
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
  const typingCalls = [];
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
    sendTyping: async (chat) => { typingCalls.push(chat.chatId); },
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
  return { manager, adapter, sentTexts, typingCalls, tasks, resolves, chatsFile };
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

test("manager:异步 defaultWorkspace 被等待,新建聊天不把 Promise 落盘", async () => {
  const { manager, chatsFile } = managerHarness({ defaultWorkspace: async () => "/async-ws" });
  await manager._handleInbound(qqMessage("你好", "u-new"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const record = chatsFile.value[chatKeyOf("qq", "u-new")];
  assert.equal(typeof record.workspacePath, "string");
  assert.equal(record.workspacePath, "/async-ws");
});

test("manager:历史脏 workspacePath(对象/空值)在下一条消息时自动补全", async () => {
  const chatsFile = {
    value: {
      [chatKeyOf("qq", "u1")]: {
        sessionId: "s-dirty",
        workspacePath: {},
        title: "QQ·张三",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    },
  };
  const { manager, tasks } = managerHarness({
    readChats: async () => chatsFile.value,
    writeChats: async (chats) => { chatsFile.value = chats; },
    defaultWorkspace: async () => "/healed-ws",
  });
  await manager._handleInbound(qqMessage("继续", "u1"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(chatsFile.value[chatKeyOf("qq", "u1")].workspacePath, "/healed-ws");
  assert.equal(tasks[0].chatRecord.workspacePath, "/healed-ws");
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

test("manager:同一 messageId 的事件重复到达时只处理一次", async () => {
  const { manager, tasks } = managerHarness();
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  const message = qqMessage("网关补发测试", "u1");
  await manager._handleInbound(message);
  // 模拟断线重连后网关补发同一条事件
  await manager._handleInbound({ ...message });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tasks.length, 1, "重复事件不应再次入队执行");
});

test("manager:头部任务卡住时排队数递增,头部结束后队列按序清空", async () => {
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  let releaseB;
  const gateB = new Promise((resolve) => { releaseB = resolve; });
  const started = [];
  const { manager, sentTexts } = managerHarness({
    onRunTask: async (task) => {
      started.push(task.text);
      if (task.text === "A") await gateA;
      if (task.text === "B") await gateB;
    },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager._handleInbound(qqMessage("A"));
  await manager._handleInbound(qqMessage("B"));
  await manager._handleInbound(qqMessage("C"));
  await new Promise((resolve) => setImmediate(resolve));
  // 头部 A 未结束时,B/C 收到排队提示且数字递增(这正是用户看到的现象)
  assert.deepEqual(started, ["A"]);
  const notices = sentTexts.filter((entry) => entry.text.includes("排队中")).map((entry) => entry.text);
  assert.equal(notices.length, 2);
  assert.match(notices[0], /前面还有 1 个任务/);
  assert.match(notices[1], /前面还有 2 个任务/);
  // 头部结束后,队列按序消化,不再永久堆积
  releaseA();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ["A", "B"]);
  releaseB();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ["A", "B", "C"]);
  // 队列清空后,再发消息不再收到排队提示
  sentTexts.length = 0;
  await manager._handleInbound(qqMessage("D"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(started, ["A", "B", "C", "D"]);
  assert.ok(!sentTexts.some((entry) => entry.text.includes("排队中")));
});

test("manager:待决期间,有效决议直接处理不进任务;无效回复被拦截提示", async () => {
  const { manager, tasks, resolves, sentTexts, typingCalls } = managerHarness();
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  manager._pendingByChat.set(chatKeyOf("qq", "u1"), { itemId: "inbox-1", kind: "approval" });
  await manager._handleInbound(qqMessage("允许"));
  assert.deepEqual(resolves, ["允许"]);
  assert.equal(tasks.length, 0);
  assert.equal(manager._pendingByChat.size, 0);
  // 决议后不再回文字确认,改用「正在输入」提示
  assert.ok(!sentTexts.some((entry) => entry.text.includes("继续执行")));
  assert.deepEqual(typingCalls, ["u1"]);

  manager._pendingByChat.set(chatKeyOf("qq", "u1"), { itemId: "inbox-2", kind: "approval" });
  await manager._handleInbound(qqMessage("随便说点别的"));
  assert.equal(tasks.length, 0, "无效回复不能变成新任务");
  assert.equal(manager._pendingByChat.size, 1, "仍保持待决");
  assert.ok(sentTexts.some((entry) => entry.text.includes("1（允许）或 0（拒绝）")));
});

test("manager:「停止」清空排队消息并通知 main 中止执行中任务", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const stops = [];
  const { manager, sentTexts } = managerHarness({
    onRunTask: async (task) => { started.push(task.text); if (task.text === "任务A") await gate; },
    onStopChat: async ({ key, pending }) => { stops.push({ key, pending }); return true; },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager._handleInbound(qqMessage("任务A"));
  await manager._handleInbound(qqMessage("任务B"));
  await manager._handleInbound(qqMessage("任务C"));
  await new Promise((resolve) => setImmediate(resolve));
  await manager._handleInbound(qqMessage("停止"));
  assert.equal(stops.length, 1);
  assert.equal(stops[0].key, chatKeyOf("qq", "u1"));
  assert.equal(stops[0].pending, null);
  assert.ok(sentTexts.some((entry) => entry.text.includes("已中止正在执行的任务") && entry.text.includes("已清空 2 条排队消息")));
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(started, ["任务A"], "B/C 已被停止清空,轮到时应直接跳过");
  // 停止之后新消息照常入队执行（队列代数只作废旧消息）
  await manager._handleInbound(qqMessage("任务D"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(started, ["任务A", "任务D"]);
});

test("manager:待决期间「停止」优先于审批决议,取消待决并中止任务", async () => {
  const stops = [];
  const { manager, resolves, sentTexts } = managerHarness({
    onStopChat: async ({ pending }) => { stops.push(pending); return true; },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  manager._pendingByChat.set(chatKeyOf("qq", "u1"), { itemId: "inbox-9", kind: "approval" });
  await manager._handleInbound(qqMessage("停止"));
  assert.deepEqual(resolves, [], "停止不能被当成审批决议文本");
  assert.equal(stops.length, 1);
  assert.equal(stops[0]?.itemId, "inbox-9");
  assert.equal(manager._pendingByChat.size, 0, "停止同时清掉待决状态");
  assert.ok(sentTexts.some((entry) => entry.text.includes("已取消待处理的审批/提问")));
});

test("manager:审批待决时「2」等同停止,取消待决并中止任务", async () => {
  const stops = [];
  const { manager, resolves, tasks } = managerHarness({
    onStopChat: async ({ pending }) => { stops.push(pending); return true; },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  manager._pendingByChat.set(chatKeyOf("qq", "u1"), { itemId: "inbox-10", kind: "approval" });
  await manager._handleInbound(qqMessage("2"));
  assert.deepEqual(resolves, [], "「2」不能进入审批决议解析");
  assert.equal(stops.length, 1);
  assert.equal(stops[0]?.itemId, "inbox-10");
  assert.equal(manager._pendingByChat.size, 0);
  assert.equal(tasks.length, 0);
});

test("manager:提问待决时「2」仍是选项回复,无待决时是正常任务输入", async () => {
  const stops = [];
  const { manager, resolves, tasks } = managerHarness({
    onStopChat: async () => { stops.push(true); return true; },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  // 提问待决:「2」交给决议处理(选项序号),不触发停止
  manager._pendingByChat.set(chatKeyOf("qq", "u1"), { itemId: "q-1", kind: "question" });
  await manager._handleInbound(qqMessage("2"));
  assert.deepEqual(resolves, ["2"]);
  assert.equal(stops.length, 0);
  // 模拟提问被决议后清掉待决(真实接线里 main 的 onResolvePending 会返回 true)
  manager._pendingByChat.delete(chatKeyOf("qq", "u1"));
  // 无任何待决:「2」是正常任务输入(换一个消息 ID,避免与上面那条去重)
  await manager._handleInbound({ ...qqMessage("2"), messageId: "m-2-second" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, "2");
  assert.equal(stops.length, 0);
});

test("manager:没有任务时「停止」如实反馈", async () => {
  const { manager, sentTexts } = managerHarness();
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager._handleInbound(qqMessage("停止"));
  assert.ok(sentTexts.some((entry) => entry.text.includes("没有执行中或排队")));
});

test("安全扫描 2026-09-05:群聊待决审批绑定发起人,其他成员不能代为决议", async () => {
  const resolves = [];
  const groupMessage = (text, userId, messageId) => ({
    channel: "qq", chatType: "group", chatId: "g1", userId, userName: userId === "owner" ? "发起人" : "其他成员", text, messageId,
  });
  const { manager, sentTexts } = managerHarness({
    // 模拟真实接线:任务执行中挂起审批,registerPending 由 manager 绑定发起人
    onRunTask: async (task) => { task.registerPending({ itemId: "inbox-g1", kind: "approval" }); },
    onResolvePending: async (payload) => { resolves.push(payload); return true; },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  // 发起人在群里下发任务,任务挂起审批
  await manager._handleInbound(groupMessage("整理文件", "owner", "m-g1-1"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(manager._pendingByChat.size, 1);
  // 同群其他成员回复「1」:不能代替发起人决议审批
  await manager._handleInbound(groupMessage("1", "someone-else", "m-g1-2"));
  assert.equal(resolves.length, 0, "其他成员的回复不能进入审批决议处理");
  assert.equal(manager._pendingByChat.size, 1, "待决状态保持");
  assert.ok(sentTexts.some((entry) => entry.text.includes("只有发起人")));
  // 发起人本人回复「1」:正常决议,且决议回调带上发送者身份
  await manager._handleInbound(groupMessage("1", "owner", "m-g1-3"));
  assert.equal(resolves.length, 1);
  assert.equal(resolves[0].replyText, "1");
  assert.equal(resolves[0].userId, "owner", "决议回调包含发送者身份");
  assert.equal(resolves[0].userName, "发起人");
  assert.equal(manager._pendingByChat.size, 0);
  // 决议完成后,其他成员的消息恢复正常任务语义（文本避开「新任务」等新建会话指令词）
  const tasks2 = [];
  const manager2info = managerHarness({
    onRunTask: async (task) => { tasks2.push(task.chat.userId); },
  });
  await manager2info.manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager2info.manager._handleInbound(groupMessage("帮忙查资料", "someone-else", "m-g1-4"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(tasks2, ["someone-else"], "无待决时其他成员消息照常入队");
});

test("manager:排队提示附带阻塞原因与停止说明", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { manager, sentTexts } = managerHarness({
    onRunTask: async (task) => { if (task.text === "任务A") await gate; },
    queueWaitHint: () => "电脑端有任务正在执行",
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager._handleInbound(qqMessage("任务A"));
  await manager._handleInbound(qqMessage("任务B"));
  await new Promise((resolve) => setImmediate(resolve));
  const notice = sentTexts.find((entry) => entry.text.includes("排队中"));
  assert.ok(notice, "应当发出排队提示");
  assert.ok(notice.text.includes("电脑端有任务正在执行"), "提示里要说明在等什么");
  assert.ok(notice.text.includes("停止"), "提示里要告知脱身方式");
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("isNewSessionCommand: 识别新建会话/新任务/重置指令,忽略普通消息", () => {
  for (const text of [
    "/new",
    "/NEW",
    "new",
    "NEW",
    "/reset",
    "reset",
    "#new",
    "新建会话",
    "新建会话。",
    "新会话",
    "新任务！",
    "重置会话",
    "重置对话",
    "清空上下文",
  ]) {
    assert.equal(isNewSessionCommand(text), true, text);
  }
  for (const text of [
    "新建会话并帮我写个网页",
    "这是个新任务：帮我查天气",
    "怎么重置会话？",
    "new feature idea",
    "hello",
    "",
  ]) {
    assert.equal(isNewSessionCommand(text), false, text);
  }
});

test("manager: 发送 /new 或 新建会话 重置 sessionId 并回复确认", async () => {
  const { manager, sentTexts, tasks, chatsFile } = managerHarness();
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });

  // 1. 先发第一条任务，生成会话 1
  await manager._handleInbound(qqMessage("任务1"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tasks.length, 1);
  const oldSessionId = tasks[0].chatRecord.sessionId;
  assert.ok(oldSessionId);

  // 2. 发送 /new 指令
  await manager._handleInbound(qqMessage("/new"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  // /new 不应产生新任务
  assert.equal(tasks.length, 1);
  // 应向用户回复确认文案
  const reply = sentTexts.find((entry) => entry.text.includes("已为你开启新会话"));
  assert.ok(reply, "应当回复新会话开启提示");

  // 3. 验证 channel-chats.json 中的 sessionId 已被更新，工作区保持不变
  const newRecord = chatsFile.value[chatKeyOf("qq", "u1")];
  assert.notEqual(newRecord.sessionId, oldSessionId, "sessionId 应当已更换为新 UUID");
  assert.equal(newRecord.workspacePath, "/tmp/ws", "工作区应当保持不变");

  // 4. 发送下一条任务，验证使用新的 sessionId
  await manager._handleInbound(qqMessage("任务2"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tasks.length, 2);
  assert.equal(tasks[1].chatRecord.sessionId, newRecord.sessionId);
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

test("QQ 客户端:sendMedia 先分片上传拿 file_info 再以 msg_type=7 发送", async () => {
  const { calls, fetchImpl } = qqMediaUploadHarness();
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "图.png");
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.writeFile(filePath, content);
    await client.sendMedia({ chatType: "dm", chatId: "u1", messageId: "m1" }, [
      { type: "media", kind: "image", filePath, fileName: "图.png" },
    ]);
    const prepare = calls.find((call) => call.url.includes("/v2/users/u1/upload_prepare"));
    assert.ok(prepare, "应先调用预上传接口");
    const prepareBody = JSON.parse(prepare.options.body);
    assert.equal(prepareBody.file_type, 1, "图片对应 file_type=1");
    assert.equal(prepareBody.file_size, "8", "file_size 应为字符串字节数");
    assert.equal(prepareBody.file_name, "图.png");
    assert.match(prepareBody.md5, /^[0-9a-f]{32}$/);
    assert.match(prepareBody.sha1, /^[0-9a-f]{40}$/);
    assert.equal(prepareBody.md5_10m, prepareBody.md5, "小于 10MB 时 md5_10m 与全文件 md5 一致");

    const puts = calls.filter((call) => call.url.startsWith("https://cos.test/") && call.options.method === "PUT");
    assert.equal(puts.length, 2, "应按两个分片分别 PUT 预签名地址");
    assert.deepEqual([...puts[0].options.body], [...content.subarray(0, 4)]);
    assert.deepEqual([...puts[1].options.body], [...content.subarray(4)]);

    const finishes = calls.filter((call) => call.url.includes("/upload_part_finish"));
    assert.equal(finishes.length, 2, "每个分片完成后都应通知服务端");
    const finish0 = JSON.parse(finishes[0].options.body);
    assert.equal(finish0.upload_id, "up-1");
    assert.equal(finish0.part_index, 0);
    assert.equal(finish0.block_size, "4");
    assert.equal(finish0.md5, createHash("md5").update(content.subarray(0, 4)).digest("hex"));
    const finish1 = JSON.parse(finishes[1].options.body);
    assert.equal(finish1.part_index, 1);
    assert.equal(finish1.md5, createHash("md5").update(content.subarray(4)).digest("hex"));

    const merged = calls.find((call) => call.url.includes("/v2/users/u1/files"));
    assert.ok(merged, "分片完成后应调用 files 接口合并");
    const mergedBody = JSON.parse(merged.options.body);
    assert.equal(mergedBody.file_type, 1);
    assert.equal(mergedBody.srv_send_msg, false, "合并只拿 file_info,不占用主动消息频次");
    assert.equal(mergedBody.upload_id, "up-1");
    assert.equal(mergedBody.file_name, "图.png");

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
  const { calls, fetchImpl } = qqMediaUploadHarness();
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "doc.pdf");
    await fs.writeFile(filePath, Buffer.from("%PDF-1.4"));
    await client.sendMedia({ chatType: "group", chatId: "g1", messageId: "m9" }, [
      { type: "media", kind: "file", filePath, fileName: "doc.pdf" },
    ]);
    const prepare = calls.find((call) => call.url.includes("/v2/groups/g1/upload_prepare"));
    assert.ok(prepare, "群聊预上传应走 groups 接口");
    assert.equal(JSON.parse(prepare.options.body).file_type, 4, "文件对应 file_type=4");
    assert.ok(calls.some((call) => call.url.includes("/v2/groups/g1/upload_part_finish")), "群聊分片完成应走 groups 接口");
    const merged = calls.find((call) => call.url.includes("/v2/groups/g1/files"));
    assert.ok(merged, "群聊合并应走 groups 接口");
    const post = calls.find((call) => call.url.includes("/v2/groups/g1/messages"));
    assert.equal(JSON.parse(post.options.body).msg_type, 7);
  } finally {
    await client.stop();
  }
});

test("QQ 客户端:sendMedia 上传 4xx 时抛错并带服务端原因", async () => {
  const { fetchImpl } = qqMediaUploadHarness({ failUploadPrepare: "file_type 未开放" });
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "a.png");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await assert.rejects(
      () => client.sendMedia({ chatType: "dm", chatId: "u1" }, [{ type: "media", kind: "file", filePath }]),
      /file_type 未开放/,
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
  for (let i = 0; i < 20 && received.length < 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
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
  for (let i = 0; i < 20 && received.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
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

test("微信渠道:sendTyping 把输入状态转发给最近会话", async () => {
  const { instances, factory } = fakeBotClass();
  const channel = createWechatChannel({ token: "bt-1", userId: "wxu-1", createBotImpl: factory });
  await channel.start();
  const bot = instances.at(-1);
  let typingCalls = 0;
  bot.handlers.message({
    fromUserId: "wx-friend-1",
    message: { kind: "text", text: "hi", id: "mm1" },
    reply: async () => ({}),
    sendTyping: async () => { typingCalls += 1; },
  });
  await channel.sendTyping({ chatId: "wx-friend-1" });
  assert.equal(typingCalls, 1, "应向最近会话发送正在输入状态");
  await channel.stop();
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

test("manager:任务执行器收到 sendTyping 并转发给适配器", async () => {
  let capturedTyping = null;
  const { manager, typingCalls } = managerHarness({
    onRunTask: async (task) => {
      capturedTyping = task.sendTyping;
    },
  });
  await manager.reconcile({ qq: { enabled: true, appId: "a", appSecret: "s" } });
  await manager._handleInbound(qqMessage("开始干活"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(typeof capturedTyping, "function", "任务执行器应收到 sendTyping");
  await capturedTyping();
  assert.deepEqual(typingCalls, ["u1"], "sendTyping 应转发到当前会话适配器");
});

test("manager:微信适配器收到注入的 stateRoot,避免 SDK 落到系统根目录", async () => {
  let captured = null;
  const wechatAdapter = {
    start: async () => { },
    stop: async () => { },
    sendText: async () => { },
  };
  const { manager } = managerHarness({
    wechatStateRoot: "/tmp/dyworker-wx-state",
    createWechat: (opts) => {
      captured = opts;
      return wechatAdapter;
    },
  });
  await manager.reconcile({ wechat: { enabled: true, token: "t", userId: "u" } });
  assert.ok(captured, "微信启用时应创建适配器");
  assert.equal(captured.stateRoot, "/tmp/dyworker-wx-state", "状态目录应透传 SDK 而不是用当前工作目录");
  await manager.reconcile({});
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
  const { calls, fetchImpl } = qqMediaUploadHarness({ failFirstMessage: true });
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-qq-media-"));
    const filePath = path.join(tmp, "a.png");
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await client.sendMedia({ chatType: "dm", chatId: "u1", messageId: "m1" }, [
      { type: "media", kind: "image", filePath },
    ]);
    const messageBodies = calls
      .filter((call) => call.url.includes("/v2/users/u1/messages"))
      .map((call) => JSON.parse(call.options.body));
    assert.equal(messageBodies.length, 2, "第一次失败后应去掉 msg_id 重发一次");
    assert.equal(messageBodies[0].msg_id, "m1");
    assert.equal(messageBodies[1].msg_id, undefined, "重试应去掉过期的消息引用");
    assert.equal(messageBodies[1].msg_seq, 2, "重试的 msg_seq 递增");
    assert.deepEqual(messageBodies[1].media, { file_info: "fi-1" }, "重试仍携带媒体 file_info");
  } finally {
    await client.stop();
  }
});

test("QQ 客户端:API 请求挂起时按超时中止,不会永久卡住任务", async () => {
  // 发送接口挂起:不返回响应,只有 signal abort 才 reject(模拟 QQ 网关偶发无响应)
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener?.("abort", () => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket, timeoutMs: 60 });
  await assert.rejects(
    client.sendText({ chatId: "u1", chatType: "dm", messageId: "m1" }, "你好"),
    (error) => error instanceof Error && /超时/.test(error.message),
  );
  await client.stop();
});

test("QQ 客户端:发送超时后绝不重发,避免同一内容在 QQ 里重复显示", async () => {
  // 超时是状态未知错误:服务端可能已投递。旧逻辑对任何错误都重发一次,导致消息重复。
  let messageCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    if (url.includes("/messages")) {
      messageCalls += 1;
    }
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener?.("abort", () => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket, timeoutMs: 60 });
  await assert.rejects(
    client.sendText({ chatId: "u1", chatType: "dm", messageId: "m1" }, "你好"),
    (error) => error instanceof Error && /超时/.test(error.message),
  );
  assert.equal(messageCalls, 1, "超时后不应去掉 msg_id 重发第二次");
  await client.stop();
});

test("QQ 客户端:网络层错误(连接中断)同样不重发", async () => {
  let messageCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    messageCalls += 1;
    throw new TypeError("fetch failed");
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  await assert.rejects(client.sendText({ chatId: "u1", chatType: "dm", messageId: "m1" }, "你好"));
  assert.equal(messageCalls, 1, "网络错误后不应重发第二次");
  await client.stop();
});

test("QQ 客户端:sendText 的 msg_id 业务错误(明确拒绝)仍会去掉引用重发一次", async () => {
  const { fetchImpl } = qqFetchHarness();
  const messageBodies = [];
  let failed = false;
  const wrappedFetch = async (url, options) => {
    if (url.includes("/messages")) {
      messageBodies.push(JSON.parse(options.body));
      if (!failed) {
        failed = true;
        return { ok: false, status: 400, json: async () => ({ message: "msg_id 不存在" }) };
      }
    }
    return fetchImpl(url, options);
  };
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl: wrappedFetch, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    await client.sendText({ chatId: "u1", chatType: "dm", messageId: "m1" }, "你好");
    assert.equal(messageBodies.length, 2, "明确的业务拒绝才重发");
    assert.equal(messageBodies[0].msg_id, "m1");
    assert.equal(messageBodies[1].msg_id, undefined, "重试应去掉过期的消息引用");
    assert.equal(messageBodies[1].msg_seq, 2, "重试的 msg_seq 递增");
  } finally {
    await client.stop();
  }
});

test("QQ 客户端:access_token 请求挂起时按超时中止", async () => {
  const fetchImpl = async () => new Promise(() => { });
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket, timeoutMs: 40 });
  await assert.rejects(
    client.sendText({ chatId: "u1", chatType: "dm" }, "你好"),
    (error) => error instanceof Error && /access_token 获取超时/.test(error.message),
  );
  await client.stop();
});

test("QQ 客户端:sendTyping 私聊发输入状态,群聊静默跳过", async () => {
  const { calls, fetchImpl } = qqFetchHarness();
  const client = createQqBotClient({ appId: "a", appSecret: "s", fetchImpl, webSocketImpl: FakeWebSocket });
  try {
    await client.start();
    await client.sendTyping({ chatType: "dm", chatId: "u1" });
    const typing = calls.find((call) => call.url.includes("/v2/users/u1/messages"));
    assert.ok(typing, "私聊应调用消息接口发输入状态");
    const body = JSON.parse(typing.options.body);
    assert.equal(body.msg_type, 6);
    assert.deepEqual(body.input_notify, { input_type: 1, input_second: 60 });

    const before = calls.length;
    await client.sendTyping({ chatType: "group", chatId: "g1" });
    assert.equal(calls.length, before, "群聊不支持输入状态,应静默跳过");
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
