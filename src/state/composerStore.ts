// 输入区 / 语音 / 标注类 state 的 zustand store。
// 从 App.tsx 的 useState 逐字段搬来，字段名与同名 setter 保持不变，
// 使用点一次解构即可继续复用原有变量名。
import { create } from "zustand";
import { updateField, type Updater } from "./updateField.ts";
import type { Attachment, MessageAnnotation, SkillRecord } from "../types";
import type { AnnotationMarker } from "../annotations";
import type { RegisteredInputCandidate } from "../pluginRuntime/inputTriggers";

// 输入框长粘贴折叠块：超过阈值的大段粘贴文本不直接灌进输入框，
// 折叠成块随消息一起发送（对照 Codex 的长粘贴折叠呈现）
export interface ComposerPasteBlock {
  id: string;
  text: string;
}

export interface ComposerState {
  composer: string;
  setComposer: (value: Updater<string>) => void;
  composerPastes: ComposerPasteBlock[];
  setComposerPastes: (value: Updater<ComposerPasteBlock[]>) => void;
  expandedPasteId: string;
  setExpandedPasteId: (value: Updater<string>) => void;

  // 引用注释：会话内容里选中文字添加的注释，随消息一起发送
  annotations: MessageAnnotation[];
  setAnnotations: (value: Updater<MessageAnnotation[]>) => void;
  // 选区浮动条：选中会话内容后弹出的「添加到对话 / 侧边聊天」条
  selectionQuote: { text: string; x: number; y: number } | null;
  setSelectionQuote: (value: Updater<{ text: string; x: number; y: number } | null>) => void;
  // 评论编辑卡：固定定位锚点 + 目标注释 id，编辑内容用卡片局部 state
  annotationEditor: { id: string; x: number; y: number } | null;
  setAnnotationEditor: (value: Updater<{ id: string; x: number; y: number } | null>) => void;
  // composer 注释 chip 的 hover 弹层开关
  annotationListOpen: boolean;
  setAnnotationListOpen: (value: Updater<boolean>) => void;
  // 注释定位标记：composer 待发送注释与已发送消息里的注释，都在引用文本起点上方放编号小气泡
  annotationMarkers: AnnotationMarker[];
  setAnnotationMarkers: (value: Updater<AnnotationMarker[]>) => void;

  // 侧边聊天预填：nonce 变化时把 text 填入侧边聊天草稿
  sideChatSeed: { text: string; nonce: number } | null;
  setSideChatSeed: (value: Updater<{ text: string; nonce: number } | null>) => void;
  attachments: Attachment[];
  setAttachments: (value: Updater<Attachment[]>) => void;
  composerDragActive: boolean;
  setComposerDragActive: (value: Updater<boolean>) => void;
  voiceState: "idle" | "recording" | "transcribing";
  setVoiceState: (value: Updater<"idle" | "recording" | "transcribing">) => void;

  // 模型菜单里「此密钥可用的模型」段：菜单打开时按 endpoint+key 拉一次 /models 并缓存
  composerModels: Array<{ id: string; contextLimit?: number }> | null;
  setComposerModels: (value: Updater<Array<{ id: string; contextLimit?: number }> | null>) => void;
  composerModelsLoading: boolean;
  setComposerModelsLoading: (value: Updater<boolean>) => void;

  mentionMenu: { kind: "slash" | "at"; query: string; start: number; end?: number; programmatic?: boolean } | null;
  setMentionMenu: (value: Updater<{ kind: "slash" | "at"; query: string; start: number; end?: number; programmatic?: boolean } | null>) => void;
  mentionIndex: number;
  setMentionIndex: (value: Updater<number>) => void;
  mentionSkills: SkillRecord[];
  setMentionSkills: (value: Updater<SkillRecord[]>) => void;
  pluginInputCandidates: RegisteredInputCandidate[];
  setPluginInputCandidates: (value: Updater<RegisteredInputCandidate[]>) => void;
  pluginInputRevision: number;
  setPluginInputRevision: (value: Updater<number>) => void;
  activeSkills: SkillRecord[];
  setActiveSkills: (value: Updater<SkillRecord[]>) => void;

  // 会话内朗读（助手回复转语音播放）：与渠道语音发送共用同一套 TTS 设置
  speakingMessageKey: string | null;
  setSpeakingMessageKey: (value: Updater<string | null>) => void;
  speakingLoadingKey: string | null;
  setSpeakingLoadingKey: (value: Updater<string | null>) => void;
  // 播放用户语音附件（QQ/微信渠道语音）
  playingVoicePath: string | null;
  setPlayingVoicePath: (value: Updater<string | null>) => void;
  voiceLoadingPath: string | null;
  setVoiceLoadingPath: (value: Updater<string | null>) => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  composer: "",
  setComposer: (value) => set((s) => updateField(s, "composer", value)),
  composerPastes: [],
  setComposerPastes: (value) => set((s) => updateField(s, "composerPastes", value)),
  expandedPasteId: "",
  setExpandedPasteId: (value) => set((s) => updateField(s, "expandedPasteId", value)),

  annotations: [],
  setAnnotations: (value) => set((s) => updateField(s, "annotations", value)),
  selectionQuote: null,
  setSelectionQuote: (value) => set((s) => updateField(s, "selectionQuote", value)),
  annotationEditor: null,
  setAnnotationEditor: (value) => set((s) => updateField(s, "annotationEditor", value)),
  annotationListOpen: false,
  setAnnotationListOpen: (value) => set((s) => updateField(s, "annotationListOpen", value)),
  annotationMarkers: [],
  setAnnotationMarkers: (value) => set((s) => updateField(s, "annotationMarkers", value)),

  sideChatSeed: null,
  setSideChatSeed: (value) => set((s) => updateField(s, "sideChatSeed", value)),
  attachments: [],
  setAttachments: (value) => set((s) => updateField(s, "attachments", value)),
  composerDragActive: false,
  setComposerDragActive: (value) => set((s) => updateField(s, "composerDragActive", value)),
  voiceState: "idle",
  setVoiceState: (value) => set((s) => updateField(s, "voiceState", value)),

  composerModels: null,
  setComposerModels: (value) => set((s) => updateField(s, "composerModels", value)),
  composerModelsLoading: false,
  setComposerModelsLoading: (value) => set((s) => updateField(s, "composerModelsLoading", value)),

  mentionMenu: null,
  setMentionMenu: (value) => set((s) => updateField(s, "mentionMenu", value)),
  mentionIndex: 0,
  setMentionIndex: (value) => set((s) => updateField(s, "mentionIndex", value)),
  mentionSkills: [],
  setMentionSkills: (value) => set((s) => updateField(s, "mentionSkills", value)),
  pluginInputCandidates: [],
  setPluginInputCandidates: (value) => set((s) => updateField(s, "pluginInputCandidates", value)),
  pluginInputRevision: 0,
  setPluginInputRevision: (value) => set((s) => updateField(s, "pluginInputRevision", value)),
  activeSkills: [],
  setActiveSkills: (value) => set((s) => updateField(s, "activeSkills", value)),

  speakingMessageKey: null,
  setSpeakingMessageKey: (value) => set((s) => updateField(s, "speakingMessageKey", value)),
  speakingLoadingKey: null,
  setSpeakingLoadingKey: (value) => set((s) => updateField(s, "speakingLoadingKey", value)),
  playingVoicePath: null,
  setPlayingVoicePath: (value) => set((s) => updateField(s, "playingVoicePath", value)),
  voiceLoadingPath: null,
  setVoiceLoadingPath: (value) => set((s) => updateField(s, "voiceLoadingPath", value)),
}));
