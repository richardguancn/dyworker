// electron/git.mjs 的分支管理与提交推送测试（真实临时仓库）
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { gitCheckout, gitCommit, gitCreateBranch, gitDiffStats, gitDiscard, gitFileDiff, gitPush, gitReviewOverview, gitStage, listGitBranches } from "../electron/git.mjs";

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-git-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-b", "main");
  // Windows 上系统级 core.autocrlf 默认开启，会让 checkout 把 LF 换成 CRLF，
  // 破坏「恢复到提交内容」这类字节级断言；临时仓库统一关闭保证跨平台一致。
  git("config", "core.autocrlf", "false");
  git("config", "user.email", "test@dyworker.local");
  git("config", "user.name", "DYWorker Test");
  await fs.writeFile(path.join(root, "a.txt"), "hello\n", "utf8");
  git("add", "-A");
  git("commit", "-m", "init");
  return root;
}

test("非 git 目录优雅降级", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-notgit-"));
  const info = await listGitBranches(root);
  assert.equal(info.isRepo, false);
  assert.deepEqual(info.branches, []);
  const stats = await gitDiffStats(root);
  assert.equal(stats.isRepo, false);
  const commit = await gitCommit(root, { message: "x", includeUnstaged: true });
  assert.equal(commit.ok, false);
  const push = await gitPush(root);
  assert.equal(push.ok, false);
});

test("分支列表返回当前分支、全部分支与未提交数", async () => {
  const root = await makeRepo();
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("branch", "feature");
  await fs.writeFile(path.join(root, "b.txt"), "new\n", "utf8");
  const info = await listGitBranches(root);
  assert.equal(info.isRepo, true);
  assert.equal(info.current, "main");
  assert.deepEqual(info.branches.sort(), ["feature", "main"]);
  assert.equal(info.uncommitted, 1);
  assert.equal(info.hasRemote, false);
});

test("切换分支与创建并检出新分支", async () => {
  const root = await makeRepo();
  const created = await gitCreateBranch(root, "feat/login");
  assert.equal(created.ok, true);
  assert.equal((await listGitBranches(root)).current, "feat/login");
  const back = await gitCheckout(root, "main");
  assert.equal(back.ok, true);
  assert.equal((await listGitBranches(root)).current, "main");
  assert.equal((await gitCreateBranch(root, "bad name!!")).ok, false);
  assert.equal((await gitCheckout(root, "-D")).ok, false, "分支名不得以 - 开头");
});

test("diff 统计覆盖未暂存改动与未跟踪文件", async () => {
  const root = await makeRepo();
  await fs.writeFile(path.join(root, "a.txt"), "hello\nworld\n", "utf8");
  await fs.writeFile(path.join(root, "new.txt"), "n\n", "utf8");
  const stats = await gitDiffStats(root);
  assert.equal(stats.isRepo, true);
  assert.equal(stats.added, 1);
  assert.equal(stats.untracked, 1);
});

test("提交：留空信息自动生成，包含未暂存更改", async () => {
  const root = await makeRepo();
  await fs.writeFile(path.join(root, "notes.md"), "n\n", "utf8");
  const result = await gitCommit(root, { message: "", includeUnstaged: true });
  assert.equal(result.ok, true);
  assert.match(result.message, /notes\.md/);
  const log = execFileSync("git", ["-C", root, "log", "--oneline"], { encoding: "utf8" });
  assert.match(log, /notes\.md/);
  const again = await gitCommit(root, { message: "", includeUnstaged: true });
  assert.equal(again.ok, false, "没有改动时不应重复提交");
});

test("无远程仓库时推送给出明确提示", async () => {
  const root = await makeRepo();
  const result = await gitPush(root);
  assert.equal(result.ok, false);
  assert.match(result.error, /远程/);
});

test("推送到本地裸仓库并自动设置 upstream", async () => {
  const root = await makeRepo();
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-bare-"));
  execFileSync("git", ["init", "--bare", bare], { encoding: "utf8" });
  execFileSync("git", ["-C", root, "remote", "add", "origin", bare], { encoding: "utf8" });
  const result = await gitPush(root);
  assert.equal(result.ok, true, result.error || "");
  const remoteLog = execFileSync("git", ["--git-dir", bare, "log", "--oneline", "main"], { encoding: "utf8" });
  assert.match(remoteLog, /init/);
});

