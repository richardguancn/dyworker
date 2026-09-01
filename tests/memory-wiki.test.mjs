import assert from "node:assert/strict";
import test from "node:test";
import { promises as fsp } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  applyConsolidation,
  buildConsolidationMessages,
  deriveIndexContent,
  ensureWiki,
  integrateItems,
  listWikiPages,
  pageRelPathForItem,
  parseConsolidationResult,
  parseMemoryRow,
  readWikiPages,
  removeWikiMemory,
  selectWikiPages,
  serializeMemoryRow,
  workspacePageRelPath,
} from "../electron/memory-wiki.mjs";

async function makeWikiRoot() {
  return await fsp.mkdtemp(path.join(os.tmpdir(), "memory-wiki-"));
}

const sampleItem = (overrides = {}) => ({
  id: "m1",
  category: "用户偏好",
  content: "以后汇报用中文",
  kind: "preference",
  scope: "global",
  workspacePath: "",
  ...overrides,
});

test("记忆条目按类型路由到页面", () => {
  assert.equal(pageRelPathForItem(sampleItem({ kind: "taboo" })), "pages/taboos.md");
  assert.equal(pageRelPathForItem(sampleItem({ category: "报告规则", kind: "rule" })), "pages/rules.md");
  assert.equal(pageRelPathForItem(sampleItem({ category: "用户画像" })), "pages/profile.md");
  const projectPage = pageRelPathForItem(sampleItem({ scope: "workspace", workspacePath: "/Users/gdy/Documents/My/App/dyworker", kind: "rule", category: "项目规则" }));
  assert.match(projectPage, /^pages\/projects\/dyworker-[0-9a-f]{6}\.md$/);
  assert.equal(workspacePageRelPath("/a/b"), workspacePageRelPath("/a/b/"));
});

test("记忆行的序列化与解析互逆", () => {
  const row = { content: "高铁票需要打印", id: "trip", kind: "fact", category: "出差", name: "" };
  const line = serializeMemoryRow(row);
  assert.deepEqual(parseMemoryRow(line), row);
  assert.equal(parseMemoryRow("- 没有 id 注释的行"), null);
});

test("命名记忆：行标记第 4 段名字向后兼容", () => {
  const named = { content: "报销先走 OA 再贴发票", id: "expense-flow", kind: "rule", category: "报销", name: "报销流程" };
  const line = serializeMemoryRow(named);
  assert.equal(line, "- 报销先走 OA 再贴发票 <!--mem:expense-flow|rule|报销|报销流程-->");
  assert.deepEqual(parseMemoryRow(line), named);
  // 旧格式 3 段行（无名字）依旧可解析，name 为空串
  const legacy = parseMemoryRow("- 以后汇报用中文 <!--mem:m1|preference|用户偏好-->");
  assert.equal(legacy.name, "");
  assert.equal(legacy.content, "以后汇报用中文");
  // 没有名字时不输出第 4 段，保持旧行格式不变
  const unnamed = serializeMemoryRow({ content: "高铁票需要打印", id: "trip", kind: "fact", category: "出差" });
  assert.equal(unnamed, "- 高铁票需要打印 <!--mem:trip|fact|出差-->");
});

test("会话记忆不进入 wiki 整合", async () => {
  const root = await makeWikiRoot();
  await ensureWiki(root, { items: [] });
  const added = await integrateItems(root, [
    sampleItem(),
    sampleItem({ id: "s1", scope: "session", sessionId: "sess-1", content: "本周统一用表格汇报", category: "临时约定", kind: "rule" }),
  ]);
  assert.equal(added, 1);
  const pages = await readWikiPages(root);
  const allRows = pages.flatMap((page) => page.rows.map((row) => row.content));
  assert.ok(allRows.includes("以后汇报用中文"));
  assert.ok(!allRows.includes("本周统一用表格汇报"));
});

