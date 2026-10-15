// 视图 / 提示 / 搜索 / 交互浮层类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import type { Attachment, ChatMessage, FileChange } from "../types";
import type { ContextMenuItem } from "../features/annotations/SelectionOverlays";

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T): T =>
  typeof value === "function" ? (value as (p: T) => T)(previous) : value;

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
  setError: (value) => set((s) => ({ error: resolve(value, s.error) })),
  notice: "",
  setNotice: (value) => set((s) => ({ notice: resolve(value, s.notice) })),
  ready: false,
  setReady: (value) => set((s) => ({ ready: resolve(value, s.ready) })),
  hoveredTurnIndex: null,
  setHoveredTurnIndex: (value) => set((s) => ({ hoveredTurnIndex: resolve(value, s.hoveredTurnIndex) })),
  atBottom: true,
  setAtBottom: (value) => set((s) => ({ atBottom: resolve(value, s.atBottom) })),
  collapsedActivities: new Set(),
  setCollapsedActivities: (value) => set((s) => ({ collapsedActivities: resolve(value, s.collapsedActivities) })),
  editingMessage: null,
  setEditingMessage: (value) => set((s) => ({ editingMessage: resolve(value, s.editingMessage) })),
  imagePreview: null,
  setImagePreview: (value) => set((s) => ({ imagePreview: resolve(value, s.imagePreview) })),
  imagePreviewPeers: [],
  setImagePreviewPeers: (value) => set((s) => ({ imagePreviewPeers: resolve(value, s.imagePreviewPeers) })),
  reviewFocusChanges: null,
  setReviewFocusChanges: (value) => set((s) => ({ reviewFocusChanges: resolve(value, s.reviewFocusChanges) })),
  conversationSearchOpen: false,
  setConversationSearchOpen: (value) => set((s) => ({ conversationSearchOpen: resolve(value, s.conversationSearchOpen) })),
  conversationSearchQuery: "",
  setConversationSearchQuery: (value) => set((s) => ({ conversationSearchQuery: resolve(value, s.conversationSearchQuery) })),
  conversationSearchMatchIndex: 0,
  setConversationSearchMatchIndex: (value) => set((s) => ({ conversationSearchMatchIndex: resolve(value, s.conversationSearchMatchIndex) })),
  conversationMatchTotal: 0,
  setConversationMatchTotal: (value) => set((s) => ({ conversationMatchTotal: resolve(value, s.conversationMatchTotal) })),
  queuedRunIds: new Set(),
  setQueuedRunIds: (value) => set((s) => ({ queuedRunIds: resolve(value, s.queuedRunIds) })),
  queueMenuRunId: null,
  setQueueMenuRunId: (value) => set((s) => ({ queueMenuRunId: resolve(value, s.queueMenuRunId) })),
  contextMenu: null,
  setContextMenu: (value) => set((s) => ({ contextMenu: resolve(value, s.contextMenu) })),
  viewportNode: null,
  setViewportNode: (value) => set((s) => ({ viewportNode: resolve(value, s.viewportNode) })),
  composerDockNode: null,
  setComposerDockNode: (value) => set((s) => ({ composerDockNode: resolve(value, s.composerDockNode) })),
}));
