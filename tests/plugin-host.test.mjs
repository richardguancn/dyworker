// 插件宿主：从 profile（userData/plugins）动态装载 cordis 插件包，
// 支持 安装 / 启停 / 配置 / 移除 / 失败可见。
//
// 这套能力的目标是兼容 DSH 插件——用的就是 DSH 自己的 loader
// （@deepseek-ai/cordis-plugin-loader + plugin-include），插件树 dyworker.yml
// 与 dsh 的 cordis.yml 同方言。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-plugins-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

// 在 profile 的 node_modules 里铺一个真实插件包（bare specifier 解析路径）
async function writePluginPackage(profileDir, pkgName, body) {
  const pkgDir = path.join(profileDir, "node_modules", pkgName);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify({
    name: pkgName, version: "1.0.0", type: "module", main: "index.mjs",
    description: `${pkgName} 的说明文字`,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(pkgDir, "index.mjs"), body, "utf8");
  return pkgDir;
}

function pluginSource(name) {
  return `
export const name = ${JSON.stringify(name)};
export function apply(ctx, config) {
  globalThis.__pluginLog = globalThis.__pluginLog || [];
  globalThis.__pluginLog.push({ plugin: ${JSON.stringify(name)}, event: "apply", config: config ?? null });
  ctx.effect(() => () => {
    globalThis.__pluginLog.push({ plugin: ${JSON.stringify(name)}, event: "dispose" });
  });
}
export default { name: ${JSON.stringify(name)}, apply };
`;
}

async function withHost(t, extra = {}) {
  const dir = await tempDir(t);
  globalThis.__pluginLog = [];
  const ctx = await createHost({ userDataDir: dir, mountPlugins: true, ...extra });
  t.after(async () => { await disposeHost(ctx); });
  return { dir, ctx, profile: path.join(dir, "plugins") };
}

test("首次启动铺 profile：清单 + 空插件树", async (t) => {
  const { ctx, profile } = await withHost(t);
  const manifest = JSON.parse(await fs.readFile(path.join(profile, "package.json"), "utf8"));
  assert.equal(manifest.name, "dyworker-plugins");
  assert.equal(manifest.private, true);
  const tree = await fs.readFile(path.join(profile, "dyworker.yml"), "utf8");
  assert.match(tree, /\[\]/, "初始树为空数组");
  assert.equal(ctx.plugins.status().mounted, true);
  assert.deepEqual(ctx.plugins.entries(), []);
  // 结构对齐 DSH profile：同一目录既是 npm prefix 也是 pnpm workspace 根
  const workspace = await fs.readFile(path.join(profile, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /packages:/);
  assert.match(workspace, /nodeLinker: hoisted/);
});

test("安装插件包：bare specifier 从 profile 解析，apply 带 config 生效", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));

  const result = await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello", config: { greeting: "hi" } });
  assert.equal(result.ok, true, result.error || "");

  const applied = globalThis.__pluginLog.filter((e) => e.event === "apply");
  assert.equal(applied.length, 1, "插件应被 apply 一次");
  assert.deepEqual(applied[0].config, { greeting: "hi" }, "config 应透传给插件");

  const entries = ctx.plugins.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "hello");
  assert.equal(entries[0].active, true);
});

test("停用释放资源、重新启用再次 apply（不重复注册）", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
  await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello" });
  const count = (event) => globalThis.__pluginLog.filter((e) => e.event === event).length;
  assert.equal(count("apply"), 1);

  assert.equal((await ctx.plugins.setEnabled("hello", false)).ok, true);
  assert.equal(count("dispose"), 1, "停用应触发资源释放");
  assert.equal(ctx.plugins.entries()[0].active, false);

  assert.equal((await ctx.plugins.setEnabled("hello", true)).ok, true);
  assert.equal(count("apply"), 2, "重新启用应再 apply 一次");
  assert.equal(count("dispose"), 1);
});

