import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { OfficialDshSession } from '../electron/host/dsh-runtime/full-session.mts';
import { generateWithDyworker } from '../electron/host/dsh-runtime/model-adapter.mts';
import { ClientPluginHost } from '../src/pluginRuntime/clientHost.ts';
import { registerTrajectoryMessageDefinitions } from './fixtures/official-trajectory-assembly/trajectory-message-definitions.ts';
import { registerTrajectoryRequestHeaderDefinition } from './fixtures/official-trajectory-assembly/trajectory-request-header-definition.ts';
import { registerTrajectoryAssistantDefinition } from './fixtures/official-trajectory-assembly/trajectory-assistant-definition.ts';
import { registerTrajectoryToolDefinition } from './fixtures/official-trajectory-assembly/trajectory-tool-definition.ts';
import { registerTrajectoryCompactionDefinitions } from './fixtures/official-trajectory-assembly/trajectory-compaction-definition.ts';
import { registerTrajectoryConversationView } from './fixtures/official-trajectory-assembly/trajectory-snapshot-builder.ts';
const require = createRequire(import.meta.url);
const text = value => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const tool = (name, args, id = 'call-one') => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
];
async function setup(t, extra = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-dsh-full-')));
  const profileDir = path.join(root, 'plugins');
  const workspacePath = path.join(root, 'work');
  await fs.mkdir(path.join(profileDir, 'node_modules'), { recursive: true });
  await fs.mkdir(workspacePath);
  await fs.writeFile(path.join(profileDir, 'package.json'), '{"name":"isolated-profile","private":true}');
  const options = { profileDir, dataDir: path.join(root, 'dsh-owned'), workspacePath, sessionId: 'full-one',
    plugins: [], approve: async () => true, async *generate() { yield* text('真正的 DSH 回复'); }, ...extra };
  const runtime = new OfficialDshSession(options);
  t.after(async () => { await runtime.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, options, runtime };
}
const plugin = name => ({ id: name, entryUrl: pathToFileURL(require.resolve(name)).href });

test('原样官方轨迹定义装配真实任务：实际请求、工具、两轮回复与独立子任务；恢复读取不发起模型', {timeout:20000},async t=>{
  let rootCalls=0, modelCalls=0;
  const {runtime,options}=await setup(t,{async *generate(request) {
    modelCalls++;
    if(request.sessionId!=='full-one') yield*text('子任务独立的真实回复');
    else yield* rootCalls++===0 ? tool('subagent',{prompt:'产生一份独立子任务记录',description:'装配验收',run_in_background:false}) : text(rootCalls===2?'父任务第一轮回复':'父任务第二轮回复');
  }});
  await runtime.start();await runtime.request('prompt',{text:'第一轮产生真实请求和工具记录'});
  const result=await runtime.request('prompt',{text:'第二轮保留第一轮'}), family=await runtime.request('family');
  const child=Object.values(family.byId).find(item=>item.parentId===options.sessionId);assert.ok(child);
  const childSnapshot=await runtime.request('child-snapshot',{childId:child.id});
  const host=new ClientPluginHost({sessionProvider:id=>id==='full-one'?{id,runtime:'dsh'}:undefined});t.after(()=>host.dispose());
  const previous=globalThis.dyworker;globalThis.dyworker={dshOperation:async()=>({ok:true,value:family})};t.after(()=>{globalThis.dyworker=previous;});
  host.setCollections(()=>({items:[{id:'full-one',runtime:'dsh'}],current:{id:'full-one',runtime:'dsh'}}),()=>({items:[],current:null}));await host.refreshSubagents('full-one');
  const loaded=await host.load({name:'original-trajectory-definitions',inject:['uiConversation'],apply(ctx) {
    registerTrajectoryMessageDefinitions(ctx);registerTrajectoryRequestHeaderDefinition(ctx);registerTrajectoryAssistantDefinition(ctx);
    registerTrajectoryToolDefinition(ctx);registerTrajectoryCompactionDefinitions(ctx);registerTrajectoryConversationView(ctx);
  }},'original-trajectory-definitions');assert.equal(loaded.ok,true,loaded.error);
  host.ingestSessionEvents(result.events,'full-one');host.activateSessionView('full-one','trajectory');
  const rootView=host.sessionViewSnapshots('full-one').get('trajectory');
  assert.ok(rootView.requests.length>=3);assert.match(JSON.stringify(rootView),/父任务第一轮回复/);assert.match(JSON.stringify(rootView),/父任务第二轮回复/);
  assert.match(JSON.stringify(rootView),/subagent/);assert.ok(rootView.requests.some(item=>item.prompt?.system && item.prompt?.config));
  host.ingestSessionEvents(childSnapshot.events,child.id);host.activateSessionView(child.id,'trajectory');
  const childView=host.sessionViewSnapshots(child.id).get('trajectory');assert.match(JSON.stringify(childView),/子任务独立的真实回复/);
  assert.equal(host.sessionViewSnapshots('full-one').get('trajectory'),rootView);assert.notEqual(childView,rootView);
  const count=modelCalls;await runtime.close();const cold=new OfficialDshSession(options);
  try {await cold.start();const snapshot=await cold.request('snapshot');host.ingestSessionEvents(snapshot.events,'full-one');
    assert.match(JSON.stringify(host.sessionViewSnapshots('full-one').get('trajectory')),/父任务第二轮回复/);assert.equal(modelCalls,count);
  }finally{await cold.close();}
  await host.unload('original-trajectory-definitions');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(host.sessionViewSnapshots('full-one').get('trajectory'),undefined);assert.equal(host.sessionViewSnapshots(child.id).get('trajectory'),undefined);
});

test('官方进程启动后 IPC 中断会拒绝在途请求并停止，关闭时不向应用抛出 EPIPE', async t => {
  const { runtime } = await setup(t);
  await runtime.start();
  const pending = runtime.request('snapshot');
  const rejected = assert.rejects(pending, /模拟通讯已关闭/);
  runtime.child.emit('error', Object.assign(new Error('模拟通讯已关闭'), { code: 'EPIPE' }));
  await rejected; await runtime.stop();
  assert.equal(runtime.child.connected, false);
  assert.equal(runtime.pending.size, 0);
  await runtime.close();
});

test('官方任务动态增删工具：后续模型请求使用新的实际声明，移除工具不再提供',async t=>{
  const {runtime,root,options}=await setup(t);
  const dir=path.join(options.profileDir,'node_modules','dynamic-tools');await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'dynamic-tools',version:'1.0.0',type:'module',main:'index.mjs'}));
  const file=path.join(dir,'index.mjs');
  await fs.writeFile(file,`export const name='dynamic-tools'; export const inject=['tools'];
    export function apply(ctx) {
      let remove;
      remove=ctx.tools.register({name:'switch_tools',description:'更换实际工具',parameters:{type:'object',properties:{}},
        execute:()=>{remove();ctx.tools.register({name:'later_tool',description:'后续实际工具',parameters:{type:'object',properties:{}},execute:()=>({text:'动态工具的真实结果'}),
          output:{schema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},render:(_,value)=>[{type:'text',text:value.text}]}});return {text:'声明已变更'};},
        output:{schema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},render:(_,value)=>[{type:'text',text:value.text}]}});
    }`);
  options.plugins=[{id:'dynamic-tools',entryUrl:pathToFileURL(file).href}];let calls=0;const requests=[];
  options.generate=async function*(request){requests.push(request);
    if(calls++===0){assert.ok(request.tools.some(tool=>tool.name==='switch_tools'));yield*tool('switch_tools',{});}
    else if(calls===2){assert.ok(!request.tools.some(tool=>tool.name==='switch_tools'));assert.ok(request.tools.some(tool=>tool.name==='later_tool'));yield*tool('later_tool',{},'later-call');}
    else {assert.match(JSON.stringify(request.messages),/动态工具的真实结果/);yield*text('动态变更已实际完成');}
  };
  await runtime.start();const result=await runtime.request('prompt',{text:'检查动态工具声明'});assert.equal(calls,3);
  assert.ok(result.events.some(event=>event.type==='developer/message'),'动态声明变化进入官方记录');
});

