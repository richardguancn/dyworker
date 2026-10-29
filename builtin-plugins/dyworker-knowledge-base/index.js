import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as upstream from './upstream/lib/index.js';
import * as upstreamWeb from './upstream/lib/web.js';

export const name = 'dyworker-knowledge-base';
export const inject = ['tools', 'storage', 'connection', 'memory'];
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const readRoutes = new Set(['/api/kb/list', '/api/kb/search', '/api/kb/files']);

function workspaceFile(workspace, value) {
  if (!workspace || typeof value !== 'string' || !value.trim()) throw new Error('需要工作文件夹中的文件路径');
  const root = fs.realpathSync(workspace);
  const target = fs.realpathSync(path.resolve(root, value));
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('请先将资料放入当前工作文件夹，或在知识库页面选择文件导入');
  }
  if (!fs.statSync(target).isFile()) throw new Error('请选择普通文件');
  return target;
}

function adaptRoute(handler, request) {
  return new Promise(async (resolve, reject) => {
    try {
      const bytes = ['GET', 'HEAD'].includes(request.method) ? Buffer.alloc(0) : Buffer.from(await request.text());
      if (bytes.byteLength > MAX_REQUEST_BYTES) return resolve(Response.json({ error: '请求内容过大' }, { status: 413 }));
      if (new URL(request.url).pathname === '/api/kb/import') {
        const body = JSON.parse(bytes.toString('utf8'));
        if (typeof body.contentBase64 === 'string' && Buffer.byteLength(body.contentBase64, 'base64') > 20 * 1024 * 1024)
          return resolve(Response.json({ error: '单个文件不能超过 20 MB' }, { status: 413 }));
      }
      const input = Readable.from([bytes]);
      input.url = new URL(request.url).pathname + new URL(request.url).search;
      let status = 200, headers = {};
      const response = {
        writeHead(code, values) { status = code; headers = values || {}; },
        end(body = '') { resolve(new Response(body, { status, headers })); },
      };
      await handler(input, response);
    } catch (error) { reject(error); }
  });
}

export function apply(ctx) {
  const dataDir = ctx.storage.resolve('knowledge-base');
  fs.mkdirSync(dataDir, { recursive: true });
  const config = { categories: [], dataDir };
  const definitions = [];
  const closeTools = upstream.apply({ tools: { register: definition => definitions.push(definition) } }, config);
  ctx.effect(() => closeTools);
  for (const definition of definitions) {
    ctx.effect(() => ctx.tools.register({
      plugin: name, name: definition.name, description: definition.description + (definition.name === 'kb_query' ? ' 同时检索当前任务可使用的个人记忆。' : ''),
      parameters: definition.parameters,
      handler: async (args, execution) => {
        const input = definition.name === 'kb_import' ? { ...args, path: workspaceFile(execution.workspacePath, args?.path) } : args;
        const result = await definition.execute(input, { signal: execution.signal });
        if (definition.name !== 'kb_query') return result;
        const query = String(input.query || '').trim().toLowerCase();
        const category = String(input.category || '').trim();
        const memories = (await ctx.memory.knowledgeRows({ workspacePath: execution.workspacePath }))
          .filter(row => (!category || row.category === category) && query && `${row.name} ${row.category} ${row.content}`.toLowerCase().includes(query))
          .slice(0, 50).map(row => ({ id: row.id, category: row.category, name: row.name || row.category,
            summary: row.content, source: '个人记忆', scope: row.scope, detail: row.content }));
        const documentResult = JSON.parse(result);
        return JSON.stringify({ ...documentResult, matched: documentResult.matched + memories.length,
          rows: [...(documentResult.rows || []), ...memories], ...(memories.length ? { hint: undefined } : {}) });
      },
    }));
  }
  const routes = [];
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/kb/memories', methods: ['GET'],
    fetch: async () => Response.json({ rows: await ctx.memory.knowledgeRows({ allWorkspaces: true }) }),
  }));
  const closeWeb = upstreamWeb.apply({
    webServer: { register: route => routes.push(route) },
    get: () => undefined,
  }, config);
  ctx.effect(() => closeWeb);
  for (const route of routes) {
    if (route.path === '/api/kb/classify') continue;
    ctx.effect(() => ctx.connection.fetch.register({
      path: route.path, methods: [readRoutes.has(route.path) ? 'GET' : 'POST'],
      fetch: request => adaptRoute(route.handler, request),
    }));
  }
}
