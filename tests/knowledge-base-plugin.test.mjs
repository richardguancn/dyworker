import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { knowledgeFoldersIpcPlugin } from '../electron/host/plugins/knowledge-folders-ipc.mts';
import AdmZip from 'adm-zip';

const pluginDir = fileURLToPath(new URL('../builtin-plugins/dyworker-knowledge-base/', import.meta.url));
const toolPrefix = 'plugin__dyworker_knowledge_base__';

test('本地目录批量收录、更新与断开，并可用知识库工具检索', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-kb-folders-'));
  const root = path.join(dir, '公司资料');
  const builtins = path.join(dir, 'builtins');
  const data = path.join(dir, 'data');
  await fs.mkdir(path.join(root, '项目甲'), { recursive: true });
  await fs.mkdir(path.join(root, '项目乙'));
  await fs.mkdir(builtins);
  await fs.symlink(pluginDir, path.join(builtins, 'dyworker-knowledge-base'), 'dir');
  const first = path.join(root, '项目甲', '进度.md');
  const second = path.join(root, '项目乙', '进度.md');
  await fs.writeFile(first, '验收时间定在下周三');
  await fs.writeFile(second, '交付日期定在下周五');
  for (let i = 0; i < 55; i++) await fs.writeFile(path.join(root, `资料${i}.txt`), `项目第 ${i} 项记录`);
  await fs.writeFile(path.join(root, '长文本.txt'), `${'a'.repeat(21 * 1024 * 1024)}长文本末尾标记`);
  const tooBig = path.join(root, '超限.pdf');
  await fs.writeFile(tooBig, '');
  await fs.truncate(tooBig, 20 * 1024 * 1024 + 1);
  await fs.writeFile(path.join(root, '照片.png'), '');
  await fs.writeFile(path.join(root, '无法解析.docx'), '损坏文件');
  const outside = path.join(dir, '目录外.md');
  await fs.writeFile(outside, '不在授权目录的文字');
  await fs.symlink(outside, path.join(root, '外部链接.md'));
  let host;
  let handle;
  let canceled = false;
  const openHost = async () => {
    host = await createHost({ userDataDir: data, builtinPluginsDir: builtins, mountPlugins: true });
    await host.plugin(knowledgeFoldersIpcPlugin({ trustedHandle: (_name, handler) => { handle = handler; },
      dialog: { showOpenDialog: async () => ({ canceled, filePaths: canceled ? [] : [root] }) }, getMainWindow: () => null }));
    await host.fiber.await();
    await host.plugins.setEnabled('dyworker-knowledge-base', true);
  };
  t.after(async () => { if (host) await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  await openHost();
  const folderAction = (action, params) => handle(null, { action, ...params });
  const route = async (url, body) => {
    const result = await host.connection.dispatch({ path: url, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    return { status: result.status, ...JSON.parse(result.body) };
  };
  const query = async (query, category) => {
    const result = await host.tools.execute(toolPrefix + 'kb_query', { query, ...(category ? { category } : {}) },
      { sessionId: 's1', runId: 'r1', workspacePath: '', source: 'agent' });
    assert.equal(result.ok, true, result.error);
    return JSON.parse(result.result).rows;
  };
  assert.equal((await route('/api/kb/local-folders', { action: 'connect', folderPath: dir })).status, 404);
  canceled = true;
  assert.deepEqual(await folderAction('connect'), { ok: true, canceled: true });
  canceled = false;
  let finished = false;
  const connection = folderAction('connect', { category: '资料', folderPath: dir }).finally(() => { finished = true; });
  let indexing;
  for (let i = 0; i < 100 && !finished; i++) {
    indexing = await folderAction('list');
    if (indexing.progress?.file) break;
    await delay(20);
  }
  assert.ok(indexing?.progress?.file, '处理文件时能读取更新进度');
  assert.equal((await route('/api/kb/files?summary=1')).status, 200);
  assert.equal(finished, false, '读取资料目录无需等待后台更新完成');
  const connected = await connection;
  assert.equal(connected.ok, true, connected.error);
  assert.equal(connected.report.updated, 58);
  assert.equal(connected.report.skipped, 2);
  assert.equal(connected.report.failed, 1);
  assert.match(connected.report.issues.find(issue => issue.path === '超限.pdf').reason, /20 MB/);
  const { id } = connected.folders[0];
  assert.equal(connected.folders[0].path, await fs.realpath(root));
  const matching = await query('进度.md', '资料');
  assert.equal(matching.length, 2);
  assert.equal(new Set(matching.map(row => row.source)).size, 2);
  assert.equal((await query('不在授权目录的文字')).length, 0);
  const files = (await route('/api/kb/files')).files;
  assert.equal(files.length, 58);
  const large = files.find(file => file.source.endsWith('/长文本.txt'));
  assert.ok(large.count > 1000);
  assert.equal((await query('长文本末尾标记', '资料')).length, 1);
  const page = offset => route(`/api/kb/list?${new URLSearchParams({ source: large.source, offset })}`);
  const head = (await page(0)).rows;
  const next = (await page(100)).rows;
  assert.equal(head.length, 100);
  assert.equal(next.length, 100);
  assert.ok(next[0].id > head.at(-1).id);
  assert.equal((await route('/api/kb/delete-entry', { id: head[0].id })).status, 400);
  assert.equal((await host.tools.execute(toolPrefix + 'kb_delete', { id: head[0].id },
    { sessionId: 's1', runId: 'r1', workspacePath: '', source: 'agent' })).ok, false);
  assert.equal((await route('/api/kb/rename-category', { oldCategory: '资料', newCategory: '项目资料' })).status, 200);

  await disposeHost(host); host = null;
  await openHost();
  assert.deepEqual((await folderAction('list')).folders, [{ id, path: await fs.realpath(root), category: '项目资料' }]);
  assert.equal((await folderAction('refresh', { id })).report.unchanged, 58);
  await fs.writeFile(first, '验收延期到下周二');
  await fs.unlink(second);
  const refreshed = await folderAction('refresh', { id });
  assert.equal(refreshed.report.updated, 1);
  assert.equal(refreshed.report.removed, 1);
  assert.equal((await query('验收时间定在', '项目资料')).length, 0);
  assert.equal((await query('交付日期定在')).length, 0);
  assert.equal((await query('验收延期到', '项目资料')).length, 1);
  assert.equal((await folderAction('disconnect', { id })).ok, true);
  assert.deepEqual((await folderAction('list')).folders, []);
  assert.equal((await query('验收延期到')).length, 0);
  assert.equal(await fs.readFile(first, 'utf8'), '验收延期到下周二');
});

test('知识库插件真实导入、检索、分类、停用和重启恢复', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-kb-'));
  const builtins = path.join(dir, 'builtins');
  const workspace = path.join(dir, 'workspace');
  await fs.mkdir(builtins); await fs.mkdir(workspace);
  await fs.symlink(pluginDir, path.join(builtins, 'dyworker-knowledge-base'), 'dir');
  let host = await createHost({ userDataDir: path.join(dir, 'data'), builtinPluginsDir: builtins, mountPlugins: true });
  t.after(async () => { if (host) await disposeHost(host); await fs.rm(dir, { recursive: true, force: true }); });
  assert.equal((await host.plugins.setEnabled('dyworker-knowledge-base', true)).ok, true);
  const execution = { sessionId: 's1', runId: 'r1', workspacePath: workspace, source: 'agent' };
  const call = (name, args) => host.tools.execute(toolPrefix + name, args, execution);
  const route = async (url, body) => {
    const result = await host.connection.dispatch({ path: url, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    return { status: result.status, value: JSON.parse(result.body) };
  };
  const file = path.join(workspace, '安全制度.md');
  await fs.writeFile(file, '# 安全管理制度\n\n每月进行消防设施检查，并保留检查记录。');
  assert.equal(host.plugins.entries().find(x => x.id === 'dyworker-knowledge-base')?.active, true);
  const imported = await call('kb_import', { path: '安全制度.md', category: '安全' });
  assert.equal(imported.ok, true, imported.error);
  assert.ok(JSON.parse(imported.result).imported > 0);
  const search = await call('kb_query', { query: '消防设施' });
  assert.equal(search.ok, true); assert.equal(JSON.parse(search.result).matched, 1);
  const other = path.join(dir, 'outside.txt'); await fs.writeFile(other, '不允许读取');
  assert.equal((await call('kb_import', { path: other })).ok, false);
  const response = await route('/api/kb/import', { name: '会议记录.txt', contentBase64: Buffer.from('项目周会讨论供应商交付日期').toString('base64') });
  assert.equal(response.status, 200); assert.ok(response.value.imported > 0);
  assert.equal((await route('/api/kb/search?q=供应商')).value.matched, 1);
  const docx = new AdmZip();
  docx.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  docx.addFile('_rels/.rels', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  docx.addFile('word/document.xml', Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>现场设备维护记录</w:t></w:r></w:p></w:body></w:document>'));
  assert.equal((await route('/api/kb/import', { name: '设备.docx', contentBase64: docx.toBuffer().toString('base64') })).status, 200);
  assert.equal((await route('/api/kb/search?q=设备维护')).value.matched, 1);
  const stream = 'BT /F1 12 Tf 20 100 Td (Maintenance checklist) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, obj] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const previousPath = process.env.PATH;
  try { process.env.PATH = ''; assert.equal((await route('/api/kb/import', { name: '维护.pdf', contentBase64: Buffer.from(pdf).toString('base64') })).status, 200); }
  finally { process.env.PATH = previousPath; }
  assert.equal((await route('/api/kb/search?q=Maintenance')).value.matched, 1);
  assert.equal((await route('/api/kb/import', { name: '会议记录.txt', contentBase64: Buffer.from('项目周会讨论采购预算').toString('base64') })).status, 200);
  assert.equal((await route('/api/kb/search?q=供应商')).value.matched, 0);
  assert.equal((await route('/api/kb/search?q=采购预算')).value.matched, 1);
  await route('/api/kb/import', { name: '会议记录.txt', contentBase64: Buffer.from('项目周会讨论供应商交付日期').toString('base64') });
  assert.equal((await route('/api/kb/create-category', { name: '会议' })).status, 200);
  assert.equal((await route('/api/kb/move-file', { source: '会议记录.txt', category: '会议' })).status, 200);
  assert.equal((await route('/api/kb/list?category=会议')).value.matched, 1);
  const report = await route('/api/kb/import', {
    name: '供应商_验收指引.txt', category: '会议',
    contentBase64: Buffer.from('设备验收完成后登记序列号。').toString('base64'),
  });
  assert.equal(report.status, 200);
  assert.equal(report.value.category, '会议');
  for (const query of ['供应商_验收指引.txt', '登记序列号']) {
    const result = await call('kb_query', { query, category: '会议' });
    assert.equal(result.ok, true, result.error);
    assert.equal(JSON.parse(result.result).rows[0].source, '供应商_验收指引.txt');
  }
  const wrongCategory = await call('kb_query', { query: '登记序列号', category: '未分类' });
  assert.equal(wrongCategory.ok, true, wrongCategory.error);
  assert.equal(JSON.parse(wrongCategory.result).matched, 0);
  assert.equal((await route('/api/kb/search?q=供应商_验收指引.txt')).value.rows[0].category, '会议');
  await route('/api/kb/delete-file', { source: '供应商_验收指引.txt' });
  await host.plugins.setEnabled('dyworker-knowledge-base', false);
  assert.equal(host.tools.owns(toolPrefix + 'kb_query'), false);
  assert.equal((await host.connection.dispatch({ path: '/api/kb/list' })).status, 404);
  await host.plugins.setEnabled('dyworker-knowledge-base', true);
  assert.equal((await route('/api/kb/search?q=供应商')).value.matched, 1);
  await disposeHost(host); host = null;
  host = await createHost({ userDataDir: path.join(dir, 'data'), builtinPluginsDir: builtins, mountPlugins: true });
  assert.equal((await route('/api/kb/search?q=消防设施')).value.matched, 1);
  assert.equal((await route('/api/kb/delete-file', { source: '会议记录.txt' })).status, 200);
  assert.equal((await route('/api/kb/search?q=供应商')).value.matched, 0);
});
