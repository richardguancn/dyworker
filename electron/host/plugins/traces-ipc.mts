// IPC 域插件：运行痕迹（traces:*）。
// 痕迹是按会话拆分的 jsonl 文件，读取逻辑留在本插件；平台路径与 fs 由壳层注入。
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
          const content = await fs.readFile(file, "utf8");
          return { ok: true, count: content.split("\n").filter(Boolean).length, size: stat.size, updatedAt: stat.mtime.toISOString() };
        } catch {
          return { ok: true, count: 0, size: 0, updatedAt: "" };
        }
      });

      trustedHandle("traces:read", async (_event, payload) => {
        const file = traceFile(payload?.sessionId);
        const offset = Math.max(0, Number(payload?.offset) || 0);
        const limit = Math.min(Math.max(1, Number(payload?.limit) || 500), 2000);
        try {
          const content = await fs.readFile(file, "utf8");
          const lines = content.split("\n").filter(Boolean);
          const records = lines.slice(offset, offset + limit)
            .map((line) => { try { return JSON.parse(line); } catch { return null; } })
            .filter(Boolean);
          return { ok: true, records, total: lines.length, offset };
        } catch {
          return { ok: true, records: [], total: 0, offset };
        }
      });
    },
  };
}
