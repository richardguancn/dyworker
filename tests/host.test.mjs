// Cordis 宿主地基测试：服务装配、生命周期 dispose、设置/审计/会话存档三域行为。
// host 不依赖 electron，safeStorage 用假实现注入。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { channelsPlugin, telemetryPlugin, remoteMessagesPlugin, backgroundTasksPlugin } from "../electron/host/services/runtime-domains.mts";

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
  // 解不开之前先把密文抓下来：后面要与回写后的落盘值比对，两次读同一份文件是恒等断言
  const cipherBefore = JSON.parse(await fs.readFile(path.join(dir, "settings.json"), "utf8")).apiKey;
  assert.ok(cipherBefore && cipherBefore !== "sk-secret", "写入时应已加密");

  // 换一个解密必然失败的假存储再读：密文回写后文件中的密文保持不变
  const ctx2 = await createHost({
    userDataDir: dir,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (p) => Buffer.from(p), decryptString: () => { throw new Error("nope"); } },
  });
  try {
    const settings = await ctx2.settings.read();
    assert.equal(settings.apiKey, "", "解不开时读出空值");
    const raw = JSON.parse(await fs.readFile(path.join(dir, "settings.json"), "utf8"));
    assert.equal(raw.apiKey, cipherBefore, "密文字段不被清空");
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

test("运行期域插件：创建由插件负责，dispose 时按注册逆序停止", async (t) => {
  const dir = await makeTmpDir(t);
  const stops = [];
  const fakeChannels = { stopAll: async () => { stops.push("channels"); } };
  const fakeTelemetry = { shutdown: async () => { stops.push("telemetry"); } };
  const fakeBackgroundTasks = { cleanupAll: () => { stops.push("backgroundTasks"); } };
  // 工厂只在插件 apply 时被调用：证明实例的存活期归插件 fiber
  const created = [];
  const ctx = await createHost({
    userDataDir: dir,
    safeStorage: fakeSafeStorage(),
    registerService: (hostCtx) => {
      hostCtx.plugin(channelsPlugin(() => { created.push("channels"); return fakeChannels; }));
      hostCtx.plugin(telemetryPlugin(() => { created.push("telemetry"); return fakeTelemetry; }));
      hostCtx.plugin(backgroundTasksPlugin(() => { created.push("backgroundTasks"); return fakeBackgroundTasks; }));
    },
  });
  try {
    assert.deepEqual(created.slice().sort(), ["backgroundTasks", "channels", "telemetry"], "三个工厂都应被调用一次");
    assert.equal(ctx.get("channelManager"), fakeChannels);
    assert.equal(ctx.get("telemetryController"), fakeTelemetry);
    assert.equal(ctx.get("backgroundTasksManager"), fakeBackgroundTasks);
  } finally {
    await disposeHost(ctx);
  }
  assert.deepEqual(stops, ["backgroundTasks", "telemetry", "channels"], "逆序停止");
});

test("remoteMessages 插件 inject telemetryController：依赖未就绪不 apply", async (t) => {
  const dir = await makeTmpDir(t);
  const { Context } = await import("cordis");
  const bare = new Context();
  await bare.fiber.await();
  let built = 0;
  bare.plugin(remoteMessagesPlugin(() => { built += 1; return { stop: async () => {} }; }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    assert.equal(built, 0, "用量统计未提供时运营消息插件不应创建实例");
    assert.equal(bare.get("remoteMessages"), undefined);
    bare.provide("telemetryController", { getClient: () => ({}) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(built, 1, "依赖就绪后应创建实例");
    assert.ok(bare.get("remoteMessages"), "实例应挂在 ctx.remoteMessages");
  } finally {
    await bare.fiber.dispose();
  }
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

// cordis 的 waterfall 把最后一个实参当兜底函数（无监听器时调用它），其余实参原样
// 传给监听器再追加 next。装配方漏传兜底函数时，未注册监听器的默认路径会对 null
// 调用 → TypeError: inner is not a function，每个工具调用都打断整个任务。
// 这两条用例钉住「无监听器照常执行」与「监听器 next() 委托」两条路径。
async function runOneToolCall(t, registerListener) {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({
    userDataDir: dir,
    safeStorage: fakeSafeStorage(),
    agentResolvers: stubAgentResolvers(),
    startBackgroundTask: (p) => p,
  });
  try {
    if (registerListener) registerListener(ctx);
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
        { role: "assistant", content: "已完成。" },
      ], calls),
    });
    return { result, toolMessage: calls[1]?.messages?.find((message) => message.role === "tool") };
  } finally {
    await disposeHost(ctx);
  }
}

test("tools/pre-execute 事件：未注册监听器时工具照常执行（waterfall 兜底不可缺）", async (t) => {
  // stubAgentResolvers 不含真实工具，工具会以「未知工具」收尾——关键是策略接缝
  // 不能抛错打断任务，且 run 正常返回。
  const { result, toolMessage } = await runOneToolCall(t, null);
  assert.equal(result.status, "done");
  assert.ok(toolMessage, "工具调用应被执行并回填 tool 消息");
});

test("tools/pre-execute 事件：监听器调用 next() 委托后工具仍执行", async (t) => {
  let seenNext = null;
  const { result, toolMessage } = await runOneToolCall(t, (ctx) => {
    // 契约：(name, args, current, next)。current 是装配方传入的初始值（null），
    // next 是委托后续监听器的函数。
    ctx.on("tools/pre-execute", (name, args, current, next) => {
      assert.equal(name, "list_workspace");
      assert.equal(current, null);
      seenNext = typeof next;
      return next();
    });
  });
  assert.equal(seenNext, "function", "监听器必须收到 next 回调");
  assert.equal(result.status, "done");
  assert.ok(toolMessage, "委托后工具仍应执行");
});

// —— ctx.rules：常驻允许规则服务（从 main.mts 收编，IPC 插件只做通道映射）——

test("RulesService：规则读写往返 + 可生效性校验 + 去重", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  try {
    assert.deepEqual(await ctx.rules.list(), [], "初始为空数组");

    // 不可规则化的操作必须被拒（rm 属系统级破坏性命令，永远逐次确认）
    const denied = await ctx.rules.add({ kind: "command-prefix", tool: "run_command", pattern: "rm -rf /" });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /不支持始终允许/);

    // 类型/内容非法
    assert.equal((await ctx.rules.add({ kind: "nope", tool: "t", pattern: "p" })).ok, false);
    assert.equal((await ctx.rules.add({ kind: "command-prefix", tool: "", pattern: "" })).ok, false);

    // 可规则化的命令前缀：通过并落盘
    const added = await ctx.rules.add({ kind: "command-prefix", tool: "run_command", pattern: "npm run test", label: "跑测试" });
    assert.equal(added.ok, true);
    const rules = await ctx.rules.list();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].kind, "command-prefix");
    assert.equal(rules[0].pattern, "npm run test");
    assert.equal(rules[0].label, "跑测试");
    assert.ok(rules[0].id && rules[0].createdAt, "应带 id 与创建时间");

    // 同一条重复添加：幂等
    const again = await ctx.rules.add({ kind: "command-prefix", tool: "run_command", pattern: "npm run test" });
    assert.equal(again.duplicated, true);
    assert.equal((await ctx.rules.list()).length, 1);

    // 删除
    await ctx.rules.remove(rules[0].id);
    assert.deepEqual(await ctx.rules.list(), []);
  } finally {
    await disposeHost(ctx);
  }
});

