import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { keepBuildAwake } from '../scripts/build-awake.mjs';

test('其他系统不启动保持唤醒进程', async () => {
  const release = await keepBuildAwake({ platform: 'linux', spawnProcess() { throw new Error('不应执行'); } });
  release();
});

test('macOS 只阻止空闲睡眠，有效期绑定到构建进程；释放可重复调用', async () => {
  const child = new EventEmitter();
  let kills = 0, unrefs = 0;
  child.kill = () => { kills++; };
  child.unref = () => { unrefs++; };
  const release = await keepBuildAwake({ platform: 'darwin', pid: 12345,
    spawnProcess(executable, args, options) {
      assert.equal(executable, '/usr/bin/caffeinate');
      assert.deepEqual(args, ['-i', '-w', '12345']);
      assert.deepEqual(options, { stdio: 'ignore' });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  assert.equal(kills, 0);
  assert.equal(unrefs, 1);
  release(); release();
  assert.equal(kills, 1);
});

test('保持唤醒进程无法启动时明确失败，不静默继续打包', async () => {
  const child = new EventEmitter();
  let kills = 0;
  child.kill = () => { kills++; };
  const cause = Object.assign(new Error('missing tool'), { code: 'ENOENT' });
  await assert.rejects(keepBuildAwake({ platform: 'darwin', spawnProcess() {
    queueMicrotask(() => child.emit('error', cause));
    return child;
  } }), error => /无法在构建期间阻止自动睡眠/.test(error.message) && error.cause === cause);
  assert.equal(kills, 1);
});
