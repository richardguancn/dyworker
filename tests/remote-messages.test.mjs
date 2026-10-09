import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInstallationClient } from "../electron/telemetry.mts";
import { createRemoteMessagesManager, createSseParser, quietHoursActive } from "../electron/remote-messages.mts";

// 运营消息中心集成测试：补拉/游标/去重/撤回/回执/通知约束/SSE（方案 §6）。

function startMockServer() {
  const state = {
    messages: [],
    revocations: [],
    resyncCursor: null,
    receipts: [],
    sseWriters: [],
    streamRequests: [],
    pulls: 0,
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {}
      const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
      const send = (payload, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method === "GET" && url.pathname === "/api/v1/dyworker/messages") {
        state.pulls += 1;
        const cursor = url.searchParams.get("cursor") || "";
        return send({
          code: 0,
          data: {
            items: state.messages.map((m) => ({...m, revoked: state.revocations.some((r) => r.message_id === m.message_id)})),
            resync: state.resyncCursor === cursor,
            cursor: cursor ? `cursor-2` : "cursor-1",
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/api/v1/dyworker/messages/receipts") {
        state.receipts.push(...(parsed?.receipts || []));
        return send({ code: 0, data: { results: (parsed?.receipts || []).map((receipt) => ({ message_id: receipt.message_id, status: "ok" })) } });
      }
      if (req.method === "GET" && url.pathname === "/api/v1/dyworker/messages/stream") {
        state.streamRequests.push({ authorization: req.headers.authorization || "", url: req.url });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(": connected\n\n");
        state.sseWriters.push(res);
        res.on("close", () => {
          state.sseWriters = state.sseWriters.filter((writer) => writer !== res);
        });
        return; // 保持连接，由测试控制写入
      }
      send({ code: 404, message: "not found" }, 404);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port }));
  });
}

function makeManager(file, port, options = {}) {
  const client = createInstallationClient();
  client.configure(`http://127.0.0.1:${port}`);
  client.setToken("device-token");
  return createRemoteMessagesManager({
    file,
    client,
    pollIntervalMs: 60_000,
    ...options,
  });
}

async function tmpFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-messages-"));
  return { file: path.join(dir, name), dir };
}

// 本地 socket 往返在整套并行测试（node --test 按核并发、重文件抢占 CPU）下可能被延迟数秒，
// 3 秒预算在满载机器上偶发超时：统一放宽到 10 秒，只加时间余量，不放松任何断言
async function waitFor(condition, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return await condition();
}

test("SSE 解析：事件/数据/注释心跳/retry 字段", () => {
  const seen = [];
  const parser = createSseParser((event) => seen.push(event));
  parser.feed(": heartbeat\n\n");
  parser.feed("event: new-message\n");
  parser.feed("data: {\"hint\":1}\n");
  parser.feed("id: 42\n\n");
  parser.feed("data: line1\ndata: line2\n\n");
  parser.feed("retry: 5000\n\n");
  parser.feed("event: partial"); // 未结束的事件缓存在缓冲区，不吐出
  assert.deepEqual(seen, [
    { event: "new-message", data: '{"hint":1}', id: "42" },
    { event: "message", data: "line1\nline2", id: "" },
  ]);
  // 只有 data 行的事件才派发（SSE 规范）；retry 字段记录在解析器上
  assert.equal(parser.retryMs, 5000);
});

test("免打扰时段：跨零点与非法输入", () => {
  assert.equal(quietHoursActive("22:00-08:00", new Date(2026, 8, 28, 23, 30)), true);
  assert.equal(quietHoursActive("22:00-08:00", new Date(2026, 8, 28, 6, 0)), true);
  assert.equal(quietHoursActive("22:00-08:00", new Date(2026, 8, 28, 12, 0)), false);
  assert.equal(quietHoursActive("12:00-13:30", new Date(2026, 8, 28, 13, 0)), true);
  assert.equal(quietHoursActive("bad", new Date()), false);
});

