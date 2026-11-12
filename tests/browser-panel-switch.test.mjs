import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBrowserPanelSwitch } from '../src/state/browserPanelSwitch.ts';

test('切换等待验证期间更换会话时，不切换当前页面', async () => {
  let owner = 'one', finish, activated = '';
  const switching = applyBrowserPanelSwitch({ token: 'token', ownerSessionId: 'one', tabId: 'two' }, () => owner,
    () => new Promise(resolve => { finish = resolve; }), tab => { activated = tab; });
  owner = 'other';
  finish(true);
  assert.equal(await switching, false);
  assert.equal(activated, '');
});

test('无效或无法确认的切换请求不会改变页面', async () => {
  for (const validate of [async () => false, async () => { throw new Error('不可用'); }]) {
    let activated = false;
    assert.equal(await applyBrowserPanelSwitch({ token: 'token', ownerSessionId: 'one', tabId: 'two' }, () => 'one', validate, () => { activated = true; }), false);
    assert.equal(activated, false);
  }
});
