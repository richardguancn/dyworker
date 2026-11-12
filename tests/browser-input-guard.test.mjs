import test from 'node:test';
import assert from 'node:assert/strict';
import { browserInputGuard } from '../electron/desktop/browser-input-guard.mts';

test('仅拦截受控页面的按下事件，结束操作期间重复按键也不能穿透', () => {
  for (const status of ['human_control', 'paused', 'stopped']) {
    for (const inputReleaseState of ['pending', 'failed']) {
      const state = { status, inputReleaseState };
      assert.deepEqual(browserInputGuard(state, 1, 1, { type: 'keyDown', isAutoRepeat: true }), { prevent: true, takeover: false });
      assert.equal(browserInputGuard(state, 1, 1, { type: 'keyUp' }).prevent, false);
      assert.equal(browserInputGuard(state, 1, 2, { type: 'keyDown' }).prevent, false);
    }
  }
  assert.deepEqual(browserInputGuard({ status: 'running' }, 1, 1, { type: 'keyDown', isAutoRepeat: true }), { prevent: true, takeover: true });
  assert.equal(browserInputGuard({ status: 'human_control', inputReleaseState: 'ready' }, 1, 1, { type: 'keyDown' }).prevent, false);
});