test('官方完整任务驱动：真实回合、模型块、注入、持久历史和重新启动恢复', async t => {
  const emitted = [];
  const { options, runtime } = await setup(t, { onEvent: value => emitted.push(value) });
  await runtime.start();
  await runtime.request('inject', { text: '需要保留的上下文' });
  const result = await runtime.request('prompt', { text: '运行官方任务' });
  assert.ok(result.events.some(e => e.type === 'turn/start'));
  assert.ok(result.events.some(e => e.type === 'turn/end'));
  assert.match(JSON.stringify(result.events), /需要保留的上下文/);
  assert.match(JSON.stringify(result.events), /真正的 DSH 回复/);
  assert.ok(emitted.some(e => e.event.type === 'assistant/message'));
  await runtime.close();
  const resumed = new OfficialDshSession(options);
  try {
    await resumed.start();
    const snapshot = await resumed.request('snapshot');
    assert.equal(snapshot.header.id, options.sessionId);
    assert.deepEqual(snapshot.events.slice(0, result.events.length), result.events);
    assert.equal(snapshot.events.at(-1).type, 'session/end-seed', '官方恢复会追加种子结束记录');
    await resumed.request('prompt', { text: '第二次运行' });
    assert.match(JSON.stringify((await resumed.request('snapshot')).events), /第二次运行/);
  } finally { await resumed.close(); }
});

