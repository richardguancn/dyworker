// IPC 域插件：会话存档写入（sessions:save）。
// 存档经 ctx.sessions 服务；渠道工作区同步是壳层领域，经 deps 注入。

export function sessionsIpcPlugin(deps) {
  return {
    name: "ipc:sessions",
    inject: ["sessions"],
    apply(ctx) {
      const { trustedHandle, syncChannelSessionWorkspaces, channelMetaOf } = deps;

trustedHandle("sessions:save", async (_event, payload) => {
  try {
    if (Array.isArray(payload)) {
      // 旧渲染端整档快照：走合并写入器（2 秒间隔尾沿落盘，防写放大）
      await syncChannelSessionWorkspaces(channelMetaOf(payload));
      ctx.sessions.requestSave(payload);
      return { ok: true };
    }
    // 新渲染端增量：只含变化的会话/删除的 id/权威顺序，直接落盘。
    // 渠道同步用渲染端随载荷附带的轻量 meta（全量会话各一条），保证
    // 升级后从未变化的渠道会话也能在首次见到时同步一次工作区基线。
    const delta = {
      changed: Array.isArray(payload?.changed) ? payload.changed : [],
      removed: Array.isArray(payload?.removed) ? payload.removed : [],
      order: Array.isArray(payload?.order) ? payload.order : [],
      activeId: typeof payload?.activeId === "string" ? payload.activeId : "",
    };
    await syncChannelSessionWorkspaces(Array.isArray(payload?.meta) ? payload.meta : channelMetaOf(delta.changed));
    await ctx.sessions.applyDelta(delta);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
    },
  };
}
