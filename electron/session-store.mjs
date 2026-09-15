// 通用合并写入器：requestSave 只保留最新快照，按 minIntervalMs 合并为
// 尾沿写入（首个快照立即落盘），flush() 立即落盘积压快照并等待在途写入。
// 实际落盘动作由 write 回调决定——sessions.json 已按会话拆分为
// sessions/<id>.json（见 session-archive.mjs），全量快照路径由
// createSessionArchive.saveAll 承接。
export function createCoalescedWriter({ minIntervalMs = 1000, write }) {
  let pending; // 最新待写快照；undefined 表示没有积压
  let chain = Promise.resolve(); // 串行化写入：同一时刻最多一次在途写入
  let lastWriteAt = 0; // 上次写入完成时刻；0 让首个快照立即落盘
  let timer = null;
  const stats = { requested: 0, written: 0 };

  const writeSnapshot = (value) => {
    chain = chain
      .catch(() => {})
      .then(() => write(value))
      .then(() => {
        lastWriteAt = Date.now();
        stats.written += 1;
      });
    return chain;
  };

  const drain = () => {
    timer = null;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    writeSnapshot(value).catch(() => {});
  };

  return {
    stats,
    requestSave(value) {
      stats.requested += 1;
      pending = value;
      if (timer !== null) return; // 定时器已排队：到点写最新快照即可
      const wait = Math.max(0, minIntervalMs - (Date.now() - lastWriteAt));
      timer = setTimeout(drain, wait);
      if (typeof timer.unref === "function") timer.unref();
    },
    // 立即落盘积压快照并等待在途写入完成；退出路径使用，永不 reject
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending !== undefined) {
        const value = pending;
        pending = undefined;
        try {
          await writeSnapshot(value);
        } catch {
          // 落盘失败只能放弃该快照；下一次保存仍是全量覆盖
        }
      }
      await chain.catch(() => {});
    },
  };
}
