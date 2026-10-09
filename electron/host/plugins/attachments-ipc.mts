// IPC 域插件：附件选择与剪贴板图片（attachments:*）。
// 桌面能力（原生选择器/剪贴板）由壳层注入；附件的读取与描述复用壳层的 describeAttachment。
import { CommandAttachmentGrants } from '../dsh-runtime/attachment-grants.mts';
import { BrowserUploads } from '../dsh-runtime/browser-uploads.mts';
export function attachmentsIpcPlugin(deps) {
  return {
    name: "ipc:attachments",
    apply(ctx) {
      const { trustedHandle, app, path, dialog, isTrustedRendererUrl, getMainWindow, describeAttachment, saveClipboardImage } = deps;
      const grants = new CommandAttachmentGrants();
      const uploads = new BrowserUploads(); ctx.effect(() => () => uploads.dispose());
      const watched = new Set<number>();
      const scope = async (event, sessionId) => {
        if (!sessionId) return '';
        const session = await ctx.get('sessions').getAsync(String(sessionId));
        if (session?.runtime !== 'dsh') return '';
        if (!watched.has(event.sender.id)) {
          watched.add(event.sender.id); event.sender.once('destroyed', () => {
            grants.releaseSender(event.sender.id); void uploads.releaseSender(event.sender.id).catch(() => {}); watched.delete(event.sender.id);
          });
        }
        return session.id;
      };

      trustedHandle("attachments:choose", async (event, sessionId) => {
        const owner = await scope(event, sessionId);
        const result = await dialog.showOpenDialog(getMainWindow(), {
          title: "添加附件",
          properties: ["openFile", "multiSelections"],
        });
        if (result.canceled || !result.filePaths.length) return { canceled: true, attachments: [] };
        const attachments = [];
        for (const filePath of result.filePaths.slice(0, 12)) {
          try {
            const attachment = await describeAttachment(filePath);
            attachments.push(owner ? await grants.issue(owner, event.sender.id, attachment) : attachment);
          } catch {
            // Ignore files that disappeared or cannot be read after the native picker closes.
          }
        }
        return { canceled: false, attachments };
      });

      trustedHandle("attachments:save-clipboard-image", async (event, payload) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许读取剪贴板图片" };
        try {
          const saved = await saveClipboardImage(payload, path.join(app.getPath("userData"), "clipboard-images"));
          const attachment = await describeAttachment(saved.filePath);
          const owner = await scope(event, payload?.sessionId);
          return { ok: true, attachment: owner ? await grants.issue(owner, event.sender.id, attachment) : attachment };
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      trustedHandle('attachments:command-serialize', async (event, input) => {
        try {
          const owner = await scope(event, input?.sessionId);
          if (!owner) throw new Error('请选择 DSH 插件会话');
          const attachments = await ctx.get('dshRuntime').commandAttachments(owner,
            dataDir => grants.stage(owner, event.sender.id, input?.grantIds, dataDir));
          return { ok: true, attachments };
        } catch (error) { return { ok: false, error: String(error?.message || error) }; }
      });
      trustedHandle('attachments:browser-upload', async (event, input) => {
        try {
          // 会话删除后仍允许其窗口释放已经持有的上传编号；不能要求先恢复会话。
          if (input?.action === 'cancel') {
            await uploads.cancel(String(input.sessionId || ''), event.sender.id, input.uploadId);
            return { ok: true };
          }
          const owner = await scope(event, input?.sessionId);
          if (!owner || event.sender.isDestroyed()) throw new Error('请选择仍可用的 DSH 插件会话');
          let value: any;
          if (input.action === 'open') {
            const service = ctx.get('dshRuntime'); await service.request(owner, 'snapshot');
            const entry = service.sessions.get(owner);
            if (!entry || event.sender.isDestroyed()) throw new Error('附件所属窗口或会话已关闭');
            value = await uploads.open(owner, event.sender.id, entry.runtime.options.dataDir, input.name, (file, signal) => {
              if (service.sessions.get(owner) !== entry) throw new Error('附件所属会话已重新启动，请重新上传');
              return entry.runtime.request('browser-upload', { file }, { signal });
            });
            if (event.sender.isDestroyed()) { await uploads.releaseSender(event.sender.id); throw new Error('附件所属窗口已关闭'); }
          } else if (input.action === 'write') value = await uploads.write(owner, event.sender.id, input.uploadId, input.data);
          else if (input.action === 'finish') value = await uploads.finish(owner, event.sender.id, input.uploadId);
          else throw new Error('附件上传动作无效');
          return { ok: true, value };
        } catch (error) { return { ok: false, error: String(error?.message || error) }; }
      });
    },
  };
}
