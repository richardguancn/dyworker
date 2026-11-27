// 插件分享与导入核心领域模块：
// - 负责本地/创造模式插件的导出预检（存储数据识别 + 敏感凭据/本机路径扫描）
// - 构建与安全解析 .dyplugin 单文件分享包（兼容普通 .zip）
// - 第三方插件提供原来源地址分享信息
// - 导入前强安全校验与受管目录（<userData>/created-plugins）落盘，支持接收方用创造模式二次修改
//
// 纯逻辑模块（不 import electron），便于单元测试直接调用。

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { managedCreatedPluginsRoot, validateLocalPluginDirectory } from "./plugin-authoring.mts";

export const SHARE_PACKAGE_FORMAT = "dyworker-plugin-share";
export const SHARE_PACKAGE_VERSION = 1;
export const SHARE_PACKAGE_EXTENSION = "dyplugin";
export const SHARE_MANIFEST_FILE = "dyworker-share.json";

export const MAX_SHARE_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_SHARE_UNPACKED_BYTES = 150 * 1024 * 1024;
export const MAX_SHARE_ENTRY_COUNT = 2000;
export const MAX_SINGLE_DATA_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SENSITIVE_FINDINGS = 30;
const MAX_SCAN_FILE_BYTES = 2 * 1024 * 1024;

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "__MACOSX"]);
const SKIP_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);
const SOURCE_CODE_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);
const TEXT_SCAN_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx",
  ".json", ".yaml", ".yml", ".md", ".txt", ".env", ".csv", ".ini", ".toml", ".html", ".css",
]);

export interface PluginSensitiveFinding {
  kind: "secret" | "local-path";
  file: string;
  preview: string;
  reason: string;
}

export interface PluginStorageFileItem {
  relativePath: string;
  absolutePath: string;
  size: number;
}

export interface PluginShareManifest {
  format: string;
  version: number;
  exportedAt: string;
  appVersion: string;
  packageName: string;
  displayName: string;
  author?: string;
  icon?: string;
  iconColor?: string;
  pluginVersion: string;
  description: string;
  hasClient: boolean;
  hasThirdPartyDeps: boolean;
  includesData: boolean;
  dataFiles: string[];
  includesConfig?: boolean;
  pluginConfig?: any;
}

export function safeManagedFolderName(pkgName: string): string {
  const raw = String(pkgName || "").trim();
  const normalized = raw
    .replace(/\//g, "__")
    .replace(/[^a-zA-Z0-9._@-]+/g, "-")
    .replace(/^\.+/, "_")
    .replace(/\.+$/, "");
  if (!normalized || normalized === "." || normalized === "..") {
    const hash = createHash("sha1").update(raw || "plugin").digest("hex").slice(0, 8);
    return `shared-plugin-${hash}`;
  }
  return normalized;
}

function safeFileStem(value: string): string {
  const stem = String(value || "")
    .trim()
    .replace(/^@/, "")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return stem || "dyworker-plugin";
}

function defaultExportFileName(pkgName: string, version: string): string {
  const stem = safeFileStem(pkgName);
  const ver = String(version || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
  return ver ? `${stem}-v${ver}.${SHARE_PACKAGE_EXTENSION}` : `${stem}.${SHARE_PACKAGE_EXTENSION}`;
}

function isInsideRoot(rootDir: string, targetPath: string): boolean {
  const rel = path.relative(rootDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function shouldSkipExportName(name: string, isDir: boolean): boolean {
  if (!name) return true;
  if (isDir) return SKIP_DIR_NAMES.has(name);
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (name.endsWith(".log") || name.endsWith(".tmp")) return true;
  return false;
}

async function pathIsDir(candidate: string): Promise<string | null> {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved).catch(() => null);
  return stat?.isDirectory() ? resolved : null;
}

async function readJsonSafe(filePath: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveDisplayName(manifest: any, fallback: string): string {
  const raw = manifest?.dyworker?.displayName
    || manifest?.dyworker?.title
    || manifest?.displayName
    || manifest?.description?.split("：")[0]
    || fallback;
  return String(raw || fallback).trim() || fallback;
}

function extractUrlField(value: any): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.url === "string") return value.url.trim();
  return "";
}

function maskSecretPreview(token: string): string {
  const raw = String(token || "").trim();
  if (raw.length <= 8) return "****";
  return `${raw.slice(0, 6)}****`;
}

function maskLocalPathPreview(value: string): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= 28) return normalized;
  return `${normalized.slice(0, 24)}…`;
}

