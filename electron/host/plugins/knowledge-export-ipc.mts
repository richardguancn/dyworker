// 知识导出独立于记忆基础通道；资料与图谱导出需要知识库服务。
export function knowledgeExportIpcPlugin(deps) {
  return {
    name: "ipc:knowledge-export",
    inject: ["memory", "connection"],
    apply(ctx) {
      const { trustedHandle, dialog, app, fs, path, getMainWindow } = deps;

      trustedHandle("knowledge:export", async (_event, payload) => {
        try {
          const kind = String(payload?.kind || '');
          const configs = { memories: ['导出记忆', '记忆', 'json'], knowledge: ['导出知识库资料', '知识库资料', 'json'],
            graph: ['导出完整图谱', '知识图谱', 'json'], image: ['导出当前图谱图片', '知识图谱', 'png'] };
          const config = configs[kind];
          if (!config) return { ok: false, error: '不支持的导出类型' };
          let data;
          if (kind === 'memories') {
            data = await ctx.memory.mutate(async () => ({ format: 'dyworker-memories', version: 1,
              exportedAt: new Date().toISOString(), pages: await ctx.memory.list(), provenance: await ctx.memory.provenance(),
              organizationHistory: (await ctx.memory.organizationHistoryUnlocked()).rows }));
          } else if (kind === 'image') {
            const image = String(payload?.image || '');
            if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 40_000_000) return { ok: false, error: '图谱图片无效或过大' };
            data = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
            if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ok: false, error: '图谱图片格式无效' };
          } else {
            const response = await ctx.connection.dispatch({ path: kind === 'graph' ? '/api/kb/graph/export' : '/api/kb/export' });
            if (response.status !== 200) return { ok: false, error: response.status === 404 ? '请先启用知识库插件' : '读取导出内容失败' };
            data = JSON.parse(response.body);
          }
          const result = await dialog.showSaveDialog(getMainWindow(), { title: config[0],
            defaultPath: path.join(app.getPath('documents'), `${config[1]}-${new Date().toISOString().slice(0, 10)}.${config[2]}`),
            filters: [{ name: config[2] === 'png' ? 'PNG 图片' : 'JSON 数据文件', extensions: [config[2]] }] });
          if (result.canceled || !result.filePath) return { ok: true, canceled: true };
          const target = result.filePath.toLowerCase().endsWith(`.${config[2]}`) ? result.filePath : `${result.filePath}.${config[2]}`;
          await fs.writeFile(target, kind === 'image' ? data : JSON.stringify(data, null, 2));
          return { ok: true, canceled: false, path: target };
        } catch (error: any) { return { ok: false, error: String(error?.message || error) }; }
      });

    },
  };
}
