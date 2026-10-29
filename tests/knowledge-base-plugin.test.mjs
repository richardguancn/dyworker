import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, disposeHost } from '../electron/host/context.mts';
import AdmZip from 'adm-zip';

const pluginDir = fileURLToPath(new URL('../builtin-plugins/dyworker-knowledge-base/', import.meta.url));
const toolPrefix = 'plugin__dyworker_knowledge_base__';

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
