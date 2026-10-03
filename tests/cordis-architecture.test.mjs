// Cordis 架构成立性验收：判定「真的是 cordis 架构」而不是「import 了 cordis」。
// 不看 import 语句，只看运行期语义——这些性质对手写的 getter/单例做不到：
//   1) 宿主是容器：多个宿主并存且状态互不串（模块级单例必然串）
//   2) 服务是 cordis 服务：经 ctx.get / ctx.<name> 取用，dispose 后摘除
//   3) 插件 fiber 级隔离：单独 dispose 一个插件，只撤掉它提供的服务与监听器
//   4) inject 依赖门控：依赖未就绪不 apply，就绪后自动 apply
//   5) 清理逆序发起，且异步停机被 await（不是 fire-and-forget）
//
// 注意 cordis 的 apply 是「下一个 tick 才执行」的（见下面 settle()）：刚 plugin()
// 完立刻断言会看不到服务/监听器；这也正是 main.mts 的 registerService 回调虽然
// 延迟执行、却仍在顶层 await 期间跑到、从而触发 TDZ 的原因。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { channelsPlugin, telemetryPlugin, backgroundTasksPlugin } from "../electron/host/services/runtime-domains.mts";

// cordis 的 plugin apply 在后续 tick 执行；等它落地后再断言/清理，
// 否则 fiber 树尚未稳定，清理顺序也不具备「逆序」的确定性。
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8").toString("base64"),
    decryptString: (buffer) => Buffer.from(buffer).toString("utf8").slice(4),
  };
}

async function makeTmpDir(t, tag) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `dyworker-cordis-${tag}-`));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

test("宿主机是容器而非模块单例：两个宿主并存且状态互不串", async (t) => {
  const a = await createHost({ userDataDir: await makeTmpDir(t, "a"), safeStorage: fakeSafeStorage() });
  const b = await createHost({ userDataDir: await makeTmpDir(t, "b"), safeStorage: fakeSafeStorage() });
  try {
    // 若是模块级单例，两次 createHost 会拿到同一个对象
    assert.notEqual(a.get("settings"), b.get("settings"));
    assert.notEqual(a.get("sessions"), b.get("sessions"));
    await a.settings.write({ endpoint: "https://a.example.com", model: "m", apiKey: "key-a" });
    await b.settings.write({ endpoint: "https://b.example.com", model: "m", apiKey: "key-b" });
    const [ra, rb] = [await a.settings.read(), await b.settings.read()];
    assert.equal(ra.apiKey, "key-a");
    assert.equal(rb.apiKey, "key-b");
    assert.equal(ra.endpoint, "https://a.example.com");
    assert.equal(rb.endpoint, "https://b.example.com");
  } finally {
    await disposeHost(a);
    await disposeHost(b);
  }
});

test("服务是 cordis 服务：ctx 可取用，dispose 后摘除", async (t) => {
  const ctx = await createHost({ userDataDir: await makeTmpDir(t, "svc"), safeStorage: fakeSafeStorage() });
  for (const name of ["audit", "settings", "sessions", "agent"]) {
    assert.ok(ctx.get(name), `${name} 应挂载在容器里`);
    assert.equal(ctx.get(name).name, name, "Service 名应与注册名一致");
  }
  await disposeHost(ctx);
  for (const name of ["audit", "settings", "sessions", "agent"]) {
    assert.equal(ctx.get(name), undefined, `${name} 应随宿主 dispose 摘除`);
  }
});

test("插件 fiber 级隔离：单独 dispose 一个插件只撤掉它自己的贡献", async (t) => {
  const ctx = await createHost({ userDataDir: await makeTmpDir(t, "fiber"), safeStorage: fakeSafeStorage() });
  try {
    let hits = 0;
    const fiber = ctx.plugin({
      name: "probe-plugin",
      apply(c) {
        // 插件内提供的服务与注册的监听器都应挂在插件 fiber 的作用域上
        c.provide("probeSvc", { hit: () => ++hits });
        c.on("tools/pre-execute", () => ({ action: "block", message: "probe" }));
      },
    });
    await settle();

    assert.equal(typeof ctx.get("probeSvc")?.hit, "function", "插件提供的服务应可见");
    const blocked = await ctx.waterfall("tools/pre-execute", "any_tool", {}, null, () => null);
    assert.equal(blocked?.action, "block", "插件注册的监听器应参与分发");

    await fiber.dispose();

    // cordis 的 effect 作用域：服务与监听器同时撤销
    assert.equal(ctx.get("probeSvc"), undefined, "插件服务应随 fiber 撤销");
    const after = await ctx.waterfall("tools/pre-execute", "any_tool", {}, null, () => null);
    assert.equal(after, null, "插件监听器应随 fiber 撤销");
    // 只撤这一个插件，宿主其余服务不受影响
    assert.equal(typeof ctx.audit.record, "function");
    assert.ok(ctx.get("settings"), "其它服务应保留");
  } finally {
    await disposeHost(ctx);
  }
});

