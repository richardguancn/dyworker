import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bundledCuratedRoot, readCuratedPlugins } from '../electron/curated-plugins.mts';
import { createHost, disposeHost } from '../electron/host/context.mts';
import { dshNativeSkills } from '../electron/host/dsh-runtime/native-skills.mts';
import { Workspace } from '../electron/agent.mts';
import { skillContextSummary } from '../electron/skills.mts';

test('8 种内置插件的全部文件与锁定快照一致，不依赖原缓存目录', async () => {
  const root = bundledCuratedRoot();
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'snapshot.json'), 'utf8'));
  assert.equal(snapshot.plugins.length, 8);
  let count = 0;
  for (const plugin of snapshot.plugins) {
    for (const [file, hash] of Object.entries(plugin.files)) {
      const bytes = await fs.readFile(path.join(root, plugin.id, plugin.version, file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `${plugin.id}/${file}`);
      count++;
    }
  }
  assert.ok(count > 2000);
  const plugins = await readCuratedPlugins();
  assert.equal(plugins.flatMap(plugin => plugin.skills).length, 118);
  assert.equal(plugins.filter(plugin => plugin.local).length, 8);
  const skills = plugins.flatMap(plugin => plugin.skills);
  assert.equal(new Set(skills.map(skill => skill.id)).size, 118);
  assert.equal(new Set(skills.map(skill => skill.name)).size, 118);
  assert.equal(skills.filter(skill => skill.name.endsWith(':company-tearsheet')).length, 2);
});

test('内置插件启停、技能单独停用和并发保存都能在重启后保留', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-curated-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // 旧版被禁用的服务插件可能留下启用覆盖；移除后不能被这些设置恢复。
  await fs.writeFile(path.join(dir, 'curated-plugin-overrides.json'), JSON.stringify({ sites: true, slack: true, 'work-pets': true }));
  await fs.writeFile(path.join(dir, 'skill-overrides.json'), JSON.stringify({ 'builtin-plugin:sites:sites': true }));
  let host = await createHost({ userDataDir: dir });
  try {
    const list = await host.skills.listCurated();
    assert.equal(list.length, 8);
    assert.equal(list.filter(plugin => plugin.enabled).length, 0);
    assert.ok((await host.skills.read()).filter(skill => skill.pluginId).every(skill => !skill.enabled));
    const disabledSkill = (await host.skills.read()).find(skill => skill.name === 'data-analytics:index');
    assert.equal((await host.skills.setEnabled({ id: disabledSkill.id, enabled: true })).ok, false);
    for (const plugin of list) assert.equal((await host.skills.setCuratedEnabled(plugin.id, true)).ok, true);
    for (const id of ['plugin-creator', 'plugin-management']) {
      assert.equal((await host.skills.setCuratedEnabled(id, false)).ok, true);
      assert.ok((await host.skills.read()).filter(skill => skill.pluginId === id).every(skill => !skill.enabled));
    }
    const skill = (await host.skills.read()).find(skill => skill.name === 'data-analytics:index');
    assert.ok(skill.enabled);
    await host.skills.setEnabled({ id: skill.id, enabled: false });
    await Promise.all([host.skills.setCuratedEnabled('data-analytics', false), host.skills.setCuratedEnabled('sales', false)]);
    assert.ok((await host.skills.read()).filter(skill => ['sales', 'data-analytics'].includes(skill.pluginId)).every(skill => !skill.enabled));
    assert.equal((await host.skills.setEnabled({ id: skill.id, enabled: true })).ok, false);
    assert.equal((await host.skills.setCuratedEnabled('slack', true)).ok, false);
    assert.equal((await host.skills.setCuratedEnabled('../unknown', true)).ok, false);
    for (const id of ['sites', 'slack', 'work-pets']) {
      assert.ok(!(await host.skills.read()).some(skill => skill.pluginId === id));
      assert.equal((await host.skills.setCuratedEnabled(id, true)).ok, false);
    }
    assert.equal((await host.skills.setEnabled({ id: 'builtin-plugin:sites:sites', enabled: true })).ok, false);
    await disposeHost(host);
    host = await createHost({ userDataDir: dir });
    assert.ok((await host.skills.listCurated()).filter(plugin => ['sales', 'data-analytics'].includes(plugin.id)).every(plugin => !plugin.enabled));
    assert.equal((await host.skills.listCurated()).find(plugin => plugin.id === 'openai-templates').enabled, true);
    for (const id of ['plugin-creator', 'plugin-management']) {
      assert.equal((await host.skills.listCurated()).find(plugin => plugin.id === id).enabled, false);
      assert.equal((await host.skills.setCuratedEnabled(id, true)).ok, true);
      assert.ok((await host.skills.read()).filter(skill => skill.pluginId === id).every(skill => skill.enabled));
    }
    await host.skills.setCuratedEnabled('data-analytics', true);
    const restored = await host.skills.read();
    assert.equal(restored.find(item => item.id === skill.id).enabled, false);
    assert.equal(restored.find(item => item.name === 'data-analytics:build-report').enabled, true);
    assert.ok(!restored.some(item => ['sites', 'slack', 'work-pets'].includes(item.pluginId)));
  } finally { await disposeHost(host); }
});

