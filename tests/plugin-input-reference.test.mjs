import test from 'node:test';
import assert from 'node:assert/strict';
import { UNDO_COMMAND, REDO_COMMAND, $getRoot, SELECT_ALL_COMMAND, CONTROLLED_TEXT_INSERTION_COMMAND } from 'lexical';
import { ClientPluginHost } from '../src/pluginRuntime/clientHost.ts';
import { validateDraftSnapshot } from '../src/pluginRuntime/dshDraftEditor.ts';

function bench(t) {
  const host = new ClientPluginHost({sessionProvider: id => ['a','b'].includes(id) ? {id, runtime:'dsh'} : undefined});
  t.after(() => host.dispose()); return host;
}
async function refs(host, serialize = async ref => `<actual>${ref}</actual>`, id = 'reference-owner') {
  const source = {name:'actual-refs',trigger:'@', candidates:async () => [{name:'report'}],
    onPick: () => ({insert:{source:'actual-refs',ref:'opaque-one',label:'真实显示名称',clipboardText:'@report-with-long-name',appearance:'file'}}),
    codec:{clipboardText:ref=>ref,serialize}};
  const result = await host.load({name:id,inject:['inputTriggers'],apply(ctx){ctx.effect(()=>ctx.inputTriggers.registerSource(source));}},id);
  assert.equal(result.ok,true,result.error); return source;
}
async function pick(host, editor, start = 0) {
  const p = editor.projection; const caret = p.detectText.length;
  const items = await host.inputCandidates(editor.sessionId,'r',start,p.clipboardText,new AbortController().signal,'@',caret);
  host.pickInputCandidate(editor.sessionId,items[0],{start,end:caret,draftRev:host.setInputDraft(editor.sessionId,p.clipboardText)});
}
const settled = () => new Promise(resolve=>setImmediate(resolve));

test('命令失败后在高亮边界输入并全选改写，样式不会循环拆分合并或破坏文字', async t => {
  const host = bench(t);
  const claim = {name:'check-attachments', token:'/check-attachments ', submit:async () => ({kind:'error',text:'验收拒绝'})};
  assert.equal((await host.load({name:'claim-edit',inject:['inputTriggers'],apply(ctx){
    ctx.effect(() => ctx.inputTriggers.registerSource({name:'claim-edit',trigger:'/',
      candidates:async()=>[{name:claim.name}],onPick:()=>({claim}),matchEnter:async()=>({claim})}));
  }},'claim-edit')).ok,true);
  const editor = host.mountInputEditor('a'); editor.setPlain('/check-attachments fail');
  const input = host.sessionInput(host.ctx.sessions.scope('a'));
  input.submit('queue','click');
  for (let attempt = 0; attempt < 20 && input.notices.getSnapshot()?.text !== '验收拒绝'; attempt++) await settled();
  assert.equal(input.notices.getSnapshot()?.text,'验收拒绝');
  await settled();
  editor.editor.update(() => $getRoot().getFirstChild().getFirstChild().select(claim.token.length,claim.token.length),{discrete:true});
  editor.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND,'xyz'); await settled();
  assert.equal(editor.projection.clipboardText,'/check-attachments xyzfail');
  editor.editor.dispatchCommand(SELECT_ALL_COMMAND,undefined);
  editor.runtime.paste('/check-attachments wait'); await settled();
  assert.equal(editor.projection.clipboardText,'/check-attachments wait');
  const nodes = editor.editor.getEditorState().toJSON().root.children[0].children;
  assert.equal(nodes[0].text,claim.token);
  assert.equal(nodes[1].text,'wait'); assert.equal(nodes[1].style,'');
  assert.equal(input.state.getSnapshot().phase,'claimed');
});

