// 本地语音转写（ASR）：llama.cpp 官方预转换的 Qwen3-ASR-0.6B GGUF（text + mmproj 两件套），
// 由 llama-server（mtmd 音频管线）提供 OpenAI 兼容推理。只负责模型与运行时的下载和状态，
// 进程管理与转写请求在 local-asr-server.mjs。
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readdirSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const MODEL_REPO = "ggml-org/Qwen3-ASR-0.6B-GGUF";

// Q8_0 量化：0.6B 小模型量化损失可忽略，转写质量接近原版；text(解码器) + mmproj(音频编码器) 共约 1GB。
// sha256 为 HuggingFace 官方 LFS oid，下载完成后本地校验。
export const LOCAL_ASR_FILES = Object.freeze([
  Object.freeze({
    fileName: "Qwen3-ASR-0.6B-Q8_0.gguf",
    bytes: 804749248,
    sha256: "bca259818b50ca7c4c05e9bdb35a5dc04fa039653a6d6f3f0f331f96f6aa1971",
  }),
  Object.freeze({
    fileName: "mmproj-Qwen3-ASR-0.6B-Q8_0.gguf",
    bytes: 214392480,
    sha256: "41a342b5e4c514e968cb756de6cd1b7be39eff43c44c57a2ef5fc6522e36603d",
  }),
]);

// sources 按序回退：ModelScope 国内直连最快（ggml-org 官方镜像，sha256 与 HF 一致），
// hf-mirror 与 HuggingFace 供有代理的用户。与审核模型下载策略保持一致。
function modelSources(fileName) {
  return [
    `https://modelscope.cn/models/${MODEL_REPO}/resolve/master/${fileName}`,
    `https://hf-mirror.com/${MODEL_REPO}/resolve/main/${fileName}`,
    `https://huggingface.co/${MODEL_REPO}/resolve/main/${fileName}`,
  ];
}

// llama.cpp 预编译二进制（含 llama-server）：锁定一个带 Qwen3-ASR 支持的 nightly tag，
// 只取 CPU 版（mac 自带 Metal 加速），按平台选资产。压缩包约 11-18MB。
export const LLAMA_CPP_RUNTIME = Object.freeze({
  tag: "b10621",
  assets: Object.freeze({
    "darwin-arm64": "llama-b10621-bin-macos-arm64.tar.gz",
    "darwin-x64": "llama-b10621-bin-macos-x64.tar.gz",
    "linux-arm64": "llama-b10621-bin-ubuntu-arm64.tar.gz",
    "linux-x64": "llama-b10621-bin-ubuntu-x64.tar.gz",
    "win32-arm64": "llama-b10621-bin-win-cpu-arm64.zip",
    "win32-x64": "llama-b10621-bin-win-cpu-x64.zip",
  }),
});

function runtimeSources(assetName) {
  const base = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RUNTIME.tag}/${assetName}`;
  return [
    base,
    // GitHub 直连不稳时的加速镜像（社区公共服务，失败自动回退下一个源）
    `https://ghproxy.cn/${base}`,
    `https://gh-proxy.com/${base}`,
  ];
}

export function currentPlatformKey() {
  return `${os.platform()}-${os.arch()}`;
}

let asrModelDir = null;
let asrBinDir = null;
let modelDownloadJob = null;
let runtimeDownloadJob = null;

// main 启动时注入 userData/models/asr 与 userData/bin/llama.cpp；测试可注入临时目录
export function configureLocalAsr({ modelDir, binDir } = {}) {
  asrModelDir = modelDir ? String(modelDir) : null;
  asrBinDir = binDir ? String(binDir) : null;
}

export function localAsrModelPaths() {
  if (!asrModelDir) return LOCAL_ASR_FILES.map(() => null);
  return LOCAL_ASR_FILES.map((file) => path.join(asrModelDir, file.fileName));
}

export function localAsrModelStatus() {
  const paths = localAsrModelPaths();
  const files = LOCAL_ASR_FILES.map((file, index) => {
    const filePath = paths[index];
    const exists = filePath ? existsSync(filePath) : false;
    const sizeBytes = exists ? statSync(filePath).size : 0;
    return {
      fileName: file.fileName,
      role: index === 0 ? "decoder" : "encoder",
      downloaded: exists && sizeBytes === file.bytes,
      sizeBytes,
      expectedBytes: file.bytes,
      filePath: filePath || "",
    };
  });
  return {
    configured: Boolean(asrModelDir),
    files,
    downloaded: files.every((file) => file.downloaded),
    sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    expectedBytes: LOCAL_ASR_FILES.reduce((sum, file) => sum + file.bytes, 0),
  };
}

