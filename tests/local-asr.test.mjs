import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ASR_MODELS, DEFAULT_ASR_MODEL_ID, configureLocalAsr, localAsrAllModelsStatus, localAsrModelPaths, localAsrModelStatus, localAsrRuntimeStatus, normalizeAsrModelId } from "../electron/local-asr.mjs";
import { stripAsrText } from "../electron/local-asr-server.mjs";
import { deserializeSettings, normalizeTranscriptionEngine, serializeSettings } from "../electron/settings.mjs";

test("Qwen3-ASR 输出文本清理：剥掉 asr_text 标记、语言前缀与特殊 token", () => {
  assert.equal(stripAsrText("你好，世界"), "你好，世界");
  // b10621 实测输出：language 提示 + 开标记，标记经常没有闭合
  assert.equal(stripAsrText("language Chinese<asr_text>今天下午三点开项目评审会议。"), "今天下午三点开项目评审会议。");
  assert.equal(stripAsrText("language Chinese<asr_text>今天下午三点开项目评审会议。</asr_text>"), "今天下午三点开项目评审会议。");
  assert.equal(stripAsrText("<asr_text>你好，世界</asr_text>"), "你好，世界");
  // 无标记时按前缀剥：language + 语言名只在后面是 CJK/串尾才剥，避免误伤英文正文
  assert.equal(stripAsrText("language Chinese今天"), "今天");
  assert.equal(stripAsrText("language is a tool"), "language is a tool");
  assert.equal(stripAsrText("zh <asr_text>你好</asr_text>"), "你好");
  assert.equal(stripAsrText("en, hello world"), "hello world");
  assert.equal(stripAsrText("<|zh|>你好"), "你好");
  assert.equal(stripAsrText("  "), "");
});

test("多模型注册表：候选模型元数据齐全，非法 ID 回落默认模型", () => {
  const ids = Object.keys(ASR_MODELS);
  assert.ok(ids.length >= 4, `至少提供 4 个候选模型，实际 ${ids.length}`);
  for (const id of ids) {
    const definition = ASR_MODELS[id];
    assert.ok(definition.label, `${id} 缺少 label`);
    assert.ok(definition.repo, `${id} 缺少 repo`);
    assert.ok(definition.note, `${id} 缺少 note`);
    // 每个模型都是 text 解码器 + mmproj 编码器两件套，且带大小与 sha256
    assert.equal(definition.files.length, 2);
    for (const file of definition.files) {
      assert.ok(file.fileName.endsWith(".gguf"));
      assert.ok(file.bytes > 0);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
    }
  }
  assert.equal(DEFAULT_ASR_MODEL_ID, "qwen3-asr-0.6b");
  assert.equal(normalizeAsrModelId("qwen3-asr-1.7b"), "qwen3-asr-1.7b");
  assert.equal(normalizeAsrModelId("不存在的模型"), DEFAULT_ASR_MODEL_ID);
  assert.equal(normalizeAsrModelId(""), DEFAULT_ASR_MODEL_ID);
  assert.equal(normalizeAsrModelId(undefined), DEFAULT_ASR_MODEL_ID);
});

