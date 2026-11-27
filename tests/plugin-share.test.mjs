// 插件分享导出、安全校验、普通 ZIP 兼容、导入落盘与创造模式二次修改测试
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

import { createHost, disposeHost } from "../electron/host/context.mts";
import { analyzePlugin } from "../electron/host/dsh-compat.mts";
import {
  SHARE_MANIFEST_FILE,
  SHARE_PACKAGE_FORMAT,
  exportPluginSharePackage,
  inspectPluginForExport,
  inspectSharePackage,
  readSafeArchiveEntries,
  resolvePluginCustomizationFromSettings,
  scanSensitiveFindings,
  unpackSharePackageToManagedDir,
} from "../electron/plugin-share.mts";
import {
  canAutoInstallCreatedPlugin,
  executePluginManage,
  listCreatedLocalPlugins,
  managedCreatedPluginsRoot,
} from "../electron/plugin-authoring.mts";
import { approvalDetails, toolSummary } from "../electron/agent/tool-summary.mts";

async function mkSandbox(t, prefix = "dyworker-share-") {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

async function createSampleClientPlugin(dir, pkgName = "demo-share-board", opts = {}) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: pkgName,
      version: opts.version || "1.0.0",
      type: "module",
      main: "index.js",
      description: opts.description || "示例看板插件：用于分享导出测试",
      exports: { ".": "./index.js", "./client": "./client.js" },
      dyworker: { client: { platform: "web", inject: [] } },
    }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "index.js"),
    opts.indexJs || [
      `export const name = ${JSON.stringify(pkgName)};`,
      `export const inject = ["storage"];`,
      `export async function apply(ctx) {`,
      `  await ctx.storage.readJson(${JSON.stringify(`${pkgName}/items.json`)}, []);`,
      `  await ctx.storage.readJson("custom-tpl.json", {});`,
      `}`,
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "client.js"),
    opts.clientJs || [
      `window.__ModuleLoader__.load({`,
      `  id: ${JSON.stringify(pkgName)},`,
      `  factory(require) {`,
      `    const React = require("react");`,
      `    const e = React.createElement;`,
      `    return {`,
      `      name: ${JSON.stringify(pkgName)},`,
      `      inject: ["slots"],`,
      `      apply(ctx) {`,
      `        const Page = () => e("div", null, "Demo");`,
      `        ctx.effect(() => ctx.slots.inject("workspace.page", () => ctx.slots.register({ key: "main", label: "示例看板" }, Page)));`,
      `      }`,
      `    };`,
      `  }`,
      `});`,
    ].join("\n"),
    "utf8",
  );
  // 应被自动排除的目录与垃圾文件
  await fs.mkdir(path.join(dir, "node_modules", "ignored-pkg"), { recursive: true });
  await fs.writeFile(path.join(dir, "node_modules", "ignored-pkg", "index.js"), "ignored", "utf8");
  await fs.mkdir(path.join(dir, ".git"), { recursive: true });
  await fs.writeFile(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await fs.writeFile(path.join(dir, ".DS_Store"), "junk", "utf8");
}

