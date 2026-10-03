// 插件工具的受管链路：命名由宿主生成、风险不降级、内部调用被拒、全程留痕。
//
// 对应目标第 (6) 项：插件自称"只读"不能作为唯一授权依据；插件在加载时、
// 后台计时器或内部互调产生的副作用同样受管。
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost, disposeHost } from "../electron/host/context.mts";
import { classify, RISK } from "../electron/risk.mts";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-tools-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
  return dir;
}

async function hostWithTools(t) {
  const dir = await tempDir(t);
  const ctx = await createHost({ userDataDir: dir });
  t.after(async () => { await disposeHost(ctx); });
  return { dir, ctx };
}

async function auditLines(dir) {
  try {
    const text = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
    return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

// ---- 风险分级：未识别命名空间一律按有副作用 ----

test("风险分级：插件/未识别命名空间工具按有副作用处理（不能默认放行）", () => {
  for (const name of ["plugin__demo__write", "dsh__sample__write", "whatever__do_thing"]) {
    const info = classify(name, {});
    assert.equal(info.consequential, true, `${name} 必须是有副作用`);
    assert.equal(info.risk, RISK.EXTERNAL, `${name} 的风险等级`);
  }
  // 已知命名空间保持原行为
  assert.equal(classify("browser__read", {}).consequential, false);
  assert.equal(classify("browser__click", {}).consequential, true);
  assert.equal(classify("mcp__server__tool", {}).consequential, true);
  // 无命名空间的内置只读工具不受影响
  assert.equal(classify("read_file", {}).consequential, false);
});

// ---- 注册：宿主生成名字、保护内置名、归属清晰 ----

test("注册：工具名由宿主生成（plugin__<插件>__<工具>），插件无法自选", async (t) => {
  const { ctx } = await hostWithTools(t);
  ctx.tools.register({ plugin: "demo-plugin", name: "do_thing", handler: async () => "ok" });
  const list = ctx.tools.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "plugin__demo_plugin__do_thing");
  assert.equal(list[0].owner, "demo-plugin");
  assert.ok(ctx.tools.owns("plugin__demo_plugin__do_thing"));
});

test("注册：不能用保留前缀冒充内置工具，也不能重复注册", async (t) => {
  const { ctx } = await hostWithTools(t);
  assert.throws(() => ctx.tools.register({ plugin: "p", name: "browser__read", handler: async () => 1 }), /保留前缀/);
  assert.throws(() => ctx.tools.register({ plugin: "p", name: "mcp__x", handler: async () => 1 }), /保留前缀/);
  ctx.tools.register({ plugin: "p", name: "same", handler: async () => 1 });
  assert.throws(() => ctx.tools.register({ plugin: "p", name: "same", handler: async () => 2 }), /已注册/);
  // 另一个插件用同名也不会撞（前缀不同）
  ctx.tools.register({ plugin: "q", name: "same", handler: async () => 3 });
  assert.equal(ctx.tools.list().length, 2);
});

test("注册：缺少必要字段直接拒绝", async (t) => {
  const { ctx } = await hostWithTools(t);
  assert.throws(() => ctx.tools.register({ name: "x", handler: async () => 1 }), /plugin/);
  assert.throws(() => ctx.tools.register({ plugin: "p", handler: async () => 1 }), /name/);
  assert.throws(() => ctx.tools.register({ plugin: "p", name: "x" }), /handler/);
});

test("注册：注销后工具消失（ctx.effect 绑定生命周期）", async (t) => {
  const { ctx } = await hostWithTools(t);
  const off = ctx.tools.register({ plugin: "p", name: "temp", handler: async () => 1 });
  assert.equal(ctx.tools.list().length, 1);
  off();
  assert.equal(ctx.tools.list().length, 0);
});

// ---- 风险不降级 ----

test("风险：插件自称只读不能降低宿主判定（声明只能抬高）", async (t) => {
  const { ctx } = await hostWithTools(t);
  ctx.tools.register({ plugin: "p", name: "sneaky", risk: RISK.READ, handler: async () => 1 });
  const entry = ctx.tools.list()[0];
  assert.equal(entry.declaredRisk, RISK.READ, "插件的声明被记录");
  assert.equal(entry.risk, RISK.EXTERNAL, "但实际风险仍是宿主判定的有副作用");
  assert.equal(entry.consequential, true);
  // 反过来：插件声明更高风险时按更高的来
  ctx.tools.register({ plugin: "p", name: "danger", risk: RISK.EXEC, handler: async () => 1 });
  const danger = ctx.tools.list().find((tool) => tool.plainName === "danger");
  assert.equal(danger.risk, RISK.EXEC);
});

// ---- 执行：内部调用要受管、全程留痕 ----

test("执行：非任务路径调用有副作用工具被拒绝，并留审计", async (t) => {
  const { dir, ctx } = await hostWithTools(t);
  let called = false;
  ctx.tools.register({ plugin: "p", name: "write_thing", handler: async () => { called = true; return 1; } });

  const denied = await ctx.tools.execute("plugin__p__write_thing", {}, { source: "internal" });
  assert.equal(denied.ok, false);
  assert.equal(denied.blocked, true);
  assert.match(denied.error, /非任务路径/);
  assert.equal(called, false, "被拒绝的调用不能真的执行");

  const lines = await auditLines(dir);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].decision, "blocked");
  assert.equal(lines[0].tool, "plugin__p__write_thing");
  assert.match(lines[0].riskClass, /external/);
});

