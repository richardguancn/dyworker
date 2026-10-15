// IPC 域插件：运行痕迹（traces:*）。
// 痕迹是按会话拆分的 jsonl 文件，读取逻辑留在本插件；平台路径与 fs 由壳层注入。
import { createInterface } from 'node:readline';

async function scanLines(fs, file, visit) {
  const handle = await fs.open(file, 'r');
  const stream = handle.createReadStream({ autoClose: false });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let index = 0;
    for await (const line of lines) if (line.trim()) visit(line, index++);
  } finally {
    lines.close(); stream.destroy(); await handle.close();
  }
}

export function tracesIpcPlugin(deps) {
  return {
    name: "ipc:traces",
    apply(ctx) {
      const { trustedHandle, app, fs, path, safeTraceSessionId } = deps;
      const traceFile = (sessionId) => path.join(app.getPath("userData"), "traces", `${safeTraceSessionId(sessionId)}.jsonl`);

      trustedHandle("traces:list", async (_event, sessionId) => {
        const file = traceFile(sessionId);
        try {
          const stat = await fs.stat(file);
          let count = 0;
          await scanLines(fs, file, () => { count++; });
          return { ok: true, count, size: stat.size, updatedAt: stat.mtime.toISOString() };
        } catch {
          return { ok: true, count: 0, size: 0, updatedAt: "" };
        }
      });

      trustedHandle("traces:read", async (_event, payload) => {
        const file = traceFile(payload?.sessionId);
        const offset = Math.max(0, Number(payload?.offset) || 0);
        const limit = Math.min(Math.max(1, Number(payload?.limit) || 500), 2000);
        try {
          const records = [];
          let total = 0;
          let nextOffset = offset;
          await scanLines(fs, file, (line, index) => {
            total++;
            if (index < offset || index >= offset + limit) return;
            nextOffset = index + 1;
            try { const record = JSON.parse(line); if (record) records.push(record); } catch { /* 跳过中断写入的坏行 */ }
          });
          return { ok: true, records, total, offset, nextOffset };
        } catch {
          return { ok: true, records: [], total: 0, offset };
        }
      });
    },
  };
}
