// 客户端插件运行时（第 1 步）：模块加载器 + primitives 门面。
//
// 验收标准不是"接口看起来对"，而是**真实的 DSH 插件 bundle 能被加载起来**：
// 取本机已装的 dsh-context 的 lib/client.js（618KB，预打包产物），在 Node 里执行它，
// 断言它通过 window.__ModuleLoader__.load 注册成功、factory 跑通、且没有请求到宿主没提供的模块。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClientRuntime, PRIMITIVES_MODULE } from "../src/pluginRuntime/index.ts";
import { resolveClientEntries } from "../electron/host/plugin-client.mts";
import { createPrimitives } from "../src/pluginRuntime/primitives.ts";

// 每个用例一个独立运行时：单例会被用例之间互相污染（第一版就是这么翻车的）
function freshRuntime() {
  const target = {};
  const runtime = createClientRuntime({ target });
  return { target, runtime };
}

test("加载器：DSH 形态的 bundle 能注册，factory 拿到 require 并返回模块导出", () => {
  const { target, runtime } = freshRuntime();
  assert.equal(typeof target.__ModuleLoader__.load, "function", "window.__ModuleLoader__.load 要挂上");

  target.__ModuleLoader__.load({
    id: "demo-plugin",
    factory: (require) => {
      const react = require("react");
      const primitives = require(PRIMITIVES_MODULE);
      return { name: "demo", hasReact: Boolean(react.createElement), hasButton: typeof primitives.Button === "function" };
    },
  });

  const record = runtime.loader.bundle("demo-plugin");
  assert.equal(record.error, undefined, `factory 不应报错：${record.error}`);
  assert.equal(record.exports.name, "demo");
  assert.equal(record.exports.hasReact, true, "react 要能解析到真包");
  assert.equal(record.exports.hasButton, true, "primitives 门面要提供 Button");
  assert.deepEqual(record.missing, [], "不应有缺失模块");
  assert.deepEqual(runtime.loader.listMissingModules(), []);
});

test("加载器：bundle 请求宿主没有的模块时记录缺口，且不因异常中断后续加载", () => {
  const { target, runtime } = freshRuntime();
  const bad = target.__ModuleLoader__.load({
    id: "needs-unknown",
    factory: (require) => {
      require("react");
      require("@deepseek-ai/dsh-client-ui-fancy-chart");
      return {};
    },
  });
  assert.match(bad.error, /fancy-chart/, "失败原因要点出缺哪个模块");
  assert.deepEqual(bad.missing, ["@deepseek-ai/dsh-client-ui-fancy-chart"]);

  // 关键：一次失败不能把加载器带坏，后面的插件还要能加载
  const good = target.__ModuleLoader__.load({ id: "after-failure", factory: (require) => ({ ok: Boolean(require("react")) }) });
  assert.equal(good.error, undefined);
  assert.equal(good.exports.ok, true);

  assert.deepEqual(runtime.loader.listMissingModules(), [
    { spec: "@deepseek-ai/dsh-client-ui-fancy-chart", count: 1 },
  ], "缺口清单要能告诉我们还差哪些模块");
});

test("门面：已探明的组件都在；未知导出给宽容占位并记名", () => {
  const unknown = [];
  const icons = [];
  const primitives = createPrimitives({
    onUnknownExport: (name) => unknown.push(name),
    onIconExport: (name) => icons.push(name),
  });

  for (const name of ["Button", "Input", "Menu", "Modal", "Tooltip", "StateDot", "MarkdownText"]) {
    assert.equal(typeof primitives[name], "function", `门面要实现 ${name}`);
  }
  assert.equal(typeof primitives.writeClipboard, "function");

  // 图标（实测两个插件共用到 20 个 IconXxxOutlineNN）→ 通用图标组件，且单独记名
  assert.equal(typeof primitives.IconBranchOutline16, "function");
  assert.deepEqual(icons, ["IconBranchOutline16"], "图标走单独的记录通道");

  // 未知组件：不能是 undefined（插件一渲染就崩），要能记录名字
  const stub = primitives.SomeFutureWidget;
  assert.equal(typeof stub, "function", "未知导出也要给占位组件");
  assert.deepEqual(unknown, ["SomeFutureWidget"], "未知组件要记名，供量兼容面（不含图标）");
  assert.equal("AnythingElse" in primitives, true, "`in` 判断不能把可用组件判成缺失");
});