test("模型状态：未配置目录时按未初始化处理，文件大小不符不算下载完成", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-asr-"));
  try {
    configureLocalAsr({ modelDir: tmp, binDir: path.join(tmp, "bin") });
    const paths = localAsrModelPaths(DEFAULT_ASR_MODEL_ID);
    const defaultFiles = ASR_MODELS[DEFAULT_ASR_MODEL_ID].files;
    assert.equal(paths.length, defaultFiles.length);
    assert.ok(paths.every((item) => item.startsWith(tmp)));

    const empty = localAsrModelStatus(DEFAULT_ASR_MODEL_ID);
    assert.equal(empty.configured, true);
    assert.equal(empty.downloaded, false);
    assert.equal(empty.files.every((file) => file.downloaded === false), true);

    // 大小不符的文件不算下载完成，避免半截文件被当成可用模型
    fs.writeFileSync(paths[0], Buffer.alloc(1024));
    const partial = localAsrModelStatus(DEFAULT_ASR_MODEL_ID);
    assert.equal(partial.files[0].downloaded, false);
    assert.equal(partial.files[0].sizeBytes, 1024);
    assert.equal(partial.downloaded, false);

    // 不同模型的路径互不相同（各自独立下载与校验）
    const otherId = Object.keys(ASR_MODELS).find((id) => id !== DEFAULT_ASR_MODEL_ID);
    const otherPaths = localAsrModelPaths(otherId);
    assert.equal(otherPaths.length, ASR_MODELS[otherId].files.length);
    assert.ok(otherPaths.every((item) => !paths.includes(item)));

    // 全量概要覆盖所有候选模型，供设置界面下拉列表使用
    const all = localAsrAllModelsStatus();
    assert.deepEqual(all.map((model) => model.id), Object.keys(ASR_MODELS));
    assert.ok(all.every((model) => model.label && model.note && model.downloaded === false));

    // 未配置目录时路径与状态按空处理
    configureLocalAsr({});
    assert.ok(localAsrModelPaths(DEFAULT_ASR_MODEL_ID).every((item) => item === null));
    assert.equal(localAsrModelStatus(DEFAULT_ASR_MODEL_ID).configured, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("运行时状态：自定义路径优先，内置路径不存在时不可用", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-asr-bin-"));
  try {
    configureLocalAsr({ modelDir: tmp, binDir: path.join(tmp, "bin") });
    const missing = localAsrRuntimeStatus("");
    assert.equal(missing.available, false);
    assert.equal(missing.source, "none");
    assert.ok(missing.asset);

    // 自定义路径不存在时 available=false，存在时优先于内置
    const fake = path.join(tmp, "llama-server");
    assert.equal(localAsrRuntimeStatus(fake).available, false);
    fs.writeFileSync(fake, "#!/bin/sh\n");
    const custom = localAsrRuntimeStatus(fake);
    assert.equal(custom.available, true);
    assert.equal(custom.source, "custom");
    assert.equal(custom.path, fake);

    // 运行时整包解压到 runtime/ 子目录：二进制必须连着动态库一起用，
    // 旧布局（binDir 根下孤零零的二进制）缺 lib*.dylib 起不来，不算已安装
    const runtimeBin = path.join(tmp, "bin", "runtime", "llama-b10621", "llama-server");
    fs.mkdirSync(path.dirname(runtimeBin), { recursive: true });
    fs.writeFileSync(runtimeBin, "#!/bin/sh\n");
    assert.equal(localAsrRuntimeStatus("").available, true);
    assert.equal(localAsrRuntimeStatus("").source, "managed");
    assert.equal(localAsrRuntimeStatus("").path, runtimeBin);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("语音转写引擎字段：只认 local，其余一律回落 cloud，序列化往返保持", () => {
  assert.equal(normalizeTranscriptionEngine("local"), "local");
  assert.equal(normalizeTranscriptionEngine("cloud"), "cloud");
  assert.equal(normalizeTranscriptionEngine(""), "cloud");
  assert.equal(normalizeTranscriptionEngine(undefined), "cloud");
  assert.equal(normalizeTranscriptionEngine("Local"), "cloud");

  const secretStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const restored = deserializeSettings(serializeSettings({
    transcriptionEngine: "local",
    asrModel: " qwen3-asr-1.7b ",
    asrModelDir: " /tmp/asr-models ",
    llamaServerPath: " /opt/llama-server ",
  }, secretStorage), secretStorage);
  assert.equal(restored.transcriptionEngine, "local");
  assert.equal(restored.asrModel, "qwen3-asr-1.7b");
  assert.equal(restored.asrModelDir, "/tmp/asr-models");
  assert.equal(restored.llamaServerPath, "/opt/llama-server");

  const fallback = deserializeSettings({}, secretStorage);
  assert.equal(fallback.transcriptionEngine, "cloud");
  assert.equal(fallback.asrModel, DEFAULT_ASR_MODEL_ID);
  assert.equal(fallback.asrModelDir, "");
  assert.equal(fallback.llamaServerPath, "");

  // 非法模型 ID 序列化时回落默认模型，不会把脏值写进磁盘
  const invalid = deserializeSettings(serializeSettings({ asrModel: "fake-model" }, secretStorage), secretStorage);
  assert.equal(invalid.asrModel, DEFAULT_ASR_MODEL_ID);
});
