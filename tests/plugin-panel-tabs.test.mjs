import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientPluginHost } from '../src/pluginRuntime/clientHost.ts';
import { availablePluginPanels, pluginPanelTab, PluginPanelPreferences } from '../src/pluginPanelTabs.ts';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const dashboard = pluginPanelTab('dyworker-context', 'context-dashboard', '上下文仪表盘');
const plugin = (key, label) => ({ name: key, inject: ['slots'], apply(ctx) {
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', id: key, key, label,
  }, () => null));
} });

test('真实宿主异步加载、刷新及重新登记不会撤销关闭选择；切任务和重启后仍保持关闭', async () => {
  const host = new ClientPluginHost();
  const saved = storage();
  let preferences = new PluginPanelPreferences(saved);
  let tabs = [{ id: 'files-1', kind: 'files', title: '打开文件', filePath: '真实文件' }];
  let notifications = 0;
  const available = () => availablePluginPanels(host.contributionsFor('sidebar.right.pane.tab'));
  const sync = () => { notifications++; tabs = preferences.reconcile(tabs, available()); };
  const off = host.subscribe(sync);
  try {
    assert.equal((await host.load(plugin('context-dashboard', dashboard.title), 'dyworker-context')).ok, true);
    sync();
    assert.equal(tabs.filter(tab => tab.id === dashboard.id).length, 1);
    preferences.close(dashboard);
    tabs = tabs.filter(tab => tab.id !== dashboard.id);
    const afterClose = notifications;
    for (let i = 0; i < 3; i++) await host.load(plugin(`extra-${i}`, `其它页面 ${i}`), `extra-${i}`);
    assert.ok(notifications > afterClose, '加载其它插件实际触发宿主通知');
    assert.equal(tabs.some(tab => tab.id === dashboard.id), false);
    assert.equal(tabs[0].filePath, '真实文件');
    await host.unload('dyworker-context');
    await host.load(plugin('context-dashboard', dashboard.title), 'dyworker-context');
    sync();
    assert.equal(tabs.some(tab => tab.id === dashboard.id), false);
    tabs = []; // 会话布局恢复为空，再同步登记的面板。
    sync();
    assert.equal(tabs.some(tab => tab.id === dashboard.id), false);
    preferences = new PluginPanelPreferences(saved); // 重启读取实际保存的关闭选择。
    tabs = [];
    sync();
    assert.equal(tabs.some(tab => tab.id === dashboard.id), false);
    assert.equal(preferences.open(dashboard, false), false, '被动登记也不能重新打开');
    assert.equal(preferences.open(dashboard), true, '用户主动打开可以撤销关闭');
    tabs.push(dashboard);
    sync(); sync();
    assert.equal(tabs.filter(tab => tab.id === dashboard.id).length, 1);
    preferences.close(dashboard);
    tabs = tabs.filter(tab => tab.id !== dashboard.id);
    sync();
    assert.equal(tabs.some(tab => tab.id === dashboard.id), false, '重新打开后仍只需关闭一次');
  } finally { off(); await host.dispose(); }
});

test('面板去重保留顺序与其它页面，不混淆不同插件的同名页面', () => {
  const preferences = new PluginPanelPreferences(storage());
  const other = pluginPanelTab('other', dashboard.pluginKey, '其它仪表盘');
  const file = { id: 'files', kind: 'files', title: '文件', filePath: '/tmp/example' };
  let tabs = preferences.reconcile([dashboard, file, dashboard], [dashboard, dashboard, other]);
  assert.deepEqual(tabs, [dashboard, file, other]);
  preferences.close(dashboard);
  tabs = preferences.reconcile(tabs, [dashboard, other]);
  assert.deepEqual(tabs, [file, other]);
  assert.deepEqual(preferences.reconcile(tabs, []), [file], '停用插件只移除该插件页面');
  const contributions = [
    { pluginId: 'a', meta: { key: 'page', label: () => '页面' } },
    { pluginId: 'a', meta: { key: 'page', label: '重复登记' } },
    { pluginId: 'b', meta: { key: 'page', label: '另一个插件' } },
    { meta: { key: ' ' } },
  ];
  assert.deepEqual(availablePluginPanels(contributions).map(tab => tab.title), ['页面', '另一个插件']);
});

test('偏好损坏或存储不可用不影响关闭与手动打开', () => {
  for (const saved of [null, '{}', 'bad json', '[null,3]']) {
    const preferences = new PluginPanelPreferences({ getItem: () => saved, setItem() { throw Error('不可用'); } });
    preferences.close(dashboard);
    assert.deepEqual(preferences.reconcile([], [dashboard]), []);
    assert.equal(preferences.open(dashboard), true);
    assert.deepEqual(preferences.reconcile([], [dashboard]), [dashboard]);
  }
});
