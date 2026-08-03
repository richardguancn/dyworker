import crypto from "node:crypto";

export function normalizePreventSleep(value) {
  return ["off", "tasks", "always"].includes(value) ? value : "tasks";
}

export function normalizeApprovalMode(value) {
  return ["interactive", "reviewer", "allow-writes", "full-access", "deny-changes"].includes(value) ? value : "allow-writes";
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
  for (const profile of Array.isArray(source.profiles) ? source.profiles : []) {
    if (stuck(profile?.apiKey, profile?.encrypted)) count += 1;
  }
  const qq = source.channels?.qq && typeof source.channels.qq === "object" ? source.channels.qq : {};
  if (stuck(qq.appSecret, qq.appSecretEncrypted)) count += 1;
  return count;
}

// IM 消息渠道配置(QQ 官方机器人 / 微信 ClawBot);QQ appSecret 与 apiKey 同款加密。
// 微信登录凭据(bot_token)不进设置文件,由主进程单独存 channel-credentials.json,避免渲染端陈旧覆盖。
function normalizeChannels(channels, secretStorage, direction) {
  const source = channels && typeof channels === "object" ? channels : {};
  const qq = source.qq && typeof source.qq === "object" ? source.qq : {};
  const wechat = source.wechat && typeof source.wechat === "object" ? source.wechat : {};
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
      approvalMode: source.approvalMode === "interactive" ? "interactive" : "allow-writes",
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
    approvalMode: source.approvalMode === "interactive" ? "interactive" : "allow-writes",
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
    endpoint: String(source.endpoint || ""),
    model: String(source.model || ""),
    apiKey: currentApiKey,
    profiles,
    transcriptionEndpoint: String(source.transcriptionEndpoint || ""),
    transcriptionModel: String(source.transcriptionModel || "whisper-1"),
    searxngEndpoint: String(source.searxngEndpoint || ""),
    bochaApiKey: String(source.bochaApiKey || ""),
    domesticSearchOnly: source.domesticSearchOnly === true,
    approvalMode: normalizeApprovalMode(source.approvalMode),
    preventSleep: normalizePreventSleep(source.preventSleep),
    mcpServers: Array.isArray(source.mcpServers) ? source.mcpServers : [],
    channels: normalizeChannels(source.channels, secretStorage, "deserialize"),
  };
}

export function serializeSettings(settings, secretStorage) {
  const normalizedProfiles = normalizeProfiles(settings?.profiles);
  const normalized = {
    endpoint: String(settings?.endpoint || "").trim(),
    model: String(settings?.model || "").trim(),
    apiKey: String(settings?.apiKey || "").trim(),
    profiles: normalizedProfiles,
    transcriptionEndpoint: String(settings?.transcriptionEndpoint || "").trim(),
    transcriptionModel: String(settings?.transcriptionModel || "whisper-1").trim(),
    searxngEndpoint: String(settings?.searxngEndpoint || "").trim(),
    bochaApiKey: String(settings?.bochaApiKey || "").trim(),
    domesticSearchOnly: settings?.domesticSearchOnly === true,
    approvalMode: normalizeApprovalMode(settings?.approvalMode),
    preventSleep: normalizePreventSleep(settings?.preventSleep),
    mcpServers: (Array.isArray(settings?.mcpServers) ? settings.mcpServers : [])
      .filter((server) => server && String(server.command || "").trim())
      .map((server) => ({
        id: String(server.id || crypto.randomUUID()),
        name: String(server.name || server.command || "").trim(),
        command: String(server.command || "").trim(),
        args: Array.isArray(server.args) ? server.args.map(String) : String(server.args || "").split(" ").filter(Boolean),
        enabled: server.enabled !== false,
      })),
  };
  const currentSecret = encryptSecret(normalized.apiKey, secretStorage);
  return {
    endpoint: normalized.endpoint,
    model: normalized.model,
    transcriptionEndpoint: normalized.transcriptionEndpoint,
    transcriptionModel: normalized.transcriptionModel,
    searxngEndpoint: normalized.searxngEndpoint,
    bochaApiKey: normalized.bochaApiKey,
    domesticSearchOnly: normalized.domesticSearchOnly,
    approvalMode: normalized.approvalMode,
    preventSleep: normalized.preventSleep,
    mcpServers: normalized.mcpServers,
    channels: normalizeChannels(settings?.channels, secretStorage, "serialize"),
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
