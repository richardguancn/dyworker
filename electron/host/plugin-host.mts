// 插件宿主 ctx.plugins：DYWorker 的插件层，目标是与 DSH 插件同构可装。
//
// 组成（都用官方件，不自己造轮子）：
//   - 生命周期：@deepseek-ai/cordis-plugin-loader（DSH 在用的同一套 loader）
//     负责 entry/fiber 的 create/update/remove 与 !dispose 资源释放；
//   - 清单：userData/plugins/dyworker.yml —— 与 dsh 的 cordis.yml **同方言**
//     （entry 数组：id / name / config / disabled / group / inject）；
//   - 解析：bare specifier 用 profile 自己的 require 解析（见 resolveSpecifier）。
//
// 为什么清单由我们自己读写（而不是直接用 @deepseek-ai/cordis-plugin-include）：
//   loader 的 import() 对 bare specifier 是相对 loader 包自身位置解析的，不会走
//   profile 的 baseUrl——直接用它读树会让 node_modules 里的插件全部"找不到"；
//   而 Loader 的根树 write() 是 no-op，落盘也得自己做。因此宿主独占清单读写：
//   解析用 profile require，生命周期交给 loader。
//
// 与 ~/.dsh/profiles 的关系：**刻意不共用**。独立目录、独立清单、独立启用状态，
// 不读也不写 DSH 的 package.json / pnpm-lock / cordis.yml。
//
// 与 electron 的边界：本文件不 import electron，目录由壳层注入。
import { composeRows, describeBundle, readPackageManifest, resolvePackageDir } from "./plugin-bundle.mts";
import { analyzePlugin, formatMatrix } from "./dsh-compat.mts";
import { resolveClientEntries } from "./plugin-client.mts";
import { detectInstalledPackageName, installPackageIntoProfile, parsePluginSource, readProfileDependencies } from "./plugin-install.mts";
import { Service } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

declare module "@deepseek-ai/cordis" {
  interface Context {
    plugins: PluginHostService;
  }
}

// 清单文件名。方言与 dsh 的 cordis.yml 一致，但文件名独立，
// 避免被 DSH 的工装（dsh plugin / dsh config 命令）误读误写。
export const TREE_FILE = "dyworker.yml";
export const PROFILE_MANIFEST = "package.json";
// 已安装 bundle 记录（与 dsh 的 package.json#dsh.profile.bundles 等价，独立成文件避免与 DSH 工具互踩）
export const BUNDLES_FILE = "dyworker.bundles.json";
// 与 DSH profile 的结构对齐：同一个目录既是 npm prefix 也是 pnpm workspace 根
export const WORKSPACE_FILE = "pnpm-workspace.yaml";

const HEADER = "# DYWorker 插件树（与 dsh 的 cordis.yml 同方言）\n";

/** 单个条目：id / 模块名（保持用户写的形式）/ 配置 / 停用 */
function normalizeRow(row: any) {
  const id = String(row?.id || "").trim();
  const name = String(row?.name || "").trim();
  if (!id) throw new Error("插件条目缺少 id");
  if (!name) throw new Error(`插件条目 ${id} 缺少 name（模块名）`);
  const out: any = { id, name };
  if (row?.config != null) out.config = row.config;
  if (row?.disabled) out.disabled = true;
  if (row?.group) out.group = row.group;
  if (row?.inject) out.inject = row.inject;
  return out;
}

export function parseTree(text) {
  const data = yaml.load(text || "") ?? [];
  if (!Array.isArray(data)) throw new Error(`${TREE_FILE} 顶层必须是条目数组`);
  return data.map(normalizeRow);
}

export function stringifyTree(rows) {
  return HEADER + (rows.length ? yaml.dump(rows, { lineWidth: 120, noRefs: true }) : "[]\n");
}

