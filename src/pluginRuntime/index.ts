// 客户端插件运行时：把 DSH 的模块加载器 + 那几个运行时模块挂到渲染端，
// 让插件的客户端 bundle（lib/client.js）能原样加载、不需要插件做任何改动。
//
// 为什么不是 eval/内联脚本：渲染端 CSP 是 `script-src 'self'`，eval 与内联脚本都被禁。
// 所以 bundle 由主进程通过自定义协议（dyworker-plugin:）提供，渲染端用 <script src> 加载，
// 脚本自身调 window.__ModuleLoader__.load(...) 完成注册。

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
// DSH 的客户端模块（如 dsh-client-ui-settings）会 require("@deepseek-ai/cordis")——
// 必须给出**同一个** cordis 包，客户端插件与我们的容器才共用一套 Context/Service
import * as Cordis from "@deepseek-ai/cordis";
import * as DshClientStore from '@deepseek-ai/dsh-client-store';
import { createDockkitNamespace, dockkitStyles } from './vendor/dsh-dockkit/index.js';
import { ClientModuleLoader, type LoadedBundle } from "./moduleLoader.ts";
import { createPrimitives, type PrimitivesHost } from "./primitives.ts";
import { SHIMMED_CLIENT_MODULES, createRuntimeClientShim, createSlotsModuleShim } from "./dshClientShims.ts";
import { installPluginApiBridge, isPluginApiPath } from "./apiBridge.ts";

export { ClientModuleLoader, createPrimitives };
export { installPluginApiBridge, isPluginApiPath };
export type { LoadedBundle, PrimitivesHost };

export const PRIMITIVES_MODULE = "@deepseek-ai/dsh-client-ui-primitives";

export interface ClientRuntimeOptions {
  /** 挂到哪个对象上（浏览器里是 window；测试里可以传假对象） */
  target?: any;
  /** primitives 门面的宿主注入（Markdown 渲染、剪贴板、图标） */
  primitivesHost?: PrimitivesHost;
}

export interface ClientRuntime {
  loader: ClientModuleLoader;
  primitives: Record<string, any>;
}

let current: ClientRuntime | null = null;

/** 新建一个独立的运行时实例（每次调用都是新的，测试与多实例场景用） */
export function createClientRuntime(options: ClientRuntimeOptions = {}): ClientRuntime {
  const loader = new ClientModuleLoader({
    onMissingModule: (spec) => {
      // 宿主没提供的模块是"兼容面缺口"的直接证据，值得在控制台留一条
      console.warn(`[plugin-client] 插件请求了宿主未提供的模块：${spec}`);
    },
  });

  const primitives = createPrimitives(options.primitivesHost);
  const target = options.target ?? (typeof window !== "undefined" ? window : undefined);
  // 本机没装（或软链断掉）的两个 DSH 客户端模块：由我们自己兜底实现，
  // 否则依赖它们的 DSH 客户端模块会在 require 阶段就挂掉
  const shimReport = (moduleName: string, name: string) => {
    console.warn(`[plugin-client] ${moduleName} 需要未实现的导出：${name}`);
  };

  loader
    // DSH 客户端模块要用同一个 cordis（容器也是用它建的）
    .provide("@deepseek-ai/cordis", () => Cordis)
    .provide('@deepseek-ai/dsh-client-store', () => DshClientStore)
    .provide("react", () => React)
    .provide("react-dom", () => ReactDOM)
    .provide("react-dom/client", () => ReactDOMClient)
    .provide("react/jsx-runtime", () => JsxRuntime)
    .provide("react/jsx-dev-runtime", () => JsxRuntime)
    .provide(PRIMITIVES_MODULE, () => primitives)
    .provide(SHIMMED_CLIENT_MODULES[0], () => createSlotsModuleShim(shimReport))
    .provide(SHIMMED_CLIENT_MODULES[1], () => createRuntimeClientShim(shimReport))
    .provide('@deepseek-ai/dsh-client-ui-dockkit', () => {
      const doc = target?.document;
      if (doc && !doc.getElementById('dyworker-dsh-dockkit-styles')) {
        const style = doc.createElement('style');
        style.id = 'dyworker-dsh-dockkit-styles'; style.textContent = dockkitStyles;
        doc.head.appendChild(style);
      }
      const helpers = createDockkitNamespace(name => name === 'dyworker/primitives' ? primitives : loader.require(name));
      // 官方 Tooltip 保持子元素位置和引用；包裹一层 span 会让图表柱形失去高度。
      primitives.Tooltip = helpers.dyworkerTooltip;
      return helpers;
    });
  loader.install(target);
  // 插件的 /api/* fetch 走主进程里它自己注册的路由
  installPluginApiBridge(target);

  return { loader, primitives };
}