test("门面：MarkdownText 委托宿主渲染器（并适配 content/text 两种传法），writeClipboard 走宿主", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = await import("react");
  let copied = "";
  // 宿主的渲染器只认 content；DSH 插件可能传 content 也可能传 text/children
  const HostMarkdown = (props) => React.createElement("div", { className: "host-md" }, props.content);
  const primitives = createPrimitives({
    MarkdownText: HostMarkdown,
    writeClipboard: (text) => { copied = text; },
  });

  for (const props of [{ content: "**加粗**" }, { text: "**加粗**" }, { children: "**加粗**" }]) {
    const html = renderToStaticMarkup(React.createElement(primitives.MarkdownText, props));
    assert.match(html, /host-md/, "要委托给宿主的 Markdown 渲染器");
    assert.match(html, /\*\*加粗\*\*/, "三种传法都要把内容递进去");
  }

  // 没有宿主渲染器时降级为纯文本，不能空白或崩
  const bare = createPrimitives({});
  const bareHtml = renderToStaticMarkup(React.createElement(bare.MarkdownText, { content: "纯文本降级" }));
  assert.match(bareHtml, /纯文本降级/);

  await primitives.writeClipboard("插件的复制内容");
  assert.equal(copied, "插件的复制内容");
});

test("客户端入口解析：两种 exports 写法与多 bundle 包都要认（且不能越出包目录）", () => {
  const pkgDir = "/plugins/demo";
  // ① 字符串写法（dsh-context）
  const one = resolveClientEntries({ exports: { "./client": "./lib/client.js" } }, pkgDir);
  assert.deepEqual(one.map((e) => [e.subpath, e.relative, e.primary]), [["./client", "lib/client.js", true]]);

  // ② 对象写法 + 多 bundle（dsh-better-sidebar 实测有 7 个客户端入口）
  const many = resolveClientEntries({
    exports: {
      ".": "./lib/index.js",
      "./client": { types: "./lib/types/client.d.ts", default: "./lib/client.js" },
      "./client/api": { default: "./lib/client-api.js" },
      "./client/editor": "./lib/client-editor.js",
    },
  }, pkgDir);
  assert.deepEqual(many.map((e) => e.subpath), ["./client", "./client/api", "./client/editor"],
    "主入口在最前，其余按子路径排序");
  assert.equal(many[0].primary, true);
  assert.ok(many.every((e) => e.subpath !== "."), "主机入口不应当作客户端 bundle");

  // ③ 目录穿越必须被拒
  const evil = resolveClientEntries({ exports: { "./client": "../../../etc/passwd" } }, pkgDir);
  assert.deepEqual(evil, [], "越出包目录的入口要丢掉");

  // ④ exports 缺失时回落到 dsh.client 声明
  const fallback = resolveClientEntries({ dsh: { client: { entry: "./lib/client.js", platform: "web" } } }, pkgDir);
  assert.deepEqual(fallback.map((e) => e.relative), ["lib/client.js"]);
});

test("真实 bundle：本机已装 DSH 插件的客户端 bundle 全都能被加载起来", async (t) => {
  // 逐个插件、逐个客户端入口，在 Node 里执行真实产物。这是第 1 步的验收依据：
  // 不是"接口看起来对"，而是第三方预打包产物能被加载器加载、factory 跑通、无缺失模块。
  const roots = [
    path.join(os.homedir(), ".dsh", "profiles", "desktop"),
    path.join(os.homedir(), ".dsh", "profiles", "web"),
    path.join(os.homedir(), ".dsh", "profiles"),
  ];
  const found = [];
  for (const root of roots) {
    for (const spec of await fs.readdir(path.join(root, "node_modules")).catch(() => [])) {
      if (spec.startsWith(".") || spec.startsWith("@")) continue;
      const pkgDir = path.join(root, "node_modules", spec);
      const manifest = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8").catch(() => "{}"));
      if (!manifest?.dsh?.client && !manifest?.dyworker?.client) continue;
      for (const entry of resolveClientEntries(manifest, pkgDir)) {
        if (!found.some((item) => item.file === entry.file)) found.push({ spec, version: manifest.version, ...entry });
      }
    }
  }

  if (!found.length) {
    t.skip("本机没有安装带客户端半边的 DSH 插件");
    return;
  }

  const loaded = [];
  for (const plugin of found) {
    const source = await fs.readFile(plugin.file, "utf8").catch(() => null);
    if (!source) continue;

    const { target, runtime } = freshRuntime();
    new Function("window", "globalThis", source)(target, globalThis);

    const records = runtime.loader.bundles_();
    assert.ok(records.length >= 1, `${plugin.spec} ${plugin.subpath} 应当注册自己`);
    for (const record of records) {
      assert.equal(record.error, undefined, `${plugin.spec} ${plugin.subpath} factory 应当跑通：${record.error}`);
      assert.deepEqual(record.missing, [], `${plugin.spec} ${plugin.subpath} 不应缺模块：${JSON.stringify(record.missing)}`);
      assert.ok(record.exports, `${plugin.spec} ${plugin.subpath} 要拿到模块导出`);
      // 兼容面钉死：除 react 家族外只允许依赖 primitives。
      // 一旦某个插件开始 require 别的运行时模块，这条断言会立刻指出来。
      const ext = [...new Set(record.requires)].filter((s) => !/^react(-dom)?(\/|$)/.test(s));
      assert.deepEqual(ext, ["@deepseek-ai/dsh-client-ui-primitives"],
        `${plugin.spec} ${plugin.subpath} 除 react 家族外只应依赖 primitives，实际：${JSON.stringify(ext)}`);
    }
    loaded.push(`${plugin.spec}${plugin.subpath === "./client" ? "" : plugin.subpath.slice(1)}`);
  }

  assert.ok(loaded.length >= 1, "至少要验收一个客户端 bundle");
  console.log(`  已验收 ${loaded.length} 个真实客户端 bundle：${loaded.join("、")}`);
});

