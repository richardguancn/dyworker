import { createHash } from "node:crypto";

// 不比较调用 ID、旁白和耗时：它们变化不能说明任务取得进展。
// 参数先归一化，避免只调整 JSON 空白或键顺序就绕过检测。
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export class AgentLoopGuard {
  private lastSignature = "";
  private repeats = 0;

  observe(toolCalls: any[], outcomes: any[]): "continue" | "warn" | "pause" {
    const evidence = toolCalls.map((call, index) => {
      let args = String(call?.function?.arguments || "{}");
      try { args = canonical(JSON.parse(args)); } catch { /* 非法参数仍按原文比较 */ }
      const outcome = outcomes[index];
      return {
        name: call?.function?.name || "",
        args,
        result: outcome?.message?.content ?? null,
        // 截图文字和路径相同、画面更新时，也算取得了新的观察结果。
        supplemental: (outcome?.supplementalMessages || []).map((message) => message.content),
      };
    });
    const signature = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    this.repeats = signature === this.lastSignature ? this.repeats + 1 : 0;
    this.lastSignature = signature;
    if (this.repeats >= 3) return "pause";
    if (this.repeats === 2) return "warn";
    return "continue";
  }
}
