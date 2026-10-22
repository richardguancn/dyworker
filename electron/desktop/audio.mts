import { promises as fs } from "node:fs";
import { parseModelJson } from "../agent.mts";
import { stripAsrText,transcribeWithLocalAsr } from "../local-asr-server.mts";
import { normalizeTranscriptionEngine } from "../settings.mts";

function transcriptionEndpoint(settings) {
  if (settings?.transcriptionEndpoint) return String(settings.transcriptionEndpoint).trim();
  const endpoint = String(settings?.endpoint || "").trim();
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    // 只有 Chat Completions 端点能可靠推导出同级语音转写地址；
    // Responses 端点（如 DeepSeek /responses）没有对应转写服务，返回空让用户显式配置。
    if (!/\/chat\/completions\/?$/.test(url.pathname)) return "";
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "/audio/transcriptions");
    return url.toString();
  } catch {
    return "";
  }
}

// 凭证预检（auth check）：设置页保存 API Key 后立即验证可用性，避免运行任务时才发现配错。
// 发一个最小 chat 请求：200 = 通过；401/403 = 密钥无效；404 = 地址或模型名不对；其余按状态码归类。

// 模型列表拉取：同一服务地址 + 密钥下 GET /models，列出该账号可用的全部模型，
// 设置页「获取可用模型」按钮调用，用于在同一 Key 下直接切换模型。



// 语音转写：本地引擎（Qwen3-ASR-0.6B + llama-server）或 OpenAI 兼容 /audio/transcriptions；
// 桌面录音与 QQ 语音（silk 解码后）共用
export async function transcribeAudio(audioBytes, mimeType, settings) {
  const audio = Uint8Array.from(audioBytes || []);
  if (!audio.length) throw new Error("没有收到录音内容");
  if (normalizeTranscriptionEngine(settings?.transcriptionEngine) === "local") {
    // 模型目录与所选模型已在 readSettings 里按最新设置应用；引擎路径变更同样即时生效
    const text = await transcribeWithLocalAsr({
      wav: audio,
      customServerPath: String(settings?.llamaServerPath || "").trim(),
      modelId: String(settings?.asrModel || "").trim(),
    });
    return { text };
  }
  const endpoint = transcriptionEndpoint(settings);
  if (!endpoint || !settings.apiKey) throw new Error("请先在设置中配置语音转写地址和 API 密钥");
  if (audio.byteLength > 25 * 1024 * 1024) throw new Error("录音超过 25 MB，请缩短后重试");
  const type = String(mimeType || "audio/webm");
  const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : type.includes("wav") ? "wav" : "webm";
  const body = new FormData();
  body.append("file", new Blob([audio], { type }), `dyworker-recording.${extension}`);
  body.append("model", String(settings.transcriptionModel || "whisper-1"));
  // 转写服务偶发挂起时不能把渠道任务永久卡住（否则该聊天后续消息只排队不执行）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      body,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error("语音转写服务连接超时（60 秒无响应），请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`语音转写失败（${response.status}）：${detail}`);
  }
  const result = await parseModelJson(response, "语音转写服务", endpoint);
  const text = result?.text || result?.data?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("语音服务没有返回文字");
  return { text: text.trim() };
}

// QQ 语音附件是 silk 编码：silk → PCM → 补 WAV 头 → 走现有转写服务
export async function transcribeQqVoice(filePath, settings) {
  const { decode } = await import("silk-wasm");
  const silk = await fs.readFile(filePath);
  const pcm = await decode(silk, 24000);
  const duration = pcm.duration ? Math.round(pcm.duration / 1000) : Math.max(1, Math.round(pcm.data.byteLength / (24000 * 2)));
  const wav = buildWavFromPcm(Buffer.from(pcm.data), 24000);
  const result = await transcribeAudio(wav, "audio/wav", settings);
  const rawText = result?.text || "";
  const text = stripAsrText(rawText);
  return { text, duration };
}

// PCM(s16le) + 采样率 → 标准 WAV（44 字节头），供转写服务读取
export function buildWavFromPcm(pcm, sampleRate) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcm.byteLength;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