test('官方节点真实插入，检测视图保持原子身份，同一引用每次分别转换，两会话不串内容',async t=>{
  const host=bench(t);const calls=[];await refs(host,async ref=>{calls.push(ref);return '真正转换后的内容';});
  const a=host.mountInputEditor('a'); const b=host.mountInputEditor('b');
  a.setPlain('前文 @r');await pick(host,a,3);
  assert.equal(a.projection.clipboardText,'前文 @report-with-long-name ');assert.equal(a.projection.detectText,'前文 \uFFFC ');
  const firstId=a.projection.occurrences[0].occurrenceId;
  a.adoptProjection(a.projection.clipboardText+'@r');await pick(host,a,a.projection.detectText.lastIndexOf('@'));
  assert.equal(a.projection.occurrences.length,2);assert.notEqual(a.projection.occurrences[1].occurrenceId,firstId);
  const encoded=await host.serializeInputDraft('a');assert.equal(encoded.text,'前文 真正转换后的内容 真正转换后的内容 ');
  assert.deepEqual(calls,['opaque-one','opaque-one']);assert.equal(encoded.references.length,2);assert.equal(b.projection.clipboardText,'');
  b.setPlain('@report-with-long-name');const plain=await host.serializeInputDraft('b');
  assert.equal(plain.text,'@report-with-long-name');assert.equal(plain.references.length,0);assert.equal(calls.length,2,'复制出的名字不能反向变成引用');
});

test('官方撤销恢复节点身份，修改引用以外的正文保留节点，部分改写只将被改的引用变成文字',async t=>{
  const host=bench(t);await refs(host);const a=host.mountInputEditor('a');a.setPlain('保留 @r');a.runtime.clearHistory();
  // 无 DOM 的运行环境显式建立实际选择，等同于窗口首次进入编辑器。
  a.editor.update(()=>$getRoot().selectEnd(),{discrete:true});
  await pick(host,a,3);await settled();const id=a.projection.occurrences[0].occurrenceId;
  a.editor.dispatchCommand(UNDO_COMMAND,undefined);await settled();assert.equal(a.projection.clipboardText,'保留 @r');assert.equal(a.projection.occurrences.length,0);
  a.editor.dispatchCommand(REDO_COMMAND,undefined);await settled();assert.equal(a.projection.occurrences[0].occurrenceId,id);
  a.adoptProjection('新增 '+a.projection.clipboardText);assert.equal(a.projection.occurrences[0].ref,'opaque-one');assert.equal(a.projection.occurrences[0].offset,6);
  a.adoptProjection(a.projection.clipboardText.replace('report','changed'));assert.equal(a.projection.occurrences.length,0);
  assert.match((await host.serializeInputDraft('a')).text,/changed-with-long-name/);
});

test('转换失败不消费草稿，非文字结果拒绝，源停用保持失效节点并阻止提交',async t=>{
  const host=bench(t);let fail=true;await refs(host,async()=>{if(fail)throw new Error('真实读取失败');return {invented:'text'};});
  const a=host.mountInputEditor('a');a.setPlain('@r');await pick(host,a);const before=a.snapshot();
  await assert.rejects(host.serializeInputDraft('a'),/真实读取失败/);assert.deepEqual(a.snapshot(),before);
  fail=false;await assert.rejects(host.serializeInputDraft('a'),/不是文字/);assert.deepEqual(a.snapshot(),before);
  await host.unload('reference-owner');assert.equal(a.projection.occurrences[0].invalid,true);
  await assert.rejects(host.serializeInputDraft('a'),/引用来源已不可用/);assert.equal(a.projection.clipboardText,before.text);
});

