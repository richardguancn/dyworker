import assert from "node:assert/strict";
import test from "node:test";
import { countUndecryptableSecrets, deserializeSettings, needsSecretMigration, serializeSettings } from "../electron/settings.mjs";

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
  assert.equal(raw.includes("key-one"), false);
  assert.equal(raw.includes("key-two"), false);
  assert.equal(stored.profiles.every((profile) => profile.encrypted), true);

  const restored = deserializeSettings(stored, secretStorage);
  assert.equal(restored.endpoint, "https://one.example/v1/chat/completions");
  assert.equal(restored.model, "model-one");
  assert.equal(restored.apiKey, "current-key");
  assert.deepEqual(restored.profiles.map(({ id, apiKey }) => ({ id, apiKey })), [
    { id: "one", apiKey: "key-one" },
    { id: "two", apiKey: "key-two" },
  ]);
  assert.equal(restored.profiles[1].transcriptionModel, "whisper-two");
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
  assert.equal(countUndecryptableSecrets(stored, brokenStorage), 3);
  assert.equal(countUndecryptableSecrets({ ...stored, encrypted: false }, brokenStorage), 2);
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

test("桌面审批模式记住上次选择,非法值回退省心模式", () => {
  const stored = serializeSettings({ approvalMode: "full-access", profiles: [] }, secretStorage);
  assert.equal(stored.approvalMode, "full-access");
  assert.equal(deserializeSettings(stored, secretStorage).approvalMode, "full-access");
  assert.equal(deserializeSettings({ approvalMode: "reviewer" }, secretStorage).approvalMode, "reviewer");
  assert.equal(serializeSettings({ approvalMode: "reviewer", profiles: [] }, secretStorage).approvalMode, "reviewer");
  assert.equal(deserializeSettings({ approvalMode: "bogus" }, secretStorage).approvalMode, "allow-writes");
  assert.equal(deserializeSettings({}, secretStorage).approvalMode, "allow-writes");
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
