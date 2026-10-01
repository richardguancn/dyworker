// IPC 域插件：附件选择与剪贴板图片（attachments:*）。
// 桌面能力（原生选择器/剪贴板）由壳层注入；附件的读取与描述复用壳层的 describeAttachment。
export function attachmentsIpcPlugin(deps) {
  return {
    name: "ipc:attachments",
    apply(ctx) {
      const { trustedHandle, app, path, dialog, isTrustedRendererUrl, getMainWindow, describeAttachment, saveClipboardImage } = deps;

      trustedHandle("attachments:choose", async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
          title: "添加附件",
          properties: ["openFile", "multiSelections"],
        });
        if (result.canceled || !result.filePaths.length) return { canceled: true, attachments: [] };
        const attachments = [];
        for (const filePath of result.filePaths.slice(0, 12)) {
          try {
            attachments.push(await describeAttachment(filePath));
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
          return { ok: true, attachment: await describeAttachment(saved.filePath) };
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
    },
  };
}
