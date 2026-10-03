// 把插件注册进插槽的界面贡献渲染出来，并让插件能"请求打开"宿主的面板。
//
// 分工：
//   - 插件通过 ctx.slots.register({ name: "sidebar.right.pane.tab", ... }, 组件) 登记贡献
//   - 这里把贡献渲染成 React 元素（props 带上插槽元信息与它声明的 inject()）
//   - 插件登记后由本模块通知壳层「请给我开一个右侧面板标签」，从而接进**已有的工具面板**
//
// 组件用 React.createElement 而不是 JSX：保持可在 Node 里被引用与测试。

import * as React from "react";
import { clientHost } from "./pluginRuntime/clientHostSingleton.ts";

export interface PluginPanelRequest {
  pluginId: string;
  key: string;
  label: string;
}

type PanelHandler = (request: PluginPanelRequest) => void;

const handlers = new Set<PanelHandler>();

/** 壳层订阅：有插件登记右侧面板标签时收到通知（返回取消订阅） */
export function onPluginPanelRequest(handler: PanelHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** 插件加载完成后调用：把它的插槽贡献通知壳层 */
export function requestPluginPanels(pluginId: string, slots: string[]): PluginPanelRequest[] {
  const slot = "sidebar.right.pane.tab";
  if (!slots.includes(slot)) return [];
  const requests = clientHost().contributionsFor(slot).map((contribution) => {
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
export function PluginSlotView({ pluginId, pluginKey }: { pluginId?: string; pluginKey?: string }) {
  const host = clientHost();
  const [, force] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => host.subscribe(() => force()), [host]);

  const contributions = host.contributionsFor("sidebar.right.pane.tab").filter((contribution) => {
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
    { className: "plugin-slot-view", "data-plugin": pluginId || "" },
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
