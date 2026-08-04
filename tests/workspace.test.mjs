import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listWorkspace } from "../electron/workspace.mjs";

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
