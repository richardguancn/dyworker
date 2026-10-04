// 两个"本机没装/装了也断链"的 DSH 客户端模块的兼容实现（方案 B：不依赖 DSH 的包）。
//
// 导出清单不是猜的：扫描本机 43 个 DSH 客户端模块，统计它们对这些模块的**属性访问**得到。
//
//   @deepseek-ai/dsh-client-ui-slots          4 个使用方
//     resolveSlotLabel / SlotOwnershipError / StaleAuthorizationError
//   @deepseek-ai/dsh-client-runtime/client   21 个使用方，共 19 个导出
//     createSnapshotStore(12) defineStore(5) emptyAssistantBlock(2) resolveWorkspacePath(2)
//     shallowEqual(2) isAppendSurfaceEvent(2) toAssistantBlocks(2) isTokenDelta(2)
//     toAssistantBlock(2) contextForm(2) displayFailureMessage(2) contextProvenance(2)
//     indexSubagentDescendants(2) abbreviateHomePath(2) conversationContextKey
//     workspaceTitleOf sessionRecallLabels isReplacementSurfaceEvent DirectoryBrowseError
//
// 策略：能忠实实现的就忠实实现（状态原语、比较、路径、错误类），
// 领域助手给"安全默认值"（不抛错、返回空值），未知导出用 Proxy 兜底并记名——
// 目标是让模块能加载、界面能起来，而不是假装完整复刻 DSH。

type UnknownReporter = (module: string, name: string) => void;

function createStore(initial: unknown) {
  let value = initial;
  const listeners = new Set<(next: unknown) => void>();
  const store: any = {
    get: () => value,
    getState: () => value,
    snapshot: () => value,
    getSnapshot: () => value,
    set: (next: unknown) => {
      value = typeof next === "function" ? (next as (current: unknown) => unknown)(value) : next;
      for (const listener of listeners) listener(value);
    },
    update: (updater: (current: unknown) => unknown) => store.set(updater),
    subscribe: (listener: (next: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => listeners.clear(),
  };
  return store;
}

class ShimError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** @deepseek-ai/dsh-client-ui-slots 的兼容实现 */
export function createSlotsModuleShim(report: UnknownReporter = () => {}): Record<string, any> {
  const base: Record<string, any> = {
    // 插槽标签：优先取函数形态的 label，其次字符串，最后退回插槽名
    resolveSlotLabel: (meta: any, fallback?: string) => {
      const label = meta?.label;
      if (typeof label === "function") {
        try {
          return String(label());
        } catch {
          return String(fallback ?? meta?.name ?? "");
        }
      }
      return String(label ?? fallback ?? meta?.name ?? "");
    },
    SlotOwnershipError: class SlotOwnershipError extends ShimError {},
    StaleAuthorizationError: class StaleAuthorizationError extends ShimError {},
  };
  return new Proxy(base, {
    get(target, prop) {
      const key = String(prop);
      if (key in target) return target[key];
      if (key === "__esModule" || key === "then" || typeof prop === "symbol") return undefined;
      report("@deepseek-ai/dsh-client-ui-slots", key);
      // 未知导出给一个"什么都能当"的宽松函数
      return (..._args: unknown[]) => undefined;
    },
    has: () => true,
  });
}

/** @deepseek-ai/dsh-client-runtime/client 的兼容实现 */
export function createRuntimeClientShim(report: UnknownReporter = () => {}): Record<string, any> {
  const base: Record<string, any> = {
    // ---- 状态原语：忠实实现 ----
    defineStore: (initial: unknown) => createStore(typeof initial === "function" ? (initial as () => unknown)() : initial),
    createSnapshotStore: (getSnapshot: () => unknown, subscribe?: (listener: () => void) => () => void) => {
      const store = createStore(undefined);
      return {
        ...store,
        get: getSnapshot,
        getState: getSnapshot,
        getSnapshot,
        snapshot: getSnapshot,
        subscribe: subscribe || store.subscribe,
      };
    },

    // ---- 纯函数：忠实实现 ----
    shallowEqual: (a: any, b: any) => {
      if (a === b) return true;
      if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      return keysA.every((key) => Object.is(a[key], b[key]));
    },
    abbreviateHomePath: (value: string, home?: string) => {
      const text = String(value ?? "");
      const prefix = String(home || (globalThis as any)?.process?.env?.HOME || "");
      return prefix && text.startsWith(prefix) ? `~${text.slice(prefix.length)}` : text;
    },
    resolveWorkspacePath: (value: unknown) => (typeof value === "string" ? value : String((value as any)?.path ?? "")),
    workspaceTitleOf: (workspace: any) => String(workspace?.title ?? workspace?.name ?? workspace?.path ?? ""),
    conversationContextKey: (value: any) => String(value?.sessionId ?? value?.id ?? ""),
    sessionRecallLabels: () => [],

    // ---- 领域助手：安全默认值（不抛错，返回空/假） ----
    isAppendSurfaceEvent: () => false,
    isReplacementSurfaceEvent: () => false,
    isTokenDelta: () => false,
    toAssistantBlock: (value: unknown) => (value && typeof value === "object" ? value : { content: "" }),
    toAssistantBlocks: (value: unknown) => (Array.isArray(value) ? value : []),
    emptyAssistantBlock: () => ({ content: "" }),
    contextForm: () => null,
    contextProvenance: () => null,
    displayFailureMessage: (error: unknown) => String((error as any)?.message || error || ""),
    indexSubagentDescendants: () => new Map(),

    // ---- 错误类 ----
    DirectoryBrowseError: class DirectoryBrowseError extends ShimError {},
  };
  return new Proxy(base, {
    get(target, prop) {
      const key = String(prop);
      if (key in target) return target[key];
      if (key === "__esModule" || key === "then" || typeof prop === "symbol") return undefined;
      report("@deepseek-ai/dsh-client-runtime/client", key);
      return (..._args: unknown[]) => undefined;
    },
    has: () => true,
  });
}

/** 这两个模块是否由宿主自己兜底提供 */
export const SHIMMED_CLIENT_MODULES = [
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-runtime/client",
] as const;
