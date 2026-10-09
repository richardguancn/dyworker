// 官方 0.2.1-alpha.1 模块系统的宿主适配：注册、惰性执行、分块和失效均由官方实现负责。
import { ClientModuleSystem } from './vendor/dsh-client-modules/system.js';

export type ModuleRequire = ((spec: string) => unknown) & { async: (spec: string) => Promise<unknown> };
export type ModuleFactory = (require: ModuleRequire) => unknown;
export interface LoadedBundle {
  id: string; exports: unknown; requires: string[]; missing: string[]; error?: string;
}
export interface LoaderOptions {
  onMissingModule?: (spec: string, error: unknown) => void;
  loadBundle?: (url: string) => Promise<void>;
}
const strip = (id: string) => id.replace(/\/client$/, '');
export class ClientModuleLoader {
  private readonly records = new Map<string, LoadedBundle>();
  private readonly missingCount = new Map<string, number>();
  private readonly provided = new Set<string>();
  private readonly registration: any = { mode: 'queue', pendingQueue: [] };
  private readonly system: ClientModuleSystem;
  private target: any;
  private readonly options: LoaderOptions;
  constructor(options: LoaderOptions = {}) {
    this.options = options;
    this.system = new ClientModuleSystem({
      manifest: { rev: 'dyworker', modules: [], plugins: [] }, staticModules: {},
      registrationTarget: this.registration, bootstrapModule: { id: 'dyworker-module-runtime', exports: {} },
      loadBundle: options.loadBundle || (url => this.loadScript(url)),
    });
  }
  provide(spec: string, factory: () => unknown): this {
    const id = strip(String(spec));
    this.provided.add(id);
    this.system.loadCache.set(id, { id, exports: factory(), styles: [], edges: new Set() });
    return this;
  }
  has(spec: string): boolean { return this.provided.has(strip(spec)) || this.records.has(strip(spec)); }
  require = (spec: string): unknown => {
    const id = strip(String(spec));
    const record = this.system.loadCache.get(id);
    if (record) return record.exports;
    // 仅适配旧的同步入口；执行和递归依赖处理仍采用官方 makeRequire。
    return this.system.makeRequire('dyworker-module-runtime', new Set())(spec);
  };
  load = (descriptor: { id?: string; chunk?: string; factory?: ModuleFactory } | null | undefined): LoadedBundle => {
    const owner = strip(String(descriptor?.id || ''));
    const id = descriptor?.chunk ? `${owner}/${descriptor.chunk}` : owner;
    const record: LoadedBundle = { id, exports: undefined, requires: [], missing: [] };
    if (!id || typeof descriptor?.factory !== 'function') {
      record.error = 'bundle 没有提供 id 或 factory'; this.records.set(id, record); return record;
    }
    if (!descriptor.chunk) {
      const current = this.target?.document?.currentScript?.src || (typeof document === 'undefined' ? '' : document.currentScript?.getAttribute('src')) || '';
      const rev = current ? new URL(current, 'http://plugin.local').searchParams.get('rev') || 'initial' : 'initial';
      const url = `dyworker-plugin://bundle/??${owner}/client.js&rev=${encodeURIComponent(rev)}`;
      const modules = this.system.manifest.modules.filter((row: any) => row.id !== owner);
      modules.push({ id: owner, rev, url, initialUrl: url, inject: [], external: [] });
      this.system.updateManifest({ rev, modules, plugins: [] }, []);
    }
    const wrapped = (require: ModuleRequire) => {
      const instrument: ModuleRequire = Object.assign((spec: string) => {
        record.requires.push(spec);
        try { return require(spec); } catch (error) { this.noteMissing(record, spec, error); throw error; }
      }, { async: async (spec: string) => {
        record.requires.push(spec);
        try { return await require.async(spec); } catch (error) { this.noteMissing(record, spec, error); throw error; }
      } });
      return descriptor.factory!(instrument);
    };
    try { this.registration.load({ id: owner, ...(descriptor.chunk ? { chunk: descriptor.chunk } : {}), factory: wrapped }); }
    catch (error: any) { record.error = String(error?.message || error); }
    Object.defineProperty(record, 'exports', { enumerable: true, get: () => {
      if (record.error) return undefined;
      try { return this.require(id); }
      catch (error: any) { record.error = String(error?.message || error); return undefined; }
    } });
    this.records.set(id, record);
    return record;
  };
  private noteMissing(record: LoadedBundle, spec: string, error: unknown) {
    record.missing.push(spec);
    this.missingCount.set(spec, (this.missingCount.get(spec) || 0) + 1);
    this.options.onMissingModule?.(spec, error);
  }
  invalidate(id: string) {
    const owner = strip(id);
    this.system.invalidate(owner);
    if (typeof document !== 'undefined') {
      for (const style of document.querySelectorAll('style[data-plugin]')) if (style.getAttribute('data-plugin') === owner) style.remove();
    }
    for (const key of this.records.keys()) if (key === owner || key.startsWith(`${owner}/client.`)) this.records.delete(key);
  }
  bundle(id: string): LoadedBundle | undefined { return this.records.get(strip(String(id))); }
  bundles_(): LoadedBundle[] { return [...this.records.values()]; }
  listMissingModules() { return [...this.missingCount].map(([spec, count]) => ({ spec, count })).sort((a,b) => b.count - a.count || a.spec.localeCompare(b.spec)); }
  install(target: any = globalThis) { this.target = target; if (target) target.__ModuleLoader__ = { load: this.load }; }
  private async loadScript(url: string) {
    if (typeof document === 'undefined') throw new Error('当前环境没有 document，无法加载异步插件模块');
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script'); script.src = url;
      const finish = (error?: Error) => { clearTimeout(timer); script.remove(); if (error) reject(error); else resolve(); };
      const timer = setTimeout(() => finish(new Error('异步插件模块加载超时')), 15_000);
      script.onload = () => finish(); script.onerror = () => finish(new Error(`异步插件模块加载失败：${url}`));
      document.head.append(script);
    });
  }
}