const SECRET_PATTERNS: Array<{ reason: string; regex: RegExp }> = [
  { reason: "检测到疑似 API 密钥（sk-）", regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { reason: "检测到疑似 GitHub 访问令牌", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { reason: "检测到疑似 AWS Access Key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { reason: "检测到疑似阿里云 AccessKey", regex: /\bLTAI[A-Za-z0-9]{12,}\b/g },
  { reason: "检测到疑似腾讯云 SecretId", regex: /\bAKID[A-Za-z0-9]{16,}\b/g },
  { reason: "检测到私钥文本块", regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { reason: "检测到疑似 Bearer 鉴权令牌", regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
];

const LOCAL_PATH_PATTERNS: Array<{ reason: string; regex: RegExp }> = [
  { reason: "检测到本机 macOS 用户目录绝对路径", regex: /\/Users\/[A-Za-z0-9._-]+\/[^\s"'`)}\]]*/g },
  { reason: "检测到本机 Linux 用户目录绝对路径", regex: /\/home\/[A-Za-z0-9._-]+\/[^\s"'`)}\]]*/g },
  { reason: "检测到本机 Windows 用户目录绝对路径", regex: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\[^\s"'`)}\]]*/g },
];

/** 轻量线性扫描文本中的疑似凭据和本机绝对路径（命中片段全部脱敏） */
export function scanSensitiveFindings(files: Array<{ label: string; content: string }>): PluginSensitiveFinding[] {
  const findings: PluginSensitiveFinding[] = [];
  const seen = new Set<string>();

  for (const item of files) {
    if (findings.length >= MAX_SENSITIVE_FINDINGS) break;
    const text = String(item?.content || "");
    if (!text) continue;

    for (const rule of SECRET_PATTERNS) {
      rule.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(text)) !== null) {
        const preview = maskSecretPreview(match[0]);
        const key = `secret:${item.label}:${rule.reason}:${preview}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            kind: "secret",
            file: item.label,
            preview,
            reason: rule.reason,
          });
          if (findings.length >= MAX_SENSITIVE_FINDINGS) break;
        }
      }
      if (findings.length >= MAX_SENSITIVE_FINDINGS) break;
    }

    for (const rule of LOCAL_PATH_PATTERNS) {
      rule.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(text)) !== null) {
        const preview = maskLocalPathPreview(match[0]);
        const key = `path:${item.label}:${preview}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            kind: "local-path",
            file: item.label,
            preview,
            reason: rule.reason,
          });
          if (findings.length >= MAX_SENSITIVE_FINDINGS) break;
        }
      }
      if (findings.length >= MAX_SENSITIVE_FINDINGS) break;
    }
  }

  return findings;
}

async function collectDirectoryFiles(
  rootDir: string,
  options: { allowLogs?: boolean } = {},
): Promise<Array<{ relativePath: string; absolutePath: string; size: number }>> {
  const isAsarPath = /\.asar(?:[\\/]|$)/i.test(rootDir);
  const resolvedRoot = path.resolve(rootDir);
  const realRoot = (await fs.realpath(resolvedRoot).catch(() => "")) || (isAsarPath ? resolvedRoot : "");
  if (!realRoot) return [];
  const out: Array<{ relativePath: string; absolutePath: string; size: number }> = [];
  const queue: string[] = [resolvedRoot];

  while (queue.length) {
    const current = queue.shift()!;
    const dirents = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      const fullPath = path.join(current, dirent.name);
      const lstat = await fs.lstat(fullPath).catch(() => null);
      if (!lstat || lstat.isSymbolicLink()) continue;
      if (lstat.isDirectory()) {
        if (shouldSkipExportName(dirent.name, true)) continue;
        queue.push(fullPath);
        continue;
      }
      if (!lstat.isFile()) continue;
      if (SKIP_FILE_NAMES.has(dirent.name) || dirent.name.endsWith(".tmp")) continue;
      if (!options.allowLogs && dirent.name.endsWith(".log")) continue;
      const resolvedFile = path.resolve(fullPath);
      const realFile = (await fs.realpath(resolvedFile).catch(() => "")) || (isAsarPath ? resolvedFile : "");
      if (!realFile || !isInsideRoot(realRoot, realFile)) continue;
      const rel = path.relative(resolvedRoot, fullPath).split(path.sep).join("/");
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      out.push({ relativePath: rel, absolutePath: fullPath, size: lstat.size || 0 });
    }
  }

  return out;
}

/** 从插件源代码静态提取 ctx.storage.*("...") 声明的相对路径 */
async function extractStaticStoragePaths(pluginDir: string): Promise<string[]> {
  const files = await collectDirectoryFiles(pluginDir);
  const paths = new Set<string>();
  const pattern = /\bstorage\s*\.\s*(?:readJson|writeJson|readText|writeText|file|exists|remove)\s*\(\s*(['"])([^'"\\]+)\1/g;

  for (const file of files) {
    const ext = path.extname(file.relativePath).toLowerCase();
    if (!SOURCE_CODE_EXTS.has(ext)) continue;
    if (file.size > MAX_SCAN_FILE_BYTES) continue;
    const content = await fs.readFile(file.absolutePath, "utf8").catch(() => "");
    if (!content) continue;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const candidate = String(match[2] || "").trim().replace(/\\/g, "/");
      if (!candidate || candidate.startsWith("/") || candidate.startsWith("~") || /^[A-Za-z]:/.test(candidate)) continue;
      if (candidate.split("/").includes("..")) continue;
      paths.add(candidate.replace(/^\.\//, ""));
    }
  }

  return [...paths];
}

/** 识别与插件关联的 ctx.storage 数据文件，严格隔离在 storageRoot 内 */
export async function discoverPluginStorageFiles(options: {
  pluginDir: string;
  storageRoot: string;
  packageName: string;
  entryId?: string;
}): Promise<PluginStorageFileItem[]> {
  const storageRoot = String(options.storageRoot || "").trim();
  if (!storageRoot) return [];
  const realStorageRoot = await fs.realpath(path.resolve(storageRoot)).catch(() => "");
  if (!realStorageRoot) return [];

  const found = new Map<string, PluginStorageFileItem>();

  const addVerifiedFile = async (absPath: string) => {
    const lstat = await fs.lstat(absPath).catch(() => null);
    if (!lstat || lstat.isSymbolicLink() || !lstat.isFile()) return;
    if (lstat.size > MAX_SINGLE_DATA_FILE_BYTES) return;
    const baseName = path.basename(absPath);
    if (SKIP_FILE_NAMES.has(baseName) || baseName.endsWith(".tmp")) return;
    const realFile = await fs.realpath(absPath).catch(() => "");
    if (!realFile || !isInsideRoot(realStorageRoot, realFile)) return;
    const rel = path.relative(realStorageRoot, realFile).split(path.sep).join("/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
    if (!found.has(rel)) {
      found.set(rel, { relativePath: rel, absolutePath: realFile, size: lstat.size || 0 });
    }
  };

  const addVerifiedDir = async (dirCandidate: string) => {
    const lstat = await fs.lstat(dirCandidate).catch(() => null);
    if (!lstat || lstat.isSymbolicLink() || !lstat.isDirectory()) return;
    const realDir = await fs.realpath(dirCandidate).catch(() => "");
    if (!realDir || !isInsideRoot(realStorageRoot, realDir) || realDir === realStorageRoot) return;
    const items = await collectDirectoryFiles(realDir, { allowLogs: false });
    for (const item of items) {
      if (item.size > MAX_SINGLE_DATA_FILE_BYTES) continue;
      const rel = path.relative(realStorageRoot, item.absolutePath).split(path.sep).join("/");
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      if (!found.has(rel)) {
        found.set(rel, { relativePath: rel, absolutePath: item.absolutePath, size: item.size });
      }
    }
  };

  // 1. 约定子目录：<storageRoot>/<packageName>/、safeManagedFolderName、<entryId>/
  const folderKeys = new Set<string>();
  const rawPkg = String(options.packageName || "").trim();
  const rawEntry = String(options.entryId || "").trim();
  if (rawPkg) {
    folderKeys.add(rawPkg);
    folderKeys.add(safeManagedFolderName(rawPkg));
  }
  if (rawEntry && !rawEntry.includes("..")) {
    folderKeys.add(rawEntry);
    folderKeys.add(safeManagedFolderName(rawEntry));
  }

  for (const key of folderKeys) {
    if (!key || key === "." || key === "..") continue;
    const dirPath = path.resolve(realStorageRoot, key);
    if (isInsideRoot(realStorageRoot, dirPath) && dirPath !== realStorageRoot) {
      await addVerifiedDir(dirPath);
    }
  }

  // 2. 同前缀根文件：<storageRoot>/<stem>.<ext>（如 my-plugin.json）
  const stemCandidates = new Set<string>();
  for (const key of folderKeys) {
    if (!key.includes("/")) stemCandidates.add(key);
  }
  const topEntries = await fs.readdir(realStorageRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of topEntries) {
    if (!entry.isFile()) continue;
    for (const stem of stemCandidates) {
      if (entry.name === stem || entry.name.startsWith(`${stem}.`)) {
        await addVerifiedFile(path.join(realStorageRoot, entry.name));
      }
    }
  }

  // 3. 静态扫描源码内 ctx.storage.*("...") 字面量相对路径
  if (options.pluginDir) {
    const literalPaths = await extractStaticStoragePaths(options.pluginDir);
    for (const rel of literalPaths) {
      const target = path.resolve(realStorageRoot, rel);
      if (!isInsideRoot(realStorageRoot, target) || target === realStorageRoot) continue;
      const stat = await fs.lstat(target).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await addVerifiedDir(target);
      else if (stat.isFile()) await addVerifiedFile(target);
    }
  }

  return [...found.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function buildRemoteShareText(info: {
  displayName: string;
  packageName: string;
  version: string;
  installSpec: string;
  sourceKind: string;
}): string {
  const sourceLabel = info.sourceKind === "github" ? "GitHub 仓库" : "npm 包名";
  return [
    `向你分享一个 DYWorker 插件「${info.displayName}」${info.version ? `（v${info.version}）` : ""}：`,
    `安装方式：打开 DYWorker → 左侧「插件 → 添加插件 → 包名 / GitHub 仓库」，粘贴以下${sourceLabel}安装：`,
    info.installSpec,
  ].join("\n");
}

function findMatchedEntry(ctx: any, target: string) {
  const key = String(target || "").trim();
  const entries = typeof ctx?.plugins?.entries === "function" ? ctx.plugins.entries() : [];
  return entries.find((entry: any) => entry && (entry.id === key || entry.name === key)) || null;
}

function findMatchedBundle(ctx: any, target: string, entryName?: string) {
  const key = String(target || "").trim();
  const bundles = typeof ctx?.plugins?.bundles_ === "function" ? ctx.plugins.bundles_() : [];
  return bundles.find((b: any) => b && (
    b.name === key
    || b.packageName === key
    || (entryName && (b.name === entryName || b.packageName === entryName))
  )) || null;
}

function hasShareablePluginConfig(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return true;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function scanConfigForWarnings(config: any): PluginSensitiveFinding[] {
  if (!hasShareablePluginConfig(config)) return [];
  try {
    return scanSensitiveFindings([{ label: "插件设置配置", content: JSON.stringify(config, null, 2) }]);
  } catch {
    return [];
  }
}

export async function resolveShareablePluginInfo(
  ctx: any,
  options: { target: string; dataDir?: string; storageRoot?: string },
): Promise<any> {
  const target = String(options?.target || "").trim();
  if (!target) return { ok: false, error: "请指定要分享的插件" };

  const dataDir = String(options?.dataDir || (ctx?.plugins?.dir ? path.dirname(ctx.plugins.dir) : "")).trim();
  const managedRoot = dataDir ? managedCreatedPluginsRoot(dataDir) : "";
  const storageRoot = String(
    options?.storageRoot
    || ctx?.get?.("storage")?.root
    || (ctx?.plugins?.dir ? path.join(ctx.plugins.dir, "data") : ""),
  ).trim();

  // 1. 若 target 本身就是存在的本地目录，直接按本地插件处理
  const directDir = (path.isAbsolute(target) || /^[.~]/.test(target) || target.includes(path.sep))
    ? await pathIsDir(target)
    : null;

  const entry = directDir ? null : findMatchedEntry(ctx, target);
  const bundle = directDir
    ? null
    : findMatchedBundle(ctx, target, entry?.name);

  // 如果 directDir 刚好对应某个已安装本地插件，补查 entry/bundle 以获取完整信息
  let resolvedDir = directDir;
  let pkgManifest = resolvedDir ? await readJsonSafe(path.join(resolvedDir, "package.json")) : null;
  const matchedEntry = entry || (pkgManifest?.name ? findMatchedEntry(ctx, String(pkgManifest.name)) : null);
  const matchedBundle = bundle || (pkgManifest?.name ? findMatchedBundle(ctx, String(pkgManifest.name), matchedEntry?.name) : null);

  const pkgNameHint = String(
    pkgManifest?.name
    || matchedBundle?.packageName
    || matchedBundle?.name
    || matchedEntry?.name
    || target,
  ).trim();

  const sourceKind = String(matchedBundle?.source?.kind || "").trim();

  // 2. 第三方来源（npm / github）：返回复制来源地址分享模式
  if (!resolvedDir && !matchedEntry?.builtin && (sourceKind === "npm" || sourceKind === "github")) {
    let installedDir = "";
    try {
      installedDir = ctx?.plugins?.packageDirOf?.(pkgNameHint) || "";
    } catch {
      installedDir = "";
    }
    const installedManifest = installedDir ? await readJsonSafe(path.join(installedDir, "package.json")) : null;
    const packageName = String(installedManifest?.name || pkgNameHint);
    const version = String(matchedBundle?.version || installedManifest?.version || "");
    const description = String(matchedBundle?.description || installedManifest?.description || matchedEntry?.description || "").trim();
    const displayName = resolveDisplayName(installedManifest, matchedEntry?.id || packageName);
    const installSpec = String(
      matchedBundle?.source?.input
      || (sourceKind === "npm" && version ? `${packageName}@${version}` : packageName),
    ).trim();
    return {
      ok: true,
      shareKind: "remote" as const,
      packageName,
      entryId: matchedEntry?.id || packageName,
      displayName,
      version,
      description,
      sourceKind,
      installSpec,
      homepage: extractUrlField(installedManifest?.homepage),
      repository: extractUrlField(installedManifest?.repository),
      shareText: buildRemoteShareText({ displayName, packageName, version, installSpec, sourceKind }),
    };
  }

  // 3. 解析本地源码目录（source.input/path → 受管创建目录 → packageDirOf / builtinPlugins 兜底）
  if (!resolvedDir) {
    const rawLocalSource = sourceKind === "local"
      ? String(
        matchedBundle?.source?.path
        || matchedBundle?.source?.input
        || matchedBundle?.source?.spec
        || matchedBundle?.source?.raw
        || "",
      ).trim()
      : "";
    if (rawLocalSource) {
      resolvedDir = await pathIsDir(rawLocalSource);
    }
  }
  if (!resolvedDir && managedRoot && !matchedEntry?.builtin) {
    const candidates = [
      path.join(managedRoot, target),
      path.join(managedRoot, pkgNameHint),
      path.join(managedRoot, safeManagedFolderName(pkgNameHint)),
    ];
    for (const candidate of candidates) {
      const hit = await pathIsDir(candidate);
      if (hit) {
        resolvedDir = hit;
        break;
      }
    }
    // 兜底按 package.json.name 扫描受管目录
    if (!resolvedDir) {
      const dirents = await fs.readdir(managedRoot, { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents) {
        if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
        const candidate = path.join(managedRoot, dirent.name);
        const manifest = await readJsonSafe(path.join(candidate, "package.json"));
        if (manifest?.name && (manifest.name === pkgNameHint || manifest.name === target)) {
          resolvedDir = candidate;
          break;
        }
      }
    }
  }
  if (!resolvedDir && matchedEntry) {
    try {
      const pkgDir = ctx?.plugins?.packageDirOf?.(matchedEntry.name);
      if (pkgDir) resolvedDir = await pathIsDir(pkgDir);
    } catch {
      resolvedDir = null;
    }
    if (!resolvedDir && matchedEntry.builtin && typeof ctx?.plugins?.builtinPlugins === "function") {
      try {
        const builtinHit = ctx.plugins.builtinPlugins().find((item: any) =>
          item && (item.id === matchedEntry.id || item.name === matchedEntry.name || item.name === pkgNameHint),
        );
        if (builtinHit?.dir) resolvedDir = await pathIsDir(builtinHit.dir);
      } catch {
        resolvedDir = null;
      }
    }
  }

  if (!resolvedDir) {
    if (!matchedEntry?.builtin && (matchedEntry || matchedBundle)) {
      const version = String(matchedBundle?.version || "");
      const installSpec = version ? `${pkgNameHint}@${version}` : pkgNameHint;
      return {
        ok: true,
        shareKind: "remote" as const,
        packageName: pkgNameHint,
        entryId: matchedEntry?.id || pkgNameHint,
        displayName: matchedEntry?.id || pkgNameHint,
        version,
        description: String(matchedBundle?.description || matchedEntry?.description || "").trim(),
        sourceKind: sourceKind || "npm",
        installSpec,
        homepage: "",
        repository: "",
        shareText: buildRemoteShareText({
          displayName: matchedEntry?.id || pkgNameHint,
          packageName: pkgNameHint,
          version,
          installSpec,
          sourceKind: sourceKind || "npm",
        }),
      };
    }
    return { ok: false, error: `找不到要分享的插件：${target}` };
  }

  const isBuiltin = Boolean(matchedEntry?.builtin);
  const validation = await validateLocalPluginDirectory(resolvedDir, { allowBuiltinManifest: isBuiltin });
  if (!validation.ok || !validation.manifest) {
    return { ok: false, error: validation.error || `本地插件目录无效：${resolvedDir}` };
  }

  const manifest = validation.manifest;
  const packageName = String(manifest.name);
  const version = String(manifest.version || "");
  const description = String(manifest.description || "").trim();
  const displayName = resolveDisplayName(manifest, matchedEntry?.id || packageName);
  const entryId = String(matchedEntry?.id || packageName);
  const pluginConfig = matchedEntry?.config ?? null;

  const dataFiles = await discoverPluginStorageFiles({
    pluginDir: resolvedDir,
    storageRoot,
    packageName,
    entryId,
  });

  return {
    ok: true,
    shareKind: "local" as const,
    isBuiltin,
    sourceDir: resolvedDir,
    packageName,
    entryId,
    displayName,
    version,
    description,
    hasClient: Boolean(validation.clientEntries?.length || manifest?.dyworker?.client || manifest?.dsh?.client),
    hasThirdPartyDeps: Boolean(validation.hasThirdPartyDeps),
    defaultFileName: defaultExportFileName(packageName, version),
    dataFiles,
    dataTotalBytes: dataFiles.reduce((sum, item) => sum + item.size, 0),
    pluginConfig,
    storageRoot,
    manifest,
  };
}

async function scanFilesForWarnings(
  items: Array<{ relativePath: string; absolutePath: string; size: number }>,
  prefix = "",
): Promise<PluginSensitiveFinding[]> {
  const texts: Array<{ label: string; content: string }> = [];
  for (const item of items) {
    const ext = path.extname(item.relativePath).toLowerCase();
    if (ext && !TEXT_SCAN_EXTS.has(ext)) continue;
    if (item.size > MAX_SCAN_FILE_BYTES) continue;
    const content = await fs.readFile(item.absolutePath, "utf8").catch(() => "");
    if (!content) continue;
    texts.push({ label: prefix ? `${prefix}${item.relativePath}` : item.relativePath, content });
  }
  return scanSensitiveFindings(texts);
}

export interface PluginCustomizationInput {
  displayName?: string;
  author?: string;
  icon?: string;
  iconColor?: string;
}

/** 按候选 key 顺序从 settings.pluginCustomizations 解析并合并本机自定义外观元数据 */
export function resolvePluginCustomizationFromSettings(
  settings: any,
  keys: Array<string | undefined | null>,
): PluginCustomizationInput | undefined {
  const map = settings?.pluginCustomizations;
  if (!map || typeof map !== "object") return undefined;
  const merged: PluginCustomizationInput = {};
  const seen = new Set<string>();
  for (const rawKey of keys) {
    const key = String(rawKey || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = map[key];
    if (!entry || typeof entry !== "object") continue;
    if (!merged.displayName && typeof entry.displayName === "string" && entry.displayName.trim()) {
      merged.displayName = entry.displayName.trim();
    }
    if (!merged.author && typeof entry.author === "string" && entry.author.trim()) {
      merged.author = entry.author.trim();
    }
    if (!merged.icon && typeof entry.icon === "string" && entry.icon.trim()) {
      merged.icon = entry.icon.trim();
    }
    if (!merged.iconColor && typeof entry.iconColor === "string" && entry.iconColor.trim()) {
      merged.iconColor = entry.iconColor.trim();
    }
  }
  return merged.displayName || merged.author || merged.icon || merged.iconColor ? merged : undefined;
}

function mergeExportVisuals(
  info: { displayName?: string; manifest?: any },
  customization?: PluginCustomizationInput,
) {
  const custom = customization || {};
  const manifestAuthor = typeof info.manifest?.author === "string"
    ? info.manifest.author.trim()
    : String(info.manifest?.author?.name || "").trim();
  return {
    displayName: String(custom.displayName || info.displayName || "").trim() || String(info.displayName || ""),
    author: String(custom.author || manifestAuthor || "").trim(),
    icon: String(custom.icon || info.manifest?.dyworker?.icon || "").trim(),
    iconColor: String(custom.iconColor || info.manifest?.dyworker?.iconColor || "").trim(),
  };
}

/** 导出前预检：返回插件元信息、关联数据文件、以及源码/数据中的敏感信息告警 */
export async function inspectPluginForExport(
  ctx: any,
  options: {
    target: string;
    dataDir?: string;
    storageRoot?: string;
    customization?: PluginCustomizationInput;
  },
) {
  const info = await resolveShareablePluginInfo(ctx, options);
  if (!info?.ok) return info;
  if (info.shareKind === "remote") {
    return info;
  }

  const pluginFiles = await collectDirectoryFiles(info.sourceDir);
  const pluginWarnings = await scanFilesForWarnings(pluginFiles);
  const dataWarnings = await scanFilesForWarnings(info.dataFiles, "data/");
  const hasConfig = hasShareablePluginConfig(info.pluginConfig);
  const configWarnings = hasConfig ? scanConfigForWarnings(info.pluginConfig) : [];
  const visuals = mergeExportVisuals(info, options.customization);

  return {
    ok: true,
    shareKind: "local" as const,
    isBuiltin: Boolean(info.isBuiltin),
    packageName: info.packageName,
    entryId: info.entryId,
    displayName: visuals.displayName,
    ...(visuals.author ? { author: visuals.author } : {}),
    ...(visuals.icon ? { icon: visuals.icon } : {}),
    ...(visuals.iconColor ? { iconColor: visuals.iconColor } : {}),
    version: info.version,
    description: info.description,
    sourceDir: info.sourceDir,
    hasClient: info.hasClient,
    hasThirdPartyDeps: info.hasThirdPartyDeps,
    defaultFileName: info.defaultFileName,
    pluginFileCount: pluginFiles.length,
    dataFiles: info.dataFiles.map((item: PluginStorageFileItem) => ({
      relativePath: item.relativePath,
      size: item.size,
    })),
    dataTotalBytes: info.dataTotalBytes,
    hasConfig,
    pluginWarnings,
    dataWarnings,
    configWarnings,
  };
}

/** 导出本地或内置插件为单文件 .dyplugin 分享包 */
export async function exportPluginSharePackage(
  ctx: any,
  options: {
    target: string;
    outputPath: string;
    includeData?: boolean;
    includeConfig?: boolean;
    dataDir?: string;
    storageRoot?: string;
    appVersion?: string;
    customization?: PluginCustomizationInput;
  },
) {
  const info = await resolveShareablePluginInfo(ctx, options);
  if (!info?.ok) return info;
  if (info.shareKind !== "local") {
    return {
      ok: false,
      shareKind: "remote",
      error: "第三方插件请直接复制包名或 GitHub 地址分享，无需导出本地压缩包",
      installSpec: info.installSpec,
      shareText: info.shareText,
    };
  }

  let outputPath = String(options.outputPath || "").trim();
  if (!outputPath) {
    return { ok: false, error: "导出路径不能为空" };
  }
  outputPath = path.resolve(outputPath);
  if (!/\.(dyplugin|zip)$/i.test(outputPath)) {
    outputPath = `${outputPath}.${SHARE_PACKAGE_EXTENSION}`;
  }

  const pluginFiles = await collectDirectoryFiles(info.sourceDir);
  if (!pluginFiles.length) {
    return { ok: false, error: "插件目录中没有可导出的文件" };
  }

  const visuals = mergeExportVisuals(info, options.customization);
  const finalDisplayName = visuals.displayName;
  const finalAuthor = visuals.author;
  const finalIcon = visuals.icon;
  const finalIconColor = visuals.iconColor;

  const includeData = Boolean(options.includeData);
  const includeConfig = Boolean(options.includeConfig) && hasShareablePluginConfig(info.pluginConfig);
  const dataFiles: PluginStorageFileItem[] = includeData ? info.dataFiles : [];
  const pluginWarnings = await scanFilesForWarnings(pluginFiles);
  const dataWarnings = includeData ? await scanFilesForWarnings(dataFiles, "data/") : [];
  const configWarnings = includeConfig ? scanConfigForWarnings(info.pluginConfig) : [];

  const zip = new AdmZip();
  let totalBytes = 0;

  for (const file of pluginFiles) {
    let buf = await fs.readFile(file.absolutePath);
    if (file.relativePath === "package.json") {
      try {
        const parsedPkg = JSON.parse(buf.toString("utf8"));
        const dy = parsedPkg.dyworker && typeof parsedPkg.dyworker === "object" ? { ...parsedPkg.dyworker } : {};
        const wasBuiltin = Boolean(info.isBuiltin || parsedPkg.dyworker?.builtin || parsedPkg.dsh?.builtin);
        if (wasBuiltin) {
          delete dy.builtin;
          delete dy.defaultEnabled;
          delete dy.defaultEnabledPlatforms;
          if (parsedPkg.dsh && typeof parsedPkg.dsh === "object") {
            const nextDsh = { ...parsedPkg.dsh };
            if (nextDsh.client && !dy.client) {
              dy.client = nextDsh.client;
            }
            delete nextDsh.builtin;
            delete nextDsh.client;
            if (Object.keys(nextDsh).length === 0) {
              delete parsedPkg.dsh;
            } else {
              parsedPkg.dsh = nextDsh;
            }
          }
        }
        if (finalDisplayName) dy.displayName = finalDisplayName;
        if (finalIcon) dy.icon = finalIcon;
        if (finalIconColor) dy.iconColor = finalIconColor;
        // 内置插件导出时保留 dyworker 字段，避免接收方将原本针对本宿主运行的内置插件误判为 DSH 隔离包
        if (wasBuiltin || Object.keys(dy).length) parsedPkg.dyworker = dy;
        if (finalAuthor) parsedPkg.author = finalAuthor;
        buf = Buffer.from(`${JSON.stringify(parsedPkg, null, 2)}\n`, "utf8");
      } catch {}
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_SHARE_UNPACKED_BYTES) {
      return { ok: false, error: "插件源码总体积超过 150 MB 限制，无法导出" };
    }
    zip.addFile(`plugin/${file.relativePath}`, buf);
  }

  for (const file of dataFiles) {
    const buf = await fs.readFile(file.absolutePath);
    totalBytes += buf.length;
    if (totalBytes > MAX_SHARE_UNPACKED_BYTES) {
      return { ok: false, error: "插件与附带数据总体积超过 150 MB 限制，无法导出" };
    }
    zip.addFile(`data/${file.relativePath}`, buf);
  }

  const shareManifest: PluginShareManifest = {
    format: SHARE_PACKAGE_FORMAT,
    version: SHARE_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: String(options.appVersion || ""),
    packageName: info.packageName,
    displayName: finalDisplayName,
    ...(finalAuthor ? { author: finalAuthor } : {}),
    ...(finalIcon ? { icon: finalIcon } : {}),
    ...(finalIconColor ? { iconColor: finalIconColor } : {}),
    pluginVersion: info.version,
    description: info.description,
    hasClient: info.hasClient,
    hasThirdPartyDeps: info.hasThirdPartyDeps,
    includesData: dataFiles.length > 0,
    dataFiles: dataFiles.map((item) => item.relativePath),
    ...(includeConfig ? { includesConfig: true, pluginConfig: info.pluginConfig } : {}),
  };

  zip.addFile(SHARE_MANIFEST_FILE, Buffer.from(`${JSON.stringify(shareManifest, null, 2)}\n`, "utf8"));

  const archiveBuffer = zip.toBuffer();
  if (archiveBuffer.length > MAX_SHARE_ARCHIVE_BYTES) {
    return { ok: false, error: "生成的分享包超过 50 MB 限制，请精简后再导出" };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, archiveBuffer);
  await fs.rename(tempPath, outputPath);

  return {
    ok: true,
    shareKind: "local" as const,
    path: outputPath,
    packageName: info.packageName,
    displayName: finalDisplayName,
    ...(finalAuthor ? { author: finalAuthor } : {}),
    ...(finalIcon ? { icon: finalIcon } : {}),
    ...(finalIconColor ? { iconColor: finalIconColor } : {}),
    version: info.version,
    includesData: dataFiles.length > 0,
    includedDataFiles: dataFiles.map((item) => item.relativePath),
    includesConfig: includeConfig,
    fileCount: pluginFiles.length + dataFiles.length + 1,
    bytes: archiveBuffer.length,
    warnings: [...pluginWarnings, ...dataWarnings, ...configWarnings],
  };
}

interface ParsedArchiveFile {
  relativePath: string;
  data: Buffer;
  mode: number;
}

interface ParsedShareArchive {
  format: "dyplugin" | "zip";
  shareManifest: PluginShareManifest | null;
  pluginFiles: ParsedArchiveFile[];
  dataFiles: ParsedArchiveFile[];
}

function validateSafeArchiveEntryName(rawName: string): string {
  const normalized = String(rawName || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || /^[a-z]:/i.test(normalized)
    || normalized.includes("\0")
    || normalized.includes(":")
    || normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`分享包包含不安全的文件路径：${rawName}`);
  }
  return normalized;
}

function shouldIgnoreZipJunk(normalized: string): boolean {
  const segments = normalized.split("/");
  return segments.includes("__MACOSX") || segments[segments.length - 1] === ".DS_Store";
}

/** 校验压缩包路径安全性并拆分为插件本体与可选数据区（兼容 .dyplugin 与普通 .zip） */
export function readSafeArchiveEntries(buffer: Buffer): ParsedShareArchive {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("分享包内容为空");
  }
  if (buffer.length > MAX_SHARE_ARCHIVE_BYTES) {
    throw new Error("分享包体积超过 50 MB 上限");
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (error: any) {
    throw new Error(`无法解析分享包压缩格式：${error?.message || error}`);
  }

  const entries = zip.getEntries();
  if (entries.length > MAX_SHARE_ENTRY_COUNT) {
    throw new Error(`分享包内文件数量过多（超过 ${MAX_SHARE_ENTRY_COUNT} 个）`);
  }

  let totalUnpacked = 0;
  const seenNames = new Set<string>();
  const fileMap = new Map<string, ParsedArchiveFile>();

  for (const entry of entries) {
    const rawName = String(entry.entryName || "");
    const rawTrimmed = rawName.replace(/\\/g, "/");
    if (!rawTrimmed) continue;
    // 软链接检查（POSIX S_IFLNK = 0o120000 = 0xa000）
    if (((entry.attr >>> 16) & 0xf000) === 0xa000) {
      throw new Error(`安全限制：分享包不允许包含符号链接（${rawName}）`);
    }
    const normalized = validateSafeArchiveEntryName(rawName);
    if (shouldIgnoreZipJunk(normalized)) continue;
    if (seenNames.has(normalized)) {
      throw new Error(`分享包包含重复条目：${normalized}`);
    }
    seenNames.add(normalized);

    totalUnpacked += Number(entry.header?.size || 0);
    if (totalUnpacked > MAX_SHARE_UNPACKED_BYTES) {
      throw new Error("分享包解压后总体积超过 150 MB 上限");
    }

    if (entry.isDirectory) continue;
    const data = entry.getData();
    totalUnpacked = totalUnpacked - Number(entry.header?.size || 0) + data.length;
    if (totalUnpacked > MAX_SHARE_UNPACKED_BYTES) {
      throw new Error("分享包解压后总体积超过 150 MB 上限");
    }
    const mode = ((entry.attr >>> 16) & 0o111) ? 0o755 : 0o644;
    fileMap.set(normalized, { relativePath: normalized, data, mode });
  }

  if (fileMap.size === 0) {
    throw new Error("分享包中没有可安装的文件");
  }

  // 模式 A：标准 .dyplugin（含 dyworker-share.json + plugin/）
  const manifestFile = fileMap.get(SHARE_MANIFEST_FILE);
  if (manifestFile) {
    let parsedManifest: PluginShareManifest;
    try {
      parsedManifest = JSON.parse(manifestFile.data.toString("utf8"));
    } catch {
      throw new Error("分享包内的 dyworker-share.json 格式无效");
    }
    if (parsedManifest?.format !== SHARE_PACKAGE_FORMAT || Number(parsedManifest?.version) !== SHARE_PACKAGE_VERSION) {
      throw new Error("不支持的分享包格式版本");
    }

    const pluginFiles: ParsedArchiveFile[] = [];
    const dataFiles: ParsedArchiveFile[] = [];

    for (const [entryPath, file] of fileMap.entries()) {
      if (entryPath === SHARE_MANIFEST_FILE) continue;
      if (entryPath.startsWith("plugin/")) {
        const rel = entryPath.slice("plugin/".length);
        if (!rel) continue;
        const firstSeg = rel.split("/")[0];
        if (firstSeg === "node_modules" || firstSeg === ".git") continue;
        pluginFiles.push({ ...file, relativePath: rel });
      } else if (entryPath.startsWith("data/")) {
        const rel = entryPath.slice("data/".length);
        if (!rel) continue;
        dataFiles.push({ ...file, relativePath: rel });
      }
    }

    if (!pluginFiles.some((item) => item.relativePath === "package.json")) {
      throw new Error("分享包的 plugin/ 目录缺少 package.json");
    }

    return {
      format: "dyplugin",
      shareManifest: parsedManifest,
      pluginFiles,
      dataFiles,
    };
  }

  // 模式 B：普通 .zip 兼容（根目录直接含 package.json，或唯一顶层文件夹含 package.json）
  let rootPrefix = "";
  if (fileMap.has("package.json")) {
    rootPrefix = "";
  } else {
    const topFolders = new Set([...fileMap.keys()].map((p) => p.split("/")[0]).filter(Boolean));
    if (topFolders.size === 1) {
      const soleTop = [...topFolders][0];
      if (fileMap.has(`${soleTop}/package.json`)) {
        rootPrefix = `${soleTop}/`;
      }
    }
  }

  if (!fileMap.has(`${rootPrefix}package.json`)) {
    throw new Error("压缩包内未找到有效的插件清单 package.json");
  }

  const pluginFiles: ParsedArchiveFile[] = [];
  for (const [entryPath, file] of fileMap.entries()) {
    if (rootPrefix && !entryPath.startsWith(rootPrefix)) continue;
    const rel = rootPrefix ? entryPath.slice(rootPrefix.length) : entryPath;
    if (!rel) continue;
    const firstSeg = rel.split("/")[0];
    if (firstSeg === "node_modules" || firstSeg === ".git") continue;
    pluginFiles.push({ ...file, relativePath: rel });
  }

  return {
    format: "zip",
    shareManifest: null,
    pluginFiles,
    dataFiles: [],
  };
}

async function resolveShareInputBuffer(options: { filePath?: string; buffer?: Buffer; fileName?: string }) {
  if (Buffer.isBuffer(options.buffer)) {
    return {
      buffer: options.buffer,
      fileName: String(options.fileName || "plugin.dyplugin"),
      filePath: options.filePath ? path.resolve(options.filePath) : undefined,
    };
  }
  const filePath = String(options.filePath || "").trim();
  if (!filePath) throw new Error("请提供分享包路径或文件数据");
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== `.${SHARE_PACKAGE_EXTENSION}` && ext !== ".zip") {
    throw new Error("请选择 .dyplugin 或 .zip 格式的插件分享包");
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`找不到分享包文件：${resolved}`);
  }
  if (stat.size > MAX_SHARE_ARCHIVE_BYTES) {
    throw new Error("分享包体积超过 50 MB 上限");
  }
  return {
    buffer: await fs.readFile(resolved),
    fileName: path.basename(resolved),
    filePath: resolved,
  };
}

async function writeArchiveFilesToDir(files: ParsedArchiveFile[], targetDir: string): Promise<void> {
  const realRoot = await fs.realpath(targetDir);
  for (const file of files) {
    const dest = path.resolve(realRoot, file.relativePath);
    if (!isInsideRoot(realRoot, dest) || dest === realRoot) {
      throw new Error(`拒绝写入越界路径：${file.relativePath}`);
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.data, { mode: file.mode });
  }
}

/** 在临时目录解压校验分享包，返回导入前预览及冲突状态 */
export async function inspectSharePackage(options: {
  filePath?: string;
  buffer?: Buffer;
  fileName?: string;
  ctx?: any;
  dataDir?: string;
  storageRoot?: string;
}) {
  const { buffer, fileName, filePath } = await resolveShareInputBuffer(options);
  const parsed = readSafeArchiveEntries(buffer);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-share-inspect-"));
  try {
    await writeArchiveFilesToDir(parsed.pluginFiles, tempDir);
    const validation = await validateLocalPluginDirectory(tempDir);
    if (!validation.ok || !validation.manifest) {
      return {
        ok: false,
        error: validation.error || "分享包内的插件未通过安全或结构校验",
      };
    }

    const manifest = validation.manifest;
    const packageName = String(manifest.name);
    const version = String(manifest.version || "");
    const description = String(manifest.description || parsed.shareManifest?.description || "").trim();
    const displayName = String(
      parsed.shareManifest?.displayName || resolveDisplayName(manifest, packageName),
    ).trim();
    const manifestAuthor = typeof manifest.author === "string"
      ? manifest.author.trim()
      : String(manifest.author?.name || "").trim();
    const author = String(parsed.shareManifest?.author || manifestAuthor || "").trim();
    const icon = String(parsed.shareManifest?.icon || manifest.dyworker?.icon || "").trim();
    const iconColor = String(parsed.shareManifest?.iconColor || manifest.dyworker?.iconColor || "").trim();

    const dataDir = String(options.dataDir || (options.ctx?.plugins?.dir ? path.dirname(options.ctx.plugins.dir) : "")).trim();
    const managedRoot = dataDir ? managedCreatedPluginsRoot(dataDir) : "";
    const managedDir = managedRoot ? path.join(managedRoot, safeManagedFolderName(packageName)) : "";
    const managedDirExists = managedDir ? Boolean(await pathIsDir(managedDir)) : false;

    const existingEntry = findMatchedEntry(options.ctx, packageName);
    const existingBundle = findMatchedBundle(options.ctx, packageName, existingEntry?.name);
    const alreadyBuiltin = Boolean(existingEntry?.builtin);

    const storageRoot = String(
      options.storageRoot
      || options.ctx?.get?.("storage")?.root
      || (options.ctx?.plugins?.dir ? path.join(options.ctx.plugins.dir, "data") : ""),
    ).trim();

    const dataRelatives = parsed.dataFiles.map((item) => item.relativePath);
    const conflictingDataFiles: string[] = [];
    if (storageRoot && dataRelatives.length) {
      await fs.mkdir(storageRoot, { recursive: true }).catch(() => {});
      const realStorageRoot = await fs.realpath(path.resolve(storageRoot)).catch(() => "");
      if (realStorageRoot) {
        for (const rel of dataRelatives) {
          const dest = path.resolve(realStorageRoot, rel);
          if (!isInsideRoot(realStorageRoot, dest) || dest === realStorageRoot) continue;
          const exists = await fs.lstat(dest).catch(() => null);
          if (exists) conflictingDataFiles.push(rel);
        }
      }
    }

    const includesConfig = Boolean(
      parsed.shareManifest?.includesConfig && hasShareablePluginConfig(parsed.shareManifest?.pluginConfig),
    );

    return {
      ok: true,
      format: parsed.format,
      fileName,
      filePath,
      packageName,
      displayName,
      ...(author ? { author } : {}),
      ...(icon ? { icon } : {}),
      ...(iconColor ? { iconColor } : {}),
      version,
      description,
      exportedAt: parsed.shareManifest?.exportedAt || "",
      appVersion: parsed.shareManifest?.appVersion || "",
      hasClient: Boolean(validation.clientEntries?.length || manifest?.dyworker?.client || manifest?.dsh?.client),
      hasThirdPartyDeps: Boolean(validation.hasThirdPartyDeps),
      dependencies: Object.keys(manifest?.dependencies || {}),
      warnings: validation.warnings || [],
      pluginFileCount: parsed.pluginFiles.length,
      includesData: parsed.dataFiles.length > 0,
      includesConfig,
      dataFiles: parsed.dataFiles.map((item) => ({
        relativePath: item.relativePath,
        size: item.data.length,
      })),
      conflictingDataFiles,
      alreadyInstalled: Boolean(existingEntry || existingBundle),
      alreadyBuiltin,
      installedVersion: String(existingBundle?.version || ""),
      managedDirExists,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export type UnpackSharePackageResult =
  | { ok: false; error: string }
  | {
    ok: true;
    pluginDir: string;
    packageName: string;
    displayName: string;
    version: string;
    hasThirdPartyDeps: boolean;
    importedDataFiles: string[];
    skippedDataFiles: string[];
    pluginConfig?: any;
  };

/** 校验后解包到受管目录（<userData>/created-plugins/<folder>）并按需导入附带数据 */
export async function unpackSharePackageToManagedDir(options: {
  filePath?: string;
  buffer?: Buffer;
  fileName?: string;
  dataDir: string;
  storageRoot?: string;
  importData?: boolean;
  overwriteData?: boolean;
  importConfig?: boolean;
}): Promise<UnpackSharePackageResult> {
  const { buffer } = await resolveShareInputBuffer(options);
  const parsed = readSafeArchiveEntries(buffer);

  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-share-unpack-"));
  try {
    await writeArchiveFilesToDir(parsed.pluginFiles, stageDir);
    const validation = await validateLocalPluginDirectory(stageDir);
    if (!validation.ok || !validation.manifest) {
      return {
        ok: false,
        error: validation.error || "分享包内的插件未通过安全或结构校验",
      };
    }

    const manifest = validation.manifest;
    const packageName = String(manifest.name);
    const version = String(manifest.version || "");
    const displayName = String(
      parsed.shareManifest?.displayName || resolveDisplayName(manifest, packageName),
    ).trim();

    const managedRoot = managedCreatedPluginsRoot(options.dataDir);
    await fs.mkdir(managedRoot, { recursive: true });
    const realManagedRoot = await fs.realpath(managedRoot);
    const targetDir = path.resolve(realManagedRoot, safeManagedFolderName(packageName));
    if (!isInsideRoot(realManagedRoot, targetDir) || targetDir === realManagedRoot) {
      return { ok: false, error: `非法的插件包名路径：${packageName}` };
    }

    // 在临时目录中校验通过后，替换落盘到受管目录（保留创造模式可二次编辑能力）
    const nextDir = path.join(realManagedRoot, `.import-${safeManagedFolderName(packageName)}-${process.pid}-${Date.now()}`);
    await fs.mkdir(nextDir, { recursive: true });
    try {
      await writeArchiveFilesToDir(parsed.pluginFiles, nextDir);
      if (parsed.shareManifest) {
        const pkgJsonPath = path.join(nextDir, "package.json");
        try {
          const pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8"));
          if (pkg && typeof pkg === "object") {
            const dy = pkg.dyworker && typeof pkg.dyworker === "object" ? { ...pkg.dyworker } : {};
            let touched = false;
            const shareName = String(parsed.shareManifest.displayName || "").trim();
            const shareAuthor = String(parsed.shareManifest.author || "").trim();
            const shareIcon = String(parsed.shareManifest.icon || "").trim();
            const shareIconColor = String(parsed.shareManifest.iconColor || "").trim();
            if (shareName && !dy.displayName) {
              dy.displayName = shareName;
              touched = true;
            }
            if (shareIcon && !dy.icon) {
              dy.icon = shareIcon;
              touched = true;
            }
            if (shareIconColor && !dy.iconColor) {
              dy.iconColor = shareIconColor;
              touched = true;
            }
            if (shareAuthor && !pkg.author) {
              pkg.author = shareAuthor;
              touched = true;
            }
            if (touched) {
              if (Object.keys(dy).length) pkg.dyworker = dy;
              await fs.writeFile(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
            }
          }
        } catch {}
      }
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.rename(nextDir, targetDir);
    } catch (error) {
      await fs.rm(nextDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    const importedDataFiles: string[] = [];
    const skippedDataFiles: string[] = [];
    const shouldImportData = options.importData !== false;
    const overwriteData = Boolean(options.overwriteData);

    if (shouldImportData && parsed.dataFiles.length > 0 && options.storageRoot) {
      await fs.mkdir(options.storageRoot, { recursive: true });
      const realStorageRoot = await fs.realpath(path.resolve(options.storageRoot));
      for (const dataFile of parsed.dataFiles) {
        const dest = path.resolve(realStorageRoot, dataFile.relativePath);
        if (!isInsideRoot(realStorageRoot, dest) || dest === realStorageRoot) {
          throw new Error(`数据文件路径越界：${dataFile.relativePath}`);
        }
        const existingStat = await fs.lstat(dest).catch(() => null);
        if (existingStat) {
          if (existingStat.isSymbolicLink()) {
            throw new Error(`安全限制：目标数据路径存在符号链接（${dataFile.relativePath}）`);
          }
          if (!overwriteData) {
            skippedDataFiles.push(dataFile.relativePath);
            continue;
          }
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, dataFile.data, { mode: 0o644 });
        importedDataFiles.push(dataFile.relativePath);
      }
    } else if (!shouldImportData && parsed.dataFiles.length > 0) {
      for (const dataFile of parsed.dataFiles) {
        skippedDataFiles.push(dataFile.relativePath);
      }
    }

    const hasSharedConfig = Boolean(
      options.importConfig !== false
      && parsed.shareManifest?.includesConfig
      && hasShareablePluginConfig(parsed.shareManifest?.pluginConfig),
    );

    return {
      ok: true,
      pluginDir: targetDir,
      packageName,
      displayName,
      version,
      hasThirdPartyDeps: Boolean(validation.hasThirdPartyDeps),
      importedDataFiles,
      skippedDataFiles,
      ...(hasSharedConfig ? { pluginConfig: parsed.shareManifest!.pluginConfig } : {}),
    };
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}
