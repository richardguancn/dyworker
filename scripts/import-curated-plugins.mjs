// 显式导入本机插件缓存；正常构建只使用仓库中的快照，不依赖用户的 Codex 目录。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import semver from 'semver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('请指定插件缓存目录');
const destination = path.join(root, 'builtin-plugins', 'curated');
const omitted = new Set(['.git', '.DS_Store', 'node_modules', '__pycache__', '.pytest_cache']);
const excludedPlugins = new Set(['sites', 'slack', 'work-pets']);
const plugins = [];
async function inventory(directory, prefix = '') {
  const files = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (omitted.has(entry.name) || entry.name.endsWith('.pyc')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`插件包含符号链接，请先核对：${relative}`);
    if (entry.isDirectory()) files.push(...await inventory(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}
await fs.mkdir(destination, { recursive: true });
for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || excludedPlugins.has(entry.name)) continue;
  const pluginRoot = path.join(source, entry.name);
  const versions = (await fs.readdir(pluginRoot)).filter(v => semver.valid(v)).sort(semver.rcompare);
  if (!versions.length) continue;
  const version = versions[0];
  const directory = path.join(pluginRoot, version);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.name !== entry.name || manifest.version !== version) throw new Error(`插件名称或版本不一致：${entry.name}`);
  const files = await inventory(directory);
  const target = path.join(destination, entry.name, version);
  await fs.mkdir(target, { recursive: true });
  const hashes = {};
  for (const relative of files) {
    const buffer = await fs.readFile(path.join(directory, relative));
    const file = path.join(target, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    hashes[relative] = createHash('sha256').update(buffer).digest('hex');
  }
  plugins.push({ id: entry.name, version, license: manifest.license || '', files: hashes });
  console.log(`${entry.name}@${version}：${files.length} 个文件`);
}
await fs.writeFile(path.join(destination, 'snapshot.json'), JSON.stringify({ schema: 1, origin: 'openai-curated-remote', plugins }, null, 2) + '\n');
console.log(`已导入 ${plugins.length} 种插件`);
