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
import { composeRows, describeBundle, readPackageManifest, resolvePackageDir, pluginConfigDefaults } from "./plugin-bundle.mts";
import { analyzePlugin, formatMatrix } from "./dsh-compat.mts";
import { HOST_CLIENT_MODULES, orderClientModules, readStaticRequires, resolveClientEntries, resolveModuleEntries, splitModuleSpec } from "./plugin-client.mts";
import { detectInstalledPackageName, hostCordisDir, hostPackageDir, installPackageIntoProfile, linkHostCordis, newestVersion, parsePluginSource, readProfileDependencies, spawnRunner } from "./plugin-install.mts";
import { runtimeImportsOf, runtimePackageName } from "./plugin-runtime-deps.mts";
import { pluginModuleUrl, resolvePluginModule, refreshPluginModules, registerPluginModules } from "./plugin-module-cache.mts";
import { DshPluginBridge } from "./dsh-runtime/bridge.mts";
import { DSH_VERSION, DSH_BASELINE, isDshPackage } from "./dsh-runtime/baseline.mts";
import { transactPluginProfile } from "./plugin-transaction.mts";
import { collectProfilePackages, restoreMissingProfilePackages } from './profile-preservation.mts';
import { Service } from "@deepseek-ai/cordis";
import Loader, { Group } from "@deepseek-ai/cordis-plugin-loader";
import Include from '@deepseek-ai/cordis-plugin-include';
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { evaluatePluginCompatibility, readProfileVersionExemptions, setProfileVersionExemption } from '@deepseek-ai/dsh-app-boot';
import { fileURLToPath } from 'node:url';

const treeYaml = createRequire(import.meta.resolve('@deepseek-ai/cordis-plugin-include'))('js-yaml');
import semver from "semver";

declare module "@deepseek-ai/cordis" {
  interface Context {
    plugins: PluginHostService;
  }
}

// 清单文件名。方言与 dsh 的 cordis.yml 一致，但文件名独立，
// 避免被 DSH 的工装（dsh plugin / dsh config 命令）误读误写。
/**
 * 从某个包目录出发能否解析到模块——与插件自己的 import 语义一致。
 *
 * 不能复用我们的 resolveClientModule：它会搜 DSH 共享目录等额外根，
 * 于是出现"我们找得到、插件 import 不到"的错判，补依赖被跳过，插件启动即报
 * Cannot find package。
 */
function resolvableFrom(fromDir: string, spec: string): boolean {
  const base = path.join(fromDir, "package.json");
  try { createRequire(base).resolve(spec); return true; }
  catch { return false; }
}

// Cordis 发布包中的 FiberState 是 const enum，没有 JavaScript 导出。
const FiberState = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, DISPOSED: 4, UNLOADING: 5 };

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
  const config = pluginConfigDefaults(name, row?.config);
  if (config != null) out.config = config;
  for (const key of ['disabled', 'group', 'inject']) if (row?.[key] != null) out[key] = row[key];
  if (row?.group && Array.isArray(out.config)) out.config = out.config.map(normalizeRow);
  // 内置标记要透传：界面据此显示「内置」，停用/启用也走同一条路径
  if (row?.builtin) out.builtin = true;
  return out;
}

export function parseTree(text) {
  const data = treeYaml.load(text || "", { schema: entryListSchema }) ?? [];
  if (!Array.isArray(data)) throw new Error(`${TREE_FILE} 顶层必须是条目数组`);
  return data.map(normalizeRow);
}

