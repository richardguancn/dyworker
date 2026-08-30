// 工作区 Git 操作：分支列表/切换/新建、提交与推送、变更统计。
// 全部通过系统 git 命令完成，非 git 仓库或未安装 git 时优雅降级。
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

// 审阅 diff 上限：超过则只保留前若干字符，避免超大 diff 拖垮渲染进程
const REVIEW_DIFF_MAX_CHARS = 400 * 1024;
const UNTRACKED_COUNT_MAX_BYTES = 512 * 1024;
// 仓库还没有任何提交时，以空树作为对比基线
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function runGit(root, args, { timeout = 8000, allowExitCodes = [0] } = {}) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, ...args],
      {
        encoding: "utf8",
        timeout,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        // 推送/拉取缺凭据时不要弹终端交互，直接报错返回
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : (error ? -1 : 0);
        resolve({
          ok: allowExitCodes.includes(code),
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          message: String(stderr || stdout || (error ? error.message : "")).trim(),
        });
      },
    );
  });
}

export async function isGitRepo(root) {
  const result = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout.trim() === "true";
}

async function readPorcelain(root) {
  const result = await runGit(root, ["status", "--porcelain"]);
  return result.ok ? result.stdout.split("\n").filter(Boolean) : [];
}

export async function listGitBranches(root) {
  if (!root || !(await isGitRepo(root))) return { isRepo: false, current: "", branches: [], uncommitted: 0, hasRemote: false };
  const [currentResult, listResult, remoteResult, porcelain] = await Promise.all([
    runGit(root, ["branch", "--show-current"]),
    runGit(root, ["branch", "--format=%(refname:short)"]),
    runGit(root, ["remote"]),
    readPorcelain(root),
  ]);
  const current = currentResult.stdout.trim();
  const branches = listResult.stdout.split("\n").map((name) => name.trim()).filter(Boolean);
  return {
    isRepo: true,
    // detached HEAD 时 current 为空，退化为显示第一个分支之外的标记
    current: current || "HEAD",
    branches,
    uncommitted: porcelain.length,
    hasRemote: Boolean(remoteResult.stdout.trim()),
  };
}

export async function gitCheckout(root, name) {
  const branch = String(name || "").trim();
  if (!branch || branch.startsWith("-")) return { ok: false, error: "分支名不合法" };
  const result = await runGit(root, ["checkout", branch], { timeout: 15000 });
  return result.ok ? { ok: true } : { ok: false, error: result.message || "切换分支失败" };
}

export async function gitCreateBranch(root, name) {
  const branch = String(name || "").trim();
  if (!branch || branch.startsWith("-")) return { ok: false, error: "分支名不合法" };
  const check = await runGit(root, ["check-ref-format", "--branch", branch]);
  if (!check.ok) return { ok: false, error: "分支名不合法" };
  const result = await runGit(root, ["checkout", "-b", branch], { timeout: 15000 });
  return result.ok ? { ok: true } : { ok: false, error: result.message || "创建分支失败" };
}

// 相对 HEAD 的变更统计（暂存+未暂存）；未跟踪文件 git diff 看不到，单独计数
export async function gitDiffStats(root) {
  if (!root || !(await isGitRepo(root))) return { isRepo: false, added: 0, removed: 0, files: 0, untracked: 0 };
  let diff = await runGit(root, ["diff", "--shortstat", "HEAD"]);
  if (!diff.ok) {
    // 仓库还没有任何提交（无 HEAD），退化为暂存区统计
    diff = await runGit(root, ["diff", "--shortstat", "--cached"]);
  }
  const text = diff.stdout.trim();
  const files = Number(text.match(/(\d+) files? changed/)?.[1] || 0);
  const added = Number(text.match(/(\d+) insertions?/)?.[1] || 0);
  const removed = Number(text.match(/(\d+) deletions?/)?.[1] || 0);
  const porcelain = await readPorcelain(root);
  const untracked = porcelain.filter((line) => line.startsWith("??")).length;
  return { isRepo: true, added, removed, files, untracked };
}