test("导出与导入完整闭环：排除 node_modules/.git，默认不含数据，支持按需附带数据与防覆盖保护", async (t) => {
  const senderRoot = await mkSandbox(t, "dyw-share-sender-");
  const receiverRoot = await mkSandbox(t, "dyw-share-receiver-");

  const senderHost = await createHost({ userDataDir: senderRoot, mountPlugins: true });
  const receiverHost = await createHost({ userDataDir: receiverRoot, mountPlugins: true });
  t.after(async () => {
    await disposeHost(senderHost);
    await disposeHost(receiverHost);
  });

  const pkgName = "demo-share-board";
  const pluginDir = path.join(managedCreatedPluginsRoot(senderRoot), pkgName);
  await createSampleClientPlugin(pluginDir, pkgName);

  // 先安装到发送方宿主
  const installedSender = await executePluginManage(senderHost, { action: "install", target: pluginDir }, {
    managedRoot: managedCreatedPluginsRoot(senderRoot),
  });
  assert.equal(installedSender.ok, true, installedSender.error);

  // 写入插件存储数据（子目录约定 + 源码字面量文件）
  const senderStorageRoot = senderHost.get("storage").root;
  await fs.mkdir(path.join(senderStorageRoot, pkgName), { recursive: true });
  await fs.writeFile(path.join(senderStorageRoot, pkgName, "items.json"), JSON.stringify([{ title: "模板A" }]), "utf8");
  await fs.writeFile(path.join(senderStorageRoot, "custom-tpl.json"), JSON.stringify({ preset: "公文" }), "utf8");
  // 其他插件的数据不应被打包进去
  await fs.writeFile(path.join(senderStorageRoot, "other-plugin-secret.json"), JSON.stringify({ secret: "nope" }), "utf8");

  // 1. 导出前预检：识别 2 个关联数据文件，不包含其他插件文件
  const inspection = await inspectPluginForExport(senderHost, {
    target: pkgName,
    dataDir: senderRoot,
    storageRoot: senderStorageRoot,
  });
  assert.equal(inspection.ok, true);
  assert.equal(inspection.shareKind, "local");
  assert.equal(inspection.hasClient, true);
  assert.deepEqual(
    inspection.dataFiles.map((f) => f.relativePath).sort(),
    ["custom-tpl.json", `${pkgName}/items.json`].sort(),
  );

  // 2. 默认导出（includeData: false）：仅含插件本体，排除 node_modules/.git/data
  const outNoData = path.join(senderRoot, "exports", "board-no-data.dyplugin");
  const exportedNoData = await exportPluginSharePackage(senderHost, {
    target: pkgName,
    outputPath: outNoData,
    includeData: false,
    dataDir: senderRoot,
    storageRoot: senderStorageRoot,
    appVersion: "0.4.0",
  });
  assert.equal(exportedNoData.ok, true);
  assert.equal(exportedNoData.includesData, false);

  const parsedNoData = readSafeArchiveEntries(await fs.readFile(outNoData));
  assert.equal(parsedNoData.format, "dyplugin");
  assert.equal(parsedNoData.shareManifest?.format, SHARE_PACKAGE_FORMAT);
  assert.equal(parsedNoData.dataFiles.length, 0);
  const noDataRelPaths = parsedNoData.pluginFiles.map((f) => f.relativePath);
  assert.ok(noDataRelPaths.includes("package.json"));
  assert.ok(noDataRelPaths.includes("index.js"));
  assert.ok(noDataRelPaths.includes("client.js"));
  assert.ok(!noDataRelPaths.some((p) => p.includes("node_modules") || p.includes(".git") || p.includes(".DS_Store")));

  // 3. 附带数据导出（includeData: true）
  const outWithData = path.join(senderRoot, "exports", "board-with-data.dyplugin");
  const exportedWithData = await exportPluginSharePackage(senderHost, {
    target: pkgName,
    outputPath: outWithData,
    includeData: true,
    dataDir: senderRoot,
    storageRoot: senderStorageRoot,
    appVersion: "0.4.0",
  });
  assert.equal(exportedWithData.ok, true);
  assert.equal(exportedWithData.includesData, true);
  assert.equal(exportedWithData.includedDataFiles.length, 2);

  // 4. 在接收方环境预览、防覆盖导入、再显式覆盖导入
  const receiverStorageRoot = receiverHost.get("storage").root;
  await fs.mkdir(path.join(receiverStorageRoot, pkgName), { recursive: true });
  await fs.writeFile(path.join(receiverStorageRoot, pkgName, "items.json"), JSON.stringify([{ title: "本机已有" }]), "utf8");

  const preview = await inspectSharePackage({
    filePath: outWithData,
    ctx: receiverHost,
    dataDir: receiverRoot,
    storageRoot: receiverStorageRoot,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.packageName, pkgName);
  assert.equal(preview.includesData, true);
  assert.deepEqual(preview.conflictingDataFiles, [`${pkgName}/items.json`]);

  // 默认不覆盖本机已有文件
  const unpackedKeep = await unpackSharePackageToManagedDir({
    filePath: outWithData,
    dataDir: receiverRoot,
    storageRoot: receiverStorageRoot,
    importData: true,
    overwriteData: false,
  });
  assert.equal(unpackedKeep.ok, true);
  assert.deepEqual(unpackedKeep.importedDataFiles, ["custom-tpl.json"]);
  assert.deepEqual(unpackedKeep.skippedDataFiles, [`${pkgName}/items.json`]);
  const keptLocal = JSON.parse(await fs.readFile(path.join(receiverStorageRoot, pkgName, "items.json"), "utf8"));
  assert.equal(keptLocal[0].title, "本机已有");

  // 显式允许覆盖数据
  const unpackedOverwrite = await unpackSharePackageToManagedDir({
    filePath: outWithData,
    dataDir: receiverRoot,
    storageRoot: receiverStorageRoot,
    importData: true,
    overwriteData: true,
  });
  assert.equal(unpackedOverwrite.ok, true);
  assert.equal(unpackedOverwrite.importedDataFiles.length, 2);
  const overwrittenLocal = JSON.parse(await fs.readFile(path.join(receiverStorageRoot, pkgName, "items.json"), "utf8"));
  assert.equal(overwrittenLocal[0].title, "模板A");

  // 5. 导入后落盘在受管目录，接收方可安装并通过创造模式 listCreatedLocalPlugins + reload 二次修改
  const createdList = await listCreatedLocalPlugins(receiverHost, receiverRoot);
  assert.ok(createdList.some((item) => item.packageName === pkgName && item.valid));

  const installReceiver = await executePluginManage(receiverHost, { action: "install", target: unpackedOverwrite.pluginDir }, {
    managedRoot: managedCreatedPluginsRoot(receiverRoot),
  });
  assert.equal(installReceiver.ok, true, installReceiver.error);

  // 模拟接收方用创造模式修改源码后重载
  const targetClientPath = path.join(unpackedOverwrite.pluginDir, "client.js");
  const prevClient = await fs.readFile(targetClientPath, "utf8");
  await fs.writeFile(targetClientPath, prevClient.replace("示例看板", "接收方二改看板"), "utf8");
  const reloaded = await executePluginManage(receiverHost, { action: "reload", target: pkgName }, {
    managedRoot: managedCreatedPluginsRoot(receiverRoot),
  });
  assert.equal(reloaded.ok, true, reloaded.error);
  const afterContent = await fs.readFile(path.join(receiverHost.plugins.dir, "node_modules", pkgName, "client.js"), "utf8");
  assert.match(afterContent, /接收方二改看板/);
});

test("导出前敏感信息与本机绝对路径检测并脱敏，第三方与内置插件分流处理", async (t) => {
  const root = await mkSandbox(t, "dyw-share-scan-");
  const host = await createHost({ userDataDir: root, mountPlugins: true });
  t.after(async () => disposeHost(host));

  const secretPlain = "sk-proj-1234567890abcdef1234567890";
  const pluginDir = path.join(managedCreatedPluginsRoot(root), "leak-check-plugin");
  await createSampleClientPlugin(pluginDir, "leak-check-plugin", {
    indexJs: [
      `export const name = "leak-check-plugin";`,
      `const API_KEY = ${JSON.stringify(secretPlain)};`,
      `const LOCAL_DIR = "/Users/alice/Documents/private-sheet.xlsx";`,
      `export function apply() { return [API_KEY, LOCAL_DIR]; }`,
    ].join("\n"),
  });

  const inspection = await inspectPluginForExport(host, {
    target: pluginDir,
    dataDir: root,
    storageRoot: host.get("storage").root,
  });
  assert.equal(inspection.ok, true);
  assert.ok(inspection.pluginWarnings.some((w) => w.kind === "secret" && w.preview.startsWith("sk-pro") && !w.preview.includes("1234567890")));
  assert.ok(inspection.pluginWarnings.some((w) => w.kind === "local-path" && w.preview.includes("/Users/alice/")));

  // 直接测试 scanSensitiveFindings 脱敏保证不返回明文
  const directFindings = scanSensitiveFindings([{ label: "cfg.json", content: `{"token":"${secretPlain}"}` }]);
  assert.equal(directFindings.length, 1);
  assert.ok(!directFindings[0].preview.includes("abcdef"));

  // 第三方远程插件：返回复制安装地址，不允许打包为本地 zip
  host.plugins.bundles = [{
    name: "dsh-office-tools",
    packageName: "dsh-office-tools",
    version: "1.0.5",
    description: "办公文档工具",
    source: { kind: "npm", input: "dsh-office-tools@1.0.5", source: "default" },
  }];
  const remoteInspect = await inspectPluginForExport(host, { target: "dsh-office-tools", dataDir: root });
  assert.equal(remoteInspect.ok, true);
  assert.equal(remoteInspect.shareKind, "remote");
  assert.equal(remoteInspect.installSpec, "dsh-office-tools@1.0.5");
  assert.match(remoteInspect.shareText, /dsh-office-tools@1\.0\.5/);

  const remoteExport = await exportPluginSharePackage(host, {
    target: "dsh-office-tools",
    outputPath: path.join(root, "remote.dyplugin"),
    dataDir: root,
  });
  assert.equal(remoteExport.ok, false);
  assert.equal(remoteExport.shareKind, "remote");

  // 内置插件：拒绝分享导出
  host.plugins.rows = [{ id: "builtin-kb", name: "builtin-kb", builtin: true }];
  const builtinInspect = await inspectPluginForExport(host, { target: "builtin-kb", dataDir: root });
  assert.equal(builtinInspect.ok, false);
  assert.match(builtinInspect.error, /内置插件/);
});

test("普通 .zip 兼容（根目录与单层子目录）及安全防线拦截恶意包", async (t) => {
  const root = await mkSandbox(t, "dyw-share-zip-");

  // 1. 普通 .zip（顶层文件夹包裹插件）
  const wrappedZip = new AdmZip();
  wrappedZip.addFile("my-folder/package.json", Buffer.from(JSON.stringify({
    name: "wrapped-zip-plugin",
    version: "0.2.0",
    type: "module",
    main: "index.js",
    description: "普通 zip 打包测试",
  }), "utf8"));
  wrappedZip.addFile("my-folder/index.js", Buffer.from(`export const name = "wrapped-zip-plugin"; export function apply() {}`, "utf8"));
  wrappedZip.addFile("__MACOSX/._package.json", Buffer.from("junk", "utf8"));
  const wrappedPath = path.join(root, "wrapped.zip");
  await fs.writeFile(wrappedPath, wrappedZip.toBuffer());

  const previewWrapped = await inspectSharePackage({ filePath: wrappedPath, dataDir: root });
  assert.equal(previewWrapped.ok, true, previewWrapped.error);
  assert.equal(previewWrapped.format, "zip");
  assert.equal(previewWrapped.packageName, "wrapped-zip-plugin");

  const unpackedWrapped = await unpackSharePackageToManagedDir({ filePath: wrappedPath, dataDir: root });
  assert.equal(unpackedWrapped.ok, true);
  assert.equal(unpackedWrapped.packageName, "wrapped-zip-plugin");

  // 2. Zip Slip 路径穿越拦截（绕过 AdmZip.addFile 自动规范化，写入真实恶意 ../evil.txt 与绝对路径条目）
  const slipZip = new AdmZip();
  slipZip.addFile("package.json", Buffer.from(JSON.stringify({ name: "bad", version: "1.0.0", main: "index.js" }), "utf8"));
  slipZip.addFile("index.js", Buffer.from("export function apply(){}", "utf8"));
  slipZip.addFile("evil.txt", Buffer.from("pwn", "utf8"));
  slipZip.getEntry("evil.txt").entryName = "../evil.txt";
  assert.throws(() => readSafeArchiveEntries(slipZip.toBuffer()), /不安全的文件路径/);

  const absZip = new AdmZip();
  absZip.addFile("package.json", Buffer.from(JSON.stringify({ name: "bad", version: "1.0.0", main: "index.js" }), "utf8"));
  absZip.addFile("index.js", Buffer.from("export function apply(){}", "utf8"));
  absZip.addFile("abs.txt", Buffer.from("pwn", "utf8"));
  absZip.getEntry("abs.txt").entryName = "/etc/passwd";
  assert.throws(() => readSafeArchiveEntries(absZip.toBuffer()), /不安全的文件路径/);

  // 3. 符号链接条目拦截（在 Central Directory 头写入真实 POSIX S_IFLNK 属性 0o120777 << 16）
  const symlinkZip = new AdmZip();
  symlinkZip.addFile("package.json", Buffer.from(JSON.stringify({ name: "sym", version: "1.0.0", main: "index.js" }), "utf8"));
  symlinkZip.addFile("index.js", Buffer.from("export function apply(){}", "utf8"));
  const symBuf = Buffer.from(symlinkZip.toBuffer());
  let cdOffset = symBuf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(cdOffset >= 0);
  // 第二条记录是 index.js，向中央目录项的 external file attributes (offset +38) 写入 S_IFLNK
  const secondCd = symBuf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cdOffset + 4);
  assert.ok(secondCd >= 0);
  symBuf.writeUInt32LE((0o120777 << 16) >>> 0, secondCd + 38);
  assert.throws(() => readSafeArchiveEntries(symBuf), /符号链接/);

  // 4. 恶意声明 builtin: true 拦截
  const builtinClaimZip = new AdmZip();
  builtinClaimZip.addFile("package.json", Buffer.from(JSON.stringify({
    name: "fake-builtin",
    version: "1.0.0",
    main: "index.js",
    dyworker: { builtin: true },
  }), "utf8"));
  builtinClaimZip.addFile("index.js", Buffer.from("export function apply(){}", "utf8"));
  const builtinPreview = await inspectSharePackage({ buffer: builtinClaimZip.toBuffer(), fileName: "fake.zip", dataDir: root });
  assert.equal(builtinPreview.ok, false);
  assert.match(builtinPreview.error, /builtin/);
});

