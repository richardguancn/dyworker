// Cordis 插件宿主通用扩展点测试（主进程 + 渲染端）：
// 覆盖 StorageService 加密存储原语、ConnectionService.emit 插件实时事件、
// host/* 生命周期事件、command/resolve-env 命令环境变量注入、
// 以及 ClientPluginHost 的 rail.footer.action / pluginEvents / shellUi。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { Workspace } from "../electron/agent/workspace.mts";
import { ClientPluginHost } from "../src/pluginRuntime/clientHost.ts";

const settle = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (buf) => {
      const text = Buffer.from(buf).toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("密文损坏");
      return text.slice(4);
    },
  };
}

async function makeTmpDir(t, tag) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `dyworker-ext-${tag}-`));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

test("StorageService 安全存储原语：加密往返，不可用时拒绝写明文", async (t) => {
  const dir = await makeTmpDir(t, "storage");
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage(true) });
  try {
    assert.equal(ctx.storage.isEncryptionAvailable(), true);
    const enc = ctx.storage.encryptSecret("token-123");
    assert.equal(enc.encrypted, true);
    assert.notEqual(enc.value, "token-123");
    assert.equal(ctx.storage.decryptSecret(enc.value, enc.encrypted), "token-123");
    assert.deepEqual(ctx.storage.encryptSecret(""), { value: "", encrypted: false });
  } finally {
    await disposeHost(ctx);
  }

  const dirNoEnc = await makeTmpDir(t, "storage-noenc");
  const ctxNoEnc = await createHost({ userDataDir: dirNoEnc, safeStorage: fakeSafeStorage(false) });
  try {
    assert.equal(ctxNoEnc.storage.isEncryptionAvailable(), false);
    assert.throws(() => ctxNoEnc.storage.encryptSecret("secret"), /安全存储不可用/);
    assert.equal(ctxNoEnc.storage.decryptSecret("abc", true), "");
  } finally {
    await disposeHost(ctxNoEnc);
  }
});

test("主进程扩展点：connection.emit、host/* 生命周期事件与 command/resolve-env waterfall", async (t) => {
  const dir = await makeTmpDir(t, "host-ext");
  const sent = [];
  let shown = 0;
  const ctx = await createHost({
    userDataDir: dir,
    contracts: {
      showMainWindow: () => { shown += 1; },
      getWebContents: () => [{
        isDestroyed: () => false,
        send: (channel, payload) => sent.push({ channel, payload }),
      }],
    },
  });

  try {
    assert.equal(ctx.window.focus(), true);
    assert.equal(shown, 1);

    const eventsSeen = [];
    const fiber = ctx.plugin({
      name: "probe-ext",
      apply(c) {
        c.on("host/window-focus", () => eventsSeen.push("focus"));
        c.on("host/power-resume", () => eventsSeen.push("resume"));
        c.on("host/screen-unlock", () => eventsSeen.push("unlock"));
        c.on("command/resolve-env", (command, _current, next) => {
          if (!String(command).includes("echo_token")) return next();
          return { env: { PLUGIN_TEST_TOKEN: "val-999" } };
        });
      },
    });
    await settle();

    ctx.emit("host/window-focus");
    ctx.emit("host/power-resume");
    ctx.emit("host/screen-unlock");
    assert.deepEqual(eventsSeen, ["focus", "resume", "unlock"]);

    ctx.connection.emit("demo:changed", { ok: true });
    assert.deepEqual(sent, [{
      channel: "plugin-events:emit",
      payload: { topic: "demo:changed", payload: { ok: true } },
    }]);

    // 验证 Workspace.runCommand 能收到 waterfall 注入的环境变量
    const ws = new Workspace(dir, {});
    ws.skillAuthEnv = (cmd) => ctx.waterfall("command/resolve-env", cmd, null, () => null);
    const res = await ws.runCommand("node -e \"console.log(process.env.PLUGIN_TEST_TOKEN)\" # echo_token");
    assert.equal(res.ok, true);
    assert.match(res.output, /val-999/);

    await fiber.dispose();
    const afterDispose = await ctx.waterfall("command/resolve-env", "echo_token", null, () => null);
    assert.equal(afterDispose, null);
  } finally {
    await disposeHost(ctx);
  }
});

test("渲染端扩展点：rail.footer.action、pluginEvents 与 shellUi（卸载自动退订）", async (t) => {
  let bridgeCb = null;
  const prevDyworker = globalThis.dyworker;
  globalThis.dyworker = {
    onPluginEvent: (cb) => {
      bridgeCb = cb;
      return () => { bridgeCb = null; };
    },
  };
  t.after(() => {
    globalThis.dyworker = prevDyworker;
  });

  const notices = [];
  const openedTabs = [];
  const host = new ClientPluginHost({
    onNotify: (msg) => notices.push(msg),
    onOpenSettings: (tab) => openedTabs.push(tab),
  });
  t.after(() => host.dispose());

  const received = [];
  const record = await host.load({
    name: "probe-client",
    inject: ["slots", "pluginEvents", "shellUi"],
    apply(ctx) {
      ctx.slots.inject("rail.footer.action", () => ctx.slots.register({
        name: "rail.footer.action",
        id: "probe-btn",
        key: "probe-btn",
      }, () => null));
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "probe-sec",
        key: "probe-sec",
        group: "preferences",
        order: 15,
        label: () => "扩展分区",
      }, () => null));
      ctx.pluginEvents.on("probe:topic", (payload) => {
        received.push(payload);
        ctx.shellUi.notify("收到事件");
        ctx.shellUi.openSettings("probe-sec");
      });
    },
  }, "probe-client");

  assert.equal(record.ok, true);
  assert.deepEqual(record.slots.sort(), ["rail.footer.action", "settings.section"]);
  assert.equal(typeof bridgeCb, "function");

  bridgeCb({ topic: "probe:topic", payload: { step: 1 } });
  assert.deepEqual(received, [{ step: 1 }]);
  assert.deepEqual(notices, ["收到事件"]);
  assert.deepEqual(openedTabs, ["probe-sec"]);

  await host.unload("probe-client");
  assert.equal(host.contributionsFor("rail.footer.action").length, 0);
  assert.equal(host.contributionsFor("settings.section").length, 0);
  bridgeCb?.({ topic: "probe:topic", payload: { step: 2 } });
  assert.equal(received.length, 1, "插件卸载后应自动退订事件");
});
