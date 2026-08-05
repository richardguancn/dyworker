import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getWorkspaceContext, listWorkspace, readWorkspaceMarkdown } from "../electron/workspace.mjs";

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