/** 判断某个 bundle 的 patch 是否会插入该 id（用于"这条是哪个包带来的"） */
function resolveOwnsId(bundle, id) {
  const stack = [...(bundle.patches || [])];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node.insert)) {
      for (const item of node.insert) {
        if (item?.id === id) return true;
        if (Array.isArray(item?.config)) stack.push({ insert: item.config });
      }
    }
  }
  return false;
}

export class PluginHostService extends Service {
  // loader 由 mountPluginHost 在构造时注入并持有，服务内部只用 this.loader。
  // 注意：**驱动 loader 的操作仍要求调用方 fiber 具备 loader 权限**——loader 的
  // 内部实现（EntryGroup.create 等）会读 this.ctx.loader，而 cordis 4 的严格访问
  // 检查按当前调用方 fiber 判定。所以使用 ctx.plugins 变更类方法的插件要 inject
  // ["plugins", "loader"]（内置样板见 host/plugins/plugins-ipc.mts）。
  loader;

  dir;
  /** 用户层条目（dyworker.yml 的内容） */
  baseRows = [];
  /** 合成后的条目 = 用户层 + 各 bundle 的 patch 叠加（entries()/装载用这份） */
  rows = [];
  /** 已安装的插件包：[{ name, packageName, version, patchFile, patches }] */
  bundles = [];
  /** 对条目的宿主侧覆盖（停用/改配置）：{ [id]: { disabled?, config? } }。
   *  bundle 带来的条目不在用户层里，没有这层就没法启停/配置它——等价 dsh 的用户 patch 层。 */
  overrides = {};
  /** 合成时被跳过的 patch 告警（dsh 语义：未命中只告警不报错） */
  patchWarnings = [];
  /** 最近一次安装的兼容性分析结果 */
  lastAnalysis = null;
  /** 条目模块名 → 包描述（手工加进清单、不走 bundle 的条目也要能显示说明） */
  descriptions = new Map();

  /** 条目模块名 → 客户端半边声明（dsh.client，没有则为 null） */
  clients = new Map();

  /** 当前真正装载成功的条目 id（服务自己维护，不去反射 loader：
   *  loader 内部实现会在严格访问检查下抛错，被 catch 吞掉会表现为"装了但显示未生效"） */
  activeIds = new Set();
  /** id → 装载失败原因（模块解析不到 / 预检 import 失败等） */
  failures = new Map();

  constructor(ctx, config = {} as any) {
    super(ctx, "plugins");
    this.dir = config.dir;
    this.loader = config.loader;
  }

  profileManifest() {
    return path.join(this.dir, PROFILE_MANIFEST);
  }

  treeFile() {
    return path.join(this.dir, TREE_FILE);
  }

  bundlesFile() {
    return path.join(this.dir, BUNDLES_FILE);
  }

  /** 基础条目 + 各 bundle patch → 合成条目（dsh 的 patch 语义） */
  compose() {
    const warnings = [];
    const overlay = Object.entries(this.overrides).map(([id, patch]) => ({ id, ...(patch as any) }));
    const layers = [...this.bundles.map((bundle) => bundle.patches)];
    if (overlay.length) layers.push(overlay);
    const rows = composeRows(this.baseRows, layers, (message: any, ...args: any[]) => {
      warnings.push(`${message}${args.length ? ` ${args.join(" ")}` : ""}`);
    });
    this.patchWarnings = warnings;
    this.rows = rows.map((row) => normalizeRow(row));
    return this.rows;
  }

