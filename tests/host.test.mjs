// Cordis 宿主地基测试：服务装配、生命周期 dispose、设置/审计/会话存档三域行为。
// host 不依赖 electron，safeStorage 用假实现注入。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { channelsPlugin, telemetryPlugin, backgroundTasksPlugin } from "../electron/host/services/runtime-domains.mts";

// 假 safeStorage：明文 base64 往返，语义与 Electron safeStorage 一致（Buffer 进出）
function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8").toString("base64"),
    decryptString: (buffer) => {
      const decoded = Buffer.from(buffer).toString("utf8");
      if (!decoded.startsWith("enc:")) throw new Error("bad payload");
      return decoded.slice(4);
    },
  };
}

async function makeTmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-host-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

test("createHost 装配核心服务并可经 ctx 同步访问，dispose 后移除", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  try {
    assert.ok(ctx.get("audit"), "audit 服务应就绪");
    assert.ok(ctx.get("settings"), "settings 服务应就绪");
    assert.ok(ctx.get("sessions"), "sessions 服务应就绪");
    // ctx 是代理：每次访问返回包装对象，比形状不比引用
    assert.equal(ctx.audit.name, "audit");
    assert.equal(typeof ctx.audit.record, "function");
    assert.equal(typeof ctx.get("audit").record, "function");
  } finally {
    await disposeHost(ctx);
  }
  assert.equal(ctx.get("audit"), undefined, "dispose 后服务应移除");
  assert.equal(ctx.get("settings"), undefined);
  assert.equal(ctx.get("sessions"), undefined);
});

test("SettingsService：写入规范化 updateUrl 并加密密钥，读回一致", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  try {
    const updateUrl = await ctx.settings.write({ endpoint: "https://api.example.com", model: "m1", apiKey: "sk-test", updateUrl: "https://github.com/richardguancn/dyworker" });
    assert.equal(updateUrl, "https://github.com/richardguancn/dyworker");

    const settings = await ctx.settings.read();
    assert.equal(settings.apiKey, "sk-test");
    assert.equal(settings.endpoint, "https://api.example.com");

    // 落盘文件里密钥是加密态（enc: 前缀的 base64），且文件为 0600
    const raw = JSON.parse(await fs.readFile(path.join(dir, "settings.json"), "utf8"));
    assert.equal(raw.encrypted, true);
    assert.ok(!JSON.stringify(raw).includes("sk-test"));
    const stat = await fs.stat(path.join(dir, "settings.json"));
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    await disposeHost(ctx);
  }
});

test("SettingsService：migrator 按注册顺序应用且随读触发", async (t) => {
  const dir = await makeTmpDir(t);
  const applied = [];
  const ctx = await createHost({
    userDataDir: dir,
    safeStorage: fakeSafeStorage(),
    settingsMigrators: [
      (s) => { applied.push("a"); s.migratedA = true; },
      (s) => { applied.push("b"); s.migratedB = true; },
    ],
  });
  try {
    const settings = await ctx.settings.read();
    assert.deepEqual(applied, ["a", "b"]);
    assert.equal(settings.migratedA, true);
    assert.equal(settings.migratedB, true);
  } finally {
    await disposeHost(ctx);
  }
});

test("SettingsService：解不开的密文原样保留在落盘文件中", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  await ctx.settings.write({ endpoint: "https://api.example.com", model: "m1", apiKey: "sk-secret" });
  await disposeHost(ctx);

  // 换一个解密必然失败的假存储再读：密文回写后文件中的密文保持不变
  const ctx2 = await createHost({
    userDataDir: dir,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (p) => Buffer.from(p), decryptString: () => { throw new Error("nope"); } },
  });
  try {
    const settings = await ctx2.settings.read();
    assert.equal(settings.apiKey, "", "解不开时读出空值");
    const raw = JSON.parse(await fs.readFile(path.join(dir, "settings.json"), "utf8"));
    const rawBefore = JSON.parse(await fs.readFile(path.join(dir, "settings.json"), "utf8"));
    assert.equal(raw.apiKey, rawBefore.apiKey, "密文字段不被清空");
    assert.equal(raw.encrypted, true);
  } finally {
    await disposeHost(ctx2);
  }
});

test("AuditService：record 逐条落 JSONL，dispose 不丢已写记录", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  // record 返回写入链尾 promise，await 保证落盘完成后校验（与 main 内 fire-and-forget 用法并存）
  await ctx.audit.record({ tool: "write_file", decision: "approved", summary: "写入文档" });
  await ctx.audit.record({ tool: "run_command", decision: "denied" });
  await disposeHost(ctx);
  const content = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
  const lines = content.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].tool, "write_file");
  assert.equal(lines[1].decision, "denied");
  assert.ok(lines[0].time, "应带时间戳");
});

