// 创造模式（Plugin Authoring）后端模块：
// - 提供受管创建目录（<userData>/created-plugins）管理与静态安全校验
// - 提供只读探查工具 plugin_inspect 与受控安装/重载/启停/卸载工具 plugin_manage
// - 为本地纯 JS 原生插件提供离线快速拷贝安装路径，避免无网或无第三方依赖时 npm 卡顿
// - 提供推荐卡片（action-card）的后台独立创建与取消执行器

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzePlugin } from "./host/dsh-compat.mts";
import { resolveClientEntries } from "./host/plugin-client.mts";
import { exportPluginSharePackage, inspectPluginForExport } from "./plugin-share.mts";

export const PLUGIN_AUTHORING_TOOL_NAMES = new Set(["plugin_inspect", "plugin_manage"]);

const CARD_ALLOWED_TOOLS = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "make_directory",
  "append_file",
  "copy_file",
  "move_file",
  "delete_file",
  "list_files",
  "find_files",
  "grep",
  "load_skill",
  "load_toolset",
  "plugin_inspect",
  "plugin_manage",
  "update_plan",
  "finish",
]);

const HOST_SHARED_DEPS = new Set(["cordis", "@deepseek-ai/cordis", "zod"]);
const activeCardCreations = new Map<string, AbortController>();

export function managedCreatedPluginsRoot(dataDir: string): string {
  return path.join(path.resolve(String(dataDir || ".")), "created-plugins");
}

