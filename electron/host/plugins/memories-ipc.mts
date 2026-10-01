// IPC 域插件：长期记忆（memories:*）。
// 领域能力在 ctx.memory（记忆队列/内置认知覆盖表/wiki 页面与整合）。
export function memoriesIpcPlugin(deps) {
  return {
    name: "ipc:memories",
    inject: ["memory"],
    apply(ctx) {
      const { trustedHandle } = deps;

      // 记忆面板数据：wiki 页面 + 会话记忆卡 + 内置认知卡（空页面已过滤）
      trustedHandle("memories:list", () => ctx.memory.list());

      // 编辑一条记忆：内置条目写覆盖表；待整合队列改 memory.json；已整合的改 wiki 页面。
      trustedHandle("memories:update", (_event, payload) => ctx.memory.update(payload));

      trustedHandle("memories:delete", (_event, id) => ctx.memory.remove(id));

      // 一致性整理（lint）：只做维护不新增
      trustedHandle("memories:lint", async () => {
        try {
          return await ctx.memory.lint();
        } catch (error: any) {
          return { ok: false, error: String(error?.message || error) };
        }
      });
    },
  };
}
