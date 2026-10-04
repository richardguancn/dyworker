// 客户端插件宿主：在渲染端起一个 cordis 容器，把插件声明的客户端服务提供出来。
//
// 关键事实（从真实 bundle 反推，不是猜的）：
//   - 插件 bundle 的 module.exports 就是一个 **cordis 插件**：{ name, inject, apply }
//   - 它 inject 的是**服务名**，不是包名：dsh-context 要 ["slots","locale"]，
//     dsh-better-sidebar 要 ["slots","sessions","connection","workspaces","locale"]
//   - 插槽 API：ctx.slots.inject(名字, () => ctx.slots.register(meta, 组件))
//     实测插槽名：sidebar.right.pane.tab（右侧面板标签）、conversation.view、
//     conversation.chat.turnTail、conversation.chat.assistant-actions、
//     conversation.input.overlay、settings.section
//   - 文案 API：ctx.locale.register(ns, {zh,en}) / register(ns, 语言, 词表) / bind(ns) → t
//
// 只声明**我们真的会渲染**的插槽：slots.inject 只在宿主提供该插槽时执行注册，
// 因此插件里那些我们还没接的位置会自动跳过，不会报错、也不会出现"注册了但没人渲染"。

import { Context } from "@deepseek-ai/cordis";

export interface SlotMeta {
  name: string;
  /** 同一个插槽里多个贡献者用 id / key 区分 */
  id?: string;
  key?: string;
  order?: number;
  priority?: number;
  label?: unknown;
  locale?: string;
  select?: unknown;
  inject?: unknown;
  registrant?: string;
  [key: string]: unknown;
}

export interface SlotContribution {
  slot: string;
  meta: SlotMeta;
  /** 插件给的组件（React 组件或返回 React 元素的函数） */
  component: unknown;
  /** 注册顺序，用于稳定排序 */
  sequence: number;
}

export interface PluginLoadRecord {
  id: string;
  ok: boolean;
  error?: string;
  /** 这个插件最终注册进哪些插槽 */
  slots: string[];
  /** 它调用过但我们未实现的服务方法（下一步要补什么，直接看这里） */
  missingCalls: string[];
}

/** 宿主真正渲染的插槽。没列在这里的插槽，插件的 inject 会自动跳过。 */
export const HOST_SLOTS = [
  // 会话区的视图标签（dsh-context 默认位置就是这里）
  "conversation.view",
  // 右侧面板的标签（我们的工具面板就是它）
  "sidebar.right.pane.tab",
  "sidebar.right.pane.tab.title",
  // 设置页分区
  "settings.section",
] as const;

type Listener = () => void;

export interface ClientHostOptions {
  locale?: string;
  slots?: readonly string[];
  /** 诊断：插件调用了未实现的服务方法 */
  onMissingCall?: (service: string, method: string) => void;
  /**
   * 插件要求打开右侧面板标签时回调（kind 即插槽贡献里的 key）。
   * 壳层据此在**已有的工具面板**里开标签——这正是 sidebarRight.openTab 的语义。
   */
  onPanelRequest?: (kind: string, detail?: unknown) => void;
}

export class ClientPluginHost {
  readonly ctx: Context;
  readonly localeCode: string;
  readonly availableSlots: Set<string>;

  private readonly contributions = new Map<string, SlotContribution[]>();
  private readonly listeners = new Set<Listener>();
  private readonly dictionaries = new Map<string, Record<string, Record<string, unknown>>>();
  private readonly records: PluginLoadRecord[] = [];
  private sequence = 0;
  private readonly fibers: any[] = [];