test('原样办公插件在官方任务中写文件，上下文插件统计和详情取自实际事件', async t => {
  let calls = 0;
  const requests = [];
  const { runtime, options } = await setup(t, { plugins: [plugin('dsh-office-tools'), plugin('dsh-context')],
    async *generate(request) { requests.push(request); yield* calls++ === 0
      ? tool('word_create', { path: 'official.docx', paragraphs: ['正式 DSH 环境'] }) : text('完成'); } });
  const ready = await runtime.start();
  assert.ok(ready.schemas.some(schema => schema.name === 'word_create'));
  const result = await runtime.request('prompt', { text: '创建 Word 文件' });
  assert.equal((await fs.readFile(path.join(options.workspacePath, 'official.docx'))).subarray(0, 2).toString(), 'PK');
  assert.ok(result.events.some(e => e.type === 'tool/result'));
  assert.ok(requests[1].messages.some(m => m.role === 'tool'));
  assert.ok(result.projections.values.contextTimeline);
  const route = ready.routes.find(route => /detail/.test(route));
  assert.ok(route, JSON.stringify(ready));
  const detail = await runtime.request('route', { path: route.replace(/^\S+ /, ''), method: 'POST',
    body: JSON.stringify({ sessionId: options.sessionId }) });
  assert.equal(detail.status, 200, detail.body);
  assert.match(detail.body, /word_create|context|tool/);
});

test('父进程拒绝不能被插件放行，两个会话取消隔离且停止后不继续执行', async t => {
  let calls = 0;
  const { options, runtime } = await setup(t, { plugins: [plugin('dsh-office-tools')], approve: async () => false,
    async *generate() { yield* calls++ === 0 ? tool('word_create', { path: 'denied.docx', paragraphs: ['禁止'] }) : text('已拒绝'); } });
  await runtime.start();
  const denied = await runtime.request('prompt', { text: '尝试写入' });
  await assert.rejects(fs.access(path.join(options.workspacePath, 'denied.docx')), { code: 'ENOENT' });
  assert.match(JSON.stringify(denied.events), /DYWorker 未允许此操作/);
  const other = new OfficialDshSession({ ...options, dataDir: options.dataDir + '-other', sessionId: 'full-two',
    async *generate() { yield* text('另一个会话继续工作'); } });
  try {
    await other.start();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    options.generate = async function* ({ signal }) {
      started();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    };
    const controller = new AbortController();
    const pending = runtime.request('prompt', { text: '需要停止的真实运行' }, { signal: controller.signal });
    const rejected = assert.rejects(pending, /停止|退出|Abort/);
    await ready; controller.abort(new Error('任务已停止'));
    await rejected;
    const result = await other.request('prompt', { text: '另一会话' });
    assert.match(JSON.stringify(result.events), /另一个会话继续工作/);
  } finally { await other.close(); }
});

test('官方子任务运行：子会话继承所属工作目录，结果和事件返回父会话', async t => {
  let rootCalls = 0;
  const seen = [];
  const { runtime, options } = await setup(t, { plugins: [plugin('dsh-context')], async *generate(request) {
    seen.push(request.sessionId);
    if (request.sessionId !== 'full-one') yield* text('子任务的真实结果');
    else yield* rootCalls++ === 0 ? tool('subagent', { prompt: '返回子任务结果', description: '检查子任务', run_in_background: false }) : text('父任务完成');
  } });
  await runtime.start();
  const result = await runtime.request('prompt', { text: '执行一个子任务' });
  assert.ok(seen.some(id => id !== options.sessionId), JSON.stringify(result.events));
  assert.match(JSON.stringify(result.events), /子任务的真实结果/);
  assert.ok(result.events.some(e => e.type.startsWith('subagent/')));
  const family = await runtime.request('family');
  const child = Object.values(family.byId).find(row => row.parentId === options.sessionId);
  assert.ok(child, '目录包含真实生成的子任务');
  assert.equal(child.rootSessionId, options.sessionId);
  assert.equal(child.origin, 'subagent');
  assert.match(child.displayTitle, /返回子任务结果|检查子任务/);
  assert.ok(child.projectionValues.contextTimeline);
  assert.ok(child.projectionValues.subagent);
  assert.equal(child.events, undefined, '列表不暴露完整记录');
  const viewed = await runtime.request('child-snapshot', { childId: child.id });
  assert.equal(child.updatedAt, viewed.events.at(-1).time);
  assert.equal(viewed.header.parentSession, options.sessionId);
  assert.match(JSON.stringify(viewed.events), /子任务的真实结果/);
  for (const childId of ['', options.sessionId, 'foreign-child'])
    await assert.rejects(runtime.request('child-snapshot', { childId }), /不属于/);
  const calls = seen.length;
  await runtime.close();
  const reopened = new OfficialDshSession(options);
  try {
    await reopened.start();
    const cold = await reopened.request('family');
    assert.ok(cold.byId[child.id].projectionValues.contextTimeline);
    assert.equal(cold.byId[child.id].running, false);
    const history = await reopened.request('child-snapshot', { childId: child.id });
    assert.deepEqual(history.events, viewed.events);
    assert.equal(seen.length, calls, '冷子任务只读不能恢复模型任务');
  } finally { await reopened.close(); }
});

