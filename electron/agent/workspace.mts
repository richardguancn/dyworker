// 工作区文件读写、文档读取和命令执行。
import { spawn,spawnSync } from "node:child_process";
import { promises as fs,realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareCommandExecution } from "../command-execution.mts";
import { createCommandDiagnostics } from "../command-protection.mts";
import { bundledCuratedRoot } from '../curated-plugins.mts';
import { COMMAND_OUTPUT_LIMIT,COMMAND_TIMEOUT_MS,LIST_LIMIT,READ_LIMIT,clipped,documentExtensions,ignoredNames,moduleDir,runProcess,runPython,textExtensions } from "./shared.mts";

// 基于行多重集的简易 diff 计数，用于 +N/-M 变更统计（对照 Codex 的文件变更摘要）
export function diffLineCounts(before, after) {
  const counts = new Map();
  for (const line of String(before).split("\n")) counts.set(line, (counts.get(line) || 0) + 1);
  for (const line of String(after).split("\n")) counts.set(line, (counts.get(line) || 0) - 1);
  let removed = 0;
  let added = 0;
  for (const count of counts.values()) {
    if (count > 0) removed += count;
    else added -= count;
  }
  return { added, removed };
}

// 基于 LCS 的 unified diff（对照 Codex /diff 展示）。大文件只给统计、不给 diff 文本。
const DIFF_MAX_LINES = 400;
const DIFF_MAX_CHARS = 6000;

export function unifiedDiff(before, after, filePath = "", context = 3) {
  const oldLines = String(before).split("\n");
  const newLines = String(after).split("\n");
  if (oldLines.length > DIFF_MAX_LINES || newLines.length > DIFF_MAX_LINES) return "";
  const n = oldLines.length;
  const m = newLines.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = oldLines[i] === newLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  // 回溯为操作序列
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: " ", line: oldLines[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "-", line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: "+", line: newLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "-", line: oldLines[i++] });
  while (j < m) ops.push({ type: "+", line: newLines[j++] });
  // 统一标注新旧行号
  let oldCursor = 1;
  let newCursor = 1;
  for (const op of ops) {
    if (op.type === " ") { op.oldNo = oldCursor++; op.newNo = newCursor++; }
    else if (op.type === "-") { op.oldNo = oldCursor++; }
    else { op.newNo = newCursor++; }
  }
  const changedIndexes = ops.map((op, index) => (op.type !== " " ? index : -1)).filter((index) => index >= 0);
  if (!changedIndexes.length) return "";
  // 按上下文行数折叠为 hunks
  const hunks = [];
  let start = Math.max(0, changedIndexes[0] - context);
  let end = Math.min(ops.length - 1, changedIndexes[0] + context);
  for (let k = 1; k < changedIndexes.length; k++) {
    const index = changedIndexes[k];
    if (index - context <= end + 1) {
      end = Math.min(ops.length - 1, index + context);
    } else {
      hunks.push([start, end]);
      start = Math.max(0, index - context);
      end = Math.min(ops.length - 1, index + context);
    }
  }
  hunks.push([start, end]);
  const name = filePath || "file";
  const output = [`--- a/${name}`, `+++ b/${name}`];
  for (const [hunkStart, hunkEnd] of hunks) {
    const slice = ops.slice(hunkStart, hunkEnd + 1);
    const oldCount = slice.filter((op) => op.type !== "+").length;
    const newCount = slice.filter((op) => op.type !== "-").length;
    const oldStart = (slice.find((op) => op.oldNo != null)?.oldNo ?? 1);
    const newStart = (slice.find((op) => op.newNo != null)?.newNo ?? 1);
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) output.push(`${op.type}${op.line}`);
  }
  return clipped(output.join("\n"), DIFF_MAX_CHARS);
}