  /** 用 profile 自己的解析上下文解析模块名——这是能用 node_modules 里插件的前提 */
  resolveSpecifier(name) {
    const spec = String(name || "").trim();
    if (!spec) throw new Error("模块名为空");
    if (spec.startsWith("cordis:")) return spec;
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:")) {
      // 相对路径按 profile 目录解析（与 dsh 的 cordis.yml 写法一致）
      return new URL(spec, pathToFileURL(this.treeFile())).href;
    }
    const profileRequire = createRequire(this.profileManifest());
    try {
      return pathToFileURL(profileRequire.resolve(spec)).href;
    } catch (error: any) {
      const hint = error?.code === "MODULE_NOT_FOUND"
        ? `插件包未安装到 profile：在 ${path.join(this.dir, "node_modules")} 下找不到 ${spec}`
        : String(error?.message || error);
      throw new Error(hint);
    }
  }

  /** 读 bundle 记录 */
  async readBundles() {
    try {
      const data = JSON.parse(await fs.readFile(this.bundlesFile(), "utf8"));
      const list = Array.isArray(data?.bundles) ? data.bundles : [];
      this.bundles = list.filter((item) => item && typeof item.name === "string");
      this.overrides = data?.overrides && typeof data.overrides === "object" ? data.overrides : {};
    } catch {
      this.bundles = [];
      this.overrides = {};
    }
    return this.bundles;
  }

  async persistBundles() {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.bundlesFile(), `${JSON.stringify({ version: 1, bundles: this.bundles, overrides: this.overrides }, null, 2)}\n`, "utf8");
  }

  /** 读包描述（带缓存；解析不到就留空，不影响其它功能） */
  async describeRow(name) {
    const key = String(name || "");
    if (!key) return "";
    if (this.descriptions.has(key)) return this.descriptions.get(key);
    let description = "";
    try {
      const dir = resolvePackageDir(this.profileManifest(), key);
      const manifest = await readPackageManifest(dir);
      description = String(manifest.description || "");
      // 顺手记下客户端半边声明：列表要据此显示"有界面半边"，不必为每行再读一次清单
      this.clients.set(key, manifest.dsh?.client || manifest.dyworker?.client || null);
    } catch {
      description = "";
      this.clients.set(key, null);
    }
    this.descriptions.set(key, description);
    return description;
  }

  /** 读用户层清单（dyworker.yml） */
  async readBaseRows() {
    let text = "";
    try {
      text = await fs.readFile(this.treeFile(), "utf8");
    } catch {
      text = "";
    }
    if (!text.trim()) {
      this.baseRows = [];
      return { ok: true };
    }
    try {
      this.baseRows = parseTree(text);
      return { ok: true };
    } catch (error: any) {
      const reason = String(error?.message || error);
      this.failures.set("<tree>", reason);
      return { ok: false, error: reason };
    }
  }

  /** 装配：用户层 + bundle 记录 → 合成 → 逐条装载 */
  async load() {
    const read = await this.readBaseRows();
    if (!read.ok) return read;
    await this.readBundles();
    this.compose();
    this.activeIds.clear();
    for (const row of this.rows) {
      try {
        await this.activate(row, false);
        this.failures.delete(row.id);
      } catch (error: any) {
        this.failures.set(row.id, String(error?.message || error));
      }
      await this.describeRow(row.name);
    }
    await this.loader.await();
    return { ok: true, count: this.rows.length, bundles: this.bundles.length };
  }

  /** 卸载全部条目后按当前合成结果重建（安装/卸载 bundle 这类低频操作走这条路） */
  async reload() {
    // 重读用户层：手工改过 dyworker.yml 之后 reload 必须能看到改动
    await this.readBaseRows();
    for (const row of this.rows) {
      try {
        (this.loader as any).remove(row.id);
      } catch {
        // 未创建
      }
    }
    await this.loader.await();
    this.activeIds.clear();
    this.compose();
    for (const row of this.rows) {
      try {
        await this.activate(row, true);
        this.failures.delete(row.id);
      } catch (error: any) {
        this.failures.set(row.id, String(error?.message || error));
      }
      await this.describeRow(row.name);
    }
    await this.loader.await();
    return { ok: true, count: this.rows.length };
  }

  /** 安装一个插件包：解析包 → 读它的 bundle patch → 叠加合成 → 落盘 */
  async install({ spec, id, allowIncompatible = false }: any = {}) {
    const name = String(spec || "").trim();
    if (!name) throw new Error("install 需要插件包名");
    const described = await describeBundle(this.profileManifest(), name, { id });

    // 兼容性判定前置：不兼容的包直接拒绝，避免"装上了但什么都不做"
    const manifest = await readPackageManifest(described.dir);
    const analysis = await analyzePlugin(this.profileManifest(), name, manifest, described.dir);
    this.lastAnalysis = analysis;
    if (analysis.verdict !== "runnable" && !allowIncompatible) {
      return {
        ok: false,
        name,
        incompatible: true,
        verdict: analysis.verdict,
        analysis,
        matrix: formatMatrix(analysis),
        error: `插件 ${name} 与本宿主不兼容（${analysis.verdict}）：${analysis.reasons.join("；")}`,
      };
    }
    const existing = this.bundles.findIndex((bundle) => bundle.name === name);
    const record = {
      name,
      packageName: described.packageName,
      version: described.version,
      description: described.description || "",
      patchFile: described.patchFile,
      declared: described.declared,
      patches: described.patches,
    };
    if (existing >= 0) this.bundles[existing] = record;
    else this.bundles.push(record);
    await this.reload();
    await this.persistBundles();
    const failed = this.rows.filter((row) => this.failures.has(row.id)).map((row) => row.id);
    return {
      ok: failed.length === 0,
      name,
      updated: existing >= 0,
      entries: this.rows.length,
      failed,
      verdict: analysis.verdict,
      analysis,
      matrix: formatMatrix(analysis),
    };
  }

  /** 卸载插件包：撤掉它的 patch，重建条目 */
  async uninstall({ spec }: any = {}) {
    const name = String(spec || "").trim();
    const before = this.bundles.length;
    this.bundles = this.bundles.filter((bundle) => bundle.name !== name);
    await this.reload();
    await this.persistBundles();
    return { ok: true, name, removed: before !== this.bundles.length, entries: this.rows.length };
  }

  /**
   * 从包管理器把插件包装进 profile，再走常规安装。
   * 默认 --ignore-scripts（不跑安装脚本）、--save-exact（钉版本）。
   */
  async installPackage({ input, spec, version = null, source = "default", customRegistry, allowIncompatible = false, npmPath, ignoreScripts = true, run }: any = {}) {
    const rawInput = String(input || spec || "").trim();
    if (!rawInput) throw new Error("installPackage 需要插件包名 / GitHub 地址 / 本地路径");

    const before = await readProfileDependencies(this.dir);
    const downloaded = await installPackageIntoProfile({
      dir: this.dir,
      input: rawInput,
      version,
      source,
      customRegistry,
      npmPath: npmPath || process.env.DYWORKER_NPM || null,
      ignoreScripts,
      run,
    });
    if (!downloaded.ok) return { ok: false, stage: "download", name: rawInput, ...downloaded };

    // git / 本地来源装完后要回到"按包名上树"的流程：从 profile 依赖 diff 里找出装进来的包名
    let parsedInput: any = null;
    try {
      parsedInput = parsePluginSource(rawInput);
    } catch {
      parsedInput = null;
    }
    let packageName = downloaded.kind === "npm" ? String(parsedInput?.name || "") : "";
    if (!packageName) {
      packageName = await detectInstalledPackageName(this.dir, before, { parsed: parsedInput, rawInput }) || rawInput;
    }

    const installed = await this.install({ spec: packageName, allowIncompatible });
    if (installed.ok) {
      // 记录来源（界面要显示"从 GitHub / 本地目录装的"）与钉住的版本
      const index = this.bundles.findIndex((bundle) => bundle.name === packageName);
      if (index >= 0) {
        this.bundles[index] = {
          ...this.bundles[index],
          ...(version ? { pinnedVersion: version } : {}),
          source: { kind: downloaded.kind, input: rawInput, source },
        };
        await this.persistBundles();
      }
    }
    return { ok: installed.ok, stage: installed.ok ? "done" : "activate", name: packageName, downloaded, ...installed };
  }

  /** 解析条目对应的插件包与客户端入口 */
  async clientEntriesOf(target) {
    const key = String(target || "");
    const row = this.rows.find((item) => item.id === key || item.name === key);
    if (!row) throw new Error(`插件不在清单里：${key}`);
    const dir = resolvePackageDir(this.profileManifest(), row.name);
    const manifest = await readPackageManifest(dir);
    return { row, dir, manifest, entries: resolveClientEntries(manifest, dir) };
  }

  /**
   * 插件的客户端半边入口（供渲染端用 <script src> 加载）。
   * URL 走自定义协议，只带条目 id 与序号——协议处理器再回到这里解析真实文件，
   * 因而不存在"用 URL 直接读任意文件"的面。
   */
  async clientBundles(target) {
    try {
      const { row, manifest, entries } = await this.clientEntriesOf(target);
      if (!entries.length) {
        return { ok: false, id: row.id, name: row.name, error: "这个插件没有声明客户端半边（dsh.client）" };
      }
      const client = manifest.dsh?.client || manifest.dyworker?.client || {};
      return {
        ok: true,
        id: row.id,
        name: row.name,
        version: String(manifest.version || ""),
        platform: String(client.platform || ""),
        inject: Array.isArray(client.inject) ? client.inject : [],
        entries: entries.map((entry, index) => ({
          subpath: entry.subpath,
          relative: entry.relative,
          primary: entry.primary,
          url: `dyworker-plugin://client/${encodeURIComponent(row.id)}/${index}`,
        })),
      };
    } catch (error: any) {
      return { ok: false, id: String(target || ""), error: String(error?.message || error) };
    }
  }

  /** 协议处理器用：条目 + 序号 → 客户端 bundle 的绝对路径 */
  async clientBundleFile(target, index) {
    const { entries } = await this.clientEntriesOf(target);
    const entry = entries[Number(index)];
    if (!entry) throw new Error(`客户端入口不存在：${target} #${index}`);
    return entry.file;
  }

  /** 只做兼容性判定，不安装（装之前先看能不能跑） */
  async compatibility({ spec }: any = {}) {
    const name = String(spec || "").trim();
    if (!name) throw new Error("compatibility 需要插件包名");
    const described = await describeBundle(this.profileManifest(), name, {});
    const manifest = await readPackageManifest(described.dir);
    const analysis = await analyzePlugin(this.profileManifest(), name, manifest, described.dir);
    return { ...analysis, matrix: formatMatrix(analysis) };
  }

  /** 已安装插件包（含依赖是否仍可解析） */
  bundles_() {
    return this.bundles.map((bundle) => ({
      name: bundle.name,
      packageName: bundle.packageName,
      version: bundle.version,
      description: bundle.description || "",
      patchFile: bundle.patchFile,
      declared: Boolean(bundle.declared),
      installed: this.rows.some((row) => row.name === bundle.name || row.name === bundle.packageName),
      source: bundle.source || null,
      client: this.clients.get(bundle.packageName) || this.clients.get(bundle.name) || null,
      pinnedVersion: bundle.pinnedVersion || null,
      drift: bundle.pinnedVersion && bundle.version && bundle.pinnedVersion !== bundle.version
        ? `记录版本 ${bundle.pinnedVersion}，当前 ${bundle.version}`
        : null,
      error: this.resolveError(bundle.name),
    }));
  }

  resolveError(spec) {
    try {
      resolvePackageDir(this.profileManifest(), spec);
      return null;
    } catch (error: any) {
      return String(error?.message || error);
    }
  }

  /** 解析 + 预检 import + 交给 loader 启动（预检失败要能立刻被界面看到：
   *  loader 内部对 import 失败只记一条 logger 就静默跳过） */
  async activate(row, creating) {
    const resolved = this.resolveSpecifier(row.name);
    await (this.loader as any).import(resolved);
    const options = {
      id: row.id,
      name: resolved,
      config: row.config ?? null,
      disabled: Boolean(row.disabled),
    };
    if (creating) await (this.loader as any).create(options);
    else {
      // 重启载入：先删后建，保证 disabled/顺序与清单一致
      try {
        (this.loader as any).remove(row.id);
      } catch {
        // 尚未创建
      }
      await (this.loader as any).create(options);
    }
    this.activeIds.add(row.id);
    return resolved;
  }

  /** 清单写回（宿主独占；loader 根树的 write() 是 no-op） */
  async persist() {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.treeFile(), stringifyTree(this.baseRows), "utf8");
  }

  /** 当前插件：清单行 + 运行态（是否装载、失败原因） */
  entries() {
    return this.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: this.descriptions.get(row.name) || "",
      client: this.clients.get(row.name) || null,
      disabled: Boolean(row.disabled),
      config: row.config ?? null,
      active: this.activeIds.has(row.id) && !row.disabled,
      error: this.failures.get(row.id) || null,
    }));
  }

  async add({ id, name, config = null }) {
    const row = normalizeRow({ id, name, ...(config == null ? {} : { config }) });
    const index = this.baseRows.findIndex((item) => item.id === row.id);
    const exists = index >= 0;
    if (exists) this.baseRows[index] = { ...this.baseRows[index], ...row };
    else this.baseRows.push(row);

    try {
      await this.activate(row, !exists);
      await this.loader.await();
      this.failures.delete(row.id);
      await this.describeRow(row.name);
      this.compose();
      await this.persist();
      return { ok: true, id: row.id, updated: exists };
    } catch (error: any) {
      const reason = String(error?.message || error);
      this.failures.set(row.id, reason);
      // 装不上的条目不留在清单里，避免每次启动都重复失败
      if (!exists) this.baseRows = this.baseRows.filter((item) => item.id !== row.id);
      this.compose();
      await this.persist();
      return { ok: false, id: row.id, error: reason };
    }
  }

  /**
   * 把调用方给的目标解析成条目 id 列表。
   * 同时接受**条目 id** 与**插件包名**——uninstall 收包名而启停/配置收条目 id
   * 这种不一致很容易让界面传错，这里统一兜住；都匹配不到时给出可用取值。
   */
  resolveTargetIds(target) {
    const key = String(target || "");
    if (this.rows.some((row) => row.id === key)) return [key];
    const bundle = this.bundles.find((item) => item.name === key || item.packageName === key);
    if (bundle) {
      const ids = this.rows.filter((row) => resolveOwnsId(bundle, row.id)).map((row) => row.id);
      if (ids.length) return ids;
    }
    return [];
  }

  targetError(id) {
    const ids = this.rows.map((row) => row.id);
    const names = this.bundles.map((bundle) => bundle.name);
    return `找不到插件 ${id}；可用条目 id：${ids.join(", ") || "（空）"}；可用插件包：${names.join(", ") || "（空）"}`;
  }

  async setEnabled(target, enabled) {
    const ids = this.resolveTargetIds(target);
    if (!ids.length) return { ok: false, id: target, error: this.targetError(target) };
    const results = [];
    for (const id of ids) {
      const row = this.baseRows.find((item) => item.id === id);
      if (row) {
        if (enabled) delete row.disabled;
        else row.disabled = true;
      } else {
        // bundle 提供的条目：写宿主侧覆盖，不改插件包自己的 patch
        this.overrides[id] = { ...(this.overrides[id] || {}), disabled: !enabled };
      }
      try {
        await (this.loader as any).update(id, { disabled: !enabled });
        if (enabled) { this.failures.delete(id); this.activeIds.add(id); }
        else this.activeIds.delete(id);
        results.push({ id, ok: true });
      } catch (error: any) {
        const reason = String(error?.message || error);
        this.failures.set(id, reason);
        results.push({ id, ok: false, error: reason });
      }
    }
    await this.loader.await();
    this.compose();
    await this.persist();
    await this.persistBundles();
    const failed = results.filter((item) => !item.ok);
    return failed.length
      ? { ok: false, id: target, error: failed[0].error, results }
      : { ok: true, id: target, enabled: Boolean(enabled), ids, results };
  }

  async configure(target, config) {
    const ids = this.resolveTargetIds(target);
    if (!ids.length) return { ok: false, id: target, error: this.targetError(target) };
    for (const id of ids) {
      const row = this.baseRows.find((item) => item.id === id);
      if (row) row.config = config ?? null;
      else this.overrides[id] = { ...(this.overrides[id] || {}), config: config ?? null };
      try {
        await (this.loader as any).update(id, { config: config ?? null });
      } catch (error: any) {
        this.failures.set(id, String(error?.message || error));
      }
    }
    await this.loader.await();
    this.compose();
    await this.persist();
    await this.persistBundles();
    return { ok: true, id: target, ids };
  }

  async remove(id) {
    const row = this.baseRows.find((item) => item.id === id);
    if (!row && this.rows.some((item) => item.id === id)) {
      const owner = this.bundles.find((bundle) => resolveOwnsId(bundle, id));
      return {
        ok: false,
        id,
        error: `条目 ${id} 由插件包 ${owner?.name || "（bundle）"} 提供，请卸载该插件包而不是单独删除条目`,
      };
    }
    this.baseRows = this.baseRows.filter((item) => item.id !== id);
    this.failures.delete(id);
    this.activeIds.delete(id);
    try {
      if (row) {
        (this.loader as any).remove(id);
        await this.loader.await();
      }
      this.compose();
      await this.persist();
      return { ok: true, id };
    } catch (error: any) {
      return { ok: false, id, error: String(error?.message || error) };
    }
  }

  status() {
    return {
      dir: this.dir,
      tree: this.treeFile(),
      mounted: true,
      count: this.rows.length,
      failed: this.failures.size,
    };
  }
}

