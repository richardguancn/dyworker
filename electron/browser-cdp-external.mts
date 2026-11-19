// 外部 Chromium 浏览器 CDP 发现、回环校验与 WebSocket 适配层。
// 实现与 BrowserPageAdapter / BrowserControlManager 兼容的最小 webContents 接口，
// 仅在主动断开时关闭调试连接，绝不关闭用户的外部浏览器进程。
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isSafeBrowserUrl } from "./agent/web-tools.mts";
import { BrowserAgent } from "./browser.mts";
import { BrowserControlManager } from "./browser-control.mts";
import { listChromiumBrowserDirs } from "./browser-import.mts";

const DEFAULT_CDP_PORTS = [9222, 9223, 9229];
const DISCOVER_TIMEOUT_MS = 500;
const WS_CONNECT_TIMEOUT_MS = 5000;
let nextExternalWebContentsId = 100_000;

function parsePngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

export function isLoopbackHostname(hostname: string): boolean {
  let host = String(hostname || "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function isLoopbackCdpUrl(rawUrl: string): { ok: boolean; url?: URL; error?: string } {
  let url: URL;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    return { ok: false, error: "调试地址无效，请使用本机 http://127.0.0.1:端口 或 ws://127.0.0.1:端口/... 地址" };
  }
  if (url.protocol !== "http:" && url.protocol !== "ws:") {
    return { ok: false, error: "CDP 调试地址仅允许 http:// 或 ws:// 协议" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "CDP 调试地址不能包含账号或口令" };
  }
  if (!isLoopbackHostname(url.hostname)) {
    return { ok: false, error: `出于安全限制，仅允许连接本机回环地址（127.0.0.1 / localhost / [::1]），已拒绝：${url.hostname}` };
  }
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: `CDP 调试端口无效：${url.port}` };
    }
  }
  return { ok: true, url };
}

