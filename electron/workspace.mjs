import { promises as fs } from "node:fs";
import path from "node:path";

const ignoredNames = new Set([".git", "node_modules", "dist", ".DS_Store"]);
const MAX_ENTRIES_PER_DIRECTORY = 500;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

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

export async function readWorkspaceMarkdown(workspaceRoot, filePath) {
  if (!workspaceRoot || !filePath || !/\.(?:md|markdown)$/i.test(String(filePath))) {
    return { ok: false, error: "只支持读取工作目录内的 Markdown 文件" };
  }
  try {
    const [root, target] = await Promise.all([
      fs.realpath(String(workspaceRoot)),
      fs.realpath(String(filePath)),
    ]);
    if (!isInsideWorkspace(root, target)) return { ok: false, error: "文件不在当前工作目录内" };
    const stat = await fs.stat(target);
    if (!stat.isFile()) return { ok: false, error: "目标不是文件" };
    if (stat.size > MAX_MARKDOWN_BYTES) return { ok: false, error: "Markdown 文件超过 2 MB，无法预览" };
    return { ok: true, content: await fs.readFile(target, "utf8") };
  } catch {
    return { ok: false, error: "Markdown 文件不存在或读取失败" };
  }
}
