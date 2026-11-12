// 本地决策引擎：decision_server.py 子进程生命周期管理 + 判定请求转发。
// 服务包装官方 inference.py 的 DecisionEngine，暴露与远程一致的 /v1/decisions。
// 策略：审批判定按需启动（首次要加载 2B 权重，约 30-60 秒），空闲 10 分钟自动退出
// 释放约 4GB 内存——比语音引擎的 3 分钟宽，因为这里的冷启动贵一个量级。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DECISION_MODELS, normalizeDecisionModelId, localDecisionModelPaths, decisionRuntimeStatus } from "./local-decision.mts";

const IDLE_STOP_MS = 10 * 60_000;
const START_TIMEOUT_MS = 240_000;
const DECIDE_TIMEOUT_MS = 30_000;

let server: any = null; // { child, port, modelId, startedAt, stderrTail }
let startingPromise: Promise<any> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

const here = path.dirname(fileURLToPath(import.meta.url));
function unpackedResourcePath(file: string) {
  return String(file).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}
const serverScript = unpackedResourcePath(path.join(here, "scripts", "decision_server.py"));

function pickFreePort() {
  return new Promise<any>((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as any;
      probe.close(() => resolve(port));
    });
  });
}

export function localDecisionServerState() {
  return server && server.child.exitCode === null
    ? { running: true, port: server.port }
    : { running: false, port: 0 };
}

export function stopLocalDecisionServer() {
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
    stopLocalDecisionServer();
  }, IDLE_STOP_MS);
}

// state 是 spawn 时捕获的启动状态引用：exit 事件会把模块级 server 置空，
// 只有靠这个引用才能在进程崩溃后拿到退出信号与 stderr 尾巴，给用户可行动的报错
async function waitForHealth(port: number, state: any) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      const reason = state.child.exitCode !== null
        ? `退出码 ${state.child.exitCode}`
        : `信号 ${state.child.signalCode}`;
      const tail = (state.stderrTailText || "").split("\n").filter(Boolean).slice(-3).join(" | ");
      throw new Error(`本地决策引擎启动失败（${reason}）${tail ? `：${tail}` : ""}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body: any = await response.json().catch(() => ({}));
        if (body?.status === "ok") return;
      }
    } catch {
      // 还没就绪，继续轮询
    }
    await new Promise<any>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("本地决策引擎启动超时（240 秒），请重试");
}

// 就绪返回 { port }；未就绪时抛出带用户可读信息的错误。
// modelId 指定要加载的本地模型；运行中的模型不一致时自动重启换模型。
export async function ensureLocalDecisionServer({ modelId = "" } = {} as any) {
  const requestedModel = normalizeDecisionModelId(modelId);
  scheduleIdleStop();
  if (server && server.child.exitCode === null && server.modelId === requestedModel) {
    return { port: server.port };
  }
  // 未运行或加载的是别的模型：停掉旧进程按需重启（并发调用合并到同一个启动任务，
  // 注意 stopLocalDecisionServer 会清空 startingPromise，必须先判断再停止）
  if (startingPromise) return startingPromise;
  stopLocalDecisionServer();
  startingPromise = (async () => {
    const runtime = decisionRuntimeStatus();
    if (!runtime.available) throw new Error("决策模型 Python 运行时还没有就绪，请在设置中重新下载");
    const definition = DECISION_MODELS[requestedModel];
    const modelPaths = localDecisionModelPaths(requestedModel);
    if (modelPaths.some((modelPath) => !modelPath) || modelPaths.length !== definition.files.length) {
      throw new Error("本地决策模型目录未初始化");
    }
    if (modelPaths.some((modelPath) => !existsSync(modelPath))) {
      throw new Error(`本地决策模型（${definition.label}）还没有下载，请在设置中下载`);
    }
    const port = await pickFreePort();
    const child = spawn(runtime.venvPython, [
      serverScript,
      "--model-dir", path.dirname(modelPaths[0]),
      "--port", String(port),
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
  } catch (error: any) {
    stopLocalDecisionServer();
    throw error;
  } finally {
    startingPromise = null;
  }
}

// 判定请求 → 本地引擎。抛错由调用方统一提示/降级；成功刷新空闲计时。
// 启动等待不监听外部信号：审核 90 秒到点会由上层 race 先行返回，加载继续在后台完成。
export async function decideWithLocalDecision({ request, modelId = "", signal = null, timeoutMs = DECIDE_TIMEOUT_MS } = {} as any) {
  if (!request || typeof request !== "object") throw new Error("没有收到可判定的请求内容");
  const { port } = await ensureLocalDecisionServer({ modelId });
  signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DECIDE_TIMEOUT_MS));
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/v1/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      // 外部取消（任务取消/审核到点）原样上抛，不冒充请求超时
      if (signal?.aborted) throw signal.reason ?? new Error("已取消");
      throw new Error(`本地决策模型服务超时（${Math.round((Number(timeoutMs) || DECIDE_TIMEOUT_MS) / 1000)} 秒），请重试`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`本地决策模型服务失败（${response.status}）：${detail}`);
  }
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== "object") throw new Error("本地决策引擎没有返回有效结果");
  scheduleIdleStop();
  return result;
}
