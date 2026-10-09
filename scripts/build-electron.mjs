// 主进程构建：清理并编译 electron/**/*.mts -> dist/electron/**/*.mjs，
// 再把运行时静态资源（preload、python/js 助手脚本、审核纪律文档）复制到
// 产物目录，保持产物内相对布局与源码一致（main.mjs 与 preload.cjs、scripts/
// 同级）。只用 node 内置 API，macOS/Windows/Linux CI 通用。
//
// 顺序很重要：静态资源必须在 tsc 之前复制。tsc 遇到类型错误时默认仍会产出
// .mjs（noEmitOnError 未开），旧写法把复制放在 `tsc.status !== 0` 的提前
// 退出之后，于是一次带类型错误的构建会留下「有 main.mjs、没有 preload.cjs」
// 的产物。Electron 找不到 preload 时不报错、只是静默失去 window.dyworker，
// 界面上每个 window.dyworker?.xxx(...) 都变成空操作：点保存照样提示
// 「设置已保存」，磁盘上却什么都没写（MCP 保存不了就是这么来的）。
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "electron");
const tscBin = path.join(root, "node_modules", "typescript", "bin", "tsc");
const staticAssets = ["preload.cjs", "webview-preload.cjs", "reviewer-policy.md"];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const asset of staticAssets) {
  cpSync(path.join(root, "electron", asset), path.join(outDir, asset));
}
cpSync(path.join(root, "electron", "scripts"), path.join(outDir, "scripts"), { recursive: true });
mkdirSync(path.join(outDir, 'host/dsh-runtime/vendor'), {recursive:true});
cpSync(path.join(root, 'electron/host/dsh-runtime/vendor/session-history.mjs'),
  path.join(outDir, 'host/dsh-runtime/vendor/session-history.mjs'));

const tsc = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.electron.json"], {
  cwd: root,
  stdio: "inherit",
});
if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

// 产物自检：桥接文件或入口缺失时明确失败，不要产出一个「界面能开、保存全哑」的包。
const required = [...staticAssets, "main.mjs", 'host/dsh-runtime/vendor/session-history.mjs'];
const missing = required.filter((asset) => !existsSync(path.join(outDir, asset)));
if (missing.length) {
  console.error(`[build-electron] 产物缺少：${missing.join("、")}；渲染端会失去 window.dyworker 桥接，拒绝交付。`);
  process.exit(1);
}