export function cardPluginPackageName(cardId: string, title = ""): string {
  const hash = createHash("sha1")
    .update(`${cardId}:${title}`)
    .digest("hex")
    .slice(0, 6);
  const rawSlug = `${cardId}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  const stem = rawSlug && /^[a-z0-9]/.test(rawSlug) ? rawSlug : "plugin";
  return `dyworker-card-${stem}-${hash}`;
}

export function pluginAuthoringToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "plugin_inspect",
        description:
          "只读探查已安装插件或本地插件目录。action 支持 list（列出当前插件及受管创建目录）、detail（查看单个插件详情与安装状态）、check（对本地插件目录执行清单、安全规则、客户端脚本与兼容性校验）。",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "detail", "check"],
              description: "探查动作：list / detail / check",
            },
            target: {
              type: "string",
              description: "插件 id、包名（detail 时必填）或本地插件目录路径（check 时必填）",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "plugin_manage",
        description:
          "对本地插件执行受控管理动作（安装、重载、启用、停用、卸载、导出分享包）并同步刷新客户端 UI。所有变更均需审批权限。",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["install", "reload", "enable", "disable", "uninstall", "export"],
              description: "管理动作：install / reload / enable / disable / uninstall / export",
            },
            target: {
              type: "string",
              description: "install 时传本地插件目录路径；其他动作传插件 id、包名或本地目录路径",
            },
            openSlot: {
              type: ["boolean", "string"],
              description:
                "可选：安装或启用后是否自动在界面打开插件插槽；可传 true，或指定 sidebar.right.pane.tab / workspace.page / conversation.view",
            },
            outputPath: {
              type: "string",
              description: "可选：action=export 时指定导出的 .dyplugin 文件路径；省略时输出到工作区或下载目录",
            },
            includeData: {
              type: "boolean",
              description: "可选：action=export 时是否附带当前插件保存的数据（ctx.storage），默认 false",
            },
          },
          required: ["action", "target"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function isInsideRoot(rootDir: string, targetPath: string): boolean {
  const rel = path.relative(rootDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function assertNoSymlinkEscape(rootDir: string, realRoot: string): Promise<string | null> {
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.shift()!;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(current, entry.name);
      const stat = await fs.lstat(fullPath).catch(() => null);
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        const realTarget = await fs.realpath(fullPath).catch(async () => {
          const linkTarget = await fs.readlink(fullPath).catch(() => "");
          return linkTarget ? path.resolve(path.dirname(fullPath), linkTarget) : "";
        });
        if (!realTarget || !isInsideRoot(realRoot, realTarget)) {
          return `安全限制：检测到指向插件目录之外的符号链接 ${path.relative(rootDir, fullPath)}`;
        }
        continue;
      }
      if (stat.isDirectory()) queue.push(fullPath);
    }
  }
  return null;
}

function resolveMainEntryRelative(manifest: any): string {
  const dot = manifest?.exports?.["."];
  if (typeof dot === "string") return dot;
  if (dot && typeof dot === "object") {
    if (typeof dot.import === "string") return dot.import;
    if (typeof dot.default === "string") return dot.default;
  }
  if (typeof manifest?.main === "string" && manifest.main.trim()) return manifest.main.trim();
  return "index.js";
}

function findUnsupportedClientSyntax(source: string): string | null {
  if (!/__ModuleLoader__\s*\.?\s*load\s*\(|__ModuleLoader__/.test(source)) {
    return "客户端入口必须通过 window.__ModuleLoader__.load({ id, factory(require) { ... } }) 注册模块";
  }
  if (/^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"][^'"]+['"]/m.test(source)
    || /^\s*export\s+(?:default|const|let|var|function|class|type|interface)\b/m.test(source)) {
    return "客户端脚本不能包含未编译的顶层 ESM import/export 语句，请使用 classic script + factory(require)";
  }
  if (/return\s*\(?\s*<[A-Za-z][A-Za-z0-9.]*(?:\s|>)/.test(source)) {
    return "客户端脚本不能包含未编译的 JSX 语法，请改用 React.createElement(...)";
  }
  return null;
}

export interface LocalPluginValidationResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
  dir?: string;
  manifest?: any;
  mainFile?: string;
  clientEntries?: ReturnType<typeof resolveClientEntries>;
  hasThirdPartyDeps?: boolean;
}

/** 对本地插件目录执行静态安全检查与清单、入口完整性校验 */
export async function validateLocalPluginDirectory(dirPath: string): Promise<LocalPluginValidationResult> {
  const raw = String(dirPath || "").trim();
  if (!raw) return { ok: false, error: "插件目录路径不能为空" };
  const resolvedDir = path.resolve(raw);
  const stat = await fs.stat(resolvedDir).catch(() => null);
  if (!stat?.isDirectory()) {
    return { ok: false, error: `插件目录不存在：${resolvedDir}` };
  }
  const realRoot = await fs.realpath(resolvedDir).catch(() => resolvedDir);
  const symlinkError = await assertNoSymlinkEscape(resolvedDir, realRoot);
  if (symlinkError) return { ok: false, error: symlinkError };

  const manifestPath = path.join(resolvedDir, "package.json");
  let manifest: any;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error: any) {
    return { ok: false, error: `读取 package.json 失败：${error?.message || error}` };
  }

  const pkgName = String(manifest?.name || "").trim();
  if (!pkgName || !/^(?:@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i.test(pkgName) || pkgName.includes("..")) {
    return { ok: false, error: `package.json 缺少合法的包名（name）：${pkgName || "（空）"}` };
  }
  const version = String(manifest?.version || "").trim();
  if (!version) {
    return { ok: false, error: "package.json 缺少 version 字段（如 0.1.0）" };
  }
  if (manifest?.dyworker?.builtin || manifest?.dsh?.builtin) {
    return { ok: false, error: "安全限制：不允许声明 dyworker.builtin 或 dsh.builtin" };
  }

  const mainRel = resolveMainEntryRelative(manifest);
  const mainFile = path.resolve(resolvedDir, mainRel);
  if (!isInsideRoot(resolvedDir, mainFile)) {
    return { ok: false, error: `主入口路径越出插件目录：${mainRel}` };
  }
  const mainStat = await fs.stat(mainFile).catch(() => null);
  if (!mainStat?.isFile()) {
    return { ok: false, error: `插件主入口文件不存在：${mainRel}` };
  }

  const warnings: string[] = [];
  if (manifest?.dsh) {
    warnings.push("建议桌面创造插件使用 dyworker.client 字段而非 dsh.client，避免额外运行时依赖检查");
  }

  const hasDeclaredClient = Boolean(manifest?.dyworker?.client || manifest?.dsh?.client);
  const clientEntries = resolveClientEntries(manifest, resolvedDir);
  if (hasDeclaredClient && !clientEntries.length) {
    return {
      ok: false,
      error: "已声明客户端半边（dyworker.client / dsh.client），但 package.json exports 中缺少 \"./client\" 映射",
    };
  }
  for (const entry of clientEntries) {
    const entryStat = await fs.stat(entry.file).catch(() => null);
    if (!entryStat?.isFile()) {
      return { ok: false, error: `客户端入口文件不存在：${entry.relative}` };
    }
    const clientSource = await fs.readFile(entry.file, "utf8").catch(() => "");
    const syntaxIssue = findUnsupportedClientSyntax(clientSource);
    if (syntaxIssue) {
      return { ok: false, error: `${entry.relative}：${syntaxIssue}` };
    }
  }

  const depNames = Object.keys(manifest?.dependencies || {});
  const hasThirdPartyDeps = depNames.some((dep) => !HOST_SHARED_DEPS.has(dep));

  return {
    ok: true,
    warnings,
    dir: resolvedDir,
    manifest,
    mainFile,
    clientEntries,
    hasThirdPartyDeps,
  };
}

function buildLocalCopyInstallRunner(resolvedDir: string, pkgName: string) {
  return async (_command: string, args: string[], options: { cwd?: string } = {}) => {
    const cwd = options?.cwd ? path.resolve(options.cwd) : "";
    if (!cwd) throw new Error("本地拷贝安装缺少暂存 profile 目录");
    const argHit = Array.isArray(args)
      && args.some((item) => item === resolvedDir || path.resolve(String(item || "")) === resolvedDir);
    if (!argHit) {
      return { code: 1, stdout: "", stderr: `离线本地拷贝安装仅支持当前目录 ${resolvedDir}` };
    }

    const profilePkgPath = path.join(cwd, "package.json");
    let profileManifest: any = {};
    try {
      profileManifest = JSON.parse(await fs.readFile(profilePkgPath, "utf8"));
    } catch {
      profileManifest = { name: "dyworker-plugins", private: true };
    }
    profileManifest.dependencies = profileManifest.dependencies && typeof profileManifest.dependencies === "object"
      ? { ...profileManifest.dependencies }
      : {};
    profileManifest.dependencies[pkgName] = `file:${resolvedDir}`;
    await fs.writeFile(profilePkgPath, `${JSON.stringify(profileManifest, null, 2)}\n`, "utf8");

    const destDir = path.join(cwd, "node_modules", ...pkgName.split("/"));
    await fs.rm(destDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destDir), { recursive: true });
    await fs.cp(resolvedDir, destDir, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(resolvedDir, src);
        if (!rel) return true;
        const parts = rel.split(path.sep);
        return !parts.includes("node_modules") && !parts.includes(".git");
      },
    });
    return {
      code: 0,
      stdout: `installed local plugin ${pkgName} from ${resolvedDir}`,
      stderr: "",
    };
  };
}

async function pathExistsDir(candidate: string): Promise<string | null> {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved).catch(() => null);
  return stat?.isDirectory() ? resolved : null;
}

export async function tryBuildOfflineLocalInstallRunner(dirPath: string) {
  const resolvedDir = await pathExistsDir(dirPath);
  if (!resolvedDir) return null;
  const validation = await validateLocalPluginDirectory(resolvedDir);
  if (!validation.ok || !validation.manifest) {
    return { ok: false as const, error: validation.error || "插件目录校验失败" };
  }
  if (validation.hasThirdPartyDeps) {
    return {
      ok: true as const,
      resolvedDir,
      pkgName: String(validation.manifest.name),
      hasThirdPartyDeps: true,
      run: undefined,
    };
  }
  const pkgName = String(validation.manifest.name);
  return {
    ok: true as const,
    resolvedDir,
    pkgName,
    hasThirdPartyDeps: false,
    run: buildLocalCopyInstallRunner(resolvedDir, pkgName),
  };
}

/** 判断创造模式下是否允许免审批自动安装/重载受管目录中的纯本地插件 */
export async function canAutoInstallCreatedPlugin(
  args: any = {},
  options: { creationMode?: boolean; approvalMode?: string; managedRoot?: string } = {},
): Promise<{ ok: boolean; reason?: string; resolvedDir?: string; pkgName?: string }> {
  if (options.creationMode !== true) {
    return { ok: false, reason: "仅在创造模式下允许自动安装" };
  }
  if (options.approvalMode === "deny-changes") {
    return { ok: false, reason: "当前处于只读模式（不允许修改）" };
  }
  const action = String(args?.action || "").trim();
  if (action !== "install" && action !== "reload") {
    return { ok: false, reason: "仅 install 或 reload 动作支持自动安装" };
  }
  const managedRootRaw = String(options.managedRoot || "").trim();
  if (!managedRootRaw) {
    return { ok: false, reason: "缺少受管插件目录" };
  }
  const realRoot = await fs.realpath(path.resolve(managedRootRaw)).catch(() => "");
  if (!realRoot) {
    return { ok: false, reason: "受管插件目录尚不存在" };
  }

  const target = String(args?.target || "").trim();
  if (!target) {
    return { ok: false, reason: "缺少目标插件目录" };
  }
  const resolvedDir = (await resolveTargetDirectory(target, { managedRoot: managedRootRaw }))
    || (action === "reload" ? await pathExistsDir(path.join(managedRootRaw, target)) : null);
  if (!resolvedDir) {
    return { ok: false, reason: "目标不在受管创造目录内或目录不存在" };
  }
  const realTarget = await fs.realpath(resolvedDir).catch(() => "");
  const rel = realTarget ? path.relative(realRoot, realTarget) : "..";
  if (!realTarget || !rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "目标真实路径未严格位于受管创造目录内" };
  }

  const validation = await validateLocalPluginDirectory(resolvedDir);
  if (!validation.ok || !validation.manifest) {
    return { ok: false, reason: validation.error || "静态安全校验未通过" };
  }
  if (validation.hasThirdPartyDeps) {
    return { ok: false, reason: "包含第三方依赖，需人工确认安装" };
  }
  return {
    ok: true,
    resolvedDir,
    pkgName: String(validation.manifest.name),
  };
}

/** 扫描受管目录中已创建的本地插件，供插件页/安装弹窗一键发现并安装 */
export async function listCreatedLocalPlugins(ctx: any, dataDir: string) {
  const managedRoot = managedCreatedPluginsRoot(dataDir);
  const dirents = await fs.readdir(managedRoot, { withFileTypes: true }).catch(() => []);
  const entries = typeof ctx?.plugins?.entries === "function" ? ctx.plugins.entries() : [];
  const candidates: Array<{ mtimeMs: number; record: any }> = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
    const dir = path.join(managedRoot, dirent.name);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat) continue;

    let manifest: any = null;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    } catch {
      manifest = null;
    }
    const validation = await validateLocalPluginDirectory(dir);
    const pkgName = String(manifest?.name || dirent.name);
    const matched = entries.find((item: any) => item && (item.name === pkgName || item.id === pkgName));
    const displayName = String(
      manifest?.dyworker?.displayName
      || manifest?.dyworker?.title
      || manifest?.displayName
      || manifest?.description?.split("：")[0]
      || pkgName,
    ).trim();

    candidates.push({
      mtimeMs: stat.mtimeMs || 0,
      record: {
        dir,
        folderName: dirent.name,
        packageName: pkgName,
        displayName: displayName || pkgName,
        description: String(manifest?.description || "").trim(),
        version: String(manifest?.version || "").trim(),
        installed: Boolean(matched),
        active: Boolean(matched?.active),
        disabled: Boolean(matched?.disabled),
        entryId: matched?.id ? String(matched.id) : undefined,
        hasClient: Boolean(validation.clientEntries?.length || manifest?.dyworker?.client || manifest?.dsh?.client),
        hasThirdPartyDeps: Boolean(validation.hasThirdPartyDeps),
        valid: Boolean(validation.ok),
        error: validation.ok ? undefined : validation.error,
      },
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.map((item) => item.record);
}

async function resolveTargetDirectory(
  target: string,
  { workspacePath = "", managedRoot = "" }: { workspacePath?: string; managedRoot?: string },
): Promise<string | null> {
  const raw = String(target || "").trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) return pathExistsDir(raw);

  const candidates = [
    workspacePath ? path.resolve(workspacePath, raw) : "",
    managedRoot ? path.resolve(managedRoot, raw) : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const hit = await pathExistsDir(candidate);
    if (hit) return hit;
  }
  return null;
}

function findPluginEntry(ctx: any, target: string) {
  const key = String(target || "").trim();
  const entries = typeof ctx?.plugins?.entries === "function" ? ctx.plugins.entries() : [];
  return entries.find((entry: any) => entry && (entry.id === key || entry.name === key)) || null;
}

function findPluginBundle(ctx: any, target: string) {
  const key = String(target || "").trim();
  const bundles = typeof ctx?.plugins?.bundles_ === "function" ? ctx.plugins.bundles_() : [];
  return bundles.find((b: any) => b && (b.name === key || b.packageName === key)) || null;
}

export interface PluginSyncRequest {
  action: "install" | "reload" | "enable" | "disable" | "uninstall";
  pluginId: string;
  pkgName: string;
  openSlot?: boolean | string;
}

export interface PluginAuthoringExecOptions {
  workspacePath?: string;
  managedRoot?: string;
  dataDir?: string;
  storageRoot?: string;
  defaultOpenSlot?: boolean;
  syncClientPlugin?: (req: PluginSyncRequest) => Promise<any>;
  notifyPluginsUpdated?: () => void;
}

export async function executePluginInspect(
  ctx: any,
  args: any = {},
  options: PluginAuthoringExecOptions = {},
): Promise<any> {
  const action = String(args?.action || "").trim();
  const target = String(args?.target || "").trim();
  const plugins = ctx?.plugins;
  if (!plugins) return { ok: false, error: "插件宿主服务未就绪" };

  if (action === "list") {
    const entries = plugins.entries().map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      active: Boolean(entry.active),
      disabled: Boolean(entry.disabled),
      builtin: Boolean(entry.builtin),
      client: entry.client || null,
      error: entry.error || null,
    }));
    const bundles = plugins.bundles_().map((bundle: any) => ({
      name: bundle.name,
      packageName: bundle.packageName,
      version: bundle.version,
      installed: Boolean(bundle.installed),
      source: bundle.source || null,
      error: bundle.error || null,
    }));
    return {
      ok: true,
      managedPluginsRoot: options.managedRoot || "",
      entries,
      bundles,
    };
  }

  if (action === "detail") {
    if (!target) return { ok: false, error: "plugin_inspect(action=detail) 缺少 target" };
    const matched = findPluginEntry(ctx, target);
    const id = matched?.id || target;
    try {
      const detail = await plugins.detail(id);
      return { ok: true, detail };
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  if (action === "check") {
    if (!target) return { ok: false, error: "plugin_inspect(action=check) 缺少 target" };
    const resolvedDir = await resolveTargetDirectory(target, {
      workspacePath: options.workspacePath,
      managedRoot: options.managedRoot,
    });
    if (!resolvedDir) {
      return { ok: false, error: `找不到待检查的本地插件目录：${target}` };
    }
    const validation = await validateLocalPluginDirectory(resolvedDir);
    if (!validation.ok) {
      return { ok: false, error: validation.error, staticValidation: validation };
    }
    const pkgName = String(validation.manifest?.name || "");
    let compatibility: any = null;
    try {
      const profileManifest = path.join(plugins.dir, "package.json");
      compatibility = await analyzePlugin(
        profileManifest,
        pkgName,
        validation.manifest,
        resolvedDir,
        { config: {}, metadataOnly: false },
      );
    } catch (error: any) {
      compatibility = { verdict: "unknown", error: String(error?.message || error) };
    }
    return {
      ok: true,
      dir: resolvedDir,
      packageName: pkgName,
      version: validation.manifest?.version,
      clientEntries: validation.clientEntries?.map((e) => ({ subpath: e.subpath, relative: e.relative, primary: e.primary })) || [],
      warnings: validation.warnings || [],
      compatibility,
    };
  }

  return { ok: false, error: `未知的 plugin_inspect action：${action}` };
}

export async function executePluginManage(
  ctx: any,
  args: any = {},
  options: PluginAuthoringExecOptions = {},
): Promise<any> {
  const action = String(args?.action || "").trim();
  const target = String(args?.target || "").trim();
  const openSlot = args?.openSlot !== undefined
    ? args.openSlot
    : (options.defaultOpenSlot ? true : undefined);
  const plugins = ctx?.plugins;
  if (!plugins) return { ok: false, error: "插件宿主服务未就绪" };
  if (!target) return { ok: false, error: `plugin_manage(action=${action}) 缺少 target` };

  if (action === "install") {
    const resolvedDir = await resolveTargetDirectory(target, {
      workspacePath: options.workspacePath,
      managedRoot: options.managedRoot,
    });
    if (!resolvedDir) {
      return { ok: false, error: `找不到本地插件目录：${target}` };
    }
    const validation = await validateLocalPluginDirectory(resolvedDir);
    if (!validation.ok || !validation.manifest) {
      return { ok: false, error: validation.error || "插件目录校验失败" };
    }
    const pkgName = String(validation.manifest.name);
    const run = validation.hasThirdPartyDeps
      ? undefined
      : buildLocalCopyInstallRunner(resolvedDir, pkgName);

    const installed = await plugins.installPackage({
      input: resolvedDir,
      allowIncompatible: false,
      ...(run ? { run } : {}),
    });
    if (!installed?.ok) {
      return { ok: false, error: installed?.error || "安装插件失败", detail: installed };
    }
    const entry = findPluginEntry(ctx, installed.id || pkgName);
    const pluginId = String(entry?.id || installed.id || pkgName);
    const clientSync = await options.syncClientPlugin?.({
      action: "install",
      pluginId,
      pkgName,
      openSlot,
    }).catch((error: any) => ({ ok: false, error: String(error?.message || error) }));
    options.notifyPluginsUpdated?.();
    return {
      ok: true,
      action: "install",
      pluginId,
      pkgName,
      sourceDir: resolvedDir,
      active: Boolean(entry?.active ?? true),
      error: entry?.error || undefined,
      clientSync: clientSync ?? null,
    };
  }

  if (action === "reload") {
    const matchedEntry = findPluginEntry(ctx, target);
    const pkgNameHint = String(matchedEntry?.name || target);
    const bundle = findPluginBundle(ctx, pkgNameHint) || findPluginBundle(ctx, target);
    const rawLocalSource = bundle?.source?.kind === "local"
      ? String(bundle.source.path || bundle.source.input || bundle.source.spec || bundle.source.raw || "")
      : "";
    const resolvedDir = await resolveTargetDirectory(target, {
      workspacePath: options.workspacePath,
      managedRoot: options.managedRoot,
    }) || (rawLocalSource ? await pathExistsDir(rawLocalSource) : null)
      || (options.managedRoot ? await pathExistsDir(path.join(options.managedRoot, pkgNameHint)) : null);

    let pluginId = String(matchedEntry?.id || target);
    let pkgName = String(matchedEntry?.name || bundle?.packageName || bundle?.name || target);

    if (resolvedDir) {
      const validation = await validateLocalPluginDirectory(resolvedDir);
      if (!validation.ok || !validation.manifest) {
        return { ok: false, error: validation.error || "重载前本地插件校验失败" };
      }
      pkgName = String(validation.manifest.name);
      const run = validation.hasThirdPartyDeps
        ? undefined
        : buildLocalCopyInstallRunner(resolvedDir, pkgName);
      const refreshed = await plugins.installPackage({
        input: resolvedDir,
        allowIncompatible: false,
        ...(run ? { run } : {}),
      });
      if (!refreshed?.ok) {
        return { ok: false, error: refreshed?.error || "重载本地插件失败", detail: refreshed };
      }
      pluginId = String(findPluginEntry(ctx, refreshed.id || pkgName)?.id || refreshed.id || pkgName);
    } else {
      const reloaded = await plugins.reload();
      if (!reloaded?.ok) {
        return { ok: false, error: reloaded?.error || "重载插件宿主失败" };
      }
    }

    const latestEntry = findPluginEntry(ctx, pluginId) || findPluginEntry(ctx, pkgName);
    const clientSync = await options.syncClientPlugin?.({
      action: "reload",
      pluginId: String(latestEntry?.id || pluginId),
      pkgName: String(latestEntry?.name || pkgName),
      openSlot,
    }).catch((error: any) => ({ ok: false, error: String(error?.message || error) }));
    options.notifyPluginsUpdated?.();
    return {
      ok: true,
      action: "reload",
      pluginId: String(latestEntry?.id || pluginId),
      pkgName: String(latestEntry?.name || pkgName),
      sourceDir: resolvedDir || rawLocalSource || undefined,
      active: Boolean(latestEntry?.active),
      error: latestEntry?.error || undefined,
      clientSync: clientSync ?? null,
    };
  }

  if (action === "enable" || action === "disable") {
    const matched = findPluginEntry(ctx, target);
    if (!matched) return { ok: false, error: `找不到已安装插件：${target}` };
    const enabled = action === "enable";
    const result = await plugins.setEnabled(matched.id, enabled);
    if (!result?.ok) return { ok: false, error: result?.error || `${action} 失败` };
    const clientSync = await options.syncClientPlugin?.({
      action,
      pluginId: matched.id,
      pkgName: matched.name || matched.id,
      openSlot: enabled ? openSlot : false,
    }).catch((error: any) => ({ ok: false, error: String(error?.message || error) }));
    options.notifyPluginsUpdated?.();
    return {
      ok: true,
      action,
      pluginId: matched.id,
      pkgName: matched.name,
      disabled: !enabled,
      clientSync: clientSync ?? null,
    };
  }

  if (action === "uninstall") {
    const matched = findPluginEntry(ctx, target);
    const bundle = findPluginBundle(ctx, matched?.name || target);
    const pluginId = String(matched?.id || target);
    const pkgName = String(matched?.name || bundle?.packageName || bundle?.name || target);
    const rawLocalSource = bundle?.source?.kind === "local"
      ? String(bundle.source.path || bundle.source.input || bundle.source.spec || bundle.source.raw || "")
      : "";
    const preservedLocalDir = (rawLocalSource ? await pathExistsDir(rawLocalSource) : null)
      || (options.managedRoot ? await pathExistsDir(path.join(options.managedRoot, pkgName)) : null)
      || "";

    const clientSync = await options.syncClientPlugin?.({
      action: "uninstall",
      pluginId,
      pkgName,
      openSlot: false,
    }).catch((error: any) => ({ ok: false, error: String(error?.message || error) }));

    // Uninstall 仅卸载运行态条目，不删除 managedRoot 或工作区中的源码目录（支持卡片“撤销→恢复”秒级重装）。
    const uninstalled = await plugins.uninstall({ spec: pkgName || target });
    if (!uninstalled?.ok) {
      return { ok: false, error: uninstalled?.error || "卸载插件失败" };
    }
    options.notifyPluginsUpdated?.();
    return {
      ok: true,
      action: "uninstall",
      pluginId,
      pkgName,
      preservedSourceDir: preservedLocalDir || undefined,
      clientSync: clientSync ?? null,
    };
  }

  if (action === "export") {
    const dataDir = String(
      options.dataDir
      || (options.managedRoot ? path.dirname(path.resolve(options.managedRoot)) : "")
      || (plugins?.dir ? path.dirname(plugins.dir) : ""),
    ).trim();
    const storageRoot = String(
      options.storageRoot
      || ctx?.get?.("storage")?.root
      || (plugins?.dir ? path.join(plugins.dir, "data") : ""),
    ).trim();

    const inspection = await inspectPluginForExport(ctx, { target, dataDir, storageRoot });
    if (!inspection?.ok) {
      return { ok: false, error: inspection?.error || `无法导出插件：${target}` };
    }
    if (inspection.shareKind === "remote") {
      return {
        ok: true,
        action: "export",
        shareKind: "remote",
        packageName: inspection.packageName,
        displayName: inspection.displayName,
        version: inspection.version,
        installSpec: inspection.installSpec,
        shareText: inspection.shareText,
      };
    }

    const rawOutputPath = String(args?.outputPath || "").trim();
    let resolvedOutputPath = "";
    if (rawOutputPath) {
      resolvedOutputPath = path.isAbsolute(rawOutputPath)
        ? path.resolve(rawOutputPath)
        : path.resolve(options.workspacePath || os.homedir(), rawOutputPath);
    } else if (options.workspacePath) {
      resolvedOutputPath = path.join(path.resolve(options.workspacePath), inspection.defaultFileName);
    } else {
      resolvedOutputPath = path.join(os.homedir(), "Downloads", inspection.defaultFileName);
    }

    const exported = await exportPluginSharePackage(ctx, {
      target,
      outputPath: resolvedOutputPath,
      includeData: Boolean(args?.includeData),
      dataDir,
      storageRoot,
    });
    if (!exported?.ok) {
      return { ok: false, error: exported?.error || "导出插件分享包失败" };
    }
    return {
      ok: true,
      action: "export",
      shareKind: "local",
      path: exported.path,
      packageName: exported.packageName,
      displayName: exported.displayName,
      version: exported.version,
      includesData: exported.includesData,
      includedDataFiles: exported.includedDataFiles,
      bytes: exported.bytes,
      warnings: exported.warnings,
    };
  }

  return { ok: false, error: `未知的 plugin_manage action：${action}` };
}

function slotDescriptionForPrompt(chosenSlot: string, customPlacement = ""): string {
  if (chosenSlot === "sidebar.right.pane.tab") {
    return "目标挂载位置：`sidebar.right.pane.tab`（右侧工具面板标签页）。适合随当前会话对照展示的视图或工具板。";
  }
  if (chosenSlot === "workspace.page") {
    return "目标挂载位置：`workspace.page`（左侧边栏独立应用页面）。适合完整工作区看板、列表、图表或专属工作台。";
  }
  if (chosenSlot === "conversation.view") {
    return "目标挂载位置：`conversation.view`（会话区顶栏切换视图）。适合将当前对话信息以结构化视图方式浏览。";
  }
  return `目标挂载位置：用户自定义（${customPlacement || chosenSlot}），请综合选择最贴合的一个主插槽（优先 \`workspace.page\` 或 \`sidebar.right.pane.tab\`）并满足用户自定义位置需求。`;
}

