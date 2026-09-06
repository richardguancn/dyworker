import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { evaluateApproval, runAgent } from "../electron/agent.mjs";

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
          fetchImpl: async () => {
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
