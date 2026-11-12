// 本地决策模型（Intern-Decision）：官方 ModelScope 仓库整包（safetensors 权重 +
// 官方 inference.py 与 requirements.txt），由 Python venv 里的 decision_server.py
// 暴露与远程服务一致的 /v1/decisions 协议。这里只负责模型与 Python 运行时
// （venv + pip 依赖）的下载和状态；进程管理与判定请求在 local-decision-server.mts。
// 下载/状态结构与语音模型（local-asr.mts）保持同构，pip 依赖对应 ASR 的 llama.cpp 运行时。
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statfsSync, statSync } from "node:fs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { downloadToFile } from "./local-asr.mts";

// 可选模型清单（官方 ModelScope 仓库，weights 与推理代码同仓分发）。
// bytes/sha256 为 ModelScope LFS 元数据（API /repo/files 逐文件核对），下载完成后本地校验。
export const DECISION_MODELS = Object.freeze({
  "intern-decision-2b": Object.freeze({
    id: "intern-decision-2b",
    label: "Intern-Decision-2B",
    repo: "Shanghai_AI_Laboratory/Intern-Decision-2B",
    note: "约 4.3GB · 校准概率审批分档",
    files: Object.freeze([
      Object.freeze({ fileName: "requirements.txt", bytes: 69, sha256: "a07f8990947cc3fa39800d510ebc6b995a15466656e339b485c0a632ef4cdb6e" }),
      Object.freeze({ fileName: "inference.py", bytes: 16260, sha256: "2918862f34770c6db57cf3f86666cbd7cff1139b24f300fef01d9146584d4fd8" }),
      Object.freeze({ fileName: "config.json", bytes: 2908, sha256: "ed1c1723241f23f7f4e23430759cbd7dcfb4103cbdfe052bfe7626b57c2615b4" }),
      Object.freeze({ fileName: "configuration.json", bytes: 76, sha256: "7f5e4dab8f262b1731914cb110764c86dbfc0459a136de7cc3ae4ae375edc828" }),
      Object.freeze({ fileName: "added_tokens.json", bytes: 928, sha256: "f1073c68b68e68ea82a576cf0865df14fc71408681b35724a4d17a214db5a97d" }),
      Object.freeze({ fileName: "special_tokens_map.json", bytes: 735, sha256: "02c0c88f275a15197a3b600ccd6ae7976e9b8b67e8eb5d7500d256d91cb6791b" }),
      Object.freeze({ fileName: "tokenizer_config.json", bytes: 7291, sha256: "f26d55ed6da1fc0de69fbaefae7b855f762e36d0052c05f4fdec312f72a22ae1" }),
      Object.freeze({ fileName: "preprocessor_config.json", bytes: 390, sha256: "27225450ac9c6529872ee1924fcb0962ff5634834f817040f444118116f4e516" }),
      Object.freeze({ fileName: "video_preprocessor_config.json", bytes: 385, sha256: "7768af27c1fafa9cc9011c1dc20067e03f8915e03b63504550e11d5066986d13" }),
      Object.freeze({ fileName: "chat_template.jinja", bytes: 7755, sha256: "273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80" }),
      Object.freeze({ fileName: "model.safetensors.index.json", bytes: 63771, sha256: "0181b2e695c344cecef9e601d0fffaacc3f27688d0da6cc9426b2a7d168e9d4a" }),
      Object.freeze({ fileName: "merges.txt", bytes: 3353273, sha256: "3bd640ba6d8da8f5844f3548b7e2184fc664dd670e1447e425a48dbaaad1ef43" }),
      Object.freeze({ fileName: "vocab.json", bytes: 5234494, sha256: "4ab0d5c096294054b66444a116a20baf6e29998fc1fae410ffe4b6fadbc56b5c" }),
      Object.freeze({ fileName: "tokenizer.json", bytes: 19989530, sha256: "94a639c4b33b192cc5a22cd3d7f0aaf6d97efa9577957a0382b55292ca4f0f00" }),
      Object.freeze({ fileName: "model-projector-0001-save_rank0.safetensors", bytes: 50348664, sha256: "26e6a8056dce97e33101fffab7f41a829546771326bbc03a42696c8bbed09ac3" }),
      Object.freeze({ fileName: "model-vision-0001-save_rank0.safetensors", bytes: 612517440, sha256: "ca0e18ef7b32cab7d52f27f4b52a9907bce9eb8e7b0d46c26bbddecb1d10b812" }),
      Object.freeze({ fileName: "model-language-0001-save_rank0.safetensors", bytes: 3763696728, sha256: "81ee251c9280fd8f0eb6472fd79b638bffbf3b46a8729fad353e053c8891bdf5" }),
    ]),
  }),
});

