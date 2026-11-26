// @目录提及、创造模式安全/安装闭环与个性化推荐卡片集成测试
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import {
  filterAtMentionTargets,
  flattenWorkspaceTargets,
  workspaceDirectoryAttachment,
} from "../src/lib/files.ts";
import {
  formatUnreportedCardDecisions,
  parseActionCardCode,
} from "../src/lib/actionCards.ts";
import { describeAttachment, providerMessageContent } from "../electron/desktop/attachments.mts";
import { classify, toolsNeedingApproval, workspaceWriteTools } from "../electron/risk.mts";
import { evaluateApproval } from "../electron/agent/permissions.mts";
import { isReviewerEligible } from "../electron/agent/review.mts";
import { matchStandingRule, suggestStandingRule } from "../electron/agent/standing-rules.mts";
import { Workspace } from "../electron/agent/workspace.mts";
import { runAgent } from "../electron/agent.mts";
import { authoringSkill } from "../electron/authoring-skills.ts";
import { createHost, disposeHost } from "../electron/host/context.mts";
import {
  bumpSemverVersion,
  canAutoInstallCreatedPlugin,
  executePluginInspect,
  executePluginManage,
  listCreatedLocalPlugins,
  managedCreatedPluginsRoot,
  pluginAuthoringToolDefinitions,
  updateLocalPluginMetadata,
  validateLocalPluginDirectory,
} from "../electron/plugin-authoring.mts";

