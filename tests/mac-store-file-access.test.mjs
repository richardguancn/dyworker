import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacStoreFileAccess } from '../electron/mac-store-file-access.mts';

test('选择工作区后保存授权，重启可恢复，退出时释放', async () => {
  let stored = {};
  const opened = [], closed = [];
  const options = {
    enabled: true,
    load: async () => stored,
    save: async value => { stored = value; },
    startAccess: value => { opened.push(value); return () => closed.push(value); },
  };
  const first = createMacStoreFileAccess(options);
  await first.restore();
  await first.remember('/example/workspace', 'bookmark-1');
  await first.dispose();
  const restarted = createMacStoreFileAccess(options);
  assert.deepEqual(await restarted.restore(), []);
  assert.deepEqual(opened, ['bookmark-1', 'bookmark-1']);
  await restarted.dispose();
  await restarted.dispose();
  assert.deepEqual(closed, ['bookmark-1', 'bookmark-1']);
});

test('重新授权写入失败时释放新授权并保留原授权，后续仍可重试', async () => {
  const closed = [];
  let fail = false;
  const store = createMacStoreFileAccess({
    enabled: true, load: async () => ({}),
    save: async () => { if (fail) throw new Error('disk failure'); },
    startAccess: value => () => closed.push(value),
  });
  await store.remember('/example/workspace', 'original');
  fail = true;
  await assert.rejects(store.remember('/example/workspace', 'failed'), /disk failure/);
  assert.deepEqual(closed, ['failed']);
  fail = false;
  await store.remember('/example/workspace', 'replacement');
  assert.deepEqual(closed, ['failed', 'original']);
  await store.dispose();
  assert.deepEqual(closed, ['failed', 'original', 'replacement']);
});

test('失效授权不影响其他工作区，缺少新授权明确报错', async () => {
  const opened = [];
  const store = createMacStoreFileAccess({
    enabled: true,
    load: async () => ({ '/example/lost': 'invalid', '/example/ok': 'valid', '/example/bad': 12 }),
    save: async () => {},
    startAccess: value => { if (value === 'invalid') throw new Error('expired'); opened.push(value); return () => {}; },
  });
  assert.deepEqual(await store.restore(), ['/example/lost']);
  assert.deepEqual(opened, ['valid']);
  await assert.rejects(store.remember('/example/new'), /持续访问授权/);
  await store.dispose();
});

test('普通版不改变已有文件访问方式', async () => {
  const unexpected = () => { throw new Error('普通版不应调用商店授权'); };
  const store = createMacStoreFileAccess({ enabled: false, startAccess: unexpected, load: unexpected, save: unexpected });
  assert.deepEqual(await store.restore(), []);
  await store.remember('/example/workspace');
  await store.dispose();
});
