// 设置与环境标志类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import { defaultSettings } from "../lib/settings";
import type { AppUpdateStatus, ApprovalMode, ProviderSettings, SettingsTab } from "../types";

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T): T =>
  typeof value === "function" ? (value as (p: T) => T)(previous) : value;

export interface SettingsState {
  settings: ProviderSettings;
  setSettings: (value: Updater<ProviderSettings>) => void;
  settingsTab: SettingsTab;
  setSettingsTab: (value: Updater<SettingsTab>) => void;
  appUpdate: AppUpdateStatus;
  setAppUpdate: (value: Updater<AppUpdateStatus>) => void;
  approvalMode: ApprovalMode;
  setApprovalMode: (value: Updater<ApprovalMode>) => void;
  platform: string;
  setPlatform: (value: Updater<string>) => void;
  windowMaximized: boolean;
  setWindowMaximized: (value: Updater<boolean>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  setSettings: (value) => set((s) => ({ settings: resolve(value, s.settings) })),
  settingsTab: "model",
  setSettingsTab: (value) => set((s) => ({ settingsTab: resolve(value, s.settingsTab) })),
  appUpdate: { state: "idle", currentVersion: "" },
  setAppUpdate: (value) => set((s) => ({ appUpdate: resolve(value, s.appUpdate) })),
  approvalMode: "reviewer",
  setApprovalMode: (value) => set((s) => ({ approvalMode: resolve(value, s.approvalMode) })),
  platform: window.dyworker?.platform || "",
  setPlatform: (value) => set((s) => ({ platform: resolve(value, s.platform) })),
  windowMaximized: false,
  setWindowMaximized: (value) => set((s) => ({ windowMaximized: resolve(value, s.windowMaximized) })),
}));
