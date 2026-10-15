// 内置浏览器类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import type { BrowserDownloadRecord } from "../features/browser/browserUtils";
import type { BrowserControlState } from "../types";

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T): T =>
  typeof value === "function" ? (value as (p: T) => T)(previous) : value;

export interface BrowserState {
  browserOpening: boolean;
  setBrowserOpening: (value: Updater<boolean>) => void;
  browserMoreOpen: boolean;
  setBrowserMoreOpen: (value: Updater<boolean>) => void;
  browserSection: "history" | "downloads" | "clear" | null;
  setBrowserSection: (value: Updater<"history" | "downloads" | "clear" | null>) => void;
  browserSuggestionsOpen: boolean;
  setBrowserSuggestionsOpen: (value: Updater<boolean>) => void;
  browserSuggestionIndex: number;
  setBrowserSuggestionIndex: (value: Updater<number>) => void;
  browserClearing: boolean;
  setBrowserClearing: (value: Updater<boolean>) => void;
  importDialogOpen: boolean;
  setImportDialogOpen: (value: Updater<boolean>) => void;

  browserUrlDraft: { tabId: string; value: string } | null;
  setBrowserUrlDraft: (value: Updater<{ tabId: string; value: string } | null>) => void;
  browserFind: { tabId: string; text: string; matches: number; active: number } | null;
  setBrowserFind: (value: Updater<{ tabId: string; text: string; matches: number; active: number } | null>) => void;
  browserSessionHistory: Array<{ url: string; title: string; at: number }>;
  setBrowserSessionHistory: (value: Updater<Array<{ url: string; title: string; at: number }>>) => void;
  browserDownloads: BrowserDownloadRecord[];
  setBrowserDownloads: (value: Updater<BrowserDownloadRecord[]>) => void;
  browserPasswordPrompt: { tabId: string; origin: string; username: string; password: string } | null;
  setBrowserPasswordPrompt: (value: Updater<{ tabId: string; origin: string; username: string; password: string } | null>) => void;
  browserControlState: BrowserControlState | null;
  setBrowserControlState: (value: Updater<BrowserControlState | null>) => void;
  browserPasswordsOpen: boolean;
  setBrowserPasswordsOpen: (value: Updater<boolean>) => void;
  browserClearKinds: { cookies: boolean; cache: boolean; siteData: boolean };
  setBrowserClearKinds: (value: Updater<{ cookies: boolean; cache: boolean; siteData: boolean }>) => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  browserOpening: false,
  setBrowserOpening: (value) => set((s) => ({ browserOpening: resolve(value, s.browserOpening) })),
  browserMoreOpen: false,
  setBrowserMoreOpen: (value) => set((s) => ({ browserMoreOpen: resolve(value, s.browserMoreOpen) })),
  browserSection: null,
  setBrowserSection: (value) => set((s) => ({ browserSection: resolve(value, s.browserSection) })),
  browserSuggestionsOpen: false,
  setBrowserSuggestionsOpen: (value) => set((s) => ({ browserSuggestionsOpen: resolve(value, s.browserSuggestionsOpen) })),
  browserSuggestionIndex: -1,
  setBrowserSuggestionIndex: (value) => set((s) => ({ browserSuggestionIndex: resolve(value, s.browserSuggestionIndex) })),
  browserClearing: false,
  setBrowserClearing: (value) => set((s) => ({ browserClearing: resolve(value, s.browserClearing) })),
  importDialogOpen: false,
  setImportDialogOpen: (value) => set((s) => ({ importDialogOpen: resolve(value, s.importDialogOpen) })),

  browserUrlDraft: null,
  setBrowserUrlDraft: (value) => set((s) => ({ browserUrlDraft: resolve(value, s.browserUrlDraft) })),
  browserFind: null,
  setBrowserFind: (value) => set((s) => ({ browserFind: resolve(value, s.browserFind) })),
  browserSessionHistory: [],
  setBrowserSessionHistory: (value) => set((s) => ({ browserSessionHistory: resolve(value, s.browserSessionHistory) })),
  browserDownloads: [],
  setBrowserDownloads: (value) => set((s) => ({ browserDownloads: resolve(value, s.browserDownloads) })),
  browserPasswordPrompt: null,
  setBrowserPasswordPrompt: (value) => set((s) => ({ browserPasswordPrompt: resolve(value, s.browserPasswordPrompt) })),
  browserControlState: null,
  setBrowserControlState: (value) => set((s) => ({ browserControlState: resolve(value, s.browserControlState) })),
  browserPasswordsOpen: false,
  setBrowserPasswordsOpen: (value) => set((s) => ({ browserPasswordsOpen: resolve(value, s.browserPasswordsOpen) })),
  browserClearKinds: { cookies: true, cache: true, siteData: false },
  setBrowserClearKinds: (value) => set((s) => ({ browserClearKinds: resolve(value, s.browserClearKinds) })),
}));
