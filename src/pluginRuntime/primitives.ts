// @deepseek-ai/dsh-client-ui-primitives 的兼容门面。
//
// DSH 的客户端插件从这个包取组件。对已装的插件实测（dsh-context / dsh-better-sidebar），
// 真正用到的导出是：
//   Button Input Menu Modal Tooltip StateDot MarkdownText writeClipboard
//   + 20 个 IconXxxOutlineNN 图标
// 所以这里实现这些；图标统一走一个通用图标组件（按名字渲染占位字形，不崩即可）。
//
// 未知导出**不是报错了事**：返回一个宽容的占位组件，并记录名字，用来量出"还差哪些组件"
// （与 moduleLoader 的 listMissingModules 一起构成兼容面清单）。
//
// 刻意不用 JSX：这样 Node 里能直接 import 本文件，对真实插件 bundle 做验收测试。
// 与宿主界面强耦合的部分（Markdown 渲染、剪贴板）通过 host 注入，缺省有降级实现。

import * as React from "react";
import { createPortal } from 'react-dom';

export interface PrimitivesHost {
  /** 用宿主现有的 Markdown 渲染器渲染（缺省降级为纯文本） */
  MarkdownText?: React.ComponentType<any>;
  /** 写剪贴板（缺省用 navigator.clipboard） */
  writeClipboard?: (text: string) => void | Promise<void>;
  /** 图标渲染（缺省用通用字形） */
  renderIcon?: (name: string, props: any) => React.ReactNode;
  /** 诊断：插件访问了门面里没有的**组件**导出（图标走 onIconExport，不混在一起） */
  onUnknownExport?: (name: string) => void;
  /** 诊断：插件用到了 IconXxxOutlineNN 这类图标（由通用图标组件兜底） */
  onIconExport?: (name: string) => void;
}

