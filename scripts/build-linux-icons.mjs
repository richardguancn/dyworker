// 从已有圆角原图缩放 Linux 菜单常用尺寸，不修改图案。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const LINUX_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function inventory(directory) {
  const files = {};
  for (const size of LINUX_ICON_SIZES) {
    const name = `${size}x${size}.png`;
    const bytes = await fs.readFile(path.join(directory, name));
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
      throw new Error(`Linux 图标尺寸或格式错误：${name}`);
    }
    files[name] = hash(bytes);
  }
  return files;
}

export async function buildLinuxIcons({ checkOnly = false, source = path.join(root, 'build/icon.png'),
  directory = path.join(root, 'build/icons') } = {}) {
  const sourceHash = hash(await fs.readFile(source));
  const receiptFile = path.join(directory, 'sources.json');
  try {
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    const files = await inventory(directory);
    if (receipt.sourceSha256 === sourceHash && JSON.stringify(receipt.files) === JSON.stringify(files)) {
      return { changed: false, files };
    }
  } catch { /* 缺失、过期或损坏的图标必须重新生成。 */ }
  if (checkOnly) throw new Error('Linux 菜单图标缺失或与原图不一致，请运行 npm run build:icons');
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-linux-icons-'));
  try {
    const { runIconsTool } = await import('app-builder-lib/out/toolsets/icons.js');
    await runIconsTool({ inputFile: source, outputFormat: 'set', outDir: stage });
    const files = await inventory(stage);
    await fs.mkdir(directory, { recursive: true });
    for (const name of Object.keys(files)) await fs.copyFile(path.join(stage, name), path.join(directory, name));
    await fs.writeFile(receiptFile, JSON.stringify({ source: '../icon.png', sourceSha256: sourceHash, files }, null, 2) + '\n');
    return { changed: true, files };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildLinuxIcons({ checkOnly: process.argv.includes('--check') });
  console.log(`[icons] Linux 菜单图标${result.changed ? '已从圆角原图生成' : '已是最新'}（${LINUX_ICON_SIZES.length} 种尺寸）`);
}
