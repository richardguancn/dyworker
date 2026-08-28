import crypto from "node:crypto";
import { DEFAULT_UPDATE_URL, normalizeUpdateUrl } from "./app-updater.mjs";
import { normalizeSkillLibraries } from "./skill-libraries.mjs";

export function normalizePreventSleep(value) {
  return ["off", "tasks", "always"].includes(value) ? value : "tasks";
}

export function normalizeApprovalMode(value) {
  // 兼容旧版本审批数据，但统一迁移到新的自动审核模式，避免
  // 界面显示一个模式、任务实际按另一个模式运行。
  if (value === "allow-writes") return "reviewer";
  return ["interactive", "reviewer", "full-access", "deny-changes"].includes(value) ? value : "reviewer";
}

// 审核助手模型来源：main 跟随主模型 / local 内置本地小模型 / custom 自定义 OpenAI 兼容端点。
// 旧数据没这个字段时按是否填过自定义审核端点推断，避免升级后静默改变行为。
export function normalizeReviewerBackend(value, source = {}) {
  const v = String(value || "");
  if (v === "main" || v === "local" || v === "custom") return v;
  return String(source.reviewerEndpoint || "").trim() && String(source.reviewerModel || "").trim() ? "custom" : "main";
}

export function normalizeIdentity(value) {
  return value === "general" || value === "government" ? value : null;
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
    apiKey: currentApiKey,
    visionEndpoint: String(source.visionEndpoint || ""),
    visionModel: String(source.visionModel || ""),
    visionApiKey: decryptSecret(source.visionApiKey, source.visionApiKeyEncrypted === true, secretStorage),
    profiles,
    transcriptionEndpoint: String(source.transcriptionEndpoint || ""),
    transcriptionModel: String(source.transcriptionModel || "whisper-1"),
    ttsEndpoint: String(source.ttsEndpoint || ""),
    ttsModel: String(source.ttsModel || ""),
    ttsApiKey: decryptSecret(source.ttsApiKey, source.ttsApiKeyEncrypted === true, secretStorage),
    // 审核助手自定义端点（reviewerBackend 为 custom 时生效）；local 时用内置本地小模型
    reviewerEndpoint: String(source.reviewerEndpoint || ""),
    reviewerModel: String(source.reviewerModel || ""),
    reviewerApiKey: decryptSecret(source.reviewerApiKey, source.reviewerApiKeyEncrypted === true, secretStorage),
    reviewerBackend: normalizeReviewerBackend(source.reviewerBackend, source),
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
  };
}

export function serializeSettings(settings, secretStorage) {
  const normalizedProfiles = normalizeProfiles(settings?.profiles);
  const normalized = {
    identity: normalizeIdentity(settings?.identity),
    endpoint: String(settings?.endpoint || "").trim(),
    model: String(settings?.model || "").trim(),
    apiKey: String(settings?.apiKey || "").trim(),
    visionEndpoint: String(settings?.visionEndpoint || "").trim(),
    visionModel: String(settings?.visionModel || "").trim(),
    visionApiKey: String(settings?.visionApiKey || "").trim(),
    profiles: normalizedProfiles,
    transcriptionEndpoint: String(settings?.transcriptionEndpoint || "").trim(),
    transcriptionModel: String(settings?.transcriptionModel || "whisper-1").trim(),
    ttsEndpoint: String(settings?.ttsEndpoint || "").trim(),
    ttsModel: String(settings?.ttsModel || "").trim(),
    ttsApiKey: String(settings?.ttsApiKey || "").trim(),
    reviewerEndpoint: String(settings?.reviewerEndpoint || "").trim(),
    reviewerModel: String(settings?.reviewerModel || "").trim(),
    reviewerApiKey: String(settings?.reviewerApiKey || "").trim(),
    reviewerBackend: normalizeReviewerBackend(settings?.reviewerBackend, settings || {}),
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
  };
  const currentSecret = encryptSecret(normalized.apiKey, secretStorage);
  const visionSecret = encryptSecret(normalized.visionApiKey, secretStorage);
  const ttsSecret = encryptSecret(normalized.ttsApiKey, secretStorage);
  const reviewerSecret = encryptSecret(normalized.reviewerApiKey, secretStorage);
  return {
    identity: normalized.identity,
    endpoint: normalized.endpoint,
    model: normalized.model,
    visionEndpoint: normalized.visionEndpoint,
    visionModel: normalized.visionModel,
    visionApiKey: visionSecret.value,
    visionApiKeyEncrypted: visionSecret.encrypted,
    transcriptionEndpoint: normalized.transcriptionEndpoint,
    transcriptionModel: normalized.transcriptionModel,
    ttsEndpoint: normalized.ttsEndpoint,
    ttsModel: normalized.ttsModel,
    ttsApiKey: ttsSecret.value,
    ttsApiKeyEncrypted: ttsSecret.encrypted,
    reviewerEndpoint: normalized.reviewerEndpoint,
    reviewerModel: normalized.reviewerModel,
    reviewerApiKey: reviewerSecret.value,
    reviewerApiKeyEncrypted: reviewerSecret.encrypted,
    reviewerBackend: normalized.reviewerBackend,
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
