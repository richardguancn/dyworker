// 内置本地审核模型：llama.cpp（node-llama-cpp）+ Qwen3-0.6B Q8_0 GGUF。
// 用途：审批严格度为"替我审批"时，本来要人工确认的操作交给本地小模型判断，
// 零成本、离线可用。只在 Electron 主进程使用（node-llama-cpp 不允许进渲染进程）。
// node-llama-cpp 通过函数内动态 import 加载，保证单元测试可以在不装原生模块的环境运行。
import crypto from "node:crypto";
import { createWriteStream, existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

// 官方 Qwen GGUF 的 Q8_0 量化：0.6B 小模型量化损失比 Q4 小得多，610MB 一次下载。
// sources 按序回退：ModelScope 国内直连最快，hf-mirror 与 HuggingFace 供有代理的用户。
export const LOCAL_REVIEWER_MODEL = Object.freeze({
  fileName: "Qwen3-0.6B-Q8_0.gguf",
  bytes: 639446688,
  sha256: "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031",
  sources: [
    "https://modelscope.cn/models/Qwen/Qwen3-0.6B-GGUF/resolve/master/Qwen3-0.6B-Q8_0.gguf",
    "https://hf-mirror.com/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf",
    "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf",
  ],
});

let modelDir = null;
let engine = null;
let engineLoading = null;
let downloadJob = null;
let idleTimer = null;

// 审核输入被上游裁剪过（策略 ~600 token + 上下文 4K 字符 + 回复），4K 足够，
// KV 缓存也小（8K 上下文对小模型会多占数百 MB 内存）
const CONTEXT_SIZE = 4096;
const MAX_REPLY_TOKENS = 220;
const IDLE_UNLOAD_MS = 5 * 60_000;

// main 启动时注入 userData/models/reviewer；测试可注入临时目录
export function configureLocalReviewer({ dir } = {}) {
  modelDir = dir ? String(dir) : null;
}

export function localReviewerModelPath() {
  return modelDir ? path.join(modelDir, LOCAL_REVIEWER_MODEL.fileName) : null;
}

export function localReviewerModelStatus() {
  const filePath = localReviewerModelPath();
  if (!filePath) return { configured: false, downloaded: false, sizeBytes: 0, expectedBytes: LOCAL_REVIEWER_MODEL.bytes };
  // 下载器只在完整校验通过后才改名成最终文件，所以最终文件存在即可信
  const exists = existsSync(filePath);
  const sizeBytes = exists ? statSync(filePath).size : 0;
  return {
    configured: true,
    downloaded: exists && sizeBytes === LOCAL_REVIEWER_MODEL.bytes,
    sizeBytes,
    expectedBytes: LOCAL_REVIEWER_MODEL.bytes,
    filePath,
  };
}

function reportProgress(onProgress, received, total) {
  if (!onProgress) return;
  try {
    onProgress({ received, total, percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0 });
  } catch {
    // 进度回调异常不中断下载
  }
}

// 断点续传下载：.part 记录进度，全部源共用同一份字节，跨源可续传；
// 完成后做 sha256 校验，通过才改名成最终文件。
export async function downloadLocalReviewerModel({ onProgress = null, fetchImpl = fetch, signal = null } = {}) {
  const target = localReviewerModelPath();
  if (!target) throw new Error("本地审核模型目录未初始化");
  const status = localReviewerModelStatus();
  if (status.downloaded) {
    reportProgress(onProgress, LOCAL_REVIEWER_MODEL.bytes, LOCAL_REVIEWER_MODEL.bytes);
    return { ok: true, skipped: true };
  }
  if (downloadJob) return downloadJob;
  downloadJob = (async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const partial = `${target}.part`;
    let offset = existsSync(partial) ? statSync(partial).size : 0;
    let lastError = null;
    for (const source of LOCAL_REVIEWER_MODEL.sources) {
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
          const total = LOCAL_REVIEWER_MODEL.bytes;
          const file = createWriteStream(partial, { flags: offset > 0 ? "a" : "w" });
          let received = offset;
          let lastReport = -1;
          const reader = Readable.fromWeb(response.body);
          await new Promise((resolve, reject) => {
            reader.on("data", (chunk) => {
              received += chunk.length;
              const percent = Math.round((received / total) * 100);
              if (percent !== lastReport) {
                lastReport = percent;
                reportProgress(onProgress, received, total);
              }
            });
            reader.on("error", reject);
            file.on("error", reject);
            file.on("finish", resolve);
            reader.pipe(file);
          });
          if (signal?.aborted) throw new Error("下载已取消");
          if (received < total) throw new Error(`响应不完整：收到 ${received}/${total} 字节`);
          offset = received;
          break;
        }
        break; // 这个源已下载完整
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        // 换下一个源继续（.part 保留，支持断点续传）
      }
    }
    if (statSync(partial).size !== LOCAL_REVIEWER_MODEL.bytes) {
      throw new Error(`下载不完整：${lastError ? lastError.message : "所有下载源都失败了"}`);
    }
    reportProgress(onProgress, LOCAL_REVIEWER_MODEL.bytes, LOCAL_REVIEWER_MODEL.bytes);
    const hash = crypto.createHash("sha256");
    hash.update(await fs.readFile(partial));
    if (hash.digest("hex") !== LOCAL_REVIEWER_MODEL.sha256) {
      await fs.rm(partial, { force: true });
      throw new Error("模型文件校验失败，已删除损坏的下载，请重试");
    }
    await fs.rename(partial, target);
    return { ok: true };
  })().finally(() => {
    downloadJob = null;
  });
  return downloadJob;
}

