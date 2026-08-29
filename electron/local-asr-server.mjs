// 本地语音引擎：llama-server 子进程生命周期管理 + 转写请求翻译。
// llama-server 自 2026-04 起通过 mtmd 支持官方 Qwen3-ASR GGUF（text + mmproj），
// 暴露 OpenAI 兼容 /v1/chat/completions（input_audio 传 base64 WAV）。
// 策略：首次转写按需启动（模型加载约 2-5 秒），空闲 3 分钟自动退出释放约 1GB 内存。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { ASR_MODELS, normalizeAsrModelId, localAsrModelPaths, localAsrRuntimeStatus } from "./local-asr.mjs";

const IDLE_STOP_MS = 3 * 60_000;
const START_TIMEOUT_MS = 120_000;
const TRANSCRIBE_TIMEOUT_MS = 120_000;
// Qwen3-ASR 音频约 13 token/秒，2048 上下文可容纳约 2.5 分钟语音
const CONTEXT_SIZE = 2048;

let server = null; // { child, port, modelId, startedAt, stderrTail }
let startingPromise = null;
let idleTimer = null;

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export function localAsrServerState() {
  return server && server.child.exitCode === null
    ? { running: true, port: server.port }
    : { running: false, port: 0 };
}

export function stopLocalAsrServer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const current = server;
  server = null;
  startingPromise = null;
  if (current) {
    try {
      current.child.kill();
    } catch {
      // 进程已退出的情况忽略
    }
  }
}

function scheduleIdleStop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    stopLocalAsrServer();
  }, IDLE_STOP_MS);
}

// state 是 spawn 时捕获的启动状态引用：exit 事件会把模块级 server 置空，
// 只有靠这个引用才能在进程崩溃后拿到退出信号与 stderr 尾巴，给用户可行动的报错
async function waitForHealth(port, state) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      const reason = state.child.exitCode !== null
        ? `退出码 ${state.child.exitCode}`
        : `信号 ${state.child.signalCode}`;
      const tail = (state.stderrTailText || "").split("\n").filter(Boolean).slice(-3).join(" | ");
      throw new Error(`语音引擎启动失败（${reason}）${tail ? `：${tail}` : ""}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body?.status === "ok") return;
      }
    } catch {
      // 还没就绪，继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("语音引擎启动超时（120 秒），请重试");
}

// 就绪返回 { port }；未就绪时抛出带用户可读信息的错误。
// modelId 指定要加载的本地模型；运行中的模型不一致时自动重启换模型。
export async function ensureLocalAsrServer({ customServerPath = "", modelId = "" } = {}) {
  const requestedModel = normalizeAsrModelId(modelId);
  scheduleIdleStop();
  if (server && server.child.exitCode === null && server.modelId === requestedModel) {
    return { port: server.port };
  }
  // 未运行或加载的是别的模型：停掉旧进程按需重启（并发调用合并到同一个启动任务，
  // 注意 stopLocalAsrServer 会清空 startingPromise，必须先判断再停止）
  if (startingPromise) return startingPromise;
  stopLocalAsrServer();
  startingPromise = (async () => {
    const runtime = localAsrRuntimeStatus(customServerPath);
    if (!runtime.available) throw new Error("语音引擎（llama-server）还没有下载，请在设置中下载或手动指定路径");
    const definition = ASR_MODELS[requestedModel];
    const modelPaths = localAsrModelPaths(requestedModel);
    if (modelPaths.some((modelPath) => !modelPath) || modelPaths.length !== definition.files.length) {
      throw new Error("本地语音模型目录未初始化");
    }
    if (modelPaths.some((modelPath) => !existsSync(modelPath))) {
      throw new Error(`本地语音模型（${definition.label}）还没有下载，请在设置中下载`);
    }
    const port = await pickFreePort();
    const child = spawn(runtime.path, [
      "-m", modelPaths[0],
      "--mmproj", modelPaths[1],
      "--host", "127.0.0.1",
      "--port", String(port),
      "-c", String(CONTEXT_SIZE),
      "--jinja",
      "--no-webui",
    ], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderrTail = "";
    child.stderr?.on("data", (chunk) => {
      stderrTail = (stderrTail + String(chunk)).slice(-4000);
    });
    server = {
      child,
      port,
      modelId: requestedModel,
      startedAt: Date.now(),
      stderrTail,
      get stderrTailText() { return stderrTail; },
    };
    const state = server;
    child.on("exit", () => {
      if (server?.child === child) server = null;
    });
    await waitForHealth(port, state);
    return { port };
  })();
  try {
    return await startingPromise;
  } catch (error) {
    stopLocalAsrServer();
    throw error;
  } finally {
    startingPromise = null;
  }
}

// Qwen3-ASR 输出协议 quirks（实测 b10621）：
//   `language Chinese<asr_text>今天下午三点开项目评审会议。`
// 语言提示（language Chinese / zh 等）在开标记之前，且与正文之间无分隔符；
// 开标记后的内容就是纯正文——标记经常没有闭合，所以出现 <asr_text> 就直接取其后全部内容。
// 无标记的老格式退回逐个剥标记 + 语言前缀（language 后跟语言名，且仅当后面是 CJK/串尾才剥，避免误伤英文正文）。
export function stripAsrText(raw) {
  let text = String(raw || "").trim();
  const tagIndex = text.indexOf("<asr_text>");
  if (tagIndex !== -1) {
    text = text.slice(tagIndex + "<asr_text>".length);
    return text.replace(/<\/asr_text>\s*$/i, "").trim();
  }
  text = text.replace(/<\/?asr_text>/g, "");
  text = text.replace(/^\s*language\s+[A-Za-z-]+\s*(?=[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|$)/i, "");
  text = text.replace(/^\s*(?:zh|en|yue|ja|ko|fr|de|es|ru|ar|pt|it|vi|th|id|ms|hi|[a-z]{2}(?:-[A-Za-z]{2})?)\s*[\s,，、|｜:：-]+\s*/i, "");
  text = text.replace(/<\|[^|]*\|>/g, "");
  return text.trim();
}

// WAV 字节 → 本地引擎转写文本。抛错由调用方统一提示。
export async function transcribeWithLocalAsr({ wav, customServerPath = "", modelId = "" } = {}) {
  if (!wav || (wav instanceof Uint8Array && !wav.length)) throw new Error("没有收到录音内容");
  const { port } = await ensureLocalAsrServer({ customServerPath, modelId });
  const body = {
    messages: [{
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: Buffer.from(wav).toString("base64"), format: "wav" } },
        { type: "text", text: "请逐字转写这段音频，只输出转写文本。" },
      ],
    }],
    max_tokens: 2048,
    temperature: 0,
    stream: false,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("本地语音转写超时（120 秒），请缩短录音后重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`本地语音转写失败（${response.status}）：${detail}`);
  }
  const result = await response.json().catch(() => null);
  const raw = result?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !stripAsrText(raw)) throw new Error("本地语音引擎没有返回文字");
  scheduleIdleStop();
  return stripAsrText(raw);
}
