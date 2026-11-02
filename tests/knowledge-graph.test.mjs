import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { buildKnowledgeGraph, knowledgeNodes, memoryNodeId, documentNodeId } from '../builtin-plugins/dyworker-knowledge-base/graph.js';
import { buildPageContent, parsePageContent, workspacePageRelPath } from '../electron/memory-wiki.mts';
import { validateOrganization } from '../electron/memory-organization.mts';
import { knowledgeExportIpcPlugin } from '../electron/host/plugins/knowledge-export-ipc.mts';

const memory = (id, content, extra = {}) => ({ id, content, name: '', category: '常用信息', kind: 'fact', scope: 'global', workspacePath: '', ...extra });

test('不同分类的公众号记忆按共同主题聚集，形成可解释的关联，不混入其他主题', () => {
  const entries = [
    memory('a', '发布前检查草稿封面。', { name: '公众号草稿封面核验', category: '发布规范' }),
    memory('b', '素材上传失败时检查错误码。', { name: '公众号素材上传错误', category: '排障经验' }),
    memory('c', '正文中的配图需要标注来源。', { name: '公众号配图版权', category: '内容规范' }),
    memory('d', '发送内容前核对文章标题。', { name: '公众号发文规则', category: '工作流程' }),
    memory('x', '运行备份并检查数据库服务。', { name: '数据库备份', category: '排障经验' }),
  ];
  const graph = buildKnowledgeGraph(knowledgeNodes(entries, []));
  const group = graph.nodes.filter(node => node.name.includes('公众号'));
  assert.equal(new Set(group.map(node => node.color)).size, 1);
  assert.notEqual(graph.nodes.find(node => node.memoryId === 'x').color, group[0].color);
  const related = graph.links.filter(link => link.reason === '共同主题：公众号');
  assert.ok(related.length >= 3);
  assert.ok(related.every(link => link.score < .45));
});

test('图谱按内容聚类着色，资料按文件汇总，不因同分类而强行连线', () => {
  const nodes = knowledgeNodes([
    memory('a', '使用 Docker 部署服务，数据库使用 PostgreSQL', { name: '服务器部署' }),
    memory('b', 'Docker 部署服务，定期备份 PostgreSQL 数据库', { name: 'Docker 服务备份' }),
    memory('c', '出差后提交高铁票和发票办理报销', { name: '差旅报销' }),
    memory('d', '报告完成之后需要检查数值', { name: '报告检查' }),
  ], [
    { id: 1, source: '报销.md', category: '办公', payload: '报销时提交发票', tags: [] },
    { id: 2, source: '报销.md', category: '办公', payload: '高铁票需要提交', tags: [] },
  ]);
  const graph = buildKnowledgeGraph(nodes);
  const byId = Object.fromEntries(graph.nodes.map(node => [node.id, node]));
  assert.equal(graph.nodes.length, 5);
  assert.equal(byId['memory:a'].color, byId['memory:b'].color);
  assert.notEqual(byId['memory:a'].color, byId['memory:c'].color);
  assert.notEqual(byId['memory:a'].color, byId['memory:d'].color);
  assert.ok(graph.links.some(link => link.source === 'memory:a' && link.target === 'memory:b' && link.reason));
  assert.ok(!graph.links.some(link => [link.source, link.target].includes('memory:d')));
  assert.equal(byId[documentNodeId('报销.md')].chunks, 2);
  assert.deepEqual(buildKnowledgeGraph(nodes).topics, graph.topics, '同一份内容的颜色稳定');
});

test('合并后的关联转向保留记忆，解除关系后不会因自动发现而重新出现', () => {
  const nodes = knowledgeNodes([memory('kept', 'Docker 部署和备份'), memory('other', 'Docker 部署和备份')], []);
  const original = { source: 'memory:old', target: 'memory:other', label: '补充说明' };
  const aliases = { 'memory:old': 'memory:kept' };
  let graph = buildKnowledgeGraph(nodes, [original], aliases);
  assert.equal(graph.links[0].kind, 'manual'); assert.equal(graph.links[0].source, 'memory:kept');
  graph = buildKnowledgeGraph(nodes, [original, { source: 'memory:kept', target: 'memory:other', dismissed: true }], aliases);
  assert.equal(graph.links.length, 0);
});