function scheduleIdleUnload() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    const current = engine;
    engine = null;
    if (!current) return;
    Promise.resolve(current.model.dispose?.()).catch(() => { });
  }, IDLE_UNLOAD_MS);
}

async function getEngine() {
  if (engine) {
    scheduleIdleUnload();
    return engine;
  }
  if (engineLoading) return engineLoading;
  engineLoading = (async () => {
    const status = localReviewerModelStatus();
    if (!status.downloaded) throw new Error("模型文件不存在，请先在设置中下载");
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: localReviewerModelPath() });
    const context = await model.createContext({ contextSize: CONTEXT_SIZE, sequences: 4 });
    engine = { llama, model, context };
    scheduleIdleUnload();
    return engine;
  })();
  try {
    return await engineLoading;
  } catch (error) {
    engine = null;
    throw error;
  } finally {
    engineLoading = null;
  }
}

// Qwen3 是混合思考模型：/no_think 是官方软开关（放在本轮 user 消息末尾）；即便如此
// 部分输出仍可能带思考段，剥掉再解析；思考被截断时从内容里抢救最后一个 JSON 块。
export function stripThinkingBlocks(text) {
  const value = String(text || "");
  const stripped = value
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim();
  if (stripped) return stripped;
  const matches = value.match(/\{[^{}]*\}/g);
  return matches ? matches[matches.length - 1] : "";
}

// 0.6B 小模型对纯政策文本的遵循度有限，用固定少样本示例锚定输出格式与判断尺度。
// 示例刻意与云端审核助手政策一致：只读放行、破坏性拒绝、对外发布转人工。
const LOCAL_REVIEWER_FEW_SHOT = [
  '操作：运行命令 curl -s "https://zh.wikipedia.org/api/rest_v1/page/summary/Exile" | head -c 2000\n结果：{"decision":"allow","reason":"读取公开网页内容供任务参考，无副作用"}',
  '操作：运行命令 ls -la /Users/someone/.agents/skills/some-skill/scripts/ | head -20\n结果：{"decision":"allow","reason":"只读查看本机工具目录，无修改"}',
  '操作：运行命令 rm -f imgs/history-2026-08-25-fengru-0*.jpg\n结果：{"decision":"ask","reason":"删除文件属于破坏性操作，交由用户确认"}',
  '操作：运行命令 git push origin main\n结果：{"decision":"ask","reason":"对外发布动作，影响超出本机，交由用户确认"}',
  '操作：运行命令 sudo apt install ffmpeg\n结果：{"decision":"deny","reason":"需要管理员权限的系统级改动，不应静默执行"}',
].join("\n\n");

export function buildLocalReviewPrompt({ policy, action = {}, context = "" } = {}) {
  const clip = (text, max) => {
    const value = String(text || "");
    return value.length > max ? value.slice(0, max) : value;
  };
  return `下面是审核政策：\n${clip(policy, 4000)}\n\n审核示例：\n${LOCAL_REVIEWER_FEW_SHOT}\n\n任务背景（节选）：\n${clip(context, 2500)}\n\n待审核操作：\n工具：${String(action.kind || "")}\n说明：${String(action.title || "")}\n详情：\n${clip(String(action.details || ""), 3000)}\n\n请严格按照示例格式，只输出一行审核 JSON 结果（decision 取 allow/deny/ask）。/no_think`;
}

// 返回模型原始回复文本（已剥离思考段），由调用方解析 JSON——避免与 agent.mjs 相互依赖。
// 抛错时调用方按 fail-closed 处理（转人工）。
export async function localReview({ policy, action = {}, context = "", signal = null } = {}) {
  const engineState = await getEngine();
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  scheduleIdleUnload();
  const { LlamaChatSession } = await import("node-llama-cpp");
  const sequence = engineState.context.getSequence();
  if (signal) {
    // 外层审批超时（withModelTimeout）触发中止时，丢弃当前序列结束生成
    signal.addEventListener("abort", () => Promise.resolve(sequence.dispose?.()).catch(() => { }), { once: true });
  }
  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: "你是 DYWorker 的安全审核助手，严格按用户给出的示例格式，只输出一行审核 JSON 结果。\n/no_think",
  });
  try {
    const reply = await session.prompt(buildLocalReviewPrompt({ policy, action, context }), {
      maxTokens: MAX_REPLY_TOKENS,
      temperature: 0.1,
    });
    return stripThinkingBlocks(reply);
  } finally {
    try {
      await session.dispose?.();
    } catch {
      // 忽略销毁异常
    }
    try {
      // 归还序列，否则几次调用后上下文序列池耗尽（No sequences left）
      await Promise.resolve(sequence.dispose?.());
    } catch {
      // 忽略销毁异常
    }
  }
}