/** 首次运行铺 profile：清单 + 空插件树。已存在则原样保留（纯 fs，不依赖 ctx）。 */
export async function ensurePluginProfile(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  const manifest = path.join(dir, PROFILE_MANIFEST);
  try {
    await fs.access(manifest);
  } catch {
    await fs.writeFile(
      manifest,
      `${JSON.stringify({
        name: "dyworker-plugins",
        version: "0.0.0",
        private: true,
        description: "DYWorker 插件 profile（与 DSH profile 同构但不共用）",
        dependencies: {},
      }, null, 2)}\n`,
      "utf8",
    );
  }
  const tree = path.join(dir, TREE_FILE);
  try {
    await fs.access(tree);
  } catch {
    await fs.writeFile(tree, stringifyTree([]), "utf8");
  }
  const workspace = path.join(dir, WORKSPACE_FILE);
  try {
    await fs.access(workspace);
  } catch {
    // 与 DSH profile 同构：本目录自己就是一个 workspace 根
    await fs.writeFile(workspace, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', "utf8");
  }
  return dir;
}

/**
 * 挂载插件宿主：
 *   1. 铺 profile 并确定 baseUrl（目录 URL，相对路径条目以它为基准）；
 *   2. baseUrl 必须同时写在 root 上——loader 的 import 会读 ctx.baseUrl，
 *      只写在子上下文上它看不到；
 *   3. 先挂 Loader，再构造 PluginHostService（它 inject loader）；
 *   4. 读清单装载条目。
 */
export async function mountPluginHost(ctx: any, dir: string) {
  await ensurePluginProfile(dir);
  const baseUrl = new URL(".", pathToFileURL(path.join(dir, TREE_FILE))).href;
  ctx.baseUrl = baseUrl;
  if (ctx.root) ctx.root.baseUrl = baseUrl;
  await ctx.plugin(Loader, { baseUrl });
  const service = new PluginHostService(ctx, { dir, loader: ctx.loader });
  await service.load();
  return service;
}
