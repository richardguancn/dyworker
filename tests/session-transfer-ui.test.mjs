import { readModuleSource } from "./helpers/module-source.mjs";
// 任务/项目跨机迁移的入口契约：导出、导入两条链路从界面一路到主进程通道，
// 任何一环被改掉（菜单项消失、preload 少方法、IPC 不走可信入口）都要在这里失败。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readRendererSource, readRendererFile } from "./helpers/renderer-source.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const renderer = readRendererSource();

test("侧栏与顶栏都提供导出任务迁移包的入口", () => {
  assert.match(renderer, /exportSessionPackage\(session\)/, "侧栏会话菜单应能导出任务迁移包");
  assert.match(renderer, /导出任务文件…/, "菜单文案应说明导出的是可导入的任务文件");
  assert.match(renderer, /exportSessionPackage=\{exportSessionPackage\}/, "App 要把导出动作同时传给侧栏与顶栏");
  const shell = readRendererFile("app/ShellLayout.tsx");
  assert.match(shell, /exportSessionPackage: \(session: SessionRecord\) => Promise<void>/, "顶栏 props 应声明导出动作");
  assert.match(shell, /void exportSessionPackage\(activeSession\)/, "顶栏菜单应调用导出动作");
});

test("项目分组提供导出项目与导入迁移包的入口", () => {
  assert.match(renderer, /exportProjectPackage\(group\.path\)/, "项目菜单应能导出整个项目");
  assert.match(renderer, /导出项目文件…/);
  assert.match(renderer, /importSessionPackage\(\)/, "导入入口应调用导入动作");
  assert.match(renderer, /导入任务或项目…/);
  // 项目小节标题行的常驻导入按钮：不展开菜单也能发现
  assert.match(renderer, /aria-label="导入任务或项目"/);
});

test("导入后把会话并进列表并自动打开，避免被下一次保存淘汰", () => {
  const actions = readRendererFile("state/taskActions.ts");
  assert.match(actions, /setSessions\(\(current\) => \[\.\.\.imported, \.\.\.current\.filter/, "导入的会话必须并进列表（存盘顺序以渲染端为准）");
  assert.match(actions, /setPendingAutoOpenSessionId\(imported\[0\]\.id\)/, "导入后应自动打开第一条任务");
});

test("preload 暴露导出/导入桥接，且主进程通道走可信入口", () => {
  const preload = read("../electron/preload.cjs");
  assert.match(preload, /exportSessionPackage: \(payload\) => ipcRenderer\.invoke\("sessions:export-package", payload\)/);
  assert.match(preload, /importSessionPackage: \(\) => ipcRenderer\.invoke\("sessions:import-package"\)/);
  const ipc = read("../electron/host/plugins/transfer-ipc.mts");
  assert.match(ipc, /trustedHandle\("sessions:export-package"/);
  assert.match(ipc, /trustedHandle\("sessions:import-package"/);
  assert.match(ipc, /showSaveDialog/, "导出要经原生保存对话框");
  assert.match(ipc, /showOpenDialog/, "导入要经原生打开对话框");
  const main = readModuleSource(new URL("../electron/main.mts", import.meta.url));
  assert.match(main, /ctx\.plugin\(transferIpcPlugin\(/, "主进程必须挂载迁移插件");
});

test("渲染端类型声明覆盖迁移接口", () => {
  const types = readRendererSource() + readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /exportSessionPackage\(payload: \{/);
  assert.match(types, /importSessionPackage\(\): Promise<\{/);
});