// 留空提交信息时由 AI 生成：收集改动统计 + 截断的 diff 正文作为素材；
// 未跟踪文件 git diff 看不到，单独列名
export async function gitCommitDiff(root) {
  if (!root || !(await isGitRepo(root))) return null;
  const porcelain = await readPorcelain(root);
  if (!porcelain.length) return null;
  let stat = await runGit(root, ["diff", "--stat", "HEAD"], { timeout: 20000 });
  let diff = await runGit(root, ["diff", "HEAD"], { timeout: 20000 });
  if (!diff.ok) {
    // 仓库还没有任何提交（无 HEAD）：退化为暂存区统计
    stat = await runGit(root, ["diff", "--stat", "--cached"], { timeout: 20000 });
    diff = await runGit(root, ["diff", "--cached"], { timeout: 20000 });
  }
  const untracked = porcelain.filter((line) => line.startsWith("??")).map((line) => line.slice(3).trim());
  const COMMIT_DIFF_MAX_CHARS = 16000;
  return {
    stat: stat.stdout.trim(),
    untracked,
    diff: diff.stdout.slice(0, COMMIT_DIFF_MAX_CHARS),
    truncated: diff.stdout.length > COMMIT_DIFF_MAX_CHARS,
  };
}

// 留空提交信息时自动生成：概括改动的文件
async function autoCommitMessage(root) {
  const porcelain = await readPorcelain(root);
  const names = porcelain
    .map((line) => line.slice(3).trim())
    .map((entry) => entry.includes(" -> ") ? entry.split(" -> ").pop() : entry)
    .filter(Boolean);
  if (!names.length) return "";
  const short = (file) => {
    const parts = file.split(/[\\/]/);
    return parts[parts.length - 1] || file;
  };
  if (names.length === 1) return `更新 ${short(names[0])}`;
  return `更新 ${short(names[0])} 等 ${names.length} 个文件`;
}

export async function gitCommit(root, { message = "", includeUnstaged = true } = {}) {
  if (!root || !(await isGitRepo(root))) return { ok: false, error: "当前工作目录不是 Git 仓库" };
  if (includeUnstaged) {
    const add = await runGit(root, ["add", "-A"], { timeout: 15000 });
    if (!add.ok) return { ok: false, error: add.message || "暂存更改失败" };
  }
  let finalMessage = String(message || "").trim();
  if (!finalMessage) finalMessage = await autoCommitMessage(root);
  if (!finalMessage) return { ok: false, error: "没有需要提交的更改" };
  const result = await runGit(root, ["commit", "-m", finalMessage], { timeout: 30000 });
  if (!result.ok) {
    if (/nothing to commit|无变更|nothing added/i.test(result.message)) return { ok: false, error: "没有需要提交的更改" };
    return { ok: false, error: result.message || "提交失败" };
  }
  return { ok: true, message: finalMessage };
}

// 暂存：git add 指定文件（审阅面板「暂存」入口）
export async function gitStage(root, paths) {
  if (!root || !(await isGitRepo(root))) return { ok: false, error: "当前工作目录不是 Git 仓库" };
  const list = (Array.isArray(paths) ? paths : [paths]).map((item) => String(item || "").trim()).filter(Boolean);
  if (!list.length) return { ok: false, error: "缺少要暂存的文件" };
  const result = await runGit(root, ["add", "--", ...list], { timeout: 15000 });
  return result.ok ? { ok: true } : { ok: false, error: result.message || "暂存失败" };
}

// 放弃改动（破坏性，渲染端需二次确认）：已跟踪文件恢复到 HEAD（暂存区与工作区一起还原），
// 未跟踪文件（??）用 git clean -f 删除。
export async function gitDiscard(root, paths) {
  if (!root || !(await isGitRepo(root))) return { ok: false, error: "当前工作目录不是 Git 仓库" };
  const list = (Array.isArray(paths) ? paths : [paths]).map((item) => String(item || "").trim()).filter(Boolean);
  if (!list.length) return { ok: false, error: "缺少要放弃的文件" };
  const porcelain = await readPorcelain(root);
  const untracked = new Set(porcelain.filter((line) => line.startsWith("??")).map((line) => line.slice(3).trim()));
  const tracked = list.filter((item) => !untracked.has(item));
  const toDelete = list.filter((item) => untracked.has(item));
  let lastError = "";
  if (tracked.length) {
    const result = await runGit(root, ["checkout", "HEAD", "--", ...tracked], { timeout: 15000 });
    if (!result.ok) lastError = result.message || "放弃改动失败";
  }
  if (toDelete.length) {
    const result = await runGit(root, ["clean", "-f", "--", ...toDelete], { timeout: 15000 });
    if (!result.ok) lastError = result.message || "删除未跟踪文件失败";
  }
  return lastError ? { ok: false, error: lastError } : { ok: true };
}

