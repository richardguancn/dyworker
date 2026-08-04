import { promises as fs } from "node:fs";
import path from "node:path";

const ignoredNames = new Set([".git", "node_modules", "dist", ".DS_Store"]);
const MAX_ENTRIES_PER_DIRECTORY = 500;

// Keep the existing tree depth and safety limit while making the limit local to
// each directory. A large child directory must not hide its siblings.
export async function listWorkspace(root, depth = 0) {
  if (!root || depth > 4) return [];
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  directoryEntries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  });
  const result = [];
  for (const entry of directoryEntries) {
    if (ignoredNames.has(entry.name)) continue;
    if (result.length >= MAX_ENTRIES_PER_DIRECTORY) break;
    const fullPath = path.join(root, entry.name);
    const item = {
      name: entry.name,
      path: fullPath,
      kind: entry.isDirectory() ? "directory" : "file",
    };
    if (entry.isDirectory()) item.children = await listWorkspace(fullPath, depth + 1);
    result.push(item);
  }
  return result;
}