test('官方压缩实际调用摘要模型并写入可重放的压缩记录', async t => {
  let summaries = 0;
  const { runtime } = await setup(t, { plugins: [plugin('dsh-context')], async *generate(request) {
    if (request.purpose === 'compaction') { summaries++; yield* text('保留要点的简短摘要'); }
    else yield* text('实际产生的长历史。'.repeat(700));
  } });
  await runtime.start();
  await runtime.request('prompt', { text: '第一段要保留的原始内容。'.repeat(700) });
  await runtime.request('prompt', { text: '第二段独立内容。'.repeat(700) });
  const compacted = await runtime.request('compact');
  assert.ok(compacted, '应压缩存在的较长历史');
  assert.ok(summaries > 0);
  const snapshot = await runtime.request('snapshot');
  assert.ok(snapshot.events.some(e => e.type.startsWith('compaction/')), JSON.stringify(snapshot.events.map(e => e.type)));
  assert.match(JSON.stringify(snapshot.events), /保留要点的简短摘要/);
});

test('DSH 模型桥沿用现有提供方，保留工具身份和真实用量，凭据只用于父进程请求', async () => {
  const sent = [];
  const settings = { endpoint: 'https://model.example.test/v1/chat/completions', model: 'selected', apiKey: 'parent-only-secret' };
  const request = { model: 'selected', messages: [
    { role: 'system', content: [{ type: 'text', text: '实际官方提示' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'original-id', name: 'word_read', arguments: '{"path":"doc.docx"}' }] },
    { role: 'tool', source: { kind: 'tool', callId: 'original-id' }, content: [{ type: 'text', text: '实际工具结果' }] },
  ], tools: [{ name: 'word_read', description: '读取', parameters: { type: 'object' } }] };
  const chunks = [];
  for await (const chunk of generateWithDyworker(settings, request, { fetchImpl: async (url, init) => {
    sent.push({ url, ...init, payload: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '真实回复' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 37, completion_tokens: 9 } }), { headers: { 'content-type': 'application/json' } });
  } })) chunks.push(chunk);
  assert.equal(sent[0].headers.Authorization, 'Bearer parent-only-secret');
  assert.equal(sent[0].payload.messages[1].tool_calls[0].id, 'original-id');
  assert.equal(sent[0].payload.messages[2].tool_call_id, 'original-id');
  assert.equal(sent[0].payload.tools[0].function.name, 'word_read');
  assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage, { inputTokens: 37, outputTokens: 9 });
  assert.doesNotMatch(JSON.stringify(chunks), /parent-only-secret/);
});

test('DSH 模型返回的图片保存为真实官方引用，文字与图片顺序保持，拒绝远程地址及损坏图片', async t => {
  const { runtime } = await setup(t); await runtime.start();
  const settings = { endpoint: 'https://model.example.test/v1/chat/completions', model: 'selected', apiKey: 'secret' };
  const request = { model: 'selected', messages: [] };
  const chunks = [];
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#186a32' } }).png().toBuffer();
  for await (const chunk of generateWithDyworker(settings, request, { fetchImpl: async () => {
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: [
      { type: 'text', text: '前文文本' },
      { type: 'text', text: '连续第二段' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png.toString('base64') } },
      { type: 'text', text: '后文文本' }, { type: 'text', text: '连续末段' }
    ] }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { headers: { 'content-type': 'application/json' } });
  }, attachments: runtime.persistenceContext.attachments })) chunks.push(chunk);
  const blocks = chunks.filter(c => c.type === 'block-start').map(c => c.blockType);
  assert.deepEqual(blocks, ['text', 'image', 'text']);
  const texts = chunks.filter(c => c.type === 'text-delta').map(c => c.text);
  assert.deepEqual(texts, ['前文文本', '连续第二段', '后文文本', '连续末段']);
  const images = chunks.filter(c => c.type === 'block-end' && c.block.type === 'image');
  assert.equal(images.length, 1);
  assert.equal(images[0].block.attachment.mediaType, 'image/png');
  const saved = await runtime.persistenceContext.attachments.readImage(images[0].block.attachment);
  assert.deepEqual(Buffer.from(saved.data), png);
  const { BlockAssembler, expandAssistantStream } = await import('@deepseek-ai/dsh-llm');
  const assembled = new BlockAssembler(); for (const chunk of chunks) assembled.push(chunk);
  assert.deepEqual(assembled.blocks().map(block => block.type === 'text' ? block.text : block.type), ['前文文本连续第二段', 'image', '后文文本连续末段']);
  assert.equal(expandAssistantStream(chunks.map(chunk => ({ type: 'chunk', time: 1, chunk }))).length, chunks.length);
  for (const part of [
    { type: 'image_url', image_url: { url: 'https://example.test/private.png' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } },
    { type: 'image', mediaType: 'image/png', data: 'not base64!' },
    { type: 'audio', data: 'unhandled' },
  ]) await assert.rejects(async () => { for await (const _chunk of generateWithDyworker(settings, request, {
    attachments: runtime.persistenceContext.attachments,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: [part] }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }),
  })) {} }, /图片|image|内容/);
});