test("plugin_manage(action=export) 受控导出：严格保留审批边界且生成清晰审批摘要", async (t) => {
  const root = await mkSandbox(t, "dyw-share-tool-");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });

  const host = await createHost({ userDataDir: root, mountPlugins: true });
  t.after(async () => disposeHost(host));

  const pkgName = "tool-export-plugin";
  const managedRoot = managedCreatedPluginsRoot(root);
  const pluginDir = path.join(managedRoot, pkgName);
  await createSampleClientPlugin(pluginDir, pkgName);
  const installed = await executePluginManage(host, { action: "install", target: pluginDir }, { managedRoot });
  assert.equal(installed.ok, true);

  // 1. 创造模式自动放行白名单绝不能放行 export
  const autoDecision = await canAutoInstallCreatedPlugin(
    { action: "export", target: pluginDir },
    { creationMode: true, approvalMode: "ask-all", managedRoot },
  );
  assert.equal(autoDecision.ok, false);

  // 2. 工具摘要与审批详情清晰展示
  assert.match(toolSummary("plugin_manage", { action: "export", target: pkgName }), /导出插件分享包/);
  const detail = approvalDetails("plugin_manage", {
    action: "export",
    target: pkgName,
    outputPath: "shared.dyplugin",
    includeData: false,
  });
  assert.match(detail, /导出插件分享包/);
  assert.match(detail, /shared\.dyplugin/);
  assert.match(detail, /仅源码本体/);

  // 3. 受控执行导出到工作区
  const exportRes = await executePluginManage(
    host,
    { action: "export", target: pkgName, outputPath: "shared.dyplugin", includeData: false },
    { workspacePath: workspace, managedRoot, dataDir: root, storageRoot: host.get("storage").root },
  );
  assert.equal(exportRes.ok, true, exportRes.error);
  assert.equal(exportRes.shareKind, "local");
  assert.equal(exportRes.path, path.join(workspace, "shared.dyplugin"));
  const stat = await fs.stat(exportRes.path);
  assert.ok(stat.size > 0);
});

