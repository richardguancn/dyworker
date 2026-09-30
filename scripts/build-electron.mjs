// 主进程构建：清理并编译 electron/**/*.mts -> dist/electron/**/*.mjs，
// 再把运行时静态资源（preload、python/js 助手脚本、审核纪律文档）复制到
// 产物目录，保持产物内相对布局与源码一致（main.mjs 与 preload.cjs、scripts/
// 同级）。只用 node 内置 API，macOS/Windows/Linux CI 通用。
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "electron");
const tscBin = path.join(root, "node_modules", "typescript", "bin", "tsc");

rmSync(outDir, { recursive: true, force: true });
const tsc = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.electron.json"], {
  cwd: root,
  stdio: "inherit",
});
if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

mkdirSync(outDir, { recursive: true });
for (const asset of ["preload.cjs", "webview-preload.cjs", "reviewer-policy.md"]) {
  cpSync(path.join(root, "electron", asset), path.join(outDir, asset));
}
cpSync(path.join(root, "electron", "scripts"), path.join(outDir, "scripts"), { recursive: true });