function sanitizeLoopbackWsUrl(rawWsUrl: unknown, fallbackOriginUrl: URL): string {
  const candidate = String(rawWsUrl || "").trim();
  if (!candidate) return "";
  const checked = isLoopbackCdpUrl(candidate);
  if (checked.ok && checked.url?.protocol === "ws:") return checked.url.toString();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "ws:") {
      const hostPort = fallbackOriginUrl.port ? `${fallbackOriginUrl.hostname}:${fallbackOriginUrl.port}` : fallbackOriginUrl.hostname;
      return `ws://${hostPort}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // 忽略非法 WS URL
  }
  return "";
}

async function readDevToolsActivePort(userDataDir: string): Promise<{ port: number; wsPath: string } | null> {
  try {
    const raw = await fs.readFile(path.join(userDataDir, "DevToolsActivePort"), "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const port = Number(lines[0]);
    const wsPath = lines[1] || "";
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !wsPath.startsWith("/")) return null;
    return { port, wsPath };
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface DiscoveredExternalTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string;
}

export interface DiscoveredExternalBrowser {
  id: string;
  name: string;
  browserVersion: string;
  httpEndpoint: string;
  webSocketDebuggerUrl: string;
  targets: DiscoveredExternalTarget[];
}

export async function discoverExternalCdpBrowsers({
  endpoint = "",
  ports = DEFAULT_CDP_PORTS,
  listBrowserDirs = listChromiumBrowserDirs,
  fetchImpl = fetch,
  timeoutMs = DISCOVER_TIMEOUT_MS,
}: {
  endpoint?: string;
  ports?: number[];
  listBrowserDirs?: () => Promise<Array<{ id: string; name: string; userDataDir: string }>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<{ ok: boolean; error?: string; browsers: DiscoveredExternalBrowser[] }> {
  const probeEndpoint = async (httpOrigin: string, meta: { id: string; name: string; fallbackWsUrl?: string }) => {
    const originUrl = new URL(httpOrigin);
    const [versionInfo, targetList] = await Promise.all([
      fetchJsonWithTimeout(fetchImpl, `${originUrl.origin}/json/version`, timeoutMs),
      fetchJsonWithTimeout(fetchImpl, `${originUrl.origin}/json/list`, timeoutMs),
    ]);
    if (!versionInfo && !Array.isArray(targetList) && !meta.fallbackWsUrl) return null;
    const browserWs = sanitizeLoopbackWsUrl(versionInfo?.webSocketDebuggerUrl, originUrl) || meta.fallbackWsUrl || "";
    const targets: DiscoveredExternalTarget[] = (Array.isArray(targetList) ? targetList : [])
      .filter((item) => item && (!item.type || item.type === "page"))
      .map((item) => {
        const id = String(item.id || "");
        const fallbackTargetWs = id ? `ws://${originUrl.host}/devtools/page/${id}` : "";
        return {
          id,
          title: String(item.title || ""),
          url: String(item.url || ""),
          type: String(item.type || "page"),
          webSocketDebuggerUrl: sanitizeLoopbackWsUrl(item.webSocketDebuggerUrl, originUrl) || fallbackTargetWs,
        };
      })
      .filter((item) => item.id || item.webSocketDebuggerUrl);

    if (!browserWs && !targets.length) return null;
    return {
      id: meta.id,
      name: String(versionInfo?.Browser || meta.name || "Chromium").trim(),
      browserVersion: String(versionInfo?.Browser || ""),
      httpEndpoint: originUrl.origin,
      webSocketDebuggerUrl: browserWs,
      targets,
    };
  };

  if (String(endpoint || "").trim()) {
    const checked = isLoopbackCdpUrl(endpoint);
    if (!checked.ok || !checked.url) {
      return { ok: false, error: checked.error, browsers: [] };
    }
    const url = checked.url;
    const httpOrigin = `http://${url.host}`;
    const fallbackWs = url.protocol === "ws:" ? url.toString() : "";
    const found = await probeEndpoint(httpOrigin, { id: "custom", name: "外部浏览器", fallbackWsUrl: fallbackWs });
    if (!found) {
      return {
        ok: false,
        error: `无法连接到本机调试地址 ${endpoint}。请确认浏览器已开启远程调试端口（例如 --remote-debugging-port=${url.port || 9222}）。`,
        browsers: [],
      };
    }
    return { ok: true, browsers: [found] };
  }

  const candidates = new Map<string, { httpOrigin: string; id: string; name: string; fallbackWsUrl?: string }>();
  const dirs = await listBrowserDirs().catch(() => []);
  const activePorts = await Promise.all(
    dirs.map(async (dir) => ({ dir, active: await readDevToolsActivePort(dir.userDataDir) })),
  );
  for (const { dir, active } of activePorts) {
    if (!active) continue;
    const httpOrigin = `http://127.0.0.1:${active.port}`;
    if (!candidates.has(httpOrigin)) {
      candidates.set(httpOrigin, {
        httpOrigin,
        id: dir.id,
        name: dir.name,
        fallbackWsUrl: `ws://127.0.0.1:${active.port}${active.wsPath}`,
      });
    }
  }
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const httpOrigin = `http://127.0.0.1:${port}`;
    if (!candidates.has(httpOrigin)) {
      candidates.set(httpOrigin, { httpOrigin, id: `port-${port}`, name: `Chromium (${port})` });
    }
  }

  const probed = await Promise.all(
    [...candidates.values()].map((item) => probeEndpoint(item.httpOrigin, item)),
  );
  const browsers = probed.filter((item): item is DiscoveredExternalBrowser => Boolean(item));
  return { ok: true, browsers };
}

function decodeWsMessageData(data: any): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data ?? "");
}

export class ExternalCdpClient extends EventEmitter {
  wsUrl: string;
  createWebSocket: (url: string) => any;
  connectTimeoutMs: number;
  ws: any = null;
  attached = false;
  closed = false;
  nextId = 1;
  pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  connectPromise: Promise<void> | null = null;

  constructor(wsUrl: string, { createWebSocket, connectTimeoutMs = WS_CONNECT_TIMEOUT_MS }: { createWebSocket?: (url: string) => any; connectTimeoutMs?: number } = {}) {
    super();
    const checked = isLoopbackCdpUrl(wsUrl);
    if (!checked.ok || checked.url?.protocol !== "ws:") {
      throw new Error(checked.error || "无效的 CDP WebSocket 地址");
    }
    this.wsUrl = checked.url.toString();
    this.createWebSocket = createWebSocket || ((url: string) => new WebSocket(url));
    this.connectTimeoutMs = connectTimeoutMs;
  }

  isAttached(): boolean {
    return this.attached && !this.closed;
  }

