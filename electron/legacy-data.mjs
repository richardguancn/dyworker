// DYWork → DYWorker 改名后的首次启动数据迁移。
// 独立模块、不依赖 electron，方便用 node --test 直接验证。
import { promises as fs } from "node:fs";
import path from "node:path";

// 旧版应用可能使用过的用户数据目录名（大小写因构建产物不同而有差异）。
export const LEGACY_APP_NAMES = Object.freeze(["DYWork", "DyWork", "dywork"]);
export const LEGACY_IMPORT_MARKER = "legacy-import.marker";

// 浏览器运行时缓存，复制过去没有价值，还容易带入旧版本残留状态。
const EXCLUDED_DIRECTORIES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "Crashpad",
  "logs",
  "blob_storage",
  "shared_proto_db",
  "Partitions",
  "Service Worker",
  "Session Storage",
  "WebStorage",
]);

// DYWorker 自己的数据文件：只要新目录里出现任何一个，就认为已经有新数据，不再导入。
// 只启动过一次产生的 Preferences / 缓存等 Electron 内部文件不算数据。
const DYWORKER_DATA_FILES = new Set([
  "settings.json",
  "sessions.json",
  "memory.json",
  "skills.json",
  "skill-overrides.json",
  "skills-dismissed.json",
  "hooks.json",
  "standing-rules.json",
  "usage-stats.json",
  "inbox.json",
  "schedules.json",
  "wakes.json",
  "channel-chats.json",
  "channel-credentials.json",
  "audit.jsonl",
]);

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveLegacyDirectory(currentDirectory) {
  const parent = path.dirname(path.resolve(currentDirectory));
  for (const name of LEGACY_APP_NAMES) {
    const candidate = path.join(parent, name);
    if (await isDirectory(candidate)) return candidate;
  }
  return null;
}

// 只在 DYWorker 首次启动（数据目录不存在或为空）时执行一次：
// 把旧版 DYWork 数据目录里的配置与对话记录复制过来，跳过缓存目录。
// 复制成功后才写标记文件，避免以后重复导入。
export async function importLegacyData({
  currentDirectory,
  legacyDirectory = null,
  markerName = LEGACY_IMPORT_MARKER,
} = {}) {
  const current = path.resolve(String(currentDirectory || ""));
  if (!current) return { imported: false, reason: "missing-current-directory" };
  const legacy = legacyDirectory || await resolveLegacyDirectory(current);
  if (!legacy) return { imported: false, reason: "no-legacy-data" };
  if (path.resolve(legacy) === current) return { imported: false, reason: "same-directory" };

  const marker = path.join(current, markerName);
  if (await pathExists(marker)) return { imported: false, reason: "already-imported" };
  if (await pathExists(current)) {
    const entries = await fs.readdir(current).catch(() => []);
    if (entries.some((name) => DYWORKER_DATA_FILES.has(name))) {
      return { imported: false, reason: "current-data-exists" };
    }
  }

  await fs.mkdir(current, { recursive: true });
  let copiedEntries = 0;
  const copiedTargets = [];
  try {
    for (const name of await fs.readdir(legacy)) {
      if (EXCLUDED_DIRECTORIES.has(name)) continue;
      const source = path.join(legacy, name);
      const target = path.join(current, name);
      await fs.cp(source, target, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
      copiedTargets.push(target);
      copiedEntries += 1;
    }
  } catch (error) {
    // 复制中途失败（例如并发启动或文件被占用）时只清掉本次复制的内容，
    // 不动新目录里原有的文件，旧版目录也保持原样；下次启动重新尝试。
    for (const target of copiedTargets.reverse()) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => { });
    }
    return {
      imported: false,
      reason: "copy-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await fs.writeFile(marker, JSON.stringify({
    importedFrom: legacy,
    importedAt: new Date().toISOString(),
  }, null, 2), "utf8");
  return { imported: true, legacyDirectory: legacy, copiedEntries };
}
