// 渠道媒体工具（send_media / text_to_speech）：工具定义与路径/大小校验的纯函数部分。
// 放在 channels/ 下不依赖 electron，方便用 node --test 直接测试；main.mjs 负责把处理器接到
// runChannelTask 的 extraTools 路由上（设计文档第 4.1 / 5 节）。
import path from "node:path";
import { promises as fs } from "node:fs";
import { MAX_MEDIA_BYTES } from "./shared.mjs";

// 出站发送白名单：只能发图片或常见文档，禁止可执行文件（.exe/.sh/.bat/.js 等）
export const CHANNEL_MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
  ".pdf", ".csv", ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt",
  ".zip", ".txt", ".md",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

// 扩展名 → 平台媒体 kind
export function mediaKindForExtension(extension) {
  return IMAGE_EXTENSIONS.has(String(extension || "").toLowerCase()) ? "image" : "file";
}

// 校验出站路径：必须落在工作区内、非目录穿越
export function resolveChannelMediaPath(workspacePath, rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) return { ok: false, error: "缺少文件路径" };
  if (path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) {
    return { ok: false, error: "只能发送工作区里的文件，不支持绝对路径" };
  }
  const parts = value.split(/[\\/]+/);
  if (parts.some((part) => part === "..")) {
    return { ok: false, error: "路径不能越出工作区" };
  }
  if (!workspacePath) return { ok: false, error: "还没有选择工作区，无法发送文件" };
  const absolute = path.resolve(workspacePath, value);
  const root = path.resolve(workspacePath) + path.sep;
  if (!absolute.startsWith(root)) return { ok: false, error: "路径越出了工作区，已拒绝" };
  return { ok: true, path: absolute, relative: value };
}

const stringArg = (description) => ({ type: "string", description });

// 工具定义形状与 electron/browser.mjs 的 browserToolDefinitions 一致
export function channelMediaToolDefinitions() {
  const tool = (name, description, properties, required) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });
  return [
    tool(
      "send_media",
      "把工作区里生成的文件作为结果发回当前 IM 渠道（QQ/微信）。只能发送图片或常见文档（png/jpg/jpeg/gif/webp/bmp/pdf/csv/xlsx/xls/docx/doc/pptx/ppt/zip/txt/md），不能发送可执行文件；路径必须是工作区相对路径；单个文件不超过 50 MB。发送动作与文字回复同权责，不需额外审批。",
      { path: stringArg("工作区相对路径，如 output/图表.png"), caption: stringArg("可选：随文件附带的说明文字") },
      ["path"],
    ),
    tool(
      "text_to_speech",
      "把一段话合成语音并发回当前 IM 渠道（需要先在电脑端设置中配置语音合成服务）。语音按平台要求编码为 silk 格式。",
      { text: stringArg("要朗读的内容"), path: stringArg("语音文件保存到工作区的相对路径，必须以 .silk 结尾") },
      ["text", "path"],
    ),
    tool(
      "switch_workspace",
      "把当前 IM 聊天的操作目录切换为指定文件夹（仅当用户明确要求切换工作目录时调用，例如用户说“切换到 ai-learning 目录”；目标必须是真实存在的目录）。切换后本聊天的后续消息都会在新目录里操作。",
      { path: stringArg("目标目录的绝对路径，或相对当前工作目录的路径") },
      ["path"],
    ),
  ];
}

// 出站路径校验 + 防符号链接逃逸：路径解析必须落在工作区真实路径内。
// 与 workspace.mjs 的 realpath 检查一致：resolveChannelMediaPath 只做字符串层
// 校验，这里再对文件系统真实路径核对，拦截「工作区里指向外部的快捷链接」。
// mustExist=false 用于 text_to_speech 的待写入路径：文件还不存在时，对其最深
// 的已存在祖先做 realpath 校验（剩余路径段由写入方新建，无法逃逸）。
async function realpathOfExistingAncestor(absPath) {
  let cursor = path.resolve(absPath);
  for (;;) {
    try {
      return await fs.realpath(cursor);
    } catch {
      // 逐级向上找已存在的祖先
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

export async function verifyChannelMediaPath(workspacePath, rawPath, { mustExist = true } = {}) {
  const resolved = resolveChannelMediaPath(workspacePath, rawPath);
  if (!resolved.ok) return resolved;
  try {
    const root = await fs.realpath(String(workspacePath));
    const target = mustExist
      ? await fs.realpath(resolved.path)
      : await realpathOfExistingAncestor(resolved.path);
    if (!target) return { ok: false, error: "文件不存在或无法解析" };
    const relative = path.relative(root, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return { ok: false, error: "路径通过快捷链接指向工作区外，已拒绝" };
    }
    return { ok: true, path: resolved.path, relative: resolved.relative };
  } catch {
    return { ok: false, error: "文件不存在或无法解析" };
  }
}

export { MAX_MEDIA_BYTES };