test("客户端模块依赖图：依赖在前、循环安全、解析不到的如实记为缺失", async () => {
  const { orderClientModules } = await import("../electron/host/plugin-client.mts");
  // 模拟：插件要 ui-settings；ui-settings 要 api-remotes；api-remotes 无依赖
  const packages = {
    "@deepseek-ai/dsh-client-ui-settings": {
      dir: "/nm/settings",
      manifest: {
        name: "@deepseek-ai/dsh-client-ui-settings",
        exports: { "./client": { default: "./lib/client.js" } },
        dsh: { client: { inject: ["@deepseek-ai/dsh-api-remotes"], platform: "web" } },
      },
    },
    "@deepseek-ai/dsh-api-remotes": {
      dir: "/nm/remotes",
      manifest: {
        name: "@deepseek-ai/dsh-api-remotes",
        exports: { "./client": "./lib/client.js" },
        dsh: { client: { platform: "web" } },
      },
    },
    "@deepseek-ai/dsh-cyclic-a": {
      dir: "/nm/a",
      manifest: { name: "a", exports: { "./client": "./lib/client.js" }, dsh: { client: { inject: ["@deepseek-ai/dsh-cyclic-b"] } } },
    },
    "@deepseek-ai/dsh-cyclic-b": {
      dir: "/nm/b",
      manifest: { name: "b", exports: { "./client": "./lib/client.js" }, dsh: { client: { inject: ["@deepseek-ai/dsh-cyclic-a"] } } },
    },
  };
  const plan = orderClientModules(
    ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-not-installed", "@deepseek-ai/dsh-cyclic-a"],
    (spec) => packages[spec] || null,
  );

  assert.deepEqual(plan.ordered.map((node) => node.spec), [
    "@deepseek-ai/dsh-api-remotes",           // 依赖先加载
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-cyclic-b",              // 循环里的两个模块都要加载（不能死循环）
    "@deepseek-ai/dsh-cyclic-a",
  ]);
  // 每个模块只出现一次（循环不会重复入队）
  assert.equal(new Set(plan.ordered.map((node) => node.spec)).size, plan.ordered.length);
  assert.deepEqual(plan.missing, ["@deepseek-ai/dsh-not-installed"], "解析不到的模块要如实报出来");
  assert.equal(plan.ordered[0].file, "/nm/remotes/lib/client.js", "入口要解析成绝对路径");
});

