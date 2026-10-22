// 办公检查、工作日计算、文档导出与文字识别。
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectProvider,glmOcrFile,glmToolBaseUrl } from "../providers.mts";
import { READ_LIMIT,clipped,ignoredNames,moduleDir,runPython,textExtensions } from "./shared.mts";

// ---- 政府办公工具：保密检查与公文格式检查 ----

const sensitivePatterns = [
  { type: "身份证号", pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { type: "手机号", pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: "银行卡号（疑似）", pattern: /(?<!\d)\d{16,19}(?!\d)/g },
  { type: "电子邮箱", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];
const idCardPattern = /^\d{17}[\dXx]$/;

function maskSensitive(type, value) {
  if (type === "电子邮箱") {
    const at = value.indexOf("@");
    return `${value.slice(0, 1)}***${value.slice(at)}`;
  }
  if (value.length <= 5) return "*".repeat(value.length);
  return `${value.slice(0, 3)}${"*".repeat(Math.max(4, value.length - 5))}${value.slice(-2)}`;
}

const SENSITIVE_SCAN_FILE_LIMIT = 200;

async function collectTextFiles(workspace, relativePath, budget = { remaining: SENSITIVE_SCAN_FILE_LIMIT }) {
  const absolute = workspace.resolve(relativePath || "");
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat) throw new Error(`路径不存在：${relativePath || "."}`);
  if (stat.isFile()) {
    const extension = path.extname(absolute).toLowerCase();
    if (extension && !textExtensions.has(extension)) throw new Error(`只能扫描文本类文件，${extension || "该格式"} 暂不支持`);
    return [relativePath || path.basename(absolute)];
  }
  const found = [];
  const walk = async (dir) => {
    if (budget.remaining <= 0) return;
    const entries = await fs.readdir(workspace.resolve(dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (budget.remaining <= 0) return;
      if (ignoredNames.has(entry.name)) continue;
      const child = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
        budget.remaining -= 1;
        found.push(child);
      }
    }
  };
  await walk(relativePath || "");
  return found;
}

export async function scanSensitiveInfo(workspace, relativePath = "") {
  const files = await collectTextFiles(workspace, String(relativePath || "").trim());
  if (!files.length) return "没有可扫描的文本文件";
  const report = [];
  let total = 0;
  for (const file of files) {
    const content = await workspace.readTextIfExists(file);
    if (!content) continue;
    const lines = content.split("\n");
    const findings = [];
    lines.forEach((line, index) => {
      for (const { type, pattern } of sensitivePatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line))) {
          // 18 位数字串优先按身份证号报告，避免与银行卡号重复
          if (type.startsWith("银行卡") && idCardPattern.test(match[0])) continue;
          findings.push(`- 第 ${index + 1} 行 [${type}] ${maskSensitive(type, match[0])}`);
        }
      }
    });
    if (findings.length) {
      total += findings.length;
      report.push(`文件 ${file}（${findings.length} 处）：\n${findings.slice(0, 20).join("\n")}${findings.length > 20 ? `\n- …另有 ${findings.length - 20} 处` : ""}`);
    }
  }
  if (!total) return `已扫描 ${files.length} 个文本文件，未发现身份证号、手机号、银行卡号、电子邮箱等敏感信息。`;
  return `共扫描 ${files.length} 个文件，发现 ${total} 处敏感信息：\n\n${report.join("\n\n")}\n\n建议：对外发布、上报或共享前先脱敏；确需保留的请确认已获得授权并符合保密要求。`;
}

const arabicDatePattern = /(19|20)\d{2}年\d{1,2}月\d{1,2}日/;
const chineseDatePattern = /[〇零一二三四五六七八九十]{4}年[一二三四五六七八九十]{1,3}月[一二三四五六七八九十]{1,3}日/;
const docNumberPattern = /〔\s*(19|20)\d{2}\s*〕\s*\d+\s*号/;
const wrongBracketDocNumber = /[(\[【]\s*(19|20)\d{2}\s*[)\]】]\s*\d+\s*号/;

