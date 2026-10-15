// 渲染层源码聚合读取器。
//
// App.tsx 正按域拆分为多个模块，而不少契约测试是在「源码文本」层面做断言的
// （正则匹配 + indexOf 切片）。若这些断言仍只读 src/App.tsx，代码一搬走就会集体失效，
// 所以这里把拆分产出按固定顺序拼成一个字符串，让断言不再依赖符号的具体文件位置。
//
// 范围严格限定为 App.tsx + 拆分产出的目录（app/ features/ lib/ state/），
// 不聚合整个 src/：像 InteractiveMessage.tsx 这类既有文件会引入无关文本，
// 让 doesNotMatch 类断言出现假失败（例如「预览不得直接引 highlight.js」）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));
// 拆分产出的目录：新增目录时同步补进这里，否则对应断言会静默失去覆盖。
const INCLUDED_DIRS = ["app", "features", "lib", "state"];
// 编排层固定排在最后：它只保留组装与订阅，实体代码优先出现在前面。
const INCLUDED_ROOT_FILES = ["App.tsx"];
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx"]);

/** 递归收集目录下的源码文件，目录项按名称排序，保证顺序稳定 */
function collectDir(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      files.push(...collectDir(path.join(dir, entry.name)));
      continue;
    }
    if (INCLUDED_EXTENSIONS.has(path.extname(entry.name))) files.push(path.join(dir, entry.name));
  }
  return files;
}

/**
 * 渲染层聚合源码。
 *
 * 规则：
 * - 统一读成 LF，避免 Windows 检出 CRLF 时多行正则失效；
 * - 按目录名 + 文件路径字典序拼接，再补 App.tsx，结果跨平台、跨次运行一致；
 * - indexOf 切片取到的是「定义处」，因为实体模块都排在 App.tsx 之前。
 */
export function readRendererSource() {
  const files = [
    ...INCLUDED_DIRS.flatMap((name) => {
      const dir = path.join(SRC_ROOT, name);
      return fs.existsSync(dir) ? collectDir(dir) : [];
    }),
    ...INCLUDED_ROOT_FILES.map((name) => path.join(SRC_ROOT, name)),
  ];
  return files
    .map((file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
    .join("\n");
}

/** 单独读取渲染层某个文件（断言明确指向具体文件时使用，路径相对 src/） */
export function readRendererFile(relativePath) {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}
