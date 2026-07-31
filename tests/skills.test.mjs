import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverFileSkills, mergeSkillRecords, parseSkillDocument } from "../electron/skills.mjs";

async function writeSkill(root, directory, contents) {
  const folder = path.join(root, directory);
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, "SKILL.md");
  await fs.writeFile(file, contents, "utf8");
  return file;
}

test("解析 Codex SKILL.md 的名称、说明和完整执行内容", () => {
  const parsed = parseSkillDocument(`---
name: agent-browser
description: "Browser automation for agents"
hidden: true
---

# Agent Browser

Run the browser workflow.
`, "/tmp/agent-browser/SKILL.md", "global");
  assert.equal(parsed.name, "agent-browser");
  assert.equal(parsed.description, "Browser automation for agents");
  assert.match(parsed.instructions, /Run the browser workflow/);
  assert.equal(parsed.source, "global");
  assert.equal(parsed.readOnly, true);
});

test("解析带 chomping 标记的折叠式技能说明", () => {
  const parsed = parseSkillDocument(`---
name: folded-description
description: >-
  第一行说明，
  第二行继续。
---

执行内容
`, "/tmp/folded-description/SKILL.md", "global");
  assert.equal(parsed.description, "第一行说明， 第二行继续。");
});

test("自动发现用户级和工作区技能，工作区同名技能优先", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-skills-test-"));
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  await writeSkill(home, ".agents/skills/agent-browser", `---
name: agent-browser
description: 用户级浏览器技能
---
用户级内容`);
  await writeSkill(home, ".agent/skills/legacy-skill", `---
name: legacy-skill
description: 兼容旧目录
---
旧目录内容`);
  await writeSkill(home, ".codex/skills/pdf", `---
name: pdf
description: PDF 技能
---
PDF 内容`);
  const workspaceSkill = await writeSkill(workspace, ".agents/skills/agent-browser", `---
name: agent-browser
description: 当前工作区浏览器技能
---
工作区内容`);
  await writeSkill(workspace, ".codex/skills/local-review", `---
name: local-review
description: 当前项目复核
---
复核内容`);

  const skills = await discoverFileSkills({ homeDir: home, workspacePath: workspace });
  assert.deepEqual(skills.map((item) => item.name), ["agent-browser", "legacy-skill", "local-review", "pdf"]);
  const browser = skills.find((item) => item.name === "agent-browser");
  assert.equal(browser.source, "workspace");
  assert.equal(browser.path, workspaceSkill);
  assert.equal(browser.description, "当前工作区浏览器技能");
});

test("文件技能与内置模板合并，并应用持久化启停设置", () => {
  const fileSkill = {
    id: "file:/home/.agents/skills/agent-browser/SKILL.md",
    name: "agent-browser",
    description: "浏览器技能",
    instructions: "执行说明",
    enabled: true,
    source: "global",
    sourceLabel: "用户级",
    path: "/home/.agents/skills/agent-browser/SKILL.md",
    readOnly: true,
    createdAt: "2026-07-28T00:00:00.000Z",
  };
  const stored = [{
    id: "saved-1",
    name: "周报",
    description: "工作模板",
    instructions: "模板说明",
    enabled: true,
    createdAt: "2026-07-28T00:00:00.000Z",
  }];
  const merged = mergeSkillRecords(stored, [fileSkill], { [fileSkill.id]: false });
  assert.deepEqual(merged.map((item) => item.name), ["agent-browser", "周报"]);
  assert.equal(merged[0].enabled, false);
  assert.equal(merged[1].source, "saved");
  assert.equal(merged[1].sourceLabel, "本地模板");
});
