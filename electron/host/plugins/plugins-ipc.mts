// IPC 域插件：插件管理（plugins:*）。
//
// 这组通道让界面能列出/安装/启停/配置/卸载插件，并**看到失败原因**——
// 不需要用户手编 dyworker.yml。
//
// 本插件自己就走契约层（ctx.ipc / ctx.plugins），不接收壳层 deps 大包：
// 既是功能实现，也是"第三方插件该怎么写"的第二个样板。
import { createHistoryRelay } from '../dsh-runtime/history-relay.mts';
import { promises as fs } from "node:fs";
import os from "node:os";
import path, { dirname } from "node:path";
import { cancelCardPluginCreation, listCreatedLocalPlugins, managedCreatedPluginsRoot, startCardPluginCreation, tryBuildOfflineLocalInstallRunner } from "../../plugin-authoring.mts";
import {
  MAX_SHARE_ARCHIVE_BYTES,
  SHARE_PACKAGE_EXTENSION,
  exportPluginSharePackage,
  inspectPluginForExport,
  inspectSharePackage,
  unpackSharePackageToManagedDir,
} from "../../plugin-share.mts";

export function pluginsIpcPlugin(deps: any = {}) {
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

      // 从包管理器装进 profile，再走上面的安装流程；本地纯 JS 目录优先走离线快速拷贝
      ctx.effect(() => ctx.ipc.handle("plugins:install-package", async (_event, payload) => {
        const rawInput = String(payload?.input ?? payload?.spec ?? "").trim();
        const localFast = rawInput ? await tryBuildOfflineLocalInstallRunner(rawInput) : null;
        const downloaded = await host.installPackage({
          input: localFast?.ok ? localFast.resolvedDir : (payload?.input ?? payload?.spec),
          version: payload?.version,
          source: payload?.source,
          customRegistry: payload?.customRegistry,
          allowIncompatible: Boolean(payload?.allowIncompatible),
          ...(localFast?.ok && localFast.run ? { run: localFast.run } : {}),
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

      ctx.effect(() => ctx.ipc.handle("plugins:managed-root", () => {
        const dataDir = deps.dataDir || ctx.paths?.dataDir || dirname(ctx.plugins?.dir || ".");
        return managedCreatedPluginsRoot(dataDir);
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:choose-directory", async () => {
        const win = ctx.get("window");
        if (!win?.dialog?.showOpenDialog) return null;
        const result = await win.dialog.showOpenDialog({
          properties: ["openDirectory"],
          title: "选择插件文件夹",
        });
        return result?.canceled ? null : result?.filePaths?.[0] || null;
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:list-created", () => {
        const dataDir = deps.dataDir || ctx.paths?.dataDir || dirname(ctx.plugins?.dir || ".");
        return listCreatedLocalPlugins(ctx, dataDir);
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:card-create", (event, payload) => {
        const dataDir = deps.dataDir || ctx.paths?.dataDir || dirname(ctx.plugins?.dir || ".");
        return startCardPluginCreation({
          ctx,
          dataDir,
          getSettings: deps.getSettings || (() => ctx.get("settings")?.read?.()),
          renderer: event?.sender,
          syncClientPlugin: deps.syncClientPlugin
            ? (req) => deps.syncClientPlugin(event?.sender, req)
            : undefined,
          notifyPluginsUpdated: deps.notifyPluginsUpdated,
        }, payload);
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:card-cancel", (_event, payload) => cancelCardPluginCreation(payload)));

      const resolveShareContext = () => {
        const dataDir = deps.dataDir || ctx.paths?.dataDir || dirname(ctx.plugins?.dir || ".");
        const storageRoot = ctx.get("storage")?.root || path.join(ctx.plugins?.dir || dataDir, "data");
        return { dataDir, storageRoot };
      };

      const decodeSharePayloadInput = async (payload: any) => {
        const filePath = String(payload?.filePath || "").trim();
        if (filePath) return { filePath };
        const rawBase64 = String(payload?.dataBase64 || "").trim();
        if (!rawBase64) throw new Error("请提供分享包路径或文件内容");
        if (rawBase64.length > Math.ceil(MAX_SHARE_ARCHIVE_BYTES * 1.4)) {
          throw new Error("分享包体积超过 50 MB 上限");
        }
        const buffer = Buffer.from(rawBase64, "base64");
        if (!buffer.length) throw new Error("分享包内容为空");
        return { buffer, fileName: String(payload?.fileName || "plugin.dyplugin") };
      };

      ctx.effect(() => ctx.ipc.handle("plugins:inspect-export", async (_event, payload) => {
        try {
          const { dataDir, storageRoot } = resolveShareContext();
          return await inspectPluginForExport(ctx, {
            target: String(payload?.target || "").trim(),
            dataDir,
            storageRoot,
          });
        } catch (error: any) {
          return { ok: false, error: String(error?.message || error) };
        }
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:export-package", async (_event, payload) => {
        try {
          const target = String(payload?.target || "").trim();
          const includeData = Boolean(payload?.includeData);
          const { dataDir, storageRoot } = resolveShareContext();
          const inspection = await inspectPluginForExport(ctx, { target, dataDir, storageRoot });
          if (!inspection?.ok) return inspection;
          if (inspection.shareKind !== "local") {
            return {
              ok: false,
              shareKind: "remote",
              error: "第三方插件请复制安装地址分享，无需导出本地压缩包",
              installSpec: inspection.installSpec,
              shareText: inspection.shareText,
            };
          }

          const win = ctx.get("window");
          if (!win?.dialog?.showSaveDialog) {
            return { ok: false, error: "当前窗口环境不支持保存文件对话框" };
          }
          const docsRoot = typeof deps.documentsDir === "function"
            ? deps.documentsDir()
            : (deps.documentsDir || path.join(os.homedir(), "Documents"));
          const saved = await win.dialog.showSaveDialog(win.current, {
            title: "导出插件分享包",
            defaultPath: path.join(docsRoot, inspection.defaultFileName),
            filters: [
              { name: "DYWorker 插件分享包", extensions: [SHARE_PACKAGE_EXTENSION] },
              { name: "ZIP 压缩包", extensions: ["zip"] },
            ],
          });
          if (saved?.canceled || !saved?.filePath) {
            return { ok: true, canceled: true };
          }

          return await exportPluginSharePackage(ctx, {
            target,
            outputPath: saved.filePath,
            includeData,
            dataDir,
            storageRoot,
            appVersion: String(deps.appVersion || ""),
          });
        } catch (error: any) {
          return { ok: false, error: String(error?.message || error) };
        }
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:choose-share-file", async () => {
        const win = ctx.get("window");
        if (!win?.dialog?.showOpenDialog) return null;
        const result = await win.dialog.showOpenDialog(win.current, {
          title: "选择插件分享包",
          properties: ["openFile"],
          filters: [
            { name: "DYWorker 插件分享包", extensions: [SHARE_PACKAGE_EXTENSION, "zip"] },
          ],
        });
        return result?.canceled ? null : result?.filePaths?.[0] || null;
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:inspect-share-package", async (_event, payload) => {
        try {
          const { dataDir, storageRoot } = resolveShareContext();
          const input = await decodeSharePayloadInput(payload);
          return await inspectSharePackage({
            ...input,
            ctx,
            dataDir,
            storageRoot,
          });
        } catch (error: any) {
          return { ok: false, error: String(error?.message || error) };
        }
      }));

      ctx.effect(() => ctx.ipc.handle("plugins:import-share-package", async (_event, payload) => {
        try {
          const { dataDir, storageRoot } = resolveShareContext();
          const input = await decodeSharePayloadInput(payload);
          const unpacked = await unpackSharePackageToManagedDir({
            ...input,
            dataDir,
            storageRoot,
            importData: payload?.importData !== false,
            overwriteData: Boolean(payload?.overwriteData),
          });
          if (!unpacked?.ok || !unpacked.pluginDir) {
            return unpacked;
          }

          const localFast = await tryBuildOfflineLocalInstallRunner(unpacked.pluginDir);
          const installed = await host.installPackage({
            input: unpacked.pluginDir,
            allowIncompatible: Boolean(payload?.allowIncompatible),
            ...(localFast?.ok && localFast.run ? { run: localFast.run } : {}),
          });
          if (!installed?.ok) {
            return {
              ...installed,
              pluginDir: unpacked.pluginDir,
              packageName: unpacked.packageName,
              displayName: unpacked.displayName,
              version: unpacked.version,
              importedDataFiles: unpacked.importedDataFiles,
              skippedDataFiles: unpacked.skippedDataFiles,
            };
          }

          const entries = typeof host.entries === "function" ? host.entries() : [];
          const matched = entries.find((item: any) =>
            item && (item.id === installed.id || item.name === unpacked.packageName || item.id === unpacked.packageName),
          );
          const entryId = String(matched?.id || installed.id || unpacked.packageName);
          if (matched?.disabled) {
            await host.setEnabled(entryId, true).catch(() => null);
          }
          deps.notifyPluginsUpdated?.();

          return {
            ...installed,
            ok: true,
            entryId,
            packageName: unpacked.packageName,
            displayName: unpacked.displayName,
            version: unpacked.version,
            pluginDir: unpacked.pluginDir,
            importedDataFiles: unpacked.importedDataFiles,
            skippedDataFiles: unpacked.skippedDataFiles,
          };
        } catch (error: any) {
          return { ok: false, error: String(error?.message || error) };
        }
      }));
    },
  };
}
