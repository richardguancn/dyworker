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
import { orderClientModules, readStaticRequires, resolveClientEntries, resolveModuleEntries, splitModuleSpec } from "./plugin-client.mts";
import { clearPluginRoutes } from "./services/connection.mts";
import { detectInstalledPackageName, dshClientModuleNames, dshPeerNames, hostCordisDir, installPackageIntoProfile, linkHostCordis, newestVersion, parsePluginSource, readProfileDependencies } from "./plugin-install.mts";
import { Service } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

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
  for (const target of [spec, `${spec}/package.json`]) {
    try {
      createRequire(base).resolve(target);
      return true;
    } catch {
      // 换下一个形式
    }
  }
  return false;
}

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
  // 内置标记要透传：界面据此显示「内置」，停用/启用也走同一条路径
  if (row?.builtin) out.builtin = true;
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
    try {
      return resolvePackageDir(this.profileManifest(), spec);
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

  constructor(ctx, config = {} as any) {
    super(ctx, "plugins");
    this.dir = config.dir;
    this.loader = config.loader;
    this.builtinDir = config.builtinDir || "";
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
      return new URL(spec, pathToFileURL(this.treeFile())).href;
    }
    const profileRequire = createRequire(this.profileManifest());
    try {
      return pathToFileURL(profileRequire.resolve(spec)).href;
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
    const installArgs = {
      dir: this.dir,
      input: rawInput,
      version,
      source,
      customRegistry,
      npmPath: npmPath || process.env.DYWORKER_NPM || null,
      ignoreScripts,
      run,
    };
    let downloaded: any = await installPackageIntoProfile(installArgs);
    // DSH 生态自己发布的包之间 peer 版本线互斥（-rc / -alpha 混用），
    // 直接装必然 ERESOLVE 失败——实测用户装 dsh-context 就卡在这里。
    // 先按常规装一次，失败且是 peer 冲突时再用 --legacy-peer-deps 重试（并如实标注）。
    let legacyPeerDeps = false;
    if (!downloaded.ok && /ERESOLVE|peer dep|Conflicting peer/i.test(String(downloaded.error || ""))) {
      const retry: any = await installPackageIntoProfile({ ...installArgs, legacyPeerDeps: true });
      if (retry.ok) {
        legacyPeerDeps = true;
        downloaded = { ...retry, note: "peer 依赖版本线冲突，已用 --legacy-peer-deps 重试成功" };
      } else {
        downloaded = retry;
      }
    }
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

    // **先补运行时依赖（含 cordis 软链），再激活**。
    // 顺序反了会死锁：激活需要 cordis，而补依赖挂在 "激活成功" 之后——激活失败就永远不补。
    // 实测用户装 dsh-context 就是这样：npm 把 cordis 软链抹掉 → 激活报 Cannot find package
    // → 补依赖不执行 → UI 上只说"安装失败"且没有原因。
    await this.ensureRuntimePeers(packageName, npmPath || process.env.DYWORKER_NPM || null);
    let installed: any = await this.install({ spec: packageName, allowIncompatible });
    // 自愈：profile 里可能是**旧的/残缺的**依赖树（早前失败的安装留下的老版本，
    // 传递依赖缺失）。ensureRuntimePeers 见它能解析就跳过，于是残缺版本一直留着，
    // 激活报 "Cannot find package X"。这里按报错缺什么补什么，再重试激活（最多 3 轮）。
    for (let attempt = 0; attempt < 4 && !installed.ok; attempt += 1) {
      const missing = /Cannot find package '([^']+)'/.exec(String(installed.error || ""))?.[1];
      // 报错里的"包"可能是绝对路径（profile/node_modules 下的残缺包解析失败时会这样），
      // 这时从中还原包名，重装到**最新版**再重试——用户 profile 里是旧的 0.0.1-rc.1 残缺树。
      const repairTarget = missing ? packageNameFromMissing(missing, this.dir) : "";
      if (!repairTarget) break;
      const repairVersion = await newestVersion(repairTarget, { npmPath: npmPath || process.env.DYWORKER_NPM || null });
      const repaired: any = await installPackageIntoProfile({
        dir: this.dir,
        input: repairTarget,
        version: repairVersion || undefined,
        source,
        customRegistry,
        npmPath: npmPath || process.env.DYWORKER_NPM || null,
        ignoreScripts,
        legacyPeerDeps: true,
        run,
      });
      if (!repaired.ok) break;
      await this.ensureRuntimePeers(packageName, npmPath || process.env.DYWORKER_NPM || null);
      installed = await this.install({ spec: packageName, allowIncompatible });
    }
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
      ...(legacyPeerDeps ? { legacyPeerDeps: true } : {}),
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
          url: `dyworker-plugin://module/${encodeURIComponent(node.spec)}/0`,
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
          url: `dyworker-plugin://client/${encodeURIComponent(row.id)}/${index}`,
        })),
      };
    } catch (error: any) {
      return { ok: false, id: String(target || ""), error: String(error?.message || error) };
    }
  }

  /**
   * 补齐 DSH 插件的 peer 运行时依赖，并让插件共享宿主同一份 cordis。
   * 不补的话插件主机半边根本 import 不进来（缺 dsh-session 等），也就永远不会 apply。
   */
  async ensureRuntimePeers(packageName, npmPath = null) {
    const installed = [];
    try {
      const dir = this.packageDirOf(packageName);
      const manifest = await readPackageManifest(dir);
      // peer 依赖 + 客户端模块：两者都是运行时必需（后者由 dsh.client.inject 声明）
      const needed = [...dshPeerNames(manifest), ...dshClientModuleNames(manifest)];
      for (const peer of needed) {
        // 判断"是否已就绪"必须**从插件自己的位置解析**：
        // 我们的 resolveClientModule 会搜 DSH 共享目录等额外根，因此会出现
        // "我们找得到、插件 import 不到"的错判——插件启动时报 Cannot find package。
        // 这里用 createRequire 从插件包目录解析，与它自己的 import 语义一致。
        if (resolvableFrom(dir, peer)) continue;
        const version = await newestVersion(peer, { npmPath });
        const result = await installPackageIntoProfile({
          dir: this.dir,
          input: peer,
          version: version || undefined,
          source: "default",
          ignoreScripts: true,
          // DSH 运行时包的 peer 版本线互斥，必须放宽（见 plugin-install 注释）
          legacyPeerDeps: true,
          npmPath,
        });
        if (result.ok) installed.push(`${peer}@${version || "latest"}`);
        // 失败要留痕：静默跳过会变成"插件界面莫名其妙不出现"，排查时毫无线索
        else console.warn(`[plugins] 运行时依赖 ${peer} 补装失败：${String(result.error || "").slice(0, 160)}`);
      }
      await linkHostCordis(this.dir, hostCordisDir());
    } catch {
      // 补依赖失败不该让安装整体失败：如实返回已补上的部分
    }
    return installed;
  }

  /**
   * 客户端模块（dsh.client.inject 里那些包）的解析目录。
   * 优先插件自己的 node_modules；找不到时退到本机 DSH 的共享目录——
   * 这些包本身是 DSH 的客户端运行时，用户机器上通常随 DSH 一起存在。
   * （正式分发时应把它们作为依赖装进插件目录，这里的兜底只是为了能用。）
   */
  clientModuleRoots() {
    const roots = [path.join(this.dir, "node_modules")];
    const dshRoot = path.join(os.homedir(), ".dsh", "profiles");
    roots.push(path.join(dshRoot, "node_modules"));
    for (const name of ["desktop", "web"]) roots.push(path.join(dshRoot, name, "node_modules"));
    return roots;
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
    const declared = Array.isArray(client.inject) ? client.inject.map(String) : [];
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
      // 内置插件（随应用分发）：界面据此显示「内置」标记，停用走同一条 override 路径
      builtin: Boolean(row.builtin),
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
      } else if (this.rows.some((item) => String(item.id) === String(id))) {
        // bundle 提供的条目：写宿主侧覆盖，不改插件包自己的 patch
        this.overrides[id] = { ...(this.overrides[id] || {}), disabled: !enabled };
      } else {
        // 清单里根本没有这个条目：写覆盖只会留下一条**永远打不到目标的补丁**
        // （组装时报 entry not found）。这里如实拒绝，并告诉用户该怎么办。
        return { ok: false, id, error: `插件 ${id} 不在清单里：请先在插件页安装它` };
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
export async function mountPluginHost(ctx: any, dir: string, options: any = {}) {
  await ensurePluginProfile(dir);
  const baseUrl = new URL(".", pathToFileURL(path.join(dir, TREE_FILE))).href;
  ctx.baseUrl = baseUrl;
  if (ctx.root) ctx.root.baseUrl = baseUrl;
  await ctx.plugin(Loader, { baseUrl });
  const service = new PluginHostService(ctx, { dir, loader: ctx.loader, builtinDir: options?.builtinDir });
  await service.load();
  return service;
}
