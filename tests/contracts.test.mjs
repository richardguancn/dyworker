// 服务契约层：ctx.ipc / ctx.storage / ctx.window
//
// 这层是给插件（含 DSH 风格插件）用的**公开接口**：插件只 inject 契约服务，
// 而不是接收壳层内部的 deps 大包。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { auditIpcPlugin } from "../electron/host/plugins/audit-ipc.mts";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-contract-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

// 记录壳层收到的注册/注销，模拟 Electron 的 ipcMain 语义（重复注册即抛）
function fakeIpc() {
  const handlers = new Map();
  const log = [];
  return {
    handlers,
    log,
    register(channel, handler) {
      if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
      handlers.set(channel, handler);
      log.push(`register:${channel}`);
    },
    unregister(channel) {
      handlers.delete(channel);
      log.push(`unregister:${channel}`);
    },
  };
}

function fakeWindow(overrides = {}) {
  const win = {
    focused: false,
    shown: false,
    destroyed: false,
    isDestroyed: () => win.destroyed,
    isMinimized: () => false,
    show: () => { win.shown = true; },
    focus: () => { win.focused = true; },
    ...overrides,
  };
  return win;
}

async function hostWith(t, contracts) {
  const dir = await tempDir(t);
  const ctx = await createHost({ userDataDir: dir, mountPlugins: true, contracts });
  t.after(async () => { await disposeHost(ctx); });
  return { dir, ctx };
}

test("三个契约服务都已注册且可被插件 inject", async (t) => {
  const { ctx } = await hostWith(t, {});
  assert.ok(ctx.ipc, "ctx.ipc 应存在");
  assert.ok(ctx.storage, "ctx.storage 应存在");
  assert.ok(ctx.window, "ctx.window 应存在");
});

test("契约服务可被只 inject 契约的插件使用（不需要 deps 大包）", async (t) => {
  const ipc = fakeIpc();
  const { ctx } = await hostWith(t, { ipcRegister: ipc.register, ipcUnregister: ipc.unregister });

  const applied = [];
  // 一个"第三方插件"该有的样子：声明 inject，只碰契约
  const plugin = {
    name: "contract-demo",
    inject: ["ipc", "storage", "window"],
    apply(pluginCtx) {
      pluginCtx.effect(() => pluginCtx.ipc.handle("demo:ping", () => "pong"));
      applied.push(Object.keys(pluginCtx).includes("ipc"));
    },
  };
  ctx.plugin(plugin);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(applied.length, 1, "inject 满足后插件应被 apply");

  assert.ok(ipc.handlers.has("demo:ping"), "插件应能注册通道");
  assert.equal(await ipc.handlers.get("demo:ping")(), "pong");

  // 存储走插件数据根
  await ctx.storage.writeJson("demo/state.json", { n: 1 });
  assert.deepEqual(await ctx.storage.readJson("demo/state.json", null), { n: 1 });
  assert.equal(await ctx.storage.exists("demo/state.json"), true);
  assert.match(ctx.storage.file("demo/state.json"), /plugins[\\/]data[\\/]demo[\\/]state\.json$/);
});

test("插件卸载：注册的通道被注销，二次注册不撞崩", async (t) => {
  const ipc = fakeIpc();
  const { ctx } = await hostWith(t, { ipcRegister: ipc.register, ipcUnregister: ipc.unregister });

  const plugin = {
    name: "contract-toggle",
    inject: ["ipc"],
    apply(pluginCtx) {
      pluginCtx.effect(() => pluginCtx.ipc.handle("demo:toggle", () => 1));
    },
  };
  const fiber = ctx.plugin(plugin);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(ipc.handlers.has("demo:toggle"), "首次应注册成功");

  await fiber.dispose();
  assert.equal(ipc.handlers.has("demo:toggle"), false, "卸载必须注销通道，否则再启用会撞 second handler");

  // 再挂一次（等价于插件停用后重新启用）
  ctx.plugin(plugin);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(ipc.handlers.has("demo:toggle"), true, "重新启用应能再次注册");
  assert.deepEqual(ipc.log.filter((line) => line === "register:demo:toggle").length, 2);
});

test("同一插件重复注册同通道会明确报错（而不是被静默覆盖）", async (t) => {
  const ipc = fakeIpc();
  const { ctx } = await hostWith(t, { ipcRegister: ipc.register, ipcUnregister: ipc.unregister });
  ctx.ipc.handle("demo:dup", () => 1);
  assert.throws(() => ctx.ipc.handle("demo:dup", () => 2), /已注册/);
  assert.equal(ctx.ipc.registered().length, 1);
  ctx.ipc.unregisterChannel("demo:dup");
  assert.equal(ctx.ipc.registered().length, 0);
  assert.equal(ipc.handlers.has("demo:dup"), false);
});

