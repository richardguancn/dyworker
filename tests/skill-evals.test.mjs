import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradeCase,
  gradeWithModel,
  loadPromptsCsv,
  parseCsv,
  parseJsonFromText,
  prepareSkillWorkspace,
  runEvalCase,
  skillWasTriggered,
  summarize,
} from "../evals/lib/runner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evalsDir = path.join(repoRoot, "evals");
const skillSourceDir = path.join(evalsDir, "fixtures", "skills", "setup-demo-app");
const settings = { endpoint: "https://api.deepseek.com/responses", model: "deepseek-v4-flash", apiKey: "k" };

function mockResponsesFetch(scriptedResponses, calls = []) {
  return async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const response = scriptedResponses.length > 1 ? scriptedResponses.shift() : scriptedResponses[0];
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => response,
    };
  };
}

function functionCall(callId, name, args) {
  return { type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args) };
}

function messageResponse(text) {
  return {
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

async function makeArtifactsDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dyworker-eval-artifacts-"));
}

test("loadPromptsCsv 解析示例 prompt 集（含负向用例）", async () => {
  const rows = await loadPromptsCsv(path.join(evalsDir, "skills", "setup-demo-app.prompts.csv"));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].id, "test-01");
  assert.equal(rows[0].shouldTrigger, true);
  assert.match(rows[0].prompt, /setup-demo-app/);
  assert.equal(rows[3].id, "test-04");
  assert.equal(rows[3].shouldTrigger, false);
});

test("parseCsv 处理引号、逗号与转义", () => {
  const rows = parseCsv('id,should_trigger,prompt\na,true,"说 ""你好"", 然后继续"\nb,false,plain\n');
  assert.deepEqual(rows[1], ["a", "true", '说 "你好", 然后继续']);
  assert.deepEqual(rows[2], ["b", "false", "plain"]);
});

test("runEvalCase 无头跑通：load_skill 触发、trace JSONL 落盘可解析", async () => {
  const prepared = await prepareSkillWorkspace({ skillSourceDir });
  const targetSkill = prepared.skills.find((skill) => skill.name === "setup-demo-app");
  assert.ok(targetSkill, "应发现 setup-demo-app 技能");

  const artifactsDir = await makeArtifactsDir();
  const run = await runEvalCase({
    promptRow: { id: "case-mock", shouldTrigger: true, prompt: "搭建一个 demo 应用" },
    skillName: "setup-demo-app",
    settings,
    artifactsDir,
    workspaceDir: prepared.workspaceDir,
    fetchImpl: mockResponsesFetch([
      { output: [functionCall("c1", "load_skill", { skill_id: targetSkill.id })], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      { output: [functionCall("c2", "write_file", { path: "hello.txt", content: "hi" })], usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 } },
      messageResponse("已完成。"),
    ]),
  });

  assert.equal(run.result.status, "done");
  assert.equal(run.result.finalText, "已完成。");
  assert.equal(run.targetSkill.name, "setup-demo-app");
  assert.ok(skillWasTriggered(run.traces, run.targetSkill));

  const traceText = await fs.readFile(run.tracePath, "utf8");
  const traces = traceText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(traces.length > 0);
  assert.ok(traces.every((trace) => typeof trace.seq === "number" && typeof trace.kind === "string"));
  assert.ok(traces.some((trace) => trace.kind === "tool-call" && String(trace.title).includes("load_skill")));

  // write_file 确实写进了临时工作区
  assert.equal(await fs.readFile(path.join(prepared.workspaceDir, "hello.txt"), "utf8"), "hi");
});

