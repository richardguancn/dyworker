import assert from "node:assert/strict";
import test from "node:test";
import { countUndecryptableSecrets, deserializeSettings, needsSecretMigration, normalizeIdentity, preserveUndecryptableSecrets, serializeSettings } from "../electron/settings.mjs";
import { DEFAULT_UPDATE_URL } from "../electron/app-updater.mjs";

const secretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
};

test("多套模型配置加密保存后可以完整恢复", () => {
  const settings = {
    endpoint: " https://one.example/v1/chat/completions ",
    model: " model-one ",
    apiKey: " current-key ",
    visionEndpoint: " https://vision.example/v1/chat/completions ",
    visionModel: " vision-model ",
    visionApiKey: " vision-key ",
    reviewerEndpoint: " http://127.0.0.1:11434/v1/chat/completions ",
    reviewerModel: " qwen3:4b ",
    reviewerApiKey: " reviewer-key ",
    reviewerBackend: "local",
    profiles: [
      {
        id: "one",
        name: "模型一",
        endpoint: "https://one.example/v1/chat/completions",
        model: "model-one",
        apiKey: "key-one",
      },
      {
        id: "two",
        name: "模型二",
        endpoint: "https://two.example/v1/chat/completions",
        model: "model-two",
        apiKey: "key-two",
        transcriptionEndpoint: "https://two.example/v1/audio/transcriptions",
        transcriptionModel: "whisper-two",
      },
    ],
    preventSleep: "tasks",
    mcpServers: [],
  };

  const stored = serializeSettings(settings, secretStorage);
  const raw = JSON.stringify(stored);
  assert.equal(raw.includes("current-key"), false);
  assert.equal(raw.includes("vision-key"), false);
  assert.equal(raw.includes("reviewer-key"), false);
  assert.equal(raw.includes("key-one"), false);
  assert.equal(raw.includes("key-two"), false);
  assert.equal(stored.profiles.every((profile) => profile.encrypted), true);

  const restored = deserializeSettings(stored, secretStorage);
  assert.equal(restored.endpoint, "https://one.example/v1/chat/completions");
  assert.equal(restored.model, "model-one");
  assert.equal(restored.apiKey, "current-key");
  assert.equal(restored.visionEndpoint, "https://vision.example/v1/chat/completions");
  assert.equal(restored.visionModel, "vision-model");
  assert.equal(restored.visionApiKey, "vision-key");
  assert.equal(restored.reviewerEndpoint, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(restored.reviewerModel, "qwen3:4b");
  assert.equal(restored.reviewerApiKey, "reviewer-key");
  assert.equal(restored.reviewerBackend, "local");
  // reviewerBackend 缺省时按是否填过自定义审核端点推断
  assert.equal(serializeSettings({ reviewerEndpoint: "https://x.example/v1", reviewerModel: "m1" }, secretStorage).reviewerBackend, "custom");
  assert.equal(serializeSettings({}, secretStorage).reviewerBackend, "main");
  assert.deepEqual(restored.profiles.map(({ id, apiKey }) => ({ id, apiKey })), [
    { id: "one", apiKey: "key-one" },
    { id: "two", apiKey: "key-two" },
  ]);
  assert.equal(restored.profiles[1].transcriptionModel, "whisper-two");
});

test("技能库配置会随设置保存，并为旧设置补上 SkillHub", () => {
  const stored = serializeSettings({ skillLibraries: [{ id: "skillhub", enabled: false }] }, secretStorage);
  assert.equal(stored.skillLibraries.find((item) => item.id === "skillhub")?.enabled, false);
  assert.equal(stored.skillLibraries.find((item) => item.id === "skillhub")?.websiteUrl, "https://skillhub.cn/");

  const restored = deserializeSettings({ profiles: [] }, secretStorage);
  assert.equal(restored.skillLibraries.length, 1);
  assert.equal(restored.skillLibraries[0].id, "skillhub");
  assert.equal(restored.skillLibraries[0].enabled, true);
});

test("应用更新地址默认使用 GitHub，并可保存自定义仓库", () => {
  assert.equal(deserializeSettings({ profiles: [] }, secretStorage).updateUrl, DEFAULT_UPDATE_URL);
  const stored = serializeSettings({ updateUrl: " https://github.com/example/dyworker-updates/ " }, secretStorage);
  assert.equal(stored.updateUrl, "https://github.com/example/dyworker-updates");
  assert.equal(deserializeSettings(stored, secretStorage).updateUrl, "https://github.com/example/dyworker-updates");
  assert.equal(deserializeSettings({ updateUrl: "not-a-url", profiles: [] }, secretStorage).updateUrl, DEFAULT_UPDATE_URL);
});

test("旧版单模型设置仍可读取且自动迁移为第一套配置", () => {
  const legacy = {
    endpoint: "https://legacy.example/v1/chat/completions",
    model: "legacy-model",
    apiKey: "legacy-key",
    encrypted: false,
  };
  const restored = deserializeSettings(legacy, secretStorage);

  assert.equal(needsSecretMigration(legacy), true);
  assert.equal(restored.apiKey, "legacy-key");
  assert.equal(restored.profiles.length, 1);
  assert.equal(restored.profiles[0].model, "legacy-model");
  assert.equal(restored.profiles[0].apiKey, "legacy-key");
  assert.equal(restored.transcriptionModel, "whisper-1");

  const migrated = serializeSettings(restored, secretStorage);
  assert.equal(needsSecretMigration(migrated), false);
  assert.equal(JSON.stringify(migrated).includes("legacy-key"), false);
  assert.equal(migrated.encrypted, true);
  assert.equal(migrated.profiles[0].encrypted, true);
});

test("应用改名后旧加密密钥无法解密时被准确统计", () => {
  const brokenStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: () => {
      throw new Error("无法解密");
    },
  };
  const stored = {
    apiKey: "current-key",
    encrypted: true,
    visionApiKey: "vision-key",
    visionApiKeyEncrypted: true,
    profiles: [
      {
        id: "one",
        endpoint: "https://one.example/v1/chat/completions",
        model: "model-one",
        apiKey: "key-one",
        encrypted: true,
      },
    ],
    channels: {
      qq: {
        enabled: true,
        appId: "app-id",
        appSecret: "qq-secret",
        appSecretEncrypted: true,
      },
    },
  };
  assert.equal(countUndecryptableSecrets(stored, brokenStorage), 4);
  assert.equal(countUndecryptableSecrets({ ...stored, encrypted: false }, brokenStorage), 3);
  assert.equal(countUndecryptableSecrets({ apiKey: "", encrypted: true }, brokenStorage), 0);
  assert.equal(countUndecryptableSecrets({ apiKey: "plain", encrypted: false }, brokenStorage), 0);
});

