// 代理共用的限制、文件类型和进程辅助函数。
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";


export const moduleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const READ_ONLY_TOOLS = Object.freeze(new Set([
  "list_files",
  "find_files",
  "search_in_files",
  "get_datetime",
  "open_file",
  "read_file",
  "view_image",
  "ocr_file",
  "search_history",
  "read_history_context",
  "list_skills",
  "load_skill",
  "web_search",
  "gov_search",
  "fetch_web_page",
  "scan_sensitive_info",
  "check_official_document",
  "calculate_workdays",
]));

// 不设工具轮次上限（用户明确要求：一直跑到任务完成，对标 Codex/Kimi Work 的长程执行）。
// 防失控只靠两道：下面的“连续重复操作检测”，以及用户可随时取消任务。
// 单次模型请求的总时长上限（建连 + 流式读完的全程），只作防失控兜底。
export const MODEL_TIMEOUT_MS = 600_000;
// 推理服务可能先发响应头，再排队、处理长上下文或静默思考数分钟。
// 90 秒无字节不能证明断线；留出 5 分钟空闲窗口，每次收到数据重新计时。
export const MODEL_IDLE_TIMEOUT_MS = 300_000;
// 超时/断流后的自动重试次数：模型请求在执行任何工具前是无副作用的，重发安全；
// 用户主动取消（isCancelled / cancellationSignal）不重试
export const MODEL_TIMEOUT_RETRY_LIMIT = 3;
export const MODEL_TRANSPORT_RETRY_BASE_DELAY_MS = 1000;
// 网络层抖动自动重试：fetch 本身连接失败（fetch failed 等）时按指数退避重试。
// 实际观测到本地推理服务的断流窗口可达 30 秒级，3 次×1s 的固定间隔 span 太短，
// 改为 1s/2s/4s/8s/16s 共 5 次重试（总等待约 31 秒），覆盖典型抖动窗口。
// 服务端已返回的状态码不重试，交由既有状态码/压缩回退逻辑处理。取消与中止不重试。
export const MODEL_NETWORK_RETRY_LIMIT = 5;
export const MODEL_NETWORK_RETRY_BASE_DELAY_MS = 1000;
// 服务端状态码类错误自动重试：429（过载/限流，如 vLLM engine_overloaded）、408、5xx
// （含 529 过载、502/503/504 网关抖动）属于瞬时故障，退避后重发通常可恢复；
// 401/403 等凭证问题、400 请求问题与内容安全拦截重试无意义，不在此列。
// 用户明确要求：模型报错自动重试，最多 10 次。
export const MODEL_STATUS_RETRY_LIMIT = 10;
export const MODEL_STATUS_RETRY_BASE_DELAY_MS = 1000;
// 单次重试等待上限（含服务端 Retry-After 指示的等待）：10 次重试的累计等待
// 控制在约 5 分钟内，仍留有单次请求超时（MODEL_TIMEOUT_MS）的余量
export const MODEL_STATUS_RETRY_MAX_DELAY_MS = 60_000;
export const COMMAND_TIMEOUT_MS = 120_000;
export const COMMAND_OUTPUT_LIMIT = 20 * 1024;
export const READ_LIMIT = 300 * 1024;
export const LIST_LIMIT = 300;
export const WORKING_CONTEXT_LIMIT = 48 * 1024;
export const WORKING_CONTEXT_ITEM_LIMIT = 12 * 1024;

export const textExtensions = new Set([
  ".adoc", ".bat", ".c", ".cc", ".cfg", ".clj", ".cljs", ".cmake", ".cmd", ".conf", ".cpp", ".css", ".csv", ".dart",
  ".eml", ".env", ".erl", ".ex", ".exs", ".go", ".gradle", ".graphql", ".gql", ".groovy", ".h", ".hpp", ".htm", ".html",
  ".http", ".ini", ".ipynb", ".java", ".js", ".json", ".jsonl", ".jsx", ".kt", ".less", ".log", ".lua", ".m", ".md",
  ".markdown", ".mjs", ".mm", ".ndjson", ".org", ".php", ".pl", ".properties", ".proto", ".ps1", ".psm1", ".py", ".r",
  ".rb", ".rs", ".rst", ".sass", ".scala", ".scss", ".sh", ".svelte", ".sql", ".svg", ".swift", ".tex", ".tf", ".toml",
  ".ts", ".tsv", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zig",
]);
// .docx/.docm/.pptx/.pptm/.xlsx/.xlsm 由 scripts/extract_office.py 解析（纯标准库，
// 其中 .xls 为 OLE2+BIFF8 二进制格式）；.pdf 用 pdftotext；.doc/.ppt/.rtf 走本机转换器
export const documentExtensions = new Set([
  ".pdf", ".doc", ".docx", ".docm", ".rtf",
  ".xls", ".xlsx", ".xlsm",
  ".ppt", ".pptx", ".pptm",
]);
export const ignoredNames = new Set([".git", "node_modules", "dist", ".DS_Store"]);

export function runProcess(program, args, timeoutMs, maxOutput, options = {} as any) {
  return new Promise<any>((resolve) => {
    const { input, ...spawnOptions } = options;
    const child = spawn(program, args, spawnOptions);
    if (input != null) {
      child.stdin.on("error", () => { });
      child.stdin.write(input);
      child.stdin.end();
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ ok: false, output: "处理超时，已终止" });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = clipped(stdout + chunk.toString(), maxOutput); });
    child.stderr.on("data", (chunk) => { stderr = clipped(stderr + chunk.toString(), maxOutput); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, output: `无法启动程序：${error.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, output: stderr.trim() ? clipped(stderr.trim(), 1000) : `程序退出码 ${code}` });
        return;
      }
      resolve({ ok: true, output: stdout });
    });
  });
}

// Windows 上常见命令名是 python，macOS/Linux 是 python3；依次尝试直到能启动。
export async function runPython(args, timeoutMs, maxOutput, options = {} as any) {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const program of candidates) {
    const result = await runProcess(program, args, timeoutMs, maxOutput, options);
    if (result.ok || !result.output.startsWith("无法启动程序")) return result;
  }
  return { ok: false, output: `未找到 Python 运行环境（已尝试 ${candidates.join("、")}），请先安装 Python` };
}

export function isSafeRelativePath(relativePath) {
  const value = String(relativePath || "").trim();
  if (!value) return true; // 空路径表示工作区根目录
  if (path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) return false;
  return value.split(/[\\/]+/).every((part) => part !== "..");
}

export function clipped(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…（内容过长，已截断）`;
}
