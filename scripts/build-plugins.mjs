// 打包内置插件的客户端半边。
//
// 为什么需要这一步：DSH 客户端插件的客户端半边必须是一个**经典脚本**，开头调
// `window.__ModuleLoader__.load({ id, factory })`（渲染端用 <script src> 注入，
// CSP 禁 eval/内联）。我们自己的插件想复用仓库里的 TS/TSX（模型 + 视图），
// 就得在构建期打包成那个形状。
//
// 约定：
//   builtin-plugins/<包名>/src/client.tsx   →  builtin-plugins/<包名>/client.js
//   - react / react-dom / @deepseek-ai/* 一律 external：运行时由宿主模块表提供
//     （见 src/pluginRuntime/index.ts 与 electron/host/plugin-client.mts 的 HOST_CLIENT_MODULES）
//   - 产物是 CJS 包进 factory，factory 里 `require` 拿到的就是宿主提供的模块
//
// 用法：node scripts/build-plugins.mjs [--check]
//   --check 只校验产物是否与源码一致（CI/提交前用），不写文件

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildClientHelpers } from './build-client-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtinDir = path.join(root, "builtin-plugins");
const checkOnly = process.argv.includes("--check");
await buildClientHelpers(checkOnly);

/** 宿主模块表里已有的模块：一律外部化，运行时 require 由加载器提供 */
const HOST_EXTERNALS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-runtime/client",
];

const CLIENT_SOURCES = ["src/client.tsx", "src/client.ts", "src/client.jsx", "src/client.js"];

async function packages() {
  const found = [];
  let entries = [];
  try {
    entries = await readdir(builtinDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    // 支持 @scope/name 两级目录
    if (entry.name.startsWith("@")) {
      const scopeDir = path.join(builtinDir, entry.name);
      for (const inner of await readdir(scopeDir, { withFileTypes: true })) {
        if (inner.isDirectory()) found.push(path.join(scopeDir, inner.name));
      }
      continue;
    }
    found.push(path.join(builtinDir, entry.name));
  }
  return found;
}

/** 把打包结果包成 DSH 客户端 bundle 的固定形状 */
function wrapBundle(packageName, code) {
  return [
    "// 生成物：由 scripts/build-plugins.mjs 从 src/client.tsx 打包而来，请勿手改。",
    `window.__ModuleLoader__.load({`,
    `  id: ${JSON.stringify(packageName)},`,
    "  factory: function (require) {",
    "    var module = { exports: {} };",
    "    var exports = module.exports;",
    "(function (module, exports, require) {",
    code,
    "})(module, exports, require);",
    "    // 容器（ClientPluginHost.load）不做 default 解包，这里替它解一次：",
    "    // 插件源码写的是 `export default { name, inject, apply }`",
    "    return module.exports && module.exports.default ? module.exports.default : module.exports;",
    "  },",
    "});",
    "",
  ].join("\n");
}

let built = 0;
let skipped = 0;
for (const dir of await packages()) {
  const manifestPath = path.join(dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    continue;
  }
  const source = CLIENT_SOURCES.map((relative) => path.join(dir, relative)).find((file) => existsSync(file));
  if (!source || !manifest?.name) {
    skipped += 1;
    continue;
  }
  const result = await build({
    entryPoints: [source],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    // 图表（ECharts）进 bundle 后体积明显变大：压缩产物，asar 里省空间也省解析时间
    minify: true,
    external: HOST_EXTERNALS,
    logLevel: "silent",
    legalComments: "none",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  const output = wrapBundle(manifest.name, result.outputFiles[0].text.trimEnd());
  const target = path.join(dir, "client.js");
  const previous = existsSync(target) ? await readFile(target, "utf8") : null;
  if (previous === output) {
    console.log(`[plugins] ${manifest.name} 已是最新（${path.relative(root, target)}）`);
    continue;
  }
  if (checkOnly) {
    console.error(`[plugins] ${manifest.name} 的客户端 bundle 与源码不一致，请运行 node scripts/build-plugins.mjs`);
    process.exitCode = 1;
    continue;
  }
  await writeFile(target, output, "utf8");
  built += 1;
  const size = (Buffer.byteLength(output) / 1024).toFixed(1);
  console.log(`[plugins] ${manifest.name} → ${path.relative(root, target)}（${size} kB）`);
}
if (!checkOnly) console.log(`[plugins] 完成：生成 ${built} 个，跳过 ${skipped} 个（没有 src/client.*）`);
