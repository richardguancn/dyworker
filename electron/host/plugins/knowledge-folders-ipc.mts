export function knowledgeFoldersIpcPlugin({ trustedHandle, dialog, getMainWindow }) {
  return {
    name: 'ipc:knowledge-folders',
    inject: ['connection'],
    apply(ctx) {
      trustedHandle('knowledge:local-folders', async (_event, payload) => {
        try {
          const { action, id, category } = payload ?? {};
          let folderPath: string | undefined;
          if (action === 'connect') {
            const result = await dialog.showOpenDialog(getMainWindow(), {
              title: '选择知识库的本地资料目录', properties: ['openDirectory'],
            });
            if (result.canceled || !result.filePaths[0]) return { ok: true, canceled: true };
            folderPath = result.filePaths[0];
          }
          const response = await ctx.connection.dispatchDesktop({ path: '/api/kb/local-folders', method: 'POST',
            body: JSON.stringify({ action, id, category, folderPath }) });
          if (response.status === 404) return { ok: false, error: '请先启用知识库插件' };
          return { ok: response.status === 200, ...JSON.parse(response.body) };
        } catch (error: any) { return { ok: false, error: String(error?.message || error) }; }
      });
    },
  };
}