function reportProgress(onProgress, phase, received, total) {
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

// 断点续传下载：.part 记录进度，全部源共用同一份字节，跨源可续传。
// expectedBytes > 0 时做精确大小 + sha256 校验（模型文件）；
// expectedBytes 为 0 表示大小未知（运行时压缩包），只校验已收到且在 min/max 范围内。
// 本地 TTS（local-tts.mjs）复用同一套下载器，保证两个语音模块行为一致。
export async function downloadToFile({ sources, target, expectedBytes, expectedSha256 = "", minBytes = 0, maxBytes = 0, fetchImpl, signal, onProgress, phase }) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  const exact = expectedBytes > 0;
  let offset = existsSync(partial) ? statSync(partial).size : 0;
  if (!exact && offset > 0) {
    // 大小未知时无法跨源核对，续传不可靠：从头下载
    offset = 0;
  }
  let lastError = null;
  for (const source of sources) {
    try {
      while (true) {
        const response = await fetchImpl(source, {
          headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
          redirect: "follow",
          signal: signal || undefined,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        if (offset > 0 && response.status !== 206) {
          // 该源不支持断点续传：清掉半截文件从头来
          offset = 0;
          response.body.cancel?.().catch?.(() => { });
          continue;
        }
        const file = createWriteStream(partial, { flags: offset > 0 ? "a" : "w" });
        let received = offset;
        let lastReport = -1;
        const reader = Readable.fromWeb(response.body);
        await new Promise((resolve, reject) => {
          reader.on("data", (chunk) => {
            received += chunk.length;
            const percent = exact && expectedBytes > 0 ? Math.round((received / expectedBytes) * 100) : -1;
            if (percent !== lastReport && percent >= 0) {
              lastReport = percent;
              reportProgress(onProgress, phase, received, expectedBytes);
            }
          });
          reader.on("error", reject);
          file.on("error", reject);
          file.on("finish", resolve);
          reader.pipe(file);
        });
        if (signal?.aborted) throw new Error("下载已取消");
        if (exact && received < expectedBytes) throw new Error(`响应不完整：收到 ${received}/${expectedBytes} 字节`);
        if (!exact && received < Math.max(minBytes, 1)) throw new Error(`响应不完整：仅收到 ${received} 字节`);
        offset = received;
        break;
      }
      break;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      // 换下一个源继续（.part 保留，支持断点续传）
    }
  }
  const finalSize = existsSync(partial) ? statSync(partial).size : 0;
  if (exact && finalSize !== expectedBytes) {
    throw new Error(`下载不完整：${lastError ? lastError.message : "所有下载源都失败了"}`);
  }
  if (!exact && (finalSize < minBytes || (maxBytes > 0 && finalSize > maxBytes))) {
    throw new Error(`下载不完整：${lastError ? lastError.message : "所有下载源都失败了"}`);
  }
  reportProgress(onProgress, phase, finalSize, exact ? expectedBytes : finalSize);
  if (exact && expectedSha256) {
    const hash = crypto.createHash("sha256");
    hash.update(await fs.readFile(partial));
    if (hash.digest("hex") !== expectedSha256) {
      await fs.rm(partial, { force: true });
      throw new Error("文件校验失败，已删除损坏的下载，请重试");
    }
  }
  await fs.rename(partial, target);
}

export async function downloadLocalAsrModel({ onProgress = null, fetchImpl = fetch, signal = null } = {}) {
  if (!asrModelDir) throw new Error("本地语音模型目录未初始化");
  const status = localAsrModelStatus();
  const pending = LOCAL_ASR_FILES.filter((file, index) => !status.files[index].downloaded);
  if (!pending.length) {
    reportProgress(onProgress, "model", status.expectedBytes, status.expectedBytes);
    return { ok: true, skipped: true };
  }
  if (modelDownloadJob) return modelDownloadJob;
  modelDownloadJob = (async () => {
    let completedBytes = status.sizeBytes;
    for (const file of pending) {
      const before = completedBytes;
      await downloadToFile({
        sources: modelSources(file.fileName),
        target: path.join(asrModelDir, file.fileName),
        expectedBytes: file.bytes,
        expectedSha256: file.sha256,
        fetchImpl,
        signal,
        phase: "model",
        // 多文件下载：进度按整体字节数归一（已完成文件 + 当前文件增量）
        onProgress: (progress) => {
          if (!onProgress) return;
          onProgress({ ...progress, phase: "model", received: before + progress.received, total: status.expectedBytes });
        },
      });
      completedBytes = before + file.bytes;
      reportProgress(onProgress, "model", completedBytes, status.expectedBytes);
    }
    return { ok: true };
  })().finally(() => {
    modelDownloadJob = null;
  });
  return modelDownloadJob;
}

// ---- llama-server 运行时 ----

// 在解包目录里找指定二进制：解包目录层级不定（build/bin/...），向下浅搜两层
function findBundledBinary(binDir, exe) {
  if (!binDir) return null;
  const direct = path.join(binDir, exe);
  if (existsSync(direct)) return direct;
  try {
    for (const level1 of readdirSync(binDir, { withFileTypes: true })) {
      if (!level1.isDirectory()) continue;
      const dir1 = path.join(binDir, level1.name);
      const p1 = path.join(dir1, exe);
      if (existsSync(p1)) return p1;
      for (const level2 of readdirSync(dir1, { withFileTypes: true })) {
        if (!level2.isDirectory()) continue;
        const p2 = path.join(dir1, level2.name, exe);
        if (existsSync(p2)) return p2;
      }
    }
  } catch {
    // 目录不存在等情况按未安装处理
  }
  return null;
}

// 运行时整体解压到 runtime/（二进制 + 同目录动态库）。
// llama-server / llama-tts 依赖旁边的 libllama-server-impl.dylib、libggml-*.dylib 等，
// 只挪二进制的旧布局缺库无法启动（dyld: Library not loaded），直接忽略旧布局。
export function localAsrRuntimeBundledPath() {
  return findBundledBinary(asrBinDir ? path.join(asrBinDir, "runtime") : null, os.platform() === "win32" ? "llama-server.exe" : "llama-server");
}

// 本地 TTS 复用同一个 llama.cpp 运行时包（含 llama-tts），目录与 ASR 共用
export function localTtsRuntimeBundledPath() {
  return findBundledBinary(asrBinDir ? path.join(asrBinDir, "runtime") : null, os.platform() === "win32" ? "llama-tts.exe" : "llama-tts");
}

export function localAsrBinDir() {
  return asrBinDir;
}

export function localAsrRuntimeStatus(customPath = "") {
  const custom = String(customPath || "").trim();
  const asset = LLAMA_CPP_RUNTIME.assets[currentPlatformKey()] || null;
  if (custom) {
    return { available: existsSync(custom), path: custom, source: "custom", asset };
  }
  const bundled = localAsrRuntimeBundledPath();
  if (bundled) return { available: true, path: bundled, source: "managed", asset };
  return { available: false, path: "", source: "none", asset };
}

async function extractArchive(archivePath, targetDir) {
  // Windows 10+ 自带 bsdtar（tar.exe），可同时解 .zip 与 .tar.gz；mac/linux 用系统 tar
  await fs.mkdir(targetDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xf", archivePath, "-C", targetDir], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`解压失败（exit ${code}）`))));
  });
}

function findServerBinary(dir, depth = 0) {
  const exe = os.platform() === "win32" ? "llama-server.exe" : "llama-server";
  if (depth > 6) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findServerBinary(full, depth + 1);
      if (found) return found;
    } else if (entry.name === exe) {
      return full;
    }
  }
  return null;
}

