import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  builtinMemories,
  buildMemoryRecord,
  extractExplicitMemoryInstruction,
  extractExplicitMemoryInstructions,
  isBuiltinMemoryId,
  mergeBuiltinMemories,
  normalizeMemories,
  selectRelevantMemories,
} from "../electron/memory.mjs";

test("新安装会自动获得只读的模型能力认知", () => {
  const memories = mergeBuiltinMemories([]);

  assert.equal(memories.length, builtinMemories.length);
  assert.ok(memories.length >= 3);
  assert.ok(memories.every((item) => item.builtIn === true && item.scope === "global"));
  assert.ok(memories.some((item) => /Kimi K3/.test(item.content) && /定制化看板/.test(item.content) && /同花顺/.test(item.content) && /天眼查/.test(item.content)));
  assert.ok(memories.some((item) => /DeepSeek V4 Flash/.test(item.content) && /GLM-5\.2/.test(item.content)));
  assert.ok(memories.some((item) => /模型能力/.test(item.content) && /产品能力/.test(item.content) && /官方资料/.test(item.content)));
});

test("升级和重复启动会保留用户记忆且不会复制内置认知", () => {
  const saved = {
    id: "saved-user-rule",
    category: "用户偏好",
    content: "汇报保持简洁",
    kind: "preference",
    scope: "global",
  };
  const duplicatedBuiltin = { ...builtinMemories[0], builtIn: false };

  const once = mergeBuiltinMemories([saved, duplicatedBuiltin]);
  const twice = mergeBuiltinMemories(once);

  assert.equal(once.filter((item) => item.id === saved.id).length, 1);
  assert.equal(once.filter((item) => item.content === builtinMemories[0].content).length, 1);
  assert.deepEqual(twice, once);
});

test("只有固定清单中的记忆才具有内置只读身份", () => {
  const forged = {
    id: "builtin-user-note",
    category: "用户偏好",
    content: "这仍然是用户自己的记忆",
    kind: "preference",
    scope: "global",
    builtIn: true,
  };
  const merged = mergeBuiltinMemories([forged]);
  const restored = merged.find((item) => item.id === forged.id);

  assert.equal(restored?.builtIn, undefined);
  assert.equal(isBuiltinMemoryId(builtinMemories[0].id), true);
  assert.equal(isBuiltinMemoryId(forged.id), false);
});

test("模型认知只在相关任务中注入，不会挤占无关任务的记忆", () => {
  const memories = mergeBuiltinMemories([]);
  const related = selectRelevantMemories(memories, {
    query: "比较 Kimi K3、K2.7、DeepSeek V4 Flash、V4 Pro 和 GLM-5.2，选择适合开发的模型",
    limit: 5,
  });
  const unrelated = selectRelevantMemories(memories, {
    query: "根据会议记录整理一份会议纪要",
    limit: 5,
  });

  assert.deepEqual(new Set(related.map((item) => item.id)), new Set(builtinMemories.map((item) => item.id)));
  assert.deepEqual(unrelated, []);
});

test("用户明确要求记住时提取稳定内容，普通讨论不会误存", () => {
  assert.deepEqual(
    extractExplicitMemoryInstruction("请记住：以后给我的汇报要简洁"),
    {
      category: "用户偏好",
      content: "以后给我的汇报要简洁",
      kind: "preference",
      scope: "global",
      relation: "extends",
      relatedMemoryId: "",
    },
  );
  assert.equal(
    extractExplicitMemoryInstruction("我在会话中明确了要记下来某些内容，但是这里都没有体现"),
    null,
  );
  assert.equal(
    extractExplicitMemoryInstruction("请记住：API Key: abcdef"),
    null,
  );
  assert.equal(extractExplicitMemoryInstruction("请记住两条规则"), null);
  assert.equal(extractExplicitMemoryInstruction("请记住：我的密码是 abcdef"), null);
});

test("项目专属的明确记忆绑定当前工作区", () => {
  const memory = extractExplicitMemoryInstruction("这个项目发布前必须跑完整构建，这点请记住");
  assert.equal(memory.content, "这个项目发布前必须跑完整构建");
  assert.equal(memory.kind, "rule");
  assert.equal(memory.scope, "workspace");
  assert.equal(memory.category, "项目规则");
});

test("多条明确记忆和常见祈使句都会被保存", () => {
  const memories = extractExplicitMemoryInstructions("你要记住汇报要简洁；请把这条记下来：当前项目发布前必须构建；请记住以下内容：默认使用中文；回复不要带套话。然后帮我整理材料");
  assert.deepEqual(memories.map((item) => item.content), ["汇报要简洁", "当前项目发布前必须构建", "默认使用中文", "回复不要带套话"]);
  assert.deepEqual(memories.map((item) => item.scope), ["global", "workspace", "global", "global"]);
  assert.deepEqual(
    extractExplicitMemoryInstructions("请记住以下内容：A；B").map((item) => item.content),
    ["A", "B"],
  );
});

