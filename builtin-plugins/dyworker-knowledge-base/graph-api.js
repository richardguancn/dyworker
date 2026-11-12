import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { o as getCustomCategories, u as openKb } from './upstream/lib/parse-ByetpssQ.js';
import { buildKnowledgeGraph, knowledgeNodes, relationKey, documentNodeId, memoryNodeId } from './graph.js';
import { runKnowledgeJob } from './knowledge-worker.js';

const graphDocuments = `
  SELECT kb.id, kb.source, kb.category, substr(kb.payload, 1, 4001) AS payload, kb.tags, grouped.chunks
  FROM (SELECT MIN(id) AS first_id, COUNT(*) AS chunks FROM kb WHERE source <> '' GROUP BY source
        UNION ALL SELECT id, 1 FROM kb WHERE source IS NULL OR source = '') grouped
  JOIN kb ON kb.id = grouped.first_id`;

function graphOverview(db, memories, saved, aliases) {
  const documents = db.prepare(graphDocuments).all().map(row => ({ ...row, payload: row.payload.slice(0, 4000),
    truncated: row.chunks > 1 || row.payload.length > 4000, tags: JSON.parse(row.tags || '[]') }));
  return buildKnowledgeGraph(knowledgeNodes(memories, documents), saved, aliases);
}

export function loadGraphOverview({ dataDir, memories, saved, aliases }) {
  const db = new DatabaseSync(path.join(dataDir, 'kb.sqlite'), { readOnly: true });
  try { return graphOverview(db, memories, saved, aliases); }
  finally { db.close(); }
}

export function findDocumentMatches({ dataDir, query }) {
  const db = new DatabaseSync(path.join(dataDir, 'kb.sqlite'), { readOnly: true });
  const columns = "DISTINCT kb.source, CASE WHEN kb.source IS NULL OR kb.source = '' THEN kb.id END AS id";
  try {
    const rows = [...query].length >= 3
      ? db.prepare(`SELECT ${columns} FROM kb_fts JOIN kb ON kb.id = kb_fts.rowid WHERE kb_fts MATCH ? AND instr(lower(kb.payload), ?) > 0`)
        .all(`"${query.replaceAll('"', '""')}"`, query)
      : db.prepare(`SELECT ${columns} FROM kb WHERE instr(lower(kb.payload), ?) > 0`).all(query);
    return rows.map(row => documentNodeId(row.source || `条目 ${row.id}`));
  } finally { db.close(); }
}

export function mountGraph(ctx, dataDir) {
  const db = openKb(dataDir);
  ctx.effect(() => () => db.close());
  const file = path.join(dataDir, 'graph-relations.json');
  const controller = new AbortController();
  ctx.effect(() => () => controller.abort(new Error('知识库已停用')));
  const cache = new Map();
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
  const load = async (options = { allWorkspaces: true }, snapshot) => {
    const { rows, provenance } = snapshot ?? await ctx.memory.knowledgeSnapshot(options);
    const memories = rows.map(row => ({ ...row, origins: provenance.sources[row.id] || [] }));
    const aliases = Object.fromEntries(Object.entries(provenance.aliases).map(([from, to]) => [memoryNodeId(from), memoryNodeId(to)]));
    const saved = await read();
    const revision = db.prepare('PRAGMA data_version').get().data_version;
    const digest = crypto.createHash('sha256').update(JSON.stringify([revision, memories, aliases, saved])).digest('hex');
    if (cache.has(digest)) return cache.get(digest);
    const large = memories.length > 120 || saved.length > 400 || db.prepare('SELECT id FROM kb LIMIT 1 OFFSET ?').get(120 - memories.length);
    const result = large
      ? runKnowledgeJob('graph-overview', { dataDir, memories, saved, aliases }, { signal: controller.signal })
      : Promise.resolve(graphOverview(db, memories, saved, aliases));
    cache.set(digest, result);
    if (cache.size > 3) cache.delete(cache.keys().next().value);
    result.catch(() => { if (cache.get(digest) === result) cache.delete(digest); });
    return result;
  };
  const readNode = async (id, offset = 0) => {
    if (typeof id !== 'string') return;
    if (id.startsWith('memory:')) {
      const { rows, provenance } = await ctx.memory.knowledgeSnapshot({ allWorkspaces: true });
      const row = rows.find(row => memoryNodeId(row.id) === id);
      return row && knowledgeNodes([{ ...row, origins: provenance.sources[row.id] || [] }], [])[0];
    }
    if (!id.startsWith('document:')) return;
    const source = decodeURIComponent(id.slice('document:'.length));
    const unsourced = /^条目 (\d+)$/.exec(source)?.[1];
    const pageSize = 8;
    let rows = db.prepare('SELECT id, source, category, payload, tags FROM kb WHERE source = ? ORDER BY id LIMIT ? OFFSET ?')
      .all(source, pageSize + 1, offset);
    if (!rows.length && !offset && unsourced) rows = db.prepare("SELECT id, source, category, payload, tags FROM kb WHERE id = ? AND (source IS NULL OR source = '')").all(Number(unsourced));
    if (!rows.length) return;
    const nextOffset = rows.length > pageSize ? offset + pageSize : undefined;
    const node = knowledgeNodes([], rows.slice(0, pageSize).map(row => ({ ...row, tags: JSON.parse(row.tags || '[]') })))[0];
    return { ...node, nextOffset, previousOffset: offset > 0 ? Math.max(0, offset - pageSize) : undefined };
  };
  const route = (url, method, handler) => ctx.effect(() => ctx.connection.fetch.register({
    path: url, methods: [method], fetch: async request => {
      try { const result = await handler(request); return Response.json(result, { status: result?.ok === false ? 409 : 200 }); }
      catch (error) { return Response.json({ error: error.message || String(error) }, { status: 400 }); }
    },
  }));
  route('/api/kb/graph', 'GET', () => load());
  route('/api/kb/graph/search', 'GET', async request => {
    const query = new URL(request.url).searchParams.get('q')?.trim().toLowerCase();
    return { ids: query ? await runKnowledgeJob('graph-search', { dataDir, query }, { signal: request.signal }) : [] };
  });
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
    const graph = nodes.length > 120 || relations.length > 400
      ? await runKnowledgeJob('graph', [nodes.map(node => ({ ...node, content: node.content.slice(0, 8000) })), relations, aliases], { signal: controller.signal })
      : buildKnowledgeGraph(nodes, relations, aliases);
    const full = new Map(nodes.map(node => [node.id, node.content]));
    return { format: 'dyworker-knowledge-graph', version: 1, exportedAt: new Date().toISOString(),
      nodes: graph.nodes.map(node => ({ ...node, content: full.get(node.id), truncated: false })),
      links: graph.links, topics: graph.topics, savedRelations: relations, memoryAliases: aliases };
  });
  route('/api/kb/graph/detail', 'GET', async request => {
    const params = new URL(request.url).searchParams;
    const offset = Number(params.get('offset'));
    const node = await readNode(params.get('id'), Number.isSafeInteger(offset) && offset > 0 ? offset : 0);
    if (!node) throw new Error('这条内容已被删除或合并，请刷新图谱');
    return node;
  });
  route('/api/kb/graph/relation', 'POST', async request => {
    const bytes = await request.text();
    if (bytes.length > 16_000) throw new Error('关联内容过长');
    const body = JSON.parse(bytes);
    const [source, target] = await Promise.all([readNode(body.source), readNode(body.target)]);
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
