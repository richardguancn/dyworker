import type { TraceEvent } from './types.ts';

export function trimRecentText<T extends { content: string; title: string }>(records: T[], maxBytes = 2 * 1024 * 1024, maxEntries = 300) {
  let bytes = 0;
  let start = records.length;
  while (start > 0 && records.length - start < maxEntries) {
    const record = records[start - 1];
    const size = ((record.content?.length || 0) + (record.title?.length || 0) + 256) * 2;
    if (start < records.length && bytes + size > maxBytes) break;
    bytes += size; start--;
  }
  return records.slice(start);
}

/** 最近轨迹的展示缓存，完整历史由磁盘负责；单条超大记录保留自身，不截短原文。 */
export function createTraceBuffer(maxBytes = 8 * 1024 * 1024, maxEntries = 5000) {
  const records: TraceEvent[] = [];
  const sizes: number[] = [];
  const keys = new Set<string>();
  let bytes = 0;
  const keyOf = (record: TraceEvent) => `${record.runId || ''}:${record.seq}`;
  return {
    append(incoming: TraceEvent[]) {
      let changed = false;
      for (const record of incoming) {
        const key = keyOf(record);
        if (keys.has(key)) continue;
        const size = ((record.content?.length || 0) + (record.title?.length || 0) + 256) * 2;
        records.push(record); sizes.push(size); keys.add(key); bytes += size;
        while (records.length > 1 && (records.length > maxEntries || bytes > maxBytes)) {
          keys.delete(keyOf(records.shift()!)); bytes -= sizes.shift()!;
        }
        changed = true;
      }
      return changed;
    },
    snapshot: () => records.slice(),
    clear() { records.length = sizes.length = 0; keys.clear(); bytes = 0; },
    stats: () => ({ entries: records.length, bytes }),
  };
}
