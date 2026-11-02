// 独立临时数据，不读取或修改用户的实际记忆。用于真实接口和页面交互验收。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { knowledgeExportIpcPlugin } from '../electron/host/plugins/knowledge-export-ipc.mts';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-graph-preview-'));
const builtins = path.join(dir, 'builtins'); await fs.mkdir(builtins);
await fs.symlink(path.join(root, 'builtin-plugins/dyworker-knowledge-base'), path.join(builtins, 'dyworker-knowledge-base'), 'dir');
const host = await createHost({ userDataDir: path.join(dir, 'data'), builtinPluginsDir: builtins, mountPlugins: true });
const previewHandlers = new Map();
await host.plugin(knowledgeExportIpcPlugin({ trustedHandle: (name, handler) => previewHandlers.set(name, handler),
  dialog: { showSaveDialog: async (_window, options) => ({ canceled: false, filePath: path.join(dir, path.basename(options.defaultPath)) }) },
  app: { getPath: () => dir }, fs, path, getMainWindow: () => null }));
await host.fiber.await();
await host.plugins.setEnabled('dyworker-knowledge-base', true);
host.memory.scheduleConsolidation = () => {};
const items = [
  ['服务器部署', '服务器通过 Docker 部署服务，发布之前备份数据库。', '部署与备份'],
  ['本地 Docker 环境', '本地 Docker 服务用于验证部署，数据库配置与服务器保持一致。', '部署与备份'],
  ['异地备份', '服务器数据库每天备份，备份文件另外保存到异地。', '部署与备份'],
  ['达梦数据库', '达梦数据库安装后，需要检查数据库连接和备份策略。', '达梦数据库'],
  ['达梦相关命令', '达梦数据库常用命令包括检查连接、导出备份和恢复数据。', '达梦数据库'],
  ['达梦安装记录', '服务器安装达梦数据库后，核对版本并保留安装命令。', '达梦数据库'],
  ['DYWorker', 'DYWorker 是本地工作助手，支持插件和知识库。', 'DYWorker'],
  ['0dy.yaml 配置', 'DYWorker 插件配置保存在 0dy.yaml，修改插件配置后重新加载。', 'DYWorker'],
  ['知识库完善', 'DYWorker 知识库需要关联记忆，相近内容在图谱中使用相同颜色。', 'DYWorker'],
  ['汇报语言', '向我汇报时使用简体中文，先说结论，再提供依据。', '汇报偏好'],
  ['报告篇幅', '日常汇报简洁，研究报告需要提供详细依据和来源。', '汇报偏好'],
  ['经济运行组需求沟通', '经济运行平台按企业汇总指标，需求沟通需要确认指标范围。', '经济运行'],
  ['企业指标口径', '经济运行平台的企业指标需要写清统计时间与统计范围。', '经济运行'],
  ['汽车补贴需求设计', '汽车补贴申请需要核验购车材料和申请人身份。', '汽车补贴'],
  ['公众侧身份认证', '汽车补贴申请人通过公众侧身份认证后提交购车申请材料。', '汽车补贴'],
  ['Chrome 开启 Gemini', '浏览器中开启 Gemini，先检查账号和区域设置。', '浏览器工具'],
  ['git', '提交代码之前先查看 git 的修改列表。', '开发工具'],
];
for (const [name, content, category] of items) await host.memory.append({ name, content, category, kind: 'fact', scope: 'global' }, '', '示例任务');
if (process.env.KNOWLEDGE_PREVIEW_DENSE === '1') {
  const topics = ['公众号封面检查', '公众号草稿发布', '公众号文章配图', '公众号素材上传', '公众号账号配置', '公众号历史栏目', '公众号排版规范', '公众号视频素材', '公众号文章审核', '公众号发布记录'];
  for (let i = 0; i < 50; i++) await host.memory.append({ name: `${topics[i % topics.length]} ${i + 1}`, content: `示例：${topics[i % topics.length]}需要检查第 ${i + 1} 项，保留对应的操作记录。`, category: ['发布流程', '经验', '内容规范', '常用信息'][i % 4], kind: 'fact', scope: 'global' }, '', '示例任务');
}
await host.memory.append({ name: '项目发布约定', content: '发布之前检查 DYWorker 插件配置并验证知识库。', category: 'DYWorker', kind: 'rule', scope: 'workspace' }, '/示例项目/DYWorker', '项目任务');
await host.memory.consolidate();
await host.memory.append({ name: '汇报要求副本', content: items[9][1], category: '汇报偏好', kind: 'fact', scope: 'global' }, '', '另一次示例任务');
for (const [name, content, category] of [
  ['Docker 部署手册.md', '# 服务部署\n\n使用 Docker 部署服务，发布之前备份 PostgreSQL 数据库。\n\n# 备份检查\n\n检查数据库备份文件，定期验证恢复。', '部署与备份'],
  ['补贴申请说明.md', '# 汽车补贴申请\n\n申请人需要通过身份认证，提交购车发票和申请材料。', '汽车补贴'],
]) await host.connection.dispatch({ path: '/api/kb/import', method: 'POST', body: JSON.stringify({ name, category, contentBase64: Buffer.from(content).toString('base64') }) });

const server = await createServer({ root, optimizeDeps: { entries: ['tests/fixtures/knowledge-graph.html'] }, server: { host: '127.0.0.1', port: Number(process.env.KNOWLEDGE_PREVIEW_PORT || 5187), strictPort: true }, plugins: [{
  name: 'knowledge-graph-real-api', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/kb/')) return next();
      try {
        let body = ''; for await (const chunk of req) body += chunk;
        if (req.url === '/api/kb/preview-export') {
          const result = await previewHandlers.get('knowledge:export')(null, JSON.parse(body));
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result)); return;
        }
        const result = await host.connection.dispatch({ path: req.url, method: req.method, body });
        res.writeHead(result.status, result.headers); res.end(result.body);
      } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
    });
  },
}] });
await server.listen();
console.log(`知识库验收页面：http://127.0.0.1:${server.config.server.port}/tests/fixtures/knowledge-graph.html`);
const close = async () => { await server.close(); await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
