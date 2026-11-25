// 完整 CDP 访问门控、事件环形缓冲与后台隔离底线校验。
// 本文件不依赖 electron，方便在测试与独立浏览器适配器中复用。
import { promises as fs } from "node:fs";
import path from "node:path";
import { isSafeRelativePath } from "./agent/shared.mts";

export const CDP_ACCESS_DISABLED_MESSAGE =
  "当前未开启完整 CDP 访问权限。完整 CDP 访问权限可让 DYWorker 检查并控制敏感的浏览器内部功能，可能使你的数据面临风险。如需使用，请前往「设置 → 安全授权」手动开启。";

const MAX_RESULT_CHARS = 32_000;
const MAX_EVENT_PARAMS_CHARS = 4_096;
const DEFAULT_CDP_TIMEOUT_MS = 15_000;
const MAX_CDP_TIMEOUT_MS = 60_000;

export function isValidCdpMethod(method: unknown): boolean {
  return typeof method === "string" && /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(method.trim());
}

/**
 * 后台独立浏览器的安全保护底线：禁止在开启完整 CDP 后关闭自身弹窗/文件选择器隔离或销毁宿主浏览器进程。
 */
export function isBackgroundProtectedCdpCall(method: string, params: Record<string, any> = {}): string | null {
  if (method === "Page.setInterceptFileChooserDialog" && params?.enabled === false) {
    return "后台浏览器禁止关闭文件选择器拦截保护";
  }
  if (method === "Page.removeScriptToEvaluateOnNewDocument") {
    return "后台浏览器禁止移除注入的页面安全防护脚本";
  }
  if (method === "Target.setAutoAttach" && params?.autoAttach === false) {
    return "后台浏览器禁止关闭子目标自动附加隔离";
  }
  if (method === "Browser.close" || method === "Browser.crash" || method === "Browser.crashGpuProcess") {
    return `后台浏览器禁止调用 ${method}`;
  }
  return null;
}

function summarizeEventParams(params: unknown): unknown {
  if (params === undefined || params === null) return params;
  try {
    const serialized = JSON.stringify(params);
    if (serialized.length <= MAX_EVENT_PARAMS_CHARS) return params;
    return {
      __truncated: true,
      totalChars: serialized.length,
      preview: serialized.slice(0, MAX_EVENT_PARAMS_CHARS),
    };
  } catch {
    return String(params).slice(0, MAX_EVENT_PARAMS_CHARS);
  }
}

export interface CdpBufferedEvent {
  seq: number;
  timestamp: string;
  method: string;
  sessionId?: string;
  params: unknown;
}

export class CdpEventRingBuffer {
  maxEvents: number;
  events: CdpBufferedEvent[] = [];
  nextSeq = 1;

  constructor(maxEvents = 300) {
    this.maxEvents = Math.max(10, Number(maxEvents) || 300);
  }

  push(method: string, params: unknown, sessionId?: string): CdpBufferedEvent {
    const entry: CdpBufferedEvent = {
      seq: this.nextSeq++,
      timestamp: new Date().toISOString(),
      method: String(method || ""),
      ...(sessionId ? { sessionId: String(sessionId) } : {}),
      params: summarizeEventParams(params),
    };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    return entry;
  }

  query({ methodPrefix = "", sinceSeq = 0, limit = 50 }: { methodPrefix?: string; sinceSeq?: number; limit?: number } = {}) {
    const prefix = String(methodPrefix || "").trim();
    const minSeq = Number.isFinite(Number(sinceSeq)) ? Math.max(0, Number(sinceSeq)) : 0;
    const cap = Math.min(200, Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 50));
    const filtered = this.events.filter((item) => {
      if (minSeq > 0 && item.seq <= minSeq) return false;
      if (prefix && !item.method.startsWith(prefix)) return false;
      return true;
    });
    const items = filtered.slice(-cap);
    const latestSeq = this.nextSeq - 1;
    return { items, totalMatched: filtered.length, latestSeq };
  }

  clear() {
    this.events = [];
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function persistCdpBinaryField(
  result: any,
  saveToPath: string,
  workspacePath: string,
): Promise<{ savedPath?: string; bytes?: number; scrubbed: any; error?: string }> {
  const trimmed = String(saveToPath || "").trim();
  if (!trimmed) return { scrubbed: result };
  if (!workspacePath) {
    return { scrubbed: result, error: "当前没有绑定工作区目录，无法保存 CDP 二进制输出" };
  }
  if (!isSafeRelativePath(trimmed)) {
    return { scrubbed: result, error: `不安全的相对保存路径：${trimmed}` };
  }
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, trimmed);
  if (!target.startsWith(root + path.sep)) {
    return { scrubbed: result, error: "保存路径超出工作区范围" };
  }
  const base64 = typeof result?.data === "string" ? result.data : "";
  if (!base64) {
    return { scrubbed: result, error: "CDP 返回结果中不包含可落盘的 base64 data 字段" };
  }
  const buffer = Buffer.from(base64, "base64");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  const { data: _omitted, ...rest } = result;
  return {
    savedPath: path.relative(root, target),
    bytes: buffer.length,
    scrubbed: { ...rest, dataSavedTo: path.relative(root, target), bytes: buffer.length },
  };
}