  async connect(): Promise<void> {
    if (this.attached && !this.closed) return;
    if (this.closed) throw new Error("CDP 连接已关闭");
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = this.createWebSocket(this.wsUrl);
      this.ws = ws;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.close("连接外部浏览器调试通道超时");
        reject(new Error(`连接 CDP WebSocket 超时：${this.wsUrl}`));
      }, this.connectTimeoutMs);
      timer.unref?.();

      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.attached = true;
        resolve();
      };

      const onError = (err: any) => {
        const message = err?.message || err?.error?.message || "CDP WebSocket 连接失败";
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.attached = false;
          reject(new Error(message));
        }
      };

      const onClose = (event: any) => {
        clearTimeout(timer);
        const reason = String(event?.reason || "目标调试连接已断开");
        if (!settled) {
          settled = true;
          reject(new Error(reason));
        }
        this.handleDisconnect(reason);
      };

      const onMessage = (raw: any) => {
        const text = decodeWsMessageData(raw?.data !== undefined ? raw.data : raw);
        let msg: any;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (typeof msg.id === "number") {
          const entry = this.pending.get(msg.id);
          if (!entry) return;
          this.pending.delete(msg.id);
          if (msg.error) {
            entry.reject(new Error(`${msg.error.message || "CDP 命令失败"}${msg.error.code !== undefined ? ` (${msg.error.code})` : ""}`));
          } else {
            entry.resolve(msg.result ?? {});
          }
          return;
        }
        if (typeof msg.method === "string") {
          this.emit("message", {}, msg.method, msg.params || {}, String(msg.sessionId || ""));
        }
      };

      if (typeof ws.addEventListener === "function") {
        ws.addEventListener("open", onOpen);
        ws.addEventListener("error", onError);
        ws.addEventListener("close", onClose);
        ws.addEventListener("message", onMessage);
      } else if (typeof ws.on === "function") {
        ws.on("open", onOpen);
        ws.on("error", onError);
        ws.on("close", onClose);
        ws.on("message", onMessage);
      } else {
        ws.onopen = onOpen;
        ws.onerror = onError;
        ws.onclose = onClose;
        ws.onmessage = onMessage;
      }
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private handleDisconnect(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.attached = false;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.reject(new Error(reason || "CDP 连接已断开"));
    }
    this.emit("detach", {}, reason);
  }

  async sendCommand(method: string, params: Record<string, any> = {}, sessionId?: string): Promise<any> {
    if (this.closed) throw new Error("CDP 连接已关闭");
    if (!this.attached) await this.connect();
    if (this.closed || !this.ws) throw new Error("CDP 连接不可用");

    const id = this.nextId++;
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    });

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(payload);
      } catch (error: any) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(reason = "已主动断开 CDP 连接") {
    if (this.closed) return;
    const ws = this.ws;
    this.handleDisconnect(reason);
    this.ws = null;
    try {
      ws?.close?.();
    } catch {
      // 忽略关闭异常
    }
  }
}

export class ExternalCdpWebContents extends EventEmitter {
  id: number;
  client: ExternalCdpClient;
  targetId: string;
  baseSessionId: string;
  currentUrl: string;
  currentTitle: string;
  destroyed = false;
  attached = false;
  domainsEnabled = false;
  navCanGoBack = false;
  navCanGoForward = false;
  navigationHistory: {
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
  };
  debugger: {
    isAttached: () => boolean;
    attach: () => void;
    detach: () => void;
    sendCommand: (method: string, params?: Record<string, any>, sessionId?: string) => Promise<any>;
    on: (event: string, listener: (...args: any[]) => void) => any;
    removeListener: (event: string, listener: (...args: any[]) => void) => any;
  };
  private clientMessageHandler: (_e: any, method: string, params: any, sessionId: string) => void;
  private clientDetachHandler: (_e: any, reason: string) => void;