export async function gitPush(root) {
  if (!root || !(await isGitRepo(root))) return { ok: false, error: "当前工作目录不是 Git 仓库" };
  const remote = await runGit(root, ["remote"]);
  if (!remote.stdout.trim()) return { ok: false, error: "当前仓库没有配置远程（remote），无法推送" };
  let result = await runGit(root, ["push"], { timeout: 60000 });
  if (!result.ok && /no upstream|has no upstream|set-upstream/i.test(result.message)) {
    const current = await runGit(root, ["branch", "--show-current"]);
    const branch = current.stdout.trim();
    if (!branch) return { ok: false, error: "当前处于游离 HEAD 状态，请先切换到一个分支再推送" };
    result = await runGit(root, ["push", "-u", "origin", branch], { timeout: 60000 });
  }
  if (!result.ok) {
    if (/could not read|authentication|permission denied|终端提示已被禁用|terminal prompts disabled/i.test(result.message)) {
      return { ok: false, error: "推送需要远程仓库凭据，请在终端里手动推送一次完成登录" };
    }
    return { ok: false, error: result.message || "推送失败" };
  }
  return { ok: true };
}

// ===== Codex 风格审阅视图：工作区改动 vs 基线（HEAD 或 upstream） =====

// 当前分支的 upstream（如 origin/main），没有则为空串
export async function gitUpstream(root) {
  if (!root || !(await isGitRepo(root))) return "";
  const result = await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  return result.ok ? result.stdout.trim() : "";
}

async function resolveReviewBase(root, base) {
  const requested = String(base || "HEAD").trim() || "HEAD";
  if (requested === "HEAD") {
    const head = await runGit(root, ["rev-parse", "--verify", "HEAD"]);
    return head.ok ? "HEAD" : EMPTY_TREE;
  }
  // 只允许引用名，避免把任意参数传给 git
  const check = await runGit(root, ["rev-parse", "--verify", `${requested}^{commit}`]);
  return check.ok ? requested : "HEAD";
}

// 统计未跟踪文件行数（新增行数）；二进制文件返回 null
async function countUntrackedLines(root, relativePath) {
  try {
    const handle = await fs.open(path.join(root, relativePath), "r");
    try {
      const probe = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
      if (probe.subarray(0, bytesRead).includes(0)) return null;
      const stat = await handle.stat();
      const size = Math.min(stat.size, UNTRACKED_COUNT_MAX_BYTES);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      const text = buffer.toString("utf8");
      if (!text) return 0;
      const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      return lines;
    } finally {
      await handle.close();
    }
  } catch {
    return 0;
  }
}

