import crypto from "node:crypto";
import { DEFAULT_UPDATE_URL, normalizeUpdateUrl } from "./app-updater.mts";
import { normalizeSkillLibraries } from "./skill-libraries.mts";
import { normalizeAsrModelId } from "./local-asr.mts";
import { normalizeTtsModelId } from "./local-tts.mts";
import { parseQuietHours } from "./remote-messages.mts";

// 运营服务地址：远程使用 HTTPS，本机调试允许回环 HTTP（政府/内网版本由用户配置
// 对应内部部署地址，留空表示完全关闭）。允许带端口与路径前缀，去掉尾部斜杠。
export function normalizeTelemetryServiceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.search || url.hash || url.username || url.password) return "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

// 使用统计与运营消息设置：统计默认关闭，由用户说明字段用途后开启；
// 统计上传与消息订阅分别开关，关闭统计不强制关闭消息。
export function normalizeTelemetrySettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const quiet = parseQuietHours(source.quietHours);
  const limit = Math.floor(Number(source.dailyPopupLimit));
  return {
    statsEnabled: source.statsEnabled === true,
    messagesEnabled: source.messagesEnabled === true,
    serviceUrl: normalizeTelemetryServiceUrl(source.serviceUrl),
    notifyNewMessages: source.notifyNewMessages !== false,
    notifyMarketing: source.notifyMarketing === true,
    quietHours: quiet ? quiet.raw : "",
    dailyPopupLimit: Number.isFinite(limit) ? Math.max(0, Math.min(50, limit)) : 3,
  };
}


export function normalizePreventSleep(value) {
  return ["off", "tasks", "always"].includes(value) ? value : "tasks";
}

export function normalizeApprovalMode(value) {
  // 兼容旧版本审批数据，但统一迁移到新的自动审核模式，避免
  // 界面显示一个模式、任务实际按另一个模式运行。
  if (value === "allow-writes") return "reviewer";
  return ["interactive", "reviewer", "auto", "full-access", "deny-changes"].includes(value) ? value : "reviewer";
}

// 无人值守任务（计划/定时任务与到点唤醒续跑）的生效审批模式。
// 计划任务自身只提供"是否允许写工作区"一位信息（reviewer / deny-changes），
// 但用户在设置里显式选了「完全访问权限」时，无人值守运行必须同样生效：
// 否则会出现"界面显示完全访问、计划/续跑仍逐条要审批"的口径分裂
// （IM 渠道任务一直按全局模式运行，见 main.mts 渠道入口）。
// 计划级只读（deny-changes）是比全局设置更具体的约束，不因全局完全访问而放开。
export function unattendedApprovalMode(globalMode, fallback) {
  const base = normalizeApprovalMode(fallback);
  if (base === "deny-changes") return base;
  return normalizeApprovalMode(globalMode) === "full-access" ? "full-access" : base;
}

// 到点唤醒续跑（resumeWake）的生效审批模式。挂起时登记的是当时那次运行的模式，
// 续跑要把它折算成无人值守下的等效模式：
//   - interactive（严格逐次确认）→ auto：无人值守自主推进，工作区内读写直接放行；
//   - reviewer（替我审批）→ **保持 reviewer**：审核助手继续逐条把关，工作区内的低风险操作
//     （含带 rm/ffmpeg 的复合命令）由助手放行，只在越界、外发、破坏性或助手判不准时转人工收件箱。
//     不能降级成 auto：auto 的 ask（非白名单命令）不经审核助手、直接弹人工审批卡，
//     无人值守反而比 reviewer 更打扰（2026-10-02 到点续跑弹卡即此原因）。
//   - full-access / deny-changes / auto：保持原模式（计划级只读不放宽成可写）；
//   - 全局「完全访问权限」覆盖以上结果（计划级只读除外），见 unattendedApprovalMode。
export function wakeApprovalMode(globalMode, sourceMode) {
  const source = normalizeApprovalMode(sourceMode);
  return unattendedApprovalMode(globalMode, source === "interactive" ? "auto" : source);
}