function formatJsonClipped(value: unknown): string {
  if (value === undefined) return "{}";
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n……（返回内容共 ${text.length} 字符，已截断）`;
}

export async function executeCdpTool(
  adapter: any,
  args: Record<string, any> = {},
  {
    isFullCdpAccessEnabled,
    protectedBackground = false,
    workspacePath = "",
    signal,
    checkLease,
  }: {
    isFullCdpAccessEnabled: () => boolean;
    protectedBackground?: boolean;
    workspacePath?: string;
    signal?: AbortSignal;
    checkLease?: () => boolean;
  },
) {
  if (typeof isFullCdpAccessEnabled !== "function" || !isFullCdpAccessEnabled()) {
    return {
      ok: false,
      errorCode: "CDP_ACCESS_DISABLED",
      result: CDP_ACCESS_DISABLED_MESSAGE,
    };
  }

  if (!adapter || adapter.isDestroyed?.()) {
    return { ok: false, errorCode: "TARGET_UNAVAILABLE", result: "当前没有可用的浏览器调试会话" };
  }

  const action = String(args?.action || "send").trim() || "send";
  if (action === "clear_events") {
    adapter.clearCdpEvents?.();
    return { ok: true, result: "已清空当前会话的 CDP 事件缓冲。" };
  }

  if (action === "events") {
    const res = adapter.readCdpEvents?.({
      methodPrefix: args?.methodPrefix,
      sinceSeq: args?.sinceSeq,
      limit: args?.limit,
    }) || { items: [], totalMatched: 0, latestSeq: 0 };
    const summary = res.items.length
      ? `已读取 ${res.items.length} 条 CDP 事件（最新序号 latestSeq=${res.latestSeq}，匹配总数 ${res.totalMatched}）：\n${formatJsonClipped(res.items)}`
      : `当前没有匹配的 CDP 事件（最新序号 latestSeq=${res.latestSeq}）。请确认已先通过对应 Domain.enable 开启事件推送。`;
    return { ok: true, result: summary, data: res };
  }

  if (action !== "send") {
    return { ok: false, errorCode: "INVALID_ARGUMENT", result: `未知的 CDP 操作类型：${action}` };
  }

  const method = String(args?.method || "").trim();
  if (!isValidCdpMethod(method)) {
    return {
      ok: false,
      errorCode: "INVALID_ARGUMENT",
      result: "CDP method 格式无效，须为 Domain.command 形式（例如 Runtime.evaluate、Network.enable）。",
    };
  }

  const params = args?.params === undefined ? {} : args.params;
  if (!isPlainObject(params)) {
    return { ok: false, errorCode: "INVALID_ARGUMENT", result: "CDP params 必须是 JSON 对象。" };
  }

  const rawTimeout = args?.timeoutMs === undefined ? DEFAULT_CDP_TIMEOUT_MS : Number(args.timeoutMs);
  if (!Number.isFinite(rawTimeout) || rawTimeout <= 0 || rawTimeout > MAX_CDP_TIMEOUT_MS) {
    return {
      ok: false,
      errorCode: "INVALID_ARGUMENT",
      result: `timeoutMs 必须在 1 到 ${MAX_CDP_TIMEOUT_MS} 毫秒之间。`,
    };
  }

  if (protectedBackground) {
    const blocked = isBackgroundProtectedCdpCall(method, params);
    if (blocked) {
      return { ok: false, errorCode: "CDP_PROTECTED_CALL", result: blocked };
    }
  }

  const sessionId = typeof args?.sessionId === "string" && args.sessionId.trim() ? args.sessionId.trim() : undefined;

  const rawResult = await adapter.sendCDP(method, params, {
    signal,
    checkLease,
    sessionId,
    timeoutMs: Math.round(rawTimeout),
    onDispatch: adapter?.lastInputState
      ? () => {
          if (method === "Input.dispatchMouseEvent") {
            if (params.type === "mousePressed") {
              adapter.lastInputState.mouseDown = {
                x: Number(params.x) || 0,
                y: Number(params.y) || 0,
                button: typeof params.button === "string" ? params.button : "left",
                clickCount: Number(params.clickCount) || 1,
                ...(params.modifiers !== undefined ? { modifiers: Number(params.modifiers) || 0 } : {}),
              };
            } else if (params.type === "mouseReleased") {
              adapter.lastInputState.mouseDown = null;
            }
          } else if (method === "Input.dispatchKeyEvent") {
            if (params.type === "keyDown" || params.type === "rawKeyDown") {
              adapter.lastInputState.keyDown = {
                fromRawCdp: true,
                ...(params.key ? { key: String(params.key) } : {}),
                ...(params.code ? { code: String(params.code) } : {}),
                ...(params.windowsVirtualKeyCode !== undefined ? { windowsVirtualKeyCode: Number(params.windowsVirtualKeyCode) } : {}),
                ...(params.nativeVirtualKeyCode !== undefined ? { nativeVirtualKeyCode: Number(params.nativeVirtualKeyCode) } : {}),
                ...(params.modifiers !== undefined ? { modifiers: Number(params.modifiers) || 0 } : {}),
              };
            } else if (params.type === "keyUp") {
              adapter.lastInputState.keyDown = null;
            }
          }
        }
      : undefined,
  });

  if (args?.saveToPath) {
    const saved = await persistCdpBinaryField(rawResult, String(args.saveToPath), workspacePath);
    if (saved.error) {
      return { ok: false, errorCode: "SAVE_FAILED", result: saved.error };
    }
    return {
      ok: true,
      result: `已执行 ${method}，二进制数据已保存到工作区：${saved.savedPath}（${saved.bytes} 字节）。\n${formatJsonClipped(saved.scrubbed)}`,
      data: saved.scrubbed,
    };
  }

  return {
    ok: true,
    result: `已执行 ${method}：\n${formatJsonClipped(rawResult)}`,
    data: rawResult,
  };
}
