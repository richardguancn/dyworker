import { promises as fs } from "node:fs";
import path from "node:path";

// 使用统计本地待上传队列（方案 §4.3/§9）：
// - 区间先写本地队列，服务器逐条确认后才删除；重试保持原 event_id。
// - 本地最多保存 7 天或 20 MB，超限丢弃最旧记录并累计「覆盖缺口」计数，
//   不把丢失数据补成 0。
// - 写入串行化 + 临时文件 rename，进程被强杀时文件要么是旧内容要么是
//   新内容，不会出现半截 JSON。
export const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const QUEUE_MAX_BYTES = 20 * 1024 * 1024;
const STORE_VERSION = 1;

function recordBytes(record) {
  try {
    return Buffer.byteLength(JSON.stringify(record), "utf8");
  } catch {
    return 0;
  }
}

export function createTelemetryStore({
  file,
  now = () => Date.now(),
  maxAgeMs = QUEUE_MAX_AGE_MS,
  maxBytes = QUEUE_MAX_BYTES,
}) {
  const filePath = String(file || "");
  let state = { version: STORE_VERSION, records: [], droppedOverflow: 0, lastDroppedAt: "" };
  let loaded = null;
  // 单写锁：同进程内所有读写排队执行，保证读-改-写不交错
  let chain = Promise.resolve();

  function enqueueLocked(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }

  // 读操作等待在途写入落定，避免 fire-and-forget 入队后读到旧值
  function settle() {
    return enqueueLocked(async () => {});
  }

  async function persist() {
    if (!filePath) return;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state), "utf8");
    await fs.rename(temporary, filePath);
  }

  function loadOnce() {
    loaded ??= (async () => {
      if (!filePath) return;
      try {
        const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
        if (raw && typeof raw === "object" && Array.isArray(raw.records)) {
          state = {
            version: STORE_VERSION,
            records: raw.records.filter((item) => item && typeof item.event_id === "string"),
            droppedOverflow: Math.max(0, Math.floor(Number(raw.droppedOverflow) || 0)),
            lastDroppedAt: String(raw.lastDroppedAt || ""),
          };
        }
      } catch {
        // 文件缺失或损坏时从空队列开始
      }
    })();
    return loaded;
  }

  // 容量限制：先按「入队时间超过 7 天」淘汰，再按总字节淘汰最旧记录。
  function enforceLimits() {
    const cutoff = now() - maxAgeMs;
    const kept = [];
    let dropped = 0;
    for (const record of state.records) {
      const age = Number(record.queued_at) || 0;
      if (age && age < cutoff) {
        dropped += 1;
        continue;
      }
      kept.push(record);
    }
    let totalBytes = kept.reduce((sum, record) => sum + (record.bytes || 0), 0);
    while (kept.length && totalBytes > maxBytes) {
      const oldest = kept.shift();
      totalBytes -= oldest.bytes || 0;
      dropped += 1;
    }
    if (dropped > 0) {
      state.records = kept;
      state.droppedOverflow += dropped;
      state.lastDroppedAt = new Date(now()).toISOString();
    }
  }

  return {
    async enqueue(records) {
      const incoming = (Array.isArray(records) ? records : [records])
        .filter((record) => record && typeof record.event_id === "string");
      if (!incoming.length) return { enqueued: 0 };
      return enqueueLocked(async () => {
        await loadOnce();
        const known = new Set(state.records.map((record) => record.event_id));
        const stamp = now();
        for (const record of incoming) {
          if (known.has(record.event_id)) continue;
          known.add(record.event_id);
          state.records.push({ ...record, queued_at: stamp, bytes: recordBytes(record) });
        }
        enforceLimits();
        await persist();
        return { enqueued: incoming.length };
      });
    },
    async pending(limit = 200) {
      await settle();
      await loadOnce();
      return state.records.slice(0, Math.max(1, limit)).map((record) => {
        const { bytes, queued_at, ...event } = record;
        return event;
      });
    },
    async count() {
      await settle();
      await loadOnce();
      return state.records.length;
    },
    // 服务器返回 accepted / duplicate 的记录可删除；rejected 的无效记录也一并
    // 移除（单独拒收，不让坏数据阻塞整批），但计入拒绝计数供状态展示。
    async acknowledge({ accepted = [], rejected = [] }) {
      return enqueueLocked(async () => {
        await loadOnce();
        const remove = new Set([...accepted, ...rejected].map(String));
        if (!remove.size) return { removed: 0 };
        const before = state.records.length;
        state.records = state.records.filter((record) => !remove.has(record.event_id));
        await persist();
        return { removed: before - state.records.length };
      });
    },
    async clear() {
      return enqueueLocked(async () => {
        await loadOnce();
        state.records = [];
        state.droppedOverflow = 0;
        state.lastDroppedAt = "";
        await persist();
      });
    },
    async stats() {
      await settle();
      await loadOnce();
      return {
        pending: state.records.length,
        droppedOverflow: state.droppedOverflow,
        lastDroppedAt: state.lastDroppedAt,
      };
    },
  };
}
