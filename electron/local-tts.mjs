// 本地语音合成（TTS）：llama.cpp 官方预转换的 Qwen3-TTS-12Hz-1.7B-Base GGUF
// （backbone + mmproj 两件套），由 llama-tts CLI 一次性合成（低频场景不做常驻进程）。
// 只负责模型下载与状态；运行时二进制复用 local-asr 下载的 llama.cpp 包（内含 llama-tts），
// 进程调用在 local-tts-engine.mjs。
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { downloadToFile, localAsrBinDir, localTtsRuntimeBundledPath } from "./local-asr.mjs";

const MODEL_REPO = "ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF";

// 只用 ModelScope：国内直连最快（ggml-org 官方镜像，sha256 与 HF 一致），不再回退 HuggingFace。
// 与审核模型 / ASR 下载策略保持一致。
function modelSources(fileName) {
  return [`https://modelscope.cn/models/${MODEL_REPO}/resolve/master/${fileName}`];
}

// 可选模型清单：同一 backbone 的两个量化档位，共用同一个 speaker 编码器（mmproj Q8_0）。
// sha256 为 HuggingFace 官方 LFS oid（ModelScope 镜像一致），下载完成后本地校验。
export const TTS_MODELS = Object.freeze({
  "qwen3-tts-1.7b-q4": Object.freeze({
    id: "qwen3-tts-1.7b-q4",
    label: "Qwen3-TTS-1.7B（Q4_K_M）",
    repo: MODEL_REPO,
    note: "约 1.5GB · 更小更快",
    files: Object.freeze([
      Object.freeze({
        fileName: "Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf",
        bytes: 1035965280,
        sha256: "8d18c94acb2addd042f97da63c98be144eafa76d0d9495177eab65130cf85129",
      }),
      Object.freeze({
        fileName: "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf",
        bytes: 446422912,
        sha256: "6fd65188839bcd6ecc91b277ad471e22a0edfada4699a0fe82f1165c18cfcce2",
      }),
    ]),
  }),
  "qwen3-tts-1.7b-q8": Object.freeze({
    id: "qwen3-tts-1.7b-q8",
    label: "Qwen3-TTS-1.7B（Q8_0）",
    repo: MODEL_REPO,
    note: "约 2.3GB · 音质更好",
    files: Object.freeze([
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
    ]),
  }),
});

export const DEFAULT_TTS_MODEL_ID = "qwen3-tts-1.7b-q8";

// 非法值回落默认模型（与 normalizeAsrModelId 同策略）
export function normalizeTtsModelId(value) {
  const key = String(value || "").trim();
  return TTS_MODELS[key] ? key : DEFAULT_TTS_MODEL_ID;
}

let ttsModelDir = null;
let ttsModelId = DEFAULT_TTS_MODEL_ID;
let ttsDownloadJob = null;

// main 启动时注入 userData/models/tts 与所选模型；测试可注入临时目录
export function configureLocalTts({ modelDir, modelId } = {}) {
  ttsModelDir = modelDir ? String(modelDir) : null;
  if (modelId !== undefined) ttsModelId = normalizeTtsModelId(modelId);
}

export function localTtsModelPaths(requestedModelId) {
  const files = TTS_MODELS[normalizeTtsModelId(requestedModelId ?? ttsModelId)].files;
  if (!ttsModelDir) return files.map(() => null);
  return files.map((file) => path.join(ttsModelDir, file.fileName));
}

export function localTtsModelStatus(requestedModelId) {
  const modelId = normalizeTtsModelId(requestedModelId ?? ttsModelId);
  const files = TTS_MODELS[modelId].files;
  const paths = localTtsModelPaths(modelId);
  const details = files.map((file, index) => {
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
    id: modelId,
    label: TTS_MODELS[modelId].label,
    configured: Boolean(ttsModelDir),
    files: details,
    downloaded: details.every((file) => file.downloaded),
    sizeBytes: details.reduce((sum, file) => sum + file.sizeBytes, 0),
    expectedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

// 全部候选模型的概要（设置界面下拉列表用；mmproj 两档共用，已下载会同时体现在两个档位）
export function localTtsAllModelsStatus() {
  return Object.values(TTS_MODELS).map((model) => {
    const status = localTtsModelStatus(model.id);
    return {
      id: model.id,
      label: model.label,
      note: model.note,
      downloaded: status.downloaded,
      sizeBytes: status.sizeBytes,
      expectedBytes: status.expectedBytes,
    };
  });
}

export async function downloadLocalTtsModel({ modelId, onProgress = null, fetchImpl = fetch, signal = null } = {}) {
  if (!ttsModelDir) throw new Error("本地语音合成模型目录未初始化");
  const activeModelId = normalizeTtsModelId(modelId ?? ttsModelId);
  const files = TTS_MODELS[activeModelId].files;
  const status = localTtsModelStatus(activeModelId);
  const pending = files.filter((file, index) => !status.files[index].downloaded);
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
