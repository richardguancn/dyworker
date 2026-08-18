// 渠道「更换工作目录」指令：解析整条消息里的目标路径，并把目标解析成真实存在的目录。
// 纯 Node 模块，不依赖 electron 与其他渠道模块，方便用 node --test 直接测试。
// 只有整条消息恰好是这条指令时才拦截；目标可以用引号包裹以支持带空格的路径。

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// 常见说法：更换/切换/修改/设置工作目录（至/到/为），以及“切换目录至 X”、
// “切换到 X 目录”（目标在“目录”前）、“把工作区切换到 X 目录”。
// 目标必须紧跟指令且是消息的结尾，避免把任务正文里的“把工作目录改成 X 后再构建”误拦截。
const TARGET_PATTERN = '("([^"]+)"|\'([^\']+)\'|“([^”]+)”|‘([^’]+)’|(\\S+))';
const WORKSPACE_NOUN = "(?:工作)?(?:目录|文件夹|区)";
const SWITCH_VERB = "(?:切换|更换|修改|设置|改为|改成|换到|换为)";
const CONNECTOR = "(?:至|到|为|:|：)?";

const PREFIX = "^(?:请|麻烦|麻烦你)?(?:帮我|为我|替我)?(?:把|将)?(?:当前)?";
const END = "\\s*[。.!！]?$";

// 每种说法一条正则：目标捕获组位置固定（2..6），逐个尝试，避免多分支共享捕获组错位。
const WORKSPACE_SWITCH_PATTERNS = [
  // 工作目录切换至 X / 工作目录改为 X / 工作区换到 X
  new RegExp(`${PREFIX}工作(?:目录|文件夹|区)${SWITCH_VERB}${CONNECTOR}\\s*${TARGET_PATTERN}${END}`),
  // 切换工作目录至 X / 修改工作区到 X
  new RegExp(`${PREFIX}(?:切换|更换|修改|设置)工作(?:目录|文件夹|区)${CONNECTOR}\\s*${TARGET_PATTERN}${END}`),
  // 切换目录至 X
  new RegExp(`${PREFIX}(?:切换|更换)(?:工作)?目录${CONNECTOR}\\s*${TARGET_PATTERN}${END}`),
  // 工作目录：X / 工作目录至 X
  new RegExp(`${PREFIX}工作(?:目录|文件夹|区)(?:至|到|为|:|：)\\s*${TARGET_PATTERN}${END}`),
  // 切换到 X 目录 / 切换为 X 文件夹（目标在名词前）
  new RegExp(`${PREFIX}(?:切换|更换|修改|设置)${CONNECTOR}\\s*${TARGET_PATTERN}\\s*${WORKSPACE_NOUN}${END}`),
  // 切换到目录 X / 切换到工作目录 X（名词在前）
  new RegExp(`${PREFIX}(?:切换|更换)(?:至|到|为|:|：)?(?:工作)?(?:目录|文件夹|区)${CONNECTOR}\\s*${TARGET_PATTERN}${END}`),
  // 工作区切换到 X 目录 / 工作目录改成 X 文件夹
  new RegExp(`${PREFIX}工作(?:目录|文件夹|区)(?:切换|更换|修改|设置)(?:至|到|为|:|：)?\\s*${TARGET_PATTERN}\\s*${WORKSPACE_NOUN}${END}`),
];

function extractTarget(match) {
  const target = (match[2] || match[3] || match[4] || match[5] || match[6] || "").trim();
  return target || null;
}

// 返回目标路径原文；不是这条指令时返回 null。
export function parseWorkspaceSwitch(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  for (const pattern of WORKSPACE_SWITCH_PATTERNS) {
    const match = source.match(pattern);
    if (match) return extractTarget(match);
  }
  return null;
}

// 宽松判断“用户要求切换工作目录”：用于渠道 switch_workspace 工具的调用门槛，
// 避免模型在用户没要求时擅自更换聊天的工作目录。
export function isWorkspaceSwitchRequest(text) {
  const source = String(text || "").trim();
  if (!source) return false;
  if (parseWorkspaceSwitch(source) !== null) return true;
  return /(?:切换|更换|修改|设置).{0,24}(?:工作)?(?:目录|文件夹|区)/.test(source);
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
