// 解析插件包里的客户端 bundle 入口。
//
// DSH 客户端插件的入口写法有两种，实测都出现了：
//   1) exports["./client"] = "./lib/client.js"                        （dsh-context）
//   2) exports["./client"] = { types, default: "./lib/client.js" }    （dsh-better-sidebar）
// 而且一个包可以有**多个**客户端 bundle（dsh-better-sidebar 有 7 个：
// client / client-registry / client-docx / client-xlsx / client-pptx / client-terminal / client-editor）。
//
// 解析结果只包含包目录内的文件（做一次路径归属校验，避免协议层被用来读任意文件）。

import path from "node:path";

export interface ClientEntry {
  /** exports 里的子路径，如 "./client"；没有 exports 声明时为 "" */
  subpath: string;
  /** 绝对路径 */
  file: string;
  /** 相对包目录的路径（用于日志与界面展示） */
  relative: string;
  /** 是否主入口（"./client"，界面默认加载它） */
  primary: boolean;
}

function defaultTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["default", "import", "module", "browser", "require"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return null;
}

/** 判断 target 是否落在包目录内（防目录穿越） */
function insidePackage(pkgDir: string, target: string): boolean {
  const relative = path.relative(pkgDir, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * 列出插件包的客户端 bundle 入口。
 * @param manifest 插件包的 package.json 内容
 * @param pkgDir 插件包目录（绝对路径）
 */
export function resolveClientEntries(manifest: any, pkgDir: string): ClientEntry[] {
  const entries: ClientEntry[] = [];
  const seen = new Set<string>();

  const push = (subpath: string, relative: string | null) => {
    if (!relative) return;
    const file = path.resolve(pkgDir, relative);
    if (!insidePackage(pkgDir, file) || seen.has(file)) return;
    seen.add(file);
    // relative 一律是**规范化后的包内相对路径**（清单里可能写成 "./lib/client.js"）
    entries.push({ subpath, file, relative: path.relative(pkgDir, file), primary: subpath === "./client" });
  };

  // ① exports 里所有 ./client* 子路径
  const exportsField = manifest?.exports;
  if (exportsField && typeof exportsField === "object") {
    for (const [subpath, value] of Object.entries(exportsField as Record<string, unknown>)) {
      if (subpath !== "./client" && !subpath.startsWith("./client/")) continue;
      push(subpath, defaultTarget(value));
    }
  }

  // ② 显式声明（exports 里没有时兜底）
  const client = manifest?.dsh?.client || manifest?.dyworker?.client;
  if (!entries.length && client) {
    push("./client", client.entry || client.main || "./lib/client.js");
  }

  // 主入口排在最前，其余按子路径字典序
  return entries.sort((a, b) => Number(b.primary) - Number(a.primary) || a.subpath.localeCompare(b.subpath));
}

/**
 * 拆分包名与子路径：`@scope/name/sub` → { name: "@scope/name", subpath: "./sub" }。
 * DSH 客户端模块常用子路径（实测 require("@deepseek-ai/dsh-client-runtime/client")）。
 */
export function splitModuleSpec(spec: string): { name: string; subpath: string } {
  const parts = String(spec || "").split("/");
  const nameParts = parts[0]?.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  const rest = parts.slice(nameParts.length).filter(Boolean).join("/");
  return { name: nameParts.join("/"), subpath: rest ? `./${rest}` : "" };
}

/** 客户端半边是否真的存在（用于兼容矩阵与界面提示） */
export function hasClientHalf(manifest: any): boolean {
  return Boolean(manifest?.dsh?.client || manifest?.dyworker?.client);
}

export interface ClientModuleNode {
  /** 包名，如 @deepseek-ai/dsh-client-ui-settings */
  spec: string;
  /** 包目录（绝对路径） */
  dir: string;
  /** 客户端 bundle 入口（绝对路径） */
  file: string;
  /** 它自己声明的客户端模块依赖 */
  deps: string[];
}

export interface ClientModulePlan {
  /** 依赖在前、插件在后的加载顺序（已去重） */
  ordered: ClientModuleNode[];
  /** 解析不到的模块（package.json 里声明了、但本机找不到） */
  missing: string[];
}

/**
 * 把"声明的客户端模块"展开成依赖在前、可直接逐个加载的顺序。
 *
 * 依据：插件与客户端模块都用 package.json 的 dsh.client.inject 声明"需要哪些客户端模块"，
 * 而模块之间还会互相依赖（例如 dsh-client-ui-settings 声明 dsh-api-remotes）。
 * 循环依赖会被安全跳过。
 *
 * @param roots 直接声明的模块名
 * @param resolve 包名 → { manifest, dir }；解析不到返回 null
 */
export function orderClientModules(
  roots: string[],
  resolve: (spec: string) => { manifest: any; dir: string; relative?: string } | null,
): ClientModulePlan {
  const ordered: ClientModuleNode[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();

  const visit = (spec: string) => {
    const key = String(spec || "");
    if (!key || seen.has(key) || visiting.has(key)) return;
    visiting.add(key);
    const found = resolve(key);
    if (!found) {
      if (!missing.includes(key)) missing.push(key);
      visiting.delete(key);
      return;
    }
    const client = found.manifest?.dsh?.client || found.manifest?.dyworker?.client || null;
    const deps: string[] = Array.isArray(client?.inject) ? client.inject.map(String) : [];
    // 先递归依赖（依赖在前）
    for (const dep of deps) visit(dep);
    // 子路径模块（如 @deepseek-ai/dsh-client-runtime/client）用它自己的入口
    const entries = found.relative
      ? [{ file: path.resolve(found.dir, found.relative) }]
      : resolveClientEntries(found.manifest, found.dir);
    if (entries.length) {
      ordered.push({ spec: key, dir: found.dir, file: entries[0].file, deps });
    } else if (client) {
      // 声明了客户端半边但没有可解析入口：如实记为缺失
      if (!missing.includes(key)) missing.push(key);
    }
    visiting.delete(key);
    seen.add(key);
  };

  for (const root of roots || []) visit(String(root));
  return { ordered, missing };
}


/**
 * 提取 bundle 里**字面量 require** 的模块名。
 * DSH 的客户端 bundle 是预打包产物，require 的参数都是字符串字面量，
 * 因此在**不执行代码**的前提下就能算出依赖闭包——这让"没声明但会被 require 的模块"
 * 也能被提前加载（实测 dsh-client-ui-slots 就是这样被别的模块用到的）。
 */
export function readStaticRequires(source: string): string[] {
  const found = new Set<string>();
  for (const match of String(source || "").matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    found.add(match[1]);
  }
  return [...found];
}