test("inject 依赖门控：依赖未就绪不 apply，就绪后自动 apply", async () => {
  const ctx = new Context();
  await ctx.fiber.await();
  try {
    let applied = 0;
    ctx.plugin({ name: "gated", inject: ["laterSvc"], apply() { applied += 1; } });
    await settle();
    assert.equal(applied, 0, "依赖缺失时插件不应 apply");
    ctx.provide("laterSvc", {});
    await settle();
    assert.equal(applied, 1, "依赖就绪后插件应自动 apply");
  } finally {
    await ctx.fiber.dispose();
  }
});

test("清理逆序发起，且 disposeHost 会 await 异步停机", async (t) => {
  const order = [];
  const ctx = await createHost({
    userDataDir: await makeTmpDir(t, "dispose"),
    safeStorage: fakeSafeStorage(),
    // 挂载序 channels → telemetry → backgroundTasks，清理应逆序。
    // 工厂由插件在 apply 时调用（创建归插件），这里传 thunk。
    registerService: (hostCtx) => {
      hostCtx.plugin(channelsPlugin(() => ({
        stopAll: async () => { order.push("channels:start"); await new Promise((r) => setTimeout(r, 40)); order.push("channels:done"); },
      })));
      hostCtx.plugin(telemetryPlugin(() => ({ shutdown: async () => { order.push("telemetry"); } })));
      hostCtx.plugin(backgroundTasksPlugin(() => ({ cleanupAll: () => { order.push("backgroundTasks"); } })));
    },
  });
  await settle();
  await disposeHost(ctx);

  assert.equal(order[0], "backgroundTasks", "逆序：最后注册的最先清理");
  assert.ok(order.indexOf("channels:start") > order.indexOf("backgroundTasks"));
  // 关键：disposeHost 解析时异步停机必须已经跑完（旧实现用 void 丢弃 promise，这里会漏掉 channels:done）
  assert.ok(order.includes("channels:done"), "disposeHost 必须 await 异步停机动作");
});

// —— 架构推进的三项不变量（防止回退成「三根柱子的混合形态」）—— 

test("不变量：运行期域由插件创建，main 不再持有模块级域对象", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
  const main = await read("../electron/main.mts");

  // 反面：这些模块级实例曾经是壳层手工创建、插件只包清理
  assert.doesNotMatch(main, /^let telemetryController = null;/m);
  assert.doesNotMatch(main, /^let remoteMessages = null;/m);
  assert.doesNotMatch(main, /^const channelManager = createChannelManager\(/m);
  // 仍然 import 工厂没问题，但不能再用模块级单例实例
  assert.doesNotMatch(main, /import \{[^}]*\bbackgroundTasksManager\b[^}]*\} from "\.\/background-tasks\.mts"/);
  // 正面：四个域都经插件（工厂）挂载，消费点走 ctx.<name>
  for (const call of [
    /ctx\.plugin\(channelsPlugin\(\(\) => createChannelManager\(/,
    /ctx\.plugin\(telemetryPlugin\(\(\) => createTelemetryController\(/,
    /ctx\.plugin\(remoteMessagesPlugin\(\(hostCtx\) => createRemoteMessagesManager\(/,
    /ctx\.plugin\(backgroundTasksPlugin\(\(\) => createBackgroundTasksManager\(\)\)\)/,
  ]) assert.match(main, call);
  assert.match(main, /ctx\.telemetryController\.start\(\)/);
});

test("不变量：IPC 插件用 inject 声明依赖，不再手工塞领域函数", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
  const rulesIpc = await read("../electron/host/plugins/rules-ipc.mts");
  const runtimeDomains = await read("../electron/host/services/runtime-domains.mts");
  assert.match(rulesIpc, /inject: \["rules"\]/);
  assert.match(runtimeDomains, /inject: \["telemetryController"\]/);
  // 领域函数不再作为 deps 传进 IPC 插件
  assert.doesNotMatch(rulesIpc, /readStandingRules|writeStandingRules|suggestStandingRule/);
});

test("不变量：tools/pre-execute 在生产装配里有真实消费者（不是空接缝）", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
  const main = await read("../electron/main.mts");
  const guard = await read("../electron/host/plugins/sensitive-path-guard.mts");
  // 壳层真的挂了这个策略插件
  assert.match(main, /ctx\.plugin\(sensitivePathGuardPlugin\(\)\)/);
  // 插件真的消费事件，且未命中时委托（返回 null 会截断整条策略链）
  assert.match(guard, /ctx\.on\("tools\/pre-execute"/);
  assert.match(guard, /if \(!hit\) return next\(\);/);
  assert.match(guard, /action: "block" \| "require_approval"/);
});

test("不变量：每个已拆出的 IPC 插件都真的被壳层挂载", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const main = await readFile(new URL("../electron/main.mts", import.meta.url), "utf8");
  const dir = new URL("../electron/host/plugins/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith("-ipc.mts"));
  assert.ok(files.length >= 5, `应已拆出多个 IPC 插件，实际 ${files.length}`);
  for (const file of files) {
    // foo-ipc.mts → fooIpcPlugin；必须在 main 里 ctx.plugin(fooIpcPlugin(
    const pluginName = file.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/\.mts$/, "Plugin");
    assert.match(main, new RegExp(`ctx\\.plugin\\(${pluginName}\\(`), `${file} 的插件 ${pluginName} 未在 main.mts 挂载`);
  }
});
