import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { builtinHooks, evaluateHooks, evaluateApproval, isReviewerEligible, runAgent } from "../electron/agent.mts";
import { unattendedApprovalMode, wakeApprovalMode } from "../electron/settings.mts";

const exec = promisify(execFile);
const prefixes = [
  "git", "env git", "env -u git git", "env -u -u git",
  "env -u --unset git", "env --unset=git git",
  "env -u git env -u -u git", "env -u -u nohup git",
];
const mutations = [
  "remote remove origin", "remote -v remove origin", "branch -m renamed",
  "branch -qD disposable", "reset --soft HEAD~1",
];
const reads = ["status", "diff --stat", "remote -v", "log --oneline -5"];

test("视频检查复合命令遵循完全访问与替我审批，不被删除关键字强制转人工", () => {
  const commands = [
    "cd /workspace/videos/today && rm -rf evidence/review && mkdir -p evidence/review && for t in 3.5 9.7; do ffmpeg -v error -ss $t -i renders/final-portrait.mp4 -frames:v 1 -y evidence/review/t${t}.png; done && ls -la ../_shared/.build/tools/",
    "cd /workspace/videos/today && rm -rf /tmp/zck && mkdir -p /tmp/zck && for t in 17.8 18.4; do ffmpeg -ss $t -i renders/final-portrait.mp4 -frames:v 1 -y /tmp/zck/c$t.png; done && ../_shared/.build/ocr-vision /tmp/zck/c17.8.png 2>&1 | head -8",
  ];
  for (const command of commands) {
    const args = { command };
    assert.equal(evaluateHooks(builtinHooks, "before_tool", "run_command", args), null);
    for (const approvalMode of [unattendedApprovalMode("full-access", "reviewer"), wakeApprovalMode("full-access", "reviewer")]) {
      assert.equal(evaluateApproval({ approvalMode, name: "run_command", args, hasExternalPaths: true }), "allow");
    }
    assert.equal(evaluateApproval({ approvalMode: "reviewer", name: "run_command", args, hasExternalPaths: true }), "ask");
    assert.equal(isReviewerEligible({ approvalMode: "reviewer", name: "run_command", args, forExternalPaths: true }), true);
  }
});

test("真实清理与重建：完全访问免审批，审核可放行，明确限制仍生效", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-cleanup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cases = [
    { label: "计划完全访问", mode: unattendedApprovalMode("full-access", "reviewer"), approved: true },
    { label: "续跑完全访问", mode: wakeApprovalMode("full-access", "reviewer"), approved: true, outside: true },
    { label: "自动审核放行", mode: "reviewer", review: "allow", approved: true },
    { label: "自动审核拒绝", mode: "reviewer", review: "deny" },
    { label: "自动审核不确定转人工", mode: "reviewer", review: "ask", asks: 1 },
    { label: "严格确认拒绝", mode: "interactive", asks: 1 },
    { label: "只读计划", mode: unattendedApprovalMode("full-access", "deny-changes") },
    { label: "用户明确限制", mode: "full-access", customHook: true, asks: 1 },
    { label: "敏感路径守卫", mode: "full-access", guard: true, asks: 1 },
  ];
  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.label, async () => {
      const workspace = path.join(root, `workspace-${index}`);
      const target = scenario.outside ? path.join(root, `outside-${index}`) : path.join(workspace, "review");
      await fs.mkdir(workspace, { recursive: true });
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, "old.txt"), "keep unless approved");
      const command = `cd '${workspace}' && rm -rf '${target}' && mkdir -p '${target}' && for t in 1 2; do printf checked > '${target}'/t$t.txt; done && ls '${target}'`;
      let step = 0;
      let approvals = 0;
      let reviews = 0;
      const result = await runAgent({
        settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "test" },
        workspacePath: workspace, approvalMode: scenario.mode, trustTempDirs: false,
        conversation: [{ role: "user", content: "清理本次检查的旧输出并生成新的检查文件" }],
        hooks: scenario.customHook ? [{ event: "before_tool", tool: "run_command", action: "require_approval", message: "用户要求逐次确认" }] : [],
        beforeToolExecute: scenario.guard ? async () => ({ action: "require_approval", message: "敏感文件保护" }) : undefined,
        requestApproval: async (action) => {
          approvals += 1;
          if (scenario.customHook) assert.match(action.details, /用户要求逐次确认/);
          if (scenario.guard) assert.match(action.details, /敏感文件保护/);
          return false;
        },
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          const system = String(body.messages?.[0]?.content || "");
          let message;
          if (system.includes("审批说明撰写助手")) message = { role: "assistant", content: "清理测试输出" };
          else if (system.includes("安全审核助手")) {
            reviews += 1;
            assert.ok(scenario.review, "不应额外启动审核");
            message = { role: "assistant", content: JSON.stringify({ decision: scenario.review, reason: "测试审核决定" }) };
          } else {
            assert.ok(step < 2, "不应重复请求操作");
            message = step++ === 0
              ? { role: "assistant", content: null, tool_calls: [{ id: "cleanup", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command }) } }] }
              : { role: "assistant", content: "检查结束。" };
          }
          return { ok: true, json: async () => ({ choices: [{ message }] }) };
        },
      });
      assert.equal(result.status, "done");
      assert.equal(approvals, scenario.asks || 0);
      assert.equal(reviews, scenario.review ? 1 : 0);
      assert.deepEqual((await fs.readdir(target)).sort(), scenario.approved ? ["t1.txt", "t2.txt"] : ["old.txt"]);
      if (scenario.approved) assert.equal(await fs.readFile(path.join(target, "t1.txt"), "utf8"), "checked");
    });
  }
});