test('模型流尚未结束时已交付首段文字，结束后正文及真实用量完整保留', { timeout: 6000 }, async () => {
  const settings = { endpoint: 'https://model.example.test/v1/chat/completions', model: 'selected', apiKey: 'secret' };
  let finish, finished = false;
  const encode = value => new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n');
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(encode({ choices: [{ delta: { content: '首段实时文字' } }] }));
    finish = () => { finished = true; controller.enqueue(encode({ choices: [{ delta: { content: '后段文字' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 51, completion_tokens: 12 } })); controller.close(); };
  } });
  const iterator = generateWithDyworker(settings, { model: 'selected', messages: [] }, {
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  });
  assert.equal((await iterator.next()).value.type, 'block-start');
  assert.deepEqual((await iterator.next()).value, { type: 'text-delta', index: 0, text: '首段实时文字' });
  assert.equal(finished, false);
  finish(); const remainder = []; for await (const chunk of iterator) remainder.push(chunk);
  assert.equal(remainder.find(chunk => chunk.type === 'block-end').block.text, '首段实时文字后段文字');
  assert.deepEqual(remainder.find(chunk => chunk.type === 'usage').usage, { inputTokens: 51, outputTokens: 12 });
});

test('官方设置使用真实配置树保存，拒绝过期版本和未声明字段，重启后保留修改', async t => {
  const contextPlugin = plugin('dsh-context');
  const { options, runtime } = await setup(t, { plugins: [{ ...contextPlugin, entryUrl: contextPlugin.entryUrl + '?dyworker-runtime=41' }] });
  await runtime.start();
  const forms = await runtime.request('settings-describe');
  const form = forms.find(form => form.ns === 'dsh-context');
  assert.ok(form, JSON.stringify(forms));
  const next = await runtime.request('settings-update', { namespace: form.ns, patch: { defaultGranularity: 'turn' }, revision: form.revision });
  const changed = next.find(form => form.ns === 'dsh-context');
  assert.equal(changed.value.defaultGranularity, 'turn');
  assert.ok(changed.revision > form.revision);
  await assert.rejects(runtime.request('settings-update', { namespace: form.ns, patch: { defaultGranularity: 'step' }, revision: form.revision }), /changed since/);
  // loose 字段由上游解析，宿主不加自己的限制；未声明字段不允许持久修改。
  await assert.rejects(runtime.request('settings-update', { namespace: form.ns, patch: { undeclaredField: true }, revision: changed.revision }), /not volatile/);
  assert.equal((await runtime.request('settings-describe')).find(form => form.ns === 'dsh-context').value.defaultGranularity, 'turn');
  await runtime.close();
  const patchFile = path.join(options.dataDir, 'profile', 'cordis.patch.yml');
  const stablePatch = await fs.readFile(patchFile, 'utf8');
  assert.doesNotMatch(stablePatch, /dyworker-runtime/);
  // 兼容此前已保存的缓存代次名称，不改设置值，也不解除另一插件的 name 限制。
  await fs.writeFile(patchFile, stablePatch.replace(contextPlugin.entryUrl, contextPlugin.entryUrl + '?dyworker-runtime=41'));
  options.plugins = [{ ...contextPlugin, entryUrl: contextPlugin.entryUrl + '?dyworker-runtime=82' }];
  const resumed = new OfficialDshSession(options);
  try {
    await resumed.start();
    assert.equal((await resumed.request('settings-describe')).find(form => form.ns === 'dsh-context').value.defaultGranularity, 'turn');
    assert.doesNotMatch(await fs.readFile(patchFile, 'utf8'), /dyworker-runtime/);
  }
  finally { await resumed.close(); }
});