  constructor({
    client,
    targetId = "",
    sessionId = "",
    url = "",
    title = "",
  }: {
    client: ExternalCdpClient;
    targetId?: string;
    sessionId?: string;
    url?: string;
    title?: string;
  }) {
    super();
    this.id = nextExternalWebContentsId++;
    this.client = client;
    this.targetId = targetId;
    this.baseSessionId = sessionId;
    this.currentUrl = url;
    this.currentTitle = title;

    const debuggerEmitter = new EventEmitter();

    this.clientMessageHandler = (_e: any, method: string, params: any, incomingSessionId: string) => {
      if (this.destroyed) return;
      if (this.baseSessionId && incomingSessionId !== this.baseSessionId) return;
      debuggerEmitter.emit("message", {}, method, params, incomingSessionId);

      if (method === "Page.frameNavigated" && !params?.frame?.parentId) {
        const nextUrl = String(params?.frame?.url || "");
        if (nextUrl) this.currentUrl = nextUrl;
        this.emit("did-navigate", {}, this.currentUrl);
        void this.refreshNavigationHistory();
      } else if (method === "Page.navigatedWithinDocument") {
        const nextUrl = String(params?.url || "");
        if (nextUrl) this.currentUrl = nextUrl;
        this.emit("did-navigate-in-page", {}, this.currentUrl);
        void this.refreshNavigationHistory();
      } else if (method === "Page.loadEventFired") {
        this.emit("did-frame-finish-load", {}, true);
        void this.refreshMetadata();
      }
    };

    this.clientDetachHandler = (_e: any, reason: string) => {
      if (this.destroyed) return;
      this.attached = false;
      debuggerEmitter.emit("detach", {}, reason);
    };

    this.client.on("message", this.clientMessageHandler);
    this.client.on("detach", this.clientDetachHandler);

    this.debugger = {
      isAttached: () => !this.destroyed && this.attached && this.client.isAttached(),
      attach: () => {
        if (this.destroyed) throw new Error("目标页面已断开");
        this.attached = true;
      },
      detach: () => {
        this.attached = false;
      },
      sendCommand: async (method: string, params: Record<string, any> = {}, explicitSessionId?: string) => {
        if (this.destroyed) throw new Error("目标页面已断开");
        await this.ensureReady();
        const targetSession = explicitSessionId || this.baseSessionId || undefined;
        return this.client.sendCommand(method, params, targetSession);
      },
      on: (event: string, listener: (...args: any[]) => void) => debuggerEmitter.on(event, listener),
      removeListener: (event: string, listener: (...args: any[]) => void) => debuggerEmitter.removeListener(event, listener),
    };

    this.navigationHistory = {
      canGoBack: () => this.navCanGoBack,
      canGoForward: () => this.navCanGoForward,
      goBack: () => this.stepHistory(-1),
      goForward: () => this.stepHistory(1),
    };
  }

  private async ensureReady() {
    if (this.destroyed) throw new Error("目标页面已断开");
    if (!this.client.isAttached()) {
      await this.client.connect();
    }
    this.attached = true;
    if (!this.domainsEnabled) {
      this.domainsEnabled = true;
      const targetSession = this.baseSessionId || undefined;
      await Promise.allSettled([
        this.client.sendCommand("Page.enable", {}, targetSession),
        this.client.sendCommand("Runtime.enable", {}, targetSession),
      ]);
      await this.refreshMetadata();
      await this.refreshNavigationHistory();
    }
  }

  async refreshMetadata() {
    if (this.destroyed || !this.client.isAttached()) return;
    try {
      const targetSession = this.baseSessionId || undefined;
      const res = await this.client.sendCommand(
        "Runtime.evaluate",
        { expression: "({ url: location.href, title: document.title })", returnByValue: true },
        targetSession,
      );
      const val = res?.result?.value;
      if (val && typeof val === "object") {
        if (val.url) this.currentUrl = String(val.url);
        if (typeof val.title === "string") this.currentTitle = val.title;
      }
    } catch {
      // 忽略元信息同步失败
    }
  }

  async refreshNavigationHistory() {
    if (this.destroyed || !this.client.isAttached()) return;
    try {
      const targetSession = this.baseSessionId || undefined;
      const history = await this.client.sendCommand("Page.getNavigationHistory", {}, targetSession);
      const entries = Array.isArray(history?.entries) ? history.entries : [];
      const index = Number(history?.currentIndex);
      if (Number.isInteger(index)) {
        this.navCanGoBack = index > 0;
        this.navCanGoForward = index >= 0 && index < entries.length - 1;
        const current = entries[index];
        if (current?.url) this.currentUrl = String(current.url);
        if (typeof current?.title === "string") this.currentTitle = current.title;
      }
    } catch {
      // 忽略历史读取失败
    }
  }

