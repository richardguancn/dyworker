// 收件箱 / 系统消息 / 导入记录 / 全权访问对话框类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import { updateField, type Updater } from "./updateField.ts";
import type { ImportedHistoryEntry, InboxItem } from "../types";

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
  setInboxItems: (value) => set((s) => updateField(s, "inboxItems", value)),
  inboxOpen: false,
  setInboxOpen: (value) => set((s) => updateField(s, "inboxOpen", value)),
  inboxTab: "inbox",
  setInboxTab: (value) => set((s) => updateField(s, "inboxTab", value)),
  systemMessageFocusId: "",
  setSystemMessageFocusId: (value) => set((s) => updateField(s, "systemMessageFocusId", value)),
  systemMessagesUnread: 0,
  setSystemMessagesUnread: (value) => set((s) => updateField(s, "systemMessagesUnread", value)),
  importedHistory: [],
  setImportedHistory: (value) => set((s) => updateField(s, "importedHistory", value)),
  fullAccessDialogOpen: false,
  setFullAccessDialogOpen: (value) => set((s) => updateField(s, "fullAccessDialogOpen", value)),
}));