test("安全审批组合矩阵：包装与取值变化不能绕过审批，正常查看仍可放行", () => {
  for (const approvalMode of ["reviewer", "auto"]) {
    for (const prefix of prefixes) {
      for (const [suffixes, expected] of [[mutations, "ask"], [reads, "allow"]]) {
        for (const suffix of suffixes) {
          const command = `${prefix} ${suffix}`;
          assert.equal(evaluateApproval({ approvalMode, name: "run_command", args: { command } }), expected, `${approvalMode}: ${command}`);
        }
      }
    }
  }
});

test("实际任务拒绝审批后保留远程配置、分支名称和提交位置", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-security-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await exec("git", args, { cwd: root })).stdout.trim();
  await git("init", "-q");
  await git("symbolic-ref", "HEAD", "refs/heads/fixture");
  for (const message of ["one", "two"]) {
    await git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", message);
  }
  await git("remote", "add", "origin", "https://example.invalid/fixture.git");
  const state = async () => Promise.all([git("remote"), git("branch", "--show-current"), git("rev-parse", "HEAD")]);
  const before = await state();
  for (const approvalMode of ["reviewer", "auto"]) {
    for (const suffix of ["remote remove origin", "branch -m renamed", "reset --soft HEAD~1"]) {
      await t.test(`${approvalMode}: ${suffix}`, async () => {
        const command = `env -u -u git ${suffix}`;
        const messages = [
          { role: "assistant", content: null, tool_calls: [{ id: "security-call", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command }) } }] },
          ...(approvalMode === "reviewer" ? [{ role: "assistant", content: '{"decision":"deny","reason":"测试拒绝危险操作"}' }] : []),
          { role: "assistant", content: "操作未获批准，已停止。" },
        ];
        let calls = 0;
        let approvals = 0;
        const result = await runAgent({
          settings: { endpoint: "http://mock.local/v1/chat/completions", model: "mock-model", apiKey: "test" },
          workspacePath: root, approvalMode, trustTempDirs: false,
          conversation: [{ role: "user", content: "检查审批保护" }],
          requestApproval: async () => { approvals += 1; return false; },
          fetchImpl: async (_url, options) => {
            // 「操作影响」说明是审批卡的旁路辅助调用：直接应答，不占主线脚本名额
            const body = JSON.parse(options.body);
            if (String(body.messages?.[0]?.content || "").includes("审批说明撰写助手")) {
              return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: "- 会变更 git 仓库状态" } }] }) };
            }
            assert.ok(calls < messages.length, "不应出现额外模型请求");
            return { ok: true, json: async () => ({ choices: [{ message: messages[calls++] }] }) };
          },
        });
        assert.equal(result.status, "done");
        assert.equal(calls, messages.length, "必须经过审核或人工审批，不能跳过后直接执行");
        assert.equal(approvals, approvalMode === "auto" ? 1 : 0);
        assert.deepEqual(await state(), before, "拒绝后真实仓库不得发生变化");
      });
    }
  }
});
