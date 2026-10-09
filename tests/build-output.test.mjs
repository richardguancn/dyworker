// 构建产物完整性。
//
// 为什么值得单独一层测试：Electron 找不到 preload.cjs 时不会报错，只是静默失去
// window.dyworker 桥接，而界面里到处是 window.dyworker?.xxx(...)——可选链把
// "没有桥接"变成"操作成功"：点「保存设置」照样提示已保存，磁盘上一个字都没写。
// 现场事故：一次带类型错误的 build-electron 在复制静态资源前就提前退出
// （tsc 遇到类型错误默认仍产出 .mjs），留下「有 main.mjs、没有 preload.cjs」的
// 产物，于是 MCP 等所有设置都保存不了，界面还一切正常。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("dist/electron");
const requiredAssets = ["main.mjs", "preload.cjs", "webview-preload.cjs", "reviewer-policy.md", "host/dsh-runtime/vendor/session-history.mjs"];

test("dist/electron 一旦构建过，就不允许缺少 preload 等运行时静态资源", (t) => {
  if (!fs.existsSync(path.join(outDir, "main.mjs"))) {
    t.skip("尚未构建 dist/electron（npm run build:electron）");
    return;
  }
  for (const asset of requiredAssets) {
    assert.ok(
      fs.existsSync(path.join(outDir, asset)),
      `dist/electron 缺少 ${asset}：渲染端会失去 window.dyworker 桥接，所有保存都会静默失效`,
    );
  }
});

test("构建脚本先复制静态资源再编译，并在产物不全时显式失败", () => {
  const lines = fs.readFileSync(path.resolve("scripts/build-electron.mjs"), "utf8").split("\n");
  const firstCopy = lines.findIndex((line) => line.includes("cpSync("));
  const compile = lines.findIndex((line) => line.includes("spawnSync("));
  assert.ok(firstCopy > -1 && compile > -1, "构建脚本应同时包含静态资源复制与编译步骤");
  assert.ok(
    firstCopy < compile,
    "静态资源必须在 tsc 之前复制：tsc 带类型错误时仍会产出 .mjs，提前退出会留下没有 preload 的产物",
  );
  assert.match(lines.join("\n"), /产物缺少/, "构建脚本应在产物不全时显式失败，而不是交付一个哑渲染端");
});