// 读取工作区根目录的 AGENTS.md 项目约定（对照 Codex 的项目指令加载）
export async function loadProjectInstructions(workspacePath, limit = 32 * 1024) {
  const root = String(workspacePath || "").trim();
  if (!root) return "";
  try {
    const file = path.join(root, "AGENTS.md");
    const stat = await fs.stat(file);
    if (!stat.isFile()) return "";
    return clipped(await fs.readFile(file, "utf8"), limit).trim();
  } catch {
    return "";
  }
}

export function collectSkillRoots() {
  const home = os.homedir();
  const candidates = [
    bundledCuratedRoot(),
    path.join(home, ".agents"),
    path.join(home, ".codex"),
    path.join(home, ".agent"),
    path.join(home, ".gemini", "antigravity"),
    path.join(home, ".antigravity"),
  ];
  const roots = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    roots.add(resolved);
    try {
      roots.add(realpathSync(resolved));
    } catch {
      // 目录不存在时保留解析后的路径即可
    }
  }
  return [...roots];
}

export function isSkillPath(targetPath) {
  if (!targetPath) return false;
  let expanded = String(targetPath || "").trim();
  if (/^~(?=[\\/]|$)/.test(expanded)) expanded = path.join(os.homedir(), expanded.slice(1));
  const canonical = path.resolve(expanded);
  const roots = collectSkillRoots();
  return roots.some((root) => canonical === root || canonical.startsWith(root + path.sep));
}

export class Workspace {
  root;
externalAuthorizations;
trustedTempRoots;
trustedSkillRoots;
cancellationSignal;
isCancelled;
constructor(root, options = {} as any) {
    this.root = String(root || "").trim();
    if (this.root) {
      const resolvedRoot = path.resolve(this.root);
      this.root = (() => {
        try { return realpathSync(resolvedRoot); } catch { return resolvedRoot; }
      })();
    }
    this.externalAuthorizations = new Map();
    // 系统临时目录视为工作区内（对齐 Codex 沙盒的 :tmpdir / :slash_tmp）：
    // 办公转换、构建脚本和系统工具频繁读写临时目录，不应每次都要求授权。
    this.trustedTempRoots = options.trustTempDirs === false ? [] : collectTempRoots();
    // 技能与助手扩展目录（~/.agents、~/.codex、~/.gemini/antigravity 等）：
    // 助手读取自身技能说明、脚本与资产属于既定工作流，只读访问不应触发工作区外路径审批。
    this.trustedSkillRoots = options.trustSkillRoots === false ? [] : collectSkillRoots();
    // 任务取消信号：runCommand 的长耗时命令据此立即终止，而不是等超时
    this.cancellationSignal = options.signal || null;
    this.isCancelled = typeof options.isCancelled === "function" ? options.isCancelled : null;
  }

  canonicalPath(relativePath) {
    const absolute = path.resolve(this.root, String(relativePath || "").trim());
    let cursor = absolute;
    const missingParts = [];
    while (true) {
      try {
        return path.join(realpathSync(cursor), ...missingParts.reverse());
      } catch {
        const parent = path.dirname(cursor);
        if (parent === cursor) return absolute;
        missingParts.push(path.basename(cursor));
        cursor = parent;
      }
    }
  }

  isOutside(relativePath, { forWrite = false } = {} as any) {
    if (!this.root) return false;
    const absolute = this.canonicalPath(relativePath);
    if (absolute === this.root || absolute.startsWith(this.root + path.sep)) return false;
    // 临时目录不是"工作区外"，不触发审批/审核
    if (this.trustedTempRoots.some((root) => absolute === root || absolute.startsWith(root + path.sep))) return false;
    // 技能与助手扩展目录：只读访问属于受信任系统扩展，不触发审批/审核
    if (!forWrite && this.trustedSkillRoots.some((root) => absolute === root || absolute.startsWith(root + path.sep))) return false;
    return true;
  }

