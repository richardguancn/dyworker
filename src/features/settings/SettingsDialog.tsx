import { BarChart3, Bell, Check, FileCode2, Globe, History, Info, ListTodo, LoaderCircle, MessagesSquare, Mic, Moon, Palette, RefreshCw, Search, Settings, ShieldAlert, UserRound } from "lucide-react";
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
import { ModelSettingsPanel } from "./ModelSettingsPanel";
import { VoiceSettingsPanel } from "./VoiceSettingsPanel";
import type { ApprovalMode, AppUpdateStatus, ModelProfile, ProviderSettings, ReviewerLocalStatus, ScheduleRecord, SettingsTab, SkillRecord, TtsLocalStatus, UsageRecord, VoiceLocalStatus, WikiMemoryPage, WikiMemoryRow } from "../../types";
import { blobToWavMono } from "../../lib/audio";
import { settingsWithProfile } from "../../lib/settings";

export type { SettingsTab } from "../../types";

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
        {tab === "model" && (
          <ModelSettingsPanel
            draft={draft}
            setDraft={setDraft}
            profiles={profiles}
            profileId={profileId}
            providerId={providerId}
            preset={preset}
            saving={saving}
            applyProfile={applyProfile}
            removeProfile={removeProfile}
            applyProvider={applyProvider}
            applyEndpoint={applyEndpoint}
            applyModel={applyModel}
            probing={probing}
            probeResult={probeResult}
            runCredentialProbe={runCredentialProbe}
            modelsFetching={modelsFetching}
            modelOptions={modelOptions}
            modelsError={modelsError}
            modelChoices={modelChoices}
            reviewerLocal={reviewerLocal}
            reviewerDownloading={reviewerDownloading}
            reviewerDownloadError={reviewerDownloadError}
            startReviewerLocalDownload={startReviewerLocalDownload}
          />
        )}
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
        {tab === "voice" && (
          <VoiceSettingsPanel
            draft={draft}
            setDraft={setDraft}
            voiceLocal={voiceLocal}
            voiceDownloading={voiceDownloading}
            voiceDownloadError={voiceDownloadError}
            startVoiceLocalDownload={startVoiceLocalDownload}
            ttsLocal={ttsLocal}
            ttsDownloading={ttsDownloading}
            ttsDownloadPhase={ttsDownloadPhase}
            ttsDownloadError={ttsDownloadError}
            startTtsLocalDownload={startTtsLocalDownload}
            ttsVoiceConverting={ttsVoiceConverting}
            ttsVoiceConvertHint={ttsVoiceConvertHint}
            pickAndPrepareTtsVoice={pickAndPrepareTtsVoice}
          />
        )}
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
