// 本地决策模型（Intern-Decision）：注册表、下载状态、Python 运行时状态与决策客户端 local 分支。
// 下载用预置完整文件跳过网络（pending 为空）；运行时只测状态判定，不起真实 Python。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DECISION_MODELS,
  DEFAULT_DECISION_MODEL_ID,
  assertDiskSpace,
  configureLocalDecision,
  decisionRuntimeStatus,
  downloadLocalDecisionModel,
  localDecisionAllModelsStatus,
  localDecisionModelPaths,
  localDecisionModelStatus,
  normalizeDecisionModelId,
} from "../electron/local-decision.mts";
import { decisionServiceMode, requestToolsetRoute } from "../electron/agent/decision-client.mts";
import { deserializeSettings, normalizeDecisionService, serializeSettings } from "../electron/settings.mts";

test("决策模型注册表：物料元数据齐全，非法 ID 回落默认模型", () => {
  const ids = Object.keys(DECISION_MODELS);
  assert.ok(ids.length >= 1, "至少提供 1 个候选模型");
  for (const id of ids) {
    const definition = DECISION_MODELS[id];
    assert.ok(definition.label, `${id} 缺少 label`);
    assert.match(definition.repo, /^Shanghai_AI_Laboratory\//, `${id} 缺少 ModelScope 仓库`);
    assert.ok(definition.note, `${id} 缺少 note`);
    for (const file of definition.files) {
      assert.ok(file.fileName.length > 0);
      assert.ok(file.bytes > 0, `${id}/${file.fileName} 缺少字节数`);
      assert.match(file.sha256, /^[0-9a-f]{64}$/, `${id}/${file.fileName} sha256 形状不对`);
    }
    // 推理代码与依赖清单必须随权重同仓分发，官方 inference.py 默认校准才有意义
    assert.ok(definition.files.some((file) => file.fileName === "inference.py"), `${id} 缺少 inference.py`);
    assert.ok(definition.files.some((file) => file.fileName === "requirements.txt"), `${id} 缺少 requirements.txt`);
    assert.ok(definition.files.some((file) => file.fileName.endsWith(".safetensors")), `${id} 缺少权重文件`);
  }
  assert.equal(DEFAULT_DECISION_MODEL_ID, "intern-decision-2b");
  assert.equal(normalizeDecisionModelId("intern-decision-2b"), "intern-decision-2b");
  assert.equal(normalizeDecisionModelId("不存在的模型"), DEFAULT_DECISION_MODEL_ID);
  assert.equal(normalizeDecisionModelId(""), DEFAULT_DECISION_MODEL_ID);
  assert.equal(normalizeDecisionModelId(undefined), DEFAULT_DECISION_MODEL_ID);
});

test("决策模型状态：未配置目录按未初始化处理，文件大小不符不算下载完成", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-decision-"));
  try {
    configureLocalDecision({ modelDir: tmp, venvDir: path.join(tmp, "venv") });
    const paths = localDecisionModelPaths(DEFAULT_DECISION_MODEL_ID);
    const defaultFiles = DECISION_MODELS[DEFAULT_DECISION_MODEL_ID].files;
    assert.equal(paths.length, defaultFiles.length);
    assert.ok(paths.every((item) => item.startsWith(tmp)));

    const empty = localDecisionModelStatus(DEFAULT_DECISION_MODEL_ID);
    assert.equal(empty.configured, true);
    assert.equal(empty.downloaded, false);
    assert.equal(empty.files.every((file) => file.downloaded === false), true);

    // 大小不符的文件不算下载完成，避免半截权重被当成可用模型
    fs.writeFileSync(paths.at(-1), Buffer.alloc(1024));
    const partial = localDecisionModelStatus(DEFAULT_DECISION_MODEL_ID);
    assert.equal(partial.files.at(-1).downloaded, false);
    assert.equal(partial.files.at(-1).sizeBytes, 1024);
    assert.equal(partial.downloaded, false);

    // 全量概要覆盖所有候选模型，供设置界面下拉列表使用
    const all = localDecisionAllModelsStatus();
    assert.deepEqual(all.map((model) => model.id), Object.keys(DECISION_MODELS));
    assert.ok(all.every((model) => model.label && model.note && model.downloaded === false));

    // 未配置目录时路径与状态按空处理
    configureLocalDecision({});
    assert.ok(localDecisionModelPaths(DEFAULT_DECISION_MODEL_ID).every((item) => item === null));
    assert.equal(localDecisionModelStatus(DEFAULT_DECISION_MODEL_ID).configured, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("运行时状态：venv 解释器与依赖标记齐备才可用", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-decision-rt-"));
  try {
    const venvDir = path.join(tmp, "venv");
    configureLocalDecision({ modelDir: tmp, venvDir });
    assert.equal(decisionRuntimeStatus().available, false);

    const venvPython = process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");
    fs.mkdirSync(path.dirname(venvPython), { recursive: true });
    fs.writeFileSync(venvPython, "#!/bin/sh\n");
    // 只有解释器、没有依赖完成标记：还装不上 torch，不算可用
    assert.equal(decisionRuntimeStatus().available, false);

    const marker = path.join(venvDir, ".dyw-deps-ready");
    fs.writeFileSync(marker, "a07f8990947cc3fa39800d510ebc6b995a15466656e339b485c0a632ef4cdb6e\n");
    const ready = decisionRuntimeStatus();
    assert.equal(ready.available, true);
    assert.equal(ready.venvPython, venvPython);
    assert.equal(ready.venvDir, venvDir);

    configureLocalDecision({});
    assert.equal(decisionRuntimeStatus().available, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("模型下载：按清单顺序逐文件下载并做 sha256 校验（用 requirements.txt 小文件走真实路径）", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-decision-dl-"));
  try {
    configureLocalDecision({ modelDir: tmp, venvDir: path.join(tmp, "venv") });
    // 清单首位是 requirements.txt（69 字节，官方内容哈希已知）：只 serve 它，
    // 下载到下一个文件即中断——既验证真实下载与校验链路，又不落 GB 级权重
    const content = "torch==2.9.1\ntorchvision==0.24.1\ntransformers==5.14.1\nPillow>=10.0.0\n";
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/resolve/master/requirements.txt")) return new Response(content);
      throw new Error(`不该请求：${url}`);
    };
    // 本机磁盘真实余量不可假设：单测关闭空间守卫，守卫行为由上一个用例单独验证
    await assert.rejects(() => downloadLocalDecisionModel({ fetchImpl, checkSpace: false }), /inference\.py/);
    const requirementPath = path.join(tmp, "requirements.txt");
    assert.equal(fs.readFileSync(requirementPath, "utf8"), content);
    const status = localDecisionModelStatus(DEFAULT_DECISION_MODEL_ID);
    assert.equal(status.files[0].downloaded, true);
    assert.equal(status.files.find((file) => file.fileName === "inference.py").downloaded, false);
    assert.equal(status.downloaded, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("决策服务方式字段：只认 local，其余一律回落 remote，序列化往返保持", () => {
  assert.equal(normalizeDecisionService("local"), "local");
  assert.equal(normalizeDecisionService("remote"), "remote");
  assert.equal(normalizeDecisionService(""), "remote");
  assert.equal(normalizeDecisionService(undefined), "remote");
  assert.equal(normalizeDecisionService("Local"), "remote");
  assert.equal(decisionServiceMode({ decisionService: "local" }), "local");
  assert.equal(decisionServiceMode({ decisionService: "remote" }), "remote");
  assert.equal(decisionServiceMode({}), "remote");
  assert.equal(decisionServiceMode(undefined), "remote");

  const secretStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const restored = deserializeSettings(serializeSettings({
    decisionService: "local",
    decisionLocalModel: " intern-decision-2b ",
    decisionModelDir: " /tmp/decision-models ",
  }, secretStorage), secretStorage);
  assert.equal(restored.decisionService, "local");
  assert.equal(restored.decisionLocalModel, "intern-decision-2b");
  assert.equal(restored.decisionModelDir, "/tmp/decision-models");

  const fallback = deserializeSettings({}, secretStorage);
  assert.equal(fallback.decisionService, "remote");
  assert.equal(fallback.decisionLocalModel, DEFAULT_DECISION_MODEL_ID);
  assert.equal(fallback.decisionModelDir, "");

  // 非法模型 ID 序列化时回落默认模型，不会把脏值写进磁盘
  const invalid = deserializeSettings(serializeSettings({ decisionLocalModel: "fake-model" }, secretStorage), secretStorage);
  assert.equal(invalid.decisionLocalModel, DEFAULT_DECISION_MODEL_ID);
});

test("磁盘余量守卫：空间充足时放行，目录不存在时自动创建不误拦", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dyworker-decision-disk-"));
  try {
    const target = path.join(tmp, "not-created-yet");
    assert.doesNotThrow(() => assertDiskSpace(target, 1024));
    assert.equal(fs.existsSync(target), true);
    // 请求不可能满足的巨量空间：明确报"磁盘空间不足"而不是静默放行
    assert.throws(() => assertDiskSpace(tmp, Number.MAX_SAFE_INTEGER), /磁盘空间不足/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("本地托管预路由：服务未运行直接返回空数组，不发起请求也不要求端点", async () => {
  const calls = [];
  const refused = async (...args) => { calls.push(args); throw new Error("不应该发起网络请求"); };
  const settings = { decisionService: "local", decisionEndpoint: "", decisionLocalModel: "intern-decision-2b", toolsetRouteThreshold: 0.5 };
  const routed = await requestToolsetRoute({
    settings,
    query: "帮我把这个网页存成 PDF",
    groups: [{ name: "browser", summary: "后台浏览器" }],
    fetchImpl: refused,
  });
  assert.deepEqual(routed, []);
  assert.equal(calls.length, 0);
});