test('取消页面读取不停止当前任务；启动失败前也能安全关闭', async t => {
  let release; let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { runtime } = await setup(t, { async *generate() { announce(); await gate; yield* text('任务正常完成'); } });
  await runtime.start();
  const work = runtime.request('prompt', { text: '继续工作' });
  await started;
  for (const action of ['snapshot','session-image']) {
    const controller = new AbortController();
    const read = runtime.request(action, {attachmentId:'cancelled-image-read'}, { signal: controller.signal });
    const rejected = assert.rejects(read, /页面已切换/);
    controller.abort(new Error('页面已切换')); await rejected;
    assert.equal(runtime.child.connected, true);
  }
  release();
  assert.match(JSON.stringify((await work).events), /任务正常完成/);
  const invalid = new OfficialDshSession({ ...runtime.options, dataDir: runtime.options.dataDir + '-bad', workspacePath: '/nonexistent-dyw-dsh-workspace' });
  await assert.rejects(invalid.start(), /ENOENT/);
  await invalid.close();
});


test('官方工作流实际启动两个子任务，合并结果并记录真实完成', async t => {
  let rootCalls = 0; const children = new Set(); const observed = [];
  const { runtime } = await setup(t, { onEvent: value => observed.push(value), async *generate(request) {
    if (request.sessionId !== 'full-one') { children.add(request.sessionId); yield* text('工作流子任务结果'); }
    else yield* rootCalls++ === 0 ? tool('workflow', { meta: { name: 'two-children', description: '核对两个子任务' },
      script: "phase('核对'); const results = await parallel([() => agent('核对第一项'), () => agent('核对第二项')]); return { results };" }) : text('工作流已完成');
  } });
  const ready = await runtime.start(); assert.ok(ready.schemas.some(schema => schema.name === 'workflow'));
  const result = await runtime.request('prompt', { text: '运行实际工作流' });
  const message = result.events.find(event => event.type === 'tool/result' && event.data.message.source.callId === 'call-one').data.message;
  assert.equal(message.isError, false, JSON.stringify(message));
  assert.equal(children.size, 2, JSON.stringify(message));
  assert.match(JSON.stringify(message.content), /工作流子任务结果/);
  assert.ok(observed.some(row => row.sessionId !== 'full-one'));
});


test('官方后台工作流能独立持续运行，并在完成后释放生命周期', async t => {
  let rootCalls = 0; let approvals = 0; const observed = [];
  const { runtime } = await setup(t, { onEvent: value => observed.push(value), approve: async ({ name }) => { if (name === 'workflow') approvals++; return name !== 'run_code'; }, async *generate(request) {
    if (request.sessionId !== 'full-one') {
      await new Promise(resolve => setTimeout(resolve, 180)); yield* text('后台子任务真实结果');
    } else yield* rootCalls++ === 0 ? tool('workflow', { run_in_background: true, meta: { name: 'background-check', description: '验收后台收尾' },
      script: "return await agent('处理后台事项');" }) : text('已安排后台工作');
  } });
  await runtime.start(); const result = await runtime.request('prompt', { text: '运行后台工作流' });
  assert.equal(result.jobs.length, 1, JSON.stringify(result.events)); assert.equal(result.jobs[0].status, 'running');
  assert.equal(approvals, 1, '已批准的工作流不重复申请执行器审批');

  // 等待后台工作完成
  await runtime.request('wait-jobs');

  const finalSnapshot = await runtime.request('snapshot');
  assert.equal(finalSnapshot.jobs.length, 1);
  assert.equal(finalSnapshot.jobs[0].status, 'completed');
  assert.match(JSON.stringify(observed), /后台子任务真实结果/);
  assert.equal(finalSnapshot.status, 'idle');
});