test('图谱不连接不同项目专属记忆，孤立节点和空库仍可展示', () => {
  const nodes = knowledgeNodes([memory('a', 'Docker 部署和备份', { scope: 'workspace', workspacePath: '/a' }), memory('b', 'Docker 部署和备份', { scope: 'workspace', workspacePath: '/b' })], []);
  const graph = buildKnowledgeGraph(nodes, [{ source: 'memory:a', target: 'memory:b' }]);
  assert.equal(graph.nodes.length, 2); assert.equal(graph.links.length, 0);
  assert.deepEqual(buildKnowledgeGraph([]), { nodes: [], links: [], topics: [] });
});

test('整理拒绝静默丢失、改写、凭空新增、跨项目合并，保留名字和冲突', () => {
  const page = (path, rows, workspacePath = '') => parsePageContent(buildPageContent({ title: '记忆', rows, workspacePath }), path);
  const pages = [page('pages/facts.md', [memory('a', '以后用中文', { name: '语言偏好' }), memory('b', '请用中文')])];
  const change = content => ({ pages: [{ path: 'pages/facts.md', content }], merges: [] });
  assert.throws(() => validateOrganization(pages, change('# 常用信息\n')), /遗漏/);
  assert.throws(() => validateOrganization(pages, change(buildPageContent({ title: '记忆', rows: [memory('a', '随意改写', { name: '语言偏好' }), memory('b', '请用中文')] }))), /改写/);
  assert.throws(() => validateOrganization(pages, change(buildPageContent({ title: '记忆', rows: [memory('new', '凭空新增')] }))), /新增/);
  const valid = validateOrganization(pages, { pages: [{ path: 'pages/facts.md', content: buildPageContent({ title: '记忆', rows: [memory('a', '以后用中文', { name: '语言偏好' })] }) }], merges: [{ targetId: 'a', sourceIds: ['b'] }] });
  assert.equal(valid.merges.length, 1);
  const conflict = validateOrganization(pages, { pages: [], conflicts: [{ ids: ['a', 'b'], reason: '需要确认' }] });
  assert.equal(conflict.conflicts.length, 1);
  assert.throws(() => validateOrganization(pages, change(buildPageContent({ title: '记忆', rows: [memory('a', '以后用中文'), memory('b', '请用中文')] }))), /名字/);
  const projectPages = [page(workspacePageRelPath('/a'), [memory('pa', '项目预算为 100 万元')], '/a'), page(workspacePageRelPath('/b'), [memory('pb', '项目预算为 100 万元')], '/b')];
  assert.throws(() => validateOrganization(projectPages, { pages: [{ path: workspacePageRelPath('/b'), content: buildPageContent({ title: '项目', rows: [], workspacePath: '/b' }) }], merges: [{ targetId: 'pa', sourceIds: ['pb'] }] }), /范围/);
  const numericPages = [page('pages/facts.md', [memory('n1', '差旅预算 100 万元'), memory('n2', '差旅预算 100 万元，适用于本年度')])];
  assert.throws(() => validateOrganization(numericPages, { pages: [{ path: 'pages/facts.md', content: buildPageContent({ title: '记忆', rows: [memory('n1', '差旅预算 10 万元')] }) }], merges: [{ targetId: 'n1', sourceIds: ['n2'] }] }), /数值和单位/);
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-knowledge-graph-'));
  const builtins = path.join(dir, 'builtins'); await fs.mkdir(builtins);
  await fs.symlink(fileURLToPath(new URL('../builtin-plugins/dyworker-knowledge-base/', import.meta.url)), path.join(builtins, 'dyworker-knowledge-base'), 'dir');
  let host = await createHost({ userDataDir: path.join(dir, 'data'), builtinPluginsDir: builtins, mountPlugins: true });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  await host.plugins.setEnabled('dyworker-knowledge-base', true);
  host.memory.scheduleConsolidation = () => {};
  const route = async (url, body) => {
    const result = await host.connection.dispatch({ path: url, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    return { status: result.status, ...JSON.parse(result.body) };
  };
  const restart = async () => {
    await disposeHost(host); host = await createHost({ userDataDir: path.join(dir, 'data'), builtinPluginsDir: builtins, mountPlugins: true });
    host.memory.scheduleConsolidation = () => {}; return host;
  };
  return { host, route, restart, dir };
}

test('真实整理合并重复记忆，保留原文和关联，重启后可撤销且不影响会话记忆', async t => {
  let { host, route, restart } = await fixture(t);
  const a = await host.memory.append(memory('', '季度报告需要核对所有数值', { name: '报告要求' }), '/a', 'origin-task');
  await host.memory.consolidate();
  const b = await host.memory.append(memory('', '季度报告需要核对所有数值', { name: '检查要求' }), '/a', 'second-task');
  const c = await host.memory.append(memory('', '资料完成后保存到项目目录'), '/a', 'second-task');
  await host.memory.append(memory('', '仅在当前任务使用', { scope: 'session' }), '/a', 'session-one');
  await route('/api/kb/graph/relation', { source: memoryNodeId(b.id), target: memoryNodeId(c.id), label: '补充说明' });
  const organized = await route('/api/kb/organize-memories', {});
  assert.equal(organized.ok, true); assert.equal(organized.merged, 1);
  let graph = await route('/api/kb/graph');
  assert.ok(!graph.nodes.some(node => node.id === memoryNodeId(b.id)));
  assert.equal(graph.nodes.find(node => node.id === memoryNodeId(a.id)).origins.length, 2);
  assert.ok(graph.links.some(link => link.source === memoryNodeId(a.id) && link.target === memoryNodeId(c.id)));
  assert.equal((await host.memory.readSaved()).filter(item => item.scope !== 'session').length, 0, '合并后来源编号不会反复排队');
  assert.ok(!JSON.stringify(graph).includes('仅在当前任务使用'));
  host = await restart();
  const records = await route('/api/kb/memory-history');
  assert.equal(records.rows[0].canUndo, true); assert.equal(records.rows[0].merges[0].before.length, 2);
  await host.memory.append(memory('', '整理之后新加的会话约定', { scope: 'session' }), '/a', 'session-two');
  assert.equal((await route('/api/kb/undo-memory-organization', { id: records.rows[0].id })).ok, true);
  graph = await route('/api/kb/graph');
  assert.ok(graph.nodes.some(node => node.id === memoryNodeId(b.id)));
  assert.ok(graph.links.some(link => link.source === memoryNodeId(b.id) && link.target === memoryNodeId(c.id)));
  assert.equal((await host.memory.readSaved()).filter(item => item.scope === 'session').length, 2);
});

test('整理后新增或编辑的记忆不会被撤销覆盖；不同条件的内容分别保留', async t => {
  const { host, route } = await fixture(t);
  await host.memory.append(memory('', '日常汇报简洁', { kind: 'preference' }), '/a');
  await host.memory.append(memory('', '研究报告要提供详细依据', { kind: 'preference' }), '/a');
  await host.memory.append(memory('', '项目预算为 100 万元', { scope: 'workspace' }), '/a');
  await host.memory.append(memory('', '项目预算为 200 万元', { scope: 'workspace' }), '/b');
  const organized = await route('/api/kb/organize-memories', {});
  assert.equal(organized.merged, 0); assert.equal((await route('/api/kb/graph')).nodes.length, 4);
  const latest = (await route('/api/kb/memory-history')).rows[0];
  await host.memory.append(memory('', '后来新增的重要记忆'), '/a');
  const undo = await route('/api/kb/undo-memory-organization', { id: latest.id });
  assert.equal(undo.status, 409); assert.match(undo.error, /已有新增或修改/);
  assert.ok(JSON.stringify(await route('/api/kb/graph')).includes('后来新增的重要记忆'));
});

test('手动关联、解除、资料改名和重新导入后的关系正确持久保存', async t => {
  let { host, route, restart } = await fixture(t);
  const item = await host.memory.append(memory('', '写作时查阅报告规范'), '/a');
  const contentBase64 = Buffer.from('报告写作需要标注数据来源').toString('base64');
  await route('/api/kb/import', { name: '报告.md', contentBase64 });
  const source = memoryNodeId(item.id), target = documentNodeId('报告.md');
  assert.equal((await route('/api/kb/graph/relation', { source, target, label: '参考资料' })).ok, true);
  await route('/api/kb/import', { name: '报告.md', contentBase64 });
  assert.ok((await route('/api/kb/graph')).links.some(link => link.kind === 'manual' && link.target === target));
  await route('/api/kb/rename-file', { source: '报告.md', newSource: '报告规范.md' });
  host = await restart();
  const renamed = documentNodeId('报告规范.md');
  assert.ok((await route('/api/kb/graph')).links.some(link => link.kind === 'manual' && link.target === renamed));
  await route('/api/kb/graph/relation', { source, target: renamed, remove: true });
  assert.ok(!(await route('/api/kb/graph')).links.some(link => [link.source, link.target].includes(renamed)));
  await route('/api/kb/delete-file', { source: '报告规范.md' });
  assert.equal((await route('/api/kb/graph')).nodes.length, 1);
  assert.equal((await route('/api/kb/graph/relation', { source, target: 'missing' })).status, 400);
});

test('AI 语义合并明确记录来源，模型漏条或随意改写时保留原文', async t => {
  const { host, route } = await fixture(t);
  const a = await host.memory.append(memory('', '以后汇报用简体中文', { name: '汇报语言' }), '/a');
  const b = await host.memory.append(memory('', '向我汇报时，请使用简体中文'), '/a');
  await host.memory.consolidate();
  t.mock.method(host.settings, 'read', async () => ({ endpoint: 'http://mock.local/v1/chat/completions', model: 'mock-model', apiKey: 'test' }));
  let response = { pages: [{ path: 'pages/facts.md', content: '# 常用信息\n' }] };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(response) } }] }));
  await route('/api/kb/organize-memories', {});
  assert.equal((await route('/api/kb/graph')).nodes.length, 2, '无明确合并记录时拒绝漏条结果');
  response = { pages: [{ path: 'pages/facts.md', content: buildPageContent({ title: '常用信息', rows: [{ ...a }] }) }], merges: [{ targetId: a.id, sourceIds: [b.id], reason: '同一语言要求' }] };
  const result = await route('/api/kb/organize-memories', {});
  assert.equal(result.merged, 1);
  const graph = await route('/api/kb/graph'); assert.equal(graph.nodes.length, 1); assert.equal(graph.nodes[0].origins.length, 2);
});