test("补拉：新消息入库、按 message_id 去重、游标推进并与消息一并落盘", async () => {
  const mock = await startMockServer();
  const { file, dir } = await tmpFile("system-messages.json");
  try {
    mock.state.messages.push({
      message_id: "m1",
      category: "announcement",
      title: "第一条公告",
      body: "内容 A",
      link: "https://example.com/a",
      published_at: "2026-09-28T02:00:00Z",
    });
    const manager = makeManager(file, mock.port);
    await manager.configure({ messagesEnabled: true, notifyNewMessages: false, dailyPopupLimit: 0 });
    const result = await manager.pull("test");
    assert.equal(result.ok, true);
    const messages = await manager.listMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].title, "第一条公告");
    assert.equal((await manager.status()).cursor, "cursor-1");

    // 同一条消息重复下发：不重复入库，本地回执状态不倒退
    mock.state.messages.push({
      message_id: "m1",
      category: "announcement",
      title: "第一条公告",
      body: "内容 A",
      link: "",
      published_at: "2026-09-28T02:00:00Z",
    });
    await manager.pull("test");
    assert.equal((await manager.listMessages()).length, 1);
    // 游标推进与本地消息保存一并持久化到同一文件
    const stored = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(stored.cursor, "cursor-2");
    assert.equal(stored.messages.length, 1);
    manager.stop();
  } finally {
    await mock.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("撤回与过期：撤回消息不再弹通知，列表中标记已撤回", async () => {
  const mock = await startMockServer();
  const { file, dir } = await tmpFile("system-messages.json");
  const notifications = [];
  try {
    mock.state.messages.push({
      message_id: "m-revoke",
      category: "announcement",
      title: "即将撤回",
      body: "内容",
      published_at: "2026-09-28T02:00:00Z",
    });
    const manager = makeManager(file, mock.port, {
      showNotification: (message) => notifications.push(message.message_id),
    });
    await manager.configure({ messagesEnabled: true, notifyNewMessages: true, dailyPopupLimit: 5 });
    await manager.pull("test");
    assert.deepEqual(notifications, ["m-revoke"]);
    // 服务端随后撤回该消息
    mock.state.revocations.push({ message_id: "m-revoke" });
    mock.state.messages.push({
      message_id: "m-late",
      category: "maintenance",
      title: "维护通知",
      body: "今晚维护",
      published_at: "2026-09-28T05:00:00Z",
    });
    await manager.pull("test");
    const messages = await manager.listMessages();
    assert.equal(messages.find((message) => message.message_id === "m-revoke").revoked, true);
    // 撤回的旧消息不重复弹窗，新消息正常弹
    assert.deepEqual(notifications, ["m-revoke", "m-late"]);
    manager.stop();
  } finally {
    await mock.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("回执：接收回执自动发送；已读只在用户打开后上报一次且不倒退", async () => {
  const mock = await startMockServer();
  const { file, dir } = await tmpFile("system-messages.json");
  try {
    mock.state.messages.push({
      message_id: "m-read",
      category: "version",
      title: "版本提醒",
      body: "新版本可用",
      published_at: "2026-09-28T02:00:00Z",
    });
    const manager = makeManager(file, mock.port);
    await manager.configure({ messagesEnabled: true, notifyNewMessages: false, dailyPopupLimit: 0 });
    await manager.pull("test");
    await waitFor(() => mock.state.receipts.some((receipt) => receipt.message_id === "m-read" && receipt.received));
    // 未打开前没有已读回执
    assert.equal(mock.state.receipts.some((receipt) => receipt.read), false);

    await manager.markRead("m-read");
    await waitFor(() => mock.state.receipts.some((receipt) => receipt.message_id === "m-read" && receipt.read));
    // 第二次 markRead 是 no-op：已读状态不倒退、不重复上报
    const readStamps = (await manager.listMessages())[0].read_at;
    await manager.markRead("m-read");
    assert.equal((await manager.listMessages())[0].read_at, readStamps);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(mock.state.receipts.filter((receipt) => receipt.read).length, 1);

    // 点击回执：带 clicked_at，且已读不丢
    await manager.markClicked("m-read");
    await waitFor(() => mock.state.receipts.some((receipt) => receipt.clicked));
    manager.stop();
  } finally {
    await mock.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("通知约束：免打扰时段不弹、每日上限、营销类默认不弹；消息中心仍可查", async () => {
  const mock = await startMockServer();
  const { file, dir } = await tmpFile("system-messages.json");
  const notifications = [];
  try {
    mock.state.messages.push(
      { message_id: "n1", category: "announcement", title: "公告1", body: "x", published_at: "2026-09-28T02:00:00Z" },
      { message_id: "n2", category: "announcement", title: "公告2", body: "x", published_at: "2026-09-28T02:01:00Z" },
      { message_id: "n3", category: "marketing", title: "活动", body: "x", published_at: "2026-09-28T02:02:00Z" },
    );
    const manager = makeManager(file, mock.port, {
      showNotification: (message) => notifications.push(message.message_id),
    });
    // 每日上限 1：只有第一条普通公告弹窗；营销类默认不弹
    await manager.configure({ messagesEnabled: true, notifyNewMessages: true, dailyPopupLimit: 1, notifyMarketing: false });
    await manager.pull("test");
    assert.deepEqual(notifications, ["n1"]);
    // 消息中心仍可查全部消息
    assert.equal((await manager.listMessages()).length, 3);

    // 免打扰时段：普通公告也不弹（新消息 m-quiet）
    mock.state.messages.push({ message_id: "n4", category: "announcement", title: "深夜公告", body: "x", published_at: "2026-09-28T20:00:00Z" });
    const quietNow = new Date();
    quietNow.setHours(23, 30);
    const clock = { now: () => quietNow.getTime() };
    // 重建 manager 使用受控时钟
    const manager2 = makeManager(file, mock.port, {
      now: clock.now,
      showNotification: (message) => notifications.push(message.message_id),
    });
    await manager2.configure({ messagesEnabled: true, notifyNewMessages: true, dailyPopupLimit: 5, quietHours: "22:00-08:00" });
    await manager2.pull("test");
    assert.deepEqual(notifications, ["n1"], "免打扰时段不弹系统通知");
    assert.equal((await manager2.listMessages()).some((message) => message.message_id === "n4"), true, "消息中心仍可查");
    manager.stop();
    manager2.stop();
  } finally {
    await mock.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("游标过期 resync：清空游标重新同步一次，不陷入循环", async () => {
  const mock = await startMockServer();
  const { file, dir } = await tmpFile("system-messages.json");
  try {
    mock.state.messages.push({ message_id: "r1", category: "announcement", title: "重新同步", body: "x", published_at: "2026-09-28T02:00:00Z" });
    const manager = makeManager(file, mock.port);
    await manager.configure({ messagesEnabled: true, notifyNewMessages: false, dailyPopupLimit: 0 });
    await manager.pull("test");
    // 服务器宣布当前游标已过期
    mock.state.resyncCursor = "cursor-1";
    mock.state.messages.push({ message_id: "r2", category: "announcement", title: "补拉到新消息", body: "x", published_at: "2026-09-28T03:00:00Z" });
    const result = await manager.pull("test");
    assert.equal(result.ok, true);
    const messages = await manager.listMessages();
    assert.equal(messages.length, 2, "从头重新同步拿到全部消息");
    manager.stop();
  } finally {
    await mock.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("SSE：连接带 Authorization 头，收到 new-message 后触发补拉", async () => {
  const mock = await startMockServer();
  const { file, dir } = await tmpFile("system-messages.json");
  try {
    mock.state.messages.push({ message_id: "s1", category: "announcement", title: "初始消息", body: "x", published_at: "2026-09-28T02:00:00Z" });
    const manager = makeManager(file, mock.port);
    await manager.configure({ messagesEnabled: true, notifyNewMessages: false, dailyPopupLimit: 0 });
    manager.start();
    // 启动补拉完成 + SSE 连接建立
    assert.equal(await waitFor(() => mock.state.pulls >= 1 && mock.state.sseWriters.length >= 1), true);
    // SSE 请求带 Authorization 头，凭据不出现在 URL 上
    assert.equal(mock.state.streamRequests[0].authorization, "Device device-token");
    assert.equal(mock.state.streamRequests[0].url.includes("token"), false);
    // 服务端推送“有新消息”，随后下发新消息：客户端应被触发再次补拉
    mock.state.messages.push({ message_id: "s2", category: "announcement", title: "SSE 新消息", body: "x", published_at: "2026-09-28T04:00:00Z" });
    const writer = mock.state.sseWriters[0];
    writer.write("event: new-message\ndata: {}\n\n");
    assert.equal(await waitFor(() => mock.state.pulls >= 2), true, "SSE 提示触发补拉");
    // The server receiving the pull does not mean its response has been saved.
    assert.equal(await waitFor(async () => (await manager.listMessages()).some(message => message.message_id === "s2")), true, "新消息实际保存后可读取");
    const messages = await manager.listMessages();
    assert.equal(messages.some((message) => message.message_id === "s2"), true);
    manager.stop();
    // SSE 连接由客户端中止：服务端连接随后关闭，避免 server.close() 悬挂
    await waitFor(() => mock.state.sseWriters.length === 0 || writer.destroyed);
    writer.destroy();
  } finally {
    for (const writer of mock.state.sseWriters) writer.destroy();
    mock.server.closeAllConnections?.();
    await mock.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