test('关闭写入句柄后的迟到通知只接受实际保存的原记录，拒绝篡改、重复和其他根归属',async t=>{
  const {Context}=await import('@deepseek-ai/cordis');const {default:Persistence}=await import('@deepseek-ai/dsh-session-persistence-jsonl');const {SESSION_FORMAT_VERSION}=await import('@deepseek-ai/dsh-session');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-dsh-retired-event-')));const ctx=new Context();
  await ctx.plugin(Persistence,{root:path.join(root,'sessions'),compression:'none'});
  t.after(async()=>{await ctx.fiber.dispose();await fs.rm(root,{recursive:true,force:true});});
  const header={version:SESSION_FORMAT_VERSION,id:'retired-child',parentSession:'retired-root',createdAt:1000,cwd:root,isSeeded:false};
  const handle=await ctx.sessionPersistence.create(header);
  const start={type:'turn/start',seq:0,time:1001,data:{turn:1}};const end={type:'turn/end',seq:1,time:1002,data:{turn:1,reason:{kind:'completed'}}};
  const runtime=new OfficialDshSession({sessionId:'retired-root',workspacePath:root});runtime.persistenceContext=ctx;const responses=[];runtime.child={connected:true,send:response=>responses.push(response)};
  runtime.handles.set('owned-write',handle);runtime.sessionHeaders.set(handle.id,header);const forwarded=[];runtime.options.onEvent=event=>forwarded.push(event);
  await runtime.receive({type:'session-event',sessionId:handle.id,event:start},{});
  await ctx.sessionPersistence.flush();await handle.append([end]);await handle.flush();
  await runtime.receive({type:'persistence',id:'close-own',action:'handle-close',payload:{key:'owned-write'}},{workspacePath:root,sessionId:'retired-root'});
  assert.equal(responses.at(-1)?.error,undefined,JSON.stringify(responses));assert.equal(runtime.handles.size,0);assert.equal(runtime.retiredEvents.get(handle.id).size,1);
  await assert.rejects(runtime.receive({type:'session-event',sessionId:handle.id,event:{...end,data:{turn:1,reason:{kind:'aborted'}}}},{}),/不属于/);
  runtime.sessionHeaders.set(handle.id,{...header,parentSession:'foreign-root'});
  await assert.rejects(runtime.receive({type:'session-event',sessionId:handle.id,event:end},{}),/不属于/);runtime.sessionHeaders.set(handle.id,header);
  await runtime.receive({type:'session-event',sessionId:handle.id,event:JSON.parse(JSON.stringify(end))},{});
  assert.deepEqual(forwarded.map(item=>item.event),[start,end]);assert.equal(runtime.retiredEvents.size,0);
  await assert.rejects(runtime.receive({type:'session-event',sessionId:handle.id,event:end},{}),/不属于/);
  await assert.rejects(runtime.receive({type:'session-event',sessionId:'never-owned',event:end},{}),/不属于/);
});

test('历史图片通过真实进程读取：用户、模型与子任务图片分别归属，重启后只读且不启动模型', {timeout:60000}, async t=>{
  let rootCalls=0,totalCalls=0,childRef,assistantRef;
  const {runtime,options}=await setup(t,{async *generate(request){totalCalls++;
    if(request.sessionId!=='full-one') {
      yield {type:'block-start',index:0,blockType:'image'};
      yield {type:'block-end',index:0,block:{type:'image',attachment:childRef}};
      yield* text('子任务图片回复').map(chunk=>('index' in chunk?{...chunk,index:1}:chunk));
    } else if(rootCalls++===0) yield* tool('subagent',{prompt:'生成独立图片回复',description:'检查子任务图片',run_in_background:false});
    else {
      yield {type:'block-start',index:0,blockType:'image'};
      yield {type:'block-end',index:0,block:{type:'image',attachment:assistantRef}};
      yield* text('父任务图片回复').map(chunk=>('index' in chunk?{...chunk,index:1}:chunk));
    }
  }});
  await runtime.start();const sharp=(await import('sharp')).default;
  const store=runtime.persistenceContext.attachments;
  const make=async background=>store.saveImage({mediaType:'image/png',data:await sharp({create:{width:3,height:2,channels:3,background}}).png().toBuffer()});
  const userRef=await make('#115533');assistantRef=await make('#773322');childRef=await make('#3366aa');const orphan=await make('#aaaa11');
  const result=await runtime.request('prompt',{content:[{type:'text',text:'带图片创建子任务'},{type:'image',attachment:userRef}]});
  const family=await runtime.request('family'),child=Object.values(family.byId).find(row=>row.parentId===options.sessionId);assert.ok(child,JSON.stringify(result.events));
  const read=async(active,targetSessionId,ref)=>{
    const actual=await active.request('session-image',{targetSessionId,attachmentId:ref.attachmentId,ref:{attachmentId:orphan.attachmentId},filePath:'/untrusted/path'});
    assert.deepEqual(actual.attachment,ref);
    const expected=await store.readImage(ref);assert.deepEqual(Buffer.from(actual.data,'base64'),Buffer.from(expected.data));
    const image=await sharp(Buffer.from(actual.data,'base64')).metadata();assert.equal(image.width,3);assert.equal(image.height,2);
  };
  await read(runtime,options.sessionId,userRef);await read(runtime,options.sessionId,assistantRef);await read(runtime,child.id,childRef);
  for(const [target,ref] of [[options.sessionId,childRef],[child.id,assistantRef],[options.sessionId,orphan]])
    await assert.rejects(runtime.request('session-image',{targetSessionId:target,attachmentId:ref.attachmentId}),/未出现在/);
  await assert.rejects(runtime.request('session-image',{targetSessionId:'foreign-child',attachmentId:userRef.attachmentId}),/不属于/);
  await assert.rejects(runtime.request('session-image',{attachmentId:'../private-file'}),/未出现在/);
  const before=totalCalls;await runtime.close();
  const cold=new OfficialDshSession({...options,generate:async function*(){throw new Error('只读图片不应调用模型');}});
  try {await cold.start();
    // 原 store 的服务已关闭，重新打开进程的宿主存储提供字节对照。
    for(const [target,ref] of [[options.sessionId,userRef],[options.sessionId,assistantRef],[child.id,childRef]]){
      const actual=await cold.request('session-image',{targetSessionId:target,attachmentId:ref.attachmentId});
      assert.deepEqual(actual.attachment,ref);const stored=await cold.persistenceContext.attachments.readImage(ref);assert.deepEqual(Buffer.from(actual.data,'base64'),Buffer.from(stored.data));
    }
    assert.equal(totalCalls,before);
    const cancel=new AbortController();cancel.abort(new Error('取消历史图片读取'));
    assert.throws(()=>cold.request('session-image',{attachmentId:userRef.attachmentId},{signal:cancel.signal}),/取消历史图片/);
    assert.equal(cold.child.connected,true);await cold.request('snapshot');
  }finally{await cold.close();}
});

