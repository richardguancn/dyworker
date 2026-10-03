// IPC 域插件：插件管理（plugins:*）。
//
// 这组通道让界面能列出/安装/启停/配置/卸载插件，并**看到失败原因**——
// 不需要用户手编 dyworker.yml。
//
// 本插件自己就走契约层（ctx.ipc / ctx.plugins），不接收壳层 deps 大包：
// 既是功能实现，也是"第三方插件该怎么写"的第二个样板。
export function pluginsIpcPlugin() {
  return {
    name: "ipc:plugins",
    // 为什么需要 loader：cordis 4 的严格服务访问按**当前调用方 fiber** 判定，
    // 而 loader 内部实现（EntryGroup.create 等）自己会读 this.ctx.loader。
    // 也就是说"驱动 loader 的操作"必须在持有 loader 权限的 fiber 里执行——
    // 这是 cordis 的设计，封装不掉，凡是调用 ctx.plugins 变更类方法都要带上。
    inject: ["plugins", "ipc", "loader"],
    apply(ctx) {
      const host = ctx.plugins;

      // 已安装插件：条目 + 运行态 + 失败原因
      ctx.effect(() => ctx.ipc.handle("plugins:list", () => ({
        entries: host.entries(),
        bundles: host.bundles_(),
        warnings: host.patchWarnings,
        status: host.status(),
      })));

      // 装之前先判兼容性（不安装）
      ctx.effect(() => ctx.ipc.handle("plugins:compatibility", (_event, spec) =>
        host.compatibility({ spec })));

      // 安装：默认先做兼容性判定，不兼容直接拒绝并带上矩阵
      ctx.effect(() => ctx.ipc.handle("plugins:install", (_event, payload) =>
        host.install({
          spec: payload?.spec,
          id: payload?.id,
          allowIncompatible: Boolean(payload?.allowIncompatible),
        })));

      // 从包管理器装进 profile，再走上面的安装流程
      ctx.effect(() => ctx.ipc.handle("plugins:install-package", async (_event, payload) => {
        const downloaded = await host.installPackage({
          input: payload?.input ?? payload?.spec,
          version: payload?.version,
          source: payload?.source,
          customRegistry: payload?.customRegistry,
          allowIncompatible: Boolean(payload?.allowIncompatible),
        });
        return downloaded;
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:enable", (_event, id) => host.setEnabled(id, true)));
      ctx.effect(() => ctx.ipc.handle("plugins:disable", (_event, id) => host.setEnabled(id, false)));
      ctx.effect(() => ctx.ipc.handle("plugins:configure", (_event, payload) =>
        host.configure(payload?.id, payload?.config ?? null)));
      ctx.effect(() => ctx.ipc.handle("plugins:uninstall", (_event, id) => host.uninstall({ spec: id })));
      // 重新读清单（手工编辑过 dyworker.yml 后用）
      ctx.effect(() => ctx.ipc.handle("plugins:reload", () => host.reload().then((result) => ({ ok: true, ...result }))));
    },
  };
}