export const DEFAULT_DECISION_MODEL_ID = "intern-decision-2b";

export function normalizeDecisionModelId(value: unknown) {
  const id = String(value || "").trim();
  return DECISION_MODELS[id] ? id : DEFAULT_DECISION_MODEL_ID;
}

// 只用 ModelScope：国内直连最快（官方仓库，sha256 与 HF 一致），不回退 HuggingFace。
// 与审核模型 / 语音模型下载策略保持一致。
function modelSources(repo: string, fileName: string) {
  return [`https://modelscope.cn/models/${repo}/resolve/master/${fileName}`];
}

let decisionModelDir: string | null = null;
let decisionVenvDir: string | null = null;
const modelDownloadJobs = new Map<string, Promise<any>>(); // modelId -> 下载任务
let runtimeJob: Promise<any> | null = null;

// main 启动时注入 userData/models/decision 与 userData/bin/decision-venv；测试可注入临时目录
export function configureLocalDecision({ modelDir, venvDir } = {} as any) {
  decisionModelDir = modelDir ? String(modelDir) : null;
  decisionVenvDir = venvDir ? String(venvDir) : null;
}

export function localDecisionModelPaths(modelId = DEFAULT_DECISION_MODEL_ID) {
  const definition = DECISION_MODELS[normalizeDecisionModelId(modelId)];
  if (!decisionModelDir) return definition.files.map(() => null);
  return definition.files.map((file) => path.join(decisionModelDir!, file.fileName));
}

