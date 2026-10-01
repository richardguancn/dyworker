// IPC 域插件：语音输入输出（voice:transcribe / tts:speak / audio:read-attachment）。
// 本地合成直接 import；设置读取、转写执行与文件定位由壳层注入。
import { synthesizeWithLocalTts } from "../../local-tts-engine.mts";
import { normalizeTtsEngine } from "../../settings.mts";

export function speechIpcPlugin(deps) {
  return {
    name: "ipc:speech",
    apply(ctx) {
      const { trustedHandle, fs, path, app, readSettings, applyTtsSettings, transcribeAudio, buildWavFromPcm, attachmentType } = deps;

trustedHandle("voice:transcribe", async (_event, payload) => {
  const payloadSettings = payload?.settings || {};
  // 引擎选择与本地模型路径以磁盘最新设置为准（改路径保存后立即生效）；
  // 云引擎沿用渲染端传来的地址与密钥
  const saved = await readSettings();
  const settings = {
    ...payloadSettings,
    transcriptionEngine: saved.transcriptionEngine,
    asrModel: saved.asrModel,
    asrModelDir: saved.asrModelDir,
    llamaServerPath: saved.llamaServerPath,
  };
  const audio = Uint8Array.from(Array.isArray(payload?.audio) ? payload.audio : []);
  const mimeType = String(payload?.mimeType || "audio/webm");
  return transcribeAudio(audio, mimeType, settings);
});

trustedHandle("tts:speak", async (_event, payload) => {
  const text = String(payload?.text || "").trim();
  if (!text) return { ok: false, error: "没有可朗读的文本" };
  const saved = await readSettings();
  applyTtsSettings(saved);
  if (normalizeTtsEngine(saved.ttsEngine) === "local") {
    try {
      const { wav } = await synthesizeWithLocalTts({
        text: text.slice(0, 2000),
        voicePath: String(saved.ttsVoicePath || "").trim(),
      });
      return { ok: true, wav };
    } catch (error: any) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const ttsEndpoint = String(saved.ttsEndpoint || "").trim();
  if (!ttsEndpoint) {
    return { ok: false, error: "语音合成服务还没有配置：请在设置中填写合成服务地址或切换到本地引擎" };
  }
  const apiKey = String(saved.ttsApiKey || saved.apiKey || "").trim();
  const ttsUrl = ttsEndpoint.endsWith("/audio/speech")
    ? ttsEndpoint
    : `${ttsEndpoint.replace(/\/+$/, "")}/audio/speech`;
  let response;
  try {
    response = await fetch(ttsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: String(saved.ttsModel || "tts-1"),
        input: text.slice(0, 2000),
        voice: "alloy",
        response_format: "wav",
      }),
    });
  } catch (error: any) {
    return { ok: false, error: `语音合成服务连接失败：${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) return { ok: false, error: `语音合成失败（${response.status}），请检查服务配置` };
  return { ok: true, wav: new Uint8Array(await response.arrayBuffer()) };
});

trustedHandle("audio:read-attachment", async (_event, payload) => {
  const targetPath = String(payload?.path || "").trim();
  if (!targetPath) return { ok: false, error: "缺少音频文件路径" };
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) return { ok: false, error: "音频文件不存在" };
    // 无上限整体读入会把主进程内存打爆，附件音频按 100MB 封顶
    if (stat.size > 100 * 1024 * 1024) return { ok: false, error: "音频文件过大（超过 100MB）" };
    const rawBuffer = await fs.readFile(targetPath);
    const { decode, isSilk, isWav } = await import("silk-wasm");
    const ext = path.extname(targetPath).toLowerCase();

    // 检查是否为 silk 编码（无论是 .silk 后缀，还是由于历史原因存成 .bin 的 silk 数据，或包含 #!SILK 魔数）
    if (isSilk(rawBuffer) || ext === ".silk" || rawBuffer.includes(Buffer.from("#!SILK"))) {
      try {
        const pcm = await decode(rawBuffer, 24000);
        const duration = pcm.duration ? Math.round(pcm.duration / 1000) : Math.max(1, Math.round(pcm.data.byteLength / (24000 * 2)));
        const wav = buildWavFromPcm(Buffer.from(pcm.data), 24000);
        return { ok: true, wav: new Uint8Array(wav), mimeType: "audio/wav", duration };
      } catch (silkError: any) {
        // silk 解码失败时继续往下走普通音频分支
      }
    }

    // 如果本身就是 WAV 格式
    if (isWav(rawBuffer) || ext === ".wav") {
      return { ok: true, wav: new Uint8Array(rawBuffer), mimeType: "audio/wav" };
    }

    // 其他音频类型（mp3 / m4a / aac / ogg / opus 等）
    const mimeType = attachmentType(targetPath);
    const resolvedMime = mimeType.startsWith("audio/") ? mimeType : (ext === ".mp3" ? "audio/mpeg" : (ext === ".ogg" ? "audio/ogg" : "audio/wav"));
    return { ok: true, bytes: new Uint8Array(rawBuffer), mimeType: resolvedMime };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
    },
  };
}
