// 接线不变量：每个 IPC 插件从 deps 里解构的名字，都必须由 main.mts 的挂载点真正提供。
//
// 为什么必须有这条：拆 IPC 时漏给依赖不会报错，只在**运行期调用该 handler 时**抛
// "xxx is not a function"。dev 模式下渲染端 IPC 常被判为不受信任而根本不进 handler，
// 单测又是源码文本断言——于是这个缺口一路溜到了打包版：
// app:initial-state 抛错 → 渲染端退回空状态并保存 → 历史会话/配置被整批覆盖。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
test("IPC 插件的依赖缺口检查：解构的每个名字都必须由挂载点提供", () => {
const main = fs.readFileSync("electron/main.mts", "utf8");

// 用花括号配对取出一个 { ... } 块（从 openIndex 处的 '{' 开始）
function blockAt(text, openIndex) {
  let depth = 0, inStr = null, esc = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return text.slice(openIndex, i + 1); }
  }
  throw new Error("括号不配对");
}
const keysOf = (block) => new Set([...block.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*[,:}]/g)].map((m) => m[1]));

// shellDeps 提供的键
const shellStart = main.indexOf("const shellDeps = {");
const shellBlock = blockAt(main, main.indexOf("{", shellStart));
const shellKeys = keysOf(shellBlock);

const dir = "electron/host/plugins";
let problems = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith("-ipc.mts"))) {
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  const m = src.match(/const\s*\{([^}]+)\}\s*=\s*deps;/s);
  if (!m) continue;
  const names = m[1].split(",").map((n) => n.trim().split(":")[0].trim()).filter(Boolean);
  const pluginName = file.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/\.mts$/, "Plugin");
  const callRe = new RegExp(`ctx\\.plugin\\(${pluginName}\\(`);
  const callIdx = main.search(callRe);
  if (callIdx < 0) { assert.fail(`${file}: main 里没找到挂载调用`); }
  const argStart = main.indexOf("{", main.indexOf("(", callIdx));
  const argBlock = blockAt(main, argStart);
  const provided = keysOf(argBlock);
  if (/\.\.\.shellDeps/.test(argBlock)) for (const k of shellKeys) provided.add(k);
  const missing = names.filter((n) => !provided.has(n));
  if (missing.length) { assert.fail(`${file} 缺少依赖: ${missing.join(", ")}`); }
}
assert.equal(problems, 0, "存在 IPC 插件依赖缺口（会以运行期 xxx is not a function 形式爆出）");
});