test("storage 目录穿越被拒绝", async (t) => {
  const { dir, ctx } = await hostWith(t, {});
  assert.throws(() => ctx.storage.file("../../settings.json"), /越界/);
  assert.throws(() => ctx.storage.file("../outside.json"), /越界/);
  // 宿主既有数据目录内的绝对路径允许（迁移期插件显式读宿主文件）
  const hostFile = path.join(dir, "settings.json");
  assert.equal(ctx.storage.file(hostFile), hostFile);
  // 但宿主目录之外的绝对路径同样拒绝
  assert.throws(() => ctx.storage.file(path.join(dir, "..", "outside.json")), /越界/);
});

test("window 契约：主窗口实时读取（挂载后创建也能拿到）", async (t) => {
  const win = fakeWindow();
  let created = null;
  const { ctx } = await hostWith(t, { getMainWindow: () => created });

  assert.equal(ctx.window.current, null, "窗口未创建时应为 null，而不是崩");
  created = win; // 模拟插件挂载之后主窗口才创建
  assert.equal(ctx.window.current, win, "current 必须是调用期读取，不能是构造时快照");
  assert.equal(ctx.window.available, true);
  assert.equal(ctx.window.focus(), true);
  assert.equal(win.focused, true);
  assert.equal(win.shown, true);

  win.destroyed = true;
  assert.equal(ctx.window.available, false);
  assert.equal(ctx.window.focus(), false, "窗口销毁后 focus 应安全返回 false");
});

test("window 契约：未注入的能力给出明确错误而不是 undefined 调用", async (t) => {
  const { ctx } = await hostWith(t, {});
  assert.throws(() => ctx.window.dialog, /未注入 dialog/);
  assert.throws(() => ctx.window.shell, /未注入 shell/);
});

test("window 契约：广播只发给未销毁的 webContents", async (t) => {
  const sent = [];
  const live = { isDestroyed: () => false, send: (channel, payload) => sent.push([channel, payload]) };
  const dead = { isDestroyed: () => true, send: () => { throw new Error("不应发给已销毁的 webContents"); } };
  const { ctx } = await hostWith(t, { getWebContents: () => [live, dead, null] });
  assert.equal(ctx.window.broadcast("demo:event", { ok: true }), 1);
  assert.deepEqual(sent, [["demo:event", { ok: true }]]);
});

test("IPC 来源校验在契约层统一完成，插件绕不过", async (t) => {
  // 契约只暴露 register(channel, handler)；真正的来源校验由壳层注入的 register 实现，
  // 这里确认契约层不会把 handler 直接挂到 Electron 上（必须经 register 中转）。
  const calls = [];
  const { ctx } = await hostWith(t, { ipcRegister: (channel, handler) => calls.push({ channel, handler }), ipcUnregister: () => {} });
  ctx.ipc.handle("demo:guard", () => "x");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "demo:guard");
  assert.equal(typeof calls[0].handler, "function");
});

// 迁移样板的行为验证：源码断言看不出"打开的到底是哪个文件"，必须真调一次 handler。
test("迁移样板 audit-ipc：audit:open 打开的是审计服务自己的文件", async (t) => {
  const ipc = fakeIpc();
  const opened = [];
  const dir = await tempDir(t);
  const ctx = await createHost({
    userDataDir: dir,
    contracts: {
      ipcRegister: ipc.register,
      ipcUnregister: ipc.unregister,
      shell: { openPath: async (target) => { opened.push(target); return ""; } },
      dialog: {}, nativeImage: {}, nativeTheme: {},
    },
  });
  t.after(async () => { await disposeHost(ctx); });

  ctx.plugin(auditIpcPlugin());
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(ipc.handlers.has("audit:open"), "迁移后应仍注册 audit:open");

  await ipc.handlers.get("audit:open")({});
  assert.equal(opened.length, 1, "应调用一次 shell.openPath");
  assert.equal(opened[0], path.join(dir, "audit.jsonl"), "必须打开审计服务自己的文件（userData 根），不是插件数据目录里的同名文件");
  assert.equal(await ctx.storage.exists(path.join(dir, "audit.jsonl")), true, "文件不存在时应先创建");
});

test("迁移样板 audit-ipc：插件卸载后通道注销", async (t) => {
  const ipc = fakeIpc();
  const dir = await tempDir(t);
  const ctx = await createHost({ userDataDir: dir, contracts: { ipcRegister: ipc.register, ipcUnregister: ipc.unregister, shell: { openPath: async () => "" } } });
  t.after(async () => { await disposeHost(ctx); });
  const fiber = ctx.plugin(auditIpcPlugin());
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(ipc.handlers.has("audit:open"));
  await fiber.dispose();
  assert.equal(ipc.handlers.has("audit:open"), false, "内置插件迁移后同样要能注销通道");
});
