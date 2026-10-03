// 宿主事件契约：宿主核心与策略插件之间的扩展点（cordis 声明合并）。
// 事件分发模式与语义：
//   tools/pre-execute — waterfall。参数 (name, args, current, next)：
//     监听器返回 { action: "block" | "require_approval", message? } 做出决定，
//     或调用 next() 交给后续监听器；无人决定时返回 null（放行，走默认审批策略）。
//     该事件只能追加限制，不能放行已被用户/工作区钩子规则阻止的操作。
import type {} from "@deepseek-ai/cordis";

export interface PreToolDecision {
  action?: "block" | "require_approval";
  message?: string;
}

declare module "@deepseek-ai/cordis" {
  interface Events {
    "tools/pre-execute"(
      name: string,
      args: any,
      current: PreToolDecision | null,
      next: () => PreToolDecision | null,
    ): PreToolDecision | null | Promise<PreToolDecision | null>;
  }
}
