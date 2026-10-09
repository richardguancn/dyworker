import { promises as fs } from "node:fs";
import path from "node:path";

const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif" };
const OFFICE = new Set([".doc", ".docx", ".docm", ".xlsx", ".xlsm", ".xls", ".ppt", ".pptx", ".pptm", ".rtf"]);
const TEXT = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".xml", ".log", ".js", ".jsx", ".ts", ".tsx", ".css", ".py", ".sql", ".sh", ".html", ".htm", ".ini", ".toml", ".c", ".cpp", ".h", ".java", ".go", ".rs", ".vue", ".svelte"]);
export const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

export async function resolvePreviewFile(workspacePath, filePath) {
  if (!workspacePath || !filePath) throw new Error("缺少工作目录或文件路径");
  const root = await fs.realpath(workspacePath);
  const target = await fs.realpath(path.resolve(root, filePath));
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("文件不在当前工作目录内");
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("请选择文件，不能预览文件夹");
  if (stat.size > MAX_PREVIEW_BYTES) throw new Error("文件超过 32 MB，请使用系统应用打开");
  return { path: target, name: path.basename(target), size: stat.size };
}

export async function readFilePreview(workspacePath, filePath) {
  try {
    const file = await resolvePreviewFile(workspacePath, filePath);
    const extension = path.extname(file.path).toLowerCase();
    const mime = IMAGE_TYPES[extension] || (extension === ".pdf" ? "application/pdf" : "");
    if (mime) {
      const data = await fs.readFile(file.path);
      if (!data.length) throw new Error("文件为空，无法预览");
      if (data.length > MAX_PREVIEW_BYTES) throw new Error("文件超过 32 MB，请使用系统应用打开");
      return { ok: true, ...file, kind: extension === ".pdf" ? "pdf" : "image", mime, data: data.toString("base64") };
    }
    if (OFFICE.has(extension)) {
      const { Workspace } = await import("./agent.mts");
      const content = await new Workspace(workspacePath).readFile(file.path);
      return { ok: true, ...file, kind: "text", content, note: "文档文字预览；原始排版、图片和图表请使用系统应用查看。" };
    }
    if (extension && !TEXT.has(extension)) return { ok: true, ...file, kind: "unsupported", note: "暂不支持预览此格式，请使用系统应用打开。" };
    if (file.size > 2 * 1024 * 1024) throw new Error("文本超过 2 MB，请使用系统应用打开");
    const data = await fs.readFile(file.path);
    if (data.includes(0)) return { ok: true, ...file, kind: "unsupported", note: "此文件包含二进制内容，请使用系统应用打开。" };
    return { ok: true, ...file, kind: /\.md|\.markdown/.test(extension) ? "markdown" : "text", content: data.toString("utf8") };
  } catch (error) {
    return { ok: false, error: error?.code === "ENOENT" ? "文件不存在，可能已移动或删除" : error instanceof Error ? error.message : String(error) };
  }
}

export function filePreviewToolDefinitions() {
  return [{ type: "function", function: {
    name: "open_file",
    description: "在用户当前会话的右侧文件面板直接预览工作目录内的本地文件。支持图片、PDF、Markdown、文本和办公文档文字预览。展示本地图片或文档时优先使用此工具，不要为预览启动 Python/HTTP 服务或改用浏览器网址。此工具只向用户展示文件，不会把图像内容返回给模型；需要分析文字请用 read_file。",
    parameters: { type: "object", properties: { path: { type: "string", description: "工作目录内的相对或绝对文件路径" } }, required: ["path"], additionalProperties: false },
  } }];
}

export async function requestFilePreview(args, { workspacePath, sessionId, renderer }) {
  if (!sessionId) return { ok: false, result: "当前任务缺少所属会话，无法打开右侧预览" };
  if (!renderer || renderer.isDestroyed()) return { ok: false, result: "当前任务没有可用的桌面文件预览面板" };
  try {
    const file = await resolvePreviewFile(workspacePath, args.path);
    renderer.send("file:panel-request", { path: file.path, workspacePath, ownerSessionId: sessionId });
    return { ok: true, result: `已请求在此会话的右侧预览：${file.path}。后台会话的请求会在切回该会话时展示；实际读取或格式错误会显示在面板中。` };
  } catch (error) {
    return { ok: false, result: error instanceof Error ? error.message : String(error) };
  }
}
