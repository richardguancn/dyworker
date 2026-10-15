// 右侧面板 / 记忆 / 技能 / 计划 / 调试诊断类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import type { DebugLogEntry, ScheduleRecord, SkillRecord, TraceEvent, UsageRecord, WikiMemoryPage, WikiMemoryRow } from "../types";
import type { AuthoringKind } from "../../electron/authoring-skills";
import type { PluginPanelTab } from "../pluginPanelTabs";

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T): T =>
  typeof value === "function" ? (value as (p: T) => T)(previous) : value;

export interface PanelState {
  memories: WikiMemoryPage[];
  setMemories: (value: Updater<WikiMemoryPage[]>) => void;
  memoriesLinting: boolean;
  setMemoriesLinting: (value: Updater<boolean>) => void;
  memoriesLintMessage: string;
  setMemoriesLintMessage: (value: Updater<string>) => void;
  skills: SkillRecord[];
  setSkills: (value: Updater<SkillRecord[]>) => void;
  schedules: ScheduleRecord[];
  setSchedules: (value: Updater<ScheduleRecord[]>) => void;
  usageStats: UsageRecord[] | null;
  setUsageStats: (value: Updater<UsageRecord[] | null>) => void;
  debugLogs: DebugLogEntry[];
  setDebugLogs: (value: Updater<DebugLogEntry[]>) => void;
  traceEvents: TraceEvent[];
  setTraceEvents: (value: Updater<TraceEvent[]>) => void;
  planSeed: { name: string; prompt: string } | null;
  setPlanSeed: (value: Updater<{ name: string; prompt: string } | null>) => void;
  // 「总结为工作模板」：待确认的草稿（非空即打开对话框）
  skillDraft: { name: string; description: string; instructions: string } | null;
  setSkillDraft: (value: Updater<{ name: string; description: string; instructions: string } | null>) => void;
  creationKind: AuthoringKind | null;
  setCreationKind: (value: Updater<AuthoringKind | null>) => void;
  // 设置面板里的手动编辑：正在编辑的记忆行 / 工作模板（非空即打开编辑对话框）
  memoryEdit: WikiMemoryRow | null;
  setMemoryEdit: (value: Updater<WikiMemoryRow | null>) => void;
  skillEdit: SkillRecord | null;
  setSkillEdit: (value: Updater<SkillRecord | null>) => void;
  pluginPanelChoices: PluginPanelTab[];
  setPluginPanelChoices: (value: Updater<PluginPanelTab[]>) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  memories: [],
  setMemories: (value) => set((s) => ({ memories: resolve(value, s.memories) })),
  memoriesLinting: false,
  setMemoriesLinting: (value) => set((s) => ({ memoriesLinting: resolve(value, s.memoriesLinting) })),
  memoriesLintMessage: "",
  setMemoriesLintMessage: (value) => set((s) => ({ memoriesLintMessage: resolve(value, s.memoriesLintMessage) })),
  skills: [],
  setSkills: (value) => set((s) => ({ skills: resolve(value, s.skills) })),
  schedules: [],
  setSchedules: (value) => set((s) => ({ schedules: resolve(value, s.schedules) })),
  usageStats: null,
  setUsageStats: (value) => set((s) => ({ usageStats: resolve(value, s.usageStats) })),
  debugLogs: [],
  setDebugLogs: (value) => set((s) => ({ debugLogs: resolve(value, s.debugLogs) })),
  traceEvents: [],
  setTraceEvents: (value) => set((s) => ({ traceEvents: resolve(value, s.traceEvents) })),
  planSeed: null,
  setPlanSeed: (value) => set((s) => ({ planSeed: resolve(value, s.planSeed) })),
  skillDraft: null,
  setSkillDraft: (value) => set((s) => ({ skillDraft: resolve(value, s.skillDraft) })),
  creationKind: null,
  setCreationKind: (value) => set((s) => ({ creationKind: resolve(value, s.creationKind) })),
  memoryEdit: null,
  setMemoryEdit: (value) => set((s) => ({ memoryEdit: resolve(value, s.memoryEdit) })),
  skillEdit: null,
  setSkillEdit: (value) => set((s) => ({ skillEdit: resolve(value, s.skillEdit) })),
  pluginPanelChoices: [],
  setPluginPanelChoices: (value) => set((s) => ({ pluginPanelChoices: resolve(value, s.pluginPanelChoices) })),
}));