  // isAuthorized(relativePath)
  // 用户已批准过的工作区外路径（含其子路径）在本次任务内视为已授权。
  // 用户直接批准（或在完全访问模式下）的授权延续到任务结束；
  // 审核助手放行、临时放行等场景仍用单次授权，调用方通过 persist 控制。
  isAuthorized(relativePath, { forWrite = false } = {} as any) {
    if (!this.isOutside(relativePath, { forWrite })) return true;
    const canonical = this.canonicalPath(relativePath);
    return [...this.externalAuthorizations.keys()].some((allowed) => (
      canonical === allowed || canonical.startsWith(allowed + path.sep)
    ));
  }

  authorizeExternalPaths(values, { persist = false } = {} as any) {
    const authorized = [...new Set((Array.isArray(values) ? values : [values])
      .map((value) => this.canonicalPath(value))
      .filter((value) => value && value !== this.root && !value.startsWith(this.root + path.sep)))];
    for (const value of authorized) {
      this.externalAuthorizations.set(value, (this.externalAuthorizations.get(value) || 0) + 1);
    }
    if (persist) return () => { };
    return () => {
      for (const value of authorized) {
        const remaining = (this.externalAuthorizations.get(value) || 0) - 1;
        if (remaining > 0) this.externalAuthorizations.set(value, remaining);
        else this.externalAuthorizations.delete(value);
      }
    };
  }

  resolve(relativePath, { forWrite = false } = {} as any) {
    if (!this.root) {
      throw new Error("还没有选择工作文件夹，无法读写文件。请先告诉用户选择工作文件夹后再继续。");
    }
    const value = String(relativePath || "").trim();
    const absolute = path.resolve(this.root, value);
    if (!this.isOutside(value, { forWrite })) return absolute;
    if (!this.isAuthorized(value, { forWrite })) {
      throw new Error(`路径在工作区之外，必须先获得用户授权：${value}`);
    }
    return absolute;
  }

