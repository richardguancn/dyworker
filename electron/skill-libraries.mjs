import { execFile as nodeExecFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export const DEFAULT_SKILL_LIBRARIES = Object.freeze([
  Object.freeze({
    id: "skillhub",
    name: "SkillHub",
    description: "面向中国用户的技能搜索与安装服务",
    websiteUrl: "https://skillhub.cn/",
    searchUrl: "https://api.skillhub.cn/api/v1/search",
    enabled: true,
  }),
]);

function stringValue(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeLibrary(item, fallback) {
  const source = item && typeof item === "object" ? item : {};
  return {
    ...fallback,
    id: stringValue(source.id, fallback.id),
    name: stringValue(source.name, fallback.name),
    description: stringValue(source.description, fallback.description),
    websiteUrl: stringValue(source.websiteUrl, fallback.websiteUrl),
    searchUrl: stringValue(source.searchUrl, fallback.searchUrl),
    enabled: Object.prototype.hasOwnProperty.call(source, "enabled") ? source.enabled === true : fallback.enabled,
  };
}

export function normalizeSkillLibraries(value) {
  const input = Array.isArray(value) ? value : [];
  const byId = new Map(input
    .filter((item) => item && typeof item === "object" && String(item.id || "").trim())
    .map((item) => [String(item.id).trim(), item]));
  const known = DEFAULT_SKILL_LIBRARIES.map((fallback) => normalizeLibrary(byId.get(fallback.id), fallback));
  const knownIds = new Set(known.map((item) => item.id));
  const custom = input
    .map((item) => {
      const id = stringValue(item?.id);
      if (!id || knownIds.has(id)) return null;
      return normalizeLibrary(item, {
        id,
        name: id,
        description: "",
        websiteUrl: "",
        searchUrl: "",
        enabled: false,
      });
    })
    .filter(Boolean);
  return [...known, ...custom];
}

export function skillLibraryInstallRoot({ homeDir = os.homedir() } = {}) {
  return path.join(String(homeDir || os.homedir()), ".agents", "skills");
}

function skillHubCommandArgs(action, library, value) {
  if (library.id !== "skillhub") throw new Error(`暂不支持技能库：${library.id}`);
  const searchUrl = stringValue(library.searchUrl);
  if (action === "search") {
    return ["--skip-self-upgrade", "search", "--json", ...(searchUrl ? ["--search-url", searchUrl] : []), value];
  }
  if (action === "install") {
    return ["--skip-self-upgrade", "install", value, "--dir", skillLibraryInstallRoot({ homeDir: library.homeDir }), ...(searchUrl ? ["--search-url", searchUrl] : []), "--json"];
  }
  throw new Error(`不支持的技能库操作：${action}`);
}

function commandPathEntries(homeDir, currentPath = "") {
  const entries = [
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".npm-global", "bin"),
    path.join(homeDir, "Library", "pnpm"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...String(currentPath || "").split(path.delimiter),
  ];
  return [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

async function runSkillHubCommand(args, { homeDir = os.homedir(), execFileImpl = execFile, command = "skillhub" } = {}) {
  const env = {
    ...process.env,
    PATH: commandPathEntries(String(homeDir || os.homedir()), process.env.PATH),
  };
  try {
    return await execFileImpl(command, args, {
      env,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "技能库命令执行失败").trim();
    throw new Error(detail.slice(0, 1000));
  }
}

function parseJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("技能库没有返回结果");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.lastIndexOf("{");
    if (start >= 0) {
      try {
        return JSON.parse(text.slice(start));
      } catch {
        // Fall through to the user-facing error below.
      }
    }
    throw new Error("技能库返回了无法识别的结果");
  }
}

function normalizeSearchResult(item, library) {
  const source = item && typeof item === "object" ? item : {};
  const slug = stringValue(source.slug, stringValue(source.publicSlug));
  if (!slug) return null;
  return {
    libraryId: library.id,
    libraryName: library.name,
    slug,
    name: stringValue(source.name, stringValue(source.displayName, slug)),
    description: stringValue(source.description, stringValue(source.summary)),
    version: stringValue(source.version),
  };
}

function activeLibraries(value) {
  return normalizeSkillLibraries(value).filter((library) => library.enabled);
}

export async function searchSkillLibraries(value, query, options = {}) {
  const text = stringValue(query);
  if (!text) return { results: [], warnings: ["请输入搜索内容"] };
  const libraries = activeLibraries(value);
  if (!libraries.length) return { results: [], warnings: ["没有启用的技能库"] };
  const settled = await Promise.allSettled(libraries.map(async (library) => {
    const { stdout } = await runSkillHubCommand(
      skillHubCommandArgs("search", library, text),
      { ...options, command: options.command || "skillhub" },
    );
    const payload = parseJsonOutput(stdout);
    return (Array.isArray(payload?.results) ? payload.results : [])
      .map((item) => normalizeSearchResult(item, library))
      .filter(Boolean);
  }));
  const results = [];
  const warnings = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") results.push(...outcome.value);
    else warnings.push(`${libraries[index].name}：${outcome.reason?.message || "搜索失败"}`);
  });
  return { results, warnings };
}

export async function installSkillFromLibrary(value, libraryId, slug, options = {}) {
  const cleanSlug = stringValue(slug);
  if (!cleanSlug || cleanSlug.length > 200 || !/^[\w.@:/-]+$/u.test(cleanSlug)) {
    throw new Error("技能名称无效");
  }
  const library = activeLibraries(value).find((item) => item.id === String(libraryId || ""));
  if (!library) throw new Error("技能库未启用或不存在");
  const libraryWithHome = { ...library, homeDir: options.homeDir || os.homedir() };
  const { stdout } = await runSkillHubCommand(
    skillHubCommandArgs("install", libraryWithHome, cleanSlug),
    { ...options, command: options.command || "skillhub" },
  );
  const result = parseJsonOutput(stdout);
  if (result?.success !== true) throw new Error(stringValue(result?.error, "技能安装失败"));
  return {
    ...result,
    libraryId: library.id,
    libraryName: library.name,
    slug: stringValue(result.slug, cleanSlug),
    targetDir: stringValue(result.targetDir, path.join(skillLibraryInstallRoot({ homeDir: libraryWithHome.homeDir }), cleanSlug)),
  };
}