export function checkOfficialDocumentText(content) {
  const lines = String(content || "").split("\n").map((line) => line.trim());
  const nonEmpty = lines.filter(Boolean);
  const issues = [];
  const passed = [];
  if (!nonEmpty.length) return { issues: ["文件没有内容"], passed };
  // 标题：首个非空行
  passed.push(`标题：${nonEmpty[0].slice(0, 40)}`);
  // 发文字号：六角括号〔〕
  if (docNumberPattern.test(content)) passed.push("发文字号：格式规范（六角括号〔〕）");
  else if (wrongBracketDocNumber.test(content)) issues.push("发文字号年份应使用六角括号〔〕，不要用圆括号()、方括号[]或【】");
  else issues.push("未找到规范的发文字号（如：×政发〔2024〕5号）；无需编号的文种（如纪要）可忽略");
  // 主送机关：标题之后应有以冒号结尾的行
  const titleIndex = lines.findIndex(Boolean);
  const receiver = lines.slice(titleIndex + 1, titleIndex + 5).find((line) => /[:：]\s*$/.test(line) && line.length <= 40);
  if (receiver) passed.push(`主送机关：${receiver.slice(0, 30)}`);
  else issues.push("标题正下方未找到主送机关（应为顶格、以全角冒号结尾的一行，如：各市财政局：）");
  // 成文日期：阿拉伯数字
  if (chineseDatePattern.test(content)) issues.push("成文日期使用了中文数字，应改为阿拉伯数字（如：2024年3月5日）");
  if (arabicDatePattern.test(content)) passed.push("成文日期：阿拉伯数字格式");
  else issues.push("未找到成文日期（应为阿拉伯数字，如：2024年3月5日，位于落款机关下一行）");
  // 落款：成文日期上一非空行应为发文机关署名
  const dateLineIndex = lines.findIndex((line) => arabicDatePattern.test(line));
  if (dateLineIndex > 0) {
    const signer = [...lines.slice(0, dateLineIndex)].reverse().find(Boolean);
    if (signer && !/[。；;]$/.test(signer)) passed.push(`发文机关署名：${signer.slice(0, 30)}`);
    else issues.push("成文日期上方未找到发文机关署名");
  }
  // 附件说明
  if (/^附件[:：]/m.test(content)) {
    if (/^附件[:：]\s*\d+[.、]/m.test(content) || /^附件[:：]\s*\S/m.test(content)) passed.push("附件说明：已标注");
  }
  return { issues, passed };
}

export async function checkOfficialDocument(workspace, relativePath) {
  const extension = path.extname(String(relativePath || "")).toLowerCase();
  if (extension && !textExtensions.has(extension)) {
    throw new Error("格式检查目前支持文本类公文（.md/.txt 等）；Word 公文可先让助手整理为文本稿再检查");
  }
  const content = await workspace.readFile(relativePath);
  const { issues, passed } = checkOfficialDocumentText(content);
  const parts = [`公文格式检查：${relativePath}（依据 GB/T 9704《党政机关公文格式》的文本结构要点，字体、页边距等版面要素请在排版软件中复核）`];
  if (passed.length) parts.push(`符合项：\n${passed.map((item) => `- ${item}`).join("\n")}`);
  if (issues.length) parts.push(`需要修正：\n${issues.map((item) => `- ${item}`).join("\n")}`);
  else parts.push("未发现文本结构上的格式问题。");
  return parts.join("\n\n");
}

// ---- 政府办公工具：办理时限计算 ----

function parseIsoDate(value, label) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label}格式应为 YYYY-MM-DD：${text || "（空）"}`);
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}无效：${text}`);
  return date;
}

function formatIsoDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

export function addWorkdays(start, days) {
  const date = new Date(start.getTime());
  let remaining = Math.abs(days);
  const step = days >= 0 ? 1 : -1;
  while (remaining > 0) {
    date.setDate(date.getDate() + step);
    if (!isWeekend(date)) remaining -= 1;
  }
  return date;
}

export function workdaysBetween(start, end) {
  if (end <= start) return 0;
  const date = new Date(start.getTime());
  let count = 0;
  while (date < end) {
    date.setDate(date.getDate() + 1);
    if (date <= end && !isWeekend(date)) count += 1;
  }
  return count;
}

export function calculateWorkdays({ startDate, days, endDate }) {
  const start = startDate ? parseIsoDate(startDate, "起始日期") : new Date(new Date().toDateString());
  const holidayNote = "结果已排除周六日，未扣除法定节假日；如遇放假安排，请以国务院办公厅通知为准相应顺延（可用政府官网搜索查询当年放假安排）。";
  if (endDate) {
    const end = parseIsoDate(endDate, "结束日期");
    const count = workdaysBetween(start, end);
    return `从 ${formatIsoDate(start)} 到 ${formatIsoDate(end)} 共 ${count} 个工作日（不含起始日，含结束日）。${holidayNote}`;
  }
  const amount = Number.isFinite(Number(days)) ? Math.trunc(Number(days)) : NaN;
  if (!Number.isFinite(amount) || amount === 0) throw new Error("请提供工作日数量 days（非零整数），或提供 end_date 计算两日期间的工作日数");
  const target = addWorkdays(start, amount);
  return `从 ${formatIsoDate(start)} 起 ${amount > 0 ? "向后" : "向前"} ${Math.abs(amount)} 个工作日是 ${formatIsoDate(target)}（不含起始日）。${holidayNote}`;
}

// ---- 政府办公工具：Word（.docx）导出 ----

export async function exportWordDocument(workspace, relativePath, title, content) {
  const target = String(relativePath || "").trim();
  if (!target.toLowerCase().endsWith(".docx")) throw new Error("导出路径必须以 .docx 结尾");
  const file = workspace.resolve(target);
  const scriptSource = path.join(moduleDir, "scripts", "make_docx.py");
  const temporary = path.join(os.tmpdir(), `dyworker-docx-${process.pid}.py`);
  await fs.copyFile(scriptSource, temporary);
  const paragraphs = String(content ?? "").split("\n");
  const result = await runPython([temporary], 60_000, 2000, {
    input: JSON.stringify({ path: file, title: String(title || ""), paragraphs }),
  });
  if (!result.ok) throw new Error(`Word 导出失败：${result.output}`);
  return `已导出 Word 文档 ${target}（${paragraphs.filter((line) => line.trim()).length} 个段落，标题二号居中、正文三号仿宋）`;
}

