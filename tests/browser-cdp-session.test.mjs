import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  CDP_ACCESS_DISABLED_MESSAGE,
  CdpEventRingBuffer,
  executeCdpTool,
  isBackgroundProtectedCdpCall,
  isValidCdpMethod,
} from "../electron/browser-cdp-session.mts";
import { BrowserPageAdapter } from "../electron/browser-page-adapter.mts";
import { BrowserControlManager, CONTROL_STATUS } from "../electron/browser-control.mts";
import { BrowserAgent } from "../electron/browser.mts";
import { RISK, classify } from "../electron/risk.mts";
import { requiresFullParameterReview, reviewActionFacts } from "../electron/approval-context.mts";
import { matchStandingRule, suggestStandingRule } from "../electron/agent/standing-rules.mts";
import { createComputerUseRuntime } from "../electron/desktop/computer-use-runtime.mts";

// 生成一个 2x2 的最小有效 PNG Buffer
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF8A/wQF/m8T/wAAAABJRU5ErkJggg==";

function createMockWebContents() {
  const debuggerEmitter = new EventEmitter();
  let attached = false;
  const sentCommands = [];
  const contents = {
    id: 202,
    isDestroyed: () => false,
    once: () => {},
    getURL: () => "https://example.com/app",
    executeJavaScript: async (script) => {
      if (typeof script === "string" && script.includes("document.body")) {
        return { title: "测试页面", url: "https://example.com/app", text: "正文", textLength: 2, clipped: false };
      }
      return {
        title: "测试页面",
        url: "https://example.com/app",
        totalCount: 1,
        elements: [{ ref: 0, tag: "button", role: "button", name: "确定", rect: { x: 10, y: 10, width: 60, height: 30 }, enabled: true }],
        viewport: { cssWidth: 800, cssHeight: 600, devicePixelRatio: 1 },
      };
    },
    capturePage: async () => {
      throw new Error("capturePage 锁屏时不可用");
    },
    debugger: {
      isAttached: () => attached,
      attach: () => { attached = true; },
      detach: () => { attached = false; },
      on: (event, listener) => debuggerEmitter.on(event, listener),
      removeListener: (event, listener) => debuggerEmitter.removeListener(event, listener),
      sendCommand: async (method, params = {}, sessionId) => {
        sentCommands.push({ method, params, sessionId });
        if (method === "Page.captureScreenshot") {
          return { data: TINY_PNG_BASE64 };
        }
        if (method === "Runtime.evaluate") {
          return { result: { type: "number", value: 42 } };
        }
        if (method === "Network.getCookies") {
          return { cookies: [{ name: "sid", value: "abc" }] };
        }
        if (method === "Test.bigPayload") {
          return { payload: "x".repeat(40_000) };
        }
        return { ok: true, method, sessionId };
      },
    },
    __emitDebuggerMessage: (method, params, sessionId) => {
      debuggerEmitter.emit("message", {}, method, params, sessionId);
    },
    __sentCommands: sentCommands,
  };
  return contents;
}

