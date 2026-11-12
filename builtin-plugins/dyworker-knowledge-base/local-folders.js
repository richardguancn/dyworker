import { randomUUID } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { a as deleteFile, r as addCategory, t as parseDocument, u as openKb } from './upstream/lib/parse-ByetpssQ.js';
import { isLocalSource } from './local-source.js';
import { runKnowledgeJob } from './knowledge-worker.js';

const textFormats = new Set(['.md', '.markdown', '.txt', '.text', '.json', '.yml', '.yaml']);
const documentFormats = new Set(['.docx', '.doc', '.pdf']);
const folderKey = 'local-folder:';
const fileKey = 'local-file:';
const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
const filePrefix = id => `local://${id}/`;
const errorMessage = error => error instanceof Error ? error.message : String(error);

function transaction(db, write) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = write();
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function readFolders(db) {
  return db.prepare('SELECT value FROM meta WHERE key GLOB ? ORDER BY rowid').all(`${folderKey}*`)
    .map(row => JSON.parse(row.value));
}

function saveMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function removeIndexedFile(db, source) {
  deleteFile(db, source, { removeIndexedTerms: true });
  db.prepare('DELETE FROM meta WHERE key = ?').run(`${fileKey}${source}`);
}

async function scan(db, folder, onProgress) {
  const { id, path: root, category } = folder;
  if (await realpath(root).catch(() => '') !== root || !(await lstat(root)).isDirectory()) {
    throw new Error('无法访问原目录，请恢复原路径或重新连接');
  }
  const prefix = filePrefix(id);
  const previous = new Map(db.prepare('SELECT key, value FROM meta WHERE key GLOB ?').all(`${fileKey}${prefix}*`)
    .map(row => [row.key.slice(fileKey.length), row.value]));
  const report = { updated: 0, unchanged: 0, removed: 0, skipped: 0, failed: 0, issues: [] };
  let processed = 0;
  let nextUpdate = 0;
  const progress = file => {
    const now = Date.now();
    if (now < nextUpdate) return;
    nextUpdate = now + 250;
    onProgress({ processed, file });
  };
  const insert = db.prepare('INSERT INTO kb (category, name, summary, payload, tags, source) VALUES (?, ?, ?, ?, ?, ?)');
  const index = db.prepare('INSERT INTO kb_fts(rowid, name, summary, payload, tags) VALUES (?, ?, ?, ?, ?)');
  const issue = (type, relative, reason) => {
    report[type]++;
    if (report.issues.length < 30) report.issues.push({ path: relative, reason });
  };
  const unreadable = [];

  async function indexFile(file, relative, source, oldStamp) {
    const extension = path.extname(file).toLowerCase();
    const isText = textFormats.has(extension);
    if (!isText && !documentFormats.has(extension)) {
      issue('skipped', relative, '暂不支持此文件格式');
      return;
    }
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || await realpath(file) !== file) throw new Error('文件路径在扫描期间发生变化');
      const limit = isText ? 50 : 20;
      if (stat.size > limit * 1024 * 1024) {
        issue('skipped', relative, `单个${isText ? '文本' : '文档'}文件超过 ${limit} MB`);
        return;
      }
      const stamp = fingerprint(stat);
      if (stamp === oldStamp) { report.unchanged++; return; }
      progress(relative);
      const { chunks } = await parseDocument(file, { maxTextLength: 50 * 1024 * 1024, splitLongLines: true });
      if (fingerprint(await lstat(file)) !== stamp || await realpath(file) !== file) {
        throw new Error('文件在扫描期间发生变化，请再次更新');
      }
      transaction(db, () => {
        deleteFile(db, source, { removeIndexedTerms: true });
        for (const [position, chunk] of chunks.entries()) {
          const name = chunks.length > 1 ? `${chunk.name} (${position + 1}/${chunks.length})` : chunk.name;
          const { lastInsertRowid } = insert.run(category, name, chunk.summary, chunk.payload, '[]', source);
          index.run(lastInsertRowid, name, chunk.summary, chunk.payload, '[]');
        }
        saveMeta(db, `${fileKey}${source}`, stamp);
      });
      report.updated++;
    } catch (error) {
      issue('failed', relative, errorMessage(error));
    }
  }

  async function walk(directory, relative = '') {
    try {
      if (await realpath(directory) !== directory) throw new Error('子目录路径在扫描期间发生变化');
      for await (const entry of await opendir(directory)) {
        if (entry.name.startsWith('.') || (entry.isDirectory() && entry.name === 'node_modules')) continue;
        const file = path.join(directory, entry.name);
        const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
        const source = prefix + relativePath;
        const oldStamp = previous.get(source);
        if (entry.isDirectory()) await walk(file, relativePath);
        else if (entry.isFile()) {
          previous.delete(source);
          await indexFile(file, relativePath, source, oldStamp);
          processed++;
          progress(relativePath);
        }
      }
    } catch (error) {
      if (!relative) throw error;
      unreadable.push(`${prefix}${relative}/`);
      issue('failed', relative, errorMessage(error));
    }
  }

  await walk(root);
  for (const source of previous.keys()) {
    if (unreadable.some(prefix => source.startsWith(prefix))) continue;
    transaction(db, () => removeIndexedFile(db, source));
    report.removed++;
  }
  return report;
}