/** 安装客户端运行时（应用内单例：重复调用复用，仅重新指向 target） */
export function installClientRuntime(options: ClientRuntimeOptions = {}): ClientRuntime {
  if (current) {
    if (options.target) current.loader.install(options.target);
    return current;
  }
  current = createClientRuntime(options);
  return current;
}

/** 取当前运行时（未安装过则安装一次） */
export function clientRuntime(): ClientRuntime {
  return current ?? installClientRuntime();
}

/** 测试用：丢弃单例，下次 installClientRuntime 会重建 */
export function resetClientRuntime(): void {
  current = null;
}

/**
 * 用 <script> 加载一个插件 bundle，并等它注册进加载器。
 * 返回本次注册的 bundle 记录（含 requires / missing，用于诊断与验收）。
 */
export async function loadBundleScript(url: string, { timeoutMs = 15_000 }: { timeoutMs?: number } = {}): Promise<LoadedBundle> {
  const runtime = clientRuntime();
  const before = new Set(runtime.loader.bundles_().map((bundle) => bundle.id));

  await new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("当前环境没有 document，无法用 <script> 加载插件 bundle"));
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error(`加载插件 bundle 超时（${timeoutMs}ms）：${url}`));
    }, timeoutMs);
    script.onload = () => {
      clearTimeout(timer);
      script.remove();
      if ((globalThis as any).__DYW_BUNDLE_DEBUG) console.log(`[bundle] onload ${url}`);
      resolve();
    };
    script.onerror = (event: any) => {
      clearTimeout(timer);
      script.remove();
      if ((globalThis as any).__DYW_BUNDLE_DEBUG) console.log(`[bundle] onerror ${url} ${String(event?.message || "")}`);
      reject(new Error(`插件 bundle 加载失败：${url}`));
    };
    document.head.appendChild(script);
  });

  const added = runtime.loader.bundles_().filter((bundle) => !before.has(bundle.id));
  if ((globalThis as any).__DYW_BUNDLE_DEBUG) {
    console.log(`[bundle] ${url} 新增注册 ${added.length} 个：${added.map((b) => b.id).join(",") || "（无）"}${added.map((b) => b.error).filter(Boolean).length ? ` 错误：${added.map((b) => b.error).filter(Boolean).join(" | ")}` : ""}`);
  }
  const last = added[added.length - 1];
  if (!last) throw new Error("bundle 已加载但没有调用 __ModuleLoader__.load 注册（可能不是 DSH 客户端插件）");
  return last;
}

/**
 * 取一个**已经加载过**的 bundle（按注册 id，通常就是包名）。
 *
 * 为什么需要：同一个 bundle 会以两种身份出现——插件的客户端入口，以及别的模块
 * `require` 的依赖模块。先作为依赖被加载、再作为插件入口加载时，`loadBundleScript`
 * 会因为"没有新注册"而报错，插件界面于是永远出不来（实测 dsh-client-ui-trajectory
 * 就是这样：它的模块清单里有模块 require 了它自己）。这里按包名把那份复用回来。
 */
export function loadedBundle(id: string): LoadedBundle | undefined {
  const wanted = String(id || "");
  if (!wanted) return undefined;
  const runtime = clientRuntime();
  return runtime.loader.bundles_().find((bundle) => bundle.id === wanted)
    || runtime.loader.bundles_().find((bundle) => bundle.id.endsWith(`/${wanted}`));
}