test("客户端模块兼容层：缺失模块的导出齐备，未实现导出被记名而不是崩", async () => {
  const { createSlotsModuleShim, createRuntimeClientShim } = await import("../src/pluginRuntime/dshClientShims.ts");
  const unknown = [];
  const report = (module, name) => unknown.push(`${module}:${name}`);

  // 导出清单来自扫描本机 43 个 DSH 客户端模块的属性访问，不是猜的
  const slots = createSlotsModuleShim(report);
  assert.equal(typeof slots.resolveSlotLabel, "function");
  assert.equal(slots.resolveSlotLabel({ label: () => "上下文" }), "上下文");
  assert.equal(slots.resolveSlotLabel({ label: "标题" }), "标题");
  assert.equal(slots.resolveSlotLabel({ name: "x" }), "x");
  assert.ok(new slots.SlotOwnershipError("x") instanceof Error);
  assert.ok(new slots.StaleAuthorizationError("x") instanceof Error);

  const runtime = createRuntimeClientShim(report);
  for (const name of ["createSnapshotStore", "defineStore", "emptyAssistantBlock", "resolveWorkspacePath",
    "shallowEqual", "isAppendSurfaceEvent", "toAssistantBlocks", "isTokenDelta", "toAssistantBlock",
    "contextForm", "displayFailureMessage", "contextProvenance", "indexSubagentDescendants",
    "abbreviateHomePath", "conversationContextKey", "workspaceTitleOf", "sessionRecallLabels",
    "isReplacementSurfaceEvent", "DirectoryBrowseError"]) {
    assert.ok(runtime[name] !== undefined, `兼容层要提供 ${name}`);
  }
  // 状态原语是真实现：能存能取能订阅
  const store = runtime.defineStore({ count: 1 });
  assert.deepEqual(store.get(), { count: 1 });
  let seen = null;
  store.subscribe((value) => { seen = value; });
  store.set({ count: 2 });
  assert.deepEqual(seen, { count: 2 });
  assert.equal(runtime.shallowEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(runtime.shallowEqual({ a: 1 }, { a: 2 }), false);

  // 未实现的导出：不返回 undefined（插件一调就崩），而是记名 + 宽松函数
  const extra = runtime.someFutureHelper;
  assert.equal(typeof extra, "function");
  assert.ok(unknown.some((item) => item.includes("someFutureHelper")), "未实现导出要记名");
  assert.equal("anythingElse" in runtime, true);
});

test("模块加载顺序：DSH 客户端模块拿得到 slots / runtime 兼容层，不再报缺模块", async () => {
  const { createClientRuntime } = await import("../src/pluginRuntime/index.ts");
  const target = {};
  const runtime = createClientRuntime({ target });
  const result = target.__ModuleLoader__.load({
    id: "probe",
    factory: (require) => ({
      slots: typeof require("@deepseek-ai/dsh-client-ui-slots").resolveSlotLabel,
      store: typeof require("@deepseek-ai/dsh-client-runtime/client").defineStore,
    }),
  });
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.missing, [], "这两个模块不该再被记为缺失");
  assert.equal(result.exports.slots, "function");
  assert.equal(result.exports.store, "function");
});

test("插件 API 桥：只接管同源 /api/*，其余 fetch 原样透传，失败如实报错", async () => {
  const { installPluginApiBridge, isPluginApiPath } = await import("../src/pluginRuntime/apiBridge.ts");

  assert.equal(isPluginApiPath("/api/dsh-context/detail"), true);
  assert.equal(isPluginApiPath("/api"), true);
  assert.equal(isPluginApiPath("https://example.com/api/x"), false, "跨源 /api 不归我们管");
  assert.equal(isPluginApiPath("/apix"), false);
  assert.equal(isPluginApiPath("/assets/a.png"), false);

  const calls = [];
  const target = {
    fetch: async (input) => { calls.push(String(input)); return new Response("origin", { status: 200 }); },
    dyworker: {
      pluginApiFetch: async (payload) => {
        calls.push(payload);
        return { status: 200, body: JSON.stringify({ ok: true, value: null }), headers: { "content-type": "application/json" } };
      },
    },
  };
  const restore = installPluginApiBridge(target, target.dyworker);

  // ① 插件路由：走桥
  const response = await target.fetch("/api/dsh-context/detail", { method: "POST", body: "{}" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, value: null });
  assert.deepEqual(calls.at(-1), { path: "/api/dsh-context/detail", method: "POST", body: "{}" });

  // ② 其它请求：原样透传
  const passthrough = await target.fetch("/assets/logo.png");
  assert.equal(await passthrough.text(), "origin");

  // ③ 没有桥时如实报 502，而不是伪造成功
  const bare = { fetch: async () => new Response("x") };
  installPluginApiBridge(bare, {});
  const failed = await bare.fetch("/api/x");
  assert.equal(failed.status, 502);

  restore();
  assert.equal(await (await target.fetch("/assets/logo.png")).text(), "origin", "复原后不再拦截");
});