// 单个模型的下载状态（缺省取默认模型）
export function localDecisionModelStatus(modelId = DEFAULT_DECISION_MODEL_ID) {
  const definition = DECISION_MODELS[normalizeDecisionModelId(modelId)];
  const paths = localDecisionModelPaths(definition.id);
  const files = definition.files.map((file, index) => {
    const filePath = paths[index];
    const exists = filePath ? existsSync(filePath) : false;
    const sizeBytes = exists ? statSync(filePath).size : 0;
    return {
      fileName: file.fileName,
      role: file.fileName.endsWith(".safetensors") ? "weights" : file.fileName.endsWith(".py") ? "inference" : "config",
      downloaded: exists && sizeBytes === file.bytes,
      sizeBytes,
      expectedBytes: file.bytes,
      filePath: filePath || "",
    };
  });
  return {
    id: definition.id,
    label: definition.label,
    configured: Boolean(decisionModelDir),
    files,
    downloaded: files.every((file) => file.downloaded),
    sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    expectedBytes: definition.files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

// 全部候选模型的概要状态（设置界面下拉列表用，按 DECISION_MODELS 声明顺序）
export function localDecisionAllModelsStatus() {
  return Object.values(DECISION_MODELS).map((definition) => {
    const status = localDecisionModelStatus(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      note: definition.note,
      downloaded: status.downloaded,
      sizeBytes: status.sizeBytes,
      expectedBytes: status.expectedBytes,
    };
  });
}

function reportProgress(onProgress: any, phase: string, received: number, total: number) {
  if (!onProgress) return;
  try {
    onProgress({
      phase,
      received,
      total,
      percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
    });
  } catch {
    // 进度回调异常不中断下载
  }
}

async function computeSha256(filePath: string) {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// 按模型 ID 下载（同一模型并发调用合并为同一个任务，不同模型可并行）。
// 小文件（配置/tokenizer/推理代码）在前，权重分片按体积升序在后。
export async function downloadLocalDecisionModel({ modelId = DEFAULT_DECISION_MODEL_ID, onProgress = null, fetchImpl = fetch, signal = null, checkSpace = true } = {} as any) {
  if (!decisionModelDir) throw new Error("本地决策模型目录未初始化");
  const definition = DECISION_MODELS[normalizeDecisionModelId(modelId)];
  const status = localDecisionModelStatus(definition.id);
  const pending = definition.files.filter((file, index) => !status.files[index].downloaded);
  if (!pending.length) {
    reportProgress(onProgress, "model", status.expectedBytes, status.expectedBytes);
    return { ok: true, skipped: true };
  }
  const existingJob = modelDownloadJobs.get(definition.id);
  if (existingJob) return existingJob;
  const job = (async () => {
    // 余量守卫：待下载字节 + 1GB 余量（.part 与校验副本的临时开销）；测试可关闭
    const pendingBytes = definition.files.reduce((sum, file, index) => status.files[index].downloaded ? sum : sum + file.bytes, 0);
    if (checkSpace) assertDiskSpace(decisionModelDir!, pendingBytes + 1024 ** 3);
    let completedBytes = status.sizeBytes;
    for (const file of pending) {
      const before = completedBytes;
      await downloadToFile({
        sources: modelSources(definition.repo, file.fileName),
        target: path.join(decisionModelDir!, file.fileName),
        expectedBytes: file.bytes,
        expectedSha256: file.sha256,
        fetchImpl,
        signal,
        phase: "model",
        // 多文件下载：进度按整体字节数归一（已完成文件 + 当前文件增量）
        onProgress: (progress: any) => {
          if (!onProgress) return;
          onProgress({ ...progress, phase: "model", received: before + progress.received, total: status.expectedBytes });
        },
      });
      completedBytes = before + file.bytes;
      reportProgress(onProgress, "model", completedBytes, status.expectedBytes);
    }
    return { ok: true };
  })().finally(() => {
    modelDownloadJobs.delete(definition.id);
  });
  modelDownloadJobs.set(definition.id, job);
  return job;
}

// ---- Python 运行时（决策模型的"引擎"：系统 Python + venv + pip 依赖）----
// 对应 ASR 的 llama.cpp 运行时包。官方 requirements 只含 torch/torchvision/transformers/Pillow，
// pypi 直装（mac 轮子带 MPS，Windows 为 CPU 版）。

// 官方要求 Python 3.12+；上限收在 3.14（torch 2.9 / transformers 5.14 的实际支持范围）
const PYTHON_MIN_MINOR = 12;
const PYTHON_MAX_MINOR = 14;
const PIP_INSTALL_TIMEOUT_MS = 40 * 60_000;

function pythonCandidates() {
  if (process.platform === "win32") return [["py", "-3"]];
  const candidates = [["python3.14"], ["python3.13"], ["python3.12"], ["python3"]];
  if (process.platform === "darwin") {
    // Homebrew 的版本化 python 不一定在 PATH 里（GUI 应用继承了受限 PATH）
    candidates.push(["/opt/homebrew/bin/python3"], ["/usr/local/bin/python3"]);
  }
  return candidates;
}

function parsePythonVersion(text: unknown) {
  const match = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ""));
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

function runCommand(program: string, args: string[], { timeoutMs = 60_000, onOutput = null } = {} as any) {
  return new Promise<any>((resolve) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-8000);
      try { onOutput?.(String(chunk)); } catch { /* 回调异常不影响安装 */ }
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8000);
      try { onOutput?.(String(chunk)); } catch { /* 回调异常不影响安装 */ }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// 探测可用的系统 Python；找不到或版本不符返回 null（版本信息用于报错提示）
export async function findDecisionPython({ signal = null } = {} as any) {
  for (const candidate of pythonCandidates()) {
    if (signal?.aborted) throw new Error("已取消");
    const probe = await runCommand(candidate[0], [...candidate.slice(1), "--version"], { timeoutMs: 10_000 });
    const version = parsePythonVersion(probe.stdout || probe.stderr);
    if (probe.code === 0 && version && version.major === 3
      && version.minor >= PYTHON_MIN_MINOR && version.minor <= PYTHON_MAX_MINOR) {
      return { program: candidate[0], prefixArgs: candidate.slice(1), version: `${version.major}.${version.minor}` };
    }
  }
  return null;
}

export function decisionVenvPythonPath() {
  if (!decisionVenvDir) return null;
  return process.platform === "win32"
    ? path.join(decisionVenvDir, "Scripts", "python.exe")
    : path.join(decisionVenvDir, "bin", "python");
}

// 依赖安装完成标记：内容是 requirements.txt 的 sha256，官方调整依赖后自动触发重装
function depsMarkerPath() {
  return decisionVenvDir ? path.join(decisionVenvDir, ".dyw-deps-ready") : null;
}

export function decisionRuntimeStatus() {
  const venvPython = decisionVenvPythonPath();
  const marker = depsMarkerPath();
  const available = Boolean(venvPython && marker && existsSync(venvPython) && existsSync(marker));
  return { available, venvDir: decisionVenvDir || "", venvPython: venvPython || "" };
}

function lastLines(text: string, count = 2) {
  return String(text || "").trim().split("\n").filter(Boolean).slice(-count).join(" ");
}

// 下载/安装前的磁盘余量守卫：剩余空间须 ≥ neededBytes，不足时给出可行动的报错，
// 而不是像 ENOSPC 那样在写入中途才失败（.part 断点会保留，但系统盘被写满的代价更大）。
// statfs 不可用（老系统/权限受限）时不拦截，保持原有行为。
export function assertDiskSpace(dir: string, neededBytes: number) {
  try {
    mkdirSync(dir, { recursive: true });
    const stats = statfsSync(dir);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (available < neededBytes) {
      const shortage = Math.ceil((neededBytes - available) / 1e9 * 10) / 10;
      throw new Error(`磁盘空间不足：还差约 ${shortage}GB（本步需要 ${(neededBytes / 1e9).toFixed(1)}GB，当前可用 ${(available / 1e9).toFixed(1)}GB），请清理磁盘后重试`);
    }
  } catch (error: any) {
    if (/磁盘空间不足/.test(String(error?.message || ""))) throw error;
    // statfs 本身失败（目录刚建/权限）不拦截下载，让后续流程自然报错
  }
}

// 确保决策模型运行时可用：探测 Python → 建 venv → 按所选模型仓库的 requirements.txt
// 安装 pip 依赖。幂等：venv 存在跳过创建，依赖标记的哈希与官方 requirements 一致跳过安装。
export async function ensureDecisionRuntime({ modelId = DEFAULT_DECISION_MODEL_ID, onProgress = null, fetchImpl = fetch, signal = null, checkSpace = true } = {} as any) {
  if (!decisionVenvDir) throw new Error("决策模型运行时目录未初始化");
  if (decisionRuntimeStatus().available) return { ok: true, skipped: true };
  if (runtimeJob) return runtimeJob;
  runtimeJob = (async () => {
    const definition = DECISION_MODELS[normalizeDecisionModelId(modelId)];
    const venvPython = decisionVenvPythonPath()!;
    // 1) 探测系统 Python
    reportProgress(onProgress, "runtime:python", 0, 0);
    const python = await findDecisionPython({ signal });
    if (!python) {
      const hint = process.platform === "darwin" ? "可用 Homebrew 安装：brew install python@3.12" : "请从 python.org 安装后重试";
      throw new Error(`未找到合适的 Python（需要 3.${PYTHON_MIN_MINOR}–3.${PYTHON_MAX_MINOR}）：${hint}`);
    }
    // 2) 建虚拟环境（已存在则跳过；venv 自带 pip，无需 ensurepip）
    if (!existsSync(venvPython)) {
      reportProgress(onProgress, "runtime:venv", 0, 0);
      const created = await runCommand(python.program, [...python.prefixArgs, "-m", "venv", decisionVenvDir!], { timeoutMs: 180_000 });
      if (created.code !== 0 || !existsSync(venvPython)) {
        throw new Error(`创建 Python 虚拟环境失败：${lastLines(created.stderr || created.stdout)}`);
      }
    }
    // 3) 官方 requirements.txt（69 字节小文件，先于权重落盘，pip 依赖装好后再拉大权重）
    const requirement = definition.files.find((file) => file.fileName === "requirements.txt")!;
    const requirementsTarget = path.join(decisionModelDir || "", requirement.fileName);
    await downloadToFile({
      sources: modelSources(definition.repo, requirement.fileName),
      target: requirementsTarget,
      expectedBytes: requirement.bytes,
      expectedSha256: requirement.sha256,
      fetchImpl,
      signal,
      phase: "runtime:deps",
      onProgress,
    });
    // 4) pip 安装（幂等）：标记哈希与官方 requirements 一致就跳过
    // torch + transformers 解压后约 1-2GB：装之前也做余量守卫；测试可关闭
    if (checkSpace) assertDiskSpace(decisionVenvDir!, 2 * 1024 ** 3);
    reportProgress(onProgress, "runtime:deps", 0, 0);
    const marker = depsMarkerPath()!;
    if (existsSync(marker) && (await fs.readFile(marker, "utf8")).trim() === requirement.sha256) {
      return { ok: true, skipped: true };
    }
    let heartbeat = 0;
    const installed = await runCommand(venvPython, ["-m", "pip", "install", "-r", requirementsTarget], {
      timeoutMs: PIP_INSTALL_TIMEOUT_MS,
      // pip 没有整体字节进度：输出行做心跳，UI 按"正在安装依赖"展示阶段
      onOutput: () => {
        heartbeat += 1;
        reportProgress(onProgress, "runtime:deps", heartbeat, 0);
      },
    });
    if (installed.code !== 0) {
      throw new Error(`安装决策模型依赖失败：${lastLines(installed.stderr || installed.stdout)}`);
    }
    await fs.writeFile(marker, `${requirement.sha256}\n`, "utf8");
    return { ok: true };
  })().finally(() => {
    runtimeJob = null;
  });
  return runtimeJob;
}
