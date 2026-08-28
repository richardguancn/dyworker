// 本地语音合成（TTS）：llama.cpp 官方预转换的 Qwen3-TTS-12Hz-1.7B-Base GGUF
// （backbone + mmproj 两件套），由 llama-tts CLI 一次性合成（低频场景不做常驻进程）。
// 只负责模型下载与状态；运行时二进制复用 local-asr 下载的 llama.cpp 包（内含 llama-tts），
// 进程调用在 local-tts-engine.mjs。
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { downloadToFile, localAsrBinDir, localTtsRuntimeBundledPath } from "./local-asr.mjs";

const MODEL_REPO = "ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF";

// sources 按序回退：ModelScope 国内直连最快（ggml-org 官方镜像，sha256 与 HF 一致），
// hf-mirror 与 HuggingFace 供有代理的用户。与审核模型 / ASR 下载策略保持一致。
function modelSources(fileName) {
  return [
    `https://modelscope.cn/models/${MODEL_REPO}/resolve/master/${fileName}`,
    `https://hf-mirror.com/${MODEL_REPO}/resolve/main/${fileName}`,
    `https://huggingface.co/${MODEL_REPO}/resolve/main/${fileName}`,
  ];
}

// Q8_0 量化：与 ASR 同策略（量化损失可忽略）；backbone(1.7B) + mmproj(speaker 编码器) 共约 2.3GB。
// sha256 为 HuggingFace 官方 LFS oid，下载完成后本地校验。
export const LOCAL_TTS_FILES = Object.freeze([
  Object.freeze({
    fileName: "Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf",
    bytes: 1847874400,
    sha256: "ac7931aeb2e7aad1a6ed6602d353a5679c9d096b18ce8204ac730a8408d572e1",
  }),
  Object.freeze({
    fileName: "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf",
    bytes: 446422912,
    sha256: "6fd65188839bcd6ecc91b277ad471e22a0edfada4699a0fe82f1165c18cfcce2",
  }),
]);

let ttsModelDir = null;
let ttsDownloadJob = null;

// main 启动时注入 userData/models/tts；测试可注入临时目录
export function configureLocalTts({ modelDir } = {}) {
  ttsModelDir = modelDir ? String(modelDir) : null;
}

export function localTtsModelPaths() {
  if (!ttsModelDir) return LOCAL_TTS_FILES.map(() => null);
  return LOCAL_TTS_FILES.map((file) => path.join(ttsModelDir, file.fileName));
}

export function localTtsModelStatus() {
  const paths = localTtsModelPaths();
  const files = LOCAL_TTS_FILES.map((file, index) => {
    const filePath = paths[index];
    const exists = filePath ? existsSync(filePath) : false;
    const sizeBytes = exists ? statSync(filePath).size : 0;
    return {
      fileName: file.fileName,
      role: index === 0 ? "backbone" : "speaker-encoder",
      downloaded: exists && sizeBytes === file.bytes,
      sizeBytes,
      expectedBytes: file.bytes,
      filePath: filePath || "",
    };
  });
  return {
    configured: Boolean(ttsModelDir),
    files,
    downloaded: files.every((file) => file.downloaded),
    sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    expectedBytes: LOCAL_TTS_FILES.reduce((sum, file) => sum + file.bytes, 0),
  };
}

export async function downloadLocalTtsModel({ onProgress = null, fetchImpl = fetch, signal = null } = {}) {
  if (!ttsModelDir) throw new Error("本地语音合成模型目录未初始化");
  const status = localTtsModelStatus();
  const pending = LOCAL_TTS_FILES.filter((file, index) => !status.files[index].downloaded);
  if (!pending.length) {
    onProgress?.({ phase: "model", received: status.expectedBytes, total: status.expectedBytes, percent: 100 });
    return { ok: true, skipped: true };
  }
  if (ttsDownloadJob) return ttsDownloadJob;
  ttsDownloadJob = (async () => {
    let completedBytes = status.sizeBytes;
    for (const file of pending) {
      const before = completedBytes;
      await downloadToFile({
        sources: modelSources(file.fileName),
        target: path.join(ttsModelDir, file.fileName),
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
      if (onProgress) {
        onProgress({ phase: "model", received: completedBytes, total: status.expectedBytes, percent: Math.round((completedBytes / status.expectedBytes) * 100) });
      }
    }
    return { ok: true };
  })().finally(() => {
    ttsDownloadJob = null;
  });
  return ttsDownloadJob;
}

// llama-tts 与 llama-server 同包：下载一次 llama.cpp 运行时两个引擎都能用
export function localTtsRuntimeStatus() {
  const runtimePath = localTtsRuntimeBundledPath();
  return {
    available: Boolean(runtimePath),
    path: runtimePath || "",
    binDir: localAsrBinDir() || "",
  };
}
