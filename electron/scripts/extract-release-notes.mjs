#!/usr/bin/env node
// 从 RELEASE_NOTES.md 提取指定版本的更新说明。
// 文件按 `## <版本号> <小节标题>` 组织，同一版本可有多个小节（新增 / 修复与优化等）。
// 用法: node electron/scripts/extract-release-notes.mjs <版本号> [RELEASE_NOTES.md 路径]
// 提取结果输出到 stdout；找不到该版本时退出码为 1，让发布流水线直接失败而不是发空说明。

import fs from "node:fs";

export function extractReleaseNotes(markdown, version) {
  const target = String(version || "").trim();
  if (!target) return "";
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let current = null;
  const flush = () => {
    if (current) sections.push(current);
    current = null;
  };
  for (const line of lines) {
    const heading = /^##\s+(\S+)(?:\s+(.*))?\s*$/.exec(line);
    if (heading) {
      flush();
      if (heading[1] === target) current = { title: String(heading[2] || "").trim(), lines: [] };
      continue;
    }
    // 一级标题（文件头）也会终止当前小节
    if (/^#\s/.test(line)) {
      flush();
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections
    .map((section) => {
      const body = section.lines.join("\n").trim();
      const title = section.title ? `### ${section.title}` : `## ${target}`;
      return body ? `${title}\n\n${body}` : title;
    })
    .join("\n\n")
    .trim();
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const [version, file = "RELEASE_NOTES.md"] = process.argv.slice(2);
  if (!version) {
    console.error("用法: node extract-release-notes.mjs <版本号> [RELEASE_NOTES.md 路径]");
    process.exit(1);
  }
  const notes = extractReleaseNotes(fs.readFileSync(file, "utf8"), version);
  if (!notes) {
    console.error(`RELEASE_NOTES.md 中找不到版本 ${version} 的更新说明`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