test("旧记忆可直接升级为全局事实", () => {
  const [memory] = normalizeMemories([{
    id: "old-1",
    category: "常用信息",
    content: "用户常用 WPS 打开文档",
    createdAt: "2026-01-01T00:00:00.000Z",
  }]);

  assert.equal(memory.kind, "fact");
  assert.equal(memory.scope, "global");
  assert.equal(memory.workspacePath, "");
  assert.equal(memory.relation, "extends");
});

test("工作区记忆只在原工作区参与筛选", () => {
  const memories = normalizeMemories([
    { id: "global", category: "用户偏好", content: "汇报要简洁", kind: "preference", scope: "global" },
    { id: "a", category: "项目规则", content: "发布前运行移动端构建", kind: "rule", scope: "workspace", workspacePath: "/work/a" },
    { id: "b", category: "项目规则", content: "发布前运行桌面端构建", kind: "rule", scope: "workspace", workspacePath: "/work/b" },
  ]);

  const selected = selectRelevantMemories(memories, {
    workspacePath: "/work/a",
    query: "准备发布并验证构建",
    limit: 5,
  });

  assert.ok(selected.some((item) => item.id === "global"));
  assert.ok(selected.some((item) => item.id === "a"));
  assert.ok(!selected.some((item) => item.id === "b"));
});

test("只选择与任务最相关的五条记忆", () => {
  const memories = normalizeMemories([
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `report-${index}`,
      category: "报告规则",
      content: `季度报告需要核对第 ${index + 1} 项数据`,
      kind: "experience",
      scope: "global",
      createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    })),
    { id: "unrelated", category: "出差", content: "高铁票需要打印", kind: "fact", scope: "global" },
  ]);

  const selected = selectRelevantMemories(memories, {
    workspacePath: "/work/a",
    query: "整理季度报告并核对数据",
    limit: 5,
  });

  assert.equal(selected.length, 5);
  assert.ok(selected.every((item) => item.id.startsWith("report-")));
});

test("没有关键词命中时仍保留适用的规则和禁忌", () => {
  const selected = selectRelevantMemories(normalizeMemories([
    { id: "rule", category: "项目规则", content: "不得上传内部资料", kind: "rule", scope: "workspace", workspacePath: "/work/a" },
    { id: "taboo", category: "用户禁忌", content: "不要使用夸张措辞", kind: "taboo", scope: "global" },
    { id: "fact", category: "常用信息", content: "联系人姓李", kind: "fact", scope: "global" },
  ]), {
    workspacePath: "/work/a",
    query: "整理本周安排",
    limit: 5,
  });

  assert.deepEqual(selected.map((item) => item.id).sort(), ["rule", "taboo"]);
});

test("新记忆可以取代明确关联的旧记忆", () => {
  const selected = selectRelevantMemories(normalizeMemories([
    { id: "old", category: "项目事实", content: "默认模型是旧模型", kind: "fact", scope: "workspace", workspacePath: "/work/a" },
    { id: "new", category: "项目事实", content: "默认模型是新模型", kind: "fact", scope: "workspace", workspacePath: "/work/a", relation: "supersedes", relatedMemoryId: "old" },
  ]), {
    workspacePath: "/work/a",
    query: "默认模型是什么",
    limit: 5,
  });

  assert.deepEqual(selected.map((item) => item.id), ["new"]);
});

test("新记录根据作用范围绑定当前工作区", () => {
  const record = buildMemoryRecord({
    category: "项目规则",
    content: "发布前必须完成测试",
    kind: "rule",
    scope: "workspace",
    relation: "extends",
  }, {
    id: "new-id",
    workspacePath: "/work/a/",
    now: "2026-07-27T00:00:00.000Z",
  });

  assert.deepEqual(record, {
    id: "new-id",
    category: "项目规则",
    content: "发布前必须完成测试",
    kind: "rule",
    scope: "workspace",
    workspacePath: path.normalize("/work/a"),
    relation: "extends",
    relatedMemoryId: "",
    createdAt: "2026-07-27T00:00:00.000Z",
  });
});

test("根目录工作区不会被误降级为全局记忆", () => {
  const [memory] = normalizeMemories([{
    id: "root",
    category: "项目规则",
    content: "根目录专用规则",
    kind: "rule",
    scope: "workspace",
    workspacePath: "/",
  }]);

  assert.equal(memory.scope, "workspace");
  assert.equal(memory.workspacePath, path.normalize("/"));
});