// 审阅总览：基线（默认 HEAD，含未暂存改动）之下的逐文件状态与增删行数；未跟踪文件计为 U
export async function gitReviewOverview(root, base = "HEAD") {
  if (!root || !(await isGitRepo(root))) return { isRepo: false, current: "", upstream: "", base: "", files: [], totals: { added: 0, removed: 0 } };
  const [currentResult, upstream, resolvedBase] = await Promise.all([
    runGit(root, ["branch", "--show-current"]),
    gitUpstream(root),
    resolveReviewBase(root, base),
  ]);
  const [numstat, nameStatus, untrackedResult] = await Promise.all([
    runGit(root, ["-c", "core.quotepath=false", "diff", "--numstat", "-z", "-M", resolvedBase, "--"], { timeout: 20000 }),
    runGit(root, ["-c", "core.quotepath=false", "diff", "--name-status", "-z", "-M", resolvedBase, "--"], { timeout: 20000 }),
    // 只有对比 HEAD（未提交改动）时才纳入未跟踪文件
    resolvedBase === "HEAD" || resolvedBase === EMPTY_TREE
      ? runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"], { timeout: 20000 })
      : { ok: true, stdout: "" },
  ]);
  const stats = new Map(); // path → { added, removed }
  if (numstat.ok) {
    // -z 格式：普通条目为 "added<TAB>removed<TAB>path<NUL>"；重命名为 "added<TAB>removed<TAB><NUL>old<NUL>new<NUL>"
    const tokens = numstat.stdout.split("\0");
    for (let index = 0; index < tokens.length;) {
      const token = tokens[index];
      const renamed = /^(\d+|-)\t(\d+|-)\t$/.exec(token || "");
      if (renamed) {
        const nextPath = tokens[index + 2] || "";
        if (nextPath) stats.set(nextPath, { added: renamed[1] === "-" ? 0 : Number(renamed[1]), removed: renamed[2] === "-" ? 0 : Number(renamed[2]) });
        index += 3;
        continue;
      }
      const normal = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(token || "");
      if (normal) {
        stats.set(normal[3], { added: normal[1] === "-" ? 0 : Number(normal[1]), removed: normal[2] === "-" ? 0 : Number(normal[2]) });
      }
      index += 1;
    }
  }
  const files = new Map(); // path → { path, status, added, removed }
  if (nameStatus.ok) {
    const tokens = nameStatus.stdout.split("\0").filter((token) => token !== "");
    for (let index = 0; index < tokens.length;) {
      const marker = tokens[index++];
      if (marker.startsWith("R") || marker.startsWith("C")) {
        index += 1; // 跳过旧路径
        const nextPath = tokens[index++] || "";
        files.set(nextPath, { path: nextPath, status: "M", ...(stats.get(nextPath) || { added: 0, removed: 0 }) });
      } else {
        const filePath = tokens[index++] || "";
        const status = marker === "A" ? "A" : marker === "D" ? "D" : "M";
        files.set(filePath, { path: filePath, status, ...(stats.get(filePath) || { added: 0, removed: 0 }) });
      }
    }
  }
  if (untrackedResult.ok && untrackedResult.stdout) {
    const untracked = untrackedResult.stdout.split("\0").filter(Boolean);
    const counts = await Promise.all(untracked.map((filePath) => countUntrackedLines(root, filePath)));
    untracked.forEach((filePath, index) => {
      if (files.has(filePath)) return;
      const lines = counts[index];
      files.set(filePath, { path: filePath, status: "U", added: lines ?? 0, removed: 0, binary: lines === null });
    });
  }
  const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const totals = list.reduce(
    (accumulator, file) => ({ added: accumulator.added + file.added, removed: accumulator.removed + file.removed }),
    { added: 0, removed: 0 },
  );
  return {
    isRepo: true,
    current: currentResult.stdout.trim() || "HEAD",
    upstream,
    base: resolvedBase,
    files: list,
    totals,
  };
}

// 单文件 diff（审阅视图左栏）；未跟踪文件用 --no-index 与 /dev/null 对比
export async function gitFileDiff(root, base, filePath, untracked = false) {
  if (!root || !(await isGitRepo(root))) return { ok: false, error: "当前工作目录不是 Git 仓库" };
  const relative = String(filePath || "").replace(/^[\\/]+/, "");
  if (!relative || relative.includes("..")) return { ok: false, error: "文件路径不合法" };
  let result;
  if (untracked) {
    const absolute = path.join(root, relative);
    result = await runGit(root, ["-c", "core.quotepath=false", "diff", "--no-index", "--", "/dev/null", absolute], { timeout: 20000, allowExitCodes: [0, 1] });
    if (!result.ok && result.stdout === "") return { ok: false, error: result.message || "无法生成文件对比" };
  } else {
    const resolvedBase = await resolveReviewBase(root, base);
    result = await runGit(root, ["-c", "core.quotepath=false", "diff", "-M", resolvedBase, "--", relative], { timeout: 20000 });
    if (!result.ok) return { ok: false, error: result.message || "无法生成文件对比" };
  }
  const diff = result.stdout;
  // 注意必须整行匹配：源码文件内容里可能合法地出现这些字样（比如本文件自身）
  if (/^Binary files /m.test(diff) || /^GIT binary patch$/m.test(diff)) return { ok: true, binary: true, diff: "" };
  return { ok: true, binary: false, diff: diff.slice(0, REVIEW_DIFF_MAX_CHARS), truncated: diff.length > REVIEW_DIFF_MAX_CHARS };
}
