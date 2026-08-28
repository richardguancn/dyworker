// 审计日志（借鉴 openworker coworker/audit.py）：所有有副作用的工具调用，
// 其审批决策与执行结果追加写入本地 JSONL 文件，可供纪检/保密检查追溯。
// 本文件不依赖 electron，方便用 node --test 直接测试。
import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_SUMMARY = 200;
const MAX_DETAIL = 500;

function clipText(value, limit) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function createAuditLog({ filePath, maxBytes = 5 * 1024 * 1024 } = {}) {
  let writes = Promise.resolve();
  let sinceRotateCheck = 0;

  async function rotateIfNeeded() {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size <= maxBytes) return;
      const content = await fs.readFile(filePath, "utf8");
      // 保留较新的一半：从中间位置找下一个换行，避免截断 JSON 行
      const cut = content.indexOf("\n", Math.floor(content.length / 2));
      const kept = cut === -1 ? "" : content.slice(cut + 1);
      const temporary = `${filePath}.tmp`;
      await fs.writeFile(temporary, kept, "utf8");
      await fs.rename(temporary, filePath);
    } catch {
      // 文件不存在或不可写时静默降级——审计绝不能影响正常任务
    }
  }

  return {
    // entry: { time?, sessionId?, tool, summary?, riskClass?, decision, approvalMode?, detail?, model? }
    // decision ∈ auto-allowed | rule-allowed | approved | denied | blocked | executed | failed
    record(entry) {
      const sanitized = {
        time: entry?.time || new Date().toISOString(),
        ...(entry?.sessionId ? { sessionId: String(entry.sessionId) } : {}),
        tool: String(entry?.tool || ""),
        ...(entry?.riskClass ? { riskClass: String(entry.riskClass) } : {}),
        decision: String(entry?.decision || ""),
        ...(entry?.approvalMode ? { approvalMode: String(entry.approvalMode) } : {}),
        ...(entry?.model ? { model: String(entry.model).slice(0, 120) } : {}),
        ...(entry?.summary ? { summary: clipText(entry.summary, MAX_SUMMARY) } : {}),
        ...(entry?.detail ? { detail: clipText(entry.detail, MAX_DETAIL) } : {}),
      };
      writes = writes.then(async () => {
        try {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.appendFile(filePath, `${JSON.stringify(sanitized)}\n`, "utf8");
          sinceRotateCheck += 1;
          if (sinceRotateCheck >= 50) {
            sinceRotateCheck = 0;
            await rotateIfNeeded();
          }
        } catch {
          // 同上：静默降级
        }
      });
      return writes;
    },
  };
}