test("插件树写回文件：重启后条目还在（启用状态保持）", async (t) => {
  const dir = await tempDir(t);
  globalThis.__pluginLog = [];
  const profile = path.join(dir, "plugins");
  {
    const ctx = await createHost({ userDataDir: dir, mountPlugins: true });
    await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
    await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello", config: { n: 1 } });
    await ctx.plugins.setEnabled("hello", false);
    await disposeHost(ctx);
  }
  const tree = await fs.readFile(path.join(profile, "dyworker.yml"), "utf8");
  assert.match(tree, /hello/, "条目应写回树文件");
  assert.match(tree, /disabled:\s*true/, "停用状态应写回");

  // 重启：条目仍在，且仍是停用状态
  globalThis.__pluginLog = [];
  const ctx2 = await createHost({ userDataDir: dir, mountPlugins: true });
  t.after(async () => { await disposeHost(ctx2); });
  const entries = ctx2.plugins.entries();
  assert.equal(entries.length, 1, "重启后条目还在");
  assert.equal(entries[0].id, "hello");
  assert.equal(entries[0].disabled, true, "停用状态被保持");
  assert.equal(globalThis.__pluginLog.filter((e) => e.event === "apply").length, 0, "停用的插件不应 apply");
});

test("移除插件：条目消失、资源释放、树文件更新", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
  await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello" });
  assert.equal((await ctx.plugins.remove("hello")).ok, true);
  assert.equal(globalThis.__pluginLog.filter((e) => e.event === "dispose").length, 1, "移除应释放资源");
  assert.equal(ctx.plugins.entries().length, 0);
  assert.doesNotMatch(await fs.readFile(path.join(profile, "dyworker.yml"), "utf8"), /hello/);
});

test("配置更新透传给已装载插件", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
  await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello", config: { v: 1 } });
  assert.equal((await ctx.plugins.configure("hello", { v: 2 })).ok, true);
  const applies = globalThis.__pluginLog.filter((e) => e.event === "apply");
  assert.deepEqual(applies[applies.length - 1].config, { v: 2 }, "最后一次 apply 应拿到新配置");
});

test("插件加载失败不影响宿主，失败原因可查", async (t) => {
  const { ctx, profile } = await withHost(t);
  const result = await ctx.plugins.add({ id: "missing", name: "dyworker-plugin-does-not-exist" });
  assert.equal(result.ok, false, "解析不到的插件应报失败");
  assert.match(String(result.error), /does-not-exist|Cannot find|ERR_MODULE/, `失败原因应可读：${result.error}`);

  // 宿主仍然可用：再装一个好插件照样成功
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
  assert.equal((await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello" })).ok, true);
  assert.equal(globalThis.__pluginLog.filter((e) => e.event === "apply").length, 1);
});

test("缺 id / name 时拒绝新增", async (t) => {
  const { ctx } = await withHost(t);
  await assert.rejects(() => ctx.plugins.add({ id: "", name: "x" }), /缺少 id/);
  await assert.rejects(() => ctx.plugins.add({ id: "x", name: "" }), /缺少 name/);
});

test("不共用 ~/.dsh：profile 目录独立、不读写 DSH 的启用状态", async (t) => {
  const { ctx, profile } = await withHost(t);
  assert.ok(profile.includes(path.join("dyworker-plugins-")), "profile 在传入目录下");
  assert.equal(ctx.plugins.status().dir, profile);
  // 树文件名刻意不叫 cordis.yml，避免被 DSH 工装误读写
  assert.match(path.basename(ctx.plugins.status().tree), /^dyworker\.yml$/);
});

// ---- bundle 层：安装一个"DSH 风格"的插件包（package.json 里 dsh.bundle.patch）----

// 造一个带 bundle patch 的包，声明方式与 dsh-context 完全一致
async function writeBundlePackage(profileDir, pkgName, { patch, extra = {} } = {}) {
  const pkgDir = path.join(profileDir, "node_modules", pkgName);
  await fs.mkdir(pkgDir, { recursive: true });
  const manifest = {
    name: pkgName,
    version: "0.9.9",
    type: "module",
    main: "index.mjs",
    ...extra,
  };
  if (patch !== null) {
    await fs.writeFile(path.join(pkgDir, "cordis.patch.yml"), patch, "utf8");
    // 与 extra.dsh 合并，不能整体覆盖（否则 dsh.client 之类的声明会丢）
    manifest.dsh = { ...(manifest.dsh || {}), ...(extra.dsh || {}), bundle: { patch: "./cordis.patch.yml" } };
  }
  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(pkgDir, "index.mjs"), pluginSource(pkgName), "utf8");
  return pkgDir;
}

test("安装 DSH 风格插件包：读 dsh.bundle.patch，条目上树且插件启动", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeBundlePackage(profile, "dsh-demo-plugin", {
    patch: `- insert:\n    - id: demo\n      name: dsh-demo-plugin\n      config:\n        fromBundle: true\n`,
  });

  const result = await ctx.plugins.install({ spec: "dsh-demo-plugin" });
  assert.equal(result.ok, true, JSON.stringify(result));

  const entries = ctx.plugins.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "demo");
  assert.equal(entries[0].active, true, "bundle 声明的条目应真的启动");
  const applies = globalThis.__pluginLog.filter((e) => e.event === "apply");
  assert.equal(applies.length, 1);
  assert.deepEqual(applies[0].config, { fromBundle: true }, "bundle 里写的 config 应生效");
});