async function mkSandbox(t, prefix = "dyworker-creation-") {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

test("@目录：工作区目标扁平化、/ 逐级下钻排序与 skillTokensInText 防误判", async () => {
  const workspace = "/tmp/ws-dir-test";
  const entries = [
    {
      name: "docs",
      path: `${workspace}/docs`,
      kind: "directory",
      children: [
        { name: "guide.md", path: `${workspace}/docs/guide.md`, kind: "file" },
        {
          name: "api",
          path: `${workspace}/docs/api`,
          kind: "directory",
          children: [
            { name: "spec.md", path: `${workspace}/docs/api/spec.md`, kind: "file" },
          ],
        },
      ],
    },
    { name: "README.md", path: `${workspace}/README.md`, kind: "file" },
  ];

  const targets = flattenWorkspaceTargets(entries, workspace);
  const docsDir = targets.find((t) => t.path === `${workspace}/docs`);
  const apiDir = targets.find((t) => t.path === `${workspace}/docs/api`);
  assert.equal(docsDir?.mentionToken, "docs/");
  assert.equal(apiDir?.mentionToken, "docs/api/");

  // 查询 "docs/" 时：直接子项目录 docs/api/ 应排在 docs/guide.md 之前，不包含更深层 spec.md
  const docsChildren = filterAtMentionTargets(targets, "docs/");
  assert.deepEqual(
    docsChildren.map((item) => item.mentionToken),
    ["docs/api/", "spec.md", "guide.md"].filter((tok) => tok !== "spec.md"),
  );

  // 查询 "docs/api/" 时：命中直属子文件 spec.md
  const apiChildren = filterAtMentionTargets(targets, "docs/api/");
  assert.equal(apiChildren[0]?.path, `${workspace}/docs/api/spec.md`);

  // 验证目录附件结构
  const attachment = workspaceDirectoryAttachment(docsDir, "docs/");
  assert.equal(attachment.isDirectory, true);
  assert.equal(attachment.mimeType, "inode/directory");
  assert.equal(attachment.name, "docs/");

  // 验证 text.ts 中的 INLINE_TOKEN_REGEX / skillTokensInText 逻辑不把 @docs/api/ 里的 /api 识别为技能
  const textTs = await fs.readFile(new URL("../src/lib/text.ts", import.meta.url), "utf8");
  const inlineRegexMatch = /export const INLINE_TOKEN_REGEX = (\/[^\n]+\/[gimsuy]*);/.exec(textTs);
  assert.ok(inlineRegexMatch, "text.ts 应导出 INLINE_TOKEN_REGEX");
  const sandbox = {};
  const fn = vm.runInNewContext(
    `(function() {
      const INLINE_TOKEN_REGEX = ${inlineRegexMatch[1]};
      return function skillTokensInText(text) {
        const names = new Set();
        INLINE_TOKEN_REGEX.lastIndex = 0;
        let match;
        while ((match = INLINE_TOKEN_REGEX.exec(text))) {
          const token = match[0];
          if (token.startsWith("/")) names.add(token.slice(1));
        }
        return names;
      };
    })()`,
    sandbox,
  );
  const tokens = fn("请参考 @docs/api/ 并执行 /build");
  assert.equal(tokens.has("build"), true);
  assert.equal(tokens.has("api"), false);
});

test("@目录：附件描述与模型消息组装采用纯路径透传、不读目录子项且不抛 EISDIR", async (t) => {
  const dir = await mkSandbox(t, "dyworker-dir-att-");
  const subDir = path.join(dir, "docs", "api");
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(path.join(subDir, "secret-child.txt"), "SHOULD_NOT_BE_PRE_READ", "utf8");

  const att = await describeAttachment(subDir);
  assert.equal(att.isDirectory, true);
  assert.equal(att.mimeType, "inode/directory");

  const content = await providerMessageContent({
    role: "user",
    content: "梳理目录结构 @docs/api/",
    attachments: [att],
  });

  assert.equal(typeof content, "string");
  assert.match(content, /\[引用目录 @/);
  assert.ok(content.includes(subDir), "模型内容必须包含目录绝对路径");
  assert.ok(!content.includes("secret-child.txt"), "不能提前枚举目录内子文件名");
  assert.ok(!content.includes("SHOULD_NOT_BE_PRE_READ"), "不能预读目录内文件内容");
});

test("安全边界：plugin_manage 除 full-access/deny-changes 外均强制单次人工确认，不入审核和常驻规则", async (t) => {
  assert.equal(toolsNeedingApproval.has("plugin_inspect"), false);
  assert.equal(toolsNeedingApproval.has("plugin_manage"), true);
  assert.equal(workspaceWriteTools.has("plugin_manage"), false);
  assert.equal(classify("plugin_inspect", { action: "list" }).risk, "read");
  assert.equal(classify("plugin_manage", { action: "install", target: "/tmp/p" }).risk, "write_local");

  assert.equal(evaluateApproval({ approvalMode: "deny-changes", name: "plugin_manage", args: { action: "install", target: "x" } }), "deny");
  assert.equal(evaluateApproval({ approvalMode: "full-access", name: "plugin_manage", args: { action: "install", target: "x" } }), "allow");
  for (const mode of ["interactive", "reviewer", "auto", "allow-writes"]) {
    assert.equal(
      evaluateApproval({ approvalMode: mode, name: "plugin_manage", args: { action: "install", target: "x" } }),
      "ask",
      `approvalMode=${mode} 下必须触发单次人工确认 ask`,
    );
  }

  assert.equal(
    isReviewerEligible({ name: "plugin_manage", approvalMode: "reviewer", args: { action: "install", target: "/tmp/p" } }),
    false,
  );
  assert.equal(suggestStandingRule("plugin_manage", { action: "install", target: "/tmp/p" }), null);
  assert.equal(matchStandingRule([{ kind: "tool-exact", tool: "plugin_manage", pattern: "plugin_manage" }], "plugin_manage", { action: "install" }), false);

  // Workspace trustedWriteRoots 检查
  const wsDir = await mkSandbox(t, "dyworker-ws-");
  const managedRoot = await mkSandbox(t, "dyworker-managed-");
  const otherDir = await mkSandbox(t, "dyworker-other-");

  const plainWs = new Workspace(wsDir, { trustTempDirs: false });
  assert.equal(plainWs.isOutside(path.join(managedRoot, "my-plugin", "index.js"), { forWrite: true }), true);

  const creationWs = new Workspace(wsDir, { trustTempDirs: false, trustedWriteRoots: [managedRoot] });
  assert.equal(creationWs.isOutside(path.join(managedRoot, "my-plugin", "index.js"), { forWrite: true }), false);
  assert.equal(creationWs.isOutside(path.join(otherDir, "secret.txt"), { forWrite: true }), true);
});

test("创造模式插件：校验 -> 离线快速安装 -> 热同步通知 -> 卸载保留源码 -> 秒级恢复", async (t) => {
  const dataDir = await mkSandbox(t, "dyworker-authoring-data-");
  const managedRoot = managedCreatedPluginsRoot(dataDir);
  const pluginDir = path.join(managedRoot, "demo-board");
  await fs.mkdir(pluginDir, { recursive: true });

  await fs.writeFile(
    path.join(pluginDir, "package.json"),
    JSON.stringify({
      name: "demo-board",
      version: "0.1.0",
      type: "module",
      main: "index.js",
      exports: {
        ".": { default: "./index.js" },
        "./client": "./client.js",
      },
      dyworker: {
        client: { platform: "web", inject: [] },
      },
    }, null, 2),
    "utf8",
  );

  await fs.writeFile(
    path.join(pluginDir, "index.js"),
    `export const name = "demo-board";
export const inject = ["connection", "storage"];
export function apply(ctx) {
  const dispose = ctx.connection.register({
    path: "/api/demo-board/ping",
    methods: ["GET"],
    async fetch() {
      const saved = await ctx.storage.readJson("state.json", { count: 1 });
      return Response.json({ ok: true, count: saved.count });
    },
  });
  ctx.effect(() => dispose);
}
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(pluginDir, "client.js"),
    `window.__ModuleLoader__.load({
  id: "demo-board",
  factory(require) {
    const React = require("react");
    return {
      name: "demo-board",
      inject: ["slots"],
      apply(ctx) {
        const Page = function () {
          return React.createElement("div", null, "Demo Board");
        };
        const dispose = ctx.slots.inject("workspace.page", () =>
          ctx.slots.register({ key: "board", label: "演示看板" }, Page)
        );
        ctx.effect(() => dispose);
      }
    };
  }
});
`,
    "utf8",
  );

  const host = await createHost({ userDataDir: dataDir, homeDir: dataDir, mountPlugins: true });
  t.after(async () => { await disposeHost(host); });

  const inspected = await executePluginInspect(host, { action: "check", target: pluginDir }, { managedRoot });
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.packageName, "demo-board");
  assert.equal(inspected.clientEntries.length, 1);

  const syncEvents = [];
  let updatedCount = 0;
  const execOpts = {
    workspacePath: pluginDir,
    managedRoot,
    syncClientPlugin: async (req) => {
      syncEvents.push(req);
      return { ok: true, slots: ["workspace.page"] };
    },
    notifyPluginsUpdated: () => { updatedCount += 1; },
  };

  // 安装（离线拷贝，不走外部 npm）
  const installed = await executePluginManage(
    host,
    { action: "install", target: pluginDir, openSlot: "workspace.page" },
    execOpts,
  );
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(installed.pkgName, "demo-board");
  assert.equal(syncEvents.at(-1)?.action, "install");
  assert.equal(syncEvents.at(-1)?.openSlot, "workspace.page");
  assert.ok(updatedCount >= 1);

  const entry = host.plugins.entries().find((item) => item.name === "demo-board");
  assert.ok(entry?.active, "安装后插件条目应处于激活状态");
  const bundles = await host.plugins.clientBundles(entry.id);
  assert.equal(bundles.ok, true, JSON.stringify(bundles));
  assert.match(bundles.entries[0]?.url || "", /^dyworker-plugin:\/\/client\//);

  // 卸载（保留源码目录）
  const uninstalled = await executePluginManage(
    host,
    { action: "uninstall", target: "demo-board" },
    execOpts,
  );
  assert.equal(uninstalled.ok, true, JSON.stringify(uninstalled));
  assert.equal(uninstalled.preservedSourceDir, pluginDir);
  assert.equal(host.plugins.entries().some((item) => item.name === "demo-board"), false);
  const stillExists = await fs.stat(path.join(pluginDir, "client.js"));
  assert.equal(stillExists.isFile(), true, "卸载后受管目录中的插件源码必须保留");

  // 恢复重装
  const restored = await executePluginManage(
    host,
    { action: "install", target: pluginDir, openSlot: "workspace.page" },
    execOpts,
  );
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.ok(host.plugins.entries().find((item) => item.name === "demo-board")?.active);
});

test("安全校验拦截：禁止 dyworker.builtin、未编译 ESM 客户端脚本及目录外符号链接", async (t) => {
  const root = await mkSandbox(t, "dyworker-sec-validate-");

  // 1) dyworker.builtin: true 被拒绝
  const builtinFake = path.join(root, "fake-builtin");
  await fs.mkdir(builtinFake, { recursive: true });
  await fs.writeFile(path.join(builtinFake, "package.json"), JSON.stringify({
    name: "fake-builtin", version: "0.1.0", main: "index.js", dyworker: { builtin: true },
  }));
  await fs.writeFile(path.join(builtinFake, "index.js"), "export const name='fake-builtin'; export function apply(){}", "utf8");
  const builtinRes = await validateLocalPluginDirectory(builtinFake);
  assert.equal(builtinRes.ok, false);
  assert.match(builtinRes.error || "", /builtin/);

  // 2) 未编译 ESM import 客户端脚本被拒绝
  const esmClient = path.join(root, "esm-client");
  await fs.mkdir(esmClient, { recursive: true });
  await fs.writeFile(path.join(esmClient, "package.json"), JSON.stringify({
    name: "esm-client",
    version: "0.1.0",
    main: "index.js",
    exports: { ".": "./index.js", "./client": "./client.js" },
    dyworker: { client: { platform: "web", inject: [] } },
  }));
  await fs.writeFile(path.join(esmClient, "index.js"), "export const name='esm-client'; export function apply(){}", "utf8");
  await fs.writeFile(path.join(esmClient, "client.js"), `import React from "react";\nwindow.__ModuleLoader__.load({ id: "esm-client", factory() { return {}; } });`, "utf8");
  const esmRes = await validateLocalPluginDirectory(esmClient);
  assert.equal(esmRes.ok, false);
  assert.match(esmRes.error || "", /ESM|classic script/);

  // 3) 越出插件目录的符号链接被拒绝
  const outsideFile = path.join(root, "outside.txt");
  await fs.writeFile(outsideFile, "secret", "utf8");
  const symlinkPlugin = path.join(root, "symlink-escape");
  await fs.mkdir(symlinkPlugin, { recursive: true });
  await fs.writeFile(path.join(symlinkPlugin, "package.json"), JSON.stringify({
    name: "symlink-escape", version: "0.1.0", main: "index.js",
  }));
  await fs.writeFile(path.join(symlinkPlugin, "index.js"), "export const name='symlink-escape'; export function apply(){}", "utf8");
  await fs.symlink(outsideFile, path.join(symlinkPlugin, "leak.txt"));
  const linkRes = await validateLocalPluginDirectory(symlinkPlugin);
  assert.equal(linkRes.ok, false);
  assert.match(linkRes.error || "", /符号链接/);
});

test("个性化推荐卡片：action-card 流式/正常/异常解析与决策状态同步回执", () => {
  assert.equal(parseActionCardCode('{"id":"x","title":"看板"').status, "incomplete");
  assert.equal(parseActionCardCode('not json').status, "invalid");

  const valid = parseActionCardCode(JSON.stringify({
    id: "Weekly Tracker!!",
    title: "每周复盘看板",
    summary: "汇总本周完成项与阻塞原因",
    recommendedSlot: "workspace.page",
    slotReason: "表格与统计适合独立页面展示",
    prompt: "创建一个周复盘插件",
  }));
  assert.equal(valid.status, "ok");
  assert.equal(valid.card.id, "weekly-tracker");
  assert.equal(valid.card.recommendedSlot, "workspace.page");

  const decisions = {
    "weekly-tracker": {
      status: "created",
      chosenSlot: "workspace.page",
      pluginId: "dyworker-card-weekly-abc123",
      pluginName: "每周复盘看板",
      pluginDir: "/data/created-plugins/dyworker-card-weekly-abc123",
      reportedToModel: false,
    },
    "already-synced": {
      status: "dismissed",
      chosenSlot: "sidebar.right.pane.tab",
      reportedToModel: true,
    },
  };

  const first = formatUnreportedCardDecisions(decisions);
  assert.match(first.receiptText, /每周复盘看板/);
  assert.match(first.receiptText, /用户已点击创建并安装/);
  assert.doesNotMatch(first.receiptText, /already-synced/);
  assert.equal(first.updatedDecisions?.["weekly-tracker"]?.reportedToModel, true);

  // 再次调用不应重复生成回执
  const second = formatUnreportedCardDecisions(first.updatedDecisions);
  assert.equal(second.receiptText, "");
});

test("创造模式案例数据与用户文档完整存在、覆盖四类插槽且面向非技术用户", async () => {
  const { CREATION_MODE_EXAMPLES } = await import("../src/lib/creationExamples.ts");
  assert.ok(Array.isArray(CREATION_MODE_EXAMPLES) && CREATION_MODE_EXAMPLES.length >= 6);
  const slotLabels = new Set(CREATION_MODE_EXAMPLES.map((item) => item.slotLabel));
  for (const required of ["独立页面", "右侧面板", "会话视图", "AI 工具"]) {
    assert.equal(slotLabels.has(required), true, `案例应覆盖 ${required}`);
  }
  const technicalJargon = /workspace\.page|sidebar\.right\.pane\.tab|conversation\.view|ctx\.storage|ctx\.tools|require\(["']echarts["']\)/;
  for (const example of CREATION_MODE_EXAMPLES) {
    assert.ok(example.id && example.title && example.summary && example.prompt.length > 20);
    assert.doesNotMatch(example.prompt, technicalJargon, "给普通用户的示例提示词不应包含内部技术术语");
  }
  const guidePath = new URL("../docs/creation-mode-guide.md", import.meta.url);
  const guide = await fs.readFile(guidePath, "utf8");
  assert.match(guide, /创造模式/);
  assert.match(guide, /Excel\/CSV|报表/);
  assert.match(guide, /独立页面/);
  assert.match(guide, /右侧/);
  assert.doesNotMatch(guide, technicalJargon, "面向普通用户的指南不应暴露内部开发术语");
});

test("创造模式自动安装资格与默认打开插槽：严守边界与免确认范围", async (t) => {
  const dataDir = await mkSandbox(t, "dyworker-autoinstall-");
  const managedRoot = managedCreatedPluginsRoot(dataDir);
  const pluginDir = path.join(managedRoot, "weekly-board");
  const outsideDir = await mkSandbox(t, "dyworker-outside-");
  const depsDir = path.join(managedRoot, "with-third-party-dep");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.mkdir(depsDir, { recursive: true });

  const makeBasicPlugin = async (dir, extraManifest = {}) => {
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: path.basename(dir),
        version: "0.1.0",
        main: "index.js",
        exports: { ".": { default: "./index.js" }, "./client": "./client.js" },
        dyworker: { client: { platform: "web", inject: ["slots"] } },
        ...extraManifest,
      }, null, 2),
      "utf8",
    );
    await fs.writeFile(path.join(dir, "index.js"), `export const name = "${path.basename(dir)}"; export function apply() {}`, "utf8");
    await fs.writeFile(
      path.join(dir, "client.js"),
      `window.__ModuleLoader__.load({ id: "${path.basename(dir)}", factory(require) { const R = require("react"); return { name: "${path.basename(dir)}", apply() {} }; } });`,
      "utf8",
    );
  };

  await makeBasicPlugin(pluginDir, { description: "周报看板：统计每周趋势" });
  await makeBasicPlugin(outsideDir);
  await makeBasicPlugin(depsDir, { dependencies: { lodash: "^4.17.21" } });

  // 1. 创造模式下 interactive / reviewer 對受管目录纯本地 install & reload 自动放行
  for (const mode of ["interactive", "reviewer", "auto"]) {
    const res = await canAutoInstallCreatedPlugin(
      { action: "install", target: pluginDir },
      { creationMode: true, approvalMode: mode, managedRoot },
    );
    assert.equal(res.ok, true, `approvalMode=${mode} 下应允许自动安装`);
    assert.equal(res.pkgName, "weekly-board");
  }
  const reloadRes = await canAutoInstallCreatedPlugin(
    { action: "reload", target: "weekly-board" },
    { creationMode: true, approvalMode: "interactive", managedRoot },
  );
  assert.equal(reloadRes.ok, true);

  // 2. 边界守卫：非创造模式、只读模式、uninstall/disable、外部目录、第三方依赖、根目录本身均拒绝
  assert.equal(
    (await canAutoInstallCreatedPlugin({ action: "install", target: pluginDir }, { creationMode: false, approvalMode: "reviewer", managedRoot })).ok,
    false,
  );
  assert.equal(
    (await canAutoInstallCreatedPlugin({ action: "install", target: pluginDir }, { creationMode: true, approvalMode: "deny-changes", managedRoot })).ok,
    false,
  );
  assert.equal(
    (await canAutoInstallCreatedPlugin({ action: "uninstall", target: "weekly-board" }, { creationMode: true, approvalMode: "interactive", managedRoot })).ok,
    false,
  );
  assert.equal(
    (await canAutoInstallCreatedPlugin({ action: "install", target: outsideDir }, { creationMode: true, approvalMode: "interactive", managedRoot })).ok,
    false,
  );
  assert.equal(
    (await canAutoInstallCreatedPlugin({ action: "install", target: depsDir }, { creationMode: true, approvalMode: "interactive", managedRoot })).ok,
    false,
  );
  assert.equal(
    (await canAutoInstallCreatedPlugin({ action: "install", target: managedRoot }, { creationMode: true, approvalMode: "interactive", managedRoot })).ok,
    false,
  );

  // 3. 符号链接逃逸拒绝
  const linkDir = path.join(managedRoot, "symlink-escape");
  await fs.symlink(outsideDir, linkDir);
  assert.equal(
    (await canAutoInstallCreatedPlugin({ action: "install", target: linkDir }, { creationMode: true, approvalMode: "interactive", managedRoot })).ok,
    false,
  );

  // 4. listCreatedLocalPlugins 与 defaultOpenSlot
  const listed = await listCreatedLocalPlugins({ plugins: { entries: () => [{ id: "weekly-board", name: "weekly-board", active: true, disabled: false }] } }, dataDir);
  const hit = listed.find((item) => item.packageName === "weekly-board");
  assert.ok(hit, "应列出受管目录里的周报插件");
  assert.equal(hit.displayName, "周报看板");
  assert.equal(hit.installed, true);

  const syncCalls = [];
  const fakeCtx = {
    plugins: {
      installPackage: async () => ({ ok: true, id: "weekly-board" }),
      entries: () => [{ id: "weekly-board", name: "weekly-board", active: true }],
    },
  };
  await executePluginManage(fakeCtx, { action: "install", target: pluginDir }, {
    managedRoot,
    defaultOpenSlot: true,
    syncClientPlugin: async (req) => { syncCalls.push(req); return { ok: true }; },
  });
  assert.equal(syncCalls[0]?.openSlot, true, "defaultOpenSlot=true 时缺省 openSlot 应自动置为 true");

  await executePluginManage(fakeCtx, { action: "install", target: pluginDir, openSlot: false }, {
    managedRoot,
    defaultOpenSlot: true,
    syncClientPlugin: async (req) => { syncCalls.push(req); return { ok: true }; },
  });
  assert.equal(syncCalls[1]?.openSlot, false, "显式传 openSlot: false 时应保持 false");
});

test("创造模式提示词：直接内联插件制作规范、明确独立页面对应 workspace.page 且普通模式不注入", async (t) => {
  const root = await mkSandbox(t, "dyworker-creation-prompt-");
  const managedRoot = path.join(root, "created-plugins");
  const pluginInstructions = authoringSkill("plugin").instructions;
  assert.match(pluginInstructions, /独立页面.*workspace\.page/);
  assert.match(pluginInstructions, /接入飞书文档\/表格或外部链接/);
  assert.match(pluginInstructions, /严禁以在工作区写单个 `\.html` 文件/);

  const settings = { endpoint: "http://mock.local/v1/chat/completions", model: "mock", apiKey: "test" };
  const captureRequest = async (creationMode) => {
    let capturedBody = null;
    const res = await runAgent({
      settings,
      workspacePath: root,
      approvalMode: "reviewer",
      creationMode,
      managedPluginsRoot: creationMode ? managedRoot : "",
      extraTools: pluginAuthoringToolDefinitions(),
      conversation: [{ role: "user", content: "我想做个独立页面接入飞书文档。" }],
      fetchImpl: async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        };
      },
    });
    assert.equal(res.status, "done");
    return capturedBody;
  };

  const creationBody = await captureRequest(true);
  const creationSystem = String(creationBody?.messages?.[0]?.content || "");
  const creationToolNames = (creationBody?.tools || []).map((item) => item?.function?.name);
  assert.match(creationSystem, /# 创造模式（必须交付 DYWorker 原生插件）/);
  assert.match(creationSystem, /workspace\.page/);
  assert.match(creationSystem, /window\.__ModuleLoader__\.load/);
  assert.match(creationSystem, /严禁以在工作区写单个 `\.html` 文件/);
  assert.ok(creationToolNames.includes("plugin_inspect"), "创造模式首轮应直接可见 plugin_inspect");
  assert.ok(creationToolNames.includes("plugin_manage"), "创造模式首轮应直接可见 plugin_manage");

  const normalBody = await captureRequest(false);
  const normalSystem = String(normalBody?.messages?.[0]?.content || "");
  assert.doesNotMatch(normalSystem, /# 创造模式/);
  assert.doesNotMatch(normalSystem, /window\.__ModuleLoader__\.load/);
});

test("创造模式更新插件：自动递增版本号、防重复递增、同步更新元数据与受管放行边界", async (t) => {
  assert.equal(bumpSemverVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpSemverVersion("0.1.5", "minor"), "0.2.0");
  assert.equal(bumpSemverVersion("1.4.2", "major"), "2.0.0");
  assert.equal(bumpSemverVersion("invalid", "patch"), "0.1.1");

  const dataDir = await mkSandbox(t, "dyw-plugin-update-");
  const managedRoot = managedCreatedPluginsRoot(dataDir);
  const pluginDir = path.join(managedRoot, "feishu-board");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "package.json"),
    JSON.stringify({
      name: "feishu-board",
      version: "0.1.0",
      type: "module",
      main: "index.js",
      description: "飞书项目计划看板",
      author: "原开发者",
      dyworker: { displayName: "飞书看板", icon: "file-spreadsheet", iconColor: "#2563eb" },
    }, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(pluginDir, "index.js"), "export const name = 'feishu-board'; export function apply() {}\n", "utf8");

  const host = await createHost({ userDataDir: dataDir, homeDir: dataDir, mountPlugins: true });
  t.after(async () => { await disposeHost(host); });

  const syncCalls = [];
  const execOpts = {
    managedRoot,
    dataDir,
    defaultOpenSlot: true,
    syncClientPlugin: async (req) => { syncCalls.push(req); return { ok: true }; },
  };

  // 1. 首次安装 0.1.0
  const installed = await executePluginManage(host, { action: "install", target: pluginDir }, execOpts);
  assert.equal(installed.ok, true, JSON.stringify(installed));

  // 2. 更新本地元数据（重命名、改作者、改图标和颜色）
  const metaRes = await updateLocalPluginMetadata(host, {
    target: "feishu-board",
    displayName: "项目计划总览",
    author: "数智团队",
    icon: "folder-kanban",
    iconColor: "#059669",
  }, { dataDir });
  assert.equal(metaRes.ok, true);
  assert.equal(metaRes.updatedSource, true);
  const updatedPkgAfterMeta = JSON.parse(await fs.readFile(path.join(pluginDir, "package.json"), "utf8"));
  assert.equal(updatedPkgAfterMeta.author, "数智团队");
  assert.equal(updatedPkgAfterMeta.dyworker.displayName, "项目计划总览");
  assert.equal(updatedPkgAfterMeta.dyworker.icon, "folder-kanban");
  assert.equal(updatedPkgAfterMeta.dyworker.iconColor, "#059669");

  // 3. 创造模式 action=update 默认自动递增 patch 版本号（0.1.0 -> 0.1.1），且保留新元数据
  const autoPatch = await canAutoInstallCreatedPlugin(
    { action: "update", target: "feishu-board" },
    { creationMode: true, approvalMode: "reviewer", managedRoot },
  );
  assert.equal(autoPatch.ok, true);

  const updated1 = await executePluginManage(host, { action: "update", target: "feishu-board" }, execOpts);
  assert.equal(updated1.ok, true, JSON.stringify(updated1));
  assert.equal(updated1.previousVersion, "0.1.0");
  assert.equal(updated1.version, "0.1.1");
  assert.equal(updated1.versionBumped, true);
  const pkgAfterUpdate1 = JSON.parse(await fs.readFile(path.join(pluginDir, "package.json"), "utf8"));
  assert.equal(pkgAfterUpdate1.version, "0.1.1");
  assert.equal(pkgAfterUpdate1.dyworker.displayName, "项目计划总览");

  // 4. minor 升级（0.1.1 -> 0.2.0）且不产生版本漂移
  const updated2 = await executePluginManage(host, { action: "update", target: "feishu-board", versionBump: "minor" }, execOpts);
  assert.equal(updated2.ok, true);
  assert.equal(updated2.previousVersion, "0.1.1");
  assert.equal(updated2.version, "0.2.0");
  const detail = await host.plugins.detail("feishu-board");
  assert.equal(detail.bundle?.version, "0.2.0");
  assert.equal(detail.bundle?.drift, null);
  assert.equal(detail.metadata?.displayName, "项目计划总览");
  assert.equal(detail.metadata?.author, "数智团队");
  assert.equal(detail.metadata?.icon, "folder-kanban");
  assert.equal(detail.metadata?.iconColor, "#059669");

  // 5. 若源码已手工递增为 0.3.0 且未传 versionBump，应沿用 0.3.0 不重复递增
  pkgAfterUpdate1.version = "0.3.0";
  await fs.writeFile(path.join(pluginDir, "package.json"), `${JSON.stringify(pkgAfterUpdate1, null, 2)}\n`, "utf8");
  const updated3 = await executePluginManage(host, { action: "update", target: pluginDir }, execOpts);
  assert.equal(updated3.ok, true);
  assert.equal(updated3.version, "0.3.0");
  assert.equal(updated3.versionBumped, false);

  // 6. 非受管外部目录仍拒绝自动放行 update
  const outsideDir = await mkSandbox(t, "dyw-outside-update-");
  await fs.writeFile(path.join(outsideDir, "package.json"), JSON.stringify({ name: "outside-pkg", version: "0.1.0", main: "index.js" }), "utf8");
  await fs.writeFile(path.join(outsideDir, "index.js"), "export function apply() {}", "utf8");
  const outsideAuto = await canAutoInstallCreatedPlugin(
    { action: "update", target: outsideDir },
    { creationMode: true, approvalMode: "reviewer", managedRoot },
  );
  assert.equal(outsideAuto.ok, false);
});
