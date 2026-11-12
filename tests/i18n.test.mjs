import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "../src/i18n/locales");

const SUPPORTED_LOCALES = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "es-ES",
  "fr-FR",
  "de-DE",
  "ko-KR",
];

const MENU_KEYS = [
  "model",
  "voice",
  "search",
  "channels",
  "identity",
  "appearance",
  "power",
  "updates",
  "about",
  "plugins",
  "memories",
  "knowledge",
  "skills",
  "skill-libraries",
  "plans",
  "usage",
  "telemetry",
  "hooks",
];

test("i18n: 8 种语言字典均完整存在且能正确解析", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const filePath = path.join(localesDir, `${locale}.json`);
    assert.ok(fs.existsSync(filePath), `缺失语言文件: ${filePath}`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    for (const key of MENU_KEYS) {
      assert.ok(content[`nav.${key}.label`], `${locale} 缺失菜单标签: nav.${key}.label`);
      assert.ok(content[`nav.${key}.desc`], `${locale} 缺失菜单描述: nav.${key}.desc`);
    }
  }
});

test("i18n: 中文新文案严格符合规范 (名称 2–4 字，描述 ≤ 20 字)", () => {
  const zhCN = JSON.parse(fs.readFileSync(path.join(localesDir, "zh-CN.json"), "utf-8"));

  for (const key of MENU_KEYS) {
    const label = zhCN[`nav.${key}.label`];
    const desc = zhCN[`nav.${key}.desc`];

    // 名称 2-4 字
    assert.ok(
      label.length >= 2 && label.length <= 4,
      `[zh-CN] 菜单名称「${label}」长度不符合 2–4 字规范 (当前长度: ${label.length})`
    );

    // 描述 ≤ 20 字
    assert.ok(
      desc.length <= 20,
      `[zh-CN] 菜单描述「${desc}」超过 20 字限制 (当前长度: ${desc.length})`
    );
  }
});

test("i18n: 系统提示词 (System Prompt) 支持 8 种主流语言原生母语配置", async () => {
  const { systemPrompt, getPromptDefinition } = await import("../electron/agent/prompt.mts");

  const expectedIdentitySnippets = {
    "zh-CN": "你是 DYWorker，面向个人、企业、开发者和各类组织的本地工作助手",
    "zh-TW": "你是 DYWorker，為個人、企業、開發者與各類組織打造的本機工作助理",
    "en-US": "You are DYWorker, a local workspace assistant for individuals, developers, and teams",
    "es-ES": "Eres DYWorker, un asistente local de trabajo para particulares, desarrolladores y equipos",
    "ja-JP": "DYWorker は、個人、開発者、チームのためのローカル作業アシスタントです",
    "fr-FR": "Vous êtes DYWorker, un assistant de travail local pour particuliers, développeurs et équipes",
    "de-DE": "Sie sind DYWorker, ein lokaler Arbeitsassistent für Einzelpersonen, Entwickler und Teams",
    "ko-KR": "DYWorker는 개인, 개발자 및 팀을 위한 로컬 업무 어시스턴트로",
  };

  for (const locale of SUPPORTED_LOCALES) {
    const prompt = systemPrompt("/tmp/workspace", { enabled: false }, false, "测试目标", "general", locale);
    assert.ok(prompt, `${locale} 系统提示词未生成`);
    assert.ok(prompt.includes(expectedIdentitySnippets[locale]), `${locale} 提示词未包含对应的原生母语身份声明`);
    assert.ok(prompt.includes("/tmp/workspace"), `${locale} 提示词未包含工作区路径`);

    const def = getPromptDefinition(locale);
    assert.ok(def.subAgentGreeting, `${locale} 缺少子代理母语问候语`);
    assert.ok(def.dispatchAdvice, `${locale} 缺少派发子任务母语建议`);
  }

  // 验证 dyworker-gov 政务版隔离保护：government 模式无论传入何种 locale，均锁定中文且包含公文规范
  const govPrompt = systemPrompt("/tmp/workspace", null, false, "", "government", "en-US");
  assert.ok(govPrompt.includes("服务政府单位办公人员的本地工作助手"), "政务版未正确降级为中文政府助手");
  assert.ok(govPrompt.includes("GB/T 9704"), "政务版未包含公文国标 GB/T 9704");
});

test("i18n: 作者名称规范 (非中文环境使用 Dengyu Guan，中文环境使用管灯余)", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const filePath = path.join(localesDir, `${locale}.json`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (locale.startsWith("zh")) {
      assert.match(content["about.authorName"], /管[灯燈]余/, `${locale} 环境下作者名应为管灯余`);
    } else {
      assert.equal(content["about.authorName"], "Dengyu Guan", `${locale} 非中文环境下作者名必须为 Dengyu Guan`);
    }
  }
});

test("i18n: 页面新增核心词条在 8 种语言中完整对齐", () => {
  const REQUIRED_PAGE_KEYS = [
    "nav.settings",
    "common.newTask",
    "common.loading",
    "conversation.whatToWorkOn",
    "about.developer",
    "about.authorName",
    "updates.currentVersion",
    "updates.latest",
    "identity.title",
    "identity.hint",
    "identity.generalTitle",
    "identity.governmentTitle",
    "usage.clearRecords",
    "skills.skillhubDesc",
    "hooks.standingRules",
    "hooks.actionAllow",
    "hooks.actionBlock",
    "hooks.actionApproval",
    "hooks.builtinRules",
    "telemetry.cloudService",
    "telemetry.statsTitle",
    "telemetry.messagesTitle",
    "channels.runtimeSection",
    "channels.runtimeLabel",
    "channels.modelSection",
    "channels.qqTitle",
    "kb.title",
    "kb.formatDesc",
    "kb.exportKnowledge",
    "kb.dropZone",
    "kb.searchPlaceholder",
    "model.savedProfiles",
    "model.savedHint",
    "model.connection",
    "model.provider",
    "model.endpoint",
    "model.apiKey",
    "model.probe",
    "model.modelName",
    "model.modelsCount",
    "provider.glm",
    "provider.deepseek",
    "voice.asrSection",
    "voice.asrEngine",
    "voice.downloadModel",
    "voice.modelDir",
    "voice.ttsSection",
    "voice.ttsEngine",
    "voice.ttsPathPlaceholder",
    "telemetry.localStatusTitle",
    "telemetry.deleteData",
    "hooks.workspaceRuleNote",
    "chat.aiDisclaimer",
    "composer.editing",
    "composer.cancelQueued",
    "composer.cancelEdit",
    "composer.noticeEditLoaded",
  ];

  for (const locale of SUPPORTED_LOCALES) {
    const filePath = path.join(localesDir, `${locale}.json`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    for (const key of REQUIRED_PAGE_KEYS) {
      assert.ok(content[key], `${locale} 缺失核心词条: ${key}`);
    }
  }
});