test("executeCdpTool: 完整 CDP 开关门控、动态开关生效与基础校验", async () => {
  let cdpEnabled = false;
  const mockContents = createMockWebContents();
  const adapter = new BrowserPageAdapter(mockContents);

  const disabledRes = await executeCdpTool(
    adapter,
    { action: "send", method: "Runtime.evaluate", params: { expression: "1+1" } },
    { isFullCdpAccessEnabled: () => cdpEnabled },
  );
  assert.equal(disabledRes.ok, false);
  assert.equal(disabledRes.errorCode, "CDP_ACCESS_DISABLED");
  assert.equal(disabledRes.result, CDP_ACCESS_DISABLED_MESSAGE);

  // 动态开启
  cdpEnabled = true;
  const okRes = await executeCdpTool(
    adapter,
    { action: "send", method: "Runtime.evaluate", params: { expression: "40+2" }, sessionId: "child-session-1" },
    { isFullCdpAccessEnabled: () => cdpEnabled },
  );
  assert.equal(okRes.ok, true);
  assert.equal(okRes.data.result.value, 42);
  assert.equal(mockContents.__sentCommands.at(-1).sessionId, "child-session-1");

  // 动态关闭后立即再次被拒
  cdpEnabled = false;
  const reDisabled = await executeCdpTool(
    adapter,
    { action: "events" },
    { isFullCdpAccessEnabled: () => cdpEnabled },
  );
  assert.equal(reDisabled.ok, false);
  assert.equal(reDisabled.errorCode, "CDP_ACCESS_DISABLED");

  // 参数校验
  assert.equal(isValidCdpMethod("Runtime.evaluate"), true);
  assert.equal(isValidCdpMethod("bad method"), false);
  cdpEnabled = true;
  const badMethod = await executeCdpTool(adapter, { method: "invalid" }, { isFullCdpAccessEnabled: () => true });
  assert.equal(badMethod.ok, false);
  assert.equal(badMethod.errorCode, "INVALID_ARGUMENT");

  const badParams = await executeCdpTool(adapter, { method: "Page.reload", params: "nope" }, { isFullCdpAccessEnabled: () => true });
  assert.equal(badParams.ok, false);
  assert.equal(badParams.errorCode, "INVALID_ARGUMENT");

  const badTimeout = await executeCdpTool(adapter, { method: "Page.reload", timeoutMs: 999_999 }, { isFullCdpAccessEnabled: () => true });
  assert.equal(badTimeout.ok, false);
  assert.equal(badTimeout.errorCode, "INVALID_ARGUMENT");

  adapter.dispose();
});

test("CdpEventRingBuffer & adapter: 事件上限 300 条、按前缀和序号过滤及清空", async () => {
  const ring = new CdpEventRingBuffer(300);
  for (let i = 1; i <= 350; i++) {
    ring.push(i % 2 === 0 ? "Network.requestWillBeSent" : "Runtime.consoleAPICalled", { idx: i });
  }
  assert.equal(ring.events.length, 300);
  assert.equal(ring.events[0].seq, 51);
  const netOnly = ring.query({ methodPrefix: "Network.", sinceSeq: 340, limit: 10 });
  assert.equal(netOnly.items.length, 5);
  assert.equal(netOnly.latestSeq, 350);

  // 通过 adapter.contents.debugger 接收事件并经 executeCdpTool 读取/清空
  const mockContents = createMockWebContents();
  const adapter = new BrowserPageAdapter(mockContents);
  await adapter.ensureDebugger();
  mockContents.__emitDebuggerMessage("Runtime.consoleAPICalled", { args: [{ value: "hello" }] });
  mockContents.__emitDebuggerMessage("Network.responseReceived", { requestId: "r1" });

  const evRes = await executeCdpTool(
    adapter,
    { action: "events", methodPrefix: "Runtime." },
    { isFullCdpAccessEnabled: () => true },
  );
  assert.equal(evRes.ok, true);
  assert.equal(evRes.data.items.length, 1);
  assert.equal(evRes.data.items[0].method, "Runtime.consoleAPICalled");

  const clearRes = await executeCdpTool(adapter, { action: "clear_events" }, { isFullCdpAccessEnabled: () => true });
  assert.equal(clearRes.ok, true);
  const afterClear = await executeCdpTool(adapter, { action: "events" }, { isFullCdpAccessEnabled: () => true });
  assert.equal(afterClear.data.items.length, 0);

  adapter.dispose();
});

test("executeCdpTool: saveToPath 安全写入工作区并拦截路径穿越，大响应截断至 32KB 附近", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-cdp-test-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
  const mockContents = createMockWebContents();
  const adapter = new BrowserPageAdapter(mockContents);

  // 合法相对路径保存截图二进制
  const savedRes = await executeCdpTool(
    adapter,
    { method: "Page.captureScreenshot", params: { format: "png" }, saveToPath: "shots/page.png" },
    { isFullCdpAccessEnabled: () => true, workspacePath: tmpRoot },
  );
  assert.equal(savedRes.ok, true);
  assert.equal(savedRes.data.dataSavedTo, path.join("shots", "page.png"));
  assert.equal("data" in savedRes.data, false);
  const fileBuf = await fs.readFile(path.join(tmpRoot, "shots/page.png"));
  assert.equal(fileBuf.toString("base64"), TINY_PNG_BASE64);

  // 路径穿越拦截
  for (const unsafe of ["../escape.png", "/etc/passwd", "../other/x.png"]) {
    const blocked = await executeCdpTool(
      adapter,
      { method: "Page.captureScreenshot", saveToPath: unsafe },
      { isFullCdpAccessEnabled: () => true, workspacePath: tmpRoot },
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errorCode, "SAVE_FAILED");
  }

  // 超大响应截断
  const bigRes = await executeCdpTool(
    adapter,
    { method: "Test.bigPayload" },
    { isFullCdpAccessEnabled: () => true, workspacePath: tmpRoot },
  );
  assert.equal(bigRes.ok, true);
  assert.ok(bigRes.result.includes("已截断"));
  assert.ok(bigRes.result.length < 33_000);

  adapter.dispose();
});

