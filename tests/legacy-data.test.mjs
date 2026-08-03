import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importLegacyData, LEGACY_IMPORT_MARKER } from "../electron/legacy-data.mjs";

async function makeParent() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dyworker-legacy-test-"));
}

test("首次启动把旧版配置与对话记录复制过来，跳过缓存目录", async () => {
  const parent = await makeParent();
  const current = path.join(parent, "current");
  const legacy = path.join(parent, "DYWork");
  await fs.mkdir(path.join(legacy, "Cache"), { recursive: true });
  await fs.mkdir(path.join(legacy, "Code Cache"), { recursive: true });
  await fs.writeFile(path.join(legacy, "settings.json"), '{"model":"one"}', "utf8");
  await fs.writeFile(path.join(legacy, "sessions.json"), '[{"id":"s1"}]', "utf8");
  await fs.writeFile(path.join(legacy, "memory.json"), '[]', "utf8");
  await fs.writeFile(path.join(legacy, "Cache", "big.bin"), "cache", "utf8");
  try {
    const result = await importLegacyData({ currentDirectory: current });
    assert.deepEqual(result, {
      imported: true,
      legacyDirectory: legacy,
      copiedEntries: 3,
    });
    assert.equal(await fs.readFile(path.join(current, "settings.json"), "utf8"), '{"model":"one"}');
    assert.equal(await fs.readFile(path.join(current, "sessions.json"), "utf8"), '[{"id":"s1"}]');
    assert.equal(await fs.readFile(path.join(current, "memory.json"), "utf8"), '[]');
    assert.equal(await fs.access(path.join(current, "Cache")).then(() => true).catch(() => false), false);
    assert.equal(await fs.access(path.join(current, "Code Cache")).then(() => true).catch(() => false), false);
    assert.equal(await fs.access(path.join(current, LEGACY_IMPORT_MARKER)).then(() => true).catch(() => false), true);

    const again = await importLegacyData({ currentDirectory: current });
    assert.equal(again.imported, false);
    assert.equal(again.reason, "already-imported");
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("新目录已有数据时不导入，也不覆盖任何文件", async () => {
  const parent = await makeParent();
  const current = path.join(parent, "current");
  const legacy = path.join(parent, "DYWork");
  await fs.mkdir(current, { recursive: true });
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(current, "settings.json"), '{"model":"new"}', "utf8");
  await fs.writeFile(path.join(legacy, "settings.json"), '{"model":"old"}', "utf8");
  try {
    const result = await importLegacyData({ currentDirectory: current });
    assert.equal(result.imported, false);
    assert.equal(result.reason, "current-data-exists");
    assert.equal(await fs.readFile(path.join(current, "settings.json"), "utf8"), '{"model":"new"}');
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("新目录只有 Electron 内部文件（如只启动过一次）时仍然导入", async () => {
  const parent = await makeParent();
  const current = path.join(parent, "current");
  const legacy = path.join(parent, "DYWork");
  await fs.mkdir(path.join(current, "Cache"), { recursive: true });
  await fs.writeFile(path.join(current, "Preferences"), "{}", "utf8");
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, "sessions.json"), '[{"id":"s1"}]', "utf8");
  try {
    const result = await importLegacyData({ currentDirectory: current });
    assert.equal(result.imported, true);
    assert.equal(await fs.readFile(path.join(current, "sessions.json"), "utf8"), '[{"id":"s1"}]');
    assert.equal(await fs.readFile(path.join(current, "Preferences"), "utf8"), "{}");
    assert.equal(await fs.access(path.join(current, LEGACY_IMPORT_MARKER)).then(() => true).catch(() => false), true);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("没有旧版数据目录时不迁移", async () => {
  const parent = await makeParent();
  const current = path.join(parent, "current");
  try {
    const result = await importLegacyData({ currentDirectory: current });
    assert.equal(result.imported, false);
    assert.equal(result.reason, "no-legacy-data");
    assert.equal(await fs.access(current).then(() => true).catch(() => false), false);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("能识别旧版目录的大小写变体", async () => {
  const parent = await makeParent();
  const current = path.join(parent, "current");
  const legacy = path.join(parent, "DyWork");
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, "sessions.json"), '[{"id":"case-variant"}]', "utf8");
  try {
    const result = await importLegacyData({ currentDirectory: current });
    assert.equal(result.imported, true);
    assert.equal(await fs.readFile(path.join(current, "sessions.json"), "utf8"), '[{"id":"case-variant"}]');
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("新旧目录指向同一位置时不迁移", async () => {
  const parent = await makeParent();
  const current = path.join(parent, "current");
  await fs.mkdir(current, { recursive: true });
  try {
    const result = await importLegacyData({ currentDirectory: current, legacyDirectory: current });
    assert.equal(result.imported, false);
    assert.equal(result.reason, "same-directory");
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