// 审核助手模型来源：main 跟随主模型 / local 内置本地小模型 / custom 自定义 OpenAI 兼容端点。
// 旧数据没这个字段时按是否填过自定义审核端点推断，避免升级后静默改变行为。
export function normalizeReviewerBackend(value, source = {} as any) {
  const v = String(value || "");
  if (v === "main" || v === "local" || v === "custom") return v;
  return String(source.reviewerEndpoint || "").trim() && String(source.reviewerModel || "").trim() ? "custom" : "main";
}

export function normalizeIdentity(value) {
  return value === "general" || value === "government" ? value : null;
}

// 语音转写引擎：cloud 走 OpenAI 兼容 /audio/transcriptions，local 走内置 Qwen3-ASR + llama-server。
export function normalizeTranscriptionEngine(value) {
  return String(value || "") === "local" ? "local" : "cloud";
}

// 语音合成引擎：cloud 走 OpenAI 兼容 /audio/speech，local 走内置 Qwen3-TTS + llama-tts。
export function normalizeTtsEngine(value) {
  return String(value || "") === "local" ? "local" : "cloud";
}

function encryptionAvailable(secretStorage) {
  try {
    return Boolean(secretStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function encryptSecret(value, secretStorage) {
  const plain = String(value || "").trim();
  if (!plain) return { value: "", encrypted: false };
  if (!encryptionAvailable(secretStorage)) {
    throw new Error("当前系统的安全存储不可用，密钥未保存");
  }
  return {
    value: secretStorage.encryptString(plain).toString("base64"),
    encrypted: true,
  };
}

function decryptSecret(value, encrypted, secretStorage) {
  if (!value) return "";
  if (!encrypted) return encryptionAvailable(secretStorage) ? String(value) : "";
  if (!encryptionAvailable(secretStorage)) return "";
  try {
    return secretStorage.decryptString(Buffer.from(String(value), "base64"));
  } catch {
    return "";
  }
}

export function needsSecretMigration(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  if (source.apiKey && source.encrypted !== true) return true;
  if (source.visionApiKey && source.visionApiKeyEncrypted !== true) return true;
  if (source.ttsApiKey && source.ttsApiKeyEncrypted !== true) return true;
  if (source.reviewerApiKey && source.reviewerApiKeyEncrypted !== true) return true;
  return (Array.isArray(source.profiles) ? source.profiles : [])
    .some((profile) => profile?.apiKey && profile?.encrypted !== true);
}

// 统计"已加密但用当前安全存储解不开"的密钥数量。
// 应用改名后系统加密口令会跟着应用名变化，旧密文无法再解开；
// 迁移旧数据时用这个函数提示用户重新填写密钥。
export function countUndecryptableSecrets(stored, secretStorage) {
  const source = stored && typeof stored === "object" ? stored : {};
  const stuck = (value, encrypted) =>
    Boolean(value) && encrypted === true && !decryptSecret(value, true, secretStorage);
  let count = 0;
  if (stuck(source.apiKey, source.encrypted)) count += 1;
  if (stuck(source.visionApiKey, source.visionApiKeyEncrypted)) count += 1;
  if (stuck(source.ttsApiKey, source.ttsApiKeyEncrypted)) count += 1;
  if (stuck(source.reviewerApiKey, source.reviewerApiKeyEncrypted)) count += 1;
  for (const profile of Array.isArray(source.profiles) ? source.profiles : []) {
    if (stuck(profile?.apiKey, profile?.encrypted)) count += 1;
  }
  const qq = source.channels?.qq && typeof source.channels.qq === "object" ? source.channels.qq : {};
  if (stuck(qq.appSecret, qq.appSecretEncrypted)) count += 1;
  return count;
}

// 签名身份变化（换 bundle id、自签名/ad-hoc 重打包）会让 safeStorage 暂时解不开旧密文。
// 此时若把"解不开 → 空串"的结果落盘，旧密文就被永久覆盖，密钥再也找不回来。
// 在序列化结果上把"传入为空、旧密文存在且当前解不开"的字段还原成旧密文：
// 等签名身份恢复稳定（或用户在钥匙串弹窗允许访问）后，密钥仍然能解开。
// 注意：旧密文能解开时用户主动清空是允许的——只有"解不开"才触发保留。
export function preserveUndecryptableSecrets(serialized, stored, secretStorage) {
  if (!serialized || typeof serialized !== "object" || !stored || typeof stored !== "object") return serialized;
  const shouldKeep = (incoming, oldValue, oldEncrypted) =>
    !incoming && Boolean(oldValue) && oldEncrypted === true && !decryptSecret(oldValue, true, secretStorage);
  if (shouldKeep(serialized.apiKey, stored.apiKey, stored.encrypted)) {
    serialized.apiKey = String(stored.apiKey);
    serialized.encrypted = true;
  }
  if (shouldKeep(serialized.visionApiKey, stored.visionApiKey, stored.visionApiKeyEncrypted)) {
    serialized.visionApiKey = String(stored.visionApiKey);
    serialized.visionApiKeyEncrypted = true;
  }
  if (shouldKeep(serialized.ttsApiKey, stored.ttsApiKey, stored.ttsApiKeyEncrypted)) {
    serialized.ttsApiKey = String(stored.ttsApiKey);
    serialized.ttsApiKeyEncrypted = true;
  }
  if (shouldKeep(serialized.reviewerApiKey, stored.reviewerApiKey, stored.reviewerApiKeyEncrypted)) {
    serialized.reviewerApiKey = String(stored.reviewerApiKey);
    serialized.reviewerApiKeyEncrypted = true;
  }
  const storedProfiles = Array.isArray(stored.profiles) ? stored.profiles : [];
  serialized.profiles = (Array.isArray(serialized.profiles) ? serialized.profiles : []).map((profile) => {
    const old = storedProfiles.find((item) => item?.id && item.id === profile?.id);
    if (old && shouldKeep(profile?.apiKey, old.apiKey, old.encrypted)) {
      return { ...profile, apiKey: String(old.apiKey), encrypted: true };
    }
    return profile;
  });
  const storedQq = stored.channels?.qq && typeof stored.channels.qq === "object" ? stored.channels.qq : {};
  if (serialized.channels?.qq && shouldKeep(serialized.channels.qq.appSecret, storedQq.appSecret, storedQq.appSecretEncrypted)) {
    serialized.channels = {
      ...serialized.channels,
      qq: { ...serialized.channels.qq, appSecret: String(storedQq.appSecret), appSecretEncrypted: true },
    };
  }
  return serialized;
}

// IM 消息渠道配置(QQ 官方机器人 / 微信 ClawBot);QQ appSecret 与 apiKey 同款加密。
// 微信登录凭据(bot_token)不进设置文件,由主进程单独存 channel-credentials.json,避免渲染端陈旧覆盖。
function normalizeChannels(channels, secretStorage, direction) {
  const source = channels && typeof channels === "object" ? channels : {};
  const qq = source.qq && typeof source.qq === "object" ? source.qq : {};
  const wechat = source.wechat && typeof source.wechat === "object" ? source.wechat : {};
  // 渠道审批严格度：auto(自动执行,少打扰)/interactive(严格逐次确认)/其余回退 reviewer
  const approvalMode = source.approvalMode === "auto" || source.approvalMode === "interactive"
    ? source.approvalMode
    : "reviewer";
  if (direction === "serialize") {
    const secret = encryptSecret(qq.appSecret, secretStorage);
    return {
      qq: {
        enabled: qq.enabled === true,
        appId: String(qq.appId || "").trim(),
        appSecret: secret.value,
        appSecretEncrypted: secret.encrypted,
      },
      wechat: { enabled: wechat.enabled === true },
      approvalMode,
      modelProfileId: String(source.modelProfileId || ""),
    };
  }
  return {
    qq: {
      enabled: qq.enabled === true,
      appId: String(qq.appId || "").trim(),
      appSecret: decryptSecret(qq.appSecret, qq.appSecretEncrypted === true, secretStorage),
    },
    wechat: { enabled: wechat.enabled === true },
    approvalMode,
    modelProfileId: String(source.modelProfileId || ""),
  };
}

// 供 main 进程加密落盘微信渠道凭据(channel-credentials.json)
export function encryptChannelSecret(value, secretStorage) {
  return encryptSecret(value, secretStorage);
}

export function decryptChannelSecret(value, encrypted, secretStorage) {
  return decryptSecret(value, encrypted, secretStorage);
}

function normalizeProfiles(profiles) {
  const normalized = [];
  const seen = new Set();
  for (const item of Array.isArray(profiles) ? profiles : []) {
    const endpoint = String(item?.endpoint || "").trim();
    const model = String(item?.model || "").trim();
    if (!endpoint || !model) continue;
    const identity = `${endpoint}\n${model}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push({
      id: String(item?.id || crypto.randomUUID()),
      name: String(item?.name || model).trim() || model,
      endpoint,
      model,
      apiKey: String(item?.apiKey || "").trim(),
      // 推理强度档位（见 src/providers.ts reasoningEfforts；空串表示用厂商默认）
      reasoningEffort: String(item?.reasoningEffort || "").trim(),
      transcriptionEndpoint: String(item?.transcriptionEndpoint || "").trim(),
      transcriptionModel: String(item?.transcriptionModel || "").trim(),
    });
  }
  return normalized;
}

export function deserializeSettings(stored, secretStorage) {
  const source = stored && typeof stored === "object" ? stored : {};
  const currentApiKey = decryptSecret(source.apiKey, source.encrypted === true, secretStorage);
  const savedProfiles = Array.isArray(source.profiles) ? source.profiles : [];
  const legacyProfile = source.profileStoreVersion !== 1
    && source.endpoint
    && source.model
    && currentApiKey
    ? [{
        id: crypto.randomUUID(),
        name: String(source.model),
        endpoint: String(source.endpoint),
        model: String(source.model),
        apiKey: currentApiKey,
        reasoningEffort: String(source.reasoningEffort || "").trim(),
        transcriptionEndpoint: String(source.transcriptionEndpoint || ""),
        transcriptionModel: String(source.transcriptionModel || ""),
      }]
    : [];
  const profiles = normalizeProfiles([...savedProfiles.map((profile) => ({
    ...profile,
    apiKey: decryptSecret(profile?.apiKey, profile?.encrypted === true, secretStorage),
  })), ...legacyProfile]);
  return {
    identity: normalizeIdentity(source.identity),
    endpoint: String(source.endpoint || ""),
    model: String(source.model || ""),
    // 推理强度档位（空串 = 厂商默认）；由主进程按厂商映射为请求参数（agent.mjs reasoningRequestParams）
    reasoningEffort: String(source.reasoningEffort || "").trim(),
    // 子代理（dispatch_agent）专用模型的档案 id；空串 = 跟随主模型
    subAgentProfileId: String(source.subAgentProfileId || "").trim(),
    apiKey: currentApiKey,
    visionEndpoint: String(source.visionEndpoint || ""),
    visionModel: String(source.visionModel || ""),
    visionApiKey: decryptSecret(source.visionApiKey, source.visionApiKeyEncrypted === true, secretStorage),
    profiles,
    transcriptionEndpoint: String(source.transcriptionEndpoint || ""),
    transcriptionModel: String(source.transcriptionModel || "whisper-1"),
    transcriptionEngine: normalizeTranscriptionEngine(source.transcriptionEngine),
    // 本地转写模型（transcriptionEngine 为 local 时生效）；非法值回落默认模型
    asrModel: normalizeAsrModelId(source.asrModel),
    asrModelDir: String(source.asrModelDir || ""),
    llamaServerPath: String(source.llamaServerPath || ""),
    ttsEndpoint: String(source.ttsEndpoint || ""),
    ttsModel: String(source.ttsModel || ""),
    ttsEngine: normalizeTtsEngine(source.ttsEngine),
    // 本地合成模型（ttsEngine 为 local 时生效）；非法值回落默认模型
    ttsLocalModel: normalizeTtsModelId(source.ttsLocalModel),
    ttsModelDir: String(source.ttsModelDir || ""),
    ttsVoicePath: String(source.ttsVoicePath || ""),
    ttsApiKey: decryptSecret(source.ttsApiKey, source.ttsApiKeyEncrypted === true, secretStorage),
    // 审核助手自定义端点（reviewerBackend 为 custom 时生效）；local 时用内置本地小模型
    reviewerEndpoint: String(source.reviewerEndpoint || ""),
    reviewerModel: String(source.reviewerModel || ""),
    reviewerApiKey: decryptSecret(source.reviewerApiKey, source.reviewerApiKeyEncrypted === true, secretStorage),
    reviewerBackend: normalizeReviewerBackend(source.reviewerBackend, source),
    // 审核模型保存目录（local 模式用）；留空存到应用数据目录
    reviewerModelDir: String(source.reviewerModelDir || ""),
    searxngEndpoint: String(source.searxngEndpoint || ""),
    bochaApiKey: String(source.bochaApiKey || ""),
    deepseekSearchApiKey: String(source.deepseekSearchApiKey || ""),
    domesticSearchOnly: source.domesticSearchOnly === true,
    approvalMode: normalizeApprovalMode(source.approvalMode),
    preventSleep: normalizePreventSleep(source.preventSleep),
    updateUrl: normalizeUpdateUrl(source.updateUrl || DEFAULT_UPDATE_URL),
    mcpServers: Array.isArray(source.mcpServers) ? source.mcpServers : [],
    channels: normalizeChannels(source.channels, secretStorage, "deserialize"),
    skillLibraries: normalizeSkillLibraries(source.skillLibraries),
    // 厂商原生工具开关：缺失字段按默认值补齐（enableNativeTools 默认开、$web_search 默认关）
    enableNativeTools: source.enableNativeTools !== false,
    nativeToolsDisabled: Array.isArray(source.nativeToolsDisabled) ? source.nativeToolsDisabled.map(String) : ["memory", "excel"],
    enableWebSearchBuiltin: source.enableWebSearchBuiltin === true,
    telemetry: normalizeTelemetrySettings(source.telemetry),
  };
}

export function serializeSettings(settings, secretStorage) {
  if (String(settings?.telemetry?.serviceUrl || "").trim() && !normalizeTelemetryServiceUrl(settings.telemetry.serviceUrl)) {
    throw new Error("运营服务地址无效：请使用 HTTPS 地址；本机可使用 http://localhost:端口，不要附带账号、查询参数或锚点。");
  }
  const normalizedProfiles = normalizeProfiles(settings?.profiles);
  const normalized = {
    identity: normalizeIdentity(settings?.identity),
    endpoint: String(settings?.endpoint || "").trim(),
    model: String(settings?.model || "").trim(),
    reasoningEffort: String(settings?.reasoningEffort || "").trim(),
    subAgentProfileId: String(settings?.subAgentProfileId || "").trim(),
    apiKey: String(settings?.apiKey || "").trim(),
    visionEndpoint: String(settings?.visionEndpoint || "").trim(),
    visionModel: String(settings?.visionModel || "").trim(),
    visionApiKey: String(settings?.visionApiKey || "").trim(),
    profiles: normalizedProfiles,
    transcriptionEndpoint: String(settings?.transcriptionEndpoint || "").trim(),
    transcriptionModel: String(settings?.transcriptionModel || "whisper-1").trim(),
    transcriptionEngine: normalizeTranscriptionEngine(settings?.transcriptionEngine),
    asrModel: normalizeAsrModelId(settings?.asrModel),
    asrModelDir: String(settings?.asrModelDir || "").trim(),
    llamaServerPath: String(settings?.llamaServerPath || "").trim(),
    ttsEndpoint: String(settings?.ttsEndpoint || "").trim(),
    ttsModel: String(settings?.ttsModel || "").trim(),
    ttsEngine: normalizeTtsEngine(settings?.ttsEngine),
    ttsLocalModel: normalizeTtsModelId(settings?.ttsLocalModel),
    ttsModelDir: String(settings?.ttsModelDir || "").trim(),
    ttsVoicePath: String(settings?.ttsVoicePath || "").trim(),
    ttsApiKey: String(settings?.ttsApiKey || "").trim(),
    reviewerEndpoint: String(settings?.reviewerEndpoint || "").trim(),
    reviewerModel: String(settings?.reviewerModel || "").trim(),
    reviewerApiKey: String(settings?.reviewerApiKey || "").trim(),
    reviewerBackend: normalizeReviewerBackend(settings?.reviewerBackend, settings || {}),
    reviewerModelDir: String(settings?.reviewerModelDir || "").trim(),
    searxngEndpoint: String(settings?.searxngEndpoint || "").trim(),
    bochaApiKey: String(settings?.bochaApiKey || "").trim(),
    deepseekSearchApiKey: String(settings?.deepseekSearchApiKey || "").trim(),
    domesticSearchOnly: settings?.domesticSearchOnly === true,
    approvalMode: normalizeApprovalMode(settings?.approvalMode),
    preventSleep: normalizePreventSleep(settings?.preventSleep),
    updateUrl: normalizeUpdateUrl(settings?.updateUrl || DEFAULT_UPDATE_URL),
    mcpServers: (Array.isArray(settings?.mcpServers) ? settings.mcpServers : [])
      .filter((server) => server && String(server.command || "").trim())
      .map((server) => ({
        id: String(server.id || crypto.randomUUID()),
        name: String(server.name || server.command || "").trim(),
        command: String(server.command || "").trim(),
        args: Array.isArray(server.args) ? server.args.map(String) : String(server.args || "").split(" ").filter(Boolean),
        enabled: server.enabled !== false,
      })),
    skillLibraries: normalizeSkillLibraries(settings?.skillLibraries),
    enableNativeTools: settings?.enableNativeTools !== false,
    nativeToolsDisabled: Array.isArray(settings?.nativeToolsDisabled) ? settings.nativeToolsDisabled.map(String) : ["memory", "excel"],
    enableWebSearchBuiltin: settings?.enableWebSearchBuiltin === true,
    telemetry: normalizeTelemetrySettings(settings?.telemetry),
  };
  const currentSecret = encryptSecret(normalized.apiKey, secretStorage);
  const visionSecret = encryptSecret(normalized.visionApiKey, secretStorage);
  const ttsSecret = encryptSecret(normalized.ttsApiKey, secretStorage);
  const reviewerSecret = encryptSecret(normalized.reviewerApiKey, secretStorage);
  return {
    identity: normalized.identity,
    endpoint: normalized.endpoint,
    model: normalized.model,
    reasoningEffort: normalized.reasoningEffort,
    visionEndpoint: normalized.visionEndpoint,
    visionModel: normalized.visionModel,
    visionApiKey: visionSecret.value,
    visionApiKeyEncrypted: visionSecret.encrypted,
    transcriptionEndpoint: normalized.transcriptionEndpoint,
    transcriptionModel: normalized.transcriptionModel,
    transcriptionEngine: normalized.transcriptionEngine,
    asrModel: normalized.asrModel,
    asrModelDir: normalized.asrModelDir,
    llamaServerPath: normalized.llamaServerPath,
    ttsEndpoint: normalized.ttsEndpoint,
    ttsModel: normalized.ttsModel,
    ttsEngine: normalized.ttsEngine,
    ttsLocalModel: normalized.ttsLocalModel,
    ttsModelDir: normalized.ttsModelDir,
    ttsVoicePath: normalized.ttsVoicePath,
    ttsApiKey: ttsSecret.value,
    ttsApiKeyEncrypted: ttsSecret.encrypted,
    reviewerEndpoint: normalized.reviewerEndpoint,
    reviewerModel: normalized.reviewerModel,
    reviewerApiKey: reviewerSecret.value,
    reviewerApiKeyEncrypted: reviewerSecret.encrypted,
    reviewerBackend: normalized.reviewerBackend,
    reviewerModelDir: normalized.reviewerModelDir,
    searxngEndpoint: normalized.searxngEndpoint,
    bochaApiKey: normalized.bochaApiKey,
    deepseekSearchApiKey: normalized.deepseekSearchApiKey,
    domesticSearchOnly: normalized.domesticSearchOnly,
    approvalMode: normalized.approvalMode,
    preventSleep: normalized.preventSleep,
    updateUrl: normalized.updateUrl,
    mcpServers: normalized.mcpServers,
    channels: normalizeChannels(settings?.channels, secretStorage, "serialize"),
    skillLibraries: normalized.skillLibraries,
    enableNativeTools: normalized.enableNativeTools,
    nativeToolsDisabled: normalized.nativeToolsDisabled,
    enableWebSearchBuiltin: normalized.enableWebSearchBuiltin,
    telemetry: normalized.telemetry,
    encrypted: currentSecret.encrypted,
    apiKey: currentSecret.value,
    profileStoreVersion: 1,
    profiles: normalized.profiles.map((profile) => {
      const secret = encryptSecret(profile.apiKey, secretStorage);
      return {
        ...profile,
        encrypted: secret.encrypted,
        apiKey: secret.value,
      };
    }),
  };
}
