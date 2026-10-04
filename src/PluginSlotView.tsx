// 把插件注册进插槽的界面贡献渲染出来，并让插件能"请求打开"宿主的面板。
//
// 分工：
//   - 插件通过 ctx.slots.register({ name: "sidebar.right.pane.tab", ... }, 组件) 登记贡献
//   - 这里把贡献渲染成 React 元素（props 带上插槽元信息与它声明的 inject()）
//   - 插件登记后由本模块通知壳层「请给我开一个右侧面板标签」，从而接进**已有的工具面板**
//
// 组件用 React.createElement 而不是 JSX：保持可在 Node 里被引用与测试。

import * as React from "react";
import { clientHost, onPanelOpenRequest } from "./pluginRuntime/clientHostSingleton.ts";

export interface PluginPanelRequest {
  pluginId: string;
  key: string;
  label: string;
}

type PanelHandler = (request: PluginPanelRequest) => void;

const handlers = new Set<PanelHandler>();

/** 壳层订阅：有插件登记右侧面板标签、或插件主动要求打开面板时收到通知 */
export function onPluginPanelRequest(handler: PanelHandler): () => void {
  handlers.add(handler);
  // 插件通过 sidebarRight.openTab(kind) 主动开来时，走同一条通道
  const off = onPanelOpenRequest((kind) => {
    if (!kind) return;
    const label = clientHost().contributionsFor("sidebar.right.pane.tab")
      .map((contribution) => ({
        key: String(contribution.meta.key ?? contribution.meta.id ?? ""),
        label: typeof contribution.meta.label === "function"
          ? String((contribution.meta.label as () => unknown)())
          : String(contribution.meta.label ?? kind),
      }))
      .find((item) => item.key === kind);
    handler({ pluginId: "", key: kind, label: label?.label || kind });
  });
  return () => { handlers.delete(handler); off(); };
}

/** 插件加载完成后调用：把它的插槽贡献通知壳层 */
// conversation.view 由会话区标签栏承载（见 App 的 conversation-tabs）；
// 右侧面板只接 sidebar.right.pane.tab
const PANEL_SLOTS = ["sidebar.right.pane.tab"] as const;

/** 预取的投影键：DSH 的会话投影名字（目前只有上下文时间线） */
const PROJECTION_KEYS = ["contextTimeline"] as const;

export function requestPluginPanels(pluginId: string, slots: string[]): PluginPanelRequest[] {
  const active = PANEL_SLOTS.filter((slot) => slots.includes(slot));
  if (!active.length) return [];
  const requests = active.flatMap((slot) => clientHost().contributionsFor(slot)).map((contribution) => {
    const key = String(contribution.meta.key ?? contribution.meta.id ?? `${pluginId}-${contribution.sequence}`);
    const label = typeof contribution.meta.label === "function"
      ? String((contribution.meta.label as () => unknown)())
      : String(contribution.meta.label ?? pluginId);
    return { pluginId, key, label };
  });
  for (const request of requests) for (const handler of handlers) handler(request);
  return requests;
}

/**
 * 渲染某个插件在右侧面板插槽里的贡献。
 * 未指定 pluginKey 时渲染该插槽的全部贡献（调试与预览用）。
 */
export function PluginSlotView({ pluginId, pluginKey, slot = "sidebar.right.pane.tab", sessionId }: { pluginId?: string; pluginKey?: string; slot?: string; sessionId?: string }) {
  const host = clientHost();
  const [, force] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => host.subscribe(() => force()), [host]);

  // DSH 客户端契约：壳层给插件视图提供 sessionId 与 useProjection(key)。
  // useProjection 是**同步**钩子（插件在渲染期调用），所以先按已知键预取，再同步返回缓存值；
  // 取不到（null）插件会进入 cold 分支，走它自己的 /api 路由。
  const [projections, setProjections] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => {
    if (!sessionId) { setProjections({}); return; }
    let cancelled = false;
    const load = async () => {
      const next: Record<string, unknown> = {};
      for (const key of PROJECTION_KEYS) {
        try {
          const result = await (window as any).dyworker?.pluginProjection?.({ sessionId, key });
          next[key] = result?.ok ? result.value : null;
        } catch {
          next[key] = null;
        }
      }
      if (!cancelled) setProjections(next);
    };
    void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  const useProjection = React.useCallback((key: string) => projections[String(key)] ?? null, [projections]);

  const contributions = host.contributionsFor(slot).filter((contribution) => {
    if (pluginKey) {
      const key = String(contribution.meta.key ?? contribution.meta.id ?? "");
      if (key !== pluginKey) return false;
    }
    return true;
  });

  if (!contributions.length) {
    return React.createElement("div", { className: "plugin-slot-empty" }, "这个位置还没有内容");
  }

  return React.createElement(
    "div",
    { className: "plugin-slot-view", "data-plugin": pluginId || "", "data-slot": slot },
    contributions.map((contribution) => {
      const meta = contribution.meta as Record<string, unknown>;
      // 插件用 inject() 声明它需要的数据；渲染时把结果作为 props 传进去
      let injected: Record<string, unknown> = {};
      if (typeof meta.inject === "function") {
        try {
          injected = ((meta.inject as () => Record<string, unknown>)()) || {};
        } catch {
          injected = {};
        }
      }
      const props = {
        ...injected,
        name: meta.name,
        key: meta.key,
        id: meta.id,
        host: "sidebar",
        // DSH 宿主视图契约（插件按这两个 prop 决定渲染什么）
        sessionId: sessionId || "",
        useProjection,
        // 插件常常按 props.t 取文案；这里给一个安全的恒等函数兜底
        t: typeof injected.t === "function" ? injected.t : (text: string) => text,
      };
      const component = contribution.component;
      const element = typeof component === "function"
        ? React.createElement(component as React.ComponentType<any>, props)
        : (component as React.ReactNode);
      return React.createElement(
        "div",
        { className: "plugin-slot-item", key: String(meta.key ?? meta.id ?? contribution.sequence) },
        element,
      );
    }),
  );
}
