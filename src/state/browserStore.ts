// 内置浏览器类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import { updateField, type Updater } from "./updateField.ts";
import type { BrowserDownloadRecord } from "../features/browser/browserUtils";
import type { BrowserControlState } from "../types";

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
  setBrowserOpening: (value) => set((s) => updateField(s, "browserOpening", value)),
  browserMoreOpen: false,
  setBrowserMoreOpen: (value) => set((s) => updateField(s, "browserMoreOpen", value)),
  browserSection: null,
  setBrowserSection: (value) => set((s) => updateField(s, "browserSection", value)),
  browserSuggestionsOpen: false,
  setBrowserSuggestionsOpen: (value) => set((s) => updateField(s, "browserSuggestionsOpen", value)),
  browserSuggestionIndex: -1,
  setBrowserSuggestionIndex: (value) => set((s) => updateField(s, "browserSuggestionIndex", value)),
  browserClearing: false,
  setBrowserClearing: (value) => set((s) => updateField(s, "browserClearing", value)),
  importDialogOpen: false,
  setImportDialogOpen: (value) => set((s) => updateField(s, "importDialogOpen", value)),

  browserUrlDraft: null,
  setBrowserUrlDraft: (value) => set((s) => updateField(s, "browserUrlDraft", value)),
  browserFind: null,
  setBrowserFind: (value) => set((s) => updateField(s, "browserFind", value)),
  browserSessionHistory: [],
  setBrowserSessionHistory: (value) => set((s) => updateField(s, "browserSessionHistory", value)),
  browserDownloads: [],
  setBrowserDownloads: (value) => set((s) => updateField(s, "browserDownloads", value)),
  browserPasswordPrompt: null,
  setBrowserPasswordPrompt: (value) => set((s) => updateField(s, "browserPasswordPrompt", value)),
  browserControlState: null,
  setBrowserControlState: (value) => set((s) => updateField(s, "browserControlState", value)),
  browserPasswordsOpen: false,
  setBrowserPasswordsOpen: (value) => set((s) => updateField(s, "browserPasswordsOpen", value)),
  browserClearKinds: { cookies: true, cache: true, siteData: false },
  setBrowserClearKinds: (value) => set((s) => updateField(s, "browserClearKinds", value)),
}));