test('自动任务可以发现每个插件入口并加载完整要求及实际资料路径', async () => {
  const plugins = await readCuratedPlugins();
  const skills = plugins.flatMap(plugin => plugin.skills);
  const summary = skillContextSummary(skills);
  for (const plugin of plugins.filter(plugin => plugin.local)) assert.ok(summary.includes(`builtin-plugin:${plugin.id}:`));
  assert.match(summary, /list_skills/);
  const native = dshNativeSkills(skills);
  const selected = skills.find(skill => skill.name === 'openai-templates:artifact-template-business-review');
  const loaded = await native.execute('load_skill', { skill_id: selected.id });
  assert.ok(loaded.includes(path.dirname(selected.path)));
  assert.match(loaded, /artifact-template.json/);
  assert.match(loaded, /不存在/);
  await assert.rejects(native.execute('load_skill', { skill_id: 'builtin-plugin:sites:sites' }), /没有找到模板/);
});

test('制作和管理插件加载本地要求，不再引导连接账号服务', async () => {
  const plugins = await readCuratedPlugins();
  const native = dshNativeSkills(plugins.flatMap(plugin => plugin.skills));
  for (const id of ['plugin-creator', 'plugin-management']) {
    const plugin = plugins.find(plugin => plugin.id === id);
    assert.equal(plugin.local, true);
    assert.deepEqual(plugin.connections, []);
    assert.match(plugin.summary, /DYWorker/);
    for (const skill of plugin.skills) {
      const loaded = await native.execute('load_skill', { skill_id: skill.id });
      assert.match(loaded, /DYWorker 本地/);
      assert.doesNotMatch(loaded, /Sites MCP|search_plugins|suggest_plugins|create_plugin|uninstall_app/);
    }
  }
  const create = await native.execute('load_skill', { skill_id: 'builtin-plugin:plugin-creator:create-plugin' });
  assert.match(create, /ctx\.tools\.register/);
  assert.match(create, /实际调用所注册工具/);
  const manage = await native.execute('load_skill', { skill_id: 'builtin-plugin:plugin-management:plugin-management' });
  assert.match(manage, /DSH 插件 → 已安装/);
  assert.match(manage, /没有真实操作或未读回状态时/);
});

test('旧快照中的已移除插件也不会重新暴露', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-curated-old-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'snapshot.json'), JSON.stringify({ schema: 1,
    plugins: ['sites', 'slack', 'work-pets'].map(id => ({ id, version: 'old', files: {} })) }));
  assert.deepEqual(await readCuratedPlugins(root), []);
});

test('重新导入缓存时排除三个已移除插件，保留其他插件的原始文件', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-curated-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile('scripts/import-curated-plugins.mjs', path.join(root, 'scripts/import-curated-plugins.mjs'));
  await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir');
  const source = path.join(root, 'cache');
  for (const id of ['sites', 'slack', 'work-pets', 'plugin-creator']) {
    const directory = path.join(source, id, '1.0.0', '.codex-plugin');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'plugin.json'), JSON.stringify({ name: id, version: '1.0.0' }));
  }
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/import-curated-plugins.mjs'), source], { encoding: 'utf8' });
  assert.match(output, /已导入 1 种插件/);
  const destination = path.join(root, 'builtin-plugins/curated');
  const snapshot = JSON.parse(await fs.readFile(path.join(destination, 'snapshot.json'), 'utf8'));
  assert.deepEqual(snapshot.plugins.map(plugin => plugin.id), ['plugin-creator']);
  const original = await fs.readFile(path.join(source, 'plugin-creator/1.0.0/.codex-plugin/plugin.json'));
  assert.deepEqual(await fs.readFile(path.join(destination, 'plugin-creator/1.0.0/.codex-plugin/plugin.json')), original);
  for (const id of ['sites', 'slack', 'work-pets']) await assert.rejects(fs.stat(path.join(destination, id)), { code: 'ENOENT' });
});

test('内置资料只读访问免重复授权，写入和相邻目录仍需授权', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-curated-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root, { trustTempDirs: false });
  const file = path.join(bundledCuratedRoot(), 'openai-templates/0.1.1/skills/artifact-template-business-review/artifact-template.json');
  assert.equal(workspace.isOutside(file), false);
  assert.equal(workspace.isOutside(file, { forWrite: true }), true);
  assert.match(await workspace.readFile(file), /reference.pptx/);
  await assert.rejects(workspace.writeFile(file, 'overwrite'), /必须先获得用户授权/);
  assert.equal(workspace.isOutside(path.join(path.dirname(bundledCuratedRoot()), 'curated-other', 'private.txt')), true);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-curated-private-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'private.txt'), 'private');
  const link = path.join(root, 'private-link');
  await fs.symlink(path.join(outside, 'private.txt'), link);
  assert.equal(workspace.isOutside(link), true);
});

test('20 套办公模板均保留原文件和预览，数据分析脚本可以直接运行', async () => {
  const root = bundledCuratedRoot();
  const templates = (await readCuratedPlugins()).find(plugin => plugin.id === 'openai-templates');
  for (const skill of templates.skills) {
    const directory = path.dirname(skill.path);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'artifact-template.json'), 'utf8'));
    const reference = await fs.readFile(path.join(directory, manifest.reference));
    assert.ok(reference.length > 100);
    if (manifest.preview) assert.ok((await fs.stat(path.join(directory, manifest.preview))).size > 100);
  }
  const script = path.join(root, 'data-analytics/1.0.11/skills/visualize-data/scripts/render-inline-chart.mjs');
  const output = execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.match(output, /--input/);
});
