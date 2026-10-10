import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 源码按内容校验，不能依赖 checkout 后的时间戳。依赖额外记录 ctime、
// mtime、大小和链接目标，npm 重装或本地修补依赖都会撤销复用资格。
export function fingerprint(root, entries, { metadataOnly = false } = {}) {
  const hash = createHash('sha256');
  function visit(relative, parents = new Set(), absolute = path.join(root, relative)) {
    let stat;
    try { stat = lstatSync(absolute); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update(JSON.stringify([relative, 'missing']));
      return;
    }
    hash.update(JSON.stringify([relative, stat.mode]));
    if (stat.isSymbolicLink()) {
      hash.update(readlinkSync(absolute));
      const target = realpathSync(absolute);
      if (parents.has(target)) throw new Error(`构建输入含循环链接：${relative}`);
      const next = new Set(parents).add(absolute);
      visit(`${relative}->`, next, target);
      return;
    }
    if (stat.isDirectory()) {
      const target = realpathSync(absolute);
      if (parents.has(target)) throw new Error(`构建输入含循环目录：${relative}`);
      const next = new Set(parents).add(target);
      for (const name of readdirSync(absolute).sort()) {
        // 工具自己的临时缓存不是构建输入。
        if (metadataOnly && name === '.cache') continue;
        visit(path.join(relative, name), next, path.join(absolute, name));
      }
    } else if (stat.isFile()) {
      if (metadataOnly) hash.update(JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs]));
      else hash.update(readFileSync(absolute));
    }
  }
  for (const entry of [...entries].sort()) visit(entry);
  return hash.digest('hex');
}

export function readReceipt(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeReceipt(file, receipt) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n');
  renameSync(temporary, file);
}

export function canReuse(receipt, inputs, outputs) {
  return receipt?.version === 1 && receipt.inputs === inputs && receipt.outputs === outputs;
}

export function environmentFingerprint(env = process.env) {
  const values = Object.entries(env).filter(([name]) =>
    !/^(npm_lifecycle_|npm_config_argv$|INIT_CWD$|PWD$|OLDPWD$|SHLVL$|_$)/i.test(name)).sort(([a], [b]) => a.localeCompare(b));
  // 只保存摘要，不把环境变量（包括密钥）写入记录或日志。
  return createHash('sha256').update(JSON.stringify([process.version, process.platform, process.arch, values])).digest('hex');
}