test('沿关联检索补充资料，仍遵守当前项目范围', async t => {
  const { host, route } = await fixture(t);
  const a = await host.memory.append(memory('', '采购设备时执行专属验收流程'), '/a');
  const supplement = await host.memory.append(memory('', '清单包括发票、保修单和签收单', { scope: 'workspace' }), '/a');
  const hidden = await host.memory.append(memory('', '另一个项目的私人材料', { scope: 'workspace' }), '/b');
  await route('/api/kb/graph/relation', { source: memoryNodeId(a.id), target: memoryNodeId(supplement.id), label: '验收材料' });
  await route('/api/kb/graph/relation', { source: memoryNodeId(a.id), target: memoryNodeId(hidden.id), label: '项目材料' });
  const query = async workspacePath => {
    const response = await host.tools.execute('plugin__dyworker_knowledge_base__kb_query', { query: '专属验收' }, { sessionId: 's1', runId: 'r1', workspacePath, source: 'agent' });
    assert.equal(response.ok, true, response.error); return JSON.parse(response.result);
  };
  const found = await query('/a');
  assert.ok(found.rows.some(row => row.id === supplement.id && row.matchedVia === '关联内容'));
  assert.ok(!JSON.stringify(found).includes('私人材料'));
  assert.ok(!JSON.stringify(await query('/c')).includes('保修单'));
});