  async listFiles(relativePath = "") {
    const directory = this.resolve(relativePath, { forWrite: false });
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      throw new Error(`文件夹不存在或无法读取：${relativePath || "."}`);
    }
    entries = entries.filter((entry) => !ignoredNames.has(entry.name));
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    });
    const lines = entries.slice(0, LIST_LIMIT)
      .map((entry) => `${entry.isDirectory() ? "[文件夹]" : "[文件]"} ${entry.name}`);
    if (entries.length > LIST_LIMIT) lines.push(`…（共 ${entries.length} 项，仅显示前 ${LIST_LIMIT} 项）`);
    return lines.length ? lines.join("\n") : "（空文件夹）";
  }

  async readFile(relativePath) {
    const file = this.resolve(relativePath, { forWrite: false });
    const extension = path.extname(file).toLowerCase();
    if (documentExtensions.has(extension)) return this.extractDocument(file, extension, relativePath);
    if (extension && !textExtensions.has(extension)) {
      throw new Error(`暂不支持读取 ${extension} 格式的文件，可读取文本、代码、Markdown、CSV 等文本文件，以及 PDF、Word（.doc/.docx）、Excel（.xls/.xlsx/.xlsm）、PPT（.ppt/.pptx）、RTF 文档`);
    }
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      throw new Error(`文件不存在或不是可读取的文本文件：${relativePath}。请先用 list_files 查看所在目录的实际内容，确认路径后再试`);
    }
    return clipped(content, READ_LIMIT);
  }

  // 老式 .doc 是微软私有 OLE2 二进制格式，无法像 .docx 那样直接解 XML，
  // 只能借助本机转换器：macOS 自带 textutil → antiword → LibreOffice，逐个探测
  async extractLegacyDoc(file, relativePath) {
    try {
      await fs.stat(file);
    } catch {
      throw new Error(`文件不存在：${relativePath}`);
    }
    const attempts = [
      { program: "textutil", args: ["-convert", "txt", "-stdout", file] },
      { program: "antiword", args: [file] },
    ];
    for (const attempt of attempts) {
      const result = await runProcess(attempt.program, attempt.args, 60_000, READ_LIMIT);
      if (result.ok && result.output.trim()) return result.output.trim();
    }
    // LibreOffice（麒麟/UOS 政务机通常自带）：转成 txt 后读回
    const outdir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-doc-"));
    const converted = await runProcess("soffice", ["--headless", "--convert-to", "txt:Text", "--outdir", outdir, file], 60_000, 2000);
    if (converted.ok) {
      const txt = path.join(outdir, `${path.basename(file, path.extname(file))}.txt`);
      const text = await fs.readFile(txt, "utf8").catch(() => "");
      if (text.trim()) return text.trim();
    }
    throw new Error("老式 .doc 是二进制格式，需要本机装有 textutil（macOS 自带）、antiword 或 LibreOffice 之一才能读取；也可以用 WPS 把文件另存为 .docx 后再读");
  }

  async extractDocument(file, extension, relativePath) {
    try {
      await fs.stat(file);
    } catch {
      throw new Error(`文件不存在：${relativePath}`);
    }
    if (extension === ".doc") return this.extractLegacyDoc(file, relativePath);
    if (extension === ".ppt") return this.extractLegacyPpt(file);
    if (extension === ".rtf") return this.extractRtf(file);
    if (extension === ".pdf") {
      const result = await runProcess("pdftotext", ["-layout", file, "-"], 60_000, READ_LIMIT);
      if (!result.ok) {
        throw new Error(result.output.includes("无法启动程序")
          ? "缺少 PDF 解析组件，请安装 poppler-utils 后重试"
          : `PDF 解析失败：${result.output}`);
      }
      return result.output.trim() || "（PDF 中没有可提取的文字）";
    }
    // .docx/.docm/.pptx/.pptm/.xlsx/.xlsm 走 zip 解析；.xls 走内置 BIFF 解析
    const text = await this.runOfficeExtractor(file);
    return text || "（文档中没有可提取的文字）";
  }

  async runOfficeExtractor(file) {
    const scriptSource = path.join(moduleDir, "scripts", "extract_office.py");
    const temporary = path.join(os.tmpdir(), `dyworker-office-${process.pid}.py`);
    await fs.copyFile(scriptSource, temporary);
    const result = await runPython([temporary, file], 60_000, READ_LIMIT);
    if (!result.ok) throw new Error(`办公文档解析失败：${result.output}`);
    return result.output.trim();
  }

  // RTF 富文本：macOS 自带 textutil 可转纯文本；无 textutil 时退回 LibreOffice
  async extractRtf(file) {
    const result = await runProcess("textutil", ["-convert", "txt", "-stdout", file], 60_000, READ_LIMIT);
    if (result.ok && result.output.trim()) return result.output.trim();
    const outdir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-rtf-"));
    const converted = await runProcess("soffice", ["--headless", "--convert-to", "txt:Text", "--outdir", outdir, file], 60_000, 2000);
    if (converted.ok) {
      const txt = path.join(outdir, `${path.basename(file, path.extname(file))}.txt`);
      const text = await fs.readFile(txt, "utf8").catch(() => "");
      if (text.trim()) return text.trim();
    }
    throw new Error("读取 RTF 需要 textutil（macOS 自带）或 LibreOffice 之一，本机未找到可用的转换器");
  }

  // 老式 .ppt 是二进制格式：优先 catppt，其次 LibreOffice 转成 .pptx 后按新格式解析
  async extractLegacyPpt(file, relativePath = "") {
    const catppt = await runProcess("catppt", [file], 60_000, READ_LIMIT);
    if (catppt.ok && catppt.output.trim()) return catppt.output.trim();
    const outdir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-ppt-"));
    const converted = await runProcess("soffice", ["--headless", "--convert-to", "pptx", "--outdir", outdir, file], 120_000, 2000);
    if (converted.ok) {
      const pptxFile = path.join(outdir, `${path.basename(file, path.extname(file))}.pptx`);
      try {
        const text = await this.runOfficeExtractor(pptxFile);
        if (text) return text;
      } catch { /* 转换产物解析失败则落到下方提示 */ }
    }
    throw new Error("老式 .ppt 是二进制格式，需要本机装有 catppt 或 LibreOffice 才能读取；也可以用 WPS 把文件另存为 .pptx 后再读");
  }

  async writeFile(relativePath, content) {
    const file = this.resolve(relativePath, { forWrite: true });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(content ?? ""), "utf8");
    return `已写入 ${relativePath}（${Buffer.byteLength(String(content ?? ""), "utf8")} 字节）`;
  }

  async readTextIfExists(relativePath) {
    try {
      return await fs.readFile(this.resolve(relativePath, { forWrite: false }), "utf8");
    } catch {
      return null;
    }
  }

  // 局部编辑（对照 Codex apply_patch 的替换语义）：精确匹配 find 并替换
  async editFile(relativePath, find, replace, replaceAll = false) {
    const file = this.resolve(relativePath, { forWrite: true });
    const findText = String(find ?? "");
    const replaceText = String(replace ?? "");
    if (!findText) throw new Error("edit_file 的 find 不能为空");
    if (findText === replaceText) throw new Error("find 和 replace 内容相同，无需修改");
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      throw new Error(`文件不存在或不是可编辑的文本文件：${relativePath}`);
    }
    const occurrences = content.split(findText).length - 1;
    if (!occurrences) throw new Error(`在 ${relativePath} 中没有找到要替换的原文，请先读取文件核对内容`);
    if (occurrences > 1 && !replaceAll) {
      throw new Error(`在 ${relativePath} 中找到 ${occurrences} 处相同内容，请在 find 中包含更多上下文使其唯一，或将 replace_all 设为 true`);
    }
    const next = replaceAll ? content.split(findText).join(replaceText) : content.replace(findText, replaceText);
    await fs.writeFile(file, next, "utf8");
    const { added, removed } = diffLineCounts(content, next);
    return { message: `已编辑 ${relativePath}（+${added} -${removed}）`, added, removed, diff: unifiedDiff(content, next, relativePath) };
  }

  async makeDirectory(relativePath) {
    const directory = this.resolve(relativePath, { forWrite: true });
    await fs.mkdir(directory, { recursive: true });
    return `已创建文件夹 ${relativePath}`;
  }

  // 追加内容到文件末尾（登记簿、台账场景）；文件不存在时自动新建
  async appendFile(relativePath, content) {
    const file = this.resolve(relativePath, { forWrite: true });
    let before = "";
    try {
      before = await fs.readFile(file, "utf8");
    } catch { /* 新文件 */ }
    const text = String(content ?? "");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, (before && !before.endsWith("\n") ? "\n" : "") + text, "utf8");
    return { message: `已向 ${relativePath} 追加内容（共 ${text.split("\n").length} 行）`, added: text.split("\n").length };
  }

  async copyFile(source, target) {
    const from = this.resolve(source, { forWrite: false });
    const to = this.resolve(target, { forWrite: true });
    const sourceStat = await fs.stat(from).catch(() => null);
    if (!sourceStat?.isFile()) throw new Error(`源文件不存在：${source}，请先用 list_files 或 find_files 核对`);
    const exists = await fs.stat(to).then(() => true, () => false);
    if (exists) throw new Error(`目标已存在：${target}。如需覆盖请先删除目标文件，或换一个文件名`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return `已复制 ${source} → ${target}`;
  }

  async moveFile(source, target) {
    const from = this.resolve(source, { forWrite: true });
    const to = this.resolve(target, { forWrite: true });
    const sourceStat = await fs.stat(from).catch(() => null);
    if (!sourceStat) throw new Error(`源文件不存在：${source}，请先用 list_files 或 find_files 核对`);
    const exists = await fs.stat(to).then(() => true, () => false);
    if (exists) throw new Error(`目标已存在：${target}。如需覆盖请先删除目标文件，或换一个文件名`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    return `已移动 ${source} → ${target}`;
  }

  // 只能删除文件、不能删除文件夹；始终需要用户审批，并可被 hooks 规则拦截
  async deleteFile(relativePath) {
    const file = this.resolve(relativePath, { forWrite: true });
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) throw new Error(`文件不存在：${relativePath}，请先用 list_files 核对`);
    if (stat.isDirectory()) throw new Error(`delete_file 只能删除文件，不能删除文件夹：${relativePath}`);
    const before = await fs.readFile(file, "utf8").catch(() => "");
    await fs.rm(file);
    return { message: `已删除 ${relativePath}`, removed: before ? before.split("\n").length : 0 };
  }

  // 按文件名递归查找（支持 * 通配，无通配时按包含匹配）
  async findFiles(pattern, directory = "") {
    const base = this.resolve(directory, { forWrite: false });
    const raw = String(pattern || "").trim();
    if (!raw) throw new Error("请提供要查找的文件名或模式");
    const matcher = raw.includes("*")
      ? new RegExp(`^${raw.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i")
      : null;
    const hits = [];
    const walk = async (dir) => {
      if (hits.length >= 100) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      for (const entry of entries) {
        if (ignoredNames.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (matcher ? matcher.test(entry.name) : entry.name.toLowerCase().includes(raw.toLowerCase())) {
          hits.push(path.relative(this.root, full));
        }
        if (hits.length >= 100) return;
      }
    };
    await walk(base);
    if (!hits.length) return `没有找到匹配「${raw}」的文件，可以换个关键词或用 list_files 逐层查看`;
    return hits.join("\n") + (hits.length >= 100 ? "\n…（结果过多，已截断，请缩小范围或换更精确的模式）" : "");
  }

  // 在工作区文本文件中全文检索（只搜文本类文件、单文件 512KB 以内）
  async searchInFiles(query, directory = "") {
    const needle = String(query || "");
    if (!needle.trim()) throw new Error("请提供要搜索的内容");
    const base = this.resolve(directory, { forWrite: false });
    const matches = [];
    const lower = needle.toLowerCase();
    const walk = async (dir) => {
      if (matches.length >= 50) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (ignoredNames.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        const extension = path.extname(entry.name).toLowerCase();
        if (extension && !textExtensions.has(extension)) continue;
        const stat = await fs.stat(full).catch(() => null);
        if (!stat || stat.size > 512 * 1024) continue;
        const content = await fs.readFile(full, "utf8").catch(() => "");
        const lines = content.split("\n");
        for (let index = 0; index < lines.length && matches.length < 50; index++) {
          if (lines[index].toLowerCase().includes(lower)) {
            matches.push(`${path.relative(this.root, full)}:${index + 1}: ${lines[index].trim().slice(0, 120)}`);
          }
        }
        if (matches.length >= 50) return;
      }
    };
    await walk(base);
    if (!matches.length) return `工作区文本文件中没有找到「${needle}」（PDF/Word 等文档请用 read_file 读取后核对）`;
    return matches.join("\n") + (matches.length >= 50 ? "\n…（匹配过多，已截断，请缩小范围）" : "");
  }

  async runCommand(command, execution: any = {}) {
    if (!this.root) {
      return Promise.resolve({ ok: false, output: "还没有选择工作文件夹，无法运行命令。请先告诉用户选择工作文件夹后再继续。" });
    }
    let confined;
    try { confined = await prepareCommandExecution(command, { workspacePath: this.root,
      mode: execution.mode || 'workspace-write', signal: this.cancellationSignal }); }
    catch (error: any) { return { ok: false, errorCode: error.code || 'SANDBOX_UNAVAILABLE', output: `执行保护暂时不可用，命令未执行：${error.message || error}` }; }
    return new Promise<any>((resolve) => {
      const win32 = process.platform === "win32";
      const [program, ...args] = confined.argv;
      const diagnostics = createCommandDiagnostics(confined);
      // detached：让 bash 自成进程组，终止时连子进程（如 docker、脚本）一起杀掉，
      // 否则只杀 bash 会留下孤儿进程继续占用资源
      const child = spawn(program, args, { cwd: this.root, detached: !win32,
        ...(confined.env ? { env: { ...process.env, ...confined.env } } : {}) });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const kill = () => {
        try {
          if (!win32) process.kill(-child.pid, "SIGKILL");
          else if (child.pid) {
            // Windows 没有进程组：child.kill 只杀 cmd.exe，命令本体（孙进程）会
            // 存活并占用输出管道，taskkill /T 才能连整棵进程树一起终止
            spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
          }
        } catch {
          try { child.kill("SIGKILL"); } catch { /* 进程已退出 */ }
        }
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        this.cancellationSignal?.removeEventListener?.("abort", onAbort);
        resolve(result);
      };
      // 停止/取消：立即杀掉命令进程组并结束本次工具调用
      const onAbort = () => {
        kill();
        finish({ ok: false, output: "任务已停止，命令被终止" });
      };
      const timer = setTimeout(() => {
        kill();
        finish({ ok: false, output: `命令运行超过 ${COMMAND_TIMEOUT_MS / 1000} 秒，已被终止` });
      }, COMMAND_TIMEOUT_MS);
      // 渠道「停止」等只翻转 isCancelled 的场景靠轮询兜底（对齐 waitModelRetry 的 100ms）
      const poll = this.isCancelled ? setInterval(() => { if (this.isCancelled()) onAbort(); }, 100) : null;
      if (this.cancellationSignal) {
        if (this.cancellationSignal.aborted) { onAbort(); return; }
        this.cancellationSignal.addEventListener("abort", onAbort, { once: true });
      }
      child.stdout.on("data", (chunk) => { stdout = clipped(stdout + chunk.toString(), COMMAND_OUTPUT_LIMIT); });
      child.stderr.on("data", (chunk) => {
        diagnostics.write(chunk);
        stderr = clipped(stderr + chunk.toString(), COMMAND_OUTPUT_LIMIT);
      });
      child.on("error", (error) => {
        finish({ ok: false, output: `命令无法启动：${error.message}` });
      });
      child.on("close", (code) => {
        const output = [stdout, stderr].filter(Boolean).join("\n") || "（命令没有输出）";
        const protection = diagnostics.finish(code);
        const notice = protection.state === 'unavailable' ? `执行保护报告故障，不能确认命令已受保护地完成：${protection.detail}\n`
          : protection.state === 'denied' ? '执行保护拒绝了本次文件操作。\n' : '';
        const scope = confined.enforcement === 'partial' ? '当前系统提供部分文件写入保护，存在后端已声明的范围限制。\n' : '';
        finish({ ok: code === 0 && protection.state === 'ready', ...(protection.errorCode ? { errorCode: protection.errorCode } : {}),
          protection: { enforcement: confined.enforcement, ...protection }, output: `${scope}${notice}退出码 ${code}\n${output}` });
      });
    });
  }
}

function collectTempRoots() {
  const candidates = [os.tmpdir()];
  if (process.platform === "darwin") {
    // macOS per-user 临时容器：$TMPDIR 是 <容器>/T，同级的 X（Chrome 签名克隆、安装器等
    // 临时产物）与 C（应用缓存，可再生成）也是常规临时操作对象。只信任 T 会把这些误报为
    // 工作区外路径。容器的 0/ 存放 launchd 会话数据，不在信任范围。
    const container = path.dirname(os.tmpdir());
    for (const sub of ["T", "X", "C"]) candidates.push(path.join(container, sub));
  }
  if (process.platform !== "win32") candidates.push("/tmp");
  const roots = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    roots.add(resolved);
    try {
      roots.add(realpathSync(resolved));
    } catch {
      // 目录不存在时保留解析后的路径即可
    }
  }
  return [...roots];
}
