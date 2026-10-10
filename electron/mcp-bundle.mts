import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
export async function importMcpBundle(file, root) {
  if (path.extname(file).toLowerCase() !== '.mcpb') throw new Error('请选择 .mcpb 文件');
  if ((await fs.stat(file)).size > 100 * 1024 * 1024) throw new Error('MCP 文件超过 100 MB');
  const zip = new AdmZip(await fs.readFile(file)); const entries = zip.getEntries();
  let total = 0; const names = new Set();
  if (entries.length > 10000) throw new Error('MCP 文件内的文件数量过多');
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..') || name.includes('\0') || name.includes(':') || names.has(name) || ((entry.attr >>> 16) & 0xf000) === 0xa000) throw new Error('MCP 文件包含不安全的文件路径');
    names.add(name); total += entry.header.size;
    if (total > 250 * 1024 * 1024) throw new Error('MCP 文件解压后超过 250 MB');
  }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry || manifestEntry.header.size > 1024 * 1024) throw new Error('MCP 文件缺少有效的 manifest.json');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (!['0.1','0.2','0.3','0.4'].includes(manifest.manifest_version || manifest.dxt_version)) throw new Error('不支持此 MCP 文件的格式版本');
  if (!manifest.name || !manifest.version || !['node','python','binary','uv'].includes(manifest.server?.type) || (manifest.server.type !== 'uv' && typeof manifest.server?.mcp_config?.command !== 'string')) throw new Error('MCP 文件的启动设置不完整');
  if (manifest.compatibility?.platforms && !manifest.compatibility.platforms.includes(process.platform)) throw new Error('此 MCP 文件不支持当前系统');
  const entryPoint = String(manifest.server.entry_point || '').replace(/\\/g, '/');
  if (!entryPoint || !names.has(entryPoint)) throw new Error('MCP 文件缺少启动文件');
  if (manifest.server.type === 'uv' && !names.has('pyproject.toml')) throw new Error('MCP 文件缺少 pyproject.toml');
  const baseConfig = manifest.server.mcp_config || {};
  const config = {...baseConfig, ...baseConfig.platform_overrides?.[process.platform], env: {...baseConfig.env, ...baseConfig.platform_overrides?.[process.platform]?.env}};
  if (config.args != null && (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string'))) throw new Error('MCP 文件的参数格式不正确');
  if (config.env != null && (Array.isArray(config.env) || typeof config.env !== 'object' || Object.values(config.env).some(val => typeof val !== 'string'))) throw new Error('MCP 文件的环境变量格式不正确');
  for (const field of Object.values(manifest.user_config || {}) as any[]) { if (!field || !['string','number','boolean','directory','file'].includes(field.type)) throw new Error('MCP 文件包含不支持的设置类型'); }
  const id = crypto.randomUUID(); const directory = path.join(root, id);
  await fs.mkdir(directory, {recursive: true});
  try {
    for (const entry of entries) {
      const target = path.join(directory, entry.entryName.replace(/\\/g, '/'));
      if (entry.isDirectory) { await fs.mkdir(target, {recursive:true}); continue; }
      await fs.mkdir(path.dirname(target), {recursive:true});
      await fs.writeFile(target, entry.getData(), {mode: (entry.attr >>> 16) & 0o111 ? 0o700 : 0o600});
    }
    const userConfig = Object.fromEntries(Object.entries(manifest.user_config || {}).map(([key, field]: [string, any]) => [key, field.default ?? (field.type === 'boolean' ? false : '')]));
    return {id, name: String(manifest.display_name || manifest.name), command: config.command || 'uv', args: config.args || (manifest.server.type === 'uv' ? ['run', '--project', directory, entryPoint] : []), env: config.env || {}, cwd: directory, enabled: true, transport: 'stdio', bundle: {manifest, directory, userConfig}};
  } catch (error) { await fs.rm(directory, {recursive:true, force:true}); throw error; }
}