test("前端组件、Preload 与 IPC 接线契约完整", async () => {
  const read = (rel) => fs.readFile(new URL(rel, import.meta.url), "utf8");
  const [pluginsPage, detailPage, addDialog, shareDialog, actionCard, preload, ipc, skill] = await Promise.all([
    read("../src/PluginsPage.tsx"),
    read("../src/PluginDetailPage.tsx"),
    read("../src/AddPluginDialog.tsx"),
    read("../src/SharePluginDialog.tsx"),
    read("../src/features/message/ActionCardBlock.tsx"),
    read("../electron/preload.cjs"),
    read("../electron/host/plugins/plugins-ipc.mts"),
    read("../electron/authoring-skills.ts"),
  ]);

  assert.match(pluginsPage, /SharePluginDialog/);
  assert.match(pluginsPage, /plugin-drop-overlay/);
  assert.match(detailPage, /onShare/);
  assert.match(addDialog, /inspectPluginSharePackage/);
  assert.match(addDialog, /importPluginSharePackage/);
  assert.match(shareDialog, /inspectPluginExport/);
  assert.match(shareDialog, /exportPluginPackage/);
  assert.match(actionCard, /SharePluginDialog/);
  assert.match(preload, /webUtils/);
  assert.match(preload, /getPathForFile/);
  assert.match(ipc, /plugins:export-package/);
  assert.match(ipc, /plugins:import-share-package/);
  assert.match(ipc, /plugins:update-metadata/);
  assert.match(skill, /action:\s*"export"/);
  assert.match(skill, /action:\s*"update"/);
  assert.match(preload, /updatePluginMetadata/);

  const [guidePage, appearanceDialog, pluginIcons, lanIpc, authoringTs, sidebarTs, shellTs, toolPanelTs] = await Promise.all([
    read("../src/PluginGuidePage.tsx"),
    read("../src/PluginAppearanceDialog.tsx"),
    read("../src/lib/pluginIcons.tsx"),
    read("../electron/host/plugins/lan-share-ipc.mts"),
    read("../electron/plugin-authoring.mts"),
    read("../src/app/Sidebar.tsx"),
    read("../src/app/ShellLayout.tsx"),
    read("../src/features/toolpanel/ToolPanel.tsx"),
  ]);
  assert.match(pluginsPage, /PluginAppearanceDialog/);
  assert.match(pluginsPage, /PluginGuidePage/);
  assert.match(guidePage, /plugin-guide-aurora/);
  assert.match(appearanceDialog, /updatePluginMetadata/);
  assert.match(pluginIcons, /PLUGIN_ICON_PRESETS/);
  assert.match(ipc, /resolvePluginCustomizationFromSettings/);
  assert.match(lanIpc, /resolvePluginCustomizationFromSettings/);
  assert.match(authoringTs, /resolvePluginCustomizationFromSettings/);
  assert.match(sidebarTs, /pluginBundleVisuals/);
  assert.match(shellTs, /pluginBundleVisuals/);
  assert.match(toolPanelTs, /pluginBundleVisuals/);
});