test("gradeCase 触发判定矩阵与预算检查", () => {
  const skill = { id: "file:/tmp/skills/setup-demo-app/SKILL.md", name: "setup-demo-app" };
  const triggeredTrace = [{ kind: "tool-call", title: "调用工具 load_skill", content: `{"skill_id":"${skill.id}"}` }];
  const doneResult = { status: "done" };

  const hitExpected = gradeCase({ promptRow: { shouldTrigger: true }, result: doneResult, traces: triggeredTrace, targetSkill: skill });
  assert.equal(hitExpected.pass, true);

  const missedExpected = gradeCase({ promptRow: { shouldTrigger: true }, result: doneResult, traces: [], targetSkill: skill });
  assert.equal(missedExpected.pass, false);
  assert.equal(missedExpected.checks.find((check) => check.id === "skill-triggered").pass, false);

  const quietExpected = gradeCase({ promptRow: { shouldTrigger: false }, result: doneResult, traces: [], targetSkill: skill });
  assert.equal(quietExpected.pass, true);

  const falsePositive = gradeCase({ promptRow: { shouldTrigger: false }, result: doneResult, traces: triggeredTrace, targetSkill: skill });
  assert.equal(falsePositive.pass, false);

  const notDone = gradeCase({ promptRow: { shouldTrigger: true }, result: { status: "error" }, traces: triggeredTrace, targetSkill: skill });
  assert.equal(notDone.checks.find((check) => check.id === "status-done").pass, false);

  const thrashing = gradeCase({
    promptRow: { shouldTrigger: true },
    result: doneResult,
    traces: [
      ...triggeredTrace,
      ...Array.from({ length: 3 }, () => ({ kind: "tool-call", title: "调用工具 run_command", content: '{"command":"npm install"}' })),
    ],
    targetSkill: skill,
    budgets: { maxCommands: 2 },
  });
  assert.equal(thrashing.checks.find((check) => check.id === "command-count").pass, false);

  const overTokens = gradeCase({
    promptRow: { shouldTrigger: true },
    result: doneResult,
    traces: [...triggeredTrace, { kind: "token-usage", usage: { prompt: 100, completion: 50 } }],
    targetSkill: skill,
    budgets: { maxTokens: 100 },
  });
  assert.equal(overTokens.checks.find((check) => check.id === "token-budget").pass, false);

  const extra = gradeCase({
    promptRow: { shouldTrigger: true },
    result: doneResult,
    traces: triggeredTrace,
    targetSkill: skill,
    extraChecks: [{ id: "custom", run: () => ({ pass: false, notes: "自定义失败" }) }],
  });
  assert.equal(extra.checks.find((check) => check.id === "custom").notes, "自定义失败");
  assert.equal(extra.pass, false);
});

test("parseJsonFromText 支持裸 JSON、代码围栏与夹杂文本", () => {
  assert.deepEqual(parseJsonFromText('{"overall_pass":true}'), { overall_pass: true });
  assert.deepEqual(parseJsonFromText('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonFromText('前置说明 {"b":2} 后置'), { b: 2 });
  assert.equal(parseJsonFromText("没有 JSON"), null);
});

test("gradeWithModel 用第二轮只读运行产出结构化 rubric 结果", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-eval-rubric-"));
  const artifactsDir = await makeArtifactsDir();
  const rubric = { overall_pass: true, score: 90, checks: [{ id: "vite", pass: true, notes: "ok" }] };
  const graded = await gradeWithModel({
    workspaceDir,
    settings,
    schemaPath: path.join(evalsDir, "style-rubric.schema.json"),
    rubricPrompt: "评估这个仓库。",
    artifactsDir,
    caseId: "case-style",
    fetchImpl: mockResponsesFetch([messageResponse(JSON.stringify(rubric))]),
  });
  assert.deepEqual(graded.parsed, rubric);
  const written = JSON.parse(await fs.readFile(graded.outPath, "utf8"));
  assert.deepEqual(written, rubric);
});

test("summarize 有失败时设置退出码并打印逐项结果", () => {
  const previousExitCode = process.exitCode;
  try {
    const summary = summarize("setup-demo-app", [
      { id: "case-a", grade: { pass: true, checks: [{ id: "status-done", pass: true, notes: "" }] } },
      { id: "case-b", grade: { pass: false, checks: [{ id: "skill-triggered", pass: false, notes: "expected=true actual=false" }] } },
    ]);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.ok, false);
    assert.equal(process.exitCode, 1);
    assert.match(summary.output, /\[FAIL\] case-b/);
  } finally {
    process.exitCode = previousExitCode;
  }
});