test('等待转换期间编辑或切换会话会取消，晚到结果不转为普通发送也不清空新正文',async t=>{
  const host=bench(t);let finish;let entered;const started=new Promise(resolve=>entered=resolve);
  await refs(host,async()=>{entered();return new Promise(resolve=>finish=resolve);});
  const a=host.mountInputEditor('a');a.setPlain('@r');await pick(host,a);
  const pending=host.serializeInputDraft('a');await started;const rejected=assert.rejects(pending,/输入已经变化/);
  a.adoptProjection(a.projection.clipboardText+' 新输入');await rejected;finish('迟到转换');await settled();assert.match(a.projection.clipboardText,/新输入/);
  const second=host.serializeInputDraft('a');await settled();const switched=assert.rejects(second,/已取消/);host.unmountInputEditor('a');await switched;
  finish('更迟到转换');await settled();assert.match(a.projection.clipboardText,/新输入/);
});

test('等待转换期间停用来源会取消，恢复已发送消息仍按来源检查真实身份',async t=>{
  const host=bench(t);let finish;let entered;const started=new Promise(resolve=>entered=resolve);
  await refs(host,async()=>{entered();return new Promise(resolve=>finish=resolve);});
  const a=host.mountInputEditor('a');a.setPlain('原消息 @r');await pick(host,a,4);const sent=a.snapshot();
  const pending=host.serializeInputDraft('a');await started;
  const rejected=assert.rejects(pending,/输入已经变化|引用或输入已经变化|停用/);
  await host.unload('reference-owner');await rejected;finish('不能提交的迟到资料');await settled();
  a.setPlain('其他正文');a.restore(sent);a.refreshSources();
  assert.equal(a.snapshot().text,sent.text);assert.equal(a.projection.occurrences[0].ref,'opaque-one');
  assert.equal(a.projection.occurrences[0].invalid,true);
  await assert.rejects(host.serializeInputDraft('a'),/引用来源已不可用/);
  await refs(host,async()=> '重新读取的资料');a.refreshSources();
  assert.equal((await host.serializeInputDraft('a')).text,'原消息 重新读取的资料 ');
});

test('显式草稿持久化恢复身份，原始文字不伪造节点，坏范围、占位符与不同任务被隔离',async t=>{
  const storage=new Map();const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
  let host=bench(t);await refs(host);let a=host.mountInputEditor('a');a.setPlain('@r');await pick(host,a);a.flush();const saved=a.snapshot();await host.dispose();
  host=bench(t);a=host.mountInputEditor('a');assert.equal(a.projection.occurrences.length,1);assert.equal(a.projection.occurrences[0].invalid,true);
  await refs(host);assert.notEqual(a.projection.occurrences[0].invalid,true);assert.equal((await host.serializeInputDraft('a')).text,'<actual>opaque-one</actual> ');
  assert.equal(host.mountInputEditor('b').projection.occurrences.length,0);
  assert.throws(()=>validateDraftSnapshot({text:saved.text,references:[{...saved.references[0],offset:1}]}),/范围或身份/);
  assert.throws(()=>validateDraftSnapshot({text:'\uFFFC',references:[]}),/伪造占位符/);
  a.setPlain(a.projection.clipboardText);assert.equal(a.projection.occurrences.length,0,'普通全文替换清除语义身份');
});

