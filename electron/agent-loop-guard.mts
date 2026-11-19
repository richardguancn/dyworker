import { createHash } from "node:crypto";
import { computerUseAction } from "./computer-use.mts";
import { browserFormHint, browserFormUnavailable, browserInputUnverified } from "./desktop/browser-fill-form.mts";

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
  private browserFailures = new Map<string, number>();
  warning = "";
  pauseReason = "";

  observe(toolCalls: any[], outcomes: any[]): "continue" | "warn" | "pause" {
    this.warning = "";
    this.pauseReason = "";
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
    for (const { name, args, result } of evidence) {
      const app = typeof args === "object" ? (args as { app?: unknown } | null)?.app : undefined;
      if (typeof app !== "string" || typeof result !== "string") continue;
      const action = computerUseAction(name);
      const prefix = `${app}\n`;
      if (result.startsWith("成功\n") && action === "fill_form") {
        for (const key of this.browserFailures.keys()) {
          if (key.startsWith(prefix)) this.browserFailures.delete(key);
        }
      }
      if (!result.startsWith("失败\n")) continue;
      const error = result.slice("失败\n".length);
      let failure = "";
      if (error === browserInputUnverified || error === browserFormHint) failure = "unverified-input";
      if (action === "get_app_state" && error === browserFormUnavailable) failure = "unavailable-form";
      if (action === "fill_form" && /已停止填写/.test(error) && /已核对：无。/.test(error)) failure = error.split("\n")[0];
      if (!failure) continue;
      const key = prefix + failure;
      const repeats = (this.browserFailures.get(key) || 0) + 1;
      this.browserFailures.set(key, repeats);
      if (repeats >= 3) {
        this.pauseReason = "浏览器操作第三次遇到同一障碍，提醒后仍无进展。已保留工作记录。\n" + error;
        return "pause";
      }
      if (repeats === 2) {
        this.warning = "同一浏览器操作再次遇到相同障碍。换观察编号或插入读取不会解决失败。请根据已报告的原因改变做法，或报告当前阻碍。";
        return "warn";
      }
    }
    const signature = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    this.repeats = signature === this.lastSignature ? this.repeats + 1 : 0;
    this.lastSignature = signature;
    if (this.repeats >= 3) return "pause";
    if (this.repeats === 2) return "warn";
    return "continue";
  }
}