export async function updateFolderIndex({ dataDir, folder, disconnect }, onProgress) {
  const db = openKb(dataDir);
  try {
    if (!disconnect) return await scan(db, folder, onProgress);
    transaction(db, () => {
      const sources = db.prepare('SELECT key FROM meta WHERE key GLOB ?').all(`${fileKey}${filePrefix(folder.id)}*`);
      for (const row of sources) removeIndexedFile(db, row.key.slice(fileKey.length));
      db.prepare('DELETE FROM meta WHERE key = ?').run(`${folderKey}${folder.id}`);
    });
  } finally { db.close(); }
}

export function mountLocalFolders(ctx, dataDir) {
  let busy = false;
  let progress;
  const db = openKb(dataDir);
  // 后台更新时仍允许读取已提交的资料。资料修改共用一个写入队列。
  db.exec('PRAGMA journal_mode = WAL');
  ctx.effect(() => () => db.close());
  let writes = Promise.resolve();
  const write = (signal, work) => {
    const next = writes.then(() => { signal?.throwIfAborted(); return work(); });
    writes = next.catch(() => {});
    return next;
  };

  ctx.connection.registerDesktop({
    path: '/api/kb/local-folders', methods: ['POST'],
    async fetch(request) {
      const { action, id, category, folderPath } = await request.json();
      if (action === 'list') return Response.json({ folders: readFolders(db), ...(busy ? { progress } : {}) });
      if (busy) return Response.json({ error: '本地资料目录正在更新，请稍后再试' }, { status: 409 });
      busy = true;
      progress = { processed: 0 };
      try {
        return await write(request.signal, async () => {
          const folders = readFolders(db);
          let folder = folders.find(item => item.id === id);
          if (action === 'connect') {
            const root = await realpath(folderPath);
            if (!(await lstat(root)).isDirectory()) throw new Error('请选择本地文件夹');
            const storage = await realpath(dataDir);
            const relative = path.relative(root, storage);
            if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
              throw new Error('请选择具体的资料目录，所选目录包含知识库自身的数据');
            }
            folder = folders.find(item => item.path === root);
            if (!folder) {
              const name = typeof category === 'string' && category.trim() ? category.trim() : path.basename(root) || '本地资料';
              folder = { id: randomUUID(), path: root, category: name };
              transaction(db, () => {
                addCategory(db, name);
                saveMeta(db, `${folderKey}${folder.id}`, JSON.stringify(folder));
              });
            }
          }
          if (!folder) throw new Error('本地资料目录未连接');
          if (!['connect', 'refresh', 'disconnect'].includes(action)) throw new Error('不支持的本地目录操作');
          const report = await runKnowledgeJob('folder', { dataDir, folder, disconnect: action === 'disconnect' }, {
            signal: request.signal, onProgress: update => { progress = update; },
          });
          return Response.json({ folders: readFolders(db), report });
        });
      } catch (error) {
        return Response.json({ error: errorMessage(error), ...(!request.signal.aborted ? { folders: readFolders(db) } : {}) }, { status: 400 });
      } finally { busy = false; progress = undefined; }
    },
  });

  return {
    write,
    editError(route, body) {
      if (['/api/kb/move-file', '/api/kb/rename-file', '/api/kb/delete-file'].includes(route)
        && (isLocalSource(body.source) || isLocalSource(body.newSource))) return '请在本地目录中管理文件，然后更新知识库';
      if (route === '/api/kb/delete-category' && readFolders(db).some(folder => folder.category === body.name)) {
        return '请先断开此分类的本地资料目录';
      }
      return '';
    },
    renameCategory(db, from, to) {
      const affected = readFolders(db).filter(folder => folder.category === from);
      for (const folder of affected) {
        saveMeta(db, `${folderKey}${folder.id}`, JSON.stringify({ ...folder, category: to }));
      }
    },
  };
}
