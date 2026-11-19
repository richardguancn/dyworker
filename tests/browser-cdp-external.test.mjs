import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import {
  createExternalBrowserAgent,
  discoverExternalCdpBrowsers,
  isLoopbackCdpUrl,
} from "../electron/browser-cdp-external.mts";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF8A/wQF/m8T/wAAAABJRU5ErkJggg==";

function encodeWsTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > buffer.length) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (cursor + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskBytes = masked ? 4 : 0;
    if (cursor + maskBytes + len > buffer.length) break;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    cursor += maskBytes;
    const data = Buffer.from(buffer.subarray(cursor, cursor + len));
    if (mask) {
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    }
    frames.push({ opcode, text: data.toString("utf8") });
    offset = cursor + len;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

/**
 * 搭建真实回环 HTTP + RFC6455 WebSocket 模拟 CDP 服务，用于全链路验证不写任何外联请求
 */
async function startMockCdpServer() {
  const pages = new Map([
    ["target-1", { targetId: "target-1", title: "首页", url: "https://example.com/", type: "page" }],
    ["target-2", { targetId: "target-2", title: "控制台", url: "https://example.com/console", type: "page" }],
  ]);
  const sessionToTarget = new Map();
  let nextSessionSeq = 1;
  let nextTargetSeq = 3;
  let activeTargetId = "target-1";
  let browserCloseCalled = 0;
  let clickedCount = 0;
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    const host = req.headers.host || "127.0.0.1";
    if (req.url === "/json/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        Browser: "Chrome/134.0.0.0",
        webSocketDebuggerUrl: `ws://${host}/devtools/browser/mock-browser`,
      }));
      return;
    }
    if (req.url === "/json/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(
        [...pages.values()].map((p) => ({
          id: p.targetId,
          title: p.title,
          url: p.url,
          type: "page",
          webSocketDebuggerUrl: `ws://${host}/devtools/page/${p.targetId}`,
        })),
      ));
      return;
    }
    res.writeHead(404).end();
  });

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n"
      + "Upgrade: websocket\r\n"
      + "Connection: Upgrade\r\n"
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    let recvBuf = Buffer.alloc(0);

    const sendJson = (obj) => {
      if (!socket.destroyed) socket.write(encodeWsTextFrame(JSON.stringify(obj)));
    };

    socket.on("data", (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      const { frames, remaining } = decodeWsFrames(recvBuf);
      recvBuf = remaining;
      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          socket.end(Buffer.from([0x88, 0x00]));
          continue;
        }
        if (frame.opcode !== 0x1) continue;
        const msg = JSON.parse(frame.text);
        const { id, method, params = {}, sessionId } = msg;
        const targetId = (sessionId && sessionToTarget.get(sessionId)) || activeTargetId;
        const page = pages.get(targetId);

        const reply = (result) => sendJson({ id, ...(sessionId ? { sessionId } : {}), result });

        if (method === "Target.setDiscoverTargets") {
          reply({});
        } else if (method === "Target.getTargets") {
          reply({ targetInfos: [...pages.values()] });
        } else if (method === "Target.attachToTarget") {
          const newSid = `sid-${nextSessionSeq++}`;
          sessionToTarget.set(newSid, params.targetId);
          reply({ sessionId: newSid });
        } else if (method === "Target.createTarget") {
          const newTid = `target-${nextTargetSeq++}`;
          pages.set(newTid, { targetId: newTid, title: "新页面", url: params.url || "about:blank", type: "page" });
          activeTargetId = newTid;
          reply({ targetId: newTid });
        } else if (method === "Target.activateTarget") {
          activeTargetId = params.targetId;
          reply({});
        } else if (method === "Target.closeTarget") {
          const existed = pages.delete(params.targetId);
          reply({ success: existed });
        } else if (method === "Page.enable" || method === "Runtime.enable") {
          reply({});
        } else if (method === "Page.getNavigationHistory") {
          reply({
            currentIndex: 0,
            entries: [{ id: 1, url: page?.url || "about:blank", title: page?.title || "" }],
          });
        } else if (method === "Page.navigate") {
          if (page && params.url) {
            page.url = params.url;
            page.title = `已跳转:${params.url}`;
          }
          reply({ frameId: "f1" });
        } else if (method === "Page.captureScreenshot") {
          reply({ data: TINY_PNG_BASE64 });
        } else if (method === "Input.dispatchMouseEvent") {
          if (params.type === "mouseReleased") clickedCount++;
          reply({});
        } else if (method === "Browser.close") {
          browserCloseCalled++;
          reply({});
        } else if (method === "Runtime.evaluate") {
          const expr = String(params.expression || "");
          if (expr.includes("({ url: location.href, title: document.title })")) {
            reply({ result: { type: "object", value: { url: page?.url || "", title: page?.title || "" } } });
          } else if (expr.includes("document.readyState")) {
            reply({ result: { type: "string", value: "complete" } });
          } else if (expr.includes("interactiveSelector")) {
            reply({
              result: {
                type: "object",
                value: {
                  title: page?.title || "",
                  url: page?.url || "",
                  totalCount: 1,
                  elements: [{ ref: 0, tag: "button", role: "button", name: "外部按钮", rect: { x: 40, y: 50, width: 80, height: 30 }, enabled: true }],
                  viewport: { cssWidth: 1024, cssHeight: 720, devicePixelRatio: 1 },
                },
              },
            });
          } else if (expr.includes("NOT_FOUND_OR_REPLACED") || expr.includes("__dyworker_node_stamp")) {
            reply({ result: { type: "object", value: { ok: true, coords: { x: 80, y: 65 }, isContentEditable: false } } });
          } else if (expr.includes("cloneNode") || expr.includes("innerText")) {
            reply({ result: { type: "string", value: `正文:${page?.title || ""}` } });
          } else if (expr.includes("console.log")) {
            sendJson({
              ...(sessionId ? { sessionId } : {}),
              method: "Runtime.consoleAPICalled",
              params: { type: "log", args: [{ type: "string", value: "cdp-ok" }] },
            });
            reply({ result: { type: "string", value: "logged" } });
          } else {
            reply({ result: { type: "string", value: "eval-ok" } });
          }
        } else {
          reply({ echoed: method });
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    httpEndpoint: `http://127.0.0.1:${port}`,
    getStats: () => ({ browserCloseCalled, clickedCount }),
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("isLoopbackCdpUrl: 仅放行本机回环地址，拒绝远程域名、带口令及非法协议", () => {
  assert.equal(isLoopbackCdpUrl("http://127.0.0.1:9222").ok, true);
  assert.equal(isLoopbackCdpUrl("http://localhost:9222").ok, true);
  assert.equal(isLoopbackCdpUrl("ws://[::1]:9222/devtools/browser/1").ok, true);

  assert.equal(isLoopbackCdpUrl("http://192.168.1.50:9222").ok, false);
  assert.equal(isLoopbackCdpUrl("http://example.com:9222").ok, false);
  assert.equal(isLoopbackCdpUrl("http://user:pass@127.0.0.1:9222").ok, false);
  assert.equal(isLoopbackCdpUrl("https://127.0.0.1:9222").ok, false);
  assert.equal(isLoopbackCdpUrl("not-a-url").ok, false);
});

test("discoverExternalCdpBrowsers & ExternalBrowserAgent: 发现、多标签、观察点击读取、CDP 调用与安全断开", async (t) => {
  const server = await startMockCdpServer();
  t.after(() => server.close());

  const discovered = await discoverExternalCdpBrowsers({ endpoint: server.httpEndpoint });
  assert.equal(discovered.ok, true);
  assert.equal(discovered.browsers.length, 1);
  assert.equal(discovered.browsers[0].targets.length, 2);
  assert.equal(discovered.browsers[0].name, "Chrome/134.0.0.0");

  let fullCdp = true;
  const { agent, surface } = createExternalBrowserAgent({
    ownerSessionId: "ext-s1",
    runId: "ext-r1",
    isFullCdpAccessEnabled: () => fullCdp,
  });
  t.after(async () => {
    agent.dispose();
    await surface.dispose();
  });

  const conn = await surface.connect({ endpoint: server.httpEndpoint });
  assert.equal(conn.ok, true);
  assert.equal(conn.tabId, "target-1");

  await agent.controlManager.acquireControl({
    ownerSessionId: "ext-s1",
    runId: "ext-r1",
    tabId: conn.tabId,
    webContents: conn.contents,
  });

  // 列出标签页
  const tabsRes = await agent.handle("browser__tabs", { action: "list" });
  assert.equal(tabsRes.ok, true);
  assert.ok(tabsRes.result.includes("target-1"));
  assert.ok(tabsRes.result.includes("target-2"));

  // 新开标签页、切回、关闭新标签页
  const opened = await agent.handle("browser__open", { url: "https://example.com/new" });
  assert.equal(opened.ok, true);
  const newTabId = surface.activeId;
  const afterOpen = surface.listTabs();
  assert.equal(afterOpen.length, 3);

  const activated = await agent.handle("browser__tabs", { action: "activate", tabId: "target-2" });
  assert.equal(activated.ok, true);
  assert.equal(surface.activeId, "target-2");

  const closedTab = await agent.handle("browser__tabs", { action: "close", tabId: newTabId });
  assert.equal(closedTab.ok, true);
  assert.equal(surface.listTabs().length, 2);

  // 观察与点击
  const obs = await agent.handle("browser__observe", {});
  assert.equal(obs.ok, true);
  assert.equal(obs.images.length, 1);
  assert.ok(obs.result.includes("外部按钮"));

  const clickRes = await agent.handle("browser__act", {
    observationId: obs.data.observationId,
    actionId: "ext-click-1",
    type: "click",
    ref: 0,
  });
  assert.equal(clickRes.ok, true);
  assert.equal(server.getStats().clickedCount, 1);

  // 读取正文
  const readRes = await agent.handle("browser__read", {});
  assert.equal(readRes.ok, true);
  assert.ok(readRes.result.includes("控制台"));

  // CDP 调用与事件读取
  const cdpEval = await agent.handle("browser__cdp", {
    action: "send",
    method: "Runtime.evaluate",
    params: { expression: "console.log('cdp-ok')" },
  });
  assert.equal(cdpEval.ok, true);

  const cdpEvents = await agent.handle("browser__cdp", {
    action: "events",
    methodPrefix: "Runtime.",
  });
  assert.equal(cdpEvents.ok, true);
  assert.ok(cdpEvents.data.items.some((ev) => ev.method === "Runtime.consoleAPICalled"));

  // 关闭连接仅断 WebSocket，绝对不发 Browser.close 关闭用户的外部浏览器
  const closeRes = await agent.handle("browser__close", {});
  assert.equal(closeRes.ok, true);
  assert.equal(server.getStats().browserCloseCalled, 0);
});
