import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { extractReleaseNotes } from "../electron/scripts/extract-release-notes.mjs";

const sample = fs.readFileSync(new URL("../RELEASE_NOTES.md", import.meta.url), "utf8");

test("按版本提取 RELEASE_NOTES.md 中的对应小节", () => {
  const notes = extractReleaseNotes(sample, "0.2.1");
  assert.match(notes, /^### 新增/);
  assert.match(notes, /### 修复与优化/);
  assert.match(notes, /ECharts/);
  // 不包含其它版本的内容
  assert.doesNotMatch(notes, /0\.1\.24/);
});

test("找不到版本时返回空字符串", () => {
  assert.equal(extractReleaseNotes(sample, "9.9.9"), "");
  assert.equal(extractReleaseNotes("", "0.2.1"), "");
});

test("当前版本与锁定文件一致且有更新说明", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, "3.0.1");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.match(extractReleaseNotes(sample, pkg.version), /ECharts/);
});