test('关闭期间新增实际记录纳入最终日志；晚到通知等待读取完成，全部原记录只能转发一次',async t=>{
  const {Context}=await import('@deepseek-ai/cordis');const {default:Persistence}=await import('@deepseek-ai/dsh-session-persistence-jsonl');const {SESSION_FORMAT_VERSION}=await import('@deepseek-ai/dsh-session');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-dsh-final-close-')));const ctx=new Context();
  await ctx.plugin(Persistence,{root:path.join(root,'sessions'),compression:'none'});
  t.after(async()=>{await ctx.fiber.dispose();await fs.rm(root,{recursive:true,force:true});});
  const header={version:SESSION_FORMAT_VERSION,id:'final-child',parentSession:'final-root',createdAt:1000,cwd:root,isSeeded:false};
  const handle=await ctx.sessionPersistence.create(header);
  const start={type:'turn/start',seq:0,time:1001,data:{turn:1}};
  const end={type:'turn/end',seq:1,time:1002,data:{turn:1,reason:{kind:'completed'}}};
  const next={type:'turn/start',seq:2,time:1003,data:{turn:2}};
  const close=handle.close.bind(handle);let closing=false;
  handle.close=async()=>{if(!closing){closing=true;await handle.append([next]);}await close();};
  let readStarted,finish;const opened=new Promise(resolve=>{readStarted=resolve;});const readGate=new Promise(resolve=>{finish=resolve;});
  const open=ctx.sessionPersistence.open.bind(ctx.sessionPersistence);
  ctx.sessionPersistence.open=async(...args)=>{const reader=await open(...args);const read=reader.read.bind(reader);reader.read=async(...values)=>{readStarted();await readGate;return read(...values);};return reader;};
  const runtime=new OfficialDshSession({sessionId:'final-root',workspacePath:root});runtime.persistenceContext=ctx;const responses=[];
  runtime.child={connected:true,send:value=>responses.push(value)};runtime.handles.set('writer',handle);runtime.sessionHeaders.set(handle.id,header);const forwarded=[];runtime.options.onEvent=event=>forwarded.push(event.event);
  await runtime.receive({type:'session-event',sessionId:handle.id,event:start},{});
  await ctx.sessionPersistence.flush();await handle.append([end]);
  const closed=runtime.receive({type:'persistence',id:'close',action:'handle-close',payload:{key:'writer'}},{workspacePath:root,sessionId:'final-root'});
  await Promise.race([opened,closed.then(()=>{throw new Error(JSON.stringify(responses));})]);assert.equal(runtime.handles.size,0);assert.ok(runtime.retiringSessions.has(handle.id));
  let accepted=false;const late=runtime.receive({type:'session-event',sessionId:handle.id,event:next},{}).then(()=>accepted=true);
  await Promise.resolve();assert.equal(accepted,false,'日志读取尚未完成，通知不能先放行');
  finish();await closed;await late;assert.equal(responses.at(-1).error,undefined);
  await runtime.receive({type:'session-event',sessionId:handle.id,event:end},{});
  assert.deepEqual(forwarded,[start,next,end]);assert.equal(runtime.retiredEvents.size,0);
  await assert.rejects(runtime.receive({type:'session-event',sessionId:handle.id,event:{...next,data:{turn:999}}},{}),/不属于/);
  await assert.rejects(runtime.receive({type:'session-event',sessionId:handle.id,event:next},{}),/不属于/);
});