test("用户明确删除全部配置后不会被当前连接重新创建", () => {
  const restored = deserializeSettings({
    endpoint: "https://current.example/v1/chat/completions",
    model: "current-model",
    apiKey: "current-key",
    encrypted: false,
    profileStoreVersion: 1,
    profiles: [],
  }, secretStorage);

  assert.deepEqual(restored.profiles, []);
});

test("重复和不完整配置不会污染保存结果", () => {
  const stored = serializeSettings({
    profiles: [
      { id: "valid", name: "有效", endpoint: "https://example.com", model: "m", apiKey: "" },
      { id: "duplicate", name: "重复", endpoint: "https://example.com", model: "m", apiKey: "" },
      { id: "missing-model", endpoint: "https://example.com", apiKey: "" },
    ],
  }, { isEncryptionAvailable: () => false });

  assert.equal(stored.profiles.length, 1);
  assert.equal(stored.profiles[0].id, "valid");
  assert.equal(stored.profiles[0].apiKey, "");
  assert.equal(stored.profiles[0].encrypted, false);
});

test("安全存储不可用时拒绝明文保存密钥", () => {
  assert.throws(() => serializeSettings({
    endpoint: "https://example.com",
    model: "model",
    apiKey: "must-not-be-plain",
    profiles: [],
  }, { isEncryptionAvailable: () => false }), /安全存储不可用/);
});

test("安全存储不可用时不启用旧版明文密钥", () => {
  const restored = deserializeSettings({
    endpoint: "https://legacy.example",
    model: "legacy",
    apiKey: "legacy-plain-key",
    encrypted: false,
  }, { isEncryptionAvailable: () => false });

  assert.equal(restored.apiKey, "");
  assert.deepEqual(restored.profiles, []);
});

test("桌面审批模式记住上次选择,旧省心模式迁移到自动审核", () => {
  const stored = serializeSettings({ approvalMode: "full-access", profiles: [] }, secretStorage);
  assert.equal(stored.approvalMode, "full-access");
  assert.equal(deserializeSettings(stored, secretStorage).approvalMode, "full-access");
  assert.equal(deserializeSettings({ approvalMode: "reviewer" }, secretStorage).approvalMode, "reviewer");
  assert.equal(serializeSettings({ approvalMode: "reviewer", profiles: [] }, secretStorage).approvalMode, "reviewer");
  assert.equal(deserializeSettings({ approvalMode: "allow-writes" }, secretStorage).approvalMode, "reviewer");
  assert.equal(deserializeSettings({ approvalMode: "bogus" }, secretStorage).approvalMode, "reviewer");
  assert.equal(deserializeSettings({}, secretStorage).approvalMode, "reviewer");
});

