import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTACHMENT_BYTES,
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  applyImportPlan,
  buildTransferPackage,
  collectAttachmentRefs,
  collectAttachments,
  exportFileName,
  parseTransferPackage,
  planImport,
  projectTitle,
  safeSegment,
} from "../electron/session-transfer.mts";

const makeSession = (id, extra = {}) => ({
  id,
  title: `任务 ${id}`,
  workspacePath: "/Users/alice/Documents/proj",
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-02T00:00:00.000Z",
  messages: [
    { role: "user", content: "帮我看一下这份材料", createdAt: "2026-02-01T00:00:00.000Z" },
    { role: "assistant", content: "看完了，结论如下", createdAt: "2026-02-01T00:01:00.000Z" },
  ],
  ...extra,
});

const pkgOf = (sessions, extra = {}) => buildTransferPackage({
  kind: "session",
  sessions,
  appVersion: "0.3.0",
  platform: "darwin",
  host: "alice-mac",
  ...extra,
});

test("导出包带有格式标识、版本与来源机器信息", () => {
  const pkg = pkgOf([makeSession("s1")]);
  assert.equal(pkg.format, TRANSFER_FORMAT);
  assert.equal(pkg.version, TRANSFER_VERSION);
  assert.equal(pkg.kind, "session");
  assert.equal(pkg.app.version, "0.3.0");
  assert.equal(pkg.app.platform, "darwin");
  assert.equal(pkg.app.host, "alice-mac");
  assert.equal(pkg.sessions.length, 1);
  assert.deepEqual(pkg.attachments, []);
});

test("项目包记录项目路径、标题与置顶状态", () => {
  const pkg = buildTransferPackage({
    kind: "project",
    sessions: [makeSession("a"), makeSession("b")],
    project: { path: "/Users/alice/Documents/公文项目", title: "", pinned: true },
  });
  assert.equal(pkg.kind, "project");
  assert.equal(pkg.project.title, "公文项目");
  assert.equal(pkg.project.pinned, true);
  assert.equal(pkg.sessions.length, 2);
});

test("解析：非迁移包、坏 JSON、高版本、空任务都被明确拒绝", () => {
  assert.equal(parseTransferPackage("不是 JSON").ok, false);
  assert.equal(parseTransferPackage({ format: "other", sessions: [] }).ok, false);
  assert.equal(parseTransferPackage({ format: TRANSFER_FORMAT, version: 999, sessions: [makeSession("x")] }).ok, false);
  assert.equal(parseTransferPackage({ format: TRANSFER_FORMAT, version: 1, sessions: [] }).ok, false);
  const ok = parseTransferPackage(JSON.stringify(pkgOf([makeSession("s1")])));
  assert.equal(ok.ok, true);
  assert.equal(ok.package.sessions[0].id, "s1");
});

test("附件收集：同一路径只取一次，无本地路径的临时附件跳过", () => {
  const session = makeSession("s1", {
    messages: [
      { role: "user", content: "图", attachments: [{ name: "a.png", path: "/tmp/a.png", size: 10, mimeType: "image/png" }] },
      { role: "assistant", content: "再看", attachments: [{ name: "a.png", path: "/tmp/a.png", size: 10 }, { name: "无路径", path: "" }] },
    ],
  });
  const refs = collectAttachmentRefs([session]);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].path, "/tmp/a.png");
  assert.equal(refs[0].mimeType, "image/png");
});

test("附件收集：读失败、超单文件上限、超整包上限都只进跳过名单", async () => {
  const session = makeSession("s1", {
    messages: [{
      role: "user",
      content: "附件",
      attachments: [
        { name: "ok.txt", path: "/tmp/ok.txt" },
        { name: "gone.txt", path: "/tmp/gone.txt" },
        { name: "big.bin", path: "/tmp/big.bin" },
      ],
    }],
  });
  const files = new Map([
    ["/tmp/ok.txt", Buffer.from("hello")],
    ["/tmp/big.bin", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)],
  ]);
  const collected = await collectAttachments([session], async (filePath) => files.get(filePath) || null);
  assert.equal(collected.attachments.length, 1);
  assert.equal(collected.attachments[0].dataBase64, Buffer.from("hello").toString("base64"));
  assert.equal(collected.skippedAttachments.length, 2);
  assert.deepEqual(collected.skippedAttachments.map((item) => item.name).sort(), ["big.bin", "gone.txt"]);

  const capped = await collectAttachments([session], async (filePath) => files.get(filePath) || null, { maxTotalBytes: 1 });
  assert.equal(capped.attachments.length, 0);
  assert.ok(capped.skippedAttachments.some((item) => item.reason.includes("整包上限")));
});

