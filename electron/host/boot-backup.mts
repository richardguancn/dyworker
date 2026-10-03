// 启动时快照：把"用户不可再生"的数据文件复制一份到 userData/.backups/<时间戳>/。
//
// 为什么需要：会话与设置都可能被一次异常启动覆盖（真实事故：渲染端拿到空的初始状态后
// 保存，把历史会话/模型配置整批清掉）。归档层已有"拒绝异常缩水 + 退役备份"两道闸，
// 这里再加一道与业务逻辑无关的兜底——即使写入路径整个坏掉，也能从启动快照恢复。
//
// 只快照小体积的状态文件（sessions/*.json、settings.json 等），不碰 models/Partitions
// 这类可再生的大目录；超过体积上限就跳过，避免把磁盘塞满。
import fs from "node:fs/promises";
import path from "node:path";

const BACKUP_DIR = ".backups";
const KEEP_SNAPSHOTS = 3;
const MAX_BYTES = 200 * 1024 * 1024;

// 单文件状态：缺失就跳过
const STATE_FILES = ["settings.json", "workspace-pins.json", "skills.json", "appearance.json", "standing-rules.json", "memory.json"];

// 目录型状态：记忆 wiki（页面都是用户/助手长期积累的，不可再生）
const STATE_DIRS = ["memory-wiki"];

// 优先硬链接：主程序所有落盘都是"写临时文件 + rename"（见 host/io.mts 与 session-archive），
// 旧 inode 不会被就地改写，所以硬链接出去的快照内容稳定，且几乎不额外占盘
// （77MB 会话 × 3 份快照从 ~231MB 降到 ~77MB，启动也不再复制一遍）。
async function linkOrCopy(from, to) {
  try {
    await fs.link(from, to);
  } catch {
    await fs.copyFile(from, to);
  }
}

async function pathSize(target) {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const name of await fs.readdir(target).catch(() => [])) {
    total += await pathSize(path.join(target, name));
  }
  return total;
}

export async function snapshotCriticalFiles({ dir, keep = KEEP_SNAPSHOTS, now = () => new Date() }: any = {}) {
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const root = path.join(dir, BACKUP_DIR);
  const target = path.join(root, stamp);
  let bytes = 0;
  let copied = 0;
  try {
    await fs.mkdir(target, { recursive: true });

    // 会话存档：index + 每个会话文件
    const sessionsDir = path.join(dir, "sessions");
    let sessionNames = [];
    try {
      sessionNames = (await fs.readdir(sessionsDir)).filter((name) => name.endsWith(".json"));
    } catch {
      // 尚无存档：全新安装
    }
    if (sessionNames.length) {
      await fs.mkdir(path.join(target, "sessions"), { recursive: true });
      for (const name of sessionNames) {
        const from = path.join(sessionsDir, name);
        const stat = await fs.stat(from).catch(() => null);
        if (!stat || !stat.isFile()) continue;
        if (bytes + stat.size > MAX_BYTES) {
          await fs.rm(target, { recursive: true, force: true }).catch(() => {});
          console.warn("[boot-backup] 数据超过上限，已跳过本次启动快照");
          return { ok: false, skipped: true, reason: "too-large" };
        }
        await linkOrCopy(from, path.join(target, "sessions", name));
        bytes += stat.size;
        copied += 1;
      }
    }

    for (const name of STATE_DIRS) {
      const from = path.join(dir, name);
      if (!(await fs.stat(from).catch(() => null))?.isDirectory()) continue;
      const size = await pathSize(from);
      if (bytes + size > MAX_BYTES) continue;
      await fs.cp(from, path.join(target, name), { recursive: true });
      bytes += size;
      copied += 1;
    }

    for (const name of STATE_FILES) {
      const from = path.join(dir, name);
      const stat = await fs.stat(from).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      if (bytes + stat.size > MAX_BYTES) break;
      await linkOrCopy(from, path.join(target, name));
      bytes += stat.size;
      copied += 1;
    }

    if (!copied) {
      // 没有任何可快照的数据（全新安装）：连空目录一起收掉，别在用户目录里留垃圾
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      await fs.rmdir(root).catch(() => {});
      return { ok: true, copied: 0, skipped: true, reason: "nothing-to-copy" };
    }

    // 只保留最近 keep 份
    const stamps = (await fs.readdir(root)).sort();
    for (const stale of stamps.slice(0, Math.max(0, stamps.length - keep))) {
      await fs.rm(path.join(root, stale), { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true, copied, bytes, dir: target };
  } catch (error) {
    // 备份失败绝不影响启动
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    console.warn(`[boot-backup] 启动快照失败：${error?.message || error}`);
    return { ok: false, error: String(error?.message || error) };
  }
}
