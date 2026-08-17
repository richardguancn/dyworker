import test from "node:test";
import { createQqBotClient } from "../electron/channels/qq-bot.mjs";

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

test("repro hang", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("getAppAccessToken")) {
      return { ok: true, json: async () => ({ access_token: "tok-1", expires_in: 7200 }) };
    }
    if (url.endsWith("/gateway")) {
      return { ok: true, json: async () => ({ url: "wss://sandbox.qq/ws" }) };
    }
    return { ok: true, json: async () => ({ id: "out-1" }) };
  };
  const received = [];
  const client = createQqBotClient({
    appId: "app1",
    appSecret: "sec1",
    fetchImpl,
    webSocketImpl: FakeWebSocket,
    onMessage: (message) => received.push(message),
  });
  await client.start();
  const ws = FakeWebSocket.instances.at(-1);
  ws.onmessage({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 30000 } }) });
  ws.onmessage({ data: JSON.stringify({ op: 0, t: "READY", d: { session_id: "s1", user: { id: "bot9" } } }) });
  ws.onmessage({ data: JSON.stringify({ op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "m1", content: "你好", author: { id: "u1" } } }) });
  console.log("received:", received.length);
  await client.sendText({ chatType: "dm", chatId: "u1", messageId: "m1" }, "z".repeat(1600));
  console.log("posts:", calls.filter((c) => c.url.includes("/messages")).length);
  await client.stop();
  console.log("stopped");
});