export function stringifyTree(rows) {
  return HEADER + (rows.length ? treeYaml.dump(rows, { schema: entryListSchema, lineWidth: 120, noRefs: true }) : "[]\n");
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

function includesModule(rows, spec) {
  return rows.some(row => row.name === spec || (row.group && Array.isArray(row.config) && includesModule(row.config, spec)));
}

/**
 * 从 "Cannot find package 'X'" 里的 X 还原出可安装的包名。
 * X 可能是裸包名（@scope/name、name），也可能是 profile/node_modules 下的绝对路径
 * （包自身残缺时 Node 会退化到 <dir>/index.js）。后者要能反推出 @scope/name 才能重装。
 */
function packageNameFromMissing(missing: string, profileDir: string): string {
  const raw = String(missing || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("/") && !raw.startsWith(".")) return raw;
  // /tmp 与 /private/tmp 这种软链差异会让前缀比较失败（macOS 上实测踩到），
  // 两边都归一化到真实路径再比。
  const real = (value: string) => {
    try {
      return realpathSync(value);
    } catch {
      return value;
    }
  };
  const normalizedRaw = real(raw);
  const nodeModules = path.join(real(profileDir), "node_modules") + path.sep;
  if (!normalizedRaw.startsWith(nodeModules)) return "";
  const rest = normalizedRaw.slice(nodeModules.length).split(path.sep);
  if (!rest.length) return "";
  const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1] || ""}` : rest[0];
  return name.includes("/") && name.endsWith("/") ? "" : name;
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
  /**
   * 解析插件包目录：优先插件自己的 node_modules，其次**内置插件目录**。
   * 内置插件随应用分发，不归 npm 管（npm install 会把它剪掉），所以走独立目录。
   */
  packageDirOf(name) {
    const spec = String(name || "");
    if (spec.startsWith('.') || path.isAbsolute(spec) || spec.startsWith('file:')) {
      let dir = path.dirname(fileURLToPath(new URL(this.resolveSpecifier(spec))));
      while (true) {
        try { if (statSync(path.join(dir, 'package.json')).isFile()) return dir; } catch {}
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error(`本地插件缺少 package.json：${spec}`);
        dir = parent;
      }
    }
    try {
      return resolvePackageDir(this.profileManifest(), splitModuleSpec(spec).name);
    } catch (error) {
      const builtin = this.builtinPlugins().find((entry) => entry.name === spec || entry.id === spec);
      if (builtin) return builtin.dir;
      throw error;
    }
  }

  /** 条目模块名 → 包描述（手工加进清单、不走 bundle 的条目也要能显示说明） */
  descriptions = new Map();

  /** 内置插件根目录（随应用分发，不走 npm 管理的插件目录） */
  builtinDir = "";

  /**
   * 扫描内置插件：每个子目录（或 @scope/name 两级）只要有 package.json 且声明了
   * dsh/dyworker 插件字段，就算一个内置插件。它们**默认启用**，用户可在插件页停用。
   */
  builtinPlugins() {
    const root = this.builtinDir;
    if (!root) {
      console.warn("[plugins] 未配置内置插件目录");
      return [];
    }
    const found = [];
    const readDir = (dir, prefix) => {
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const name = entry.name;
        if (name.startsWith(".")) continue;
        const full = path.join(dir, name);
        if (prefix) {
          const manifest = this.readBuiltinManifest(full);
          if (manifest) found.push({ id: manifest.name || `${prefix}/${name}`, name: manifest.name || `${prefix}/${name}`, dir: full });
          continue;
        }
        if (name.startsWith("@")) { readDir(full, name); continue; }
        const manifest = this.readBuiltinManifest(full);
        if (manifest) found.push({ id: manifest.name || name, name: manifest.name || name, dir: full });
      }
    };
    readDir(root, "");
    return found;
  }

  private readBuiltinManifest(dir) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      if (!manifest?.name) return null;
      if (!manifest.dsh && !manifest.dyworker) return null;
      return manifest;
    } catch {
      return null;
    }
  }

  /** 条目模块名 → 客户端半边声明（dsh.client，没有则为 null） */
  clients = new Map();

  /** 当前真正装载成功的条目 id（服务自己维护，不去反射 loader：
   *  loader 内部实现会在严格访问检查下抛错，被 catch 吞掉会表现为"装了但显示未生效"） */
  activeIds = new Set();
  /** id → 装载失败原因（模块解析不到 / 预检 import 失败等） */
  failures = new Map();
  remote = new Map<string, { bridge: DshPluginBridge; disposeTools: Array<() => void> }>();
  activated = new Map<string, string>();
  isolatedIds = new Set<string>();
  sessionRequired = new Set<string>();

  constructor(ctx, config = {} as any) {
    super(ctx, "plugins");
    this.dir = config.dir;
    ctx.effect(() => registerPluginModules(this.dir));
    this.loader = config.loader;
    this.builtinDir = config.builtinDir || "";
    ctx.effect(() => async () => { await Promise.all([...this.remote.keys()].map(id => this.deactivate(id))); });
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
    // 内置插件：清单里已有的条目**打上内置标记**，清单里没有的补一行（默认启用）。
    // 注意不能简单地"跳过已有的"——用户装过同名插件时清单里已经有它，那样就永远打不上标记。
    const builtins = this.builtinPlugins();
    const builtinNames = new Set(builtins.map((entry) => entry.name));
    const builtinIds = new Set(builtins.map((entry) => entry.id));
    const extraRows = builtins
      .filter((entry) => !this.baseRows.some((row) => row.id === entry.id || row.name === entry.name))
      .map((entry) => ({ id: entry.id, name: entry.name }));
    const rows = composeRows([...this.baseRows, ...extraRows], layers, (message: any, ...args: any[]) => {
      warnings.push(`${message}${args.length ? ` ${args.join(" ")}` : ""}`);
    });
    // 陈旧覆盖清理：覆盖是**打在条目上的补丁**，条目不存在时它永远找不到目标，
    // 每次组装都报 "entry ... not found"（用户 profile 里就留着这样一条 overrides.dsh-context，
    // 而 dyworker.yml 是空的——早前安装失败留下的）。
    // 注意判据是**组装后的条目**（bundle 的 patch 能插入条目，那些条目不 baseRows 里），
    // 只按 baseRows 判断会把它们的配置/启停覆盖一起误删（测试就抓到了这个）。
    const composedIds = new Set(rows.map((row: any) => String(row.id)));
    const stale = Object.keys(this.overrides).filter((id) => !composedIds.has(String(id)));
    if (stale.length) {
      for (const id of stale) delete (this.overrides as any)[id];
      warnings.push(`已清理 ${stale.length} 条失效的插件覆盖记录（条目不存在）：${stale.slice(0, 3).join("、")}`);
      void this.persistBundles();
      // 清掉之后再组装一次，避免这一轮的告警与结果里还带着失效补丁
      return this.compose();
    }
    this.patchWarnings = warnings;
    this.rows = rows.map((row) => normalizeRow(
      builtinNames.has(row.name) || builtinIds.has(row.id) ? { ...row, builtin: true } : row,
    ));
    return this.rows;
  }

  /** 用 profile 自己的解析上下文解析模块名——这是能用 node_modules 里插件的前提 */
  resolveSpecifier(name) {
    const spec = String(name || "").trim();
    if (!spec) throw new Error("模块名为空");
    if (spec.startsWith("cordis:")) return spec;
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:")) {
      // 相对路径按 profile 目录解析（与 dsh 的 cordis.yml 写法一致）
      return pluginModuleUrl(fileURLToPath(new URL(spec, pathToFileURL(this.treeFile()))), this.dir);
    }
    const profileRequire = createRequire(this.profileManifest());
    try {
      return resolvePluginModule(spec, this.dir) || pluginModuleUrl(profileRequire.resolve(spec), this.dir);
    } catch (error: any) {
      // 内置插件不装进 profile（npm 会剪掉），改从内置目录解析主入口
      const builtin = this.builtinPlugins().find((entry) => entry.name === spec || entry.id === spec);
      if (builtin) {
        try {
          const manifest = JSON.parse(readFileSync(path.join(builtin.dir, "package.json"), "utf8"));
          const main = path.resolve(builtin.dir, manifest.main || manifest.exports?.["."]?.default || "lib/index.js");
          return pathToFileURL(main).href;
        } catch {
          // 落到下面的错误提示
        }
      }
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
      const dir = this.packageDirOf(key);
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
      this.failures.delete('<tree>');
      return { ok: true };
    }
    try {
      this.baseRows = parseTree(text);
      this.failures.delete('<tree>');
      return { ok: true };
    } catch (error: any) {
      const reason = String(error?.message || error);
      this.failures.set("<tree>", reason);
      return { ok: false, error: reason };
    }
  }

  /** 装配：用户层 + bundle 记录 → 合成 → 逐条装载 */
  async load() {
    // 应用升级后，旧共享软链可能仍指向上一个安装目录；只更新软链，不覆盖真实插件包。
    for (const name of [...Object.keys(DSH_BASELINE), 'zod']) {
      const link = path.join(this.dir, 'node_modules', name);
      const stat = await fs.lstat(link).catch(() => null);
      if (!stat?.isSymbolicLink()) continue;
      const target = hostPackageDir(name); if (!target || await fs.readlink(link) === target) continue;
      await fs.unlink(link); await fs.symlink(target, link, 'dir');
      refreshPluginModules(this.dir);
    }
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

  /** 按当前合成结果更新条目；未改变的插件继续运行。 */
  async reload() {
    // 重读用户层：手工改过 dyworker.yml 之后 reload 必须能看到改动
    const read = await this.readBaseRows();
    if (!read.ok) return read;
    const previous = [...this.rows];
    this.compose();
    for (const row of previous) if (!this.rows.some(item => item.id === row.id)) await this.deactivate(row.id);
    for (const row of this.rows) {
      await this.describeRow(row.name);
      try {
        const signature = await this.activationSignature(row);
        if (this.activated.get(row.id) === signature) continue;
        await this.deactivate(row.id);
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

  /** 安装预检使用与最终装载相同的配置，包括现有用户覆盖。 */
  installationRows(described) {
    const bundles = [...this.bundles];
    const index = bundles.findIndex(bundle => bundle.name === described.name);
    if (index >= 0) bundles[index] = described;
    else bundles.push(described);
    const overlay = Object.entries(this.overrides).map(([id, patch]) => ({ id, ...(patch as any) }));
    return composeRows(this.baseRows, [...bundles.map(bundle => bundle.patches), overlay]);
  }

  /** 安装一个插件包：解析包 → 读它的 bundle patch → 叠加合成 → 落盘 */
  async install({ spec, id, allowIncompatible = false }: any = {}) {
    const name = String(spec || "").trim();
    if (!name) throw new Error("install 需要插件包名");
    const described = await describeBundle(this.profileManifest(), name, { id });

    // 兼容性判定前置：不兼容的包直接拒绝，避免"装上了但什么都不做"
    const manifest = await readPackageManifest(described.dir);
    const rows = this.installationRows(described);
    const analysis = await analyzePlugin(this.profileManifest(), name, manifest, described.dir,
      { config: rows.find(row => row.name === name)?.config ?? {},
        metadataOnly: described.declared && !includesModule(rows, name) });
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
      ...(existing >= 0 ? this.bundles[existing] : {}),
      name,
      packageName: described.packageName,
      version: described.version,
      description: described.description || "",
      patchFile: described.patchFile,
      patchFiles: described.patchFiles,
      declared: described.declared,
      patches: described.patches,
    };
    // 沿用“仍然安装”的明确选择，通过官方独立授权文件保存精确版本。
    if (allowIncompatible && analysis.versionIssue && !analysis.versionIssue.exempted)
      await setProfileVersionExemption(this.dir, `${manifest.name}@${manifest.version}`, DSH_VERSION, true, true);
    if (existing >= 0) this.bundles[existing] = record;
    else this.bundles.push(record);
    await this.reload();
    await this.persistBundles();
    const failed = this.rows.filter((row) => (row.name === name || resolveOwnsId(record, row.id))
      && this.failures.has(row.id)).map((row) => row.id);
    // 失败时必须把**真实原因**带出去：以前只回 ok:false，error 是空的——
    // 界面上只剩"安装失败"四个字，调用方（含安装自愈）也拿不到"缺哪个包"的线索。
    const firstFailure = failed.length ? String(this.failures.get(failed[0]) || "") : "";
    return {
      ok: failed.length === 0,
      name,
      updated: existing >= 0,
      entries: this.rows.length,
      failed,
      ...(failed.length ? { error: firstFailure || `插件 ${name} 激活失败` } : {}),
      verdict: analysis.verdict,
      analysis,
      matrix: formatMatrix(analysis),
    };
  }

  /** 卸载插件包：撤掉它的 patch，重建条目 */
  async uninstall({ spec }: any = {}) {
    const name = String(spec || "").trim();
    const row = this.rows.find(item => item.id === name || item.name === name);
    if (row?.builtin) return { ok: false, name, error: '内置插件可停用，不能卸载' };
    const owner = this.bundles.find(bundle => bundle.name === name || bundle.packageName === name || (row && resolveOwnsId(bundle, row.id)));
    if (!owner && this.baseRows.some(item => item.id === name || item.name === name)) {
      const ids = this.baseRows.filter(item => item.id === name || item.name === name).map(item => item.id);
      for (const id of ids) { const result = await this.remove(id); if (!result.ok) return result; }
      return { ok: true, name, removed: true, entries: this.rows.length };
    }
    const before = this.bundles.length;
    this.bundles = this.bundles.filter((bundle) => bundle !== owner);
    await this.reload();
    await this.persistBundles();
    return { ok: true, name, removed: before !== this.bundles.length, entries: this.rows.length };
  }

  /**
   * 从包管理器把插件包装进 profile，再走常规安装。
   * 默认 --ignore-scripts（不跑安装脚本）、--save-exact（钉版本）。
   */
  async installPackage({ input, spec, version = null, source = "default", customRegistry, allowIncompatible = false, npmPath, ignoreScripts = true, run }: any = {}) {
    const options = { input, spec, version, source, customRegistry, allowIncompatible, npmPath, ignoreScripts, run };
    return transactPluginProfile(this.dir, async stage => {
      const preserved = await collectProfilePackages(this.dir, [...this.bundles.map(bundle => bundle.packageName || bundle.name),
        ...this.baseRows.filter(row => !row.builtin).map(row => runtimePackageName(row.name))]);
      const runner = run || spawnRunner;
      let updating: string;
      try { const parsed = parsePluginSource(String(input || spec || '')); if (parsed.kind === 'npm') updating = parsed.name; } catch { /* 安装入口负责返回无效来源。 */ }
      const guardedRun = async (command: string, args: any[], commandOptions: any) => {
        const result = await runner(command, args, commandOptions);
        if (args[0] === 'install') await restoreMissingProfilePackages(stage, preserved, updating);
        return result;
      };
      // 仅复用安装/分析方法，不创建 Service、不运行主进程插件、不修改当前条目。
      const staging = Object.create(this);
      staging.dir = stage;
      staging.bundles = structuredClone(this.bundles);
      staging.overrides = structuredClone(this.overrides);
      staging.install = async ({ spec, allowIncompatible }) => {
        const described = await describeBundle(staging.profileManifest(), spec);
        const manifest = await readPackageManifest(described.dir);
        const rows = staging.installationRows(described);
        const config = rows.find(item => item.name === spec)?.config ?? {};
        const metadataOnly = described.declared && !includesModule(rows, spec);
        const analysis = await analyzePlugin(staging.profileManifest(), spec, manifest, described.dir, { config, metadataOnly });
        if (analysis.verdict !== "runnable" && !allowIncompatible) return { ok: false, error: analysis.reasons.join("；"), analysis };
        if (allowIncompatible && analysis.versionIssue && !analysis.versionIssue.exempted)
          await setProfileVersionExemption(stage, `${manifest.name}@${manifest.version}`, DSH_VERSION, true, true);
        if (!metadataOnly && isDshPackage(manifest) && analysis.runtime !== 'dsh-session') {
          const bridge = new DshPluginBridge({ profileDir: stage, packageDir: described.dir, entryUrl: staging.resolveSpecifier(spec),
            config });
          try { await bridge.discover(); } finally { await bridge.dispose(); }
        }
        return { ok: true, name: spec, analysis };
      };
      return staging.installPackageInPlace({ ...options, run: guardedRun });
    }, async prepared => {
      refreshPluginModules(this.dir); this.descriptions.clear(); this.clients.clear();
      const result = await this.install({ spec: prepared.name, allowIncompatible });
      if (result.ok) {
        const bundle = this.bundles.find(row => row.name === prepared.name);
        if (bundle) {
          bundle.source = prepared.source;
          if (version) bundle.pinnedVersion = version;
          await this.persistBundles();
        }
      }
      return { ...prepared, ...result, dir: this.dir };
    }, async () => {
      refreshPluginModules(this.dir); this.descriptions.clear(); this.clients.clear();
      await this.readBundles(); await this.reload();
    }, () => !this.ctx.tools?.executing && !this.ctx.get('dshRuntime')?.busy,
    async () => this.ctx.get('dshRuntime')?.suspendViewsForProfileSwitch());
  }

  async installPackageInPlace({ input, spec, version = null, source = "default", customRegistry, allowIncompatible = false, npmPath, ignoreScripts = true, run }: any = {}) {
    const rawInput = String(input || spec || "").trim();
    if (!rawInput) throw new Error("installPackage 需要插件包名 / GitHub 地址 / 本地路径");

    const before = await readProfileDependencies(this.dir);
    const installArgs = {
      dir: this.dir,
      input: rawInput,
      version,
      source,
      customRegistry,
      npmPath: npmPath || process.env.DYWORKER_NPM || null,
      ignoreScripts,
      // 与 DSH 的 autoInstallPeers:false 一致：peer 由宿主提供，按实际入口补齐。
      legacyPeerDeps: true,
      run,
    };
    const downloaded: any = await installPackageIntoProfile(installArgs);
    if (!downloaded.ok) return {
      ok: false, stage: "download", name: rawInput, ...downloaded,
      source: { kind: downloaded.kind, input: rawInput, source }, dir: this.dir,
    };
    refreshPluginModules(this.dir);

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

    // **先补运行时依赖（含 cordis 软链），再激活**。
    // 顺序反了会死锁：激活需要 cordis，而补依赖挂在 "激活成功" 之后——激活失败就永远不补。
    // 实测用户装 dsh-context 就是这样：npm 把 cordis 软链抹掉 → 激活报 Cannot find package
    // → 补依赖不执行 → UI 上只说"安装失败"且没有原因。
    const peerOptions = { npmPath: npmPath || process.env.DYWORKER_NPM || null, source, customRegistry, run };
    const dependencies = await this.ensureRuntimePeers(packageName, peerOptions);
    if (dependencies.failed.length) {
      return {
        ok: false, stage: "dependencies", name: packageName, downloaded, dependencies,
        source: { kind: downloaded.kind, input: rawInput, source }, dir: this.dir,
        error: dependencies.failed.map((item) => `${item.name}：${item.error}`).join("；"),
      };
    }
    let installed: any = await this.install({ spec: packageName, allowIncompatible });
    // 缺失依赖不再自动升级到无约束最新版；由暂存事务回退并返回具体原因。
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
    return {
      ok: installed.ok,
      stage: installed.ok ? "done" : "activate",
      name: packageName,
      downloaded,
      source: { kind: downloaded.kind, input: rawInput, source },
      dir: this.dir,
      dependencies,
      legacyPeerDeps: true,
      ...installed,
      // 激活失败要把原因带出去：否则界面上只有"安装失败"四个字，用户与排查都无从下手
      ...(installed.ok ? {} : { error: String((installed as any).error || "插件激活失败") }),
    };
  }

  /** 解析条目对应的插件包与客户端入口 */
  async clientEntriesOf(target) {
    const key = String(target || "");
    const row = this.rows.find((item) => item.id === key || item.name === key);
    if (!row) throw new Error(`插件不在清单里：${key}`);
    const dir = this.packageDirOf(row.name);
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
      const plan = await this.clientModulePlan(target);
      return {
        ok: true,
        // URL 末段是**该包内的客户端入口序号**（不是模块在计划里的位置）：
        // 协议处理器按 包名 + 包内序号 解析，因此这里固定取主入口 0。
        modules: plan.ordered.map((node) => ({
          spec: node.spec,
          url: `dyworker-plugin://module/${encodeURIComponent(node.spec)}/0?rev=${this.clientRevision(this.clientModuleFile(node.spec, 0))}`,
        })),
        missingModules: plan.missing,
        id: row.id,
        name: row.name,
        version: String(manifest.version || ""),
        platform: String(client.platform || ""),
        inject: Array.isArray(client.inject) ? client.inject : [],
        entries: entries.map((entry, index) => ({
          subpath: entry.subpath,
          relative: entry.relative,
          primary: entry.primary,
          url: `dyworker-plugin://client/${encodeURIComponent(row.id)}/${index}?rev=${this.clientRevision(entry.file)}`,
        })),
      };
    } catch (error: any) {
      return { ok: false, id: String(target || ""), error: String(error?.message || error) };
    }
  }

  /**
   * 按实际入口补齐运行时依赖，并共享宿主已经提供的公共模块。
   * peer 清单仅用于确定实际引用的版本约束，不作为递归安装清单。
   */
  async ensureRuntimePeers(packageName, options: any = {}) {
    const { npmPath, source = "default", customRegistry, run } = options;
    const installed = [];
    const failed = [];
    const reused = new Set<string>();
    const queue = [
      { spec: packageName, side: "host", fromDir: this.dir, range: "*" },
      { spec: packageName, side: "client", fromDir: this.dir, range: "*" },
    ];
    const seen = new Set<string>();
    const shared = new Map(Object.keys(DSH_BASELINE).map(name => [name, hostPackageDir(name)]).filter(([, dir]) => dir) as Array<[string, string]>);
    const linkShared = async (name, target) => {
      if (!target) return;
      const link = path.join(this.dir, "node_modules", name);
      await fs.mkdir(path.dirname(link), { recursive: true });
      await fs.rm(link, { recursive: true, force: true });
      await fs.symlink(target, link, "dir");
    };
    try {
      while (queue.length && seen.size < 128) {
        const job = queue.shift()!;
        const name = runtimePackageName(job.spec);
        if (job.side === "host" && DSH_BASELINE[name]) { reused.add(name); continue; }
        if (job.side === "client" && HOST_CLIENT_MODULES.has(job.spec)) { reused.add(job.spec); continue; }
        if (name === "@deepseek-ai/cordis") { reused.add(name); continue; }
        const key = `${job.side}:${job.spec}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const range = semver.validRange(job.range) ? job.range : "*";
        // 宿主已经随应用分发的公共库共享同一份，不为插件重复安装。
        if (job.side === "host" && (name.startsWith("@deepseek-ai/") || name === "zod")) {
          const hostDir = hostPackageDir(name);
          if (hostDir) {
            const hostManifest = await readPackageManifest(hostDir);
            if (semver.satisfies(hostManifest.version, range, { includePrerelease: true })) {
              shared.set(name, hostDir);
              await linkShared(name, hostDir);
              reused.add(name);
              continue;
            }
          }
        }
        let dir = "";
        let manifest: any;
        try {
          dir = resolvePackageDir(path.join(job.fromDir, "package.json"), name);
          manifest = await readPackageManifest(dir);
          if (!semver.satisfies(manifest.version, range, { includePrerelease: true })) dir = "";
          if (dir && job.side === "host" && !resolvableFrom(job.fromDir, job.spec)) dir = "";
        } catch { dir = ""; }
        if (!dir) {
          // 官方组件必须使用完整基线，不能以 latest 修复混合版本。
          const version = DSH_BASELINE[name] || await newestVersion(name, { npmPath, source, customRegistry, run, range });
          if (!version) { failed.push({ name, error: `无法从所选安装源取得 ${name} 的可用版本（需要 ${range}）` }); continue; }
          const result = await installPackageIntoProfile({
            dir: this.dir, input: name, version, source, customRegistry, run,
            ignoreScripts: true, legacyPeerDeps: true, npmPath,
          });
          if (!result.ok) { failed.push({ name, error: String(result.error || "依赖安装失败") }); continue; }
          installed.push(`${name}@${version}`);
          dir = this.packageDirOf(name);
          manifest = await readPackageManifest(dir);
        }
        const found = { manifest, dir };
        let entries: string[];
        if (job.side === "client") {
          // 插件没有浏览器半边时，不把它的后台入口再当客户端扫描。
          if (name === packageName && !resolveClientEntries(manifest, dir).length) continue;
          const { subpath } = splitModuleSpec(job.spec);
          const exported = subpath ? manifest.exports?.[subpath] : null;
          const relative = typeof exported === "string" ? exported : exported?.default || exported?.import;
          entries = resolveModuleEntries({ ...found, ...(relative ? { relative } : {}) }).map((entry) => entry.file);
        } else {
          const { subpath } = splitModuleSpec(job.spec);
          const exported = manifest.exports?.[subpath === "" ? "." : subpath];
          const relative = typeof exported === "string" ? exported : exported?.import || exported?.default;
          entries = [path.resolve(dir, relative || manifest.main || "index.js")];
        }
        // 只跟踪被实际文件使用的 import / require；不递归安装 peer 服务包。
        const imports = await runtimeImportsOf(dir, entries);
        if (job.side === "client") {
          const client = manifest.dyworker?.client || manifest.dsh?.client;
          if (Array.isArray(client?.inject)) imports.push(...client.inject.map(String));
          if (Array.isArray(client?.external)) imports.push(...client.external.map(String));
        }
        for (const spec of new Set(imports)) {
          const dep = runtimePackageName(spec);
          queue.push({ spec, side: job.side, fromDir: dir, range: manifest.dependencies?.[dep] || manifest.peerDependencies?.[dep] || "*" });
        }
      }
      if (queue.length) failed.push({ name: packageName, error: "插件实际依赖过多，已停止补装" });
    } catch (error: any) {
      failed.push({ name: packageName, error: String(error?.message || error) });
    } finally {
      // npm 会剪掉未声明的软链，每轮安装后恢复宿主公共库。
      for (const [name, target] of shared) {
        try { await linkShared(name, target); }
        catch (error: any) { failed.push({ name, error: String(error?.message || error) }); }
      }
      if (installed.length) refreshPluginModules(this.dir);
    }
    return { installed, failed, reused: [...reused] };
  }

  /** 客户端模块只从自己的插件环境解析，不借用用户的 DSH 安装。 */
  clientModuleRoots() {
    return [path.join(this.dir, "node_modules")];
  }

  /** 按包名找客户端模块（返回 manifest 与包目录） */
  resolveClientModule(spec) {
    const { name, subpath } = splitModuleSpec(String(spec || ""));
    if (!name) return null;
    for (const root of this.clientModuleRoots()) {
      const dir = path.join(root, ...name.split("/"));
      try {
        const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
        // 子路径入口：exports["./sub"]（可能是字符串或 { default }）
        const target = subpath ? manifest?.exports?.[subpath] : undefined;
        const relative = typeof target === "string"
          ? target
          : target && typeof target === "object" ? target.default : undefined;
        if (subpath && !relative) return null;
        return { manifest, dir, relative };
      } catch {
        // 换下一个来源
      }
    }
    return null;
  }

  /** 插件声明的客户端模块依赖图（依赖在前），以及解析不到的模块 */
  async clientModulePlan(target) {
    const { manifest } = await this.clientEntriesOf(target);
    const client = manifest.dsh?.client || manifest.dyworker?.client || {};
    const declared = [...(Array.isArray(client.inject) ? client.inject : []), ...(Array.isArray(client.external) ? client.external : [])].map(String);
    // 除了声明，还要把 bundle 里**字面量 require** 到的可解析模块算进来：
    // 有的模块（如 dsh-client-ui-slots）没被声明，但会被别的模块 require。
    const roots = [...declared];
    // 工作队列到不动点：新加入的模块里 require 到的模块也要继续扫，
    // 否则"被 require 但没声明"的模块（实测 dsh-client-ui-slots）会漏掉。
    // 注意逐模块 try/catch：任何一个模块读失败都不能中断整轮扫描。
    const seen = new Set(declared);
    const queue = [...declared];
    while (queue.length) {
      const spec = queue.shift()!;
      try {
        const found = this.resolveClientModule(spec);
        if (!found) continue;
        // 要扫的是**运行时真正会加载的文件**：两半都有的模块里，require 往往写在客户端半边
        // （lib/client.js），而 package.json 的主入口是主机半边（lib/index.js）。
        // 只扫主入口会漏掉客户端半边的 require——实测 dsh-api-session-controller 需要
        // @deepseek-ai/dsh-client-store，就是这样被漏掉的（结果运行时"宿主未提供该模块"）。
        const entries = resolveModuleEntries(found).map((entry) => ({ file: entry.file }));
        if (process.env.DYW_PLAN_DEBUG) console.log(`[plan] ${spec} → ${entries.map((e) => e.file.split("/").slice(-2).join("/")).join(", ")}`);
        for (const entry of entries) {
          const source = readFileSync(entry.file, "utf8");
          for (const required of readStaticRequires(source)) {
            if (seen.has(required) || !required.startsWith("@deepseek-ai/")) continue;
            if (this.resolveClientModule(required)) { seen.add(required); roots.push(required); queue.push(required); }
          }
        }
      } catch (error: any) {
        // 单个模块读失败：跳过它，继续扫其余模块
        if (process.env.DYW_PLAN_DEBUG) console.log(`[plan] ${spec} ✗ ${String(error?.message || error).slice(0, 120)}`);
      }
    }
    return orderClientModules(roots, (spec) => this.resolveClientModule(spec));
  }

  /** 协议处理器用：客户端模块名 + 序号 → bundle 绝对路径 */
  clientModuleFile(spec, index) {
    const found = this.resolveClientModule(spec);
    if (!found) throw new Error(`客户端模块未安装：${spec}`);
    // 用统一入口：纯库模块（无客户端半边）回退主入口，见 resolveModuleEntries
    const entries = resolveModuleEntries(found);
    const entry = entries[Number(index)];
    if (!entry) throw new Error(`客户端模块入口不存在：${spec} #${index}`);
    return entry.file;
  }

  /** 协议处理器用：条目 + 序号 → 客户端 bundle 的绝对路径 */
  async clientBundleFile(target, index) {
    const { entries } = await this.clientEntriesOf(target);
    const entry = entries[Number(index)];
    if (!entry) throw new Error(`客户端入口不存在：${target} #${index}`);
    return entry.file;
  }

  clientRevision(file: string) { const stat = statSync(file); return `${stat.mtimeMs}-${stat.size}`; }
  async clientResourceFile(owner: string, fileName: string, revision?: string) {
    if (fileName !== "client.js" && !/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(fileName)) throw new Error("插件资源名不合法");
    const row = this.rows.find(item => item.name === owner || item.id === owner);
    let main: string;
    if (row) {
      if (row.disabled) throw new Error("插件已停用");
      main = await this.clientBundleFile(row.id, 0);
    } else main = this.clientModuleFile(owner, 0);
    if (revision && revision !== "initial" && revision !== this.clientRevision(main)) throw new Error("插件资源版本已变化，请重新加载");
    const root = realpathSync(path.dirname(main));
    const file = realpathSync(path.join(root, fileName === "client.js" ? path.basename(main) : fileName));
    if (path.dirname(file) !== root) throw new Error("插件资源越出所属目录");
    return file;
  }

  /** 只做兼容性判定，不安装（装之前先看能不能跑） */
  async detail(id: string) {
    const entry = this.entries().find(row => row.id === id);
    if (!entry) throw new Error('插件不存在或已卸载');
    const bundle = this.bundles_().find(row => row.name === entry.name || row.packageName === entry.name) || null;
    let metadata: any = null; let readme = ''; let readmeTruncated = false; let metadataError: string | null = null;
    try {
      const root = await fs.realpath(this.packageDirOf(entry.name));
      const manifest = await readPackageManifest(root);
      const author = typeof manifest.author === 'string' ? manifest.author : String(manifest.author?.name || '');
      const repository = typeof manifest.repository === 'string' ? manifest.repository : String(manifest.repository?.url || '');
      metadata = { name: String(manifest.name || entry.name), version: String(manifest.version || ''),
        description: String(manifest.description || ''), author, license: typeof manifest.license === 'string' ? manifest.license : '',
        homepage: String(manifest.homepage || ''), repository,
        engines: Object.entries(manifest.engines || {}).map(([name, version]) => ({ name, version: String(version) })),
        dependencies: Object.entries(manifest.dependencies || {}).map(([name, version]) => ({ name, version: String(version) })),
        peerDependencies: Object.entries(manifest.peerDependencies || {}).map(([name, version]) => ({ name, version: String(version) })) };
      const fileName = (await fs.readdir(root)).filter(name => /^readme(?:\.(?:md|markdown|txt))?$/i.test(name)).sort()[0];
      if (fileName) {
        const file = await fs.realpath(path.join(root, fileName));
        if (path.dirname(file) !== root) throw new Error('插件说明文件指向包目录之外，未读取');
        const handle = await fs.open(file, 'r');
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) throw new Error('插件说明不是普通文件');
          const limit = 64 * 1024; const buffer = Buffer.alloc(limit);
          const { bytesRead } = await handle.read(buffer, 0, limit, 0);
          readme = buffer.subarray(0, bytesRead).toString('utf8'); readmeTruncated = stat.size > limit;
        } finally { await handle.close(); }
      }
    } catch (error) { metadataError = String(error?.message || error); }
    return { entry, bundle, metadata, readme, readmeTruncated, metadataError };
  }

  async compatibility({ spec }: any = {}) {
    const parsed = parsePluginSource(spec);
    const name = parsed.kind === "npm" ? parsed.name : "";
    if (!name) throw new Error("compatibility 需要插件包名");
    let described;
    try {
      described = await describeBundle(this.profileManifest(), name, {});
    } catch (error: any) {
      if (!String(error?.message || error).includes("插件包未安装到 profile")) throw error;
      return {
        name, version: parsed.version || "", verdict: "pending", matrix: "",
        reasons: ["插件尚未下载，安装时会自动下载依赖并检查兼容性"],
        missingPackages: [], services: [], clientHalf: null,
        hostHalf: { entry: "", importable: false, importError: null, inject: [], hints: [] },
      };
    }
    const manifest = await readPackageManifest(described.dir);
    const row = this.rows.find(row => row.name === name || row.id === spec);
    const rows = this.installationRows(described);
    const config = row?.config ?? rows.find(item => item.name === name)?.config ?? {};
    const metadataOnly = described.declared && !includesModule(rows, name);
    const analysis = await analyzePlugin(this.profileManifest(), name, manifest, described.dir, { config, metadataOnly });
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
    row = normalizeRow(row);
    const resolved = this.resolveSpecifier(row.name);
    // 含 DSH 插件的组整体交给官方会话加载器，保留组内提供服务和依赖等待。
    if (row.group && Array.isArray(row.config) && await this.containsDshPlugin(row.config)) {
      this.isolatedIds.add(row.id);
      await this.deactivate(row.id);
      if (row.disabled !== true) this.sessionRequired.add(row.id);
      this.activated.set(row.id, await this.activationSignature(row));
      await this.ctx.get('dshRuntime')?.closeIdle();
      return resolved;
    }
    if (!row.builtin && !row.group && !row.name.startsWith('cordis:')) {
      const packageDir = this.packageDirOf(row.name);
      const manifest = await readPackageManifest(packageDir);
      if (isDshPackage(manifest)) {
        this.isolatedIds.add(row.id);
        await this.deactivate(row.id);
        if (row.disabled !== true) {
          const analysis = await analyzePlugin(this.profileManifest(), row.name, manifest, packageDir,
            { config: row.config ?? {}, entryUrl: resolved });
          if (analysis.versionIssue && !analysis.versionIssue.exempted) throw new Error(analysis.reasons.join('；'));
          if (analysis.runtime === 'dsh-session' || row.inject != null || typeof row.disabled === 'object') {
            this.sessionRequired.add(row.id);
            this.activated.set(row.id, await this.activationSignature(row));
            await this.ctx.get('dshRuntime')?.closeIdle();
            return resolved;
          }
          const bridge = new DshPluginBridge({ profileDir: this.dir, packageDir, entryUrl: resolved, config: row.config ?? {} });
          const disposeTools: Array<() => void> = [];
          try {
            const schemas = await bridge.discover();
            for (const schema of schemas) disposeTools.push(this.ctx.tools.register({
              plugin: row.id, name: schema.name, description: schema.description, parameters: schema.parameters,
              risk: undefined,
              handler: (args, execution) => bridge.execute(schema.name, args, execution),
            }));
            this.remote.set(row.id, { bridge, disposeTools });
            this.activeIds.add(row.id);
          } catch (error) { disposeTools.forEach(dispose => dispose()); await bridge.dispose(); throw error; }
        }
        this.activated.set(row.id, await this.activationSignature(row));
        await this.ctx.get('dshRuntime')?.closeIdle();
        return resolved;
      }
    }
    await (this.loader as any).import(resolved);
    const resolveChildren = (rows) => rows.map(child => ({ ...child, name: this.resolveSpecifier(child.name),
      ...(child.group && Array.isArray(child.config) ? { config: resolveChildren(child.config) } : {}) }));
    const options = {
      ...row,
      id: row.id,
      name: resolved,
      config: row.group && Array.isArray(row.config) ? resolveChildren(row.config) : row.config ?? null,
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
    await this.loader.await();
    const entry = this.loader.resolve(row.id);
    await entry.fiber?.await();
    const awaitChildren = async (rows) => {
      for (const child of rows) {
        await this.loader.resolve(child.id).fiber?.await();
        if (child.group && Array.isArray(child.config)) await awaitChildren(child.config);
      }
    };
    if (row.group && Array.isArray(row.config)) await awaitChildren(row.config);
    if (entry.fiber?.state === FiberState.ACTIVE) this.activeIds.add(row.id);
    else this.activeIds.delete(row.id);
    this.activated.set(row.id, await this.activationSignature(row));
    return resolved;
  }

  async activationSignature(row) {
    const revisions = [];
    const visit = async item => {
      try { const entry = this.resolveSpecifier(item.name); const stat = await fs.stat(new URL(entry));
        revisions.push([item.id, stat.mtimeMs, stat.size]); } catch {}
      if (item.group && Array.isArray(item.config)) for (const child of item.config) await visit(child);
    };
    await visit(row);
    return JSON.stringify([row, revisions]);
  }
  async deactivate(id: string) {
    this.sessionRequired.delete(id);
    await this.ctx.get('dshRuntime')?.stopOwners([id]);
    const remote = this.remote.get(id);
    if (remote) {
      this.remote.delete(id); remote.disposeTools.forEach(dispose => dispose());
      await remote.bridge.dispose();
    }
    try { this.loader.remove(id); } catch {}
    await this.loader.await(); this.activeIds.delete(id); this.activated.delete(id);
  }
  async stopRun(sessionId: string, runId: string) {
    await Promise.all([...this.remote.values()].map(item => item.bridge.stopRun(sessionId, runId)));
  }

  async containsDshPlugin(rows) {
    for (const row of rows) {
      if (row.group && Array.isArray(row.config)) {
        if (await this.containsDshPlugin(row.config)) return true;
      } else if (!row.name.startsWith('cordis:')) {
        try { if (isDshPackage(await readPackageManifest(this.packageDirOf(row.name)))) return true; } catch {}
      }
    }
    return false;
  }

  /** 只从宿主已安装、未停用的条目取插件入口，不接受界面传来的任意路径。 */
  async dshSessionPlugins() {
    const result = [];
    const sessionRow = async row => {
      const name = this.resolveSpecifier(row.name);
      if (!row.group && !row.name.startsWith('cordis:')) {
        const manifest = await readPackageManifest(this.packageDirOf(row.name));
        const issue = evaluatePluginCompatibility(manifest, readProfileVersionExemptions(this.dir), DSH_VERSION);
        if (issue && !issue.exempted) throw new Error(`插件 ${manifest.name}@${manifest.version} 不支持当前 DSH ${DSH_VERSION}`);
      }
      return { ...row, name, ...(row.group && Array.isArray(row.config)
        ? { config: await Promise.all(row.config.map(sessionRow)) } : {}) };
    };
    for (const row of this.rows) {
      if (row.builtin || row.disabled === true || this.failures.has(row.id)) continue;
      if (row.group && Array.isArray(row.config) && await this.containsDshPlugin(row.config)) {
        const options = await sessionRow(row);
        result.push({ id: row.id, entryUrl: options.name, config: options.config, options });
        continue;
      }
      if (row.name.startsWith('cordis:')) continue;
      const manifest = await readPackageManifest(this.packageDirOf(row.name));
      if (isDshPackage(manifest)) {
        const options = await sessionRow(row);
        result.push({ id: row.id, entryUrl: options.name, config: row.config ?? {}, options });
      }
    }
    return result;
  }

  /** 清单写回（宿主独占；loader 根树的 write() 是 no-op） */
  async persist() {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.treeFile(), stringifyTree(this.baseRows), "utf8");
  }

  /** 读取官方 loader 的真实 fiber，待依赖不能显示成已启动。 */
  runtimeState(id: string, disabled = false) {
    if (disabled) return { state: "disabled", active: false, missingServices: [] };
    if (this.remote.has(id)) return { state: "active", active: true, missingServices: [] };
    if (this.failures.has(id)) return { state: "failed", active: false, missingServices: [] };
    if (this.sessionRequired.has(id)) return { state: "session-required", active: false, missingServices: [] };
    try {
      const fiber = this.loader.resolve(id).fiber;
      const state = fiber?.state;
      const missingServices = Object.keys(fiber?.inject || {}).filter(name => !fiber.ctx.get(name));
      return { state: state === FiberState.ACTIVE ? "active" : state === FiberState.FAILED ? "failed"
        : state === FiberState.LOADING ? "loading" : state === FiberState.UNLOADING ? "stopping" : "pending",
        active: state === FiberState.ACTIVE, missingServices };
    } catch { return { state: "failed", active: false, missingServices: [] }; }
  }
  entries() {
    return this.rows.map((row) => {
      let disabled = Boolean(row.disabled);
      try { disabled = this.loader.resolve(row.id).disabled; } catch {}
      const runtime = this.runtimeState(row.id, disabled);
      return {
        id: row.id, name: row.name, description: this.descriptions.get(row.name) || "",
        client: this.clients.get(row.name) || null, builtin: Boolean(row.builtin),
        disabled, config: row.config ?? null, ...runtime,
        error: this.failures.get(row.id) || (runtime.missingServices.length ? `等待必需能力：${runtime.missingServices.join("、")}` : null),
      };
    });
  }

  async add(options) {
    const row = normalizeRow(options);
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
      } else if (this.rows.some((item) => String(item.id) === String(id))) {
        // bundle 提供的条目：写宿主侧覆盖，不改插件包自己的 patch
        this.overrides[id] = { ...(this.overrides[id] || {}), disabled: !enabled };
      } else {
        // 清单里根本没有这个条目：写覆盖只会留下一条**永远打不到目标的补丁**
        // （组装时报 entry not found）。这里如实拒绝，并告诉用户该怎么办。
        return { ok: false, id, error: `插件 ${id} 不在清单里：请先在插件页安装它` };
      }
      try {
        const current = { ...this.rows.find(item => item.id === id), disabled: !enabled };
        if (this.isolatedIds.has(id) || !this.activated.has(id)) await this.activate(current, true);
        else await (this.loader as any).update(id, { disabled: !enabled });
        await this.loader.await();
        if (!this.remote.has(id)) { try { await this.loader.resolve(id).fiber?.await(); } catch {} }
        if (enabled) { this.failures.delete(id); if (this.runtimeState(id).active) this.activeIds.add(id); }
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
        await this.deactivate(id);
        await this.activate({ ...this.rows.find(item => item.id === id), config: config ?? null }, true);
        this.failures.delete(id);
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
        await this.deactivate(id);
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
export async function mountPluginHost(ctx: any, dir: string, options: any = {}) {
  await ensurePluginProfile(dir);
  const baseUrl = new URL(".", pathToFileURL(path.join(dir, TREE_FILE))).href;
  ctx.baseUrl = baseUrl;
  if (ctx.root) ctx.root.baseUrl = baseUrl;
  await ctx.plugin(Loader, { baseUrl });
  ctx.loader.builtins.group = Group;
  ctx.loader.builtins.include = Include;
  const service = new PluginHostService(ctx, { dir, loader: ctx.loader, builtinDir: options?.builtinDir });
  await service.load();
  return service;
}