test('整理过程中新增的记忆不会被清队操作覆盖', async t => {
  const { host, route } = await fixture(t);
  await host.memory.append(memory('', '已有信息一'), '/a');
  await host.memory.append(memory('', '已有信息二'), '/a');
  await host.memory.consolidate();
  t.mock.method(host.settings, 'read', async () => ({ endpoint: 'http://mock.local/v1/chat/completions', model: 'mock-model' }));
  let entered, release;
  const called = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { entered(); await blocked; return Response.json({ choices: [{ message: { content: '{"pages":[],"merges":[]}' } }] }); });
  const organizing = route('/api/kb/organize-memories', {});
  await called;
  const appended = host.memory.append(memory('', '整理时新到的重要信息'), '/a');
  release(); await organizing; await appended;
  assert.ok(JSON.stringify(await route('/api/kb/graph')).includes('整理时新到的重要信息'));
});

test('整理期间异常退出后，重启恢复原文且不留下失真的整理记录', async t => {
  let { host, route, restart } = await fixture(t);
  const item = await host.memory.append(memory('', '异常退出前的重要原文'), '/a');
  await host.memory.consolidate();
  const before = await host.memory.organizationState();
  await fs.writeFile(host.memory.file('memory-organization-journal.json'), JSON.stringify({ id: 'interrupted', before }));
  await fs.writeFile(path.join(host.memory.wikiRoot(), 'pages/facts.md'), '# 记忆\n');
  host = await restart();
  const graph = await route('/api/kb/graph');
  assert.ok(graph.nodes.some(node => node.id === memoryNodeId(item.id) && node.content === item.content));
  await assert.rejects(fs.access(host.memory.file('memory-organization-journal.json')));
});

