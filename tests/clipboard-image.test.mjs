import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveClipboardImage } from "../electron/clipboard-image.mjs";

test("剪贴板图片保存为应用附件文件", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-clipboard-"));
  try {
    const saved = await saveClipboardImage({ mimeType: "image/png", data: [0, 1, 2, 255] }, directory);
    assert.equal(saved.mimeType, "image/png");
    assert.equal(saved.size, 4);
    assert.match(saved.name, /^clipboard-[0-9a-f-]+\.png$/);
    assert.deepEqual([...await fs.readFile(saved.filePath)], [0, 1, 2, 255]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("拒绝不支持的剪贴板图片格式和无效字节", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-clipboard-"));
  try {
    await assert.rejects(
      () => saveClipboardImage({ mimeType: "image/svg+xml", data: [1] }, directory),
      /没有可用的图片/,
    );
    await assert.rejects(
      () => saveClipboardImage({ mimeType: "image/png", data: [256] }, directory),
      /过大或格式无效/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
