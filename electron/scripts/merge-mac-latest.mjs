#!/usr/bin/env node
// 合并 macOS 双架构（arm64 / x64）各自生成的 latest-mac.yml。
// electron-builder 每个 arch 的构建各产出一份 latest-mac.yml，直接上传会因
// 重名互相覆盖，导致另一半架构的应用内更新拿不到对应安装包。
// electron-updater 的 MacUpdater 会按文件名中的 "arm64" 为各架构过滤文件，
// 因此把两份的 files 条目合并进一份清单即可让双架构都能自动更新。
// 用法: node merge-mac-latest.mjs <release-assets 根目录>
// 只有一份 latest-mac.yml（未启用双架构）时不做任何修改。

import fs from "node:fs";
import path from "node:path";

function findLatestMacFiles(root) {
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "latest-mac.yml") found.push(full);
    }
  };
  walk(root);
  return found;
}

// 只解析 electron-builder 更新清单中固定缩进的 files 列表。
function parseFiles(text) {
  const files = [];
  let current = null, inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (!inFiles) continue;
    const item = /^  - url: (.+?)\s*$/.exec(line);
    if (item) { current = { url: item[1] }; files.push(current); continue; }
    const prop = /^    (sha512|size): (.+?)\s*$/.exec(line);
    if (prop && current) { current[prop[1]] = prop[2]; continue; }
    if (/^\S/.test(line)) inFiles = false; // 进入下一个顶层键，files 块结束
  }
  return files;
}

const [root] = process.argv.slice(2);
if (!root) { console.error("用法: node merge-mac-latest.mjs <release-assets 根目录>"); process.exit(1); }
const candidates = findLatestMacFiles(root);
if (candidates.length <= 1) {
  console.log(`[mac-yml] 找到 ${candidates.length} 份 latest-mac.yml，无需合并`);
  process.exit(0);
}
if (candidates.length > 2) {
  console.error(`[mac-yml] 意外出现 ${candidates.length} 份 latest-mac.yml: ${candidates.join(", ")}`);
  process.exit(1);
}
const [armFile, x64File] = candidates.sort((a, b) =>
  Number(fs.readFileSync(a, "utf8").includes("arm64")) - Number(fs.readFileSync(b, "utf8").includes("arm64"))).reverse();
const armText = fs.readFileSync(armFile, "utf8");
const x64Files = parseFiles(fs.readFileSync(x64File, "utf8"));
if (!x64Files.length) { console.error(`[mac-yml] ${x64File} 没有解析到 files 条目`); process.exit(1); }
if (x64Files.some(file => file.url.includes("arm64"))) {
  console.error(`[mac-yml] ${x64File} 含 arm64 条目，架构判定失败: ${JSON.stringify(x64Files)}`);
  process.exit(1);
}
const armFiles = parseFiles(armText);
const urls = new Set(armFiles.map(file => file.url));
if (x64Files.some(file => urls.has(file.url))) {
  console.error("[mac-yml] 两份清单存在同名文件，拒绝合并"); process.exit(1);
}
const insert = x64Files.map(file => `  - url: ${file.url}\n    sha512: ${file.sha512}\n    size: ${file.size}`).join("\n");
const lines = armText.split(/\r?\n/);
const pathIndex = lines.findIndex(line => /^path:/.test(line));
if (pathIndex < 0) { console.error(`[mac-yml] ${armFile} 缺少 path 键，插入位置未知`); process.exit(1); }
lines.splice(pathIndex, 0, insert);
fs.writeFileSync(armFile, lines.join("\n"));
fs.rmSync(x64File);
console.log(`[mac-yml] 已把 ${x64Files.map(file => file.url).join(", ")} 合并进 ${armFile} 并删除重复清单`);