test("插件分享包导出与导入完整保留自定义名称、作者、图标与颜色", async (t) => {
  const root = await mkSandbox(t, "dyw-share-visual-");
  const senderDir = path.join(root, "sender");
  const receiverDir = path.join(root, "receiver");
  await fs.mkdir(senderDir, { recursive: true });
  await fs.mkdir(receiverDir, { recursive: true });

  const pluginDir = path.join(senderDir, "visual-plugin");
  await createSampleClientPlugin(pluginDir, "visual-plugin");
  const pkgJsonPath = path.join(pluginDir, "package.json");
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf8"));
  pkgJson.author = "原著作者";
  pkgJson.dyworker = { ...pkgJson.dyworker, displayName: "原名称" };
  await fs.writeFile(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`, "utf8");

  const host = await createHost({ userDataDir: senderDir, mountPlugins: true });
  t.after(async () => disposeHost(host));
  await executePluginManage(host, { action: "install", target: pluginDir }, { managedRoot: senderDir });

  const resolvedCustom = resolvePluginCustomizationFromSettings({
    pluginCustomizations: {
      "visual-plugin": {
        displayName: "财务月报看板",
        author: "财务信息化组",
        icon: "bar-chart-3",
        iconColor: "#7c3aed",
      },
    },
  }, ["visual-plugin"]);
  assert.deepEqual(resolvedCustom, {
    displayName: "财务月报看板",
    author: "财务信息化组",
    icon: "bar-chart-3",
    iconColor: "#7c3aed",
  });

  const inspectedExport = await inspectPluginForExport(host, {
    target: pluginDir,
    dataDir: senderDir,
    customization: resolvedCustom,
  });
  assert.equal(inspectedExport.ok, true, inspectedExport.error);
  assert.equal(inspectedExport.displayName, "财务月报看板");
  assert.equal(inspectedExport.author, "财务信息化组");
  assert.equal(inspectedExport.icon, "bar-chart-3");
  assert.equal(inspectedExport.iconColor, "#7c3aed");

  const shareFile = path.join(root, "visual-plugin.dyplugin");
  const exported = await exportPluginSharePackage(host, {
    target: pluginDir,
    outputPath: shareFile,
    dataDir: senderDir,
    customization: resolvedCustom,
  });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(exported.displayName, "财务月报看板");
  assert.equal(exported.author, "财务信息化组");
  assert.equal(exported.icon, "bar-chart-3");
  assert.equal(exported.iconColor, "#7c3aed");

  const sharePreview = await inspectSharePackage({
    filePath: shareFile,
    dataDir: receiverDir,
  });
  assert.equal(sharePreview.ok, true, sharePreview.error);
  assert.equal(sharePreview.displayName, "财务月报看板");
  assert.equal(sharePreview.author, "财务信息化组");
  assert.equal(sharePreview.icon, "bar-chart-3");
  assert.equal(sharePreview.iconColor, "#7c3aed");

  const unpacked = await unpackSharePackageToManagedDir({
    filePath: shareFile,
    dataDir: receiverDir,
  });
  assert.equal(unpacked.ok, true, unpacked.error);
  const unpackedPkg = JSON.parse(await fs.readFile(path.join(unpacked.pluginDir, "package.json"), "utf8"));
  assert.equal(unpackedPkg.author, "财务信息化组");
  assert.equal(unpackedPkg.dyworker?.displayName, "财务月报看板");
  assert.equal(unpackedPkg.dyworker?.icon, "bar-chart-3");
  assert.equal(unpackedPkg.dyworker?.iconColor, "#7c3aed");

  const receiverHost = await createHost({ userDataDir: receiverDir, mountPlugins: true });
  t.after(async () => disposeHost(receiverHost));
  const installed = await receiverHost.plugins.installPackage({
    input: unpacked.pluginDir,
    allowIncompatible: false,
    npmPath: "/fake/npm",
    run: async (_cmd, args) => {
      if (args[0] === "install") {
        const prefixDir = args[args.indexOf("--prefix") + 1];
        const destDir = path.join(prefixDir, "node_modules", "visual-plugin");
        await fs.mkdir(path.dirname(destDir), { recursive: true });
        await fs.cp(unpacked.pluginDir, destDir, { recursive: true, force: true });
      }
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  const installedBundle = receiverHost.plugins.bundles_().find((item) => item.packageName === "visual-plugin");
  assert.equal(installedBundle?.displayName, "财务月报看板");
  assert.equal(installedBundle?.author, "财务信息化组");
  assert.equal(installedBundle?.icon, "bar-chart-3");
  assert.equal(installedBundle?.iconColor, "#7c3aed");
});

test("原生 DYWorker 插件使用 tools 等宿主服务时导出与严格导入均可成功启用", async (t) => {
  const root = await mkSandbox(t, "dyw-share-native-tools-");
  const senderDir = path.join(root, "sender");
  const receiverDir = path.join(root, "receiver");
  await fs.mkdir(senderDir, { recursive: true });
  await fs.mkdir(receiverDir, { recursive: true });

  const pkgName = "weekly-report-dashboard";
  const pluginDir = path.join(senderDir, pkgName);
  await createSampleClientPlugin(pluginDir, pkgName, {
    version: "0.2.1",
    indexJs: [
      `export const name = ${JSON.stringify(pkgName)};`,
      `export const inject = ["storage", "connection", "tools", "scheduler"];`,
      `export function apply(ctx) {`,
      `  globalThis.__nativeWeeklyApplied = Boolean(ctx.tools);`,
      `}`,
    ].join("\n"),
  });

  const pkgManifest = JSON.parse(await fs.readFile(path.join(pluginDir, "package.json"), "utf8"));
  const profilePkgPath = path.join(senderDir, "profile", "package.json");
  await fs.mkdir(path.dirname(profilePkgPath), { recursive: true });
  await fs.writeFile(profilePkgPath, "{}\n", "utf8");
  const directAnalysis = await analyzePlugin(profilePkgPath, pkgName, pkgManifest, pluginDir);
  assert.equal(directAnalysis.verdict, "runnable", directAnalysis.reasons.join("；"));
  const toolsStatus = directAnalysis.services.find((item) => item.name === "tools");
  assert.equal(toolsStatus?.state, "fulfilled");

  const senderHost = await createHost({ userDataDir: senderDir, mountPlugins: true });
  const receiverHost = await createHost({ userDataDir: receiverDir, mountPlugins: true });
  t.after(async () => {
    await disposeHost(senderHost);
    await disposeHost(receiverHost);
  });

  await executePluginManage(senderHost, { action: "install", target: pluginDir }, { managedRoot: senderDir });
  const shareFile = path.join(root, `${pkgName}.dyplugin`);
  const exported = await exportPluginSharePackage(senderHost, {
    target: pluginDir,
    outputPath: shareFile,
    dataDir: senderDir,
  });
  assert.equal(exported.ok, true, exported.error);

  const unpacked = await unpackSharePackageToManagedDir({
    filePath: shareFile,
    dataDir: receiverDir,
  });
  assert.equal(unpacked.ok, true, unpacked.error);

  const installed = await receiverHost.plugins.installPackage({
    input: unpacked.pluginDir,
    allowIncompatible: false,
    npmPath: "/fake/npm",
    run: async (_cmd, args) => {
      if (args[0] === "install") {
        const prefixDir = args[args.indexOf("--prefix") + 1];
        const destDir = path.join(prefixDir, "node_modules", pkgName);
        await fs.mkdir(path.dirname(destDir), { recursive: true });
        await fs.cp(unpacked.pluginDir, destDir, { recursive: true, force: true });
      }
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(installed.analysis?.verdict, "runnable");
  const receiverPlugin = receiverHost.plugins.entries().find((item) => item.name === pkgName);
  assert.equal(receiverPlugin?.active, true);
  assert.equal(globalThis.__nativeWeeklyApplied, true);
});
