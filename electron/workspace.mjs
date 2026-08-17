import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const ignoredNames = new Set([".git", "node_modules", "dist", ".DS_Store"]);
const MAX_ENTRIES_PER_DIRECTORY = 500;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

function readGitBranch(root) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "branch", "--show-current"],
      { encoding: "utf8", timeout: 1500, windowsHide: true },
      (_error, stdout) => resolve(String(stdout || "").trim()),
    );
  });
}

export async function getWorkspaceContext(root) {
  const workspacePath = String(root || "").trim();
  if (!workspacePath) return { name: "", branch: "" };
  const name = path.basename(path.normalize(workspacePath)) || workspacePath;
  return {
    name,
    branch: await readGitBranch(workspacePath),
  };
}

function isInsideWorkspace(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Keep the existing tree depth and safety limit while making the limit local to
// each directory. A large child directory must not hide its siblings.
export async function listWorkspace(root, depth = 0) {
  if (!root || depth > 4) return [];
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  directoryEntries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  });
  const result = [];
  for (const entry of directoryEntries) {
    if (ignoredNames.has(entry.name)) continue;
    if (result.length >= MAX_ENTRIES_PER_DIRECTORY) break;
    const fullPath = path.join(root, entry.name);
    const item = {
      name: entry.name,
      path: fullPath,
      kind: entry.isDirectory() ? "directory" : "file",
    };
    if (entry.isDirectory()) item.children = await listWorkspace(fullPath, depth + 1);
    result.push(item);
  }
  return result;
}

// 通用工作区文本文件读取：限制在工作区内、≤2MB，并做二进制探测（供代码查看标签页）
export async function readWorkspaceFile(workspaceRoot, filePath) {
  if (!workspaceRoot || !filePath) return { ok: false, error: "缺少工作目录或文件路径" };
  try {
    const [root, target] = await Promise.all([
      fs.realpath(String(workspaceRoot)),
      fs.realpath(String(filePath)),
    ]);
    if (!isInsideWorkspace(root, target)) return { ok: false, error: "文件不在当前工作目录内" };
    const stat = await fs.stat(target);
    if (!stat.isFile()) return { ok: false, error: "目标不是文件" };
    if (stat.size > MAX_MARKDOWN_BYTES) return { ok: false, error: "文件超过 2 MB，无法预览" };
    const buffer = await fs.readFile(target);
    if (buffer.subarray(0, 8192).includes(0)) return { ok: false, binary: true, error: "二进制文件无法预览" };
    return { ok: true, content: buffer.toString("utf8") };
  } catch {
    return { ok: false, error: "文件不存在或读取失败" };
  }
}

// 工作区文本文件写入（工作台「编辑与保存」）：只允许工作目录内路径，
// 拒绝二进制（NUL 字符）与超大内容，同目录临时文件 + rename 原子写。
const MAX_WRITE_BYTES = 2 * 1024 * 1024;

export async function writeWorkspaceFile(workspaceRoot, filePath, content) {
  if (!workspaceRoot || !filePath) return { ok: false, error: "缺少工作目录或文件路径" };
  if (typeof content !== "string") return { ok: false, error: "内容必须是文本" };
  if (content.includes("\0")) return { ok: false, error: "内容包含二进制字符，拒绝写入" };
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) return { ok: false, error: "内容超过 2 MB，拒绝写入" };
  try {
    const root = await fs.realpath(String(workspaceRoot));
    const requested = path.resolve(root, String(filePath));
    // 先解析真实路径（已存在文件直接 realpath；新文件取父目录真实路径 + 文件名），
    // 再统一做工作区包含校验：既能防软链逃逸，也不会被 macOS /tmp 这类符号链接误伤
    let resolvedTarget = requested;
    try {
      const stat = await fs.stat(requested);
      if (!stat.isFile()) return { ok: false, error: "目标不是文件" };
      resolvedTarget = await fs.realpath(requested);
    } catch {
      const realParent = await fs.realpath(path.dirname(requested));
      resolvedTarget = path.join(realParent, path.basename(requested));
    }
    if (!isInsideWorkspace(root, resolvedTarget)) return { ok: false, error: "文件不在当前工作目录内" };
    const parent = path.dirname(resolvedTarget);
    // 原子写：同目录临时文件 + rename，避免写一半损坏原文件
    const temp = path.join(parent, `.dyworker-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, resolvedTarget);
    return { ok: true, path: resolvedTarget, bytes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readWorkspaceMarkdown(workspaceRoot, filePath) {
  if (!/\.(?:md|markdown)$/i.test(String(filePath))) {
    return { ok: false, error: "只支持读取工作目录内的 Markdown 文件" };
  }
  const result = await readWorkspaceFile(workspaceRoot, filePath);
  if (!result.ok && result.error === "文件超过 2 MB，无法预览") {
    return { ok: false, error: "Markdown 文件超过 2 MB，无法预览" };
  }
  return result;
}