test("执行：任务路径（已经过审批链）允许执行，并留 executed 审计", async (t) => {
  const { dir, ctx } = await hostWithTools(t);
  ctx.tools.register({ plugin: "p", name: "write_thing", handler: async (args) => ({ echoed: args.n }) });

  const result = await ctx.tools.execute("plugin__p__write_thing", { n: 7 }, { source: "agent", sessionId: "s1", runId: "r1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { echoed: 7 });

  const lines = await auditLines(dir);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].decision, "executed");
  assert.equal(lines[0].sessionId, "s1");
});

test("执行：handler 抛错被兜住，记 failed 审计并返回错误", async (t) => {
  const { dir, ctx } = await hostWithTools(t);
  ctx.tools.register({ plugin: "p", name: "boom", handler: async () => { throw new Error("炸了"); } });
  const result = await ctx.tools.execute("plugin__p__boom", {}, { source: "agent" });
  assert.equal(result.ok, false);
  assert.match(result.error, /炸了/);
  const lines = await auditLines(dir);
  assert.equal(lines[0].decision, "failed");
});

test("执行：未知工具返回明确错误", async (t) => {
  const { ctx } = await hostWithTools(t);
  const result = await ctx.tools.execute("plugin__nobody__nothing", {}, { source: "agent" });
  assert.equal(result.ok, false);
  assert.match(result.error, /未知工具/);
});

// ---- 模型可见的工具面 ----

test("工具定义：与内置/MCP 同形，且名字带插件前缀", async (t) => {
  const { ctx } = await hostWithTools(t);
  ctx.tools.register({
    plugin: "demo-plugin", name: "lookup", description: "查东西",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    handler: async () => "x",
  });
  const defs = ctx.tools.definitions();
  assert.equal(defs.length, 1);
  assert.equal(defs[0].type, "function");
  assert.equal(defs[0].function.name, "plugin__demo_plugin__lookup");
  assert.equal(defs[0].function.description, "查东西");
  assert.deepEqual(defs[0].function.parameters.required, ["q"]);
});

// ---- 与审批链的集成：插件工具在只读/自动模式下都必须问 ----

test("审批链：插件工具在只读模式被拒绝、在交互/自动模式要求确认", async () => {
  const { evaluateApproval } = await import("../electron/agent.mts");
  const tool = "plugin__demo_plugin__write_thing";

  // 只读模式（deny-changes）：有副作用 → 直接拒绝
  assert.equal(evaluateApproval({ approvalMode: "deny-changes", name: tool }), "deny");
  // 交互模式：需要用户确认（不是静默放行）
  assert.equal(evaluateApproval({ approvalMode: "interactive", name: tool }), "ask");
  // 替我审批模式：同样要问，不能因为"是插件工具"就自动过
  assert.equal(evaluateApproval({ approvalMode: "reviewer", name: tool }), "ask");
  // 常驻规则是唯一的出口：用户显式"始终允许这个插件工具"时才放行（kind: "plugin-tool"）
  // 且只读模式仍不被覆盖（deny-changes 在常驻规则之前判定）
  assert.equal(
    evaluateApproval({ approvalMode: "interactive", name: tool, standingRules: [{ kind: "plugin-tool", pattern: tool }] }),
    "allow",
  );
  // 对照：内置只读工具在只读模式仍放行，说明加固没有误伤
  assert.equal(evaluateApproval({ approvalMode: "deny-changes", name: "read_file" }), "allow");
});
