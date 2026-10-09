// 上下文插件 · 客户端半边（源码；构建产物是同目录的 ../client.js）
//
// 只负责"注册到哪些位置"，界面实现都在 ./context-view.tsx：
//   conversation.view        → 「上下文」标签（KPI / Token / 耗时 / 当前上下文 / 浏览器 / 事件 / 文件 / Agent 网络 / 趋势）
//   sidebar.right.pane.tab   → 「上下文仪表盘」（跨会话用量与会话卡片）
// 右侧面板**不再**登记「上下文」紧凑面板：它和会话区标签内容重复，
// 只保留仪表盘（会话区放不下的跨会话视图）。
// 数据来自插件自己的主机路由（3 秒轮询；宿主没有给插件推送通道）。

import { ContextDashboard, ContextView } from "./context-view";

export default {
  name: "dyworker-context-client",
  inject: ["slots", "sessions"],
  apply(ctx: any) {
    const injectSession = (sessionId: string) => ({
      session: ctx.sessions.binding(sessionId)?.session ?? null,
    });
    ctx.slots.inject("conversation.view", () => ctx.slots.register({
      name: "conversation.view",
      id: "context",
      key: "context",
      order: 30,
      label: () => "上下文",
      inject: injectSession,
    }, ContextView));
    // 跨会话仪表盘：点会话卡片走 uiConversation.openSession（宿主桥接到 selectSession）
    ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
      name: "sidebar.right.pane.tab",
      id: "context-dashboard",
      key: "context-dashboard",
      order: 40,
      label: () => "上下文仪表盘",
      inject: () => ({
        openSession: (sessionId: string) => ctx.uiConversation?.openSession?.(sessionId),
      }),
    }, ContextDashboard));
  },
};