test('真实导出记忆、完整资料、图谱数据和图片，取消保存不会写入', async t => {
  const { host, route, dir } = await fixture(t);
  const item = await host.memory.append(memory('', '需要保留的个人记忆'), '/a', '来源任务');
  await host.memory.append(memory('', '仅本任务的约定', { scope: 'session' }), '/a', '当前任务');
  const longText = `项目背景 ${'资料正文内容'.repeat(2000)} 最后内容`;
  await route('/api/kb/import', { name: '资料.txt', contentBase64: Buffer.from(longText).toString('base64') });
  await route('/api/kb/create-category', { name: '空目录' });
  await route('/api/kb/graph/relation', { source: memoryNodeId(item.id), target: documentNodeId('资料.txt'), label: '参考资料' });
  const handlers = new Map(); let target = path.join(dir, 'output'); let canceled = false;
  await host.plugin(knowledgeExportIpcPlugin({ trustedHandle: (name, handler) => handlers.set(name, handler),
    dialog: { showSaveDialog: async () => ({ canceled, filePath: target }) }, app: { getPath: () => dir }, fs, path, getMainWindow: () => null }));
  await host.fiber.await();
  const exportFile = payload => handlers.get('knowledge:export')(null, payload);
  for (const [kind, format] of [['memories', 'dyworker-memories'], ['knowledge', 'dyworker-knowledge'], ['graph', 'dyworker-knowledge-graph']]) {
    target = path.join(dir, kind); const result = await exportFile({ kind }); assert.equal(result.ok, true, result.error);
    const data = JSON.parse(await fs.readFile(`${target}.json`, 'utf8')); assert.equal(data.format, format);
    if (kind === 'memories') {
      assert.match(JSON.stringify(data.pages), /需要保留的个人记忆/);
      assert.match(JSON.stringify(data.pages), /仅本任务的约定/);
      assert.equal(data.provenance.sources[item.id][0].originSessionId, '来源任务');
    } else if (kind === 'knowledge') {
      assert.ok(data.categories.includes('空目录'));
      assert.match(JSON.stringify(data.entries), /最后内容/);
    } else {
      assert.ok(data.nodes.some(node => node.source === '资料.txt' && node.content.includes('最后内容')));
      assert.ok(data.savedRelations.some(link => link.label === '参考资料'));
      assert.ok(!JSON.stringify(data.nodes).includes('仅本任务的约定'));
    }
  }
  target = path.join(dir, 'picture');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await exportFile({ kind: 'image', image: `data:image/png;base64,${png.toString('base64')}` })).ok, true);
  assert.deepEqual(await fs.readFile(`${target}.png`), png);
  assert.equal((await exportFile({ kind: 'image', image: 'data:image/png;base64,YWJj' })).ok, false);
  canceled = true; target = path.join(dir, 'canceled');
  assert.equal((await exportFile({ kind: 'knowledge' })).canceled, true);
  await assert.rejects(fs.access(`${target}.json`));
});