const h = React.createElement;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** 通用图标：DSH 的图标名形如 IconBranchOutline16，这里取中间那段作为提示 */
function genericIcon(name: string, props: any, host: PrimitivesHost): React.ReactNode {
  if (host.renderIcon) return host.renderIcon(name, props);
  return h(
    "svg",
    {
      width: props?.size || 16,
      height: props?.size || 16,
      viewBox: "0 0 16 16",
      className: cx("plugin-ui-icon", props?.className),
      "data-icon": name,
      "aria-hidden": true,
    },
    h("rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5, fill: "none", stroke: "currentColor", strokeWidth: 1.2 }),
  );
}

function fallbackComponent(name: string, host: PrimitivesHost) {
  const Stub = (props: any) => {
    // 宽容降级：有 children 就渲染出来，否则渲染一个带名字的占位块。
    // 目的是"插件不崩、界面能看出这里少了个组件"，同时 onUnknownExport 把名字记下来。
    if (props?.children) {
      return h("div", { className: "plugin-ui-unknown", "data-primitive": name, ...props }, props.children);
    }
    return h("span", { className: "plugin-ui-unknown", "data-primitive": name, title: `未实现的 DSH 组件：${name}` }, name);
  };
  Stub.displayName = `DshPrimitives(${name})`;
  return Stub;
}

export function createPrimitives(host: PrimitivesHost = {}): Record<string, any> {
  // DSH 传的是 content/text，宿主渲染器可能只认 content —— 这一层就是做 props 适配
  const MarkdownText = (props: any) => {
    const content = props?.content ?? props?.text ?? props?.children ?? "";
    if (host.MarkdownText) return h(host.MarkdownText, { content: String(content) });
    return h("div", { className: "plugin-ui-markdown" }, String(content));
  };
  MarkdownText.displayName = "DshPrimitives(MarkdownText)";

  /**
   * Markdown → 纯文本。DSH 的插件会拿它做"预览文本"，并且**直接假设返回字符串**
   * （实测 dsh-client-ui-trajectory 会立刻 `.replace(...)`，返回非字符串就崩）。
   * 这里做的是轻量剥离：去掉常见标记，保留可读文字；不追求完整 Markdown 解析。
   */
  const extractMarkdownPlainText = (value: unknown): string => {
    const text = typeof value === "string" ? value : String(value ?? "");
    return text
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ""))
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
      .replace(/\r\n?/g, "\n")
      .trim();
  };

  const Button = (props: any) => {
    const { variant, size, loading, children, className, ...rest } = props || {};
    return h(
      "button",
      {
        type: "button",
        ...rest,
        className: cx("plugin-ui-button", variant && `variant-${variant}`, size && `size-${size}`, loading && "loading", className),
        disabled: rest.disabled || loading,
      },
      children,
    );
  };
  Button.displayName = "DshPrimitives(Button)";

  const Input = (props: any) => {
    const { className, ...rest } = props || {};
    return h("input", { ...rest, className: cx("plugin-ui-input", className) });
  };
  Input.displayName = "DshPrimitives(Input)";

  /** DSH 的 Menu 形如 <Menu items={[{label, onClick}]}/> 或直接给 children，两种都接 */
  const Menu = (props: any) => {
    const { items, children, className, open, anchor, onSelect, onClose, selectedId, selectedIds = [], portal, align = 'start', ...rest } = props || {};
    const wrapper = React.useRef<HTMLSpanElement>(null);
    const list = React.useRef<HTMLDivElement>(null);
    const [position, setPosition] = React.useState({ top: 0, left: 0 });
    const shown = open !== false;
    React.useLayoutEffect(() => {
      if (!shown || !portal) return;
      const place = () => {
        const rect = wrapper.current?.getBoundingClientRect(); if (!rect) return;
        const width = list.current?.offsetWidth || 160;
        const height = list.current?.offsetHeight || 0;
        setPosition({ left: Math.max(8, Math.min(innerWidth - width - 8, align === 'end' ? rect.right - width : rect.left)),
          top: rect.bottom + height + 8 > innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4 });
      };
      place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
      return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [shown, portal, align]);
    React.useEffect(() => {
      if (!shown || !anchor) return;
      const dismiss = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) onClose?.(); };
      document.addEventListener('pointerdown', dismiss);
      return () => document.removeEventListener('pointerdown', dismiss);
    }, [shown, anchor, onClose]);
    const menu = !shown ? null : Array.isArray(items) ? h(
        "div",
        { ref: list, role: 'menu', className: cx('plugin-ui-menu', anchor && 'plugin-ui-menu-popup', !anchor && className),
          style: anchor ? { position: portal ? 'fixed' : 'absolute', ...(portal ? position : { top: '100%', [align === 'end' ? 'right' : 'left']: 0 }) } : undefined,
          onKeyDown: (event: any) => {
            if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); wrapper.current?.querySelector('button')?.focus(); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); const rows = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
              const index = rows.indexOf(document.activeElement as HTMLButtonElement);
              rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
            }
          } },
        items.map((item: any, index: number) =>
          item.type === 'separator' ? h('hr', { key: item.id || index, role: 'separator' })
          : item.type === 'label' ? h('span', { key: item.id || index }, item.text) : h(
            "button",
            {
              key: item?.key ?? item?.id ?? index,
              role: "menuitem",
              type: "button",
              className: cx("plugin-ui-menu-item", item?.danger && "danger", (item.id === selectedId || selectedIds.includes(item.id)) && 'selected'),
              onClick: (event: any) => { item.onClick?.(event); onSelect?.(item.id); },
              disabled: item?.disabled,
            },
            item?.icon ?? null,
            item?.label ?? item?.title ?? "",
          ),
        ),
      ) : h('div', { ref: list, role: 'menu', className: cx('plugin-ui-menu', className) }, children);
    return anchor ? h('span', { ref: wrapper, className: cx('plugin-ui-menu-anchor', className) }, anchor,
      portal && menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu) : menu;
  };
  Menu.displayName = "DshPrimitives(Menu)";

  const Modal = (props: any) => {
    const { open = true, onClose, title, children, className, ...rest } = props || {};
    if (!open) return null;
    return h(
      "div",
      { className: "plugin-ui-modal-overlay", onMouseDown: (event: any) => { if (event.target === event.currentTarget) onClose?.(); } },
      h(
        "div",
        { role: "dialog", ...rest, className: cx("plugin-ui-modal", className) },
        title ? h("header", { className: "plugin-ui-modal-title" }, title) : null,
        children,
      ),
    );
  };
  Modal.displayName = "DshPrimitives(Modal)";

  const Tooltip = (props: any) => {
    const { label, content, title, children, className, ...rest } = props || {};
    const text = label ?? content ?? title ?? "";
    return h("span", { ...rest, className: cx("plugin-ui-tooltip", className), title: typeof text === "string" ? text : undefined }, children);
  };
  Tooltip.displayName = "DshPrimitives(Tooltip)";

  const StateDot = (props: any) => {
    const { state, tone, color, label, className, ...rest } = props || {};
    const key = String(tone || state || color || "default");
    return h(
      "span",
      { ...rest, className: cx("plugin-ui-state-dot", `state-${key}`, className), title: label || key },
      h("i", { className: "plugin-ui-state-dot-mark" }),
      label ? h("span", { className: "plugin-ui-state-dot-label" }, label) : null,
    );
  };
  StateDot.displayName = "DshPrimitives(StateDot)";

  const writeClipboard = async (text: string) => {
    if (host.writeClipboard) return host.writeClipboard(text);
    const nav: any = (globalThis as any).navigator;
    if (nav?.clipboard?.writeText) return nav.clipboard.writeText(text);
    throw new Error("当前环境没有可用的剪贴板");
  };

  const base: Record<string, any> = {
    Button,
    Input,
    Menu,
    Modal,
    Tooltip,
    StateDot,
    MarkdownText,
    writeClipboard,
    // Markdown → 纯文本：插件会直接对返回值做字符串操作，必须是真实现
    extractMarkdownPlainText,
  };

  // 未知导出：图标给通用图标组件，其它给宽容占位组件，并把名字记进诊断
  return new Proxy(base, {
    get(target, prop) {
      const key = String(prop);
      if (key in target) return target[key];
      if (key === "__esModule" || key === "then" || typeof prop === "symbol") return undefined;
      if (key.startsWith("Icon")) {
        // 图标是"有兜底但没精细实现"的一类，单独记，避免和真正缺失的组件混在一起
        host.onIconExport?.(key);
        return (props: any) => genericIcon(key, props, host);
      }
      host.onUnknownExport?.(key);
      return fallbackComponent(key, host);
    },
    has(target, prop) {
      // 声明"什么都有"，避免插件的 `"X" in primitives` 判断把可用组件判成缺失
      return typeof prop === "string" ? true : prop in target;
    },
  });
}

/** 图标名字（DSH 的 IconXxxOutlineNN）→ 通用图标，供宿主按需覆盖 */
export function isIconExport(name: string): boolean {
  return /^Icon[A-Z]/.test(name);
}
