import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configureLocalAsr } from "../electron/local-asr.mjs";
import { localTtsReady } from "../electron/local-tts-engine.mjs";
import { configureLocalTts, DEFAULT_TTS_MODEL_ID, localTtsAllModelsStatus, localTtsModelPaths, localTtsModelStatus, localTtsRuntimeStatus, normalizeTtsModelId, TTS_MODELS } from "../electron/local-tts.mjs";
import { deserializeSettings, normalizeTtsEngine, serializeSettings } from "../electron/settings.mjs";

test("TTS 模型状态：未配置目录时按未初始化处理，文件大小不符不算下载完成", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-tts-"));
  try {
    configureLocalTts({ modelDir: tmp });
    const paths = localTtsModelPaths();
    assert.equal(paths.length, TTS_MODELS[DEFAULT_TTS_MODEL_ID].files.length);
    assert.ok(paths.every((item) => item.startsWith(tmp)));

    const empty = localTtsModelStatus();
    assert.equal(empty.configured, true);
    assert.equal(empty.downloaded, false);
    assert.equal(empty.files[0].role, "backbone");
    assert.equal(empty.files[1].role, "speaker-encoder");

    // 大小不符的文件不算下载完成，避免半截文件被当成可用模型
    fs.writeFileSync(paths[0], Buffer.alloc(2048));
    const partial = localTtsModelStatus();
    assert.equal(partial.files[0].downloaded, false);
    assert.equal(partial.files[0].sizeBytes, 2048);
    assert.equal(partial.downloaded, false);

    configureLocalTts({});
    assert.ok(localTtsModelPaths().every((item) => item === null));
    assert.equal(localTtsModelStatus().configured, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("TTS 多模型：非法 id 回落默认模型，各档位状态与下载路径独立", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-tts-models-"));
  try {
    assert.equal(normalizeTtsModelId(""), DEFAULT_TTS_MODEL_ID);
    assert.equal(normalizeTtsModelId("not-a-model"), DEFAULT_TTS_MODEL_ID);
    assert.equal(normalizeTtsModelId("qwen3-tts-1.7b-q4"), "qwen3-tts-1.7b-q4");

    configureLocalTts({ modelDir: tmp, modelId: "qwen3-tts-1.7b-q4" });
    const q4Paths = localTtsModelPaths();
    assert.ok(q4Paths[0].includes("Q4_K_M"));
    assert.equal(localTtsModelStatus().id, "qwen3-tts-1.7b-q4");
    assert.equal(localTtsModelStatus("qwen3-tts-1.7b-q8").id, "qwen3-tts-1.7b-q8");

    // 两档共用同一个 speaker 编码器文件
    assert.equal(q4Paths[1], localTtsModelPaths("qwen3-tts-1.7b-q8")[1]);

    // 各档位按自己的文件清单汇总：id 齐全、预期字节数按档位区分、未下载时都不可用
    const all = localTtsAllModelsStatus();
    assert.deepEqual(all.map((model) => model.id), Object.keys(TTS_MODELS));
    assert.ok(all.every((model) => !model.downloaded));
    assert.equal(all.find((model) => model.id === "qwen3-tts-1.7b-q4").expectedBytes, 1035965280 + 446422912);
    assert.equal(all.find((model) => model.id === "qwen3-tts-1.7b-q8").expectedBytes, 1847874400 + 446422912);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("TTS 运行时与 ASR 共用 llama.cpp 包：runtime 目录里没有 llama-tts 时不可用，有即可用", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-tts-bin-"));
  try {
    configureLocalAsr({ modelDir: tmp, binDir: path.join(tmp, "bin") });
    assert.equal(localTtsRuntimeStatus().available, false);

    // 运行时整包解压到 bin/runtime/（二进制 + 同目录动态库），旧布局根下孤二进制不认
    const exe = process.platform === "win32" ? "llama-tts.exe" : "llama-tts";
    const binPath = path.join(tmp, "bin", "runtime", "llama-b10621", exe);
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    fs.writeFileSync(binPath, "#!/bin/sh\n");
    const runtime = localTtsRuntimeStatus();
    assert.equal(runtime.available, true);
    assert.equal(runtime.path, binPath);
    assert.equal(runtime.binDir, path.join(tmp, "bin"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("localTtsReady：模型或引擎缺失时给出可操作的错误提示", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-tts-ready-"));
  try {
    configureLocalAsr({ modelDir: tmp, binDir: path.join(tmp, "bin") });
    configureLocalTts({ modelDir: path.join(tmp, "models") });
    const missingModel = localTtsReady();
    assert.equal(missingModel.ok, false);
    assert.match(missingModel.error, /模型还没下载/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("语音合成引擎字段：只认 local，其余一律回落 cloud，序列化往返保持", () => {
  assert.equal(normalizeTtsEngine("local"), "local");
  assert.equal(normalizeTtsEngine("cloud"), "cloud");
  assert.equal(normalizeTtsEngine(""), "cloud");
  assert.equal(normalizeTtsEngine(undefined), "cloud");
  assert.equal(normalizeTtsEngine("Local"), "cloud");

  const secretStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const restored = deserializeSettings(serializeSettings({
    ttsEngine: "local",
    ttsLocalModel: "not-a-model",
    ttsModelDir: " /tmp/tts-models ",
    ttsVoicePath: " /tmp/voice.wav ",
  }, secretStorage), secretStorage);
  assert.equal(restored.ttsEngine, "local");
  assert.equal(restored.ttsLocalModel, DEFAULT_TTS_MODEL_ID);
  assert.equal(restored.ttsModelDir, "/tmp/tts-models");
  assert.equal(restored.ttsVoicePath, "/tmp/voice.wav");

  const fallback = deserializeSettings({}, secretStorage);
  assert.equal(fallback.ttsEngine, "cloud");
  assert.equal(fallback.ttsLocalModel, DEFAULT_TTS_MODEL_ID);
  assert.equal(fallback.ttsModelDir, "");
  assert.equal(fallback.ttsVoicePath, "");
});
