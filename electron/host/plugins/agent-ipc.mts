// IPC 域插件：桌面会话任务入口（agent:*）。
// 运行期状态（activeAgents / sessionQueue）与任务执行（executeAgentRun / drainSessionQueue）
// 仍在壳层——它们要用 ctx.agent、会话存档与窗口事件；这里只做通道映射，
// 取消唤醒经 inject 的 ctx.scheduler。

export function agentIpcPlugin(deps) {
  return {
    name: "ipc:agent",
    inject: ["scheduler"],
    apply(ctx) {
      const { trustedHandle, isTrustedRendererUrl, isShuttingDown, activeAgents, sessionQueue, emitToSession, executeAgentRun, drainSessionQueue } = deps;

trustedHandle("agent:send", async (event, payload) => {
  try {
    if (isShuttingDown()) return { status: "cancelled", reason: "应用正在退出" };
    if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "任务请求来源无效" };
    const sessionId = String(payload?.sessionId || "").trim();
    const runId = String(payload?.runId || "").trim();
    if (!sessionId || !runId) return { ok: false, error: "任务标识无效，请新建任务后重试" };
    if (activeAgents.has(sessionId)) {
      const count = sessionQueue.push({ sessionId, runId, payload, sender: event.sender });
      emitToSession(event.sender, sessionId, runId, { type: "queued", count });
      return { ok: true, queued: true, runId };
    }
    return await executeAgentRun({ payload, sender: event.sender });
  } catch (agentError: any) {
    const reason = agentError instanceof Error ? agentError.message : String(agentError);
    return { ok: false, error: reason };
  }
});

trustedHandle("agent:remove-queued", (_event, payload) => {
  const sessionId = String(payload?.sessionId || "").trim();
  const runId = String(payload?.runId || "").trim();
  const removed = sessionQueue.remove(sessionId, runId);
  return { ok: true, removed };
});

trustedHandle("agent:run-queued-now", async (_event, payload) => {
  const sessionId = String(payload?.sessionId || "").trim();
  const runId = String(payload?.runId || "").trim();
  if (!sessionId || !runId) return { ok: false, error: "任务标识无效" };
  if (!sessionQueue.promote(sessionId, runId)) return { ok: false, error: "这条消息已不在队列中" };
  const agentState = activeAgents.get(sessionId);
  if (!agentState) {
    // 当前任务恰好已结束，队列不会自动推进，这里直接启动队首
    drainSessionQueue(sessionId);
    return { ok: true };
  }
  agentState.cancelled = true;
  agentState.abortController.abort();
  for (const resolve of agentState.pending.values()) resolve(false);
  agentState.pending.clear();
  await ctx.scheduler.cancelForSession(sessionId);
  return { ok: true };
});

trustedHandle("agent:resolve-approval", (_event, payload) => {
  const agentState = activeAgents.get(String(payload?.sessionId || ""));
  const resolve = agentState?.pending.get(String(payload?.actionId || ""));
  if (!resolve) return { ok: false };
  agentState.pending.delete(String(payload?.actionId || ""));
  resolve(Boolean(payload?.approved));
  return { ok: true };
});

trustedHandle("agent:resolve-question", (_event, payload) => {
  const agentState = activeAgents.get(String(payload?.sessionId || ""));
  const key = `q:${String(payload?.requestId || "")}`;
  const resolve = agentState?.pending.get(key);
  if (!resolve) return { ok: false };
  agentState.pending.delete(key);
  resolve({ ok: true, answer: String(payload?.answer || "") });
  return { ok: true };
});

trustedHandle("agent:cancel", async (_event, payload) => {
  const sessionId = String(payload?.sessionId || "");
  const runId = String(payload?.runId || "");
  if (!sessionId || !runId) return { ok: false };
  const agentState = activeAgents.get(sessionId);
  if (!agentState) return { ok: false };
  if (agentState.runId !== runId) return { ok: false };
  agentState.cancelled = true;
  agentState.abortController.abort();
  for (const resolve of agentState.pending.values()) resolve(false);
  agentState.pending.clear();
  // 任务被取消时,它登记的待唤醒一并取消
  await ctx.scheduler.cancelForSession(sessionId);
  return { ok: true };
});
    },
  };
}