test("首次身份选择会保存并在下次启动恢复,旧设置保持待选择", () => {
  assert.equal(normalizeIdentity("general"), "general");
  assert.equal(normalizeIdentity("government"), "government");
  assert.equal(normalizeIdentity("unknown"), null);

  const stored = serializeSettings({ identity: "general", profiles: [] }, secretStorage);
  assert.equal(stored.identity, "general");
  assert.equal(deserializeSettings(stored, secretStorage).identity, "general");
  assert.equal(deserializeSettings({ profiles: [] }, secretStorage).identity, null);

  const government = serializeSettings({ identity: "government", profiles: [] }, secretStorage);
  assert.equal(deserializeSettings(government, secretStorage).identity, "government");
});

test("某条密钥无法解密时不影响其他配置恢复", () => {
  const restored = deserializeSettings({
    profiles: [
      { id: "bad", endpoint: "https://bad.example", model: "bad", apiKey: "not-base64", encrypted: true },
      { id: "plain", endpoint: "https://plain.example", model: "plain", apiKey: "plain-key", encrypted: false },
    ],
  }, {
    isEncryptionAvailable: () => true,
    decryptString: () => { throw new Error("broken"); },
  });

  assert.equal(restored.profiles[0].apiKey, "");
  assert.equal(restored.profiles[1].apiKey, "plain-key");
});

// 签名身份变化（换 bundle id / ad-hoc 重打包）后 safeStorage 暂时解不开旧密文：
// 此时迁移写盘或保存设置都不能把空值写回去覆盖密文，否则密钥永久丢失。
const undecryptableStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: () => {
    throw new Error("无法解密");
  },
};

test("解不开旧密文时序列化结果保留旧密钥密文", () => {
  const stored = serializeSettings({
    apiKey: "old-key",
    visionApiKey: "old-vision",
    ttsApiKey: "old-tts",
    reviewerApiKey: "old-reviewer",
    profiles: [{ id: "p1", name: "模型一", endpoint: "https://one.example/v1", model: "model-one", apiKey: "old-profile-key" }],
    channels: { qq: { enabled: true, appId: "app-id", appSecret: "old-qq" } },
  }, secretStorage);
  // 渲染端拿到的是解不开后的空值，保存时旧密文应全部保留
  const emptyView = deserializeSettings(stored, undecryptableStorage);
  assert.equal(emptyView.apiKey, "");
  const serialized = serializeSettings(emptyView, undecryptableStorage);
  const preserved = preserveUndecryptableSecrets(serialized, stored, undecryptableStorage);
  assert.equal(preserved.apiKey, stored.apiKey);
  assert.equal(preserved.encrypted, true);
  assert.equal(preserved.visionApiKey, stored.visionApiKey);
  assert.equal(preserved.ttsApiKey, stored.ttsApiKey);
  assert.equal(preserved.reviewerApiKey, stored.reviewerApiKey);
  assert.equal(preserved.profiles[0].apiKey, stored.profiles[0].apiKey);
  assert.equal(preserved.channels.qq.appSecret, stored.channels.qq.appSecret);
  // 换能解开的存储后密钥恢复可读
  const restored = deserializeSettings(preserved, secretStorage);
  assert.equal(restored.apiKey, "old-key");
  assert.equal(restored.profiles[0].apiKey, "old-profile-key");
  assert.equal(restored.channels.qq.appSecret, "old-qq");
});

test("旧密文能解开时用户主动清空密钥尊重清空", () => {
  const stored = serializeSettings({ apiKey: "old-key", profiles: [] }, secretStorage);
  const serialized = serializeSettings({ apiKey: "", profiles: [] }, secretStorage);
  const preserved = preserveUndecryptableSecrets(serialized, stored, secretStorage);
  assert.equal(preserved.apiKey, "");
});

test("填入新密钥时新值优先，不被旧密文覆盖", () => {
  const stored = serializeSettings({ apiKey: "old-key", profiles: [] }, secretStorage);
  const serialized = serializeSettings({ apiKey: "new-key", profiles: [] }, secretStorage);
  const preserved = preserveUndecryptableSecrets(serialized, stored, undecryptableStorage);
  assert.equal(deserializeSettings(preserved, secretStorage).apiKey, "new-key");
});
