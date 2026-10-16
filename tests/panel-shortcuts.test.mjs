import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePanelShortcut, panelShortcutFromNative, forwardNativePanelShortcut } from '../electron/panel-shortcuts.ts';

test('面板快捷键支持 macOS 和 Windows/Linux，保留终端原有入口', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const mod = platform === 'darwin' ? {metaKey:true} : {ctrlKey:true};
    for (const [key, expected] of [['t','browser'], ['p','files'], ['j','terminal']]) {
      assert.equal(resolvePanelShortcut({key, ...mod}, platform), expected);
    }
    assert.equal(resolvePanelShortcut({key:'`',code:'Backquote',ctrlKey:true},platform),'terminal');
    assert.equal(resolvePanelShortcut({key:'G',code:'KeyG',ctrlKey:true,shiftKey:true},platform),'review');
    assert.equal(resolvePanelShortcut({key:'s',code:'KeyS',...mod,altKey:true},platform),'chat');
  }
});

test('Option 字符变化、大小写和原生按键走同一套识别', () => {
  assert.equal(resolvePanelShortcut({key:'ß',code:'KeyS',metaKey:true,altKey:true},'darwin'),'chat');
  assert.equal(panelShortcutFromNative({key:'ß',code:'KeyS',meta:true,alt:true},'darwin'),'chat');
  assert.equal(panelShortcutFromNative({key:'P',control:true},'linux'),'files');
  assert.equal(panelShortcutFromNative({key:'`',code:'Backquote',control:true},'darwin'),'terminal');
});

test('不抢占输入法、普通输入或其他快捷键', () => {
  for (const input of [
    {key:'p'}, {key:'p',metaKey:true,ctrlKey:true}, {key:'p',metaKey:true,shiftKey:true},
    {key:'s',metaKey:true,altKey:true,shiftKey:true}, {key:'p',metaKey:true,isComposing:true},
    {key:'t',metaKey:true,altKey:true}, {key:'g',metaKey:true,shiftKey:true},
  ]) assert.equal(resolvePanelShortcut(input,'darwin'),undefined);
  assert.equal(resolvePanelShortcut({key:'p',metaKey:true},'linux'),undefined);
});

test('原生按键阻止默认动作，长按只触发一次，松键不转发', () => {
  let prevented=0;
  const sent=[];
  const event={preventDefault(){prevented++;}};
  const input={type:'keyDown',key:'p',code:'KeyP',meta:true};
  assert.equal(forwardNativePanelShortcut(event,input,'darwin',a=>sent.push(a)),true);
  assert.equal(forwardNativePanelShortcut(event,{...input,isAutoRepeat:true},'darwin',a=>sent.push(a)),true);
  assert.equal(forwardNativePanelShortcut(event,{...input,type:'keyUp'},'darwin',a=>sent.push(a)),false);
  assert.equal(forwardNativePanelShortcut(event,{...input,key:'q',code:'KeyQ'},'darwin',a=>sent.push(a)),false);
  assert.deepEqual(sent,['files']);
  assert.equal(prevented,2);
});