test("bundle 条目只存在于合成结果，不写进用户层 dyworker.yml", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeBundlePackage(profile, "dsh-demo-plugin", { patch: `- insert:\n    - id: demo\n      name: dsh-demo-plugin\n` });
  await ctx.plugins.install({ spec: "dsh-demo-plugin" });

  const userLayer = await fs.readFile(path.join(profile, "dyworker.yml"), "utf8");
  assert.doesNotMatch(userLayer, /dsh-demo-plugin/, "bundle 条目不应写进用户层");
  // 但记录在 bundle 清单里，重启才能复现
  const bundles = JSON.parse(await fs.readFile(path.join(profile, "dyworker.bundles.json"), "utf8"));
  assert.equal(bundles.bundles.length, 1);
  assert.equal(bundles.bundles[0].name, "dsh-demo-plugin");
  assert.equal(bundles.bundles[0].declared, true);
  assert.equal(ctx.plugins.bundles_()[0].name, "dsh-demo-plugin");
});

test("bundles 记录持久化：重启后 bundle 条目自动重建", async (t) => {
  const dir = await tempDir(t);
  const profile = path.join(dir, "plugins");
  globalThis.__pluginLog = [];
  {
    const ctx = await createHost({ userDataDir: dir, mountPlugins: true });
    await writeBundlePackage(profile, "dsh-demo-plugin", { patch: `- insert:\n    - id: demo\n      name: dsh-demo-plugin\n` });
    await ctx.plugins.install({ spec: "dsh-demo-plugin" });
    await disposeHost(ctx);
  }
  globalThis.__pluginLog = [];
  const ctx2 = await createHost({ userDataDir: dir, mountPlugins: true });
  t.after(async () => { await disposeHost(ctx2); });
  const entries = ctx2.plugins.entries();
  assert.equal(entries.length, 1, "重启后 bundle 条目应自动重建");
  assert.equal(entries[0].active, true);
  assert.equal(globalThis.__pluginLog.filter((e) => e.event === "apply").length, 1, "重启后插件应重新启动");
});

test("bundle patch 可以改用户层已有条目（dsh patch 语义：disable/config）", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
  await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello" });
  assert.equal(globalThis.__pluginLog.filter((e) => e.event === "apply").length, 1);

  // 一个 bundle patch 把已有条目停用并改配置
  await writeBundlePackage(profile, "dsh-tuner", {
    patch: `- id: hello\n  disabled: true\n  config:\n    tuned: true\n`,
  });
  await ctx.plugins.install({ spec: "dsh-tuner" });

  const hello = ctx.plugins.entries().find((row) => row.id === "hello");
  assert.equal(hello.disabled, true, "bundle patch 应能停用用户层条目");
  assert.deepEqual(hello.config, { tuned: true }, "bundle patch 应能改用户层条目的配置");
  assert.equal(globalThis.__pluginLog.filter((e) => e.event === "dispose").length, 1, "被停用的条目应释放资源");
});

test("卸载 bundle：条目与资源一起撤掉，用户层条目恢复", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
  await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello" });

  await writeBundlePackage(profile, "dsh-tuner", { patch: `- id: hello\n  disabled: true\n` });
  await ctx.plugins.install({ spec: "dsh-tuner" });
  assert.equal(ctx.plugins.entries().find((row) => row.id === "hello").disabled, true);

  const out = await ctx.plugins.uninstall({ spec: "dsh-tuner" });
  assert.equal(out.removed, true);
  const hello = ctx.plugins.entries().find((row) => row.id === "hello");
  assert.equal(hello.disabled, false, "卸载后用户层条目应恢复启用");
  assert.equal(hello.active, true);
  assert.equal(ctx.plugins.bundles_().length, 0);
});

test("没有 bundle patch 的普通插件包：退化成单条目安装", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeBundlePackage(profile, "dyworker-plugin-plain", { patch: null });
  const result = await ctx.plugins.install({ spec: "dyworker-plugin-plain" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const entries = ctx.plugins.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "dyworker-plugin-plain");
  assert.equal(entries[0].active, true);
  assert.equal(ctx.plugins.bundles_()[0].declared, false);
});

