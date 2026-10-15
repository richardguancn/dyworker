// 设置保存 / 应用更新 / 模型档案（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App、ConversationPane 等任意位置 import 调用。
import { settingsWithProfile } from "../lib/settings";
import { matchProvider, providerPresets } from "../providers";
import type { ApprovalMode, ModelProfile, ProviderSettings, UserIdentity } from "../types";
import { useComposerStore } from "./composerStore";
import { useInboxStore } from "./inboxStore";
import { useLayoutStore } from "./layoutStore";
import { bootstrapFailedRef, composerModelsKeyRef, settingsSaveErrorRef } from "./sharedRefs";
import { useSettingsStore } from "./settingsStore";
import { useViewStore } from "./viewStore";

export const saveProviderSettings = async (nextSettings: ProviderSettings, successMessage = "设置已保存") => {
  const { setSettings } = useSettingsStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const failSave = (message: string) => {
    // 设置是整页界面，聊天区的错误条在设置页打开时不可见，把原因一并留给设置页就地提示
    settingsSaveErrorRef.current = message;
    setError(message);
    return false;
  };
  if (bootstrapFailedRef.current) {
    return failSave("启动时未能读到本地配置，已阻止保存以免覆盖磁盘上的数据；请重启应用后重试。");
  }
  // 桥接缺失必须报错而不是"保存成功"：window.dyworker?.saveSettings 是可选链，
  // 没有 preload 时会静默返回 undefined，被当成保存成功——用户看到「设置已保存」，
  // 磁盘上一个字都没写（设置里改不动的现场）。浏览器里单独跑界面预览时没有桥接
  // 属于正常情况，那种场景不报错。
  if (!window.dyworker?.saveSettings && /Electron\//.test(navigator.userAgent)) {
    return failSave("桌面桥接没有加载（preload 缺失），设置无法写入磁盘。请重新构建并重启 DYWorker；若重启后依旧如此，说明安装包不完整。");
  }
  try {
    settingsSaveErrorRef.current = "";
    const result = await window.dyworker?.saveSettings(nextSettings);
    if (result && !result.ok) {
      return failSave(result.error || "模型设置保存失败");
    }
    setSettings({ ...nextSettings, updateUrl: result?.updateUrl || nextSettings.updateUrl });
    setNotice(successMessage);
    return true;
  } catch (saveError) {
    return failSave(saveError instanceof Error ? saveError.message : String(saveError));
  }
};

export const checkAppUpdate = async () => {
  const { setAppUpdateDialogOpen } = useLayoutStore.getState();
  const { setNotice } = useViewStore.getState();
  setAppUpdateDialogOpen(true);
  try {
    const result = await window.dyworker?.checkForAppUpdate();
    if (result && !result.ok && result.error) setNotice(result.error);
  } catch (updateError) {
    setNotice(updateError instanceof Error ? updateError.message : String(updateError));
  }
};

export const openAppUpdateDialog = () => {
  const { appUpdate } = useSettingsStore.getState();
  const { setAppUpdateDialogOpen } = useLayoutStore.getState();
  setAppUpdateDialogOpen(true);
  if (["idle", "not-available", "error", "unavailable"].includes(appUpdate.state)) void checkAppUpdate();
};

export const downloadAppUpdate = () => {
  const { setNotice } = useViewStore.getState();
  void window.dyworker?.downloadAppUpdate().then((result) => {
    if (!result.ok && result.error) setNotice(result.error);
  });
};

export const installAppUpdate = () => {
  const { setNotice } = useViewStore.getState();
  void window.dyworker?.installAppUpdate().then((result) => {
    if (!result.ok && result.error) setNotice(result.error);
  });
};

export const chooseIdentity = (identity: UserIdentity) => {
  const { settings } = useSettingsStore.getState();
  return saveProviderSettings({ ...settings, identity }, "身份设置已保存");
};