  private async stepHistory(delta: -1 | 1) {
    const targetSession = this.baseSessionId || undefined;
    const history = await this.client.sendCommand("Page.getNavigationHistory", {}, targetSession);
    const entries = Array.isArray(history?.entries) ? history.entries : [];
    const nextIndex = Number(history?.currentIndex) + delta;
    const entry = entries[nextIndex];
    if (!entry) return;
    await this.client.sendCommand("Page.navigateToHistoryEntry", { entryId: entry.id }, targetSession);
    await this.refreshNavigationHistory();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getURL(): string {
    return this.currentUrl;
  }

  getTitle(): string {
    return this.currentTitle;
  }

  async loadURL(rawUrl: string): Promise<void> {
    const check = isSafeBrowserUrl(rawUrl);
    if (!check.ok) throw new Error(check.error);
    await this.ensureReady();
    const targetUrl = check.url.toString();
    const targetSession = this.baseSessionId || undefined;
    this.emit("did-start-navigation", {}, targetUrl);
    const nav = await this.client.sendCommand("Page.navigate", { url: targetUrl }, targetSession);
    if (nav?.errorText) {
      throw new Error(`网页加载失败：${nav.errorText}`);
    }
    this.currentUrl = targetUrl;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !this.destroyed) {
      try {
        const ready = await this.client.sendCommand(
          "Runtime.evaluate",
          { expression: "document.readyState", returnByValue: true },
          targetSession,
        );
        if (ready?.result?.value === "interactive" || ready?.result?.value === "complete") break;
      } catch {
        // 页面正在跳转中，稍候重试
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await this.refreshMetadata();
    await this.refreshNavigationHistory();
    this.emit("did-navigate", {}, this.currentUrl);
  }

  async reload(): Promise<void> {
    await this.ensureReady();
    await this.client.sendCommand("Page.reload", {}, this.baseSessionId || undefined);
    await this.refreshMetadata();
    this.emit("did-navigate", {}, this.currentUrl);
  }

  async executeJavaScript(code: string, userGesture = false): Promise<any> {
    await this.ensureReady();
    const res = await this.client.sendCommand(
      "Runtime.evaluate",
      {
        expression: String(code),
        awaitPromise: true,
        returnByValue: true,
        userGesture: Boolean(userGesture),
      },
      this.baseSessionId || undefined,
    );
    if (res?.exceptionDetails) {
      const msg =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        "页面脚本执行出错";
      throw new Error(msg);
    }
    return res?.result?.value;
  }

  async capturePage() {
    await this.ensureReady();
    const res = await this.client.sendCommand(
      "Page.captureScreenshot",
      { format: "png", fromSurface: true },
      this.baseSessionId || undefined,
    );
    const buf = typeof res?.data === "string" && res.data ? Buffer.from(res.data, "base64") : Buffer.alloc(0);
    const size = parsePngSize(buf);
    return {
      isEmpty: () => buf.length === 0,
      getSize: () => size,
      toPNG: () => buf,
    };
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.attached = false;
    this.client.removeListener("message", this.clientMessageHandler);
    this.client.removeListener("detach", this.clientDetachHandler);
    this.emit("destroyed");
  }
}

export class ExternalBrowserSurface {
  discoverImpl: typeof discoverExternalCdpBrowsers;
  createWebSocket?: (url: string) => any;
  browserClient: ExternalCdpClient | null = null;
  pageClient: ExternalCdpClient | null = null;
  browserInfo: DiscoveredExternalBrowser | null = null;
  tabs = new Map<string, { id: string; title: string; url: string; contents: ExternalCdpWebContents }>();
  discoveredTargets = new Map<string, { id: string; title: string; url: string }>();
  activeId = "";
  disposed = false;

  constructor({
    discoverImpl = discoverExternalCdpBrowsers,
    createWebSocket,
  }: {
    discoverImpl?: typeof discoverExternalCdpBrowsers;
    createWebSocket?: (url: string) => any;
  } = {}) {
    this.discoverImpl = discoverImpl;
    this.createWebSocket = createWebSocket;
  }

  private pickBrowser(browsers: DiscoveredExternalBrowser[], query: string): DiscoveredExternalBrowser | undefined {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return browsers[0];
    return browsers.find((b) => b.id.toLowerCase() === q || b.name.toLowerCase().includes(q)) || browsers[0];
  }

  private pickTarget(targets: DiscoveredExternalTarget[], targetId: string): DiscoveredExternalTarget | undefined {
    const wanted = String(targetId || "").trim();
    if (wanted) return targets.find((t) => t.id === wanted);
    return (
      targets.find((t) => t.type === "page" && /^https?:\/\//i.test(t.url)) ||
      targets.find((t) => t.type === "page") ||
      targets[0]
    );
  }

  async connect({
    endpoint = "",
    browser = "",
    targetId = "",
  }: {
    endpoint?: string;
    browser?: string;
    targetId?: string;
  } = {}) {
    if (this.disposed) return { ok: false, result: "外部浏览器连接已关闭" };
    const discovery = await this.discoverImpl({ endpoint });
    if (!discovery.ok) {
      return { ok: false, result: discovery.error || "发现外部浏览器失败" };
    }
    if (!discovery.browsers.length) {
      return {
        ok: false,
        result:
          "未检测到开启远程调试的本机 Chromium 浏览器（Chrome / Edge 等）。请先以 `--remote-debugging-port=9222` 启动浏览器，或在浏览器内开启 `chrome://inspect/#remote-debugging`，然后传入 `endpoint`（如 `http://127.0.0.1:9222`）重试。",
      };
    }

    const chosen = this.pickBrowser(discovery.browsers, browser);
    if (!chosen) return { ok: false, result: "未匹配到指定的外部浏览器" };
    this.browserInfo = chosen;

    if (chosen.webSocketDebuggerUrl) {
      const client = new ExternalCdpClient(chosen.webSocketDebuggerUrl, { createWebSocket: this.createWebSocket });
      await client.connect();
      this.browserClient = client;

      client.on("message", (_e, method, params) => {
        if (method === "Target.targetCreated" || method === "Target.targetInfoChanged") {
          const info = params?.targetInfo;
          if (info?.type === "page" && info.targetId) {
            this.discoveredTargets.set(String(info.targetId), {
              id: String(info.targetId),
              title: String(info.title || ""),
              url: String(info.url || ""),
            });
          }
        } else if (method === "Target.targetDestroyed" && params?.targetId) {
          const deadId = String(params.targetId);
          this.discoveredTargets.delete(deadId);
          const existing = this.tabs.get(deadId);
          if (existing) {
            existing.contents.dispose();
            this.tabs.delete(deadId);
            if (this.activeId === deadId) this.activeId = this.tabs.keys().next().value || "";
          }
        }
      });
      await client.sendCommand("Target.setDiscoverTargets", { discover: true }).catch(() => {});

      const targetsRes = await client.sendCommand("Target.getTargets", {}).catch(() => null);
      const rawTargets: DiscoveredExternalTarget[] = Array.isArray(targetsRes?.targetInfos)
        ? targetsRes.targetInfos
            .filter((t: any) => t && t.type === "page")
            .map((t: any) => ({
              id: String(t.targetId || ""),
              title: String(t.title || ""),
              url: String(t.url || ""),
              type: "page",
              webSocketDebuggerUrl: "",
            }))
        : chosen.targets;
      for (const t of rawTargets) {
        if (t.id) this.discoveredTargets.set(t.id, { id: t.id, title: t.title, url: t.url });
      }

      const selected = this.pickTarget(rawTargets, targetId);
      if (!selected) {
        this.disconnect();
        return { ok: false, result: "已连接到外部浏览器，但未找到可操作的网页标签页" };
      }
      const attached = await client.sendCommand("Target.attachToTarget", { targetId: selected.id, flatten: true });
      const sessionId = String(attached?.sessionId || "");
      const contents = new ExternalCdpWebContents({
        client,
        targetId: selected.id,
        sessionId,
        url: selected.url,
        title: selected.title,
      });
      await contents.refreshMetadata();
      this.tabs.set(selected.id, { id: selected.id, title: contents.getTitle(), url: contents.getURL(), contents });
      this.activeId = selected.id;
      return { ok: true, contents, tabId: selected.id, browser: chosen };
    }

    const selected = this.pickTarget(chosen.targets, targetId);
    if (!selected?.webSocketDebuggerUrl) {
      return { ok: false, result: "外部浏览器未暴露可用的 WebSocket 调试地址" };
    }
    const client = new ExternalCdpClient(selected.webSocketDebuggerUrl, { createWebSocket: this.createWebSocket });
    await client.connect();
    this.pageClient = client;
    const contents = new ExternalCdpWebContents({
      client,
      targetId: selected.id || "page-0",
      url: selected.url,
      title: selected.title,
    });
    await contents.refreshMetadata();
    const tabKey = selected.id || "page-0";
    this.tabs.set(tabKey, { id: tabKey, title: contents.getTitle(), url: contents.getURL(), contents });
    this.activeId = tabKey;
    return { ok: true, contents, tabId: tabKey, browser: chosen };
  }

  async open(rawUrl: string, rawTabId = "") {
    const check = isSafeBrowserUrl(rawUrl);
    if (!check.ok) return { ok: false, result: check.error };
    const targetUrl = check.url.toString();
    const requested = String(rawTabId || "").trim();

    if (requested) {
      const activated = await this.activateTab(requested);
      if (!activated.ok || !activated.contents) return activated;
      await activated.contents.loadURL(targetUrl);
      const entry = this.tabs.get(requested);
      if (entry) {
        entry.url = activated.contents.getURL();
        entry.title = activated.contents.getTitle();
      }
      return { ok: true, contents: activated.contents, tabId: requested };
    }

    const current = this.tabs.get(this.activeId);
    if (current && (!current.contents.getURL() || current.contents.getURL() === "about:blank")) {
      await current.contents.loadURL(targetUrl);
      current.url = current.contents.getURL();
      current.title = current.contents.getTitle();
      return { ok: true, contents: current.contents, tabId: current.id };
    }

    if (this.browserClient?.isAttached()) {
      const created = await this.browserClient.sendCommand("Target.createTarget", { url: targetUrl });
      const newId = String(created?.targetId || "");
      if (!newId) return { ok: false, result: "无法在外部浏览器中创建新标签页" };
      const attached = await this.browserClient.sendCommand("Target.attachToTarget", { targetId: newId, flatten: true });
      const contents = new ExternalCdpWebContents({
        client: this.browserClient,
        targetId: newId,
        sessionId: String(attached?.sessionId || ""),
        url: targetUrl,
      });
      // 等待初始导航就绪
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try {
          const state = await contents.executeJavaScript("document.readyState");
          if (state === "interactive" || state === "complete") break;
        } catch {
          // 加载中
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await contents.refreshMetadata();
      this.tabs.set(newId, { id: newId, title: contents.getTitle(), url: contents.getURL(), contents });
      this.discoveredTargets.set(newId, { id: newId, title: contents.getTitle(), url: contents.getURL() });
      this.activeId = newId;
      return { ok: true, contents, tabId: newId };
    }

    if (current) {
      await current.contents.loadURL(targetUrl);
      current.url = current.contents.getURL();
      current.title = current.contents.getTitle();
      return { ok: true, contents: current.contents, tabId: current.id };
    }
    return { ok: false, result: "当前没有已连接的外部浏览器标签页" };
  }

  getContents() {
    const entry = this.tabs.get(this.activeId);
    return entry && !entry.contents.isDestroyed() ? entry.contents : null;
  }

  listTabs() {
    if (this.discoveredTargets.size > 0) {
      return [...this.discoveredTargets.values()].map((info) => {
        const attached = this.tabs.get(info.id);
        const contents = attached && !attached.contents.isDestroyed() ? attached.contents : null;
        return {
          id: info.id,
          title: contents?.getTitle() || info.title,
          url: contents?.getURL() || info.url,
          active: info.id === this.activeId,
          webContentsId: contents?.id || 0,
        };
      });
    }
    return [...this.tabs.values()]
      .filter((entry) => !entry.contents.isDestroyed())
      .map((entry) => ({
        id: entry.id,
        title: entry.contents.getTitle() || entry.title,
        url: entry.contents.getURL() || entry.url,
        active: entry.id === this.activeId,
        webContentsId: entry.contents.id,
      }));
  }

  async activateTab(tabId: string) {
    const id = String(tabId || "").trim();
    if (!id) return { ok: false, result: "请提供 tabId" };

    if (this.browserClient?.isAttached()) {
      await this.browserClient.sendCommand("Target.activateTarget", { targetId: id }).catch(() => {});
      let entry = this.tabs.get(id);
      if (!entry || entry.contents.isDestroyed()) {
        const targetsRes = await this.browserClient.sendCommand("Target.getTargets", {}).catch(() => null);
        const info = (targetsRes?.targetInfos || []).find((t: any) => String(t?.targetId || "") === id);
        if (!info) return { ok: false, result: `找不到标签页 ${id}` };
        const attached = await this.browserClient.sendCommand("Target.attachToTarget", { targetId: id, flatten: true });
        const contents = new ExternalCdpWebContents({
          client: this.browserClient,
          targetId: id,
          sessionId: String(attached?.sessionId || ""),
          url: String(info.url || ""),
          title: String(info.title || ""),
        });
        await contents.refreshMetadata();
        entry = { id, title: contents.getTitle(), url: contents.getURL(), contents };
        this.tabs.set(id, entry);
      }
      this.activeId = id;
      return { ok: true, contents: entry.contents, tab: { id, url: entry.contents.getURL() } };
    }

    const entry = this.tabs.get(id);
    if (!entry || entry.contents.isDestroyed()) return { ok: false, result: `找不到标签页 ${id}` };
    this.activeId = id;
    return { ok: true, contents: entry.contents, tab: { id, url: entry.contents.getURL() } };
  }

  async closeTab(tabId: string) {
    const id = String(tabId || "").trim();
    const entry = this.tabs.get(id);
    if (this.browserClient?.isAttached()) {
      const res = await this.browserClient.sendCommand("Target.closeTarget", { targetId: id }).catch(() => ({ success: false }));
      if (res?.success === false && !entry) return { ok: false, result: `找不到标签页 ${id}` };
    } else if (!entry) {
      return { ok: false, result: `找不到标签页 ${id}` };
    }
    if (entry) {
      entry.contents.dispose();
      this.tabs.delete(id);
    }
    this.discoveredTargets.delete(id);
    if (this.activeId === id) {
      this.activeId = this.tabs.keys().next().value || this.discoveredTargets.keys().next().value || "";
    }
    return { ok: true };
  }

  // 仅断开调试 WebSocket，绝不关闭用户的外部浏览器窗口或进程
  disconnect() {
    for (const entry of this.tabs.values()) {
      entry.contents.dispose();
    }
    this.tabs.clear();
    this.discoveredTargets.clear();
    this.activeId = "";
    this.browserClient?.close("已断开外部浏览器 CDP 连接");
    this.browserClient = null;
    this.pageClient?.close("已断开外部浏览器 CDP 连接");
    this.pageClient = null;
  }

  async dispose() {
    this.disposed = true;
    this.disconnect();
  }
}

export function createExternalBrowserAgent({
  ownerSessionId,
  runId,
  workspacePath = "",
  isFullCdpAccessEnabled = () => false,
  isScreenLocked = () => false,
  discoverImpl = discoverExternalCdpBrowsers,
  createWebSocket,
}: {
  ownerSessionId: string;
  runId: string;
  workspacePath?: string;
  isFullCdpAccessEnabled?: () => boolean;
  isScreenLocked?: () => boolean;
  discoverImpl?: typeof discoverExternalCdpBrowsers;
  createWebSocket?: (url: string) => any;
}) {
  const surface = new ExternalBrowserSurface({ discoverImpl, createWebSocket });
  const controlManager = new BrowserControlManager({ isScreenLocked });
  const agent = new BrowserAgent({
    surfaceLabel: "外部浏览器",
    supportsHandoff: false,
    controlManager,
    isFullCdpAccessEnabled,
    isScreenLocked,
    protectedBackground: false,
    openPanel: (url, tabId) => surface.open(url, tabId),
    closePanel: async () => {
      surface.disconnect();
      return { ok: true };
    },
    getContents: () => surface.getContents(),
    listTabs: () => surface.listTabs(),
    activateTab: (tabId) => surface.activateTab(tabId),
    closeTab: (tabId) => surface.closeTab(tabId),
  });
  agent.setContext({ ownerSessionId, runId });
  agent.setWorkspace(workspacePath);
  return { agent, surface };
}
