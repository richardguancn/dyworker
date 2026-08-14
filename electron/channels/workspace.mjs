// 渠道「更换工作目录」指令：解析整条消息里的目标路径，并把目标解析成真实存在的目录。
// 纯 Node 模块，不依赖 electron 与其他渠道模块，方便用 node --test 直接测试。
// 只有整条消息恰好是这条指令时才拦截；目标可以用引号包裹以支持带空格的路径。

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// 常见说法：更换/切换/修改/设置工作目录（至/到/为），以及“切换目录至 X”。
// 目标必须紧跟指令且是消息的结尾，避免把任务正文里的“把工作目录改成 X 后再构建”误拦截。
const WORKSPACE_SWITCH_PATTERN = new RegExp(
  [
    "^(?:请|麻烦|麻烦你)?(?:帮我|为我|替我)?(?:把|将)?(?:当前)?",
    "(?:",
    "工作(?:目录|文件夹|区)(?:切换|更换|修改|设置|改为|改成)",
    "|(?:切换|更换|修改|设置)工作(?:目录|文件夹|区)",
    "|(?:切换|更换)(?:工作)?目录",
    "|工作(?:目录|文件夹|区)(?:至|到|为|:|：)",
    ")",
    "(?:至|到|为|:|：)?",
    '\\s*("([^"]+)"|\'([^\']+)\'|“([^”]+)”|‘([^’]+)’|(\\S+))',
    "\\s*[。.!！]?$",
  ].join(""),
);

// 返回目标路径原文；不是这条指令时返回 null。
export function parseWorkspaceSwitch(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  const match = source.match(WORKSPACE_SWITCH_PATTERN);
  if (!match) return null;
  const target = (match[2] || match[3] || match[4] || match[5] || match[6] || "").trim();
  return target || null;
}

// 目标是否明显是路径（含分隔符、盘符、~ 或 ./ ../ 前缀）。
// 只有这类明显指令在目录不存在时直接回“没有找到文件夹”；
// 单 token 又不存在的更可能是任务正文里的说法，交回模型按普通消息处理。
export function looksLikePathDirective(value) {
  const text = String(value || "").trim();
  return Boolean(
    text.includes("/") || text.includes("\\")
    || text === "~" || text.startsWith("~/") || text.startsWith("~\\")
    || /^[a-zA-Z]:/.test(text)
    || text === "." || text === ".." || text.startsWith("./") || text.startsWith("../"),
  );
}

// 把指令里的目标解析成存在的绝对目录：绝对路径直接使用，
// 相对路径基于当前聊天的工作目录解析；没有工作目录时只接受绝对路径。
export async function resolveWorkspaceSwitch(target, currentWorkspace = "") {
  const value = String(target || "").trim();
  if (!value) return { ok: false, error: "指令里没有提供目标目录" };
  const expanded = value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(os.homedir(), value.slice(1))
    : value;
  const base = String(currentWorkspace || "").trim();
  const absolute = path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : base
      ? path.resolve(base, expanded)
      : "";
  if (!absolute) {
    return { ok: false, error: "这个聊天还没有工作目录，请发送绝对路径，例如：更换工作目录至 /Users/me/project" };
  }
  let canonical = absolute;
  try {
    canonical = await fs.realpath(absolute);
  } catch {
    // 目标不存在时保留规范化路径，统一在下面报“没有找到文件夹”
  }
  const stat = await fs.stat(canonical).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { ok: false, error: `没有找到这个文件夹：${value}` };
  }
  return { ok: true, path: canonical };
}