export const selectApprovalMode = (nextMode: ApprovalMode) => {
  const { settings, setApprovalMode } = useSettingsStore.getState();
  const { setApprovalMenuOpen } = useLayoutStore.getState();
  const { setFullAccessDialogOpen } = useInboxStore.getState();
  if (nextMode === "full-access") {
    setApprovalMenuOpen(false);
    setFullAccessDialogOpen(true);
    return;
  }
  setApprovalMode(nextMode);
  setApprovalMenuOpen(false);
  void saveProviderSettings({ ...settings, approvalMode: nextMode }, "审批模式已记住，下次启动继续生效");
};

export const confirmFullAccess = async () => {
  const { settings, setApprovalMode } = useSettingsStore.getState();
  const { setFullAccessDialogOpen } = useInboxStore.getState();
  const saved = await saveProviderSettings({ ...settings, approvalMode: "full-access" }, "完整访问权限已开启");
  if (!saved) return false;
  setApprovalMode("full-access");
  setFullAccessDialogOpen(false);
  return true;
};

export const activateModelProfile = async (profile: ModelProfile) => {
  const { settings } = useSettingsStore.getState();
  const { setModelMenuOpen } = useLayoutStore.getState();
  const nextSettings = settingsWithProfile(settings, profile);
  setModelMenuOpen(false);
  await saveProviderSettings(nextSettings, `已切换到 ${profile.name}`);
};

// 模型菜单打开时拉一次「此密钥可用的模型」；同一 endpoint+key 只拉一次，换地址或密钥后重新拉
export const ensureComposerModels = () => {
  const { settings } = useSettingsStore.getState();
  const { setComposerModels, setComposerModelsLoading } = useComposerStore.getState();
  const endpoint = settings.endpoint.trim();
  const key = `${endpoint}\n${settings.apiKey.trim()}`;
  if (!endpoint || composerModelsKeyRef.current === key) return;
  composerModelsKeyRef.current = key;
  setComposerModels(null);
  setComposerModelsLoading(true);
  window.dyworker?.listModels({ endpoint, apiKey: settings.apiKey })
    .then((result) => setComposerModels(result?.ok ? (result.models || []) : []))
    .catch(() => setComposerModels([]))
    .finally(() => setComposerModelsLoading(false));
};

// 在同一密钥下切换到另一个模型：已有对应配置就整个启用；没有就按当前密钥现做一套并保存，
// 之后它会出现在「已保存的模型」列表里，可与其它厂商配置一样管理
export const switchComposerModel = async (modelId: string) => {
  const { settings } = useSettingsStore.getState();
  const { setModelMenuOpen } = useLayoutStore.getState();
  const endpoint = settings.endpoint.trim();
  const model = modelId.trim();
  if (!endpoint || !model) return;
  setModelMenuOpen(false);
  const existing = (settings.profiles || []).find((item) => item.endpoint === endpoint && item.model === model);
  if (existing) {
    await saveProviderSettings(settingsWithProfile(settings, existing), `已切换到 ${existing.name}`);
    return;
  }
  let shortProvider = providerPresets.find((item) => item.id === matchProvider(endpoint))?.name.replace(/（.*?）/g, "") || "";
  if (matchProvider(endpoint) === "custom") {
    try {
      shortProvider = new URL(endpoint).host;
    } catch {
      shortProvider = "自定义";
    }
  }
  const profile: ModelProfile = {
    id: crypto.randomUUID(),
    name: `${shortProvider} · ${model}`.trim(),
    endpoint,
    model,
    apiKey: settings.apiKey.trim(),
    reasoningEffort: "",
    transcriptionEndpoint: settings.transcriptionEndpoint,
    transcriptionModel: settings.transcriptionModel,
  };
  const next = {
    ...settings,
    model,
    reasoningEffort: "",
    profiles: [
      ...(settings.profiles || []).filter((item) => !(item.endpoint === endpoint && item.model === model)),
      profile,
    ],
  };
  await saveProviderSettings(next, `已切换到 ${profile.name}`);
};
