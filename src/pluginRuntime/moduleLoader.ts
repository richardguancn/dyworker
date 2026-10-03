// DSH 客户端插件的模块加载器（宿主侧实现，插件 bundle 无需改动）。
//
// DSH 的 web shell 里有一个全局加载器，插件的客户端半边（lib/client.js）就是这样一个
// 预打包 bundle，开头固定是：
//
//   window.__ModuleLoader__.load({
//     id: "dsh-context",
//     factory: (require) => { ... module.exports = ...; return module.exports; },
//   });
//
// bundle 内部只 require 极少数运行时模块（实测 dsh-context 只有 react / react-dom /
// react/jsx-runtime / @deepseek-ai/dsh-client-ui-primitives 四个），其余能力靠
// cordis 的 inject 拿服务。所以我们只要：① 提供这个加载器；② 提供那几个模块；
// ③ 把 host 已有的界面容器注册成同名客户端服务（第 2 步）。
//
// 本文件刻意不依赖 React/DOM，便于在 Node 里直接对真实 bundle 做验收测试。

export type ModuleFactory = (require: (spec: string) => unknown) => unknown;

export interface LoadedBundle {
  id: string;
  /** bundle 的 module.exports */
  exports: unknown;
  /** 本次加载实际请求过的模块名（按顺序、含重复） */
  requires: string[];
  /** 宿主没有提供、因而抛错的模块名 */
  missing: string[];
  /** 加载失败原因（成功时为 undefined） */
  error?: string;
}

export interface LoaderOptions {
  /** 诊断用：宿主没提供的模块被请求时回调（同一模块可能多次） */
  onMissingModule?: (spec: string, error: unknown) => void;
}

export class ClientModuleLoader {
  private readonly factories = new Map<string, () => unknown>();
  private readonly cache = new Map<string, unknown>();
  private readonly bundles = new Map<string, LoadedBundle>();
  private readonly missingCount = new Map<string, number>();
  private readonly options: LoaderOptions;

  constructor(options: LoaderOptions = {}) {
    this.options = options;
  }

  /** 宿主注册自己能提供的模块；同一 spec 重复注册以最后一次为准 */
  provide(spec: string, factory: () => unknown): this {
    this.factories.set(String(spec), factory);
    this.cache.delete(String(spec));
    return this;
  }

  has(spec: string): boolean {
    const key = String(spec);
    return this.factories.has(key) || this.cache.has(key);
  }

  /** bundle 内部拿到的 require */
  require = (spec: string): unknown => {
    const key = String(spec || "");
    if (this.cache.has(key)) return this.cache.get(key);
    const factory = this.factories.get(key);
    if (!factory) {
      this.missingCount.set(key, (this.missingCount.get(key) || 0) + 1);
      const error = new Error(`模块 ${key} 不在宿主提供的模块表里`);
      this.options.onMissingModule?.(key, error);
      throw error;
    }
    const value = factory();
    this.cache.set(key, value);
    return value;
  };

  /**
   * window.__ModuleLoader__.load 的实现。
   * 失败**不向上抛**：bundle 是外来的第三方代码，抛出去只会污染控制台并可能打断
   * 后续注入；失败原因记录在 record 里，由界面来展示。
   */
  load = (descriptor: { id?: string; factory?: ModuleFactory } | null | undefined): LoadedBundle => {
    const id = String(descriptor?.id || "");
    const requires: string[] = [];
    const missing: string[] = [];
    const record: LoadedBundle = { id, exports: undefined, requires, missing };

    const scopedRequire = (spec: string) => {
      requires.push(String(spec));
      try {
        return this.require(spec);
      } catch (error) {
        missing.push(String(spec));
        throw error;
      }
    };

    if (typeof descriptor?.factory !== "function") {
      record.error = "bundle 没有提供 factory";
      this.bundles.set(id || `anonymous-${this.bundles.size + 1}`, record);
      return record;
    }

    try {
      record.exports = descriptor.factory(scopedRequire);
    } catch (error: any) {
      record.error = String(error?.message || error);
    }
    this.bundles.set(id || `anonymous-${this.bundles.size + 1}`, record);
    return record;
  };

  /** 取某个 bundle 的加载记录 */
  bundle(id: string): LoadedBundle | undefined {
    return this.bundles.get(String(id));
  }

  bundles_(): LoadedBundle[] {
    return [...this.bundles.values()];
  }

  /** 宿主没提供却被请求过的模块，按次数降序——这是"还差什么"的权威数据 */
  listMissingModules(): Array<{ spec: string; count: number }> {
    return [...this.missingCount.entries()]
      .map(([spec, count]) => ({ spec, count }))
      .sort((a, b) => b.count - a.count || a.spec.localeCompare(b.spec));
  }

  /** 把加载器挂到目标对象上（浏览器里就是 window） */
  install(target: any = globalThis): void {
    if (!target) return;
    target.__ModuleLoader__ = { load: this.load };
  }
}