test("后台保护模式拦截破坏隔离的 CDP 调用，可见模式放行", async () => {
  const mockContents = createMockWebContents();
  const adapter = new BrowserPageAdapter(mockContents);

  for (const [method, params] of [
    ["Page.setInterceptFileChooserDialog", { enabled: false }],
    ["Page.removeScriptToEvaluateOnNewDocument", { identifier: "1" }],
    ["Target.setAutoAttach", { autoAttach: false }],
    ["Browser.close", {}],
  ]) {
    assert.ok(isBackgroundProtectedCdpCall(method, params));
    const blocked = await executeCdpTool(
      adapter,
      { method, params },
      { isFullCdpAccessEnabled: () => true, protectedBackground: true },
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errorCode, "CDP_PROTECTED_CALL");
  }

  // 可见页面（protectedBackground: false）放行常规调用
  const allowed = await executeCdpTool(
    adapter,
    { method: "Page.setInterceptFileChooserDialog", params: { enabled: false } },
    { isFullCdpAccessEnabled: () => true, protectedBackground: false },
  );
  assert.equal(allowed.ok, true);

  adapter.dispose();
});

test("BrowserControlManager.cdp: 用户接管态下阻断，锁屏态自动回退 CDP Page.captureScreenshot", async () => {
  const mockContents = createMockWebContents();
  let locked = true;
  const manager = new BrowserControlManager({ isScreenLocked: () => locked });
  await manager.acquireControl({
    ownerSessionId: "s-cdp",
    runId: "r-cdp",
    tabId: "t-cdp",
    webContents: mockContents,
  });

  // 锁屏状态下 captureScreenImage 自动回退 CDP Page.captureScreenshot
  const obs = await manager.observe({ captureScreenshot: true });
  assert.equal(obs.ok, true);
  assert.ok(Array.isArray(obs.images) && obs.images.length === 1);
  assert.equal(obs.images[0].data, TINY_PNG_BASE64);
  assert.ok(mockContents.__sentCommands.some((item) => item.method === "Page.captureScreenshot"));

  // 开启控制期间 CDP 调用正常执行
  const cdpOk = await manager.cdp({
    args: { action: "send", method: "Network.getCookies" },
    isFullCdpAccessEnabled: () => true,
  });
  assert.equal(cdpOk.ok, true);
  assert.equal(cdpOk.data.cookies[0].name, "sid");

  // 用户接管后立即阻断 CDP
  const takeover = manager.takeover({ reason: "手动接管" });
  assert.equal(takeover.status, CONTROL_STATUS.HUMAN_CONTROL);
  const cdpBlocked = await manager.cdp({
    args: { action: "send", method: "Network.getCookies" },
    isFullCdpAccessEnabled: () => true,
  });
  assert.equal(cdpBlocked.ok, false);
  assert.equal(cdpBlocked.errorCode, "HUMAN_TAKEOVER");

  // BrowserAgent 路由 browser__cdp 时未开开关被拒绝
  const agent = new BrowserAgent({
    controlManager: new BrowserControlManager({ isScreenLocked: () => true }),
    isFullCdpAccessEnabled: () => false,
    openPanel: async () => ({ ok: true, contents: mockContents, tabId: "t1" }),
    getContents: () => mockContents,
  });
  agent.setContext({ ownerSessionId: "s-cdp", runId: "r-cdp" });
  const agentRes = await agent.handle("browser__cdp", { action: "send", method: "Runtime.evaluate", params: { expression: "1" } });
  assert.equal(agentRes.ok, false);
  assert.equal(agentRes.errorCode, "CDP_ACCESS_DISABLED");

  locked = false;
  manager.dispose();
  agent.dispose();
});

