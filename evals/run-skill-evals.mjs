// Skill Evals CLI：参考 OpenAI《用 Evals 系统化测试 Agent Skills》的闭环——
// Prompt 集（CSV）→ 无头运行 Agent + 落盘 JSONL trace → 确定性检查 → 可选模型 rubric 评分。
// 手动运行：node evals/run-skill-evals.mjs <skill-name> [--case <id>]... [--rubric]
// 需要环境变量：DYWORKER_EVAL_ENDPOINT / DYWORKER_EVAL_API_KEY / DYWORKER_EVAL_MODEL
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gradeCase, gradeWithModel, loadPromptsCsv, runEvalCase, summarize } from "./lib/runner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const skillName = args.find((arg) => !arg.startsWith("--"));
const caseFilter = [];
let rubricEnabled = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--case" && args[index + 1]) {
    caseFilter.push(args[index + 1]);
    index += 1;
  } else if (args[index] === "--rubric") {
    rubricEnabled = true;
  }
}

if (!skillName) {
  console.error("用法: node evals/run-skill-evals.mjs <skill-name> [--case <id>]... [--rubric]");
  process.exit(1);
}

const settings = {
  endpoint: process.env.DYWORKER_EVAL_ENDPOINT || "",
  apiKey: process.env.DYWORKER_EVAL_API_KEY || "",
  model: process.env.DYWORKER_EVAL_MODEL || "",
};
if (!settings.endpoint || !settings.apiKey || !settings.model) {
  console.error("缺少评测模型配置：请设置 DYWORKER_EVAL_ENDPOINT / DYWORKER_EVAL_API_KEY / DYWORKER_EVAL_MODEL");
  process.exit(1);
}

const skillSourceDir = path.join(repoRoot, "evals", "fixtures", "skills", skillName);
const promptsCsvPath = path.join(repoRoot, "evals", "skills", `${skillName}.prompts.csv`);
const checksPath = path.join(repoRoot, "evals", "skills", `${skillName}.checks.mjs`);
const schemaPath = path.join(repoRoot, "evals", "style-rubric.schema.json");
const artifactsDir = path.join(repoRoot, "evals", "artifacts", skillName);

if (!existsSync(skillSourceDir)) {
  console.error(`未找到被测 Skill 目录：${skillSourceDir}`);
  process.exit(1);
}

const promptRows = await loadPromptsCsv(promptsCsvPath);
const selectedRows = caseFilter.length ? promptRows.filter((row) => caseFilter.includes(row.id)) : promptRows;
if (!selectedRows.length) {
  console.error(`没有匹配的评测用例（--case ${caseFilter.join(", ")}）`);
  process.exit(1);
}

const checksModule = existsSync(checksPath) ? await import(pathToFileURL(checksPath).href) : {};
const extraChecks = Array.isArray(checksModule.checks) ? checksModule.checks : [];
const rubricPrompt = String(checksModule.rubricPrompt || "评估当前工作区的产出是否满足该技能的完成标准。");

const caseResults = [];
for (const promptRow of selectedRows) {
  console.error(`[evals] 运行 ${promptRow.id}（should_trigger=${promptRow.shouldTrigger}）…`);
  const run = await runEvalCase({
    promptRow,
    skillSourceDir,
    skillName,
    settings,
    artifactsDir,
  });
  if (!run.targetSkill) {
    console.error(`[evals] 工作区内未发现名为「${skillName}」的 Skill，请检查 evals/fixtures/skills/${skillName}/SKILL.md`);
    process.exit(1);
  }
  console.error(`[evals] ${promptRow.id} 结束：status=${run.result.status}，trace → ${run.tracePath}`);
  // 负向用例（不应触发）只校验触发行为与通用检查，文件类检查没有意义
  const grade = gradeCase({
    promptRow,
    result: run.result,
    traces: run.traces,
    workspaceDir: run.workspaceDir,
    targetSkill: run.targetSkill,
    extraChecks: promptRow.shouldTrigger ? extraChecks : [],
  });
  let style = null;
  if (rubricEnabled && promptRow.shouldTrigger) {
    console.error(`[evals] ${promptRow.id} 进入 rubric 评分…`);
    const graded = await gradeWithModel({
      workspaceDir: run.workspaceDir,
      settings,
      schemaPath,
      rubricPrompt,
      artifactsDir,
      caseId: promptRow.id,
    });
    style = graded.parsed;
    console.error(`[evals] ${promptRow.id} rubric → ${graded.outPath}`);
  }
  caseResults.push({ id: promptRow.id, grade, style });
}

summarize(skillName, caseResults);
