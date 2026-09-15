import { promises as fs } from "node:fs";
import path from "node:path";

// 无轮转的运行痕迹会把 userData 慢慢吃满（实测 traces/ 一年不到 177MB，
// channel-debug.log 只增不减），这里提供两个只依赖 node:fs 的封顶工具。

// 目录内文件总量超过 maxBytes 时按 mtime 从旧到新删除，直到回到限额内；
// keep 列出的文件（例如刚写完的当前轨迹）永远保留。
export async function enforceDirTotalSize(dir, maxBytes, { keep = [] } = {}) {
  const keepSet = new Set(keep.map((item) => path.resolve(item)));
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return; // 目录不存在即无占用
  }
  const files = [];
  let total = 0;
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      total += stat.size;
      files.push({ full, size: stat.size, mtime: stat.mtimeMs });
    } catch {
      // 并发删除等竞争：跳过该文件
    }
  }
  if (total <= maxBytes) return;
  files.sort((a, b) => a.mtime - b.mtime);
  for (const file of files) {
    if (total <= maxBytes) break;
    if (keepSet.has(path.resolve(file.full))) continue;
    try {
      await fs.unlink(file.full);
      total -= file.size;
    } catch {
      // 删不掉（被占用等）就跳过，下轮再试
    }
  }
}

// 持续追加的日志文件超过 maxBytes 时截掉前半，只留近期记录（与
// crash.log 的既有做法一致）。截半动作只在该文件超限时发生。
export async function halveFileIfOversized(file, maxBytes) {
  let size = 0;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    return; // 文件不存在，无需处理
  }
  if (size <= maxBytes) return;
  try {
    const content = await fs.readFile(file, "utf8");
    await fs.writeFile(file, content.slice(Math.floor(content.length / 2)), "utf8");
  } catch {
    // 截半失败不影响调用方（日志链路本就允许失败）
  }
}
