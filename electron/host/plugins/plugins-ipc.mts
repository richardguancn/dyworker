// IPC 域插件：插件管理（plugins:*）。
//
// 这组通道让界面能列出/安装/启停/配置/卸载插件，并**看到失败原因**——
// 不需要用户手编 dyworker.yml。
//
// 本插件自己就走契约层（ctx.ipc / ctx.plugins），不接收壳层 deps 大包：
// 既是功能实现，也是"第三方插件该怎么写"的第二个样板。
import { createHistoryRelay } from '../dsh-runtime/history-relay.mts';
export function pluginsIpcPlugin() {
  return {
    name: "ipc:plugins",
    // 为什么需要 loader：cordis 4 的严格服务访问按**当前调用方 fiber** 判定，
    // 而 loader 内部实现（EntryGroup.create 等）自己会读 this.ctx.loader。
    // 也就是说"驱动 loader 的操作"必须在持有 loader 权限的 fiber 里执行——
    // 这是 cordis 的设计，封装不掉，凡是调用 ctx.plugins 变更类方法都要带上。
    inject: ["plugins", "ipc", "loader", "pluginCatalog"],
    apply(ctx) {
      const host = ctx.plugins;
      const mods=ctx.get('mods');
      for(const [channel,handler]of Object.entries({
        'mods:list':()=>mods.list(),
        'mods:install':(_event,input)=>mods.install(input),
        'mods:check':(_event,directory)=>mods.check(String(directory||'')),
        'mods:enable':(_event,input)=>mods.enable(input.id,!!input.enabled),
        'mods:configure':(_event,input)=>mods.configure(input.id,input.config),
        'mods:uninstall':(_event,id)=>mods.uninstall(String(id||'')),
        'mods:snapshot':async(_event,input)=>{if(!await ctx.sessions.getAsync(input?.sessionId))return [];return mods.snapshot(input.sessionId);},
        'mods:action':async(_event,input)=>{if(!await ctx.sessions.getAsync(input?.sessionId))throw new Error('请选择已有会话');return mods.action(input.sessionId,input.id,input);},
        'mods:choose-directory':async()=>{const result=await ctx.get('window').dialog.showOpenDialog({properties:['openDirectory'],title:'选择 Claude Mod 目录'});return result.canceled?null:result.filePaths?.[0]||null;},
      }))ctx.effect(()=>ctx.ipc.handle(channel,handler));
      const historyRelay = createHistoryRelay((rootId,action,payload,options) => ctx.get('dshRuntime').request(rootId,action,payload,options));
      ctx.effect(() => () => historyRelay.dispose());

      // 已安装插件：条目 + 运行态 + 失败原因
      ctx.effect(() => ctx.ipc.handle("plugins:list", () => ({
        entries: host.entries(),
        bundles: host.bundles_(),
        warnings: host.patchWarnings,
        status: host.status(),
      })));
      ctx.effect(() => ctx.ipc.handle("plugins:detail", (_event, id) => host.detail(String(id || ''))));
      ctx.effect(() => ctx.ipc.handle("plugins:catalog", (_event, payload) => ctx.pluginCatalog.read(payload?.force===true)));

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

      // 客户端半边（dsh.client）：只解析入口并给出自定义协议 URL，脚本由渲染端加载执行
      ctx.effect(() => ctx.ipc.handle("plugins:client-bundles", (_event, id) => host.clientBundles(id)));
      ctx.effect(() => ctx.ipc.handle('plugins:dsh-operation', async (_event, input) => {
        try {
          if (input?.action === 'overview') return { ok: true, value: await ctx.get('dshRuntime').overview() };
          if(input?.action==='global-list'||input?.action==='global-list-cancel'||input?.action==='global-search'||input?.action==='global-search-cancel')return {ok:true,value:await historyRelay.request(_event.sender,'',input.action,input.payload||{})};
          if(input?.action==='session-create'||input?.action==='session-fork'){
            const value=await historyRelay.request(_event.sender,'',input.action,input.payload||{});
            if(!_event.sender.isDestroyed?.())_event.sender.send('sessions:dsh-created',{session:value.nativeSession});
            return {ok:true,value};
          }
          const sessionId = String(input?.sessionId || '');
          const allowed = ['snapshot', 'family', 'child-snapshot', 'session-image', 'history-page', 'history-open', 'history-next', 'history-close', 'history-list', 'history-control-open', 'history-state', 'history-search', 'session-rename', 'session-command', 'settings-describe', 'settings-update', 'settings-mutate', 'inject', 'compact', 'input-snapshot', 'input-admit', 'input-update-queue', 'input-cancel', 'child-prompt', 'child-interrupt'];
          if (!allowed.includes(input?.action)) throw new Error('此 DSH 操作未开放给界面');
          const session = await ctx.sessions.getAsync(sessionId);
          if (session?.runtime !== 'dsh') throw new Error('请选择 DSH 插件会话');
          const value = input.action.startsWith('history-')
            ? await historyRelay.request(_event.sender,sessionId,input.action,input.payload || {})
            : await ctx.get('dshRuntime').request(sessionId, input.action, input.payload || {});
          if(input.action === 'session-rename' && input.payload?.address?.kind === 'session' && !_event.sender.isDestroyed?.())
            _event.sender.send('sessions:dsh-renamed',{sessionId,title:value.title});
          return { ok: true, value };
        } catch (error) { return { ok: false, error: { message: String(error?.message || error),
          ...(error?.code ? {code:error.code,details:error.details}: {}) } }; }
      }));

      // 插件视图要的会话投影（DSH 客户端契约：壳层提供 useProjection(key)）。
      // 数据源是宿主的 sessionProjections 服务；还没实现折叠时如实返回 undefined，
      // 插件据此进入"cold"分支并走它自己的 /api 路由取数据。
      ctx.effect(() => ctx.ipc.handle("plugins:projection", async (_event, payload) => {
        const sessionId = String(payload?.sessionId || "");
        const key = String(payload?.key || "");
        if (!sessionId || !key) return { ok: false, error: "缺少 sessionId 或 key" };
        try {
          const session = ctx.sessions.get(sessionId);
          if (session === undefined || session === null) return { ok: false, error: "会话不存在" };
          if (session.runtime === 'dsh') {
            const snapshot = await ctx.get('dshRuntime').request(sessionId, 'snapshot');
            return { ok: true, value: snapshot.projections.values[key] ?? null };
          }
          // 客户端要的是线格式视图（顶层带 current/nodes/...），与插件路由用的原始状态不同
          const value = ctx.sessionProjections.viewOf(session, key);
          return { ok: true, value: value === undefined ? null : value };
        } catch (error) {
          return { ok: false, error: String(error?.message || error) };
        }
      }));
    },
  };
}