test('程序打开实际单一来源菜单，在真实选择范围插入节点，不要求伪造触发文字',async t=>{
  const host=bench(t);await refs(host);let unrelatedCalls=0;
  await host.load({name:'other-input',inject:['inputTriggers'],apply(ctx){ctx.effect(()=>ctx.inputTriggers.registerSource({
    name:'unrelated',trigger:'@',candidates:async()=>{unrelatedCalls++;return [{name:'wrong'}];},onPick:()=>({text:'错误来源'})
  }));}},'other-input');
  const a=host.mountInputEditor('a');host.mountInputEditor('b');a.setPlain('前文 旧内容 后文');
  const controller=host.ctx.inputTriggers.sessionOf(host.ctx.sessions.scope('a'));
  const revision=host.setInputDraft('a',a.projection.clipboardText);
  const hit={trigger:'@',query:'',quoted:false,position:'inline',span:{start:3,end:6,draftRev:revision}};
  const observed=[];const off=host.subscribeInputMenus(id=>observed.push(id));t.after(off);
  a.setSelectionRange(3,6);host.toggleInputSource('a','actual-refs','@');await settled();
  let menu=host.inputMenuSnapshot('a');assert.equal(menu.launched,true);assert.equal(menu.candidates.length,1);
  assert.equal(unrelatedCalls,0);assert.equal(host.inputMenuSnapshot('b').state.open,false);
  host.trackInputMenu('a',a.projection.clipboardText,6);menu=host.inputMenuSnapshot('a');
  assert.equal(menu.launched,true,'官方允许来源菜单取得焦点后的首次无触发文字跟踪');
  host.pickInputCandidate('a',menu.candidates[0],hit.span);
  assert.equal(a.projection.clipboardText,'前文 @report-with-long-name 后文');
  assert.equal(a.projection.occurrences.length,1);assert.equal(a.projection.occurrences[0].offset,3);
  assert.equal(host.inputMenuSnapshot('a').state.open,false);assert.ok(observed.every(id=>id==='a'));
  assert.equal((await host.serializeInputDraft('a')).text,'前文 <actual>opaque-one</actual> 后文');
  const firstId=a.projection.occurrences[0].occurrenceId;
  a.setSelectionRange(a.projection.clipboardText.length-2,a.projection.clipboardText.length);
  host.toggleInputSource('a','actual-refs','@');await settled();menu=host.inputMenuSnapshot('a');
  assert.equal(menu.state.hit.span.start,a.projection.detectText.length-2,'已有长名称引用后的选择仍使用检测坐标');
  host.pickInputCandidate('a',menu.candidates[0],menu.state.hit.span);
  assert.equal(a.projection.occurrences.length,2);assert.equal(a.projection.occurrences[0].occurrenceId,firstId);
  assert.equal((await host.serializeInputDraft('a')).text,'前文 <actual>opaque-one</actual> <actual>opaque-one</actual> ');
});

test('来源菜单重复打开可关闭，取消后的迟到候选不恢复，切换和停用使旧候选失效',async t=>{
  const host=bench(t);let resolveCandidates;
  await host.load({name:'launcher-wait',inject:['inputTriggers'],apply(ctx){ctx.effect(()=>ctx.inputTriggers.registerSource({
    name:'launcher-wait',trigger:'@',candidates:()=>new Promise(resolve=>resolveCandidates=resolve),onPick:()=>({text:'不能迟到覆盖'})
  }));}},'launcher-wait');
  const a=host.mountInputEditor('a');a.setPlain('独立草稿');
  const controller=host.ctx.inputTriggers.sessionOf(host.ctx.sessions.scope('a'));
  const hit={trigger:'@',query:'',quoted:false,position:'inline',span:{start:0,end:0,draftRev:host.setInputDraft('a',a.projection.clipboardText)}};
  controller.toggleSource('launcher-wait',hit);await settled();assert.equal(host.inputMenuSnapshot('a').launched,true);
  controller.toggleSource('launcher-wait',hit);assert.equal(host.inputMenuSnapshot('a').state.open,false);
  resolveCandidates([{name:'late'}]);await settled();assert.equal(host.inputMenuSnapshot('a').state.open,false);
  controller.toggleSource('launcher-wait',hit);await settled();resolveCandidates([{name:'ready'}]);await settled();
  const selected=host.inputMenuSnapshot('a').candidates[0];host.unmountInputEditor('a');
  assert.equal(host.inputMenuSnapshot('a').state.open,false);
  assert.throws(()=>host.pickInputCandidate('a',selected,hit.span),/候选已经变化/);
  host.mountInputEditor('a');controller.toggleSource('launcher-wait',hit);await settled();
  await host.unload('launcher-wait');resolveCandidates([{name:'disabled-late'}]);await settled();
  assert.equal(host.inputMenuSnapshot('a').state.open,false);assert.equal(a.projection.clipboardText,'独立草稿');
});
