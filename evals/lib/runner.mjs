// Skill Evals 核心运行器：无头调用 electron/agent.mjs 的 runAgent，
// 捕获统一 trace 事件流落盘为 JSONL，再做确定性检查与可选的模型 rubric 评分。
// 不依赖 Electron，node --test 与 CLI 脚本均可直接复用。
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent } from "../../electron/agent.mjs";
import { discoverFileSkills } from "../../electron/skills.mjs";

// ===== Prompt 集（CSV）=====

export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
    if (inQuotes) {
      if (ch === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

// 每行 { id, shouldTrigger, prompt }；表头固定为 id,should_trigger,prompt
export async function loadPromptsCsv(csvPath) {
  const rows = parseCsv(await fs.readFile(csvPath, "utf8"));
  const header = (rows.shift() || []).map((cell) => cell.trim().toLowerCase());
  if (header[0] !== "id" || header[1] !== "should_trigger" || header[2] !== "prompt") {
    throw new Error(`${csvPath} 表头应为 id,should_trigger,prompt，实际为：${header.join(",")}`);
  }
  return rows.map((row, index) => {
    const [id = "", shouldTrigger = "", prompt = ""] = row;
    const flag = shouldTrigger.trim().toLowerCase();
    if (!id.trim() || !prompt.trim()) throw new Error(`${csvPath} 第 ${index + 2} 行缺少 id 或 prompt`);
    if (flag !== "true" && flag !== "false") {
      throw new Error(`${csvPath} 第 ${index + 2} 行 should_trigger 应为 true/false，实际为：${shouldTrigger}`);
    }
    return { id: id.trim(), shouldTrigger: flag === "true", prompt };
  });
}

// ===== 工作区准备：临时目录 + 安装被测 Skill =====

export async function prepareSkillWorkspace({ skillSourceDir = "", workspaceDir = "" } = {}) {
  const dir = workspaceDir || await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-eval-"));
  if (skillSourceDir) {
    const target = path.join(dir, ".agents", "skills", path.basename(skillSourceDir));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(skillSourceDir, target, { recursive: true, force: true });
  }
  const skills = await discoverFileSkills({ homeDir: "", workspacePath: dir });
  return { workspaceDir: dir, skills };
}

// ===== 运行单个评测用例，落盘 JSONL trace =====

export async function runEvalCase({
  promptRow,
  skillSourceDir = "",
  skillName = "",
  settings,
  artifactsDir,
  fetchImpl,
  workspaceDir = "",
  agentOptions = {},
}) {
  const prepared = await prepareSkillWorkspace({ skillSourceDir, workspaceDir });
  const targetSkill = prepared.skills.find((skill) => skill.name === skillName) || null;
  const traces = [];
  const events = [];
  const emit = (event) => {
    events.push(event);
    if (event?.type === "trace" && event.trace) traces.push(event.trace);
  };
  const result = await runAgent({
    settings,
    workspacePath: prepared.workspaceDir,
    conversation: [{ role: "user", content: promptRow.prompt }],
    skills: prepared.skills,
    approvalMode: "full-access",
    emit,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...agentOptions,
  });
  await fs.mkdir(artifactsDir, { recursive: true });
  const tracePath = path.join(artifactsDir, `${promptRow.id}.jsonl`);
  const body = traces.map((trace) => JSON.stringify(trace)).join("\n");
  await fs.writeFile(tracePath, body ? `${body}\n` : "", "utf8");
  return { result, events, traces, tracePath, workspaceDir: prepared.workspaceDir, targetSkill };
}

// ===== 确定性检查 =====

export function toolCallsOf(traces, toolName) {
  return (traces || []).filter(
    (trace) => trace?.kind === "tool-call" && String(trace.title || "").includes(toolName),
  );
}

export function skillWasTriggered(traces, skill) {
  if (!skill) return false;
  return toolCallsOf(traces, "load_skill").some((trace) => String(trace.content || "").includes(String(skill.id)));
}

// extraChecks: [{ id, run({ result, traces, workspaceDir, targetSkill }) => boolean | { pass, notes } }]
// budgets: { maxCommands, maxTokens }
export function gradeCase({
  promptRow,
  result,
  traces,
  workspaceDir = "",
  targetSkill = null,
  extraChecks = [],
  budgets = {},
}) {
  const checks = [];
  const push = (id, pass, notes = "") => checks.push({ id, pass: Boolean(pass), notes: String(notes) });

  push("status-done", result?.status === "done", `status=${result?.status || "unknown"}`);

  if (promptRow && promptRow.shouldTrigger !== undefined) {
    const triggered = skillWasTriggered(traces, targetSkill);
    push(
      "skill-triggered",
      triggered === Boolean(promptRow.shouldTrigger),
      `expected=${Boolean(promptRow.shouldTrigger)} actual=${triggered}`,
    );
  }

  const commandCount = toolCallsOf(traces, "run_command").length;
  const maxCommands = Number(budgets.maxCommands) || 60;
  push("command-count", commandCount <= maxCommands, `${commandCount} 次命令（上限 ${maxCommands}）`);

  const usage = (traces || [])
    .filter((trace) => trace?.kind === "token-usage" && trace.usage)
    .reduce(
      (acc, trace) => ({
        prompt: acc.prompt + (Number(trace.usage.prompt) || 0),
        completion: acc.completion + (Number(trace.usage.completion) || 0),
      }),
      { prompt: 0, completion: 0 },
    );
  const maxTokens = Number(budgets.maxTokens) || Infinity;
  push(
    "token-budget",
    usage.prompt + usage.completion <= maxTokens,
    `prompt=${usage.prompt} completion=${usage.completion}${Number.isFinite(maxTokens) ? `（上限 ${maxTokens}）` : ""}`,
  );

  for (const check of extraChecks) {
    try {
      const outcome = check.run({ result, traces, workspaceDir, targetSkill });
      if (typeof outcome === "object" && outcome !== null) push(check.id, outcome.pass, outcome.notes);
      else push(check.id, outcome);
    } catch (error) {
      push(check.id, false, error instanceof Error ? error.message : String(error));
    }
  }

  return { checks, pass: checks.every((check) => check.pass) };
}

// ===== 基于 rubric 的模型评分（只读第二轮）=====

export function parseJsonFromText(text) {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch {
    // fall through
  }
  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  return null;
}

export async function gradeWithModel({
  workspaceDir,
  settings,
  schemaPath,
  rubricPrompt,
  artifactsDir,
  caseId,
  fetchImpl,
  agentOptions = {},
}) {
  const schemaText = await fs.readFile(schemaPath, "utf8");
  const prompt = [
    rubricPrompt,
    "只输出一个符合以下 JSON Schema 的 JSON 对象，不要输出任何其他文字，也不要包 markdown 代码围栏：",
    schemaText,
  ].join("\n\n");
  const result = await runAgent({
    settings,
    workspacePath: workspaceDir,
    conversation: [{ role: "user", content: prompt }],
    approvalMode: "deny-changes",
    ...(fetchImpl ? { fetchImpl } : {}),
    ...agentOptions,
  });
  const parsed = parseJsonFromText(result.finalText);
  await fs.mkdir(artifactsDir, { recursive: true });
  const outPath = path.join(artifactsDir, `${caseId}.style.json`);
  await fs.writeFile(
    outPath,
    JSON.stringify(
      parsed ?? { overall_pass: false, score: 0, checks: [], parse_error: String(result.finalText || "").slice(0, 2000) },
      null,
      2,
    ),
    "utf8",
  );
  return { parsed, outPath, finalText: result.finalText };
}

// ===== 汇总 =====

export function summarize(skillName, caseResults) {
  const lines = [];
  let passed = 0;
  for (const item of caseResults) {
    const marks = item.grade.checks.map((check) => `${check.id}:${check.pass ? "✓" : "✗"}`).join(" ");
    lines.push(`[${item.grade.pass ? "PASS" : "FAIL"}] ${item.id} — ${marks}`);
    for (const check of item.grade.checks) {
      if (!check.pass) lines.push(`       ${check.id}: ${check.notes}`);
    }
    if (item.style) lines.push(`       rubric: overall_pass=${item.style.overall_pass} score=${item.style.score}`);
    if (item.grade.pass) passed += 1;
  }
  lines.push(`\n${skillName}: ${passed}/${caseResults.length} 通过`);
  const output = lines.join("\n");
  console.log(output);
  const ok = caseResults.length > 0 && passed === caseResults.length;
  if (!ok) process.exitCode = 1;
  return { total: caseResults.length, passed, failed: caseResults.length - passed, ok, output };
}
