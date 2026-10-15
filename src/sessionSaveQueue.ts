import type { SessionRecord, SessionSavePayload } from "./types.ts";

type Snapshot = { records: SessionRecord[]; activeId: string };

/** 串行保存，合并等待中的快照；只在收到成功回执后推进差异比较基线。 */
export function createSessionSaveQueue(
  send: (payload: SessionSavePayload) => Promise<{ ok: boolean; error?: string }>,
  prepare: (record: SessionRecord) => SessionRecord = record => record,
) {
  let saved = new Map<string, SessionRecord>();
  let order: string[] = [];
  let activeId = "";
  let pending: Snapshot | null = null;
  let working: Promise<boolean> | null = null;
  let lastError = "";
  const drain = async (): Promise<boolean> => {
    while (pending) {
      const snapshot: Snapshot = pending;
      pending = null;
      const nextOrder = snapshot.records.map(record => record.id);
      const ids = new Set(nextOrder);
      const nextActiveId = ids.has(snapshot.activeId) ? snapshot.activeId : "";
      const changed = snapshot.records.filter(record => saved.get(record.id) !== record);
      const removed = [...saved.keys()].filter(id => !ids.has(id));
      const orderChanged = order.length !== nextOrder.length || order.some((id, index) => id !== nextOrder[index]);
      if (!changed.length && !removed.length && !orderChanged && activeId === nextActiveId) continue;
      try {
        const result = await send({
          changed: changed.map(prepare), removed, order: nextOrder, activeId: nextActiveId,
          meta: snapshot.records.map(({ id, channel, workspacePath }) => ({ id, channel, workspacePath })),
        });
        if (!result?.ok) throw new Error(result?.error || "保存未成功");
        saved = new Map(snapshot.records.map(record => [record.id, record]));
        order = nextOrder;
        activeId = nextActiveId;
        lastError = "";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        // 失败时保留最新请求，下次重试仍与最后一次成功保存比较。
        pending ||= snapshot;
        return false;
      }
    }
    return true;
  };
  return {
    seed(records: SessionRecord[], selectedId: string) {
      saved = new Map(records.map(record => [record.id, record]));
      order = records.map(record => record.id);
      activeId = order.includes(selectedId) ? selectedId : "";
    },
    request(records: SessionRecord[], selectedId: string) {
      pending = { records, activeId: selectedId };
      if (!working) working = Promise.resolve().then(drain).finally(() => { working = null; });
      return working;
    },
    error: () => lastError,
  };
}
