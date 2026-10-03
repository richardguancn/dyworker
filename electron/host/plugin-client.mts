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

/** 客户端半边是否真的存在（用于兼容矩阵与界面提示） */
export function hasClientHalf(manifest: any): boolean {
  return Boolean(manifest?.dsh?.client || manifest?.dyworker?.client);
}
