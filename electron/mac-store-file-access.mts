// 商店版的持久文件授权；bookmark 只来自用户主动打开的系统选择器。
// 与 Electron 解耦，便于测试重启恢复、授权失败和退出释放。
export function createMacStoreFileAccess({ enabled, startAccess, load, save }) {
  let records = new Map<string, string>();
  const active = new Map<string, Function>();
  let tail = Promise.resolve();
  const serial = <T,>(action: () => Promise<T>) => {
    const task = tail.then(action);
    tail = task.then(() => {}, () => {});
    return task;
  };
  return {
    enabled: Boolean(enabled),
    restore() {
      return serial(async () => {
        if (!enabled) return [];
        const stored = await load();
        records = new Map(Object.entries(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {})
          .filter(([file, bookmark]) => file && typeof bookmark === 'string' && bookmark.length > 0) as [string, string][]);
        const failed: string[] = [];
        for (const [file, bookmark] of records) {
          if (active.has(file)) continue;
          try { active.set(file, startAccess(bookmark)); }
          catch { failed.push(file); }
        }
        return failed;
      });
    },
    remember(file: string, bookmark?: string) {
      return serial(async () => {
        if (!enabled) return;
        if (!file || !bookmark) throw new Error('未取得文件夹的持续访问授权，请重新选择文件夹。');
        const stop = startAccess(bookmark);
        const next = new Map(records).set(file, bookmark);
        try { await save(Object.fromEntries(next)); }
        catch (error) { stop(); throw error; }
        // 保存成功后才替换旧授权，避免写盘失败导致原有工作区失效。
        const previous = active.get(file);
        records = next;
        active.set(file, stop);
        previous?.();
      });
    },
    dispose() {
      return serial(async () => {
        for (const stop of active.values()) {
          try { stop(); } catch { /* 尽力释放其余资源。 */ }
        }
        active.clear();
      });
    },
  };
}