test("审阅总览：跟踪改动按状态与增删行数列出，未跟踪文件计为 U", async () => {
  const root = await makeRepo();
  await fs.writeFile(path.join(root, "a.txt"), "hello\nworld\n", "utf8");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "new.txt"), "one\ntwo\n", "utf8");
  const overview = await gitReviewOverview(root, "HEAD");
  assert.equal(overview.isRepo, true);
  assert.equal(overview.current, "main");
  const modified = overview.files.find((file) => file.path === "a.txt");
  assert.equal(modified?.status, "M");
  assert.equal(modified?.added, 1);
  assert.equal(modified?.removed, 0);
  const untracked = overview.files.find((file) => file.path === "src/new.txt");
  assert.equal(untracked?.status, "U");
  assert.equal(untracked?.added, 2);
  assert.equal(overview.totals.added, 3);
});

test("审阅总览：非 git 目录优雅降级，基线含 upstream 时可对比", async () => {
  const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-review-notgit-"));
  const degraded = await gitReviewOverview(notRepo, "HEAD");
  assert.equal(degraded.isRepo, false);
  const root = await makeRepo();
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-bare-"));
  execFileSync("git", ["init", "--bare", bare], { encoding: "utf8" });
  execFileSync("git", ["-C", root, "remote", "add", "origin", bare], { encoding: "utf8" });
  await gitPush(root);
  // 提交一个不推送的提交，再与 upstream 对比
  await fs.writeFile(path.join(root, "ahead.txt"), "ahead\n", "utf8");
  execFileSync("git", ["-C", root, "add", "-A"], { encoding: "utf8" });
  execFileSync("git", ["-C", root, "commit", "-m", "ahead"], { encoding: "utf8" });
  const overview = await gitReviewOverview(root, "origin/main");
  assert.equal(overview.upstream, "origin/main");
  assert.equal(overview.base, "origin/main");
  const ahead = overview.files.find((file) => file.path === "ahead.txt");
  assert.equal(ahead?.status, "A");
});

test("单文件 diff：跟踪文件走基线对比，未跟踪文件与 /dev/null 对比", async () => {
  const root = await makeRepo();
  await fs.writeFile(path.join(root, "a.txt"), "hello\nworld\n", "utf8");
  const tracked = await gitFileDiff(root, "HEAD", "a.txt", false);
  assert.equal(tracked.ok, true);
  assert.match(tracked.diff, /\+world/);
  await fs.writeFile(path.join(root, "fresh.txt"), "brand new\n", "utf8");
  const untracked = await gitFileDiff(root, "HEAD", "fresh.txt", true);
  assert.equal(untracked.ok, true);
  assert.match(untracked.diff, /\+brand new/);
  // 内容里合法出现 "GIT binary patch" 字样的文本文件不应被误判为二进制
  await fs.writeFile(path.join(root, "notes.txt"), 'const re = /GIT binary patch/.test(x);\n', "utf8");
  const notBinary = await gitFileDiff(root, "HEAD", "notes.txt", true);
  assert.equal(notBinary.ok, true);
  assert.equal(notBinary.binary, false);
  assert.match(notBinary.diff, /GIT binary patch/);
  const rejected = await gitFileDiff(root, "HEAD", "../outside.txt", false);
  assert.equal(rejected.ok, false, "路径穿越必须拒绝");
});

test("暂存：git add 指定文件后进入暂存区", async () => {
  const root = await makeRepo();
  await fs.writeFile(path.join(root, "a.txt"), "hello\nworld\n", "utf8");
  await fs.writeFile(path.join(root, "new.txt"), "n\n", "utf8");
  const result = await gitStage(root, ["a.txt", "new.txt"]);
  assert.equal(result.ok, true, result.error || "");
  const porcelain = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  assert.match(porcelain, /^M  a\.txt/m, "a.txt 应已暂存");
  assert.match(porcelain, /^A  new\.txt/m, "new.txt 应已暂存");
});

test("放弃：已跟踪文件恢复到 HEAD，未跟踪文件被删除", async () => {
  const root = await makeRepo();
  await fs.writeFile(path.join(root, "a.txt"), "hello\nchanged\n", "utf8");
  await fs.writeFile(path.join(root, "new.txt"), "n\n", "utf8");
  const result = await gitDiscard(root, ["a.txt", "new.txt"]);
  assert.equal(result.ok, true, result.error || "");
  assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "hello\n", "已跟踪文件应恢复到提交内容");
  await assert.rejects(fs.stat(path.join(root, "new.txt")), "未跟踪文件应被删除");
});

test("放弃：非 git 目录优雅降级", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-notgit-"));
  const result = await gitDiscard(root, ["a.txt"]);
  assert.equal(result.ok, false);
});
