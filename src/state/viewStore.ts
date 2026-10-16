// 视图 / 提示 / 搜索 / 交互浮层类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import { updateField, type Updater } from "./updateField.ts";
import type { Attachment, ChatMessage, FileChange } from "../types";
import type { ContextMenuItem } from "../features/annotations/SelectionOverlays";

export interface ViewState {
  error: string;
  setError: (value: Updater<string>) => void;
  notice: string;
  setNotice: (value: Updater<string>) => void;
  ready: boolean;
  setReady: (value: Updater<boolean>) => void;
  hoveredTurnIndex: number | null;
  setHoveredTurnIndex: (value: Updater<number | null>) => void;
  atBottom: boolean;
  setAtBottom: (value: Updater<boolean>) => void;
  collapsedActivities: Set<string>;
  setCollapsedActivities: (value: Updater<Set<string>>) => void;
  editingMessage: { sessionId: string; messageIndex: number; original: ChatMessage } | null;
  setEditingMessage: (value: Updater<{ sessionId: string; messageIndex: number; original: ChatMessage } | null>) => void;
  imagePreview: { url: string; name: string; path?: string } | null;
  setImagePreview: (value: Updater<{ url: string; name: string; path?: string } | null>) => void;
  // 同一条消息的全部图片附件：预览灯箱用它在多张图之间左右切换
  imagePreviewPeers: Array<Pick<Attachment, "path" | "previewUrl" | "name">>;
  setImagePreviewPeers: (value: Updater<Array<Pick<Attachment, "path" | "previewUrl" | "name">>>) => void;
  // 「查看更改」点开的具体那条消息的改动（非 Git 工作区时作为审阅面板的数据源）
  reviewFocusChanges: FileChange[] | null;
  setReviewFocusChanges: (value: Updater<FileChange[] | null>) => void;
  // 会话内搜索：在当前会话的消息 DOM 里高亮命中并按出现位置跳转（⌘F / Ctrl+F 打开）
  conversationSearchOpen: boolean;
  setConversationSearchOpen: (value: Updater<boolean>) => void;
  conversationSearchQuery: string;
  setConversationSearchQuery: (value: Updater<string>) => void;
  conversationSearchMatchIndex: number;
  setConversationSearchMatchIndex: (value: Updater<number>) => void;
  conversationMatchTotal: number;
  setConversationMatchTotal: (value: Updater<number>) => void;
  // 排队中的任务运行标识：同会话内串行执行，排队消息未执行前允许编辑或取消
  queuedRunIds: Set<string>;
  setQueuedRunIds: (value: Updater<Set<string>>) => void;
  // 队列卡片里 ⋯ 菜单当前挂在哪条排队消息上
  queueMenuRunId: string | null;
  setQueueMenuRunId: (value: Updater<string | null>) => void;
  // 右键菜单：消息文本选中复制、输入框复制/剪切/粘贴
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  setContextMenu: (value: Updater<{ x: number; y: number; items: ContextMenuItem[] } | null>) => void;
  viewportNode: HTMLDivElement | null;
  setViewportNode: (value: Updater<HTMLDivElement | null>) => void;
  composerDockNode: HTMLDivElement | null;
  setComposerDockNode: (value: Updater<HTMLDivElement | null>) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  error: "",
  setError: (value) => set((s) => updateField(s, "error", value)),
  notice: "",
  setNotice: (value) => set((s) => updateField(s, "notice", value)),
  ready: false,
  setReady: (value) => set((s) => updateField(s, "ready", value)),
  hoveredTurnIndex: null,
  setHoveredTurnIndex: (value) => set((s) => updateField(s, "hoveredTurnIndex", value)),
  atBottom: true,
  setAtBottom: (value) => set((s) => updateField(s, "atBottom", value)),
  collapsedActivities: new Set(),
  setCollapsedActivities: (value) => set((s) => updateField(s, "collapsedActivities", value)),
  editingMessage: null,
  setEditingMessage: (value) => set((s) => updateField(s, "editingMessage", value)),
  imagePreview: null,
  setImagePreview: (value) => set((s) => updateField(s, "imagePreview", value)),
  imagePreviewPeers: [],
  setImagePreviewPeers: (value) => set((s) => updateField(s, "imagePreviewPeers", value)),
  reviewFocusChanges: null,
  setReviewFocusChanges: (value) => set((s) => updateField(s, "reviewFocusChanges", value)),
  conversationSearchOpen: false,
  setConversationSearchOpen: (value) => set((s) => updateField(s, "conversationSearchOpen", value)),
  conversationSearchQuery: "",
  setConversationSearchQuery: (value) => set((s) => updateField(s, "conversationSearchQuery", value)),
  conversationSearchMatchIndex: 0,
  setConversationSearchMatchIndex: (value) => set((s) => updateField(s, "conversationSearchMatchIndex", value)),
  conversationMatchTotal: 0,
  setConversationMatchTotal: (value) => set((s) => updateField(s, "conversationMatchTotal", value)),
  queuedRunIds: new Set(),
  setQueuedRunIds: (value) => set((s) => updateField(s, "queuedRunIds", value)),
  queueMenuRunId: null,
  setQueueMenuRunId: (value) => set((s) => updateField(s, "queueMenuRunId", value)),
  contextMenu: null,
  setContextMenu: (value) => set((s) => updateField(s, "contextMenu", value)),
  viewportNode: null,
  setViewportNode: (value) => set((s) => updateField(s, "viewportNode", value)),
  composerDockNode: null,
  setComposerDockNode: (value) => set((s) => updateField(s, "composerDockNode", value)),
}));