test("RulesService：落盘文件在 userData 下，损坏内容退化为空数组", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  try {
    await ctx.rules.add({ kind: "command-prefix", tool: "run_command", pattern: "git status" });
    const raw = JSON.parse(await fs.readFile(path.join(dir, "standing-rules.json"), "utf8"));
    assert.equal(raw.length, 1);
    assert.equal(raw[0].pattern, "git status");
  } finally {
    await disposeHost(ctx);
  }
  await fs.writeFile(path.join(dir, "standing-rules.json"), "{ 不是数组也不是合法 JSON", "utf8");
  const ctx2 = await createHost({ userDataDir: dir, safeStorage: fakeSafeStorage() });
  try {
    assert.deepEqual(await ctx2.rules.list(), [], "损坏内容应退化为空数组而不是抛错");
  } finally {
    await disposeHost(ctx2);
  }
});

test("rules IPC 插件用 inject 声明依赖：ctx.rules 缺失时不激活", async () => {
  const { Context } = await import("cordis");
  const { rulesIpcPlugin } = await import("../electron/host/plugins/rules-ipc.mts");
  // 直接在一个空容器上挂插件：inject 的 rules 服务不存在 → apply 不应执行
  const bare = new Context();
  await bare.fiber.await();
  let registered = 0;
  bare.plugin(rulesIpcPlugin({ trustedHandle: () => { registered += 1; } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    assert.equal(registered, 0, "依赖缺失时 IPC 通道不应注册");
    bare.provide("rules", { list: async () => [], add: async () => ({ ok: true }), remove: async () => ({ ok: true }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(registered, 3, "依赖就绪后应注册 rules:list/add/delete 三个通道");
  } finally {
    await bare.fiber.dispose();
  }
});

// —— 策略插件：tools/pre-execute 的真实消费者（敏感凭据路径守卫）——

test("敏感路径守卫：命中规则表，且不误伤普通路径", async () => {
  const { findSensitiveReference } = await import("../electron/host/plugins/sensitive-path-guard.mts");
  // 命中：私钥、SSH 目录、.env 家族、凭据库，以及藏在命令串/嵌套数组里的路径
  assert.equal(findSensitiveReference({ path: "/Users/me/.ssh/id_rsa" })?.label, "SSH 目录（可能含私钥）");
  assert.equal(findSensitiveReference({ command: "cat ~/.aws/credentials" })?.label, "AWS 凭据");
  assert.ok(findSensitiveReference({ path: "/srv/app/.env.production" }));
  assert.ok(findSensitiveReference({ files: ["/tmp/a.txt", "/srv/app/.npmrc"] }));
  assert.ok(findSensitiveReference({ path: "/x/imported-passwords.json" }));
  assert.ok(findSensitiveReference({ path: "/x/channel-credentials.json" }));
  // 不命中：普通源码路径、公开密钥、名字里带 env 的无关目录
  assert.equal(findSensitiveReference({ path: "/srv/app/src/index.ts" }), null);
  assert.equal(findSensitiveReference({ path: "/srv/app/environment.md" }), null);
  assert.equal(findSensitiveReference({ path: "/srv/app/.ssh-notes/readme.md" }), null);
  assert.equal(findSensitiveReference({ command: "npm run test" }), null);
});

test("敏感路径守卫挂上接缝后：full-access 下读敏感文件也会要求审批", async (t) => {
  const dir = await makeTmpDir(t);
  const { sensitivePathGuardPlugin } = await import("../electron/host/plugins/sensitive-path-guard.mts");
  const { Context } = await import("cordis");

  // 无插件：full-access 直接放行
  const plain = await createHost({
    userDataDir: dir, safeStorage: fakeSafeStorage(),
    agentResolvers: stubAgentResolvers(), startBackgroundTask: (p) => p,
  });
  let plainAsked = 0;
  try {
    await plain.agent.run({
      settings: { endpoint: "http://mock.local/v1/chat/completions", model: "m", apiKey: "k" },
      workspacePath: dir, sessionId: "s-plain", approvalMode: "full-access",
      conversation: [{ role: "user", content: "读一下私钥" }], emit: () => {},
      requestApproval: async () => { plainAsked += 1; return false; },
      fetchImpl: mockChatFetch([
        { role: "assistant", content: null, tool_calls: [toolCall("c1", "read_file", { path: "/Users/me/.ssh/id_rsa" })] },
        { role: "assistant", content: "好。" },
      ]),
    });
  } finally { await disposeHost(plain); }
  assert.equal(plainAsked, 0, "未挂插件时 full-access 不应弹审批");

  // 挂插件：同一次调用变成「强制审批」，且被拒后不执行
  const dir2 = await makeTmpDir(t);
  const guarded = await createHost({
    userDataDir: dir2, safeStorage: fakeSafeStorage(),
    agentResolvers: stubAgentResolvers(), startBackgroundTask: (p) => p,
  });
  const seen = [];
  try {
    guarded.plugin(sensitivePathGuardPlugin());
    await new Promise((resolve) => setTimeout(resolve, 20)); // 等插件 apply
    await guarded.agent.run({
      settings: { endpoint: "http://mock.local/v1/chat/completions", model: "m", apiKey: "k" },
      workspacePath: dir2, sessionId: "s-guarded", approvalMode: "full-access",
      conversation: [{ role: "user", content: "读一下私钥" }], emit: () => {},
      requestApproval: async (action) => { seen.push(action); return false; },
      fetchImpl: mockChatFetch([
        { role: "assistant", content: null, tool_calls: [toolCall("c1", "read_file", { path: "/Users/me/.ssh/id_rsa" })] },
        { role: "assistant", content: "好。" },
      ]),
    });
  } finally { await disposeHost(guarded); }
  assert.equal(seen.length, 1, "命中敏感路径应强制走一次审批");
  assert.match(String(seen[0]?.details || seen[0]?.title || JSON.stringify(seen[0])), /敏感|\.ssh/s);
});

test("敏感路径守卫未命中时委托后续监听器，不截断策略链", async () => {
  const { sensitivePathGuardPlugin } = await import("../electron/host/plugins/sensitive-path-guard.mts");
  const { Context } = await import("cordis");
  const ctx = new Context();
  await ctx.fiber.await();
  try {
    let laterSaw = null;
    ctx.plugin(sensitivePathGuardPlugin());
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 守卫之前注册的插件不应影响 guard 的 next() 委托
    ctx.on("tools/pre-execute", (name, args, current, next) => {
      laterSaw = name;
      return { action: "block", message: "后续策略拒绝" };
    });
    const verdict = await ctx.waterfall("tools/pre-execute", "read_file", { path: "/srv/app/src/index.ts" }, null, () => null);
    assert.equal(laterSaw, "read_file", "未命中时守卫应调 next() 让后续监听器参与");
    assert.equal(verdict?.action, "block");
    // 命中时守卫自己下判断，不再走到后面的监听器
    laterSaw = null;
    const hit = await ctx.waterfall("tools/pre-execute", "read_file", { path: "/Users/me/.ssh/id_rsa" }, null, () => null);
    assert.equal(hit?.action, "require_approval");
    assert.equal(laterSaw, null, "命中时守卫直接决定，后续监听器不参与");
  } finally {
    await ctx.fiber.dispose();
  }
});

test("运行期域插件接真实工厂：创建归插件，ctx.<name> 就绪，dispose 后摘除", async (t) => {
  const dir = await makeTmpDir(t);
  const { createChannelManager } = await import("../electron/channels/manager.mts");
  const { createTelemetryController } = await import("../electron/telemetry.mts");
  const { createRemoteMessagesManager } = await import("../electron/remote-messages.mts");
  const { createBackgroundTasksManager } = await import("../electron/background-tasks.mts");

  const ctx = await createHost({
    userDataDir: dir,
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => Buffer.from(b).toString() },
  });
  try {
    ctx.plugin(channelsPlugin(() => createChannelManager({
      readChats: async () => ({}), writeChats: async () => {},
      mediaDir: path.join(dir, "channel-media"), wechatStateRoot: path.join(dir, "wechat-state"),
    })));
    ctx.plugin(backgroundTasksPlugin(() => createBackgroundTasksManager()));
    // 与 main.mts 的挂载方式一致：用量统计先就绪，运营消息 inject 它
    await ctx.plugin(telemetryPlugin(() => createTelemetryController({
      userDataDir: dir, appVersion: "0.0.0-test", platform: process.platform, arch: process.arch,
      releaseChannel: "dev",
      secretStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => Buffer.from(b).toString() },
    })));
    await ctx.plugin(remoteMessagesPlugin((hostCtx) => createRemoteMessagesManager({
      file: path.join(dir, "system-messages.json"),
      client: hostCtx.telemetryController.getClient(),
      showNotification: () => {}, onChanged: () => {},
    })));

    // 这些断言覆盖「插件内创建」这一步：若 ctx.<name> 没被 provide，
    // main 的 reconcileChannels() 会用 .catch(() => {}) 静默吞掉，线上表现为渠道永不启动
    assert.equal(typeof ctx.channelManager?.status, "function");
    assert.ok(ctx.channelManager.status().qq);
    assert.ok(Array.isArray(ctx.backgroundTasksManager.listTasks("s1")));
    assert.equal(typeof ctx.telemetryController?.status, "function");
    assert.equal(typeof ctx.remoteMessages?.listMessages, "function");
  } finally {
    await disposeHost(ctx);
  }
  for (const name of ["channelManager", "telemetryController", "remoteMessages", "backgroundTasksManager"]) {
    assert.equal(ctx.get(name), undefined, `${name} 应随宿主 dispose 摘除`);
  }
});

// —— 域 IPC 插件：通道名与 preload 契约不变，依赖用 inject 门控 ——

test("域 IPC 插件：inject 满足前不注册通道，满足后注册的通道名与 preload 一致", async () => {
  const { Context } = await import("cordis");
  const { backgroundTasksIpcPlugin } = await import("../electron/host/plugins/background-tasks-ipc.mts");
  const { channelsIpcPlugin } = await import("../electron/host/plugins/channels-ipc.mts");
  const { telemetryIpcPlugin } = await import("../electron/host/plugins/telemetry-ipc.mts");
  const { skillsIpcPlugin } = await import("../electron/host/plugins/skills-ipc.mts");
  const { memoriesIpcPlugin } = await import("../electron/host/plugins/memories-ipc.mts");
  const { inboxIpcPlugin } = await import("../electron/host/plugins/inbox-ipc.mts");

  const cases = [
    {
      label: "background-tasks",
      plugin: backgroundTasksIpcPlugin,
      deps: { backgroundTasksManager: {} },
      channels: ["background-tasks:list", "background-tasks:start", "background-tasks:stop", "background-tasks:restart", "background-tasks:get-logs"],
    },
    {
      label: "channels",
      plugin: channelsIpcPlugin,
      deps: { channelManager: {} },
      channels: ["channels:get-status"],
    },
    {
      label: "inbox",
      plugin: inboxIpcPlugin,
      deps: { inbox: {} },
      channels: ["inbox:list", "inbox:resolve", "inbox:dismiss"],
    },
    {
      label: "memories",
      plugin: memoriesIpcPlugin,
      deps: { memory: {} },
      channels: ["memories:list", "memories:update", "memories:delete", "memories:lint"],
    },
    {
      label: "skills",
      plugin: skillsIpcPlugin,
      deps: { skills: {}, settings: {} },
      channels: ["skills:list", "skills:set-enabled", "skills:delete", "skills:create", "skills:update", "skill-libraries:search", "skill-libraries:install"],
    },
    {
      label: "telemetry",
      plugin: telemetryIpcPlugin,
      deps: { telemetryController: {}, remoteMessages: {} },
      channels: ["telemetry:status", "telemetry:delete-data", "system-messages:list", "system-messages:mark-read", "system-messages:mark-clicked"],
    },
  ];

  for (const item of cases) {
    const bare = new Context();
    await bare.fiber.await();
    const registered = [];
    bare.plugin(item.plugin({ trustedHandle: (channel) => registered.push(channel) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      assert.deepEqual(registered, [], `${item.label}: 依赖缺失时不应注册任何通道`);
      for (const [name, value] of Object.entries(item.deps)) bare.provide(name, value);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(registered.slice().sort(), item.channels.slice().sort(), `${item.label}: 通道名应与 preload 契约一致`);
    } finally {
      await bare.fiber.dispose();
    }
  }
});

test("域 IPC 插件：handler 只做通道映射，调用打到注入的服务上", async () => {
  const { Context } = await import("cordis");
  const { backgroundTasksIpcPlugin } = await import("../electron/host/plugins/background-tasks-ipc.mts");
  const bare = new Context();
  await bare.fiber.await();
  const handlers = new Map();
  const calls = [];
  const fakeManager = {
    listTasks: (sessionId) => { calls.push(["list", sessionId]); return ["t1"]; },
    startTask: (payload) => { calls.push(["start", payload]); return { id: "t2" }; },
    stopTask: async (taskId) => { calls.push(["stop", taskId]); return true; },
    restartTask: async (taskId) => { calls.push(["restart", taskId]); return { id: taskId }; },
    getTaskLogs: (taskId) => { calls.push(["logs", taskId]); return "log"; },
  };
  bare.plugin(backgroundTasksIpcPlugin({ trustedHandle: (channel, handler) => handlers.set(channel, handler) }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  bare.provide("backgroundTasksManager", fakeManager);
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    assert.equal(handlers.size, 5);
    assert.deepEqual(handlers.get("background-tasks:list")({}, "s1"), ["t1"]);
    assert.deepEqual(handlers.get("background-tasks:start")({}, { command: "x" }), { id: "t2" });
    assert.deepEqual(await handlers.get("background-tasks:stop")({}, "t3"), { ok: true });
    assert.deepEqual(handlers.get("background-tasks:get-logs")({}, "t4"), "log");
    assert.deepEqual(calls, [["list", "s1"], ["start", { command: "x" }], ["stop", "t3"], ["logs", "t4"]]);
  } finally {
    await bare.fiber.dispose();
  }
});

// —— ctx.skills：工作模板服务（从 main.mts 上收）——

test("SkillsService：内置模板合并、创建/更新/启停/删除，被删的内置模板不复活", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, homeDir: dir, safeStorage: fakeSafeStorage() });
  try {
    const initial = await ctx.skills.read("");
    assert.ok(initial.length >= 10, `应合并出内置模板，实际 ${initial.length}`);
    assert.ok(initial.every((item) => item.id && item.name), "每条模板都应有 id 与名称");
    assert.ok(initial.some((item) => item.builtIn), "内置模板应带 builtIn 标记");
    // 首次读取会把内置模板落盘到 skills.json
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, "skills.json"), "utf8"));
    assert.equal(onDisk.length, initial.length);

    // 创建（会话「总结为工作模板」链路）
    const created = await ctx.skills.append({ name: "我的模板", description: "说明", instructions: "步骤" });
    assert.ok(created.id && created.enabled === true);
    assert.ok((await ctx.skills.read("")).some((item) => item.id === created.id));

    // 更新
    const updated = await ctx.skills.update({ id: created.id, name: "改过的名字" });
    assert.equal(updated.name, "改过的名字");
    assert.equal(await ctx.skills.update({ id: "不存在", name: "x" }), null);

    // 启停：本地模板直接落盘
    await ctx.skills.setEnabled({ id: created.id, enabled: false });
    assert.equal((await ctx.skills.read("")).find((item) => item.id === created.id).enabled, false);

    // 删除本地模板
    assert.equal((await ctx.skills.remove(created.id)).ok, true);
    assert.ok(!(await ctx.skills.read("")).some((item) => item.id === created.id));

    // 删除内置模板：进入 dismissed 名单，不再被补回
    const beforeBuiltins = (await ctx.skills.read("")).filter((item) => item.builtIn);
    const victim = beforeBuiltins[0];
    assert.equal((await ctx.skills.remove(victim.id)).ok, true);
    const afterBuiltins = (await ctx.skills.read("")).filter((item) => item.builtIn);
    assert.equal(afterBuiltins.length, beforeBuiltins.length - 1, "删掉的内置模板不应复活");
    assert.ok(!afterBuiltins.some((item) => item.id === victim.id));

    // 文件技能不在本服务管理（无对应记录时明确报错）
    assert.equal((await ctx.skills.remove("file-skill-xyz")).ok, false);
  } finally {
    await disposeHost(ctx);
  }
});