test("导入计划：本机已有同 id 或包内重复时另存，其余保留原编号", () => {
  const pkg = parseTransferPackage(pkgOf([
    makeSession("keep"),
    makeSession("conflict"),
    makeSession("dup"),
    makeSession("dup"),
  ])).package;
  const plan = planImport(pkg, {
    hasSession: (id) => id === "conflict",
    workspaceExists: () => true,
  });
  const ids = plan.entries.map((entry) => entry.id);
  assert.deepEqual(ids, ["keep", "conflict-1", "dup", "dup-1"]);
  assert.deepEqual(plan.entries.map((entry) => entry.renamed), [false, true, false, true]);
});

test("导入计划：汇总工作目录并标记本机是否存在", () => {
  const pkg = parseTransferPackage(buildTransferPackage({
    kind: "project",
    sessions: [makeSession("a"), makeSession("b"), makeSession("c", { workspacePath: "/Users/alice/other" })],
    project: { path: "/Users/alice/Documents/proj", title: "proj", pinned: false },
  })).package;
  const plan = planImport(pkg, { hasSession: () => false, workspaceExists: (p) => p === "/Users/alice/other" });
  assert.equal(plan.workspaces.length, 2);
  const proj = plan.workspaces.find((item) => item.path === "/Users/alice/Documents/proj");
  assert.equal(proj.sessionCount, 2);
  assert.equal(proj.exists, false);
  assert.equal(plan.workspaces.find((item) => item.path === "/Users/alice/other").exists, true);
  assert.equal(plan.project.title, "proj");
});

test("导入落地：工作目录映射、附件路径改写、插件任务降级为普通任务", () => {
  const session = makeSession("s1", {
    runtime: "dsh",
    unread: true,
    parentSessionId: "parent-in-pkg",
    messages: [{
      role: "user",
      content: "带图",
      attachments: [{ name: "a.png", path: "/Users/alice/old/a.png", size: 12, mimeType: "image/png" }],
    }],
  });
  const pkg = parseTransferPackage(pkgOf([makeSession("parent-in-pkg", { messages: [] }), session])).package;
  const plan = planImport(pkg, { hasSession: () => false, workspaceExists: () => false });
  const imported = applyImportPlan(plan, {
    workspaceMapping: { "/Users/alice/Documents/proj": "/Users/bob/Documents/proj" },
    attachmentPaths: new Map([["/Users/alice/old/a.png", "/Users/bob/Library/Application Support/DYWorker/transfer-attachments/s1/001-a.png"]]),
  });
  const target = imported.find((item) => item.id === "s1");
  assert.equal(target.workspacePath, "/Users/bob/Documents/proj");
  assert.equal(target.runtime, "dyworker");
  assert.equal(target.unread, false);
  assert.equal(target.messages[0].attachments[0].path.endsWith("001-a.png"), true);
  // 原文内容不动，原始包对象也不被就地修改（可重试导入）
  assert.equal(session.workspacePath, "/Users/alice/Documents/proj");
  assert.equal(session.messages[0].attachments[0].path, "/Users/alice/old/a.png");
});

test("导入落地：父任务被改名时子任务的 parentSessionId 跟随映射", () => {
  const pkg = parseTransferPackage(pkgOf([
    makeSession("root", { messages: [] }),
    makeSession("child", { parentSessionId: "root", messages: [] }),
  ])).package;
  const plan = planImport(pkg, { hasSession: (id) => id === "root", workspaceExists: () => true });
  const imported = applyImportPlan(plan);
  const child = imported.find((item) => item.parentSessionId === "root-1");
  assert.ok(child, "子任务应指向改名后的父任务");
  assert.equal(imported.find((item) => item.id === "root-1")?.title, "任务 root");
});

test("往返：导出→解析→导入后消息与标题保持一致", () => {
  const original = makeSession("roundtrip", { goal: "把材料整理成通知", pinned: true });
  const pkg = parseTransferPackage(JSON.stringify(pkgOf([original]))).package;
  const imported = applyImportPlan(planImport(pkg, { hasSession: () => false, workspaceExists: () => true }));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].title, original.title);
  assert.equal(imported[0].goal, original.goal);
  assert.equal(imported[0].pinned, true);
  assert.deepEqual(imported[0].messages.map((m) => [m.role, m.content]), original.messages.map((m) => [m.role, m.content]));
});

test("文件名与片段清洗：去掉路径分隔符与非法字符", () => {
  assert.equal(safeSegment('a/b:c*?"<>|'), "a_b_c______");
  assert.equal(safeSegment(""), "item");
  assert.equal(projectTitle("/Users/alice/Documents/公文项目"), "公文项目");
  assert.match(exportFileName("公文/任务", "session", new Date("2026-03-04T00:00:00Z")), /^公文_任务-任务-2026-03-04\.dyworker$/);
  assert.match(exportFileName("", "project", new Date("2026-03-04T00:00:00Z")), /^项目-项目-2026-03-04\.dyworker$/);
});
