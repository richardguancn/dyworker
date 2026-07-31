import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_SKILL_FILE_BYTES = 512 * 1024;
const MAX_DISCOVERED_SKILLS = 500;

function unquoteYamlValue(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function parseFrontmatter(source) {
  const match = String(source || "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { values: {}, body: String(source || "") };
  const lines = match[1].split(/\r?\n/);
  const values = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!field) continue;
    const [, key, rawValue = ""] = field;
    const blockStyle = rawValue.match(/^([|>])[-+]?$/)?.[1];
    if (blockStyle) {
      const block = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || !lines[index + 1].trim())) {
        index += 1;
        block.push(lines[index].replace(/^\s+/, ""));
      }
      values[key] = blockStyle === ">" ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n").trim();
    } else {
      values[key] = unquoteYamlValue(rawValue);
    }
  }
  return { values, body: String(source || "").slice(match[0].length) };
}

function fallbackDescription(body) {
  return String(body || "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/gm, "").replace(/[`*_>]/g, "").trim())
    .find(Boolean)
    ?.slice(0, 500) || "没有提供技能说明";
}

export function parseSkillDocument(contents, skillFile, source = "global") {
  const { values, body } = parseFrontmatter(contents);
  const name = String(values.name || path.basename(path.dirname(skillFile)) || "").trim();
  if (!name) return null;
  const description = String(values.description || fallbackDescription(body)).trim().slice(0, 1000);
  return {
    id: `file:${path.resolve(skillFile)}`,
    name,
    description,
    instructions: body.trim() || String(contents || "").trim(),
    enabled: true,
    source,
    sourceLabel: source === "workspace" ? "当前工作区" : "用户级",
    path: path.resolve(skillFile),
    readOnly: true,
    createdAt: new Date(0).toISOString(),
  };
}

async function collectSkillFiles(root, limit, visited = new Set(), depth = 0) {
  if (depth > 4 || limit.count >= MAX_DISCOVERED_SKILLS) return [];
  let realRoot;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return [];
  }
  if (visited.has(realRoot)) return [];
  visited.add(realRoot);

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skillEntry = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
  if (skillEntry) {
    limit.count += 1;
    return [path.join(root, skillEntry.name)];
  }

  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (limit.count >= MAX_DISCOVERED_SKILLS) break;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSkillFiles(candidate, limit, visited, depth + 1));
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        if ((await fs.stat(candidate)).isDirectory()) {
          files.push(...await collectSkillFiles(candidate, limit, visited, depth + 1));
        }
      } catch {
        // Ignore broken or unreadable links.
      }
    }
  }
  return files;
}

function discoveryRoots(homeDir, workspacePath) {
  const roots = [];
  if (workspacePath) {
    roots.push(
      { root: path.join(workspacePath, ".agents", "skills"), source: "workspace" },
      { root: path.join(workspacePath, ".codex", "skills"), source: "workspace" },
      { root: path.join(workspacePath, ".agent", "skills"), source: "workspace" },
    );
  }
  if (homeDir) {
    roots.push(
      { root: path.join(homeDir, ".agents", "skills"), source: "global" },
      { root: path.join(homeDir, ".codex", "skills"), source: "global" },
      { root: path.join(homeDir, ".agent", "skills"), source: "global" },
    );
  }
  return roots;
}

export async function discoverFileSkills({ homeDir, workspacePath = "" } = {}) {
  const found = [];
  const names = new Set();
  for (const { root, source } of discoveryRoots(homeDir, workspacePath)) {
    const files = await collectSkillFiles(root, { count: 0 });
    for (const skillFile of files) {
      try {
        const stat = await fs.stat(skillFile);
        if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) continue;
        const parsed = parseSkillDocument(await fs.readFile(skillFile, "utf8"), skillFile, source);
        const key = parsed?.name.toLocaleLowerCase();
        if (!parsed || names.has(key)) continue;
        names.add(key);
        found.push({ ...parsed, createdAt: stat.mtime.toISOString() });
      } catch {
        // One malformed or unreadable skill must not hide the remaining skills.
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeSkillRecords(storedSkills = [], fileSkills = [], overrides = {}) {
  const names = new Set();
  const merged = [];
  for (const skill of [...fileSkills, ...storedSkills]) {
    if (!skill?.name) continue;
    const key = String(skill.name).toLocaleLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    const source = skill.source || (skill.builtIn ? "builtin" : "saved");
    merged.push({
      ...skill,
      source,
      sourceLabel: skill.sourceLabel || (source === "builtin" ? "内置" : "本地模板"),
      readOnly: Boolean(skill.readOnly),
      enabled: Object.prototype.hasOwnProperty.call(overrides, skill.id)
        ? Boolean(overrides[skill.id])
        : skill.enabled !== false,
    });
  }
  return merged;
}
