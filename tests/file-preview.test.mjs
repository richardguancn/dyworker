import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFilePreview, requestFilePreview, filePreviewToolDefinitions, MAX_PREVIEW_BYTES } from '../electron/file-preview.mts';
import { runAgent } from '../electron/agent.mts';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-preview-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('图片、PDF、中文路径和文本直接读取，无需服务', async t => {
  const root = await fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2hZkAAAAASUVORK5CYII=', 'base64');
  for (const [name, content, kind] of [['示例 # 图片.PNG', png, 'image'], ['报告.pdf', '%PDF-1.4\n', 'pdf'], ['说明.md', '# 标题\n正文', 'markdown'], ['数据.csv', '姓名,数量\n小明,3', 'text'], ['页面.html', '<script>alert(1)</script>', 'text']]) {
    await fs.writeFile(path.join(root, name), content);
    const result = await readFilePreview(root, name);
    assert.equal(result.ok, true); assert.equal(result.kind, kind);
    if (result.data) assert.deepEqual(Buffer.from(result.data, 'base64'), Buffer.from(content));
    else assert.equal(result.content, content);
  }
});
test('Word 文档展示提取的正文并标明排版限制', async t => {
  const root = await fixture(t);
  const doc = path.join(root, '中文文档.docx');
  const made = spawnSync('python3', ['electron/scripts/make_docx.py'], { input: JSON.stringify({ path: doc, title: '验收标题', paragraphs: ['正文内容'] }), encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const result = await readFilePreview(root, doc);
  assert.equal(result.ok, true, result.error); assert.match(result.content, /验收标题[\s\S]*正文内容/); assert.match(result.note, /原始排版/);
});
test('拒绝越界、软链接逃逸、目录、缺失和超大文件；未知格式明确降级', async t => {
  const root = await fixture(t); const outside = await fixture(t);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  for (const target of [path.join(outside, 'secret.txt'), 'link.txt', '.', 'missing.png']) assert.equal((await readFilePreview(root, target)).ok, false, target);
  const large = path.join(root, 'large.png'); await fs.writeFile(large, ''); await fs.truncate(large, MAX_PREVIEW_BYTES + 1);
  assert.match((await readFilePreview(root, large)).error, /32 MB/);
  await fs.writeFile(path.join(root, 'archive.zip'), 'binary');
  assert.equal((await readFilePreview(root, 'archive.zip')).kind, 'unsupported');
  await fs.writeFile(path.join(root, 'binary.txt'), Buffer.from([65, 0, 66]));
  assert.equal((await readFilePreview(root, 'binary.txt')).kind, 'unsupported');
  await fs.writeFile(path.join(root, 'empty.png'), '');
  assert.match((await readFilePreview(root, 'empty.png')).error, /文件为空/);
  await fs.writeFile(path.join(root, 'bad.docx'), 'not a document');
  assert.equal((await readFilePreview(root, 'bad.docx')).ok, false);
});
test('Agent 预览请求保留会话归属，失败不发送事件', async t => {
  const root = await fixture(t); await fs.writeFile(path.join(root, 'a.txt'), 'hello');
  const sent = []; const renderer = { isDestroyed: () => false, send: (...args) => sent.push(args) };
  const context = { workspacePath: root, sessionId: 'owner', renderer };
  assert.equal((await requestFilePreview({ path: 'a.txt' }, context)).ok, true);
  assert.equal(sent[0][0], 'file:panel-request'); assert.equal(sent[0][1].ownerSessionId, 'owner');
  assert.equal((await requestFilePreview({ path: 'missing.txt' }, context)).ok, false); assert.equal(sent.length, 1);
  assert.equal((await requestFilePreview({ path: 'a.txt' }, { ...context, renderer: null })).ok, false);
  assert.equal((await requestFilePreview({ path: 'a.txt' }, { ...context, sessionId: '' })).ok, false);
  assert.equal(sent.length, 1);
});
test('真实 Agent 循环可发现并调用 open_file，无需命令或浏览器', async t => {
  const root = await fixture(t); await fs.writeFile(path.join(root, 'a.txt'), 'hello');
  let requests = 0; const sent = [];
  const result = await runAgent({
    settings: { endpoint: 'https://example.com/v1/chat/completions', model: 'test', apiKey: 'test' }, workspacePath: root,
    conversation: [{ role: 'user', content: '请在右侧打开 a.txt' }], emit: () => {},
    extraTools: filePreviewToolDefinitions(),
    onExtraTool: (name, args) => { assert.equal(name, 'open_file'); return requestFilePreview(args, { workspacePath: root, sessionId: 'owner', renderer: { isDestroyed: () => false, send: (...args) => sent.push(args) } }); },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); assert.ok(body.tools.some(tool => tool.function.name === 'open_file'));
      const message = requests++ === 0 ? { role: 'assistant', content: null, tool_calls: [{ id: 'open-1', type: 'function', function: { name: 'open_file', arguments: '{"path":"a.txt"}' } }] } : { role: 'assistant', content: '已请求打开文件。' };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.status, 'done'); assert.equal(sent.length, 1);
});

test('Excel 单元格和 PPT 页文字可直接预览', async t => {
  const root = await fixture(t);
  const make = spawnSync('python3', ['-c', `import zipfile,sys,os
root=sys.argv[1]
with zipfile.ZipFile(os.path.join(root,'表格.xlsx'),'w') as z:
 z.writestr('xl/worksheets/sheet1.xml','<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>验收项目</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>')
with zipfile.ZipFile(os.path.join(root,'演示.pptx'),'w') as z:
 z.writestr('ppt/slides/slide1.xml','<slide><p><t>第一张幻灯片</t></p></slide>')
`, root], { encoding: 'utf8' });
  assert.equal(make.status, 0, make.stderr);
  const sheet = await readFilePreview(root, '表格.xlsx');
  assert.equal(sheet.ok, true, sheet.error); assert.match(sheet.content, /A1=验收项目\s+B1=42/);
  const slides = await readFilePreview(root, '演示.pptx');
  assert.equal(slides.ok, true, slides.error); assert.match(slides.content, /第 1 页[\s\S]*第一张幻灯片/);
});

test('当前任务引擎可发现并执行 open_file，保留所属会话', async t => {
  const { OfficialDshSession } = await import('../electron/host/dsh-runtime/full-session.mts');
  const root = await fixture(t);
  const workspacePath = await fs.realpath(root);
  const profileDir = path.join(root, 'plugins');
  await fs.mkdir(path.join(profileDir, 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(profileDir, 'package.json'), '{"name":"preview-test","private":true}');
  await fs.writeFile(path.join(root, 'test.txt'), '预览正文');
  const sent = []; let calls = 0;
  const runtime = new OfficialDshSession({ profileDir, dataDir: path.join(root, 'runtime'), workspacePath,
    sessionId: 'preview-current', plugins: [], extraTools: filePreviewToolDefinitions().map(tool => tool.function), approve: async () => true,
    onExtraTool: (name, args) => { assert.equal(name, 'open_file'); return requestFilePreview(args, { workspacePath, sessionId: 'preview-current', renderer: { isDestroyed: () => false, send: (...args) => sent.push(args) } }); },
    async *generate(request) {
      assert.ok(request.tools.some(tool => tool.name === 'open_file'));
      const block = calls++ === 0 ? { type: 'tool-call', id: 'preview-one', name: 'open_file', arguments: '{"path":"test.txt"}' } : { type: 'text', text: '已请求打开文件' };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield block.type === 'tool-call' ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } };
    },
  });
  t.after(() => runtime.close());
  await runtime.start();
  const result = await runtime.request('prompt', { text: '请直接预览 test.txt' });
  assert.equal(sent.length, 1, JSON.stringify(result.events));
  assert.equal(sent[0][1].ownerSessionId, 'preview-current');
  assert.match(JSON.stringify(result.events), /已请求打开文件/);
  await runtime.close();
});
