// 收件箱 / 系统消息 / 导入记录 / 全权访问对话框类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import type { ImportedHistoryEntry, InboxItem } from "../types";

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T): T =>
  typeof value === "function" ? (value as (p: T) => T)(previous) : value;

export interface InboxState {
  inboxItems: InboxItem[];
  setInboxItems: (value: Updater<InboxItem[]>) => void;
  inboxOpen: boolean;
  setInboxOpen: (value: Updater<boolean>) => void;
  // 收件箱分类页签（任务待办 / 系统消息）与系统消息未读、通知点击定位
  inboxTab: "inbox" | "messages";
  setInboxTab: (value: Updater<"inbox" | "messages">) => void;
  systemMessageFocusId: string;
  setSystemMessageFocusId: (value: Updater<string>) => void;
  systemMessagesUnread: number;
  setSystemMessagesUnread: (value: Updater<number>) => void;
  // 已导入的浏览记录：地址栏输入联想
  importedHistory: ImportedHistoryEntry[];
  setImportedHistory: (value: Updater<ImportedHistoryEntry[]>) => void;
  fullAccessDialogOpen: boolean;
  setFullAccessDialogOpen: (value: Updater<boolean>) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  inboxItems: [],
  setInboxItems: (value) => set((s) => ({ inboxItems: resolve(value, s.inboxItems) })),
  inboxOpen: false,
  setInboxOpen: (value) => set((s) => ({ inboxOpen: resolve(value, s.inboxOpen) })),
  inboxTab: "inbox",
  setInboxTab: (value) => set((s) => ({ inboxTab: resolve(value, s.inboxTab) })),
  systemMessageFocusId: "",
  setSystemMessageFocusId: (value) => set((s) => ({ systemMessageFocusId: resolve(value, s.systemMessageFocusId) })),
  systemMessagesUnread: 0,
  setSystemMessagesUnread: (value) => set((s) => ({ systemMessagesUnread: resolve(value, s.systemMessagesUnread) })),
  importedHistory: [],
  setImportedHistory: (value) => set((s) => ({ importedHistory: resolve(value, s.importedHistory) })),
  fullAccessDialogOpen: false,
  setFullAccessDialogOpen: (value) => set((s) => ({ fullAccessDialogOpen: resolve(value, s.fullAccessDialogOpen) })),
}));