test("安装不存在的包：明确失败且不改动现有条目", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "dyworker-plugin-hello", pluginSource("hello"));
  await ctx.plugins.add({ id: "hello", name: "dyworker-plugin-hello" });
  await assert.rejects(() => ctx.plugins.install({ spec: "no-such-plugin-xyz" }), /找不到|未安装/);
  assert.deepEqual(ctx.plugins.entries().map((row) => row.id), ["hello"], "失败的安装不应影响已有条目");
});

test("bundle 的 patch 引用不存在的条目：告警跳过，不炸整个安装", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeBundlePackage(profile, "dsh-demo-plugin", {
    patch: `- id: not-there\n  disabled: true\n- insert:\n    - id: demo\n      name: dsh-demo-plugin\n`,
  });
  const result = await ctx.plugins.install({ spec: "dsh-demo-plugin" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(ctx.plugins.entries().map((row) => row.id), ["demo"]);
  assert.ok(ctx.plugins.patchWarnings.some((line) => line.includes("not-there")), `应记录未命中告警：${ctx.plugins.patchWarnings}`);
});

// ---- DSH 兼容层：装之前就判清"能不能真跑起来" ----

async function writeCompatPackage(profileDir, pkgName, { source, manifestExtra = {}, deps = {} } = {}) {
  const pkgDir = path.join(profileDir, "node_modules", pkgName);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify({
    name: pkgName, version: "1.0.0", type: "module", main: "index.mjs",
    ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    ...manifestExtra,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(pkgDir, "index.mjs"), source, "utf8");
  return pkgDir;
}

test("兼容性：无依赖无 inject 的普通插件 → runnable 且可安装", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeCompatPackage(profile, "plain-plugin", { source: pluginSource("plain") });
  const analysis = await ctx.plugins.compatibility({ spec: "plain-plugin" });
  assert.equal(analysis.verdict, "runnable", analysis.reasons.join("；"));
  const result = await ctx.plugins.install({ spec: "plain-plugin" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verdict, "runnable");
});

test("兼容性：依赖 DSH 才有的服务 → unsupported（inject 永不满足）", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeCompatPackage(profile, "needs-tools", {
    source: `export const inject = ["tools", "llm"];\nexport function apply() {}\nexport default { name: "needs-tools", inject, apply };`,
  });
  const analysis = await ctx.plugins.compatibility({ spec: "needs-tools" });
  assert.equal(analysis.verdict, "unsupported");
  // llm 是 DSH 独有、本宿主完全没有 → 出现在"未提供"那行；
  // tools 是同名但语义不同 → 出现在"语义不同"那行（它不会阻止 apply，但仍要如实告知）
  assert.ok(analysis.reasons.some((line) => line.includes("llm")), analysis.reasons.join("；"));
  assert.ok(analysis.reasons.some((line) => line.includes("tools")), analysis.reasons.join("；"));

  const result = await ctx.plugins.install({ spec: "needs-tools" });
  assert.equal(result.ok, false);
  assert.equal(result.incompatible, true, "应明确标记不兼容");
  assert.match(result.error, /不兼容/);
  assert.equal(ctx.plugins.entries().length, 0, "不兼容的包不应进入插件树");
});

test("兼容性：同名但语义不同的服务 → partial（能装但会踩语义差异）", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeCompatPackage(profile, "needs-skills", {
    source: `export const inject = ["skills"];\nexport function apply() {}\nexport default { name: "needs-skills", inject, apply };`,
  });
  const analysis = await ctx.plugins.compatibility({ spec: "needs-skills" });
  assert.equal(analysis.verdict, "partial");
  assert.ok(analysis.reasons.some((line) => line.includes("语义")), analysis.reasons.join("；"));
  // partial 默认拒绝（避免"装上了按 DSH API 调用失败"），显式放行才装
  const denied = await ctx.plugins.install({ spec: "needs-skills" });
  assert.equal(denied.ok, false);
  const allowed = await ctx.plugins.install({ spec: "needs-skills", allowIncompatible: true });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
});

test("兼容性：缺 @deepseek-ai/* 依赖包 → unsupported 并列出缺哪些", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeCompatPackage(profile, "needs-dsh-llm", {
    source: `import "@deepseek-ai/dsh-llm";\nexport function apply() {}\nexport default { name: "needs-dsh-llm", apply };`,
    deps: { "@deepseek-ai/dsh-llm": "^0.1.3" },
  });
  const analysis = await ctx.plugins.compatibility({ spec: "needs-dsh-llm" });
  assert.equal(analysis.verdict, "unsupported");
  assert.deepEqual(analysis.missingPackages, ["@deepseek-ai/dsh-llm"]);
  assert.ok(analysis.hostHalf.importError, "主入口 import 失败要能报出来");
});

