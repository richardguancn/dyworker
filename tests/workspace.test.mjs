import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getWorkspaceContext, listWorkspace, readWorkspaceMarkdown, writeWorkspaceFile } from "../electron/workspace.mjs";

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-workspace-"));
  for (let index = 0; index < 6; index += 1) {
    const directory = path.join(root, `00-heavy-${index}`);
    await fs.mkdir(directory);
    await Promise.all(Array.from({ length: 100 }, (_, fileIndex) =>
      fs.writeFile(path.join(directory, `file-${fileIndex}.txt`), "x")));
  }
  await fs.writeFile(path.join(root, ".DS_Store"), "ignored");
  await fs.mkdir(path.join(root, "frontend"));
  await fs.writeFile(path.join(root, "README.md"), "visible");
  return root;
}

test("工作区根目录不会因子目录过多而漏掉后面的项目", async (t) => {
  const root = await makeWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const entries = await listWorkspace(root);
  const names = entries.map((entry) => entry.name);

  assert.ok(names.includes("frontend"), `缺少根目录项目：${names.join(", ")}`);
  assert.ok(names.includes("README.md"), `缺少根目录文件：${names.join(", ")}`);
  assert.ok(!names.includes(".DS_Store"));
});

test("深层目录（超过 4 级）的文件也会完整列出", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-workspace-deep-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const deep = path.join(root, "frontend", "src", "pages", "inspection", "list");
  await fs.mkdir(deep, { recursive: true });
  await fs.writeFile(path.join(deep, "index.tsx"), "export default () => null;");

  const find = (entries, name) => {
    for (const entry of entries) {
      if (entry.name === name) return entry;
      const hit = entry.children ? find(entry.children, name) : null;
      if (hit) return hit;
    }
    return null;
  };
  const entries = await listWorkspace(root);
  const listDir = find(entries, "list");

  assert.ok(listDir, "深层 list 目录缺失");
  assert.deepEqual(listDir.children?.map((entry) => entry.name), ["index.tsx"], "深层目录下的文件未显示");
});

test("Markdown 预览只读取工作目录内的 Markdown 文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-workspace-"));
  const markdownPath = path.join(root, "README.md");
  const textPath = path.join(root, "notes.txt");
  const outsidePath = path.join(path.dirname(root), `${path.basename(root)}-outside.md`);
  try {
    await fs.writeFile(markdownPath, "# 预览\n\n正文", "utf8");
    await fs.writeFile(textPath, "普通文本", "utf8");
    await fs.writeFile(outsidePath, "外部文件", "utf8");

    assert.deepEqual(await readWorkspaceMarkdown(root, markdownPath), {
      ok: true,
      content: "# 预览\n\n正文",
    });
    assert.equal((await readWorkspaceMarkdown(root, textPath)).ok, false);
    assert.equal((await readWorkspaceMarkdown(root, outsidePath)).ok, false);
  } finally {
    await fs.rm(outsidePath, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("工作区上下文返回目录名，Git 分支按实际目录读取", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-workspace-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const context = await getWorkspaceContext(root);
  assert.equal(context.name, path.basename(root));
  assert.equal(context.branch, "");
});

test("工作台写入：工作目录内原子写，路径逃逸与二进制被拒绝", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-workspace-write-"));
  try {
    const target = path.join(root, "notes.txt");
    await fs.writeFile(target, "旧内容", "utf8");
    const ok = await writeWorkspaceFile(root, target, "新内容");
    assert.equal(ok.ok, true, ok.error || "");
    assert.equal(await fs.readFile(target, "utf8"), "新内容");
    // 路径逃逸拒绝
    const outside = await writeWorkspaceFile(root, path.join(path.dirname(root), "escape.txt"), "x");
    assert.equal(outside.ok, false, "工作目录外路径应被拒绝");
    assert.equal((outside.error || "").includes("工作目录"), true);
    // 二进制（NUL 字符）拒绝，且原文件不受影响
    const binary = await writeWorkspaceFile(root, target, "a\0b");
    assert.equal(binary.ok, false);
    assert.equal(await fs.readFile(target, "utf8"), "新内容", "拒绝写入后原文件不受影响");
    // 新文件可创建
    const created = await writeWorkspaceFile(root, path.join(root, "created.txt"), "c");
    assert.equal(created.ok, true, created.error || "");
    assert.equal(await fs.readFile(path.join(root, "created.txt"), "utf8"), "c");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
