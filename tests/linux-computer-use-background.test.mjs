import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { McpClient } from '../electron/mcp.mts';
import { captureVerifiedWindow, windowCaptureIdentity } from '../electron/linux-computer-use-server.mts';

test('Linux 后台在确认的光标或选区插入文字，内容或位置变化时不操作', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util,sys,types
sys.modules['pyatspi']=types.ModuleType('pyatspi')
spec=importlib.util.spec_from_file_location('dyw_test',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Text:
 def __init__(self): self.value='前😀后';self.caretOffset=2;self.selection=None;self.writes=[];self.accept=True
 @property
 def characterCount(self): return len(self.value)
 def getText(self,start,end): return self.value[start:end]
 def getNSelections(self): return 1 if self.selection else 0
 def getSelection(self,index): return self.selection
 def insertText(self,position,text,length):
  self.writes.append(('insert',position,text,length))
  assert length==len(text.encode('utf-8'))
  if self.accept: self.value=self.value[:position]+text+self.value[position:]
  return self.accept
 def setTextContents(self,text):
  self.writes.append(('replace',text))
  if self.accept: self.value=text
  return self.accept
class Element:
 def __init__(self): self.text=Text();self.role='entry'
 def getRoleName(self): return self.role
 def queryText(self): return self.text
 def queryEditableText(self): return self.text
e=Element()
def snapshot(): return {'element_signature':{'content_fingerprint':m.content_fingerprint(e),'selection_snapshot':m.selection_snapshot(e)}}
p=snapshot();p['text']='中文😀';m.insert_text(e,p)
assert e.text.value=='前😀中文😀后' and e.text.writes[-1][3]==len('中文😀'.encode('utf-8'))
e.text.selection=(1,2);e.text.caretOffset=2;p=snapshot();p['text']='新';m.insert_text(e,p)
assert e.text.value=='前新中文😀后' and e.text.writes[-1][0]=='replace'
e.text.selection=None;e.text.caretOffset=1;p=snapshot();p['text']='错';e.text.caretOffset=2
before=list(e.text.writes)
try:m.insert_text(e,p)
except RuntimeError as error:assert '选区' in str(error)
else:raise AssertionError('选区变化必须停止')
assert e.text.writes==before
p=snapshot();p['text']='错';e.text.value+='改'
try:m.insert_text(e,p)
except RuntimeError as error:assert '原文' in str(error)
else:raise AssertionError('内容变化必须停止')
assert e.text.writes==before
p=snapshot();p['text']='错';reads=iter((e.text.value,'变'*len(e.text.value),e.text.value))
e.text.getText=lambda start,end: next(reads)[start:end]
try:m.insert_text(e,p)
except RuntimeError as error:assert '原文' in str(error)
else:raise AssertionError('用于计算替换的原文必须与观察一致')
del e.text.getText
assert e.text.writes==before
p=snapshot();p['text']='a\\x00b'
try:m.insert_text(e,p)
except RuntimeError as error:assert '空字符' in str(error)
else:raise AssertionError('空字符必须停止')
e.role='password text';assert m.selection_snapshot(e) is None
try:m.insert_text(e,{'text':'x'})
except RuntimeError as error:assert '密码' in str(error)
else:raise AssertionError('密码必须停止')
`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 窗口截图在采集前后核对窗口和进程，变化或不可核对时不返回画面', async () => {
  const target = { id: '0x12', className: 'editor.Editor', title: '目标文档' };
  let windows = [target], pid = '1234', start = '4321', captures = 0;
  const identity = item => windowCaptureIdentity(item, {
    windows: async () => windows,
    getPid: async () => pid,
    readStat: async () => `1234 (name with spaces) ${Array(19).fill('0').join(' ')} ${start} 0`,
  });
  const capture = async () => { captures++; return 'target-image'; };
  assert.equal(await captureVerifiedWindow(target, { identity, capture }), 'target-image');
  assert.equal(captures, 1);
  windows = [{ ...target, title: '其他文档' }];
  assert.equal(await captureVerifiedWindow(target, { identity, capture }), '');
  assert.equal(captures, 1, '窗口已变化时不应开始截图');
  windows = [target];
  assert.equal(await captureVerifiedWindow(target, { identity, capture: async () => { pid = '5678'; return 'other-image'; } }), '');
  pid = '1234';
  assert.equal(await captureVerifiedWindow(target, { identity, capture: async () => { start = '9999'; return 'other-image'; } }), '');
  pid = '';
  assert.equal(await captureVerifiedWindow(target, { identity, capture }), '');
  assert.equal(await captureVerifiedWindow(target, { identity: async () => { throw new Error('无法读取'); }, capture }), '');
});

test('Linux 控件树只匹配目标进程，无法确认或多个进程同名时不猜测', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types
pyatspi=types.ModuleType('pyatspi'); sys.modules['pyatspi']=pyatspi
spec=importlib.util.spec_from_file_location('dyw_test',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Node:
 def __init__(self, role, name, pid, children=()): self.role=role; self.name=name; self.pid=pid; self.children=list(children)
 @property
 def childCount(self): return len(self.children)
 def getChildAtIndex(self, i): return self.children[i]
 def getRoleName(self): return self.role
 def get_process_id(self): return self.pid
first=Node('application','编辑器',11,[Node('frame','文档',11)])
second=Node('application','编辑器',22,[Node('frame','文档',22)])
desktop=Node('desktop','',0,[first,second]); pyatspi.Registry=types.SimpleNamespace(getDesktop=lambda _:desktop)
assert m.find_application(['编辑器'],'文档','22')[0] is second
assert m.find_application(['编辑器'],'文档','11')[0] is first
for pid in ('0', '33', 'not-a-pid'):
 try: m.find_application(['编辑器'],'文档',pid)
 except RuntimeError: pass
 else: raise AssertionError('不能猜测进程')
second.pid=11
try: m.find_application(['编辑器'],'文档','11')
except RuntimeError: pass
else: raise AssertionError('同进程多个候选需要停止')
`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 后台控件操作不激活窗口、不调用系统鼠标键盘', { skip: process.platform === 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-bg-'));
  const log = path.join(dir, 'events.jsonl');
  const pidFile = path.join(dir, 'pid');
  const flipFile = path.join(dir, 'flip');
  await fs.writeFile(pidFile, '4321');
  const script = `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');const name=path.basename(process.argv[1]);const args=process.argv.slice(2);let payload=null;if(name==='python3')payload=JSON.parse(fs.readFileSync(0,'utf8'));fs.appendFileSync(process.env.DYW_TEST_LOG,JSON.stringify({name,args,payload})+'\\n');if(name==='wmctrl')console.log('0x03e00007  0 test-host test.Test 目标窗口');else if(name==='xdotool'&&args[0]==='getwindowpid')console.log(fs.readFileSync(process.env.DYW_TEST_PID,'utf8'));else if(name==='xdotool'&&args[0]==='getactivewindow')console.log('0x03e00007');else if(name==='python3'){if(payload.command==='state'&&fs.existsSync(process.env.DYW_TEST_FLIP))fs.writeFileSync(process.env.DYW_TEST_PID,'9876');console.log(JSON.stringify(payload.command==='state'?{ok:true,text:'[e1] 测试',signatures:{e1:{role:'push button',name:fs.readFileSync(process.env.DYW_TEST_LOG,'utf8').split('\"command\":\"state\"').length>2?'更新后的控件':'测试',parent_role:'frame',index_in_parent:0}}}:{ok:true}));}\n`;
  for (const name of ['wmctrl', 'xdotool', 'python3']) {
    await fs.writeFile(path.join(dir, name), script, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: dir, DYW_TEST_LOG: log, DYW_TEST_PID: pidFile, DYW_TEST_FLIP: flipFile, DYWORKER_VIRTUAL_DISPLAY: '0' };
  delete env.DYWORKER_XVFB_DISPLAY;
  const client = new McpClient({ command: process.execPath, args: [fileURLToPath(new URL('../electron/linux-computer-use-server.mts', import.meta.url))], env, requestTimeoutMs: 30000 });
  let foregroundClient;
  t.after(async () => { await client.close(); await foregroundClient?.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await client.connect();
  const target = { app: 'test', window_id: '0x03e00007', window_title: '目标窗口', element_index: 'e1' };
  const unobserved = await client.callTool('click', target);
  assert.equal(unobserved.isError, true);
  assert.match(unobserved.text, /提供观察编号/);
  const state = await client.callTool('get_app_state', target);
  assert.equal(state.isError, false, state.text);
  const observationId = /观察编号：([^\s]+)/.exec(state.text)?.[1];
  assert.ok(observationId);
  target.observation_id = observationId;
  const review = await client.callTool('get_app_state', target);
  assert.equal(review.isError, false, review.text);
  assert.notEqual(/观察编号：([^\s]+)/.exec(review.text)?.[1], observationId);
  for (const [name, extra] of [['click', {}], ['set_value', { value: '后台文本' }], ['replace_text', { old_text: '旧', new_text: '新', prefix: '前' }], ['insert_text', { text: '新' }], ['select_text', { text: '文本' }], ['perform_secondary_action', { action: 'press' }], ['scroll', { direction: 'down' }]]) {
    const result = await client.callTool(name, { ...target, ...extra });
    assert.equal(result.isError, false, result.text);
  }
  for (const [name, extra] of [['press_key', { key: 'Return' }], ['type_text', { text: '文字' }], ['scroll', { direction: 'down', x: 10, y: 10, element_index: undefined }], ['hover', {}], ['drag', { from_x: 1, from_y: 1, to_x: 2, to_y: 2 }]]) {
    const result = await client.callTool(name, { ...target, ...extra });
    assert.equal(result.isError, true);
    assert.match(result.text, /不支持后台/);
  }
  for (const menuAction of ['showmenu', 'menu', 'popup', 'focus', 'grabfocus', 'raise', 'activate']) {
    const res = await client.callTool('perform_secondary_action', { ...target, action: menuAction });
    assert.equal(res.isError, true);
    assert.match(res.text, /不能在后台/);
  }
  const coordinate = await client.callTool('click', { ...target, element_index: undefined, x: 1, y: 1 });
  assert.equal(coordinate.isError, true);
  const unrecognized = await client.callTool('click', { ...target, observation_id: 'expired', background: false });
  assert.equal(unrecognized.isError, true);
  assert.match(unrecognized.text, /提供观察编号/);
  const missing = await client.callTool('launch_app', { app: '不存在' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /无法保证启动/);
  const events = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.filter(event => event.name === 'xdotool').every(event => event.args[0] === 'getwindowpid'), '后台只允许读取窗口所属进程');
  assert.ok(events.filter(event => event.name === 'python3' && event.payload.command !== 'state').every(event => event.payload.element_signature.name === '测试'), '审核读取不能替换原观察中的目标');
  assert.ok(events.filter(event => event.name === 'python3').every(event => event.payload.expected_pid === '4321'), '应用读取和控件操作必须绑定相同进程');
  assert.deepEqual(events.filter(event => event.name === 'python3' && event.payload.command !== 'state').map(event => [event.payload.command, event.payload.background]), [['click', true], ['set_value', true], ['replace_text', true], ['insert_text', true], ['select_text', true], ['secondary', true], ['scroll', true]]);
  assert.equal(events.find(event => event.payload?.command === 'replace_text').payload.prefix, '前');
  await fs.writeFile(pidFile, '9876');
  const replacedWindow = await client.callTool('click', target);
  assert.equal(replacedWindow.isError, true);
  assert.match(replacedWindow.text, /所属应用已变化/);
  const afterReplacement = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(afterReplacement.filter(event => event.name === 'python3').length, events.filter(event => event.name === 'python3').length, '进程变化后不能执行控件操作');
  await fs.writeFile(pidFile, '4321');
  await fs.writeFile(flipFile, '1');
  const changedDuringRead = await client.callTool('get_app_state', target);
  assert.match(changedDuringRead.text, /读取期间目标窗口所属应用已变化/);
  assert.doesNotMatch(changedDuringRead.text, /观察编号：/);
  await fs.unlink(flipFile);
  await fs.writeFile(pidFile, '4321');
  await client.close();
  const closedEvents = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(closedEvents.filter(event => event.name === 'xdotool').every(event => event.args[0] === 'getwindowpid'), '后台任务关闭时也不得发送按键释放事件');
  foregroundClient = new McpClient({ command: process.execPath, args: [fileURLToPath(new URL('../electron/linux-computer-use-server.mts', import.meta.url))], env, requestTimeoutMs: 10000 });
  await foregroundClient.connect();
  const foregroundState = await foregroundClient.callTool('get_app_state', target);
  assert.equal(foregroundState.isError, false, foregroundState.text);
  target.observation_id = /观察编号：([^\s]+)/.exec(foregroundState.text)?.[1];
  const foreground = await foregroundClient.callTool('click', { ...target, background: false });
  assert.equal(foreground.isError, false, foreground.text);
  const updated = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(updated.some(event => event.name === 'xdotool' && event.args[0] === 'getactivewindow'));
  assert.equal(updated.filter(event => event.name === 'python3').at(-1).payload.background, false);
});

test('Linux 控件没有直接点击动作时不回退系统鼠标，并拒绝含糊的文字选择', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types\nsys.modules['pyatspi'] = types.ModuleType('pyatspi')\nspec = importlib.util.spec_from_file_location('dyw_test', sys.argv[1])\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nclass NoAction:\n def queryAction(self): raise Exception('无动作')\ntry: m.click_element(NoAction())\nexcept RuntimeError as e: assert '不支持后台点击' in str(e)\nelse: raise AssertionError('应停止')\nclass Action:\n nActions = 1\n def getName(self, i): return 'click'\n def doAction(self, i): return True\nclass Button:\n def queryAction(self): return Action()\nassert m.click_element(Button()) is False\nassert m.click_element(NoAction(), False) is True\nclass RefusedAction(Action):\n def doAction(self, i): return False\nclass RefusedButton:\n def queryAction(self): return RefusedAction()\ntry: m.click_element(RefusedButton(), False)\nexcept RuntimeError as e: assert '拒绝执行点击' in str(e)\nelse: raise AssertionError('应报告点击失败')\nclass Text:\n characterCount = 5\n selected = None\n def getText(self, a, b): return '甲乙甲乙甲'\n def getNSelections(self): return int(self.selected is not None)\n def getSelection(self, i): return self.selected\n def addSelection(self, a, b): self.selected=(a,b); return True\nclass Field:\n def queryText(self): return Text()\ntry: m.select_text(Field(), {'text': '甲'})\nexcept RuntimeError as e: assert '多处匹配' in str(e)\nelse: raise AssertionError('应拒绝歧义')\nm.select_text(Field(), {'text': '甲', 'prefix': '乙甲乙'})\n`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 修改和选择文字前核对观察时的内容，不覆盖用户后续输入', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types
sys.modules['pyatspi'] = types.ModuleType('pyatspi')
spec = importlib.util.spec_from_file_location('dyw_test', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Field:
 def __init__(self): self.text='前😀原文'
 def getRoleName(self): return 'text'
 def queryText(self): return self
 def queryEditableText(self): return self
 def queryValue(self): raise Exception('不是数字')
 @property
 def characterCount(self): return len(self.text)
 def getText(self, start, end): return self.text[start:end]
 def setTextContents(self, value): self.text=value; return True
field=Field(); fingerprint=m.content_fingerprint(field); observed={'content_fingerprint':fingerprint}
assert fingerprint['kind']=='text' and '前😀原文' not in repr(fingerprint)
for command in ('set_value','select_text'): m.verify_observed_content(field, observed, command)
field.text='用户新输入'
for command in ('set_value','select_text'):
 try: m.verify_observed_content(field, observed, command)
 except RuntimeError as e: assert '内容已变化' in str(e)
 else: raise AssertionError('旧观察不能覆盖或选择新内容')
assert field.text=='用户新输入'
fresh={'content_fingerprint':m.content_fingerprint(field)}
m.verify_observed_content(field, fresh, 'set_value'); m.set_value(field, '用户授权的新文字')
assert field.text=='用户授权的新文字'
class Password:
 def getRoleName(self): return 'password text'
 def queryText(self): raise AssertionError('不得读取密码')
 def queryValue(self): raise AssertionError('不得读取密码')
password=Password(); assert m.content_fingerprint(password)=={'kind':'protected'}
m.verify_observed_content(password, {'content_fingerprint':{'kind':'protected'}}, 'set_value')
try: m.verify_observed_content(field, {'content_fingerprint':{'kind':'unavailable'}}, 'set_value')
except RuntimeError as e: assert '无法核对' in str(e)
else: raise AssertionError('不可核对的内容不能覆盖')
`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 局部替换核对原文和结果，拒绝歧义、过期和密码控件', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types
sys.modules['pyatspi'] = types.ModuleType('pyatspi')
spec = importlib.util.spec_from_file_location('dyw_test', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Field:
 def __init__(self): self.text='前😀中间😀后'; self.accept=True
 def getRoleName(self): return 'text'
 def queryText(self): return self
 def queryEditableText(self): return self
 @property
 def characterCount(self): return len(self.text)
 def getText(self, a, b): return self.text[a:b]
 def setTextContents(self, value):
  if self.accept: self.text=value
  return self.accept
field=Field()
def payload(**kw): return {'element_signature':{'content_fingerprint':m.content_fingerprint(field)}, **kw}
try: m.replace_text(field, payload(old_text='😀',new_text='星'))
except RuntimeError as e: assert '多处匹配' in str(e)
else: raise AssertionError('重复原文不能盲目修改')
assert field.text=='前😀中间😀后'
m.replace_text(field, payload(old_text='😀',new_text='星',prefix='前'))
assert field.text=='前星中间😀后'
m.replace_text(field, payload(old_text='中间',new_text=''))
assert field.text=='前星😀后'
stale=payload(old_text='😀',new_text='改'); field.text='用户自己修改😀'
try: m.replace_text(field, stale)
except RuntimeError as e: assert '原文已变化' in str(e)
else: raise AssertionError('原文变化后不能覆盖')
assert field.text=='用户自己修改😀'
field.accept=False
try: m.replace_text(field, payload(old_text='😀',new_text='改'))
except RuntimeError: pass
else: raise AssertionError('应用拒绝修改不能报告成功')
class Password:
 def getRoleName(self): return 'password text'
 def queryText(self): raise AssertionError('不得读取密码')
try: m.replace_text(Password(), {'old_text':'x','new_text':'y'})
except RuntimeError as e: assert '密码' in str(e)
else: raise AssertionError('不能修改密码')
`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 核对控件位置及设置后的内容，拒绝被替换或未生效的控件', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types\nsys.modules['pyatspi'] = types.ModuleType('pyatspi')\nspec = importlib.util.spec_from_file_location('dyw_test', sys.argv[1])\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\ncurrent = {'role': 'button', 'name': '', 'parent_role': 'panel', 'index_in_parent': 0}\nm.element_signature = lambda element: current\nassert m.signature_matches(None, dict(current))\nassert not m.signature_matches(None, {**current, 'index_in_parent': 1})\nassert not m.signature_matches(None, {**current, 'name': '提交'})\nclass Field:\n def __init__(self, accept=True, change=True): self.value='原文'; self.accept=accept; self.change=change\n def queryEditableText(self): return self\n def queryText(self): return self\n def getRoleName(self): return 'text'\n @property\n def characterCount(self): return len(self.value)\n def getText(self, start, end): return self.value[start:end]\n def setTextContents(self, value):\n  if self.change: self.value=value\n  return self.accept\nf=Field(); m.set_value(f, '新😀文字'); assert f.value == '新😀文字'\nfor field in [Field(accept=False), Field(change=False)]:\n try: m.set_value(field, '目标')\n except RuntimeError: pass\n else: raise AssertionError('应用拒绝或未生效时不能报告成功')\nclass Number:\n def __init__(self): self.currentValue=2\nclass Slider:\n def queryEditableText(self): raise Exception()\n def queryValue(self): return number\nnumber=Number(); m.set_value(Slider(), '4.5'); assert number.currentValue == 4.5\n`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 文字选择必须核对范围和光标，读取界面不读取密码内容', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types\nsys.modules['pyatspi'] = types.ModuleType('pyatspi')\nspec = importlib.util.spec_from_file_location('dyw_test', sys.argv[1])\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nclass Field:\n def __init__(self): self.text='甲😀乙甲'; self.selected=None; self.caretOffset=0; self.apply=True\n def getRoleName(self): return 'text'\n def queryText(self): return self\n @property\n def characterCount(self): return len(self.text)\n def getText(self, a, b): return self.text[a:b]\n def getNSelections(self): return int(self.selected is not None)\n def getSelection(self, i): return self.selected\n def addSelection(self, a, b):\n  if self.apply: self.selected=(a,b)\n  return True\n def setSelection(self, i, a, b):\n  if self.apply: self.selected=(a,b)\n  return True\n def setCaretOffset(self, n):\n  if self.apply: self.caretOffset=n; self.selected=None\n  return True\nf=Field(); m.select_text(f, {'text':'乙'}); assert f.selected == (2,3)\nm.select_text(f, {'text':'😀'}); assert f.selected == (1,2)\nm.select_text(f, {'text':'乙','selection':'cursor_after'}); assert f.caretOffset == 3 and f.selected is None\nf.apply=False\nfor payload in [{'text':'😀'},{'text':'乙','selection':'cursor_before'}]:\n try: m.select_text(f, payload)\n except RuntimeError as e: assert '未确认' in str(e)\n else: raise AssertionError('未生效时不能报告成功')\nclass Password:\n name='密码'; description=''\n def getRoleName(self): return 'password text'\n def queryText(self): raise AssertionError('不得读取密码')\n def queryValue(self): raise AssertionError('不得读取密码')\np=Password(); m.descendants=lambda root, limit=600, with_path=False: [(0,p,())] if with_path else [(0,p)]\ntext, _ = m.describe(p); assert '密码' in text\ntry: m.select_text(p, {'text':'secret'})\nexcept RuntimeError as e: assert '密码' in str(e)\nelse: raise AssertionError('不得选择密码')\n`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 同名按钮所在区域互换后不会误用旧控件编号', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types\nsys.modules['pyatspi'] = types.ModuleType('pyatspi')\nspec = importlib.util.spec_from_file_location('dyw_test', sys.argv[1])\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nclass Node:\n def __init__(self, role, name, children=()):\n  self.role=role; self.name=name; self.children=list(children); self.parent=None\n  for child in self.children: child.parent=self\n @property\n def childCount(self): return len(self.children)\n def getChildAtIndex(self, i): return self.children[i]\n def getParent(self): return self.parent\n def getRoleName(self): return self.role\na=Node('push button','删除'); b=Node('push button','删除')\npanel_a=Node('panel','第一条记录',[a]); panel_b=Node('panel','第二条记录',[b])\nroot=Node('frame','目标窗口',[panel_a,panel_b])\n_, signatures=m.describe(root)\nassert m.element_at(root,'e2',signatures['e2']) is a\nroot.children=[panel_b,panel_a]\ntry: m.element_at(root,'e2',signatures['e2'])\nexcept RuntimeError as e: assert '身份已经变化' in str(e)\nelse: raise AssertionError('不能误点另一条记录的同名按钮')\n`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Linux 多个同名应用实例按窗口区分，无法区分时停止', { skip: process.platform === 'win32' }, t => {
  const scriptPath = fileURLToPath(new URL('../electron/scripts/linux_computer_use.py', import.meta.url));
  const script = `import importlib.util, sys, types\npyatspi=types.ModuleType('pyatspi'); sys.modules['pyatspi']=pyatspi\nspec = importlib.util.spec_from_file_location('dyw_test', sys.argv[1])\nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nclass Node:\n def __init__(self, role, name, children=()): self.role=role; self.name=name; self.children=list(children)\n @property\n def childCount(self): return len(self.children)\n def getChildAtIndex(self, i): return self.children[i]\n def getRoleName(self): return self.role\nfirst=Node('application','编辑器',[Node('frame','甲文档')]); second=Node('application','编辑器',[Node('frame','乙文档')])\ndesktop=Node('desktop','',[first,second]); pyatspi.Registry=types.SimpleNamespace(getDesktop=lambda _:desktop)\nfound,_=m.find_application(['编辑器'],'乙文档'); assert found is second\nsecond.children[0].name='甲文档'\ntry: m.find_application(['编辑器'],'甲文档')\nexcept RuntimeError as e: assert '多个应用实例' in str(e)\nelse: raise AssertionError('同名窗口不应按枚举顺序选择')\nsecond.children[0].name='乙文档'\ntry: m.find_application(['编辑器'],'未知文档')\nexcept RuntimeError as e: assert '多个应用实例' in str(e)\nelse: raise AssertionError('无法分辨实例时应停止')\n`;
  const result = spawnSync('python3', ['-c', script, scriptPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return t.skip('未安装 Python 3');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('前台窗口无法确认时不发送键盘、鼠标或剪贴板输入', { skip: process.platform === 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-focus-'));
  const log = path.join(dir, 'events.jsonl');
  const script = `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');const name=path.basename(process.argv[1]);const args=process.argv.slice(2);fs.appendFileSync(process.env.DYW_TEST_LOG,JSON.stringify({name,args})+'\\n');if(name==='wmctrl'&&args[0]==='-lx')console.log('0x03e00007  0 test-host test.Test 目标窗口');if(name==='xdotool'&&args[0]==='getactivewindow')console.log('0x03e00008');if(name==='xdotool'&&args[0]==='getwindowgeometry')console.log('X=0\\nY=0\\nWIDTH=800\\nHEIGHT=600');\n`;
  for (const name of ['wmctrl', 'xdotool', 'xclip', 'xsel']) await fs.writeFile(path.join(dir, name), script, { mode: 0o755 });
  const env = { ...process.env, PATH: dir, DYW_TEST_LOG: log, DYWORKER_VIRTUAL_DISPLAY: '0' };
  delete env.DYWORKER_XVFB_DISPLAY;
  const client = new McpClient({ command: process.execPath, args: [fileURLToPath(new URL('../electron/linux-computer-use-server.mts', import.meta.url))], env, requestTimeoutMs: 10000 });
  t.after(async () => { await client.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await client.connect();
  const target = { app: 'test', window_id: '0x03e00007', window_title: '目标窗口', background: false };
  for (const [name, extra] of [['press_key', { key: 'Return' }], ['type_text', { text: '中文' }], ['click', { x: 10, y: 10 }]]) {
    const result = await client.callTool(name, { ...target, ...extra });
    assert.equal(result.isError, true, result.text);
    assert.match(result.text, /无法确认目标窗口已进入前台/);
  }
  const events = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.some(event => ['xclip', 'xsel'].includes(event.name)), false);
  assert.equal(events.some(event => event.name === 'xdotool' && ['key', 'type', 'mousemove', 'click'].includes(event.args[0])), false);
});

test('取消时只在已经开始输入后释放可能残留的按键', { skip: process.platform === 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-cancel-'));
  const log = path.join(dir, 'events.jsonl');
  const script = `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');const name=path.basename(process.argv[1]);const args=process.argv.slice(2);fs.appendFileSync(process.env.DYW_TEST_LOG,JSON.stringify({name,args})+'\\n');if(name==='wmctrl'&&args[0]==='-lx')console.log('0x03e00007  0 test-host test.Test 目标窗口');if(name==='xdotool'&&args[0]==='getactivewindow')console.log(process.env.DYW_TEST_PHASE==='focus'?'0x03e00008':'0x03e00007');if(name==='xdotool'&&((process.env.DYW_TEST_PHASE==='focus'&&args[0]==='windowactivate')||(process.env.DYW_TEST_PHASE==='input'&&args[0]==='key')))setTimeout(()=>{},30000);\n`;
  for (const name of ['wmctrl', 'xdotool']) await fs.writeFile(path.join(dir, name), script, { mode: 0o755 });
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close(); await fs.rm(dir, { recursive: true, force: true }); });
  for (const phase of ['focus', 'input']) {
    await fs.writeFile(log, '');
    const env = { ...process.env, PATH: dir, DYW_TEST_LOG: log, DYW_TEST_PHASE: phase, DYWORKER_VIRTUAL_DISPLAY: '0' };
    delete env.DYWORKER_XVFB_DISPLAY;
    const client = new McpClient({ command: process.execPath, args: [fileURLToPath(new URL('../electron/linux-computer-use-server.mts', import.meta.url))], env, requestTimeoutMs: 10000 });
    clients.push(client);
    await client.connect();
    const controller = new AbortController();
    const call = client.callTool('press_key', { app: 'test', window_id: '0x03e00007', window_title: '目标窗口', background: false, key: 'Return' }, { signal: controller.signal });
    const done = assert.rejects(call, /任务已停止/);
    const waitingFor = phase === 'focus' ? 'windowactivate' : 'key';
    let events = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      events = (await fs.readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (events.some(event => event.name === 'xdotool' && event.args[0] === waitingFor)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(events.some(event => event.name === 'xdotool' && event.args[0] === waitingFor));
    controller.abort();
    await done;
    let released = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      events = (await fs.readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      released = events.some(event => event.name === 'xdotool' && event.args[0] === 'keyup');
      if (released || phase === 'focus' && attempt >= 15) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(released, phase === 'input');
    await client.close();
  }
});

test('Linux 前台粘贴和控件鼠标回退在窗口切走后停止', { skip: process.platform === 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-switch-'));
  const log = path.join(dir, 'events.jsonl');
  const focus = path.join(dir, 'focus');
  const scenario = path.join(dir, 'scenario');
  const script = `#!${process.execPath}
const fs = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
const { DYW_TEST_LOG: log, DYW_TEST_FOCUS: focus, DYW_TEST_SCENARIO: scenario } = process.env;
const mode = fs.readFileSync(scenario, 'utf8');
const payload = name === 'python3' ? JSON.parse(fs.readFileSync(0, 'utf8')) : null;
fs.appendFileSync(log, JSON.stringify({ name, args, payload }) + '\\n');
if (name === 'wmctrl') console.log('0x03e00007  0 test-host test.Test 目标窗口');
if (name === 'xclip' && mode === 'clipboard-switch') fs.writeFileSync(focus, '0x03e00008');
if (name === 'xdotool' && args[0] === 'getactivewindow') console.log(fs.readFileSync(focus, 'utf8'));
if (name === 'xdotool' && args[0] === 'getwindowpid') console.log('4321');
if (name === 'xdotool' && args[0] === 'getwindowgeometry') console.log('X=0\\nY=0\\nWIDTH=800\\nHEIGHT=600');
if (payload?.command === 'state') console.log(JSON.stringify({ ok: true, text: '[e1] 测试', signatures: { e1: { name: '测试' } } }));
if (payload?.command === 'click') console.log(JSON.stringify({ ok: true, pointerFallback: true }));
if (payload?.command === 'bounds') {
  if (mode === 'pointer-switch') fs.writeFileSync(focus, '0x03e00008');
  console.log(JSON.stringify({ ok: true, x: 30, y: 40 }));
}
`;
  for (const name of ['wmctrl', 'xdotool', 'python3', 'xclip']) {
    await fs.writeFile(path.join(dir, name), script, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: dir, DYW_TEST_LOG: log, DYW_TEST_FOCUS: focus, DYW_TEST_SCENARIO: scenario, DYWORKER_VIRTUAL_DISPLAY: '0' };
  delete env.DYWORKER_XVFB_DISPLAY;
  const client = new McpClient({ command: process.execPath, args: [fileURLToPath(new URL('../electron/linux-computer-use-server.mts', import.meta.url))], env, requestTimeoutMs: 10000 });
  t.after(async () => { await client.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await client.connect();
  const target = { app: 'test', window_id: '0x03e00007', window_title: '目标窗口', background: false };
  await fs.writeFile(scenario, 'ready');
  const state = await client.callTool('get_app_state', target);
  const observationId = /观察编号：([^\s]+)/.exec(state.text)?.[1];
  assert.ok(observationId, state.text);
  for (const [mode, tool, args, inputCommand, switched] of [
    ['clipboard-switch', 'type_text', { text: '中文' }, 'key', true],
    ['clipboard-ready', 'type_text', { text: '中文' }, 'key', false],
    ['pointer-switch', 'click', { element_index: 'e1', observation_id: observationId }, 'mousemove', true],
    ['pointer-ready', 'click', { element_index: 'e1', observation_id: observationId }, 'mousemove', false],
  ]) {
    await fs.writeFile(log, '');
    await fs.writeFile(focus, target.window_id);
    await fs.writeFile(scenario, mode);
    const result = await client.callTool(tool, { ...target, ...args });
    assert.equal(result.isError, switched, result.text);
    if (switched) assert.match(result.text, /已不在前台/);
    const events = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.some(event => event.name === 'xdotool' && event.args[0] === inputCommand), !switched);
    assert.equal(events.some(event => event.args[0] === 'windowactivate' || event.args[0] === '-i'), false);
  }
});