export interface CardCreationDeps {
  ctx: any;
  dataDir: string;
  getSettings?: () => any;
  renderer?: any;
  syncClientPlugin?: (req: PluginSyncRequest) => Promise<any>;
  notifyPluginsUpdated?: () => void;
}

export async function startCardPluginCreation(deps: CardCreationDeps, payload: any = {}): Promise<any> {
  const sessionId = String(payload?.sessionId || "").trim();
  const cardId = String(payload?.cardId || "").trim();
  const title = String(payload?.title || "").trim();
  const summary = String(payload?.summary || "").trim();
  const prompt = String(payload?.prompt || "").trim();
  const chosenSlot = String(payload?.chosenSlot || "workspace.page").trim();
  const customPlacement = String(payload?.customPlacement || "").trim();
  const approvalMode = String(payload?.approvalMode || "").trim();

  if (!sessionId || !cardId) {
    return { ok: false, error: "缺少会话或卡片标识（sessionId / cardId）" };
  }
  if (approvalMode === "deny-changes") {
    return { ok: false, error: "当前处于只读模式（不允许修改），无法创建和安装插件" };
  }
  const settings = payload?.settings || (await deps.getSettings?.());
  if (!settings?.model || !settings?.endpoint) {
    return { ok: false, error: "当前未配置可用模型与端点，请先在设置中完成模型配置" };
  }

  const managedRoot = managedCreatedPluginsRoot(deps.dataDir);
  const pkgName = cardPluginPackageName(cardId, title);
  const pluginDir = path.join(managedRoot, pkgName);
  await fs.mkdir(pluginDir, { recursive: true });

  const jobKey = `${sessionId}:${cardId}`;
  const prevController = activeCardCreations.get(jobKey);
  if (prevController) {
    prevController.abort(new Error("已被新的创建任务替换"));
    activeCardCreations.delete(jobKey);
  }
  const controller = new AbortController();
  activeCardCreations.set(jobKey, controller);

  const recentList = Array.isArray(payload?.recentMessages) ? payload.recentMessages.slice(-4) : [];
  const contextLines = recentList
    .map((m: any) => `- [${m?.role || "message"}] ${String(m?.content || "").slice(0, 500)}`)
    .join("\n");

  const creationPrompt = [
    `请在当前受管插件目录 \`${pluginDir}\` 中创建并安装一个原生 DYWorker 插件（包名严格使用 \`${pkgName}\`）。`,
    `卡片标题：${title || "个性化功能页"}`,
    summary ? `推荐说明：${summary}` : "",
    prompt ? `详细构建要求：${prompt}` : "",
    slotDescriptionForPrompt(chosenSlot, customPlacement),
    payload?.workspacePath ? `参考对话工作区（只读背景参考，插件文件请全部写在 ${pluginDir}）：${payload.workspacePath}` : "",
    contextLines ? `近期对话摘要：\n${contextLines}` : "",
    "",
    "硬性开发与校验要求：",
    "1. 请先用 `load_skill` 读取 `builtin-plugin-creator` 技能获取精确规范与代码模板；",
    "2. 将插件源码写入当前目录，包含 `package.json`（原生 `dyworker.client` + `exports`）、宿主入口 `index.js`（如需数据存储用 `connection` + `storage`）与客户端入口 `client.js`（classic script + `window.__ModuleLoader__.load` + `React.createElement`）；",
    "3. 写完后先调用 `plugin_inspect(action=\"check\", target=\"" + pluginDir + "\")` 检查，确认无报错；",
    `4. 调用 \`plugin_manage(action="install", target="${pluginDir}", openSlot=${JSON.stringify(["sidebar.right.pane.tab", "workspace.page", "conversation.view"].includes(chosenSlot) ? chosenSlot : true)})\` 完成安装和热挂载；`,
    "5. 严禁修改插件目录之外的系统文件，不要运行 shell 命令。",
  ].filter(Boolean).join("\n");

  const normalizedPluginDir = path.resolve(pluginDir);

  const extraBeforeToolExecute = async ({ name, args }: { name: string; args?: any }) => {
    const toolName = String(name || "");
    if (!CARD_ALLOWED_TOOLS.has(toolName)) {
      return { action: "block", message: `卡片后台创建仅允许使用目录文件、技能与插件工具，已拦截 ${toolName}` };
    }
    if (toolName === "plugin_manage") {
      const manageTarget = String(args?.target || "").trim();
      const targetAsPath = path.isAbsolute(manageTarget)
        ? path.resolve(manageTarget)
        : path.resolve(pluginDir, manageTarget);
      const pointsToThisPlugin = targetAsPath === normalizedPluginDir
        || manageTarget === pkgName
        || manageTarget === path.basename(normalizedPluginDir);
      if (!pointsToThisPlugin) {
        return { action: "block", message: `卡片创建任务只能管理当前新插件（${pkgName}）` };
      }
    }
    return null;
  };

  try {
    const bgSessionId = `card-create:${jobKey}`;
    const result = await deps.ctx.agent.run({
      settings,
      runtime: "dyworker",
      workspacePath: pluginDir,
      sessionId: bgSessionId,
      approvalMode: "full-access",
      creationMode: true,
      managedPluginsRoot: managedRoot,
      trustedWriteRoots: [managedRoot],
      extraBeforeToolExecute,
      prompt: creationPrompt,
      conversation: [{ role: "user", content: creationPrompt }],
      routerOptions: {
        signal: controller.signal,
        renderer: deps.renderer,
        sessionId: bgSessionId,
        runId: cardId,
      },
      requestApproval: async () => false,
      isCancelled: () => controller.signal.aborted,
      signal: controller.signal,
    });

    if (controller.signal.aborted || result?.status === "cancelled") {
      return { ok: false, cancelled: true, error: "已取消插件创建", pluginId: pkgName, pluginDir };
    }

    // 兜底检查：若模型完成了源码编写但忘记调用 install，自动校验并执行一次安装
    let entry = findPluginEntry(deps.ctx, pkgName);
    if (!entry) {
      const validation = await validateLocalPluginDirectory(pluginDir);
      if (!validation.ok) {
        return {
          ok: false,
          error: validation.error || result?.finalText || "插件构建未通过校验",
          pluginId: pkgName,
          pluginDir,
        };
      }
      const installed = await executePluginManage(
        deps.ctx,
        {
          action: "install",
          target: pluginDir,
          openSlot: ["sidebar.right.pane.tab", "workspace.page", "conversation.view"].includes(chosenSlot)
            ? chosenSlot
            : true,
        },
        {
          workspacePath: pluginDir,
          managedRoot,
          syncClientPlugin: deps.syncClientPlugin,
          notifyPluginsUpdated: deps.notifyPluginsUpdated,
        },
      );
      if (!installed?.ok) {
        return {
          ok: false,
          error: installed?.error || "安装生成的插件失败",
          pluginId: pkgName,
          pluginDir,
        };
      }
      entry = findPluginEntry(deps.ctx, pkgName);
    } else if (deps.syncClientPlugin) {
      await deps.syncClientPlugin({
        action: "install",
        pluginId: String(entry.id || pkgName),
        pkgName,
        openSlot: ["sidebar.right.pane.tab", "workspace.page", "conversation.view"].includes(chosenSlot)
          ? chosenSlot
          : true,
      }).catch(() => null);
      deps.notifyPluginsUpdated?.();
    }

    const slot = ["sidebar.right.pane.tab", "workspace.page", "conversation.view"].includes(chosenSlot)
      ? chosenSlot
      : "workspace.page";
    return {
      ok: true,
      pluginId: String(entry?.id || pkgName),
      pkgName,
      pluginDir,
      slot,
      message: result?.finalText || "",
    };
  } catch (error: any) {
    if (controller.signal.aborted) {
      return { ok: false, cancelled: true, error: "已取消插件创建", pluginId: pkgName, pluginDir };
    }
    return { ok: false, error: String(error?.message || error), pluginId: pkgName, pluginDir };
  } finally {
    if (activeCardCreations.get(jobKey) === controller) {
      activeCardCreations.delete(jobKey);
    }
  }
}

export function cancelCardPluginCreation(payload: any = {}): { ok: boolean; cancelled: boolean } {
  const sessionId = String(payload?.sessionId || "").trim();
  const cardId = String(payload?.cardId || "").trim();
  const jobKey = `${sessionId}:${cardId}`;
  const controller = activeCardCreations.get(jobKey);
  if (!controller) return { ok: true, cancelled: false };
  controller.abort(new Error("用户取消了推荐插件创建"));
  activeCardCreations.delete(jobKey);
  return { ok: true, cancelled: true };
}
