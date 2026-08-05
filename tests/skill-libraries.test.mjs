import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SKILL_LIBRARIES, installSkillFromLibrary, normalizeSkillLibraries, searchSkillLibraries } from "../electron/skill-libraries.mjs";

test("技能库配置默认接入 SkillHub，并保留未来来源", () => {
  const libraries = normalizeSkillLibraries([
    { id: "skillhub", enabled: false },
    { id: "internal", name: "内部技能库", enabled: true, websiteUrl: "https://skills.example.com" },
  ]);

  assert.deepEqual(libraries.find((item) => item.id === "skillhub"), {
    ...DEFAULT_SKILL_LIBRARIES[0],
    enabled: false,
  });
  assert.equal(libraries.find((item) => item.id === "internal")?.name, "内部技能库");
  assert.equal(libraries.find((item) => item.id === "internal")?.enabled, true);
});

test("搜索会通过 SkillHub CLI 返回统一结果，并标记来源", async () => {
  const calls = [];
  const response = await searchSkillLibraries([DEFAULT_SKILL_LIBRARIES[0]], "pdf", {
    homeDir: "/tmp/dyworker-home",
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      return {
        stdout: JSON.stringify({
          count: 1,
          results: [{ slug: "pdf-tools", name: "PDF 工具", description: "处理 PDF 文件", version: "1.0.0" }],
        }),
        stderr: "",
      };
    },
  });

  assert.equal(response.warnings.length, 0);
  assert.deepEqual(response.results, [{
    libraryId: "skillhub",
    libraryName: "SkillHub",
    slug: "pdf-tools",
    name: "PDF 工具",
    description: "处理 PDF 文件",
    version: "1.0.0",
  }]);
  assert.deepEqual(calls, [{
    command: "skillhub",
    args: [
      "--skip-self-upgrade",
      "search",
      "--json",
      "--search-url",
      "https://api.skillhub.cn/api/v1/search",
      "pdf",
    ],
  }]);
});

test("搜索失败时返回对应技能库的提示", async () => {
  const response = await searchSkillLibraries([DEFAULT_SKILL_LIBRARIES[0]], "合同", {
    execFileImpl: async () => {
      throw new Error("网络不可用");
    },
  });

  assert.equal(response.results.length, 0);
  assert.match(response.warnings[0], /SkillHub/);
});

test("安装使用固定的用户技能目录，并返回 CLI 结果", async () => {
  let received;
  const result = await installSkillFromLibrary([DEFAULT_SKILL_LIBRARIES[0]], "skillhub", "pdf-tools", {
    homeDir: "/tmp/dyworker-home",
    execFileImpl: async (command, args) => {
      received = { command, args };
      return { stdout: JSON.stringify({ success: true, slug: "pdf-tools", targetDir: "/tmp/dyworker-home/.agents/skills/pdf-tools" }), stderr: "" };
    },
  });

  assert.deepEqual(received, {
    command: "skillhub",
    args: [
      "--skip-self-upgrade",
      "install",
      "pdf-tools",
      "--dir",
      "/tmp/dyworker-home/.agents/skills",
      "--search-url",
      "https://api.skillhub.cn/api/v1/search",
      "--json",
    ],
  });
  assert.equal(result.targetDir, "/tmp/dyworker-home/.agents/skills/pdf-tools");
});