// —— ctx.memory：长期记忆服务（从 main.mts 上收）——

test("MemoryService：队列写入、面板数据、编辑与删除，内置认知受保护", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, homeDir: dir, safeStorage: fakeSafeStorage() });
  try {
    assert.deepEqual(await ctx.memory.readSaved(), [], "初始队列为空");

    // 写入队列：落 memory.json 并去重
    const record = await ctx.memory.append({ content: "用户偏好先给结论再给细节", category: "preference", kind: "fact" }, dir, "");
    assert.ok(record?.id && record.content);
    const again = await ctx.memory.append({ content: "用户偏好先给结论再给细节", category: "preference", kind: "fact" }, dir, "");
    assert.equal(again.id, record.id, "同内容同维度应命中去重");
    assert.equal((await ctx.memory.readSaved()).length, 1);

    // 面板：内置模型认知始终有一张卡（只读伪页面）
    const pages = await ctx.memory.list();
    const builtinPage = pages.find((page) => page.relPath === "pages/builtin.md");
    assert.ok(builtinPage, "应始终展示内置模型认知");
    assert.ok(builtinPage.rows.length > 0);
    assert.ok(builtinPage.rows.every((row) => row.builtIn === true));
    // fromAgentResult：兼容 memories 数组与单条 memory
    assert.deepEqual(ctx.memory.fromAgentResult({ memories: [1, 2] }), [1, 2]);
    assert.deepEqual(ctx.memory.fromAgentResult({ memory: 3 }), [3]);
    assert.deepEqual(ctx.memory.fromAgentResult({}), []);

    // 编辑内置认知 → 写覆盖表而不是改发布内容
    const builtinId = builtinPage.rows[0].id;
    assert.equal((await ctx.memory.update({ id: builtinId, content: "被用户改过的内置认知" })).ok, true);
    const overrides = JSON.parse(await fs.readFile(path.join(dir, "memory-overrides.json"), "utf8"));
    assert.equal(overrides[builtinId].content, "被用户改过的内置认知");
    const afterEdit = (await ctx.memory.list()).find((page) => page.relPath === "pages/builtin.md");
    assert.ok(afterEdit.rows.some((row) => row.content === "被用户改过的内置认知"), "覆盖表应生效");

    // 内置记忆不可删除；队列记忆可删
    const denied = await ctx.memory.remove(builtinId);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /内置记忆不能删除/);
    assert.equal((await ctx.memory.remove(record.id)).ok, true);
    assert.deepEqual(await ctx.memory.readSaved(), []);

    // 编辑入参校验
    assert.equal((await ctx.memory.update({ content: "没有 id" })).ok, false);
    assert.equal((await ctx.memory.update({ id: record.id, content: "   " })).ok, false);
  } finally {
    await disposeHost(ctx);
  }
});

test("MemoryService：dispose 清掉整合定时器，不在退出后继续跑", async (t) => {
  const dir = await makeTmpDir(t);
  const ctx = await createHost({ userDataDir: dir, homeDir: dir, safeStorage: fakeSafeStorage() });
  await ctx.memory.append({ content: "触发一次整合排期", category: "preference", kind: "fact" }, dir, "");
  const service = ctx.get("memory");
  assert.ok(service.consolidationTimer, "append 后应有待运行的整合定时器");
  await disposeHost(ctx);
  assert.equal(service.consolidationTimer, null, "dispose 应清掉定时器");
});
