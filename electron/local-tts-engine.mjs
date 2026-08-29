// 本地语音合成引擎：调用 llama.cpp 包里的 llama-tts CLI 一次性合成。
// Qwen3-TTS-12Hz-1.7B-Base + mmproj（speaker 编码器）→ 参考音色克隆模式。
// TTS 在渠道场景是低频调用，每次合成起一个进程（模型加载 2-4 秒），不做常驻服务省 2GB+ 内存。
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { localTtsModelPaths, localTtsModelStatus, localTtsRuntimeStatus } from "./local-tts.mjs";

// 合成超时：1.7B CPU 合成约 1.3 倍实时，取 5 分钟兜底（渠道语音一般 <60 秒）
const SYNTHESIZE_TIMEOUT_MS = 5 * 60 * 1000;
// -n 帧数上限：12.5 帧/秒，2048 帧 ≈ 164 秒音频
const MAX_FRAMES = 2048;

// 生成文本清理：去掉会干扰合成模型的声音标记与特殊 token（与 ASR 输出清理同一类问题）
function sanitizeTtsText(text) {
  return String(text || "")
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

export function localTtsReady() {
  if (!localTtsModelStatus().downloaded) return { ok: false, error: "本地语音合成模型还没下载：请在电脑端设置中下载" };
  const runtime = localTtsRuntimeStatus();
  if (!runtime.available) return { ok: false, error: "本地语音引擎还没下载：请在电脑端设置中下载（与语音转写共用同一份引擎）" };
  return { ok: true };
}

// text → wav（Uint8Array）。voicePath 为可选参考音频（wav/mp3），克隆该音色；缺省用模型默认音色。
export async function synthesizeWithLocalTts({ text, voicePath = "", workDir } = {}) {
  const cleanText = sanitizeTtsText(text);
  if (!cleanText) throw new Error("没有可合成的文本");

  const ready = localTtsReady();
  if (!ready.ok) throw new Error(ready.error);

  const [modelPath, mmprojPath] = localTtsModelPaths();
  const runtime = localTtsRuntimeStatus();
  const outPath = path.join(workDir || os.tmpdir(), `tts-${Date.now()}-${process.pid}.wav`);
  const args = [
    "-m", modelPath,
    "--mmproj", mmprojPath,
    "-p", cleanText,
    "--tts-lang", "zh",
    "-n", String(MAX_FRAMES),
    "-o", outPath,
  ];
  const voice = String(voicePath || "").trim();
  if (voice && existsSync(voice)) {
    // 引擎经 miniaudio 只认 wav/mp3/flac/ogg(vorbis)；m4a/aac 等要 ffprobe（一般不在 PATH）。
    // 设置里选文件时会自动转码成 wav；这里兜底给可操作的提示。
    const ext = path.extname(voice).toLowerCase();
    if (![".wav", ".mp3", ".flac", ".ogg"].includes(ext)) {
      throw new Error(`参考音频 ${path.basename(voice)} 是 ${ext || "未知"} 格式，本地引擎解不了：请在设置中重新选择该文件，应用会自动转换成 wav`);
    }
    args.push("--tts-speaker-file", voice);
  }

  const child = spawn(runtime.path, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderrText = "";
  child.stderr.on("data", (chunk) => {
    stderrText += chunk;
    // 只留尾部，避免长日志撑爆内存
    if (stderrText.length > 16 * 1024) stderrText = stderrText.slice(-8 * 1024);
  });
  const stderrDone = new Promise((resolve) => {
    child.stderr.on("end", resolve);
    child.stderr.on("error", resolve);
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, SYNTHESIZE_TIMEOUT_MS);

  let code = null;
  try {
    code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (exitCode) => resolve(exitCode));
    });
  } finally {
    clearTimeout(timer);
  }
  await stderrDone;

  try {
    if (!existsSync(outPath)) {
      const tail = stderrText.trim().split("\n").slice(-4).join(" ").trim();
      if (timedOut) throw new Error("语音合成超时，请缩短文本后重试");
      throw new Error(`语音合成失败：${tail || `引擎退出码 ${code}`}`);
    }
    const wav = await readFile(outPath);
    if (wav.length < 44) throw new Error("语音合成失败：引擎返回的音频不完整");
    return { wav: new Uint8Array(wav) };
  } finally {
    await rm(outPath, { force: true }).catch(() => { });
  }
}