  constructor(options: ClientHostOptions = {}) {
    this.localeCode = options.locale || "zh";
    this.availableSlots = new Set(options.slots || HOST_SLOTS);
    this.ctx = new Context();

    // 未实现的服务方法：记下来（这就是"下一步要补什么"的清单），不抛错打断插件
    const recordMissing = (service: string, method: string) => {
      options.onMissingCall?.(service, method);
      for (const record of this.records) {
        const key = `${service}.${method}`;
        if (!record.missingCalls.includes(key)) record.missingCalls.push(key);
      }
    };

    this.ctx.provide("slots", {
      inject: (name: string, factory: () => unknown) => this.injectSlot(name, factory),
      register: (meta: SlotMeta, component: unknown) => this.registerSlot(meta, component),
      has: (name: string) => this.availableSlots.has(String(name)),
    });

    this.ctx.provide("locale", {
      register: (ns: string, a: unknown, b?: unknown) => this.registerLocale(ns, a, b),
      bind: (ns: string) => this.bindLocale(ns),
      getLocale: () => this.localeCode,
      getSnapshot: () => ({ locale: this.localeCode }),
      subscribe: (fn: Listener) => { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    });

    // 会话 / 连接 / 工作区：先把 inject 满足（否则插件根本不会 apply），
    // 方法按需补——插件用到未实现的方法会记进 missingCalls，而不是静默失效
    this.ctx.provide("sessions", this.stubService("sessions", {
      scope: () => this.stubService("sessions.scope", {}),
      refresh: () => undefined,
      list: () => [],
      current: () => null,
    }));
    this.ctx.provide("connection", this.stubService("connection", {
      scope: () => this.stubService("connection.scope", {}),
      status: () => ({ state: "connected" }),
    }));
    // sidebarRight：插件用它打开右侧面板（实测 API：openTab(kind) / openResource(address)）。
    // 直接接我们已有的工具面板，而不是另造容器。
    this.ctx.provide("sidebarRight", {
      openTab: (kind: string) => { options.onPanelRequest?.(String(kind || "")); return true; },
      openResource: (address: unknown) => { options.onPanelRequest?.("", address); return true; },
      closeTab: () => undefined,
      has: (kind: string) => this.availableSlots.has(String(kind)),
    });

    // uiConversation：实测只用 imageUrl(sessionId, attachment) 取附件图地址
    this.ctx.provide("uiConversation", {
      imageUrl: () => undefined,
      openSession: () => undefined,
      scope: () => this.stubService("uiConversation.scope", {}),
    });

    this.ctx.provide("workspaces", this.stubService("workspaces", {
      scope: () => this.stubService("workspaces.scope", {}),
      list: () => [],
      current: () => null,
    }));
  }

  /** 未实现的服务：已知方法按 stub 走，未知方法记名后返回 undefined（不抛错） */
  private stubService(name: string, methods: Record<string, unknown>) {
    return new Proxy(methods, {
      get: (target, prop) => {
        const key = String(prop);
        if (key in target) return target[key];
        if (key === "then" || typeof prop === "symbol") return undefined;
        return (..._args: unknown[]) => {
          this.noteMissingCall(name, key);
          return undefined;
        };
      },
    });
  }

  private noteMissingCall(service: string, method: string) {
    const record = this.records[this.records.length - 1];
    const key = `${service}.${method}`;
    if (record && !record.missingCalls.includes(key)) record.missingCalls.push(key);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  /** slots.inject：只有当宿主提供该插槽时才执行注册回调 */
  private injectSlot(name: string, factory: () => unknown) {
    const slot = String(name || "");
    if (!this.availableSlots.has(slot)) return () => undefined;
    const dispose = factory();
    return typeof dispose === "function" ? (dispose as () => void) : () => undefined;
  }

  /** slots.register：登记一个界面贡献 */
  private registerSlot(meta: SlotMeta, component: unknown) {
    const slot = String(meta?.name || "");
    if (!slot) return () => undefined;
    const contribution: SlotContribution = { slot, meta: { ...meta }, component, sequence: this.sequence++ };
    const list = this.contributions.get(slot) || [];
    list.push(contribution);
    this.contributions.set(slot, list);
    const record = this.records[this.records.length - 1];
    if (record && !record.slots.includes(slot)) record.slots.push(slot);
    this.notify();
    return () => {
      const current = this.contributions.get(slot) || [];
      this.contributions.set(slot, current.filter((item) => item !== contribution));
      this.notify();
    };
  }

  /** locale.register：兼容 register(ns, {zh,en}) 与 register(ns, 语言, 词表) 两种形态 */
  private registerLocale(ns: string, a: unknown, b?: unknown) {
    const key = String(ns || "");
    const table = this.dictionaries.get(key) || {};
    if (b === undefined && a && typeof a === "object") {
      for (const [lang, dict] of Object.entries(a as Record<string, unknown>)) {
        table[lang] = { ...(table[lang] || {}), ...(dict as Record<string, unknown>) };
      }
    } else if (typeof a === "string") {
      table[a] = { ...(table[a] || {}), ...((b as Record<string, unknown>) || {}) };
    }
    this.dictionaries.set(key, table);
    this.notify();
    return () => undefined;
  }

  /** locale.bind(ns)：返回 t(key, params) */
  private bindLocale(ns: string) {
    const key = String(ns || "");
    return (text: string, params?: Record<string, unknown>) => {
      const table = this.dictionaries.get(key) || {};
      const dict = table[this.localeCode] || table.zh || table.en || {};
      let value = String(dict[text] ?? text);
      if (params) {
        for (const [name, replacement] of Object.entries(params)) {
          value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(replacement));
        }
      }
      return value;
    };
  }

  /**
   * 加载一个插件（bundle 的 module.exports）。
   * 失败记录在返回值里，不向上抛：第三方代码出错不该带崩宿主界面。
   */
  async load(plugin: any, id: string): Promise<PluginLoadRecord> {
    const record: PluginLoadRecord = { id: String(id || plugin?.name || ""), ok: false, slots: [], missingCalls: [] };
    this.records.push(record);
    try {
      const fiber = this.ctx.plugin(plugin as any);
      this.fibers.push(fiber);
      // cordis 的 plugin 是异步生效的：fiber 是 thenable，await 到它就代表启动完成
      await Promise.resolve(fiber);
      record.ok = true;
    } catch (error: any) {
      record.error = String(error?.message || error);
    }
    return record;
  }

  records_(): PluginLoadRecord[] {
    return this.records.map((record) => ({ ...record, slots: [...record.slots], missingCalls: [...record.missingCalls] }));
  }

  contributionsFor(slot: string): SlotContribution[] {
    const list = [...(this.contributions.get(String(slot)) || [])];
    return list.sort((a, b) => {
      const orderA = Number(a.meta.order ?? 0);
      const orderB = Number(b.meta.order ?? 0);
      if (orderA !== orderB) return orderA - orderB;
      const priorityA = Number(a.meta.priority ?? 0);
      const priorityB = Number(b.meta.priority ?? 0);
      if (priorityA !== priorityB) return priorityB - priorityA;
      return a.sequence - b.sequence;
    });
  }

  slotNames(): string[] {
    return [...this.contributions.keys()];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.contributorCleanup();
    // 卸载插件 fiber（cordis 的 fiber 自带 dispose）
    for (const fiber of this.fibers.splice(0)) {
      try {
        await fiber?.dispose?.();
      } catch {
        // 第三方插件卸载异常不该影响宿主
      }
    }
  }

  private contributorCleanup = () => {
    this.contributions.clear();
    this.listeners.clear();
  };
}