// 运行时压缩包大小随构建浮动，无法预知 sha256：用 1MB-64MB 的宽松范围兜底
export async function downloadLocalAsrRuntime({ onProgress = null, fetchImpl = fetch, signal = null } = {}) {
  if (!asrBinDir) throw new Error("语音引擎目录未初始化");
  if (localAsrRuntimeBundledPath()) return { ok: true, skipped: true };
  const asset = LLAMA_CPP_RUNTIME.assets[currentPlatformKey()];
  if (!asset) throw new Error(`暂不支持的平台：${currentPlatformKey()}`);
  if (runtimeDownloadJob) return runtimeDownloadJob;
  runtimeDownloadJob = (async () => {
    const archivePath = path.join(asrBinDir, asset);
    // 整包解压到 runtime/ 并保留：二进制要和同目录的 lib*.dylib 一起才能启动
    const extractDir = path.join(asrBinDir, "runtime");
    await fs.rm(extractDir, { recursive: true, force: true });
    // 清理只挪了二进制的旧布局残留（缺动态库，永远起不来）
    await fs.rm(path.join(asrBinDir, "unpack"), { recursive: true, force: true });
    await fs.rm(path.join(asrBinDir, os.platform() === "win32" ? "llama-server.exe" : "llama-server"), { force: true });
    await downloadToFile({
      sources: runtimeSources(asset),
      target: archivePath,
      expectedBytes: 0,
      minBytes: 1024 * 1024,
      maxBytes: 64 * 1024 * 1024,
      fetchImpl,
      signal,
      phase: "runtime",
      onProgress,
    });
    await extractArchive(archivePath, extractDir);
    const binary = findServerBinary(extractDir);
    if (!binary) throw new Error("压缩包里没有找到 llama-server，请重试或手动指定路径");
    await fs.rm(archivePath, { force: true });
    if (os.platform() !== "win32") {
      await new Promise((resolve) => {
        const child = spawn("chmod", ["+x", binary], { stdio: "ignore" });
        child.on("error", () => resolve());
        child.on("exit", () => resolve());
      });
    }
    return { ok: true };
  })().finally(() => {
    runtimeDownloadJob = null;
  });
  return runtimeDownloadJob;
}