// ---- 政府办公工具：Excel（.xlsx）统计表导出 ----

export async function exportExcelWorkbook(workspace, relativePath, sheets) {
  const target = String(relativePath || "").trim();
  if (!target.toLowerCase().endsWith(".xlsx")) throw new Error("导出路径必须以 .xlsx 结尾");
  const list = Array.isArray(sheets) ? sheets : [];
  if (!list.length) throw new Error("sheets 不能为空：至少提供一个工作表（name + rows）");
  const normalized = list.map((sheet, index) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    if (!rows.length) throw new Error(`工作表「${sheet?.name || index + 1}」没有数据行`);
    if (rows.length > 5000) throw new Error(`工作表「${sheet?.name || index + 1}」超过 5000 行上限`);
    return { name: String(sheet?.name || `Sheet${index + 1}`), rows: rows.map((row) => (Array.isArray(row) ? row : [row])) };
  });
  const file = workspace.resolve(target);
  const scriptSource = path.join(moduleDir, "scripts", "make_xlsx.py");
  const temporary = path.join(os.tmpdir(), `dyworker-xlsx-${process.pid}.py`);
  await fs.copyFile(scriptSource, temporary);
  const result = await runPython([temporary], 60_000, 2000, {
    input: JSON.stringify({ path: file, sheets: normalized }),
  });
  if (!result.ok) throw new Error(`Excel 导出失败：${result.output}`);
  return `已导出 Excel 表格 ${target}（${normalized.length} 个工作表：${normalized.map((sheet) => `${sheet.name} ${sheet.rows.length} 行`).join("、")}，可用 WPS 表格或 Microsoft Excel 打开）`;
}

// 当前日期时间（防止模型凭训练数据猜日期）
export function currentDatetime() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `现在是 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}，星期${weekdays[now.getDay()]}。涉及办理时限请用 calculate_workdays 按工作日推算。`;
}

// read_file 分页：默认最多 2000 行，超出时告知模型总行数并引导用 offset 续读（借鉴 Claude Code Read 的 offset/limit 设计）
export function sliceLines(content, offset, limit) {
  const lines = String(content).split("\n");
  const start = Math.max(1, Math.floor(Number(offset) || 1));
  const max = Math.min(5000, Math.max(1, Math.floor(Number(limit) || 2000)));
  if (start > lines.length) return `（文件共 ${lines.length} 行，起始行 ${start} 超出范围，请调整 offset）`;
  const slice = lines.slice(start - 1, start - 1 + max);
  const end = start - 1 + slice.length;
  if (start === 1 && end >= lines.length) return slice.join("\n");
  const more = end < lines.length ? "；继续阅读请用 offset 参数指定下一页起始行" : "";
  return `${slice.join("\n")}\n…（第 ${start}-${end} 行，共 ${lines.length} 行${more}）`;
}

// ---- GLM-OCR 文件识别（ocr_file 工具执行体）----
// 官方限制：图片 ≤ 10MB（PNG/JPG），PDF ≤ 50MB（≤ 100 页，超出用页码参数分段）；
// file 字段按 GLM 视觉系约定编码为 Data URL 传入。
const OCR_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".pdf", "application/pdf"],
]);
const OCR_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const OCR_PDF_MAX_BYTES = 50 * 1024 * 1024;

export async function runOcrFile(workspace, settings, fetchImpl, args) {
  if (detectProvider(settings.endpoint) !== "glm" || !String(settings.apiKey || "").trim()) {
    throw new Error("ocr_file 的识别服务来自智谱开放平台（GLM-OCR）：请在设置中把模型服务切换为 GLM（智谱）并配置密钥后再试");
  }
  const target = workspace.resolve(String(args.path || ""), { forWrite: false });
  const extension = path.extname(target).toLowerCase();
  const mime = OCR_MIME_BY_EXTENSION.get(extension);
  if (!mime) throw new Error(`ocr_file 只支持 PNG/JPG 图片或 PDF 文件，不支持 ${extension || "该格式"}`);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) throw new Error(`文件不存在：${args.path}`);
  const maxBytes = extension === ".pdf" ? OCR_PDF_MAX_BYTES : OCR_IMAGE_MAX_BYTES;
  if (stat.size > maxBytes) {
    throw new Error(`文件超过 GLM-OCR 大小限制（${extension === ".pdf" ? "PDF ≤ 50MB" : "图片 ≤ 10MB"}）：${args.path}`);
  }
  const buffer = await fs.readFile(target);
  const { markdown } = await glmOcrFile(fetchImpl, {
    baseUrl: glmToolBaseUrl(settings.endpoint),
    apiKey: settings.apiKey,
    file: `data:${mime};base64,${buffer.toString("base64")}`,
    startPage: args.start_page,
    endPage: args.end_page,
  });
  return clipped(markdown, READ_LIMIT);
}
