// 工作区文件相关的纯函数：预览类型判定、面包屑、附件构造、名称筛选、diff 解析与目录树组装。
// 原先内联在 App.tsx，文件面板、审阅面板、输入框引用共用。
import type { Attachment, GitReviewFile, WorkspaceEntry } from "../types";

export const WORKSPACE_FILE_DRAG_TYPE = "application/x-dyworker-workspace-file";

export function isMarkdownFile(filePath: string) {
  return /\.(?:md|markdown)$/i.test(filePath);
}

// 可在代码标签页预览的文本文件类型(其余交给系统默认应用)
const TEXT_PREVIEW_EXTENSIONS = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "json", "jsonc",
  "css", "scss", "less", "html", "htm", "svg", "xml",
  "py", "sh", "bash", "zsh", "md", "markdown", "txt", "log",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "properties",
  "java", "c", "h", "cpp", "cc", "cxx", "hpp", "go", "rs", "rb", "php", "sql", "vue",
  "gitignore", "gitattributes", "editorconfig", "dockerignore", "npmignore",
]);

export function fileExtension(filePath: string) {
  const name = filePath.split(/[\\/]/).pop() || "";
  if (name.startsWith(".") && !name.includes(".", 1)) return name.slice(1).toLowerCase(); // .gitignore 等点文件
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isTextPreviewFile(filePath: string) {
  return TEXT_PREVIEW_EXTENSIONS.has(fileExtension(filePath));
}

// 面包屑:工作区名 › 目录 › 文件
export function codeBreadcrumbSegments(filePath: string, workspacePath: string) {
  const root = workspacePath.replace(/[\\/]+$/, "");
  let relative = filePath;
  if (root && (filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`))) {
    relative = filePath.slice(root.length + 1);
  }
  const workspaceName = root.split(/[\\/]/).pop() || root;
  return [workspaceName, ...relative.split(/[\\/]/).filter(Boolean)];
}

export function workspaceFileAttachment(file: WorkspaceEntry): Attachment {
  const isImage = /\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name);
  return {
    name: file.name,
    path: file.path,
    size: 0,
    mimeType: isImage ? "image/*" : "text/plain",
    isImage,
  };
}

// 按名称筛选文件树:保留命中项的祖先目录链
export function filterWorkspaceEntries(entries: WorkspaceEntry[], query: string): WorkspaceEntry[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return entries;
  const walk = (list: WorkspaceEntry[]): WorkspaceEntry[] => {
    const filtered: WorkspaceEntry[] = [];
    for (const entry of list) {
      const matches = entry.name.toLowerCase().includes(keyword);
      if (entry.kind === "directory") {
        const children = entry.children?.length ? walk(entry.children) : [];
        if (matches || children.length) filtered.push({ ...entry, children });
      } else if (matches) {
        filtered.push(entry);
      }
    }
    return filtered;
  };
  return walk(entries);
}

// 按展开后的显示顺序取前 count 行，保留目录层级和已完整展示的分支对象。
export function takeWorkspaceEntries(entries: WorkspaceEntry[], count: number) {
  let remaining = count;
  let hasMore = false;
  const take = (list: WorkspaceEntry[]): WorkspaceEntry[] => {
    const visible: WorkspaceEntry[] = [];
    for (const entry of list) {
      if (remaining <= 0) {
        hasMore = true;
        break;
      }
      remaining -= 1;
      const children = entry.children?.length ? take(entry.children) : entry.children;
      visible.push(hasMore ? { ...entry, children } : entry);
    }
    return visible;
  };
  return { entries: take(entries), hasMore };
}

export type ReviewDiffRow =
  | { type: "add" | "del" | "ctx"; oldNo?: number; newNo?: number; text: string }
  | { type: "gap"; count: number };

// 解析 unified diff:带行号输出,hunk 之间插入"N unmodified lines"折叠条(对照 Codex 审阅视图)
export function parseReviewDiff(diff: string): ReviewDiffRow[] {
  const rows: ReviewDiffRow[] = [];
  const hunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = hunkPattern.exec(line);
    if (hunk) {
      const nextOld = Number(hunk[1]);
      if (inHunk) {
        const gap = nextOld - oldNo;
        if (gap > 0) rows.push({ type: "gap", count: gap });
      } else if (nextOld > 1) {
        rows.push({ type: "gap", count: nextOld - 1 });
      }
      oldNo = nextOld;
      newNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") rows.push({ type: "add", newNo: newNo++, text });
    else if (marker === "-") rows.push({ type: "del", oldNo: oldNo++, text });
    else if (marker === " ") rows.push({ type: "ctx", oldNo: oldNo++, newNo: newNo++, text });
  }
  return rows;
}

export type ReviewTreeDir = { name: string; path: string; dirs: ReviewTreeDir[]; files: GitReviewFile[] };

// 把扁平的文件路径列表组装成目录树（对照 Codex 审阅页右侧的分组文件列表）
export function buildReviewTree(files: GitReviewFile[]): ReviewTreeDir {
  const root: ReviewTreeDir = { name: "", path: "", dirs: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    for (let index = 0; index < segments.length - 1; index++) {
      const dirPath = segments.slice(0, index + 1).join("/");
      let next = node.dirs.find((dir) => dir.path === dirPath);
      if (!next) {
        next = { name: segments[index], path: dirPath, dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return root;
}