test("risk / approval-context / standing-rules: browser__cdp 与 browser__connect 安全约束", () => {
  // 风险分级
  assert.equal(classify("browser__connect", { action: "discover" }).risk, RISK.READ);
  assert.equal(classify("browser__connect", { action: "discover" }).consequential, false);
  assert.equal(classify("browser__connect", { action: "status" }).risk, RISK.READ);
  assert.equal(classify("browser__connect", { action: "disconnect" }).risk, RISK.READ);
  assert.equal(classify("browser__connect", { action: "connect" }).risk, RISK.EXTERNAL);
  assert.equal(classify("browser__connect", { action: "connect" }).consequential, true);
  assert.equal(classify("browser__cdp", { action: "send", method: "Runtime.evaluate" }).risk, RISK.EXTERNAL);
  assert.equal(classify("browser__cdp", { action: "send", method: "Runtime.evaluate" }).consequential, true);

  // 全参数审批与事实注入
  assert.equal(requiresFullParameterReview({ kind: "browser__cdp", args: { action: "send", method: "Network.getCookies" } }), true);
  assert.equal(requiresFullParameterReview({ kind: "browser__connect", args: { action: "connect", endpoint: "http://127.0.0.1:9222" } }), true);
  assert.equal(requiresFullParameterReview({ kind: "browser__connect", args: { action: "discover" } }), false);
  assert.ok(reviewActionFacts({ kind: "browser__cdp" }).includes("CDP"));
  assert.ok(reviewActionFacts({ kind: "browser__connect", args: { action: "connect" } }).includes("外部浏览器"));

  // 常驻规则禁止放行或建议始终允许
  const fakeRules = [{ id: "r1", kind: "domain", pattern: "example.com" }, { id: "r2", kind: "mcp-tool", pattern: "browser__cdp" }];
  assert.equal(matchStandingRule(fakeRules, "browser__cdp", { method: "Runtime.evaluate" }), false);
  assert.equal(matchStandingRule(fakeRules, "browser__connect", { action: "connect", endpoint: "http://127.0.0.1:9222" }), false);
  assert.equal(suggestStandingRule("browser__cdp", { method: "Runtime.evaluate" }), null);
  assert.equal(suggestStandingRule("browser__connect", { action: "connect" }), null);
});

test("computer-use-runtime: 锁屏时拦截原生桌面操作、放行 check_permissions 并引导使用 browser__*", async (t) => {
  const tool = (name, fields = [], required = []) => ({
    name,
    inputSchema: { type: "object", properties: Object.fromEntries(fields.map((f) => [f, { type: "string" }])), required },
  });
  const runtime = createComputerUseRuntime(
    { platform: "darwin", command: process.execPath, env: {} },
    () => ({
      tools: [
        tool("list_apps"),
        tool("get_app_state", ["app"], ["app"]),
        tool("click", ["app", "element_index"], ["app"]),
      ],
      connect: async () => {},
      close: async () => {},
      callTool: async () => ({ text: "should-not-run", images: [] }),
    }),
    { isScreenLocked: () => true },
  );
  t.after(() => runtime.stopAll());

  const defs = await runtime.definitions();
  assert.ok(defs.some((d) => d.function.name === "mcp__computer-use__list_apps"));

  // 原生桌面操作被锁屏门控拦下，返回包含 browser__* 指引
  const blocked = await runtime.call("mcp__computer-use__list_apps", {}, { sessionId: "s1", runId: "r1" });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.result.includes("屏幕已锁定"));
  assert.ok(blocked.result.includes("browser__*"));

  // check_permissions 不走锁屏阻断分支
  const permCheck = await runtime.call("mcp__computer-use__check_permissions", {}, { sessionId: "s1", runId: "r1" });
  assert.equal(permCheck.result.includes("屏幕已锁定"), false);
});
