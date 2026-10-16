// 设置与环境标志类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import { updateField, type Updater } from "./updateField.ts";
import { defaultSettings } from "../lib/settings.ts";
import type { AppUpdateStatus, ApprovalMode, ProviderSettings, SettingsTab } from "../types";

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
  setSettings: (value) => set((s) => updateField(s, "settings", value)),
  settingsTab: "model",
  setSettingsTab: (value) => set((s) => updateField(s, "settingsTab", value)),
  appUpdate: { state: "idle", currentVersion: "" },
  setAppUpdate: (value) => set((s) => updateField(s, "appUpdate", value)),
  approvalMode: "reviewer",
  setApprovalMode: (value) => set((s) => updateField(s, "approvalMode", value)),
  platform: window.dyworker?.platform || "",
  setPlatform: (value) => set((s) => updateField(s, "platform", value)),
  windowMaximized: false,
  setWindowMaximized: (value) => set((s) => updateField(s, "windowMaximized", value)),
}));
