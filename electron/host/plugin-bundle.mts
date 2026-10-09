// 插件包（bundle）层：读取一个 npm 插件包声明的 bundle patch，并按 dsh 的
// patch 语义把它的条目合成进插件树。
//
// 兼容点（这是"能装 dsh 插件包"的关键）：
//   - DSH 插件包在 package.json 里用 `dsh.bundle.patch` 指向一个 YAML，
//     内容是 loader 的 patch 行（通常就是 `- insert: [{ id, name }]`）；
//     我们用同名字段解析，并额外接受 `dyworker.bundle.patch` 作为自有命名空间。
//   - patch 行的语义**直接复用上游实现**（applyEntryPatches，它同时被 dsh 的
//     挂载路径与 `dsh --dump-config` 使用），所以 insert / disable / config 覆盖、
//     id 定位、name 校验、未命中告警的行为与 dsh 完全一致。
//
// 本文件为纯逻辑：只读文件、算数据，不碰 ctx，也不 import electron。
import { readFileSync, realpathSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyEntryPatches } from "@deepseek-ai/cordis-plugin-include";
import * as yaml from "js-yaml";

// bundle 声明字段：先看自有命名空间，再看 dsh 的（dsh 包无需任何改动）
const BUNDLE_FIELDS = ["dyworker", "dsh"];

export class BundleError extends Error {}

/** 从入口文件向上找到包根（用 package.json 的 name 确认，避免落到上一级） */
function findPackageRoot(entry, spec) {
  let dir = path.dirname(entry);
  while (true) {
    const candidate = path.join(dir, "package.json");
    try {
      if (statSync(candidate).isFile()) {
        const manifest = JSON.parse(readFileSync(candidate, "utf8"));
        if (manifest.name === spec) return dir;
      }
    } catch {
      // 读不到就继续向上
    }
    const parent = path.dirname(dir);
    if (parent === dir || path.basename(dir) === "node_modules") return null;
    dir = parent;
  }
}

/** 解析 profile 里的包名 → 包目录（用 profile 自己的解析上下文） */
export function resolvePackageDir(profileManifest, spec) {
  // 残缺安装也要能读到清单，否则会把“已安装但缺入口”误报成“未安装”。
  if (/^(?:@[\w.-]+\/)?[\w.-]+$/.test(spec)) {
    const direct = path.join(path.dirname(profileManifest), "node_modules", spec);
    try {
      if (JSON.parse(readFileSync(path.join(direct, "package.json"), "utf8")).name === spec) return realpathSync(direct);
    } catch { /* 再按模块解析规则查找 */ }
  }
  const profileRequire = createRequire(profileManifest);
  const entries = [];
  try {
    entries.push(profileRequire.resolve(`${spec}/package.json`));
  } catch {
    // 包的 exports 可能不允许直接取 package.json
  }
  try {
    entries.push(profileRequire.resolve(spec));
  } catch {
    // 主入口也解析不到
  }
  for (const entry of entries) {
    const root = findPackageRoot(entry, spec);
    if (root) return root;
  }
  throw new BundleError(`插件包未安装到 profile：在 ${path.dirname(profileManifest)}/node_modules 下找不到 ${spec}`);
}

/** 读包清单 */
export async function readPackageManifest(pkgDir) {
  const file = path.join(pkgDir, "package.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error: any) {
    throw new BundleError(`读不到插件包清单 ${file}：${error?.message || error}`);
  }
}

/**
 * 取包声明的 bundle patch。
 * @returns { patchFile, patches }；包内没有声明时返回 patches: null（调用方走默认单条目）
 */
export async function readBundlePatch(pkgDir, manifest) {
  let declared = null;
  let namespace = null;
  for (const field of BUNDLE_FIELDS) {
    const value = manifest?.[field]?.bundle?.patch;
    if (typeof value === "string" && value.trim()) {
      declared = value.trim();
      namespace = field;
      break;
    }
  }
  if (!declared) return { patchFile: null, namespace: null, patches: null };

  const patchFile = path.resolve(pkgDir, declared);
  let text;
  try {
    text = await fs.readFile(patchFile, "utf8");
  } catch (error: any) {
    throw new BundleError(`插件包 ${manifest.name} 声明的 patch 文件读不到：${patchFile}（${error?.message || error}）`);
  }
  let patches;
  try {
    patches = yaml.load(text) ?? [];
  } catch (error: any) {
    throw new BundleError(`插件包 ${manifest.name} 的 patch 不是合法 YAML：${error?.message || error}`);
  }
  if (!Array.isArray(patches)) {
    throw new BundleError(`插件包 ${manifest.name} 的 patch 顶层必须是数组`);
  }
  return { patchFile, namespace, patches };
}

/**
 * 按 dsh 语义把 bundle patch 依次叠加到基础条目上。
 * @param baseRows 基础条目（用户层）
 * @param bundlePatches 已按安装顺序排好的 patch 列表数组
 * @param warn 未命中 patch 的告警收集器
 */
export function composeRows(baseRows, bundlePatches, warn: any = () => {}) {
  let rows = [...(baseRows || [])];
  for (const patches of bundlePatches) {
    if (!patches?.length) continue;
    rows = applyEntryPatches(rows, patches, warn);
  }
  return rows;
}

/** 包名（spec）→ 默认条目 id：取最后一段并去掉 scope */
export function defaultEntryId(spec) {
  const tail = String(spec).split("/").pop() || String(spec);
  return tail.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * 组装一个插件包的安装记录：解析包 → 读 patch → 给出条目与元信息。
 * 包没有声明 patch 时，退化成"单条目"（该包主入口本身就是一个 cordis 插件）。
 */
export async function describeBundle(profileManifest, spec, { id }: any = {}) {
  const pkgDir = resolvePackageDir(profileManifest, spec);
  const manifest = await readPackageManifest(pkgDir);
  const { patchFile, namespace, patches } = await readBundlePatch(pkgDir, manifest);
  const entryId = id || defaultEntryId(spec);
  return {
    name: spec,
    packageName: manifest.name || spec,
    version: manifest.version || "",
    description: String(manifest.description || ""),
    dir: pkgDir,
    entryUrl: pathToFileURL(pkgDir).href,
    patchFile,
    namespace,
    patches: patches ?? [{ insert: [{ id: entryId, name: spec }] }],
    declared: Boolean(patches),
  };
}
