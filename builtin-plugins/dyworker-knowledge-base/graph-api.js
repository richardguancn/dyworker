import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { c as listEntries, o as getCustomCategories, u as openKb } from './upstream/lib/parse-ByetpssQ.js';
import { buildKnowledgeGraph, knowledgeNodes, relationKey, documentNodeId, memoryNodeId } from './graph.js';

export function mountGraph(ctx, dataDir) {
  const db = openKb(dataDir);
  ctx.effect(() => () => db.close());
  const file = path.join(dataDir, 'graph-relations.json');
  let mutations = Promise.resolve();
  const read = async () => {
    try { const data = JSON.parse(await fs.readFile(file, 'utf8')); return Array.isArray(data) ? data : []; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const change = fn => {
    const next = mutations.catch(() => {}).then(async () => {
      const result = await fn(await read());
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(result, null, 2));
      await fs.rename(temporary, file);
    });
    mutations = next; return next;
  };
  const load = async (options = { allWorkspaces: true }) => {
    const { rows, provenance } = await ctx.memory.knowledgeSnapshot(options);
    const memories = rows.map(row => ({ ...row, origins: provenance.sources[row.id] || [] }));
    const aliases = Object.fromEntries(Object.entries(provenance.aliases).map(([from, to]) => [memoryNodeId(from), memoryNodeId(to)]));
    const nodes = knowledgeNodes(memories, listEntries(db));
    return { nodes, graph: buildKnowledgeGraph(nodes, await read(), aliases) };
  };
  const route = (url, method, handler) => ctx.effect(() => ctx.connection.fetch.register({
    path: url, methods: [method], fetch: async request => {
      try { const result = await handler(request); return Response.json(result, { status: result?.ok === false ? 409 : 200 }); }
      catch (error) { return Response.json({ error: error.message || String(error) }, { status: 400 }); }
    },
  }));
  route('/api/kb/graph', 'GET', async () => (await load()).graph);
  const allDocuments = () => db.prepare('SELECT id, category, name, summary, payload, tags, source, updated_at FROM kb ORDER BY id').all().map(row => ({
    id: row.id, category: row.category, name: row.name, summary: row.summary, content: row.payload,
    tags: JSON.parse(row.tags || '[]'), source: row.source, updatedAt: row.updated_at,
  }));
  route('/api/kb/export', 'GET', async () => ({ format: 'dyworker-knowledge', version: 1, exportedAt: new Date().toISOString(),
    description: '资料为导入后解析的内容，不包含原始上传文件。', categories: getCustomCategories(db), entries: allDocuments() }));
  route('/api/kb/graph/export', 'GET', async () => {
    const { rows, provenance } = await ctx.memory.knowledgeSnapshot({ allWorkspaces: true });
    const documents = allDocuments().map(row => ({ ...row, payload: row.content }));
    const nodes = knowledgeNodes(rows.map(row => ({ ...row, origins: provenance.sources[row.id] || [] })), documents);
    const relations = await read();
    const aliases = Object.fromEntries(Object.entries(provenance.aliases).map(([from, to]) => [memoryNodeId(from), memoryNodeId(to)]));
    const graph = buildKnowledgeGraph(nodes, relations, aliases);
    const full = new Map(nodes.map(node => [node.id, node.content]));
    return { format: 'dyworker-knowledge-graph', version: 1, exportedAt: new Date().toISOString(),
      nodes: graph.nodes.map(node => ({ ...node, content: full.get(node.id), truncated: false })),
      links: graph.links, topics: graph.topics, savedRelations: relations, memoryAliases: aliases };
  });
  route('/api/kb/graph/detail', 'GET', async request => {
    const id = new URL(request.url).searchParams.get('id');
    const node = (await load()).nodes.find(node => node.id === id);
    if (!node) throw new Error('这条内容已被删除或合并，请刷新图谱');
    return node;
  });
  route('/api/kb/graph/relation', 'POST', async request => {
    const bytes = await request.text();
    if (bytes.length > 16_000) throw new Error('关联内容过长');
    const body = JSON.parse(bytes);
    const { nodes } = await load();
    const source = nodes.find(node => node.id === body.source), target = nodes.find(node => node.id === body.target);
    if (!source || !target || source.id === target.id) throw new Error('请选择两条不同的有效内容');
    if (source.scope === 'workspace' && target.scope === 'workspace' && source.workspacePath !== target.workspacePath) throw new Error('不同项目的专属记忆不能直接关联');
    const key = relationKey(source.id, target.id);
    await change(saved => [...saved.filter(item => relationKey(item.source, item.target) !== key), {
      source: source.id, target: target.id, label: String(body.label || '相关').trim().slice(0, 80) || '相关',
      ...(body.remove ? { dismissed: true } : {}),
    }]);
    return { ok: true };
  });
  route('/api/kb/memory-history', 'GET', () => ctx.memory.organizationHistory());
  route('/api/kb/organize-memories', 'POST', () => ctx.memory.lint());
  route('/api/kb/undo-memory-organization', 'POST', async request => ctx.memory.undoOrganization((await request.json()).id));
  return {
    load,
    renameSource: (from, to) => change(saved => saved.map(item => ({ ...item,
      source: item.source === documentNodeId(from) ? documentNodeId(to) : item.source,
      target: item.target === documentNodeId(from) ? documentNodeId(to) : item.target,
    }))),
  };
}
