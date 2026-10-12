import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkillDocument } from './skills.mts';
import { localPluginGuide } from './curated-plugin-guides.ts';

const labels = {
  'data-analytics': ['数据分析', '用数据分析问题并制作图表报告。'],
  'investment-banking': ['投行业务', '整理交易资料和财务分析模型。'],
  'openai-templates': ['办公模板', '使用随应用提供的文档和演示模板。'],
  'plugin-creator': ['制作插件', '制作、修改和整理 DYWorker 本地插件。'],
  'plugin-management': ['管理插件', '管理 DYWorker 中的本地插件。'],
  'product-design': ['产品设计', '研究界面并制作可交互的设计稿。'],
  'public-equity-investing': ['股票研究', '整理公司资料并分析投资观点。'],
  'sales': ['销售工作', '研究客户并整理销售计划和资料。'],
};
const removedPlugins = new Set(['sites', 'slack', 'work-pets']);

export function bundledCuratedRoot() {
  let root = fileURLToPath(new URL('../', import.meta.url));
  if (path.basename(root.replace(/[\\/]$/, '')) === 'dist') root = path.dirname(root.replace(/[\\/]$/, ''));
  const bundled = path.join(root, 'builtin-plugins', 'curated');
  const unpacked = bundled.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
  return unpacked !== bundled && existsSync(unpacked) ? unpacked : bundled;
}

function inside(root, relative) {
  const target = path.resolve(root, relative);
  const rest = path.relative(root, target);
  if (rest === '..' || rest.startsWith(`..${path.sep}`) || path.isAbsolute(rest)) throw new Error('插件资料路径超出范围');
  return target;
}

export async function readCuratedPlugins(root = bundledCuratedRoot()) {
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'snapshot.json'), 'utf8'));
  if (snapshot.schema !== 1 || !Array.isArray(snapshot.plugins)) throw new Error('内置插件清单损坏');
  const result = [];
  for (const record of snapshot.plugins) {
    if (removedPlugins.has(record.id)) continue;
    const directory = inside(root, `${record.id}/${record.version}`);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, '.codex-plugin/plugin.json'), 'utf8'));
    if (manifest.name !== record.id || manifest.version !== record.version) throw new Error('内置插件版本不一致');
    const [name, summary] = labels[record.id] || [manifest.name, manifest.description || ''];
    const adapted = ['plugin-creator', 'plugin-management'].includes(record.id);
    const local = true;
    const connectionFile = manifest.apps ? inside(directory, manifest.apps) : '';
    const connections = connectionFile ? Object.keys(JSON.parse(await fs.readFile(connectionFile, 'utf8')).apps || {}) : [];
    const dependencies = manifest.extensions?.['com.openai']?.dependencies || [];
    const skills = [];
    if (manifest.skills) {
      const skillsRoot = inside(directory, manifest.skills);
      for (const entry of (await fs.readdir(skillsRoot, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const file = path.join(skillsRoot, entry.name, 'SKILL.md');
        if (!record.files[path.relative(directory, file).split(path.sep).join('/')]) continue;
        const skill = parseSkillDocument(await fs.readFile(file, 'utf8'), file, 'builtin');
        if (!skill) continue;
        const guide = localPluginGuide(record.id, entry.name);
        const compatibility = `本技能随 DYWorker 提供。当前插件目录：${directory}。当前技能目录：${path.dirname(file)}。相对路径以原文所在文件的目录为准。\n`
          + '原文中的 Codex、ChatGPT、工具名称或目录是来源环境的说明，不代表 DYWorker 已提供这些功能。执行前检查当前可用工具；读取资料用 read_file，运行本地脚本用 run_command，读取其他工作方法用 list_skills 和 load_skill。同一插件内的工作方法名称带有插件名前缀。生成内容使用当前工作文件夹，保留随应用提供的原始资料。图表优先使用 ECharts。\n'
          + '原文要求的在线服务、账号授权、图像生成、文档制作或发布工具如果不存在，明确说明缺少哪项能力；只完成有工具支持的部分，不把本地文件生成说成已经发布或发送。用户当前要求优先于原文。\n\n以下为来源工作方法：\n';
        skills.push({ ...skill, ...(guide ? { description: guide.description } : {}), id: `builtin-plugin:${record.id}:${entry.name}`, name: `${record.id}:${skill.name}`,
          sourceLabel: `内置 · ${name}`, builtIn: true, pluginId: record.id,
          enabled: local, instructions: guide ? `以下为 DYWorker 本地工作方法，无需连接账号服务。\n\n${guide.instructions}` : compatibility + skill.instructions,
          pluginEntry: entry.name === 'index' || entry.name === record.id });
      }
    }
    result.push({ id: record.id, name, originalName: manifest.interface?.displayName || manifest.name,
      summary, version: record.version, license: manifest.license || '未注明',
      author: manifest.interface?.developerName || manifest.author?.name || '', directory,
      homepage: manifest.homepage || '', local, skills,
      connections: adapted ? [] : [...new Set([...connections, ...dependencies.map(item => item.name)])],
      scope: adapted ? '已改为 DYWorker 本地工作方法，可直接启用，无需连接账号服务。制作插件用于创建、修改和整理本地插件；管理插件使用应用现有的插件管理入口。原始资料保留供参考。'
        : '本地工作方法、脚本和模板已内置；原文要求的工具仍以应用实际提供的为准，在线数据和发布服务需另行连接。' });
  }
  return result;
}
