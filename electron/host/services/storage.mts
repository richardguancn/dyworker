// 契约服务 ctx.storage：插件读写自己数据文件的正规入口。
//
// 为什么要有它：插件原先只能从壳层 deps 里拿 dataFile/readJson/writeJson，
// 那是内部实现；而且一旦拿到绝对路径能力，就能写遍整个磁盘。这里收成服务：
//   - 名字相对 <userData>/plugins 解析（插件数据集中一处，便于备份与卸载清理）；
//   - **目录穿越防护**：解析结果必须落在插件数据根之内，`../` 之类直接拒绝；
//   - 原子写（临时文件 + rename）复用 host/io.mts，与主程序其余落盘行为一致。
//
// 与 electron 的边界：本文件不 import electron。
import { Service } from "@deepseek-ai/cordis";
import fs from "node:fs/promises";
import path from "node:path";
import { readJson as readJsonFile, writeJson as writeJsonFile } from "../io.mts";

// The native host and the original DSH context each own a different storage
// service. Do not globally merge this native type into DSH's Context.storage.
// Native consumers use this exported service type within their host boundary.

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

export class StorageService extends Service {
  root;
  /** 主程序既有数据目录：插件可以显式读它（例如复用设置），但不作为默认落点 */
  hostDir;

  constructor(ctx, config = {} as any) {
    super(ctx, "storage");
    this.root = config.root;
    this.hostDir = config.hostDir || config.root;
  }

  /**
   * 解析插件给的文件名。
   *   - 相对名：只允许落在**插件数据根**之内（`../` 穿越直接拒绝），
   *     保证插件数据互相隔离、卸载可整体清理；
   *   - 绝对路径：只允许落在宿主 userDataDir 之内（迁移期插件显式读宿主文件用），
   *     越界同样拒绝。
   */
  resolve(name) {
    const raw = String(name || "").trim();
    if (!raw) throw new Error("storage 需要文件名");
    const hostRoot = path.resolve(this.hostDir);
    if (path.isAbsolute(raw)) {
      const target = path.resolve(raw);
      if (!isInside(hostRoot, target)) throw new Error(`storage 路径越界：${raw}`);
      return target;
    }
    const pluginRoot = path.resolve(this.root);
    const target = path.resolve(pluginRoot, raw);
    if (!isInside(pluginRoot, target)) throw new Error(`storage 路径越界：${raw}`);
    return target;
  }

  file(name) {
    return this.resolve(name);
  }

  async readJson(name, fallback = null) {
    return readJsonFile(this.resolve(name), fallback);
  }

  async writeJson(name, value) {
    const target = this.resolve(name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await writeJsonFile(target, value);
    return target;
  }

  async readText(name, fallback = "") {
    try {
      return await fs.readFile(this.resolve(name), "utf8");
    } catch {
      return fallback;
    }
  }

  async writeText(name, text) {
    const target = this.resolve(name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, String(text), "utf8");
    await fs.rename(temporary, target);
    return target;
  }

  async exists(name) {
    try {
      await fs.access(this.resolve(name));
      return true;
    } catch {
      return false;
    }
  }

  async remove(name) {
    await fs.rm(this.resolve(name), { force: true });
  }
}