test("ensureWiki 迁移旧扁平列表并生成目录和日志", async () => {
  const root = await makeWikiRoot();
  const items = [
    sampleItem(),
    sampleItem({ id: "m2", kind: "taboo", category: "用户禁忌", content: "不要在报告里夹带请示" }),
  ];
  const { created, integrated } = await ensureWiki(root, { items });
  assert.equal(created, true);
  assert.equal(integrated, 2);

  const pages = await readWikiPages(root);
  const withRows = pages.filter((page) => page.rows.length);
  assert.equal(withRows.length, 2);
  const taboos = pages.find((page) => page.relPath === "pages/taboos.md");
  assert.equal(taboos.rows.length, 1);
  assert.equal(taboos.rows[0].content, "不要在报告里夹带请示");

  const index = await fsp.readFile(path.join(root, "index.md"), "utf8");
  assert.match(index, /\[用户禁忌\]\(pages\/taboos\.md\)｜全局｜1 条/);
  const log = await fsp.readFile(path.join(root, "log.md"), "utf8");
  assert.match(log, /## \[.*\] ingest \| 初始化导入：新增 2 条记忆/);
});

test("integrateItems 幂等：重复 id 不会重复写入", async () => {
  const root = await makeWikiRoot();
  await ensureWiki(root, { items: [] });
  await integrateItems(root, [sampleItem()]);
  const added = await integrateItems(root, [sampleItem()]);
  assert.equal(added, 0);
  const pages = await readWikiPages(root);
  assert.equal(pages.find((page) => page.relPath === "pages/preferences.md").rows.length, 1);
});

test("工作区记忆落到项目页并只在对应工作区可见", async () => {
  const root = await makeWikiRoot();
  const workspacePath = path.normalize("/Users/gdy/work/project-a");
  await ensureWiki(root, { items: [sampleItem({ id: "p1", scope: "workspace", workspacePath, kind: "rule", category: "项目规则", content: "本项目必须跑 npm test" })] });
  const pages = await readWikiPages(root);
  const projectPage = pages.find((page) => page.scope === "workspace");
  assert.ok(projectPage);
  assert.equal(projectPage.workspacePath, workspacePath);

  const visible = selectWikiPages(pages, { workspacePath, query: "这个项目的规则是什么", limit: 3 });
  assert.ok(visible.some((page) => page.scope === "workspace"));
  const hidden = selectWikiPages(pages, { workspacePath: path.normalize("/Users/gdy/work/project-b"), query: "这个项目的规则是什么", limit: 3 });
  assert.ok(!hidden.some((page) => page.scope === "workspace"));
});

test("selectWikiPages 按查询相关性选页并给规则/禁忌加权", () => {
  const pages = [
    { relPath: "pages/facts.md", title: "常用信息", scope: "global", workspacePath: "", rows: [{ id: "t", kind: "fact", category: "出差", content: "高铁票需要打印" }], content: "# 常用信息\n\n- 高铁票需要打印" },
    { relPath: "pages/rules.md", title: "通用规则", scope: "global", workspacePath: "", rows: [{ id: "r", kind: "rule", category: "报告规则", content: "报告需要核对数据" }], content: "# 通用规则\n\n- 报告需要核对数据" },
  ];
  const selected = selectWikiPages(pages, { query: "整理报告并核对数据", limit: 1 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].relPath, "pages/rules.md");
  // 规则/禁忌页有基础加权（与旧记忆系统一致：规则和禁忌始终参与），事实页没有词面命中时不出场
  const fallback = selectWikiPages(pages, { query: "完全无关的查询词xyzq", limit: 3 });
  assert.ok(fallback.some((page) => page.relPath === "pages/rules.md"));
  assert.ok(!fallback.some((page) => page.relPath === "pages/facts.md"));
});

test("removeWikiMemory 删除条目并清理空项目页", async () => {
  const root = await makeWikiRoot();
  const workspacePath = path.normalize("/Users/gdy/work/project-a");
  await ensureWiki(root, { items: [sampleItem({ id: "p1", scope: "workspace", workspacePath, kind: "rule", category: "项目规则", content: "本项目必须跑 npm test" })] });
  assert.equal(await removeWikiMemory(root, "p1"), true);
  const pages = await readWikiPages(root);
  assert.ok(!pages.some((page) => page.scope === "workspace"));
  assert.equal(await removeWikiMemory(root, "不存在"), false);
});

test("LLM 整合：合法输出写盘并重建目录", async () => {
  const root = await makeWikiRoot();
  await ensureWiki(root, { items: [sampleItem()] });
  const result = parseConsolidationResult(JSON.stringify({
    pages: [
      { path: "pages/preferences.md", content: "# 用户偏好\n\n- 以后汇报用中文（含称呼） <!--mem:m1|preference|用户偏好-->" },
      { path: "pages/travel.md", content: "# 出差\n\n- 高铁票需要打印 <!--mem:trip|fact|出差-->" },
    ],
    logEntry: "合并偏好并新建出差页",
  }));
  assert.ok(result);
  const applied = await applyConsolidation(root, result);
  assert.equal(applied, 2);
  const pages = await readWikiPages(root);
  assert.equal(pages.find((page) => page.relPath === "pages/preferences.md").rows[0].content, "以后汇报用中文（含称呼）");
  const index = await fsp.readFile(path.join(root, "index.md"), "utf8");
  assert.match(index, /\[出差\]\(pages\/travel\.md\)/);
});

test("LLM 整合：路径穿越和非法输出被拒绝", async () => {
  const root = await makeWikiRoot();
  await ensureWiki(root, { items: [] });
  assert.equal(await applyConsolidation(root, { pages: [{ path: "../escape.md", content: "# x" }] }), 0);
  assert.equal(await applyConsolidation(root, { pages: [{ path: "pages/ok.md", content: "没有标题的正文" }] }), 0);
  assert.equal(await applyConsolidation(root, parseConsolidationResult("不是 JSON")), 0);
  await assert.rejects(() => fsp.access(path.join(root, "..", "escape.md")));
});

test("parseConsolidationResult 容忍代码围栏和前后杂讯", () => {
  const payload = { pages: [{ path: "pages/a.md", content: "# A" }] };
  const parsed = parseConsolidationResult(`好的，以下是结果：\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n希望有帮助`);
  assert.deepEqual(parsed.pages.length, 1);
  assert.equal(parseConsolidationResult("完全无关"), null);
});

test("buildConsolidationMessages 包含页面全文与待整合清单", () => {
  const pages = [{ relPath: "pages/facts.md", content: "# 常用信息\n\n- 高铁票需要打印 <!--mem:t|fact|出差-->" }];
  const messages = buildConsolidationMessages({ pages, pending: [sampleItem()] });
  assert.equal(messages.length, 2);
  assert.match(messages[1].content, /pages\/facts\.md/);
  assert.match(messages[1].content, /以后汇报用中文/);
  assert.match(messages[0].content, /编号注释/);
  const lintMessages = buildConsolidationMessages({ pages, pending: [], lint: true });
  assert.match(lintMessages[0].content, /健康检查/);
});

test("listWikiPages 返回带更新时间的页面结构", async () => {
  const root = await makeWikiRoot();
  await ensureWiki(root, { items: [sampleItem()] });
  const pages = await listWikiPages(root);
  const preferences = pages.find((page) => page.relPath === "pages/preferences.md");
  assert.ok(preferences);
  assert.equal(preferences.rows[0].id, "m1");
  assert.ok(preferences.updated);
});

test("deriveIndexContent 核心页面排在前面", () => {
  const content = deriveIndexContent([
    { relPath: "pages/projects/a-b12345.md", title: "项目：a", scope: "workspace", rows: [{}] },
    { relPath: "pages/taboos.md", title: "用户禁忌", scope: "global", rows: [] },
  ]);
  assert.ok(content.indexOf("用户禁忌") < content.indexOf("项目：a"));
});
