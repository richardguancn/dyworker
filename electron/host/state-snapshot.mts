// 覆盖前快照：渲染端"整份覆盖"某个状态文件时，先留一份上一版，
// 避免一次异常启动/空状态把用户配置直接冲掉（settings.json 与 workspace-pins.json 都走这里）。
// 只做备份不做拦截：正常清空操作照常生效，事后可从 .bak 取回。
import fs from "node:fs/promises";
import path from "node:path";

const KEEP = 5;

export async function snapshotFileBeforeOverwrite(file, { keep = KEEP, now = () => new Date() } = {}) {
  try {
    await fs.access(file);
  } catch {
    return { ok: false, reason: "no-existing-file" };
  }
  try {
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    const target = `${file}.${stamp}.bak`;
    await fs.copyFile(file, target);
    const dir = path.dirname(file);
    const base = path.basename(file);
    const siblings = (await fs.readdir(dir))
      .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".bak"))
      .sort();
    for (const stale of siblings.slice(0, Math.max(0, siblings.length - keep))) {
      await fs.rm(path.join(dir, stale), { force: true }).catch(() => {});
    }
    return { ok: true, file: target };
  } catch {
    // 备份失败不影响主流程
    return { ok: false, reason: "copy-failed" };
  }
}
