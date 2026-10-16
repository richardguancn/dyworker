import test from 'node:test';
import assert from 'node:assert/strict';

// 只提供初始化窗口宽度，不安装桌面桥接，也不读取用户数据。
const previousWindow = globalThis.window;
const stores = [];
try {
  globalThis.window = {innerWidth: 1280};
  for (const name of ['layout', 'browser', 'composer', 'session', 'settings', 'inbox', 'panel', 'view']) {
    const module = await import(`../src/state/${name}Store.ts`);
    stores.push([name, module[`use${name[0].toUpperCase()}${name.slice(1)}Store`]]);
  }
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}

for (const [name, store] of stores) {
  test(`${name}：重复写入相同值或返回原值，不通知页面`, () => {
    const before = store.getState();
    let updates = 0;
    const off = store.subscribe(() => { updates++; });
    try {
      for (const [setter, set] of Object.entries(before)) {
        if (!/^set[A-Z]/.test(setter)) continue;
        const field = setter[3].toLowerCase() + setter.slice(4);
        assert.ok(Object.hasOwn(before, field), `${setter} 应有对应字段`);
        set(before[field]);
        let calls = 0;
        set(previous => {
          calls++;
          assert.equal(previous, before[field]);
          return previous;
        });
        assert.equal(calls, 1, `${setter} 只执行一次更新函数`);
        assert.equal(updates, 0, `${setter} 的相同值不能通知页面`);
        assert.equal(store.getState(), before, `${setter} 保留原状态对象`);
      }
    } finally {
      off();
      store.setState(before, true);
    }
  });
}

const changes = {
  layout: ['sidebarOpen', value => !value],
  browser: ['browserOpening', value => !value],
  composer: ['composer', value => `${value}验收输入`],
  session: ['activeId', value => `${value}-acceptance`],
  settings: ['settings', value => ({...value, model: 'acceptance-model'})],
  inbox: ['inboxOpen', value => !value],
  panel: ['memories', value => [...value]],
  view: ['atBottom', value => !value],
};

for (const [name, store] of stores) {
  test(`${name}：实际变化及时通知，更新函数读取最新值，其他字段保留`, () => {
    const before = store.getState();
    const [field, change] = changes[name];
    const set = before[`set${field[0].toUpperCase()}${field.slice(1)}`];
    const first = change(before[field]);
    let updates = 0;
    const off = store.subscribe(() => { updates++; });
    try {
      set(first);
      assert.equal(updates, 1);
      assert.equal(store.getState()[field], first);
      set(first);
      assert.equal(updates, 1);
      let latest;
      set(previous => {
        latest = previous;
        return before[field];
      });
      assert.equal(latest, first);
      assert.equal(updates, 2);
      assert.deepEqual(store.getState(), before);
    } finally {
      off();
      store.setState(before, true);
    }
  });
}

test('连续滚动但贴底状态未变时不通知；离开底部和返回底部均及时通知', () => {
  const store = stores.find(([name]) => name === 'view')[1];
  const before = store.getState();
  const {setAtBottom} = before;
  let updates = 0;
  const off = store.subscribe(() => { updates++; });
  try {
    for (let index = 0; index < 20; index++) setAtBottom(before.atBottom);
    assert.equal(updates, 0);
    setAtBottom(!before.atBottom);
    assert.equal(updates, 1);
    for (let index = 0; index < 20; index++) setAtBottom(!before.atBottom);
    assert.equal(updates, 1);
    setAtBottom(before.atBottom);
    assert.equal(updates, 2);
  } finally {
    off();
    store.setState(before, true);
  }
});

test('数字同值判断保留 Object.is 语义：NaN 相同，正负零不同', () => {
  const store = stores.find(([name]) => name === 'layout')[1];
  const before = store.getState();
  let updates = 0;
  const off = store.subscribe(() => { updates++; });
  try {
    before.setViewportWidth(NaN);
    before.setViewportWidth(NaN);
    assert.equal(updates, 1);
    before.setViewportWidth(0);
    before.setViewportWidth(-0);
    assert.equal(updates, 3);
    assert.ok(Object.is(store.getState().viewportWidth, -0));
  } finally {
    off();
    store.setState(before, true);
  }
});