test("兼容性：含浏览器半边（dsh.client）→ unsupported 并说明原因", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeCompatPackage(profile, "has-client", {
    source: `export function apply() {}\nexport default { name: "has-client", apply };`,
    manifestExtra: { dsh: { client: { platform: "web", inject: ["@deepseek-ai/dsh-client-ui-settings"] } } },
  });
  const analysis = await ctx.plugins.compatibility({ spec: "has-client" });
  assert.equal(analysis.verdict, "unsupported");
  assert.equal(analysis.clientHalf.platform, "web");
  assert.match(analysis.reasons.join("；"), /浏览器半边/);
  assert.match(analysis.matrix, /has-client/);
});

test("兼容性：运行时 ctx.inject([...]) 的依赖也能扫出来", async (t) => {
  const { ctx, profile } = await withHost(t);
  const pkgDir = await writeCompatPackage(profile, "runtime-inject", {
    source: `export function apply(ctx) { ctx.inject(["sessionProjections"], () => {}); }\nexport default { name: "runtime-inject", apply };`,
  });
  // 扫的是 lib/ 下的产物，把它也放一份
  await fs.mkdir(path.join(pkgDir, "lib"), { recursive: true });
  await fs.copyFile(path.join(pkgDir, "index.mjs"), path.join(pkgDir, "lib", "index.js"));
  const analysis = await ctx.plugins.compatibility({ spec: "runtime-inject" });
  assert.ok(analysis.hostHalf.hints.includes("sessionProjections"), `应扫到运行时注入：${analysis.hostHalf.hints}`);
  assert.equal(analysis.verdict, "unsupported", "sessionProjections 本宿主没有");
});

test("兼容性：真实 dsh-context 形态（bundle patch + client 半边）判定为 unsupported", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeBundlePackage(profile, "dsh-context-like", {
    patch: `- insert:\n    - id: dsh-context-like\n      name: dsh-context-like\n`,
    extra: {
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web", inject: ["@deepseek-ai/dsh-client-ui-settings"] },
      },
    },
  });
  const analysis = await ctx.plugins.compatibility({ spec: "dsh-context-like" });
  assert.equal(analysis.verdict, "unsupported");
  assert.ok(analysis.clientHalf, "应识别出浏览器半边");
  const result = await ctx.plugins.install({ spec: "dsh-context-like" });
  assert.equal(result.ok, false);
  assert.equal(result.incompatible, true);
  assert.match(result.matrix, /❌/);
});

test("兼容性：声明依赖解析不到但主入口能 import → 不算阻断（DSH 有内联依赖的情况）", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writeCompatPackage(profile, "inlined-dep", {
    source: `export function apply() {}\nexport default { name: "inlined-dep", apply };`,
    deps: { "@deepseek-ai/dsh-util-values": "^1.0.0" }, // 声明了但没装，主入口也不 import 它
  });
  const analysis = await ctx.plugins.compatibility({ spec: "inlined-dep" });
  assert.equal(analysis.hostHalf.importable, true);
  assert.deepEqual(analysis.missingPackages, ["@deepseek-ai/dsh-util-values"]);
  assert.equal(analysis.verdict, "runnable", analysis.reasons.join("；"));
  assert.match(analysis.reasons.join("；"), /可能已内联/);
  // 真缺依赖（主入口 import 失败）才阻断
  await writeCompatPackage(profile, "really-missing", {
    source: `import "@deepseek-ai/dsh-nope";\nexport function apply() {}\nexport default { name: "really-missing", apply };`,
    deps: { "@deepseek-ai/dsh-nope": "^1.0.0" },
  });
  const blocked = await ctx.plugins.compatibility({ spec: "really-missing" });
  assert.equal(blocked.verdict, "unsupported");
  assert.match(blocked.reasons.join("；"), /无法 import/);
});

test("条目带包描述：手工加进清单的条目也要能显示说明（用于插件页版式）", async (t) => {
  const { ctx, profile } = await withHost(t);
  await writePluginPackage(profile, "described-plugin", pluginSource("described-plugin"));
  await ctx.plugins.add({ id: "described", name: "described-plugin" });
  const entry = ctx.plugins.entries()[0];
  assert.equal(entry.description, "described-plugin 的说明文字", "描述应来自包清单 package.json");
});
