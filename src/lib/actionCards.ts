// 个性化推荐卡片（action-card）解析与决策回执工具（纯函数，无 DOM/Electron 依赖）。
import type { ActionCardDecision, ActionCardProposal, ActionCardSlot } from "../types";

const VALID_SLOTS = new Set<string>(["sidebar.right.pane.tab", "workspace.page", "conversation.view"]);

export type ParsedActionCard =
  | { status: "incomplete" }
  | { status: "invalid"; error: string }
  | { status: "ok"; card: ActionCardProposal };

function normalizeSlugId(raw: string, title: string): string {
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned) return cleaned;
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
  }
  return `card-${Math.abs(hash).toString(36)}`;
}

/** 解析 Markdown fenced `action-card` 代码块内容 */
export function parseActionCardCode(rawCode: string): ParsedActionCard {
  const trimmed = String(rawCode || "").trim();
  if (!trimmed) return { status: "incomplete" };
  if (!trimmed.startsWith("{")) {
    return { status: "invalid", error: "action-card 内容必须是 JSON 对象" };
  }
  // 流式阶段若末尾还未闭合 `}`，优先视作生成中
  if (!trimmed.endsWith("}")) {
    return { status: "incomplete" };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 若花括号开闭数量不平衡，通常是流式仍在进行中
    const opens = (trimmed.match(/\{/g) || []).length;
    const closes = (trimmed.match(/\}/g) || []).length;
    if (opens > closes) return { status: "incomplete" };
    return { status: "invalid", error: "action-card JSON 格式无效" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", error: "action-card 必须是对象" };
  }
  const title = String(parsed.title || "").trim();
  const prompt = String(parsed.prompt || parsed.description || "").trim();
  const summary = String(parsed.summary || "").trim();
  if (!title || !prompt) {
    return { status: "invalid", error: "action-card 缺少必填字段 title 或 prompt" };
  }
  const rawSlot = String(parsed.recommendedSlot || "").trim();
  const recommendedSlot: ActionCardSlot = VALID_SLOTS.has(rawSlot)
    ? (rawSlot as ActionCardSlot)
    : "workspace.page";
  return {
    status: "ok",
    card: {
      id: normalizeSlugId(String(parsed.id || ""), title),
      title,
      summary: summary || title,
      recommendedSlot,
      slotReason: String(parsed.slotReason || "").trim() || undefined,
      prompt,
    },
  };
}

const SLOT_LABELS: Record<string, string> = {
  "workspace.page": "独立页面",
  "sidebar.right.pane.tab": "右侧面板",
  "conversation.view": "会话视图",
  custom: "自定义位置",
};

/** 汇总尚未同步给模型的卡片用户决策（created / undone / dismissed）并标记 reportedToModel=true */
export function formatUnreportedCardDecisions(decisions?: Record<string, ActionCardDecision>): {
  receiptText: string;
  updatedDecisions: Record<string, ActionCardDecision> | undefined;
} {
  if (!decisions || typeof decisions !== "object") {
    return { receiptText: "", updatedDecisions: decisions };
  }
  const pendingEntries = Object.entries(decisions).filter(([, item]) =>
    item && item.reportedToModel === false && ["created", "undone", "dismissed"].includes(item.status));

  if (!pendingEntries.length) {
    return { receiptText: "", updatedDecisions: decisions };
  }

  const lines = pendingEntries.map(([cardId, item]) => {
    const label = item.pluginName || item.pluginId || cardId;
    const slotText = SLOT_LABELS[item.chosenSlot] || item.customPlacement || item.chosenSlot;
    if (item.status === "created") {
      return `- 卡片「${label}」：用户已点击创建并安装（位置：${slotText}${item.pluginDir ? `，目录：${item.pluginDir}` : ""}）`;
    }
    if (item.status === "undone") {
      return `- 卡片「${label}」：用户已撤销卸载（源码已保留${item.pluginDir ? `于 ${item.pluginDir}` : ""}）`;
    }
    return `- 卡片「${label}」：用户已选择暂不需要（已忽略推荐）`;
  });

  const updatedDecisions: Record<string, ActionCardDecision> = { ...decisions };
  for (const [cardId, item] of pendingEntries) {
    updatedDecisions[cardId] = { ...item, reportedToModel: true };
  }

  return {
    receiptText: `\n\n[个性化推荐卡片状态同步]\n${lines.join("\n")}`,
    updatedDecisions,
  };
}