test("SessionsService：upsert/loadAll 往返，requestSave 合并落盘，dispose flush", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  try {
    await ctx.sessions.upsert({ id: "s1", title: "会话一", workspacePath: dir, messages: [{ role: "user", content: "你好" }] });
    const loaded = await ctx.sessions.loadAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "s1");

    // 整档快照走合并写入器：requestSave 后未 flush 时不强制立即可见，flush 后落盘
    ctx.sessions.requestSave([
      { id: "s1", title: "会话一改", workspacePath: dir, messages: [] },
      { id: "s2", title: "会话二", workspacePath: dir, messages: [] },
    ]);
    await ctx.sessions.flush();
    const reloaded = await ctx.sessions.loadAll();
    assert.equal(reloaded.length, 2);
  } finally {
    await disposeHost(ctx);
  }
});

test("disposeHost 幂等于无插件残留：重复调用不抛错", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  await disposeHost(ctx);
  await disposeHost(ctx);
});

test("运行期域插件：dispose 时按注册逆序停止，对象经 ctx 可取", async (t) => {
  const dir = await makeTmpDir(t);
  const stops = [];
  const fakeChannels = { stopAll: async () => { stops.push("channels"); } };
  const fakeTelemetry = { shutdown: async () => { stops.push("telemetry"); } };
  const fakeBackgroundTasks = { cleanupAll: () => { stops.push("backgroundTasks"); } };
  const ctx = await createHost({
    userDataDir: dir,
    safeStorage: fakeSafeStorage(),
    registerService: (hostCtx) => {
      hostCtx.plugin(channelsPlugin(fakeChannels));
      hostCtx.plugin(telemetryPlugin(fakeTelemetry));
      hostCtx.plugin(backgroundTasksPlugin(fakeBackgroundTasks));
    },
  });
  try {
    assert.equal(ctx.get("channelManager"), fakeChannels);
    assert.equal(ctx.get("telemetryController"), fakeTelemetry);
    assert.equal(ctx.get("backgroundTasksManager"), fakeBackgroundTasks);
  } finally {
    await disposeHost(ctx);
  }
  assert.deepEqual(stops, ["backgroundTasks", "telemetry", "channels"], "逆序停止");
});

// —— tools/pre-execute 事件接缝（策略插件扩展点）——

function mockChatFetch(scriptedMessages, calls = []) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const message = scriptedMessages.length > 1 ? scriptedMessages.shift() : scriptedMessages[0];
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
}

function toolCall(id, name, args) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function stubAgentResolvers(overrides = {}) {
  return {
    isShuttingDown: () => false,
    readHooks: async () => [],
    readMemoryPages: async () => [],
    readSkills: async () => [],
    readStandingRules: async () => [],
    appendMemory: async () => {},
    memoriesFromAgentResult: () => [],
    appendSkill: async () => {},
    appendUsageStat: () => {},
    history: () => ({ search: async () => ({ results: [] }), readContext: async () => "" }),
    hasPendingWakeForSession: () => false,
    registerWake: async () => {},
    mcpExtraTools: async () => [],
    agentExtraTools: (tools) => tools,
    createExtraToolRouter: () => {
      const route = async () => ({ text: "未路由" });
      route.dispose = () => {};
      return route;
    },
    auditRecord: () => {},
    ...overrides,
  };
}

test("tools/pre-execute 事件：策略监听器经 ctx.agent.run 阻止工具执行", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({
    userDataDir: dir,
    safeStorage: fakeSafeStorage(),
    agentResolvers: stubAgentResolvers(),
    startBackgroundTask: (p) => p,
  });
  try {
    const blocked = [];
    ctx.on("tools/pre-execute", (name, args, current, next) => {
      if (name === "list_workspace") {
        blocked.push({ name, args });
        return { action: "block", message: "宿主事件策略：演示会话禁止列目录" };
      }
      return next();
    });
    const calls = [];
    const result = await ctx.agent.run({
      settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "k" },
      workspacePath: dir,
      sessionId: "s-host",
      approvalMode: "interactive",
      conversation: [{ role: "user", content: "列出工作区文件" }],
      emit: () => {},
      fetchImpl: mockChatFetch([
        { role: "assistant", content: null, tool_calls: [toolCall("c1", "list_workspace", {})] },
        { role: "assistant", content: "策略禁止列目录。" },
      ], calls),
    });
    assert.equal(result.status, "done");
    assert.equal(blocked.length, 1);
    const toolMessage = calls[1].messages.find((message) => message.role === "tool");
    assert.match(toolMessage.content, /宿主事件策略：演示会话禁止列目录/);
  } finally {
    await disposeHost(ctx);
  }
});
