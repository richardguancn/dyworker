import { BarChart3, Bell, Check, FileCode2, Globe, History, Info, ListTodo, LoaderCircle, MessagesSquare, Mic, Moon, Palette, RefreshCw, Search, Settings, ShieldAlert, Trash2, UserRound } from "lucide-react";
import { CSSProperties, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { beginSession, discardSession } from "../../appearance/controller";
import { hasConfiguredModel, isLocalModelEndpoint } from "../../../electron/host/dsh-runtime/model-settings.mts";
import { isGlmNativeVisionModel, matchProvider, providerPresets, usesResponsesApi } from "../../providers";
import { AppearanceSettingsPanel } from "../../appearance/AppearanceSettingsPanel";
import { McpSettingsPanel } from "../../McpSettingsPanel";
import { PluginsPage } from "../../PluginsPage";
import { PluginIcon } from "../../PluginIcon";
import { MemoriesPanel } from "../memory/MemoryPanels";
import { SkillLibrariesPanel, SkillsPanel } from "../skills/SkillPanels";
import { PlansPanel } from "../plans/PlansPanel";
import type { ScheduleDraft } from "../plans/PlansPanel";
import { UsageStatsPanel } from "../usage/UsagePanels";
import { ChannelsPanel, HooksPanel, IdentitySettingsPanel, TelemetrySettingsSection } from "./SettingsSubPanels";
import type { ApprovalMode, AppUpdateStatus, ModelProfile, ProviderSettings, ReviewerLocalStatus, ScheduleRecord, SkillRecord, TtsLocalStatus, UsageRecord, VoiceLocalStatus, WikiMemoryPage, WikiMemoryRow } from "../../types";
import { blobToWavMono } from "../../lib/audio";
import { settingsWithProfile } from "../../lib/settings";

export type SettingsTab = "model" | "voice" | "search" | "power" | "plugins" | "updates" | "telemetry" | "channels" | "identity" | "appearance" | "memories" | "skills" | "skill-libraries" | "plans" | "usage" | "hooks" | "about";

// 图标既可能是 lucide 的，也可能是应用内自绘的（如插件图标），只要求接受 size
export type SettingsNavIcon = (props: { size?: number; className?: string }) => ReactNode;

// Codex 风格设置导航:左侧分组 + 搜索,右侧分区内容
const settingsNav: { group: string; items: { id: SettingsTab; label: string; icon: SettingsNavIcon; keywords?: string[] }[] }[] = [
  { group: "服务", items: [
    { id: "model", label: "模型服务", icon: Settings },
    { id: "voice", label: "语音转写", icon: Mic },
    { id: "search", label: "搜索", icon: Search },
    { id: "channels", label: "消息渠道", icon: MessagesSquare },
  ] },
  { group: "偏好", items: [
    { id: "identity", label: "助手身份", icon: UserRound },
    { id: "appearance", label: "外观", icon: Palette, keywords: ["外观", "主题", "背景", "透明", "玻璃", "字体", "字号", "theme", "font"] },
    { id: "power", label: "电源", icon: Moon },
    { id: "updates", label: "应用更新", icon: RefreshCw },
    { id: "about", label: "关于", icon: Info, keywords: ["开发者", "管灯余", "GitHub", "邮箱"] },
  ] },
  { group: "资源", items: [
    { id: "plugins", label: "插件", icon: PluginIcon, keywords: ["MCP", "mcpb", "DSH", "Claude Mods"] },
    { id: "memories", label: "记忆", icon: History },
    { id: "skills", label: "技能", icon: FileCode2 },
    { id: "skill-libraries", label: "技能库", icon: Globe },
    { id: "plans", label: "定时计划", icon: ListTodo },
  ] },
  { group: "高级", items: [
    { id: "usage", label: "用量统计", icon: BarChart3 },
    { id: "telemetry", label: "统计与消息", icon: Bell, keywords: ["统计", "运营", "消息", "公告", "日活", "遥测", "telemetry"] },
    { id: "hooks", label: "权限规则", icon: ShieldAlert },
  ] },
];

// 本地转写模型候选清单（与主进程 ASR_MODELS 的展示信息保持一致；下载状态从 voiceLocal.models 合并）
const localAsrModelOptions = [
  { id: "qwen3-asr-0.6b", label: "Qwen3-ASR-0.6B", note: "约 1GB · 最快，中文优先" },
  { id: "qwen3-asr-1.7b", label: "Qwen3-ASR-1.7B", note: "约 2.5GB · 更准确，中文优先" },
  { id: "ultravox-0.5-1b", label: "Ultravox-0.5-1B", note: "约 2.7GB · 多语言" },
  { id: "voxtral-mini-3b", label: "Voxtral-Mini-3B", note: "约 3.2GB · 多语言" },
];

// 本地合成模型候选清单（与主进程 TTS_MODELS 的展示信息保持一致；下载状态从 ttsLocal.models 合并）
const localTtsModelOptions = [
  { id: "qwen3-tts-1.7b-q4", label: "Qwen3-TTS-1.7B（Q4_K_M）", note: "约 1.5GB · 更小更快" },
  { id: "qwen3-tts-1.7b-q8", label: "Qwen3-TTS-1.7B（Q8_0）", note: "约 2.3GB · 音质更好" },
];

export function SettingsDialog({
  sidebarWidth,
  value,
  onClose,
  onSave,
  saveErrorRef,
  memories,
  onDeleteMemory,
  onEditMemory,
  onLintMemories,
  memoriesLinting,
  memoriesLintMessage,
  skills,
  onToggleSkill,
  onDeleteSkill,
  onEditSkill,
  onRefreshSkills,
  onOpenSkill,
  onCreateSkill,
  schedules,
  workspaceReady,
  currentWorkspacePath,
  approvalMode,
  onSaveSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onTriggerSchedule,
  onOpenScheduleSession,
  usageRecords,
  onClearUsage,
  tab,
  onTabChange,
  planSeed,
  appUpdate,
  onCheckUpdate,
  onCreatePlugin,
  sessionId,
}: {
  onCreatePlugin: () => void;
  sessionId?: string;
  sidebarWidth: number;
  value: ProviderSettings;
  onClose: () => void;
  onSave: (value: ProviderSettings, successMessage?: string) => Promise<boolean>;
  saveErrorRef: React.MutableRefObject<string>;
  memories: WikiMemoryPage[];
  onDeleteMemory: (id: string) => void;
  onEditMemory: (row: WikiMemoryRow) => void;
  onLintMemories: () => void;
  memoriesLinting: boolean;
  memoriesLintMessage: string;
  skills: SkillRecord[];
  onToggleSkill: (id: string, enabled: boolean) => void;
  onDeleteSkill: (id: string) => void;
  onEditSkill: (skill: SkillRecord) => void;
  onRefreshSkills: () => void;
  onOpenSkill: (skill: SkillRecord) => void;
  onCreateSkill: () => void;
  schedules: ScheduleRecord[];
  workspaceReady: boolean;
  currentWorkspacePath?: string;
  approvalMode: ApprovalMode;
  onSaveSchedule: (draft: ScheduleDraft) => Promise<boolean>;
  onToggleSchedule: (id: string, enabled: boolean) => void;
  onDeleteSchedule: (id: string) => void;
  onTriggerSchedule: (id: string) => void;
  onOpenScheduleSession?: (sessionId: string) => void;
  usageRecords: UsageRecord[] | null;
  onClearUsage: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  planSeed?: { name: string; prompt: string } | null;
  appUpdate: AppUpdateStatus;
  onCheckUpdate: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [providerId, setProviderId] = useState(() => matchProvider(value.endpoint));
  const [saving, setSaving] = useState(false);
  // 保存结果就地提示：设置已是整页界面，保存后不关闭，因此需要有页面内的反馈
  const [saveStatus, setSaveStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const [navQuery, setNavQuery] = useState("");
  const [profileId, setProfileId] = useState(() => (
    (value.profiles || []).find((item) => item.endpoint === value.endpoint && item.model === value.model)?.id || ""
  ));
  const profiles = draft.profiles || [];
  const activeLabel = settingsNav.flatMap((group) => group.items).find((item) => item.id === tab)?.label || "设置";
  const preset = providerPresets.find((item) => item.id === providerId) || providerPresets[providerPresets.length - 1];
  const modelComplete = hasConfiguredModel(draft);
  // 内置本地审核模型：状态与下载进度（模型 tab 打开时才拉取）
  const [reviewerLocal, setReviewerLocal] = useState<ReviewerLocalStatus | null>(null);
  const [reviewerDownloading, setReviewerDownloading] = useState(false);
  const [reviewerDownloadError, setReviewerDownloadError] = useState("");
  // 凭证预检：保存前先验证服务地址/模型/密钥可用性，避免任务运行时才发现配错
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; text: string } | null>(null);
  // 同一密钥下的可用模型列表（GET /models）：输入密钥后自动拉取，填充「模型名称」下拉
  const [modelsFetching, setModelsFetching] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; contextLimit?: number }> | null>(null);
  const [modelsError, setModelsError] = useState("");

  // 外观会话：弹窗打开创建草稿（预览改动），关闭（取消/Esc/点遮罩/×）恢复已保存外观。
  // 放在弹窗层级而不是外观面板内：在设置内部切换栏目保留草稿。begin/discard 均幂等。
  useEffect(() => {
    beginSession();
    return () => discardSession();
  }, []);

  // Esc 关闭设置（与现有弹窗一致；菜单的 Esc 监听只在菜单打开时挂载，互不干扰）
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 保存成功提示：自动消失，避免停留在设置页时一直亮着
  const saveStatusTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current);
  }, []);
  const flashSaveStatus = (text: string, failed = false) => {
    setSaveStatus({ text, failed });
    if (saveStatusTimer.current !== null) window.clearTimeout(saveStatusTimer.current);
    saveStatusTimer.current = window.setTimeout(() => setSaveStatus(null), failed ? 6000 : 2600);
  };

  const runCredentialProbe = async () => {
    if (!draft.endpoint.trim() || !draft.model.trim()) {
      setProbeResult({ ok: false, text: "请先填写服务地址和模型名称再验证。" });
      return;
    }
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await window.dyworker?.probeCredentials({ endpoint: draft.endpoint, model: draft.model, apiKey: draft.apiKey });
      setProbeResult(result
        ? { ok: Boolean(result.ok), text: result.ok ? result.message || "验证通过" : result.error || "验证失败" }
        : { ok: false, text: "当前环境不支持凭证验证。" });
    } catch (error) {
      setProbeResult({ ok: false, text: `验证失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setProbing(false);
    }
  };

  // 输入完密钥后自动拉取该密钥可用的模型列表（GET /models），填充「模型名称」下拉；
  // 700ms 防抖等输入稳定，服务地址或密钥一变就重新拉（本地服务无需密钥时仍可用预设清单手填）
  useEffect(() => {
    if (tab !== "model") return;
    const endpoint = draft.endpoint.trim();
    const apiKey = draft.apiKey.trim();
    if (!endpoint || !apiKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setModelsFetching(true);
      window.dyworker?.listModels({ endpoint, apiKey })
        .then((result) => {
          if (cancelled) return;
          if (result?.ok && result.models?.length) {
            setModelOptions(result.models);
            setModelsError("");
          } else {
            setModelOptions(null);
            setModelsError(result?.error || "获取可用模型失败，可手动填写模型名称。");
          }
        })
        .catch((error) => {
          if (!cancelled) setModelsError(`获取可用模型失败：${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          if (!cancelled) setModelsFetching(false);
        });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, draft.endpoint, draft.apiKey]);

  // 模型名称下拉候选：服务端拉取的列表在前（对该密钥是权威的），预设清单兜底补充
  const modelChoices: Array<{ id: string; contextLimit?: number }> = (() => {
    const fetched = modelOptions ?? [];
    const extras = preset.models
      .filter((model) => !fetched.some((item) => item.id === model))
      .map((model) => ({ id: model }));
    return [...fetched, ...extras];
  })();

  useEffect(() => {
    if (tab !== "model") return;
    const dyworker = window.dyworker;
    if (!dyworker?.getReviewerLocalStatus) return;
    dyworker.getReviewerLocalStatus().then((status) => setReviewerLocal(status)).catch(() => { });
    return dyworker.onReviewerLocalDownloadProgress((progress) => {
      setReviewerLocal((current) => (current ? { ...current, sizeBytes: progress.received, expectedBytes: progress.total } : current));
    });
  }, [tab]);

  const startReviewerLocalDownload = async () => {
    if (reviewerDownloading) return;
    setReviewerDownloading(true);
    setReviewerDownloadError("");
    try {
      const result = await window.dyworker?.downloadReviewerLocalModel();
      if (result?.status) setReviewerLocal(result.status);
      if (result?.ok === false) setReviewerDownloadError(result.error || "下载失败，请重试");
    } catch (error) {
      setReviewerDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReviewerDownloading(false);
    }
  };

  // 内置本地语音转写（可选模型 + llama-server）：状态与下载进度（voice tab 打开时才拉取）
  const [voiceLocal, setVoiceLocal] = useState<VoiceLocalStatus | null>(null);
  const [voiceDownloading, setVoiceDownloading] = useState(false);
  const [voiceDownloadError, setVoiceDownloadError] = useState("");

  useEffect(() => {
    if (tab !== "voice") return;
    const dyworker = window.dyworker;
    if (!dyworker?.getVoiceLocalStatus) return;
    dyworker.getVoiceLocalStatus().then((status) => setVoiceLocal(status)).catch(() => { });
    return dyworker.onVoiceLocalDownloadProgress((progress) => {
      setVoiceLocal((current) => {
        if (!current) return current;
        // 进度按 modelId 归到对应模型：更新 models 列表与当前保存的 model 概要
        const models = current.models.map((model) => (
          model.id === progress.modelId
            ? { ...model, sizeBytes: progress.received, expectedBytes: progress.total }
            : model
        ));
        const model = current.model.id === progress.modelId
          ? { ...current.model, sizeBytes: progress.received, expectedBytes: progress.total }
          : current.model;
        return { ...current, model, models };
      });
    });
  }, [tab]);

  const startVoiceLocalDownload = async (modelId?: string) => {
    if (voiceDownloading) return;
    setVoiceDownloading(true);
    setVoiceDownloadError("");
    try {
      const result = await window.dyworker?.downloadVoiceLocalModel(modelId ? { modelId } : undefined);
      if (result?.status) setVoiceLocal(result.status);
      if (result?.ok === false) setVoiceDownloadError(result.error || "下载失败，请重试");
    } catch (error) {
      setVoiceDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setVoiceDownloading(false);
    }
  };

  // 内置本地语音合成（Qwen3-TTS + llama-tts）：状态与下载进度（voice tab 打开时才拉取）
  const [ttsLocal, setTtsLocal] = useState<TtsLocalStatus | null>(null);
  const [ttsDownloading, setTtsDownloading] = useState(false);
  const [ttsDownloadPhase, setTtsDownloadPhase] = useState("");
  const [ttsDownloadError, setTtsDownloadError] = useState("");

  useEffect(() => {
    if (tab !== "voice") return;
    const dyworker = window.dyworker;
    if (!dyworker?.getTtsLocalStatus) return;
    dyworker.getTtsLocalStatus().then((status) => setTtsLocal(status)).catch(() => { });
    return dyworker.onTtsLocalDownloadProgress((progress) => {
      // 引擎（与转写共用）与模型两阶段字节口径不同：引擎阶段只展示状态，模型阶段更新整体进度
      setTtsDownloadPhase(String(progress.phase || ""));
      if (String(progress.phase || "").startsWith("runtime:")) return;
      // 进度按 modelId 归到对应模型：更新 models 列表与当前保存的 model 概要
      setTtsLocal((current) => {
        if (!current) return current;
        const models = current.models.map((model) => (
          model.id === progress.modelId
            ? { ...model, sizeBytes: progress.received, expectedBytes: progress.total }
            : model
        ));
        const model = current.model.id === progress.modelId
          ? { ...current.model, sizeBytes: progress.received, expectedBytes: progress.total }
          : current.model;
        return { ...current, model, models };
      });
    });
  }, [tab]);

  const startTtsLocalDownload = async (modelId?: string) => {
    if (ttsDownloading) return;
    setTtsDownloading(true);
    setTtsDownloadError("");
    try {
      const result = await window.dyworker?.downloadTtsLocalModel(modelId ? { modelId } : undefined);
      if (result?.status) setTtsLocal(result.status);
      if (result?.ok === false) setTtsDownloadError(result.error || "下载失败，请重试");
    } catch (error) {
      setTtsDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setTtsDownloading(false);
      setTtsDownloadPhase("");
    }
  };

  // 本地引擎（miniaudio）只认 wav/mp3/flac/ogg(vorbis)；m4a/aac/opus 等压缩格式要系统装 ffprobe 才能解。
  // 选完文件后在渲染层用 Web Audio 解码，统一转成 24kHz 单声道 wav（Qwen3-TTS 原生采样率）再交给引擎。
  const [ttsVoiceConverting, setTtsVoiceConverting] = useState(false);
  const [ttsVoiceConvertHint, setTtsVoiceConvertHint] = useState("");

  const pickAndPrepareTtsVoice = async () => {
    const picked = await window.dyworker?.chooseTtsVoice();
    if (!picked?.path) return;
    const ext = (picked.path.split(".").pop() || "").toLowerCase();
    if (["wav", "mp3", "flac"].includes(ext)) {
      setDraft((current) => ({ ...current, ttsVoicePath: picked.path! }));
      setTtsVoiceConvertHint("");
      return;
    }
    setTtsVoiceConverting(true);
    setTtsVoiceConvertHint(`正在把 ${ext ? `.${ext}` : "音频"} 转换成 wav…`);
    try {
      const read = await window.dyworker?.readTtsVoiceFile({ path: picked.path });
      if (!read?.ok || !read.bytes?.length) throw new Error(read?.error || "读取音频失败");
      // IPC 结构化克隆拿到的是 Uint8Array<ArrayBufferLike>：拷贝成独立 ArrayBuffer 再建 Blob
      const sourceBuffer = read.bytes.buffer.slice(read.bytes.byteOffset, read.bytes.byteOffset + read.bytes.byteLength) as ArrayBuffer;
      const wav = await blobToWavMono(new Blob([sourceBuffer]), 24000);
      const write = await window.dyworker?.writeTtsVoiceFile({ bytes: wav });
      if (!write?.ok || !write.path) throw new Error(write?.error || "保存转换结果失败");
      setDraft((current) => ({ ...current, ttsVoicePath: write.path! }));
      setTtsVoiceConvertHint(`已把 ${ext ? `.${ext}` : "音频"} 转换成 wav，保存设置后生效`);
    } catch (error) {
      setTtsVoiceConvertHint(`转换失败：${error instanceof Error ? error.message : String(error)}，请改用 wav/mp3/flac 格式`);
    } finally {
      setTtsVoiceConverting(false);
    }
  };

  const applyProvider = (id: string) => {
    setProviderId(id);
    const next = providerPresets.find((item) => item.id === id);
    if (next?.id === "custom") {
      setProfileId("");
      setDraft((current) => ({
        ...current,
        endpoint: "",
        model: "",
        apiKey: "",
        reasoningEffort: "",
        transcriptionEndpoint: "",
      }));
      return;
    }
    if (next && next.id !== "custom") {
      const saved = profiles.find((item) => item.endpoint === next.endpoint && item.model === next.defaultModel)
        || profiles.find((item) => item.endpoint === next.endpoint);
      setProfileId(saved?.id || "");
      setDraft((current) => saved ? settingsWithProfile(current, saved) : {
        ...current,
        endpoint: next.endpoint,
        model: next.defaultModel,
        apiKey: "",
        // 换厂商后原强度档位可能不再适用，回到新模型的默认配置
        reasoningEffort: "",
      });
    }
  };

  const applyProfile = (id: string) => {
    setProfileId(id);
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setProviderId(matchProvider(profile.endpoint));
    setDraft((current) => settingsWithProfile(current, profile));
  };

  const applyEndpoint = (endpoint: string) => {
    const saved = profiles.find((item) => item.endpoint === endpoint.trim() && item.model === draft.model.trim());
    setProfileId(saved?.id || "");
    setProviderId(matchProvider(endpoint));
    setDraft((current) => saved ? settingsWithProfile(current, saved) : {
      ...current,
      endpoint,
      apiKey: endpoint.trim() === current.endpoint.trim() ? current.apiKey : "",
      reasoningEffort: endpoint.trim() === current.endpoint.trim() ? current.reasoningEffort : "",
    });
  };

  const applyModel = (model: string) => {
    const saved = profiles.find((item) => item.endpoint === draft.endpoint.trim() && item.model === model.trim());
    setProfileId(saved?.id || "");
    setDraft((current) => ({
      ...current,
      model,
      apiKey: saved?.apiKey ?? current.apiKey,
      reasoningEffort: saved?.reasoningEffort ?? (model.trim() === current.model.trim() ? current.reasoningEffort : ""),
      transcriptionEndpoint: saved?.transcriptionEndpoint ?? current.transcriptionEndpoint,
      transcriptionModel: saved?.transcriptionModel || current.transcriptionModel,
    }));
  };

  const saveCurrentModel = (current: ProviderSettings) => {
    let shortProvider = preset.name.replace(/（.*?）/g, "");
    if (preset.id === "custom") {
      try {
        shortProvider = new URL(current.endpoint.trim()).host;
      } catch {
        shortProvider = "自定义";
      }
    }
    const endpoint = current.endpoint.trim();
    const model = current.model.trim();
    const apiKey = current.apiKey.trim();
    const name = `${shortProvider} · ${model}`.trim();
    const existing = profiles.find((item) => item.id === profileId)
      || profiles.find((item) => item.endpoint === endpoint && item.model === model);
    const profile: ModelProfile = {
      id: existing?.id || crypto.randomUUID(),
      name,
      endpoint,
      model,
      apiKey,
      reasoningEffort: current.reasoningEffort || "",
      transcriptionEndpoint: current.transcriptionEndpoint,
      transcriptionModel: current.transcriptionModel,
    };
    const list = profiles.filter((item) => item.id !== profile.id
      && !(item.endpoint === endpoint && item.model === model));
    return {
      ...current,
      endpoint,
      model,
      apiKey,
      profiles: [...list, profile],
    };
  };

  const removeProfile = async () => {
    if (!profileId) return;
    if (!window.confirm("删除后会立即生效，关闭设置或点击取消也无法恢复。确定删除这套模型配置吗？")) return;
    const remaining = profiles.filter((item) => item.id !== profileId);
    const next = remaining[0];
    const nextDraft = next ? {
      ...settingsWithProfile(draft, next),
      profiles: remaining,
    } : {
      ...draft,
      endpoint: "",
      model: "",
      apiKey: "",
      transcriptionEndpoint: "",
      profiles: [],
    };
    setSaving(true);
    const saved = await onSave(nextDraft, "模型配置已删除");
    setSaving(false);
    if (!saved) return;
    setProfileId(next?.id || "");
    setProviderId(next ? matchProvider(next.endpoint) : "custom");
    setDraft(nextDraft);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (tab === "model" && !modelComplete) return;
    setSaving(true);
    setSaveStatus(null);
    const nextDraft = tab === "model" ? saveCurrentModel(draft) : draft;
    const saved = await onSave(
      nextDraft,
      tab === "model" ? "模型服务已保存并启用" : "设置已保存",
    );
    setSaving(false);
    if (!saved) {
      flashSaveStatus(`保存失败：${saveErrorRef.current || "请重试"}`, true);
      return;
    }
    // 设置是整页界面：保存后留在原页，只就地提示结果
    if (tab === "model") {
      setDraft(nextDraft);
      const active = (nextDraft.profiles || []).find(
        (item) => item.endpoint === nextDraft.endpoint && item.model === nextDraft.model,
      );
      setProfileId(active?.id || "");
    }
    flashSaveStatus(tab === "model" ? "模型服务已保存并启用" : "设置已保存");
  };

  return (
    <section className="settings-page" aria-label="设置" style={{ "--settings-sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <div className="settings-dialog settings-v2">
        <aside className="settings-nav" aria-label="设置导航">
          {/* 不再放关闭按钮：Esc 与左侧图标栏都能退出设置。 */}
          <div className="settings-nav-heading"><h1>设置</h1></div>
          <div className="settings-nav-search">
            <Search size={13} />
            <input aria-label="搜索设置" value={navQuery} placeholder="搜索设置…" onChange={(event) => setNavQuery(event.target.value)} />
          </div>
          <div className="settings-nav-scroll">
          {settingsNav.map((group) => {
            const query = navQuery.trim().toLowerCase();
            const items = group.items.filter((item) => !query
              || item.label.toLowerCase().includes(query)
              || (item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(query)));
            if (!items.length) return null;
            return (
              <div key={group.group}>
                <div className="settings-nav-group">{group.group}</div>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav-item ${tab === item.id ? "active" : ""}`}
                      onClick={() => onTabChange(item.id)}
                    >
                      <Icon size={14} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
          </div>
        </aside>
        <div className="settings-content">
        <div className="dialog-header"><h2>{activeLabel}</h2></div>
        {tab === "identity" ? (
          <IdentitySettingsPanel
            value={draft}
            onSave={async (next, message) => {
              const saved = await onSave(next, message);
              if (saved) setDraft(next);
              return saved;
            }}
          />
        ) : tab === "about" ? (
          <dl className="settings-about">
            <div><dt>开发者</dt><dd>管灯余</dd></div>
            <div><dt>GitHub</dt><dd><a href="http://github.com/richardguancn/" target="_blank" rel="noreferrer"
              onClick={(event) => {
                if (window.dyworker?.openBrowserExternal) {
                  event.preventDefault();
                  void window.dyworker.openBrowserExternal("http://github.com/richardguancn/");
                }
              }}>github.com/richardguancn</a></dd></div>
            <div><dt>邮箱</dt><dd>guandengyu@gmail.com</dd></div>
          </dl>
        ) : tab === "appearance" ? (
          <AppearanceSettingsPanel />
        ) : tab === "plugins" ? (
          <PluginsPage onCreate={onCreatePlugin} sessionId={sessionId} onSkillsChanged={onRefreshSkills} mcpPanel={<McpSettingsPanel value={value} onSave={onSave} />} />
        ) : ["model", "voice", "search", "power", "updates", "telemetry"].includes(tab) ? (
          <form onSubmit={submit}>
        {tab === "model" && (<>
        <div className="dialog-section-title">已保存的模型</div>
        <p className="profile-section-hint">选择一套配置后会自动填入下方内容，确认后点击“保存并使用”。</p>
        <div className="profile-row">
          <select value={profileId} onChange={(event) => applyProfile(event.target.value)}>
            <option value="">{profiles.length ? "选择要使用或编辑的模型…" : "还没有保存的模型"}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <button type="button" className="icon-button" onClick={() => void removeProfile()} disabled={!profileId || saving} aria-label="删除所选配置">
            <Trash2 size={15} />
          </button>
        </div>
        <div className="dialog-section-title">连接信息</div>
        <p className="profile-section-hint">保存后会立即用于后续任务，并加入上方列表，之后可以直接切换。</p>
        <label>
          服务商
          <select value={providerId} onChange={(event) => applyProvider(event.target.value)}>
            {providerPresets.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          服务地址
          <input
            value={draft.endpoint}
            placeholder={providerId === "deepseek" ? "https://api.deepseek.com/responses" : "https://api.example.com/v1/chat/completions"}
            onChange={(event) => applyEndpoint(event.target.value)}
          />
        </label>
        <p className="dialog-note">
          {draft.endpoint.trim()
            ? (usesResponsesApi(draft.endpoint)
                ? "该地址将自动使用 Responses API 请求。"
                : "该地址将自动使用 OpenAI Chat Completions 请求。")
            : "系统会根据服务地址自动判断使用 Responses API 或 Chat Completions；DeepSeek 官方根地址会自动补全为 /responses。"}
        </p>
        <label>
          API 密钥
          <input
            value={draft.apiKey}
            type="password"
            placeholder={`仅保存在当前设备（${preset.keyHint}）`}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          />
        </label>
        {isLocalModelEndpoint(draft.endpoint) ? <p className="dialog-note">本机服务如果不要求密钥，可以留空；若服务要求验证，请填写对应密钥。</p> : null}
        <div className="credential-probe">
          <button type="button" className="button-secondary" onClick={() => void runCredentialProbe()} disabled={probing || saving}>
            {probing ? <LoaderCircle className="spin" size={14} /> : null}
            {probing ? "验证中…" : "验证密钥可用性"}
          </button>
          {probeResult ? <p className={`credential-probe-result ${probeResult.ok ? "ok" : "bad"}`}>{probeResult.text}</p> : null}
        </div>
        <label>
          模型名称
          <input
            value={draft.model}
            list="preset-models"
            placeholder={modelsFetching ? "正在获取可用模型…" : preset.defaultModel || "填写服务商提供的模型名称"}
            onChange={(event) => applyModel(event.target.value)}
          />
          <datalist id="preset-models">
            {modelChoices.map((item) => <option key={item.id} value={item.id} />)}
          </datalist>
        </label>
        {modelsFetching ? <p className="dialog-note">正在获取该密钥可用的模型…</p> : null}
        {!modelsFetching && modelOptions ? (
          <p className="dialog-note">已获取 {modelOptions.length} 个可用模型，点击上方输入框即可下拉选择；也可手动输入其他名称。</p>
        ) : null}
        {modelsError ? <p className="credential-probe-result bad">{modelsError}</p> : null}
        <p className="dialog-note">
          可在模型名后加 [1M]、[256K] 或 [131072] 后缀指定上下文上限（如 k3[1M]），仅用于本地用量统计与裁剪；请求时自动剥离后缀。
        </p>
        <label>
          子代理模型
          <select
            value={draft.subAgentProfileId || ""}
            onChange={(event) => setDraft({ ...draft, subAgentProfileId: event.target.value })}
          >
            <option value="">跟随主模型</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>
        <p className="dialog-note">
          dispatch_agent 派发的子代理默认与主模型相同；可在这里换成更便宜或更快的模型（如 Flash 型）跑资料收集类子任务，密钥为空时沿用主模型密钥。
        </p>
        {(() => {
          const modelName = draft.model.trim();
          const deepseekVision = modelName.toLowerCase() === "deepseek-v4-flash-vision-exp";
          const deepseekText = ["deepseek-v4-flash", "deepseek-v4-pro"].includes(modelName.toLowerCase());
          const glmVision = providerId === "glm" && isGlmNativeVisionModel(modelName);
          const glmText = providerId === "glm" && /^glm-/i.test(modelName) && !glmVision;
          if (!(deepseekVision || deepseekText || glmVision || glmText)) return null;
          if (deepseekVision || glmVision) return (<>
          <div className="dialog-section-title">图片（{modelName}）</div>
          <p className="dialog-note">{glmVision
            ? "该模型是 GLM 原生多模态模型，附件图片会以 image_url 原样随请求发送给智谱，无需配置外部视觉服务。"
            : "该模型原生支持图片输入（input_image / image_url），附件图片会原样随请求发送给 DeepSeek，无需再配置外部视觉服务。图片仅允许出现在用户消息中，支持 JPEG / PNG / GIF / WebP。"}</p>
          </>);
          return (<>
        <div className="dialog-section-title">图片识别（{deepseekText ? "DeepSeek V4 Flash / Pro" : "GLM 纯文本模型"}）</div>
        <p className="dialog-note">{deepseekText
          ? "DeepSeek V4 系列模型本身负责文字理解。图片会先交给下方视觉服务识别，再把识别结果交给 DeepSeek；原图不会发送给纯文字接口。视觉服务需支持 OpenAI 兼容的 Chat Completions 和 image_url。"
          : `GLM 纯文本模型不接收图片。可以把模型换成多模态的 glm-5.3-flash（推荐，图片直接发给智谱），或配置下方视觉服务：图片先交给视觉服务识别，再把识别结果交给 GLM，原图不会发送给纯文字接口。视觉服务需支持 OpenAI 兼容的 Chat Completions 和 image_url（如智谱 glm-4.5v）。`}</p>
        <label>
          视觉服务地址
          <input
            value={draft.visionEndpoint}
            placeholder="https://api.example.com/v1/chat/completions"
            onChange={(event) => setDraft({ ...draft, visionEndpoint: event.target.value })}
          />
        </label>
        <label>
          视觉模型名称
          <input
            value={draft.visionModel}
            placeholder="填写视觉服务提供的模型名称"
            onChange={(event) => setDraft({ ...draft, visionModel: event.target.value })}
          />
        </label>
        <label>
          视觉服务密钥
          <input
            value={draft.visionApiKey}
            type="password"
            placeholder="仅保存在当前设备"
            onChange={(event) => setDraft({ ...draft, visionApiKey: event.target.value })}
          />
        </label>
          </>);
        })()}
        {providerId === "kimi-open" && (<>
        <div className="dialog-section-title">Kimi 原生工具（开放平台）</div>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.enableNativeTools !== false}
            onChange={(event) => setDraft({ ...draft, enableNativeTools: event.target.checked })}
          />
          启用 Kimi 官方工具（Formula API）
        </label>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.enableWebSearchBuiltin === true}
            onChange={(event) => setDraft({ ...draft, enableWebSearchBuiltin: event.target.checked })}
          />
          启用内置联网搜索（$web_search，默认关闭）
        </label>
        <p className="dialog-note">
          默认关闭会向服务端持久化数据或上传文件的工具：memory（记忆）、excel（表格分析）。Kimi 公式 web_search 与网页抓取仍走本地联网审批。官方工具本体限时免费，恢复收费后按次计费；官方提示内置联网搜索正在升级，可能不稳定。
        </p>
        </>)}
        <div className="dialog-section-title">自动审批模型（可选）</div>
        <p className="dialog-note">
          审批严格度为“替我审批”时，本来要人工确认的操作会先交给审核助手判断。相同操作只有在任务要求和审批政策一致时才复用判断；界面操作每次读取最新状态。
        </p>
        <label>
          审核模型来源
          <select
            value={draft.reviewerBackend}
            onChange={(event) => setDraft({ ...draft, reviewerBackend: event.target.value as ProviderSettings["reviewerBackend"] })}
          >
            <option value="main">跟随当前模型</option>
            <option value="local">本地内置小模型（离线建议，放行须确认）</option>
            <option value="custom">自定义端点（OpenAI 兼容）</option>
          </select>
        </label>
        {draft.reviewerBackend === "local" && (
          <div className="dialog-note">
            <p>本地小模型仅提供审核建议，需要授权的操作仍须你确认后才会执行。普通只读操作继续自动执行。界面操作会交给当前模型，根据最新界面判断。</p>
            {reviewerLocal?.downloaded
              ? "模型已就绪：Qwen3-0.6B（610 MB，已存本机）。任务运行时按需加载，空闲 5 分钟后自动释放。"
              : "模型未下载：Qwen3-0.6B（约 610 MB），从 ModelScope 下载到保存目录，下载完成后离线可用。"}
            {!reviewerLocal?.downloaded && (
              <button type="button" className="settings-update-check" onClick={startReviewerLocalDownload} disabled={reviewerDownloading}>
                {reviewerDownloading
                  ? `下载中 ${reviewerLocal?.expectedBytes ? Math.min(99, Math.round((reviewerLocal.sizeBytes / reviewerLocal.expectedBytes) * 100)) : 0}%`
                  : "下载模型"}
              </button>
            )}
            {reviewerDownloadError && <p style={{ color: "#c0392b" }}>{reviewerDownloadError}</p>}
            <label>
              保存路径（可选）
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.reviewerModelDir}
                  placeholder="默认存到应用数据目录 models/reviewer"
                  onChange={(event) => setDraft({ ...draft, reviewerModelDir: event.target.value })}
                />
                <button
                  type="button"
                  className="settings-update-check"
                  onClick={async () => {
                    const picked = await window.dyworker?.chooseReviewerLocalDir();
                    if (picked?.path) setDraft({ ...draft, reviewerModelDir: picked.path });
                  }}
                >
                  浏览…
                </button>
              </span>
            </label>
            <p>更改路径并保存后立即生效；若新目录里没有模型文件，重新点“下载模型”或把旧的 Qwen3-0.6B-Q8_0.gguf 手动移过去。</p>
          </div>
        )}
        {draft.reviewerBackend === "custom" && (<>
        <label>
          审核服务地址
          <input
            value={draft.reviewerEndpoint}
            placeholder="http://127.0.0.1:11434/v1/chat/completions"
            onChange={(event) => setDraft({ ...draft, reviewerEndpoint: event.target.value })}
          />
        </label>
        <label>
          审核模型名称
          <input
            value={draft.reviewerModel}
            placeholder="qwen3:4b"
            onChange={(event) => setDraft({ ...draft, reviewerModel: event.target.value })}
          />
        </label>
        <label>
          审核 API 密钥
          <input
            value={draft.reviewerApiKey}
            type="password"
            placeholder="本地服务通常留空"
            onChange={(event) => setDraft({ ...draft, reviewerApiKey: event.target.value })}
          />
        </label>
        </>)}
        </>)}
        {tab === "power" && (<>
        <div className="dialog-section-title">电源</div>
        <label>
          防止电脑休眠
          <select
            value={draft.preventSleep}
            onChange={(event) => setDraft({ ...draft, preventSleep: event.target.value as ProviderSettings["preventSleep"] })}
          >
            <option value="off">关闭</option>
            <option value="tasks">仅任务运行期间（推荐）</option>
            <option value="always">始终保持唤醒</option>
          </select>
        </label>
        <p className="dialog-note">只阻止系统挂起，屏幕照常关闭、照常锁定，锁屏安全不受影响；长任务（持续执行、/goal、定时计划）跑到一半电脑睡着时可开启。无人值守的机器建议选「仅任务运行期间」，「始终保持唤醒」请确认符合单位安全规定。Linux 依赖 systemd-logind，个别桌面环境可能不支持。</p>
        </>)}
        {tab === "updates" && (<>
        <div className="dialog-section-title">应用更新</div>
        <div className="settings-update-row">
          <span className="settings-update-status">
            当前版本 {appUpdate.currentVersion || "未知"}
            {appUpdate.state === "available" && ` · 发现新版本 ${appUpdate.version || ""}`}
            {appUpdate.state === "downloaded" && " · 更新已下载，可安装"}
            {appUpdate.state === "downloading" && ` · 正在下载 ${Math.round(appUpdate.percent || 0)}%`}
            {appUpdate.state === "checking" && " · 正在检查…"}
            {appUpdate.state === "not-available" && " · 已是最新"}
          </span>
          <button type="button" className="settings-update-check" onClick={onCheckUpdate}>
            {appUpdate.state === "downloaded" ? "安装更新" : appUpdate.state === "available" ? "查看更新" : "检查更新"}
          </button>
        </div>
        {draft.updateUrl && (
          <button
            type="button"
            className="app-update-latest-link"
            onClick={() => void window.dyworker?.openBrowserExternal?.(`${draft.updateUrl}/releases/latest`)}
          >
            在浏览器中下载最新版本
          </button>
        )}
        <div className="dialog-section-title">应用更新来源</div>
        <label>
          更新地址
          <input
            type="url"
            value={draft.updateUrl}
            placeholder="https://github.com/组织名/仓库名"
            onChange={(event) => setDraft({ ...draft, updateUrl: event.target.value })}
          />
        </label>
        <p className="dialog-note">默认使用 DYWorker 的 GitHub 仓库。你也可以改成自己的 GitHub 仓库；应用会按 v + 版本号的标签检查发布版本，例如 v0.1.17。</p>
        </>)}
        {tab === "telemetry" && (
          <TelemetrySettingsSection draft={draft} setDraft={setDraft} />
        )}
        {tab === "search" && (<>
        <div className="dialog-section-title">搜索（可选）</div>
        <label>
          DeepSeek 搜索密钥
          <input
            value={draft.deepseekSearchApiKey}
            type="password"
            placeholder="platform.deepseek.com 申请；非 DeepSeek 模型时的默认搜索后端"
            onChange={(event) => setDraft({ ...draft, deepseekSearchApiKey: event.target.value })}
          />
        </label>
        <label>
          博查 API 密钥
          <input
            value={draft.bochaApiKey}
            type="password"
            placeholder="AI 搜索服务，结果带摘要，调研类任务更稳（bochaai.com）"
            onChange={(event) => setDraft({ ...draft, bochaApiKey: event.target.value })}
          />
        </label>
        <label>
          SearXNG 服务地址
          <input
            value={draft.searxngEndpoint}
            placeholder="自建开源搜索，如 http://192.168.1.10:8080；留空用国内引擎"
            onChange={(event) => setDraft({ ...draft, searxngEndpoint: event.target.value })}
          />
        </label>
        <label className="dialog-check">
          <input
            type="checkbox"
            checked={draft.domesticSearchOnly}
            onChange={(event) => setDraft({ ...draft, domesticSearchOnly: event.target.checked })}
          />
          仅使用境内搜索（推荐敏感单位开启：跳过必应，查询不发送给外企服务）
        </label>
        <p className="dialog-note">搜索按模型厂商路由：Kimi 开放平台用 Kimi 官方搜索（公式 web_search，按次计费）；DeepSeek 模型用 DeepSeek 服务端搜索（复用会话密钥，每次搜索计一次模型调用）；GLM（智谱）模型用智谱 Web Search API（复用会话密钥，按次计费，境内引擎）；其他模型默认也用 DeepSeek 搜索（需在此配置密钥）。以上都不可用时回退：博查 API → 自建 SearXNG → 必应国内版（带摘要）→ 360 / 搜狗抓取。涉密信息请勿使用任何联网搜索；政策法规建议用 gov_search 官方接口。自建 SearXNG 请只挂境内引擎后端，查询才不出境。</p>
        </>)}
        {tab === "voice" && (<>
        <div className="dialog-section-title">语音转写</div>
        <label>
          转写引擎
          <select
            value={draft.transcriptionEngine}
            onChange={(event) => setDraft({ ...draft, transcriptionEngine: event.target.value as ProviderSettings["transcriptionEngine"] })}
          >
            <option value="cloud">云端服务（OpenAI 兼容 /audio/transcriptions）</option>
            <option value="local">本地引擎（离线可用，多模型可选）</option>
          </select>
        </label>
        {draft.transcriptionEngine === "local" && (() => {
          const selectedId = draft.asrModel || "qwen3-asr-0.6b";
          const statusById = new Map((voiceLocal?.models || []).map((model) => [model.id, model]));
          const selected = statusById.get(selectedId);
          const selectedOption = localAsrModelOptions.find((model) => model.id === selectedId) || localAsrModelOptions[0];
          return (
          <div className="dialog-note">
            <label>
              本地模型
              <select
                value={selectedId}
                onChange={(event) => setDraft({ ...draft, asrModel: event.target.value })}
              >
                {localAsrModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}（{model.note}{statusById.get(model.id)?.downloaded ? "，已下载" : ""}）
                  </option>
                ))}
              </select>
            </label>
            {selected?.downloaded
              ? `本地语音模型已就绪：${selectedOption.label}（已存本机）。首次转写按需启动引擎（约 2-5 秒），空闲 3 分钟后自动退出释放内存。`
              : `本地语音模型未下载：${selectedOption.label}（${selectedOption.note} + 引擎约 20MB），下载完成后无需联网即可把语音转成文字。`}
            {!selected?.downloaded && (
              <button type="button" className="settings-update-check" onClick={() => void startVoiceLocalDownload(selectedId)} disabled={voiceDownloading}>
                {voiceDownloading
                  ? `下载中 ${selected?.expectedBytes ? Math.min(99, Math.round((selected.sizeBytes / selected.expectedBytes) * 100)) : 0}%`
                  : "下载模型与引擎"}
              </button>
            )}
            {voiceDownloadError && <p style={{ color: "#c0392b" }}>{voiceDownloadError}</p>}
            <label>
              模型保存路径（可选）
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.asrModelDir}
                  placeholder="默认存到应用数据目录 models/asr"
                  onChange={(event) => setDraft({ ...draft, asrModelDir: event.target.value })}
                />
                <button
                  type="button"
                  className="settings-update-check"
                  onClick={async () => {
                    const picked = await window.dyworker?.chooseVoiceLocalDir();
                    if (picked?.path) setDraft({ ...draft, asrModelDir: picked.path });
                  }}
                >
                  浏览…
                </button>
              </span>
            </label>
            <label>
              自定义 llama-server 路径（可选）
              <input
                value={draft.llamaServerPath}
                placeholder="留空使用内置下载的语音引擎"
                onChange={(event) => setDraft({ ...draft, llamaServerPath: event.target.value })}
              />
            </label>
            <p>更改模型路径并保存后立即生效；若新目录里没有模型文件，重新点“下载模型与引擎”。切换模型后首次转写会重新加载引擎。</p>
          </div>
          );
        })()}
        {draft.transcriptionEngine !== "local" && (<>
        <label>
          转写服务地址
          <input
            value={draft.transcriptionEndpoint}
            placeholder="留空时根据模型服务地址自动生成"
            onChange={(event) => setDraft({ ...draft, transcriptionEndpoint: event.target.value })}
          />
        </label>
        <label>
          转写模型
          <input
            value={draft.transcriptionModel}
            placeholder="whisper-1"
            onChange={(event) => setDraft({ ...draft, transcriptionModel: event.target.value })}
          />
        </label>
        </>)}
        <div className="dialog-section-title" style={{ marginTop: 18 }}>语音合成（渠道语音发送）</div>
        <label>
          合成引擎
          <select
            value={draft.ttsEngine}
            onChange={(event) => setDraft({ ...draft, ttsEngine: event.target.value as ProviderSettings["ttsEngine"] })}
          >
            <option value="cloud">云端服务（OpenAI 兼容 /audio/speech）</option>
            <option value="local">本地引擎（Qwen3-TTS，离线可用）</option>
          </select>
        </label>
        {draft.ttsEngine === "local" && (() => {
          const selectedId = draft.ttsLocalModel || "qwen3-tts-1.7b-q8";
          const statusById = new Map((ttsLocal?.models || []).map((model) => [model.id, model]));
          const selected = statusById.get(selectedId);
          const selectedOption = localTtsModelOptions.find((model) => model.id === selectedId) || localTtsModelOptions[1];
          return (
          <div className="dialog-note">
            <label>
              本地模型
              <select
                value={selectedId}
                onChange={(event) => setDraft({ ...draft, ttsLocalModel: event.target.value })}
              >
                {localTtsModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}（{model.note}{statusById.get(model.id)?.downloaded ? "，已下载" : ""}）
                  </option>
                ))}
              </select>
            </label>
            {selected?.downloaded
              ? `本地语音合成模型已就绪：${selectedOption.label}（已存本机）。合成时按需启动引擎，无需联网。`
              : `本地语音合成模型未下载：${selectedOption.label}（${selectedOption.note} + 引擎与语音转写共用），下载完成后无需联网即可把文字合成语音。`}
            {!selected?.downloaded && (
              <button type="button" className="settings-update-check" onClick={() => void startTtsLocalDownload(selectedId)} disabled={ttsDownloading}>
                {ttsDownloading
                  ? (ttsDownloadPhase.startsWith("runtime:")
                    ? "下载引擎中…"
                    : `下载中 ${selected?.expectedBytes ? Math.min(99, Math.round((selected.sizeBytes / selected.expectedBytes) * 100)) : 0}%`)
                  : "下载模型与引擎"}
              </button>
            )}
            {ttsDownloadError && <p style={{ color: "#c0392b" }}>{ttsDownloadError}</p>}
            <label>
              模型保存路径（可选）
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.ttsModelDir}
                  placeholder="默认存到应用数据目录 models/tts"
                  onChange={(event) => setDraft({ ...draft, ttsModelDir: event.target.value })}
                />
                <button
                  type="button"
                  className="settings-update-check"
                  onClick={async () => {
                    const picked = await window.dyworker?.chooseTtsLocalDir();
                    if (picked?.path) setDraft({ ...draft, ttsModelDir: picked.path });
                  }}
                >
                  浏览…
                </button>
              </span>
            </label>
            <label>
              参考音色音频（可选）
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={draft.ttsVoicePath}
                  placeholder="留空用模型默认音色；选一段 6-15 秒的人声可克隆音色"
                  onChange={(event) => setDraft({ ...draft, ttsVoicePath: event.target.value })}
                />
                <button
                  type="button"
                  className="settings-update-check"
                  onClick={() => void pickAndPrepareTtsVoice()}
                  disabled={ttsVoiceConverting}
                >
                  {ttsVoiceConverting ? "转换中…" : "浏览…"}
                </button>
              </span>
            </label>
            {ttsVoiceConvertHint && <p style={{ marginTop: 6 }}>{ttsVoiceConvertHint}</p>}
            <p>更改模型路径并保存后立即生效；若新目录里没有模型文件，重新点“下载模型与引擎”。切换模型后首次合成会使用新模型。</p>
          </div>
          );
        })()}
        {draft.ttsEngine !== "local" && (<>
        <label>
          合成服务地址
          <input
            value={draft.ttsEndpoint}
            placeholder="OpenAI 兼容的 /audio/speech 地址，留空则不提供语音发送"
            onChange={(event) => setDraft({ ...draft, ttsEndpoint: event.target.value })}
          />
        </label>
        <label>
          合成模型
          <input
            value={draft.ttsModel}
            placeholder="tts-1"
            onChange={(event) => setDraft({ ...draft, ttsModel: event.target.value })}
          />
        </label>
        <label>
          合成密钥
          <input
            type="password"
            value={draft.ttsApiKey}
            placeholder="留空时使用主模型密钥"
            onChange={(event) => setDraft({ ...draft, ttsApiKey: event.target.value })}
          />
        </label>
        </>)}
        <p className="dialog-note">切换服务商后只需核对模型名称并填入密钥。文本、图片附件和语音转写使用兼容 OpenAI 格式的服务。</p>
        </>)}
        <div className="dialog-actions">
          <span className={`settings-save-status${saveStatus?.failed ? " error" : ""}`} role="status">{saveStatus?.text || ""}</span>
          <button type="button" className="button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={saving || (tab === "model" && !modelComplete)}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {tab === "model" ? "保存并使用" : "保存设置"}
          </button>
        </div>
          </form>
        ) : tab === "memories" ? (
          <MemoriesPanel pages={memories} onDelete={onDeleteMemory} onEdit={onEditMemory} onLint={onLintMemories} linting={memoriesLinting} lintMessage={memoriesLintMessage} />
        ) : tab === "skills" ? (
          <SkillsPanel
            items={skills}
            onToggle={onToggleSkill}
            onDelete={onDeleteSkill}
            onEdit={onEditSkill}
            onRefresh={onRefreshSkills}
            onOpen={onOpenSkill}
            onCreate={onCreateSkill}
          />
        ) : tab === "skill-libraries" ? (
          <SkillLibrariesPanel value={value} onSave={onSave} onRefreshSkills={onRefreshSkills} />
        ) : tab === "usage" ? (
          <>
            <UsageStatsPanel records={usageRecords} />
            <div className="dialog-actions">
              <button type="button" className="button-secondary" onClick={onClearUsage}>清空记录</button>
            </div>
          </>
        ) : tab === "hooks" ? (
          <HooksPanel />
        ) : tab === "channels" ? (
          <ChannelsPanel value={value} onSave={onSave} />
        ) : (
          <PlansPanel
            items={schedules}
            workspaceReady={workspaceReady}
            currentWorkspacePath={currentWorkspacePath}
            approvalMode={approvalMode}
            onSave={onSaveSchedule}
            onToggle={onToggleSchedule}
            onDelete={onDeleteSchedule}
            onTrigger={onTriggerSchedule}
            onOpenSession={onOpenScheduleSession}
            seed={planSeed}
          />
        )}
        </div>
      </div>
    </section>
  );
}
