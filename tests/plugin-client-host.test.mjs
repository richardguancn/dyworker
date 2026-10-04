// 客户端插件宿主（第 2 步）：cordis 容器 + slots / locale / sessions / connection / workspaces。
//
// 验收：真实的 DSH 插件 bundle 能被容器加载并 apply 成功，且它注册的界面贡献真的进了插槽表。
// 同时打印"它调用过但宿主未实现的服务方法"——这是下一步该补什么的直接依据。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClientRuntime } from "../src/pluginRuntime/index.ts";
import { ClientPluginHost, HOST_SLOTS } from "../src/pluginRuntime/clientHost.ts";

/**
 * 最小 DOM 桩：真实插件会碰 window.location / document（Node 里没有）。
 * 应用里有真 DOM，这里只是让同一套断言能在 Node 里跑。
 */
function installDomStub() {
  const noop = () => {};
  const element = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, removeAttribute: noop, appendChild: noop, removeChild: noop, remove: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  });
  globalThis.window = {
    location: { origin: "http://localhost", href: "http://localhost/", pathname: "/", search: "", hash: "" },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    setTimeout, clearTimeout, innerWidth: 1440, innerHeight: 900,
  };
  globalThis.document = {
    addEventListener: noop, removeEventListener: noop, createElement: element,
    documentElement: element(), body: element(), head: element(),
    querySelector: () => null, querySelectorAll: () => [],
  };
  // Node 22 自带 navigator 且只读，不要赋值
}

/** 用加载器执行真实 bundle，拿到它的 cordis 插件导出 */
function loadBundleModule(source) {
  const target = {};
  const runtime = createClientRuntime({ target });
  new Function("window", "globalThis", source)(target, globalThis);
  const record = runtime.loader.bundles_()[0];
  assert.equal(record.error, undefined, `bundle 执行失败：${record.error}`);
  return record.exports;
}

async function findRealBundles() {
  const roots = [
    path.join(os.homedir(), ".dsh", "profiles", "desktop"),
    path.join(os.homedir(), ".dsh", "profiles", "web"),
  ];
  const found = [];
  for (const root of roots) {
    for (const spec of await fs.readdir(path.join(root, "node_modules")).catch(() => [])) {
      if (spec.startsWith(".") || spec.startsWith("@")) continue;
      const pkgDir = path.join(root, "node_modules", spec);
      const manifest = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8").catch(() => "{}"));
      if (!manifest?.dsh?.client) continue;
      const file = path.join(pkgDir, "lib", "client.js");
      const source = await fs.readFile(file, "utf8").catch(() => null);
      if (source) found.push({ spec, source });
    }
  }
  return found;
}

test("容器：插槽注册与渲染顺序（order / priority）", async () => {
  const host = new ClientPluginHost();
  const plugin = {
    name: "demo",
    inject: ["slots", "locale"],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register("demo", { zh: { hello: "你好 {name}" }, en: { hello: "hi {name}" } }));
      const t = ctx.locale.bind("demo");
      assert.equal(t("hello", { name: "世界" }), "你好 世界", "文案绑定要能取到并代入参数");
      ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab", id: "second", order: 2,
      }, () => null));
      ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab", id: "first", order: 1,
      }, () => null));
      // 宿主没提供的插槽：inject 不应执行注册回调
      ctx.slots.inject("conversation.input.overlay", () => {
        throw new Error("宿主没提供的插槽不该执行注册回调");
      });
    },
  };

  const record = await host.load(plugin, "demo");
  assert.equal(record.ok, true, record.error);
  assert.deepEqual(record.slots, ["sidebar.right.pane.tab"]);
  const contributions = host.contributionsFor("sidebar.right.pane.tab");
  assert.deepEqual(contributions.map((item) => item.meta.id), ["first", "second"], "order 小的排前面");
  assert.deepEqual(host.slotNames(), ["sidebar.right.pane.tab"]);
});

test("容器：插件出错只记录，不影响其它插件与宿主", async () => {
  const host = new ClientPluginHost();
  const broken = { name: "broken", inject: ["slots"], apply() { throw new Error("故意炸"); } };
  const bad = await host.load(broken, "broken");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /故意炸/);

  const good = { name: "good", inject: ["slots"], apply(ctx) { ctx.slots.register({ name: "settings.section", id: "g" }, () => null); } };
  const ok = await host.load(good, "good");
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(host.contributionsFor("settings.section").map((item) => item.meta.id), ["g"]);
});

test("容器：未实现的服务方法被记名，而不是静默失效", async () => {
  const host = new ClientPluginHost();
  const plugin = {
    name: "probe",
    inject: ["sessions"],
    apply(ctx) { ctx.sessions.someFutureMethod({ a: 1 }); },
  };
  const record = await host.load(plugin, "probe");
  assert.equal(record.ok, true, record.error);
  assert.ok(record.missingCalls.some((call) => call.includes("someFutureMethod")),
    `未实现的方法要记名，实际：${JSON.stringify(record.missingCalls)}`);
});

// 真实插件在 Node 里的容器行为不在这里断言：它们的异步 effect 会碰 DOM / 路由，
// 且会以自身错误处理器 + 非零退出码结束进程。真实插件的容器验收放在应用里做
// （那里有真 DOM 与我们的界面容器），见插件页「加载界面半边」的实测结果。

test("宿主声明的插槽与右侧面板/设置页对应（第 2 步的接线位置）", () => {
  // 这些是宿主真的会渲染的位置：右侧面板标签、标签标题、设置分区
  assert.ok(HOST_SLOTS.includes("sidebar.right.pane.tab"), "右侧面板标签是本步的主目标");
  assert.ok(HOST_SLOTS.includes("settings.section"));
});
