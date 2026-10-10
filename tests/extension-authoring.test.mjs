import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { authoringSkills, pluginStarterManifest, pluginStarterSource } from '../electron/authoring-skills.ts';
import { SkillsService } from '../electron/host/services/skills.mts';
import { dshNativeSkills } from '../electron/host/dsh-runtime/native-skills.mts';
import { isVisibleInstalledPlugin } from '../src/pluginCatalog.ts';
import { createHost, disposeHost } from '../electron/host/context.mts';

async function sandbox(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-authoring-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('老用户升级后获得两个制作技能，已有修改、停用和删除保持不变', async t => {
  const root = await sandbox(t);
  const custom = { id: 'existing', name: '已有工作', instructions: '保留我的内容', enabled: true };
  await fs.writeFile(path.join(root, 'skills.json'), JSON.stringify([custom]));
  const ctx = new Context();
  ctx.plugin(SkillsService, { dir: root, homeDir: root });
  await ctx.fiber.await();
  t.after(() => ctx.fiber.dispose());
  const initial = await ctx.skills.read();
  for (const creator of authoringSkills) {
    assert.equal(initial.filter(row => row.id === creator.id).length, 1);
    assert.equal(initial.find(row => row.id === creator.id).builtIn, true);
  }
  assert.equal(initial.find(row => row.id === custom.id).instructions, custom.instructions);
  const skill = authoringSkills[0];
  await ctx.skills.update({ id: skill.id, instructions: '用户修改后的制作要求' });
  await ctx.skills.setEnabled({ id: skill.id, enabled: false });
  await ctx.skills.remove(authoringSkills[1].id);
  const next = await ctx.skills.read();
  assert.equal(next.find(row => row.id === skill.id).instructions, '用户修改后的制作要求');
  assert.equal(next.find(row => row.id === skill.id).enabled, false);
  assert.ok(!next.some(row => row.id === authoringSkills[1].id));
});

test('制作技能加载后能保存、重新列出和读回新技能，重启服务后保留', async t => {
  const root = await sandbox(t);
  const ctx = new Context();
  ctx.plugin(SkillsService, { dir: root, homeDir: root });
  await ctx.fiber.await();
  const events = [];
  const runtime = dshNativeSkills(await ctx.skills.read(), {
    read: () => ctx.skills.read(), append: item => ctx.skills.append(item), emit: event => events.push(event),
  });
  const guide = await runtime.execute('load_skill', { skill_id: 'builtin-skill-creator' });
  assert.match(guide, /save_skill/);
  await assert.rejects(runtime.execute('save_skill', { name: '空技能', instructions: '  ' }), /不能为空/);
  await runtime.execute('save_skill', { name: '制作验收周报', description: '按工作记录整理周报', instructions: '读取工作记录，分为完成事项和下周计划；缺少记录时指出缺项。' });
  const record = events.find(event => event.type === 'skill-saved' && event.persisted)?.item;
  assert.ok(record?.id);
  assert.match(await runtime.execute('list_skills', {}), /制作验收周报/);
  assert.match(await runtime.execute('load_skill', { skill_id: record.id }), /缺少记录时指出缺项/);
  await ctx.fiber.dispose();
  const restarted = new Context();
  restarted.plugin(SkillsService, { dir: root, homeDir: root });
  await restarted.fiber.await();
  t.after(() => restarted.fiber.dispose());
  assert.equal((await restarted.skills.read()).find(row => row.id === record.id).instructions, record.instructions);
});

test('指南中的插件样例真实导入、注册并执行工具，异常参数明确失败', async t => {
  const root = await sandbox(t);
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.symlink(path.resolve('node_modules/@deepseek-ai'), path.join(root, 'node_modules/@deepseek-ai'), 'dir');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pluginStarterManifest));
  await fs.writeFile(path.join(root, 'index.js'), pluginStarterSource);
  const plugin = await import(pathToFileURL(path.join(root, 'index.js')).href);
  const registered = [];
  plugin.apply({ tools: { register: tool => registered.push(tool) } });
  assert.equal(registered.length, 1);
  const tool = registered[0];
  assert.deepEqual(tool.parameters.required, ['text']);
  assert.deepEqual(await tool.execute({ text: '  第一项\n\n 第二项  ' }), { text: '第一项 第二项' });
  assert.deepEqual(await tool.execute({ text: '' }), { text: '' });
  await assert.rejects(tool.execute({}), /missing required property.*text/);
  assert.deepEqual(tool.output.render({}, { text: '结果' }), [{ type: 'text', text: '结果' }]);
});

test('默认制作对话等待技能落盘，同轮列出、更新和读回新技能；写入失败不冒充成功', async t => {
  const root = await sandbox(t);
  let host;
  let duplicateAppends = 0;
  const events = [];
  const resolvers = {
    isShuttingDown: () => false, agentExtraTools: value => value, mcpExtraTools: async () => [],
    createExtraToolRouter: () => Object.assign(() => {}, { dispose: async () => {} }),
    readHooks: async () => [], readStandingRules: async () => [], readMemoryPages: async () => [],
    readSkills: () => host.skills.read(root), history: () => ({}), auditRecord: () => {},
    memoriesFromAgentResult: () => [], appendUsageStat: () => {}, hasPendingWakeForSession: () => false,
    appendSkill: () => { duplicateAppends++; },
  };
  host = await createHost({ userDataDir: root, homeDir: root, agentResolvers: resolvers });
  t.after(() => disposeHost(host));
  let turn = 0, id;
  const reply = message => new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
  const call = (name, args) => reply({ role: 'assistant', content: null, tool_calls: [{ id: `create-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const result = await host.agent.run({ sessionId: 'default-authoring', settings: { model: 'mock', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'mock' },
    workspacePath: root, prompt: '制作并检查周报技能', conversation: [{ role: 'user', content: '制作并检查周报技能' }], approvalMode: 'full-access',
    emit: event => events.push(event), fetchImpl: async (_url, options) => {
      const messages = JSON.parse(options.body).messages;
      switch (turn++) {
        case 0: return call('save_skill', { name: '同轮周报', description: '整理工作记录', instructions: '保留事实；缺失时指出缺项。' });
        case 1: {
          id = (await host.skills.readStored()).find(row => row.name === '同轮周报')?.id;
          assert.ok(id); assert.match(JSON.stringify(messages), new RegExp(id));
          return call('list_skills', {});
        }
        case 2: assert.match(JSON.stringify(messages.at(-1)), /同轮周报/); return call('update_skill', { skill_id: id, instructions: '保留事实；缺失时指出缺项；核对完成事项。' });
        case 3: assert.match((await host.skills.readStored()).find(row => row.id === id).instructions, /核对完成事项/); return call('load_skill', { skill_id: id });
        default: assert.match(JSON.stringify(messages.at(-1)), /核对完成事项/); return reply({ role: 'assistant', content: '保存、更新和读回均已检查' });
      }
    } });
  assert.equal(result.status, 'done'); assert.equal(duplicateAppends, 0);
  assert.equal(events.filter(event => event.type === 'skill-saved' && event.persisted).length, 1);
  assert.equal(events.filter(event => event.type === 'skill-updated' && event.persisted).length, 1);
  host.skills.append = async () => { throw new Error('模拟保存失败'); };
  turn = 0;
  const failure = await host.agent.run({ sessionId: 'failed-authoring', settings: { model: 'mock', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'mock' },
    workspacePath: root, prompt: '检查失败', conversation: [{ role: 'user', content: '检查失败' }], approvalMode: 'full-access', emit: event => events.push(event),
    fetchImpl: async (_url, options) => {
      if (turn++ === 0) return call('save_skill', { name: '失败技能', description: '失败样例', instructions: '不得假报保存' });
      const last = JSON.parse(options.body).messages.at(-1);
      assert.match(last.content, /模拟保存失败/); assert.doesNotMatch(last.content, /已保存/);
      return reply({ role: 'assistant', content: '保存失败' });
    } });
  assert.equal(failure.status, 'done');
  assert.ok(!(await host.skills.readStored()).some(row => row.name === '失败技能'));
  assert.equal(events.filter(event => event.type === 'skill-saved' && event.persisted).length, 1);
});

test('制作出的本地插件通过实际宿主安装后可管理，推荐清单与旧上下文限制保持原样', async t => {
  const root = await sandbox(t);
  const pluginDir = path.join(root, 'source');
  await fs.mkdir(pluginDir);
  await fs.writeFile(path.join(pluginDir, 'package.json'), JSON.stringify(pluginStarterManifest));
  await fs.writeFile(path.join(pluginDir, 'index.js'), pluginStarterSource);
  await fs.mkdir(path.join(pluginDir, 'node_modules'), { recursive: true });
  await fs.symlink(path.resolve('node_modules/@deepseek-ai'), path.join(pluginDir, 'node_modules/@deepseek-ai'), 'dir');
  const host = await createHost({ userDataDir: path.join(root, 'data'), homeDir: root, mountPlugins: true });
  t.after(() => disposeHost(host));
  // 下载替身只将本地目录放入暂存目录，其余安装、兼容性与执行走真实宿主。
  const run = async (_command, args, options) => {
    assert.ok(args.includes(pluginDir));
    assert.ok(args.includes('--install-links'));
    const target = path.join(options.cwd, 'node_modules', pluginStarterManifest.name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(pluginDir, target, { recursive: true });
    const file = path.join(options.cwd, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    manifest.dependencies = { ...manifest.dependencies, [pluginStarterManifest.name]: `file:${pluginDir}` };
    await fs.writeFile(file, JSON.stringify(manifest));
    return { code: 0, stdout: '', stderr: '' };
  };
  const result = await host.plugins.installPackage({ input: pluginDir, run });
  assert.equal(result.ok, true, result.error);
  const entry = host.plugins.entries().find(row => row.name === pluginStarterManifest.name);
  const bundle = host.plugins.bundles_().find(row => row.name === pluginStarterManifest.name);
  assert.ok(entry);
  assert.equal(isVisibleInstalledPlugin(entry, bundle, []), true, JSON.stringify({ entry, bundle, source: result.source }));
  assert.equal(isVisibleInstalledPlugin({ ...entry, name: 'unknown-npm' }, undefined, []), false);
  assert.equal(isVisibleInstalledPlugin({ ...entry, name: 'dsh-context' }, bundle, []), false);
  assert.equal(isVisibleInstalledPlugin({ ...entry, name: 'dyworker-context', builtin: true }, undefined, []), true);
  const invoke = () => host.tools.execute('plugin__dyworker_text_helper__text_helper_clean', { text: '  实际\n 调用  ' }, { sessionId: 'authoring-test', runId: 'verify', workspacePath: root, source: 'agent' });
  const output = await invoke();
  assert.equal(output.ok, true, output.error);
  assert.match(JSON.stringify(output), /实际 调用/);
  assert.equal((await host.plugins.setEnabled(entry.id, false)).ok, true);
  assert.equal((await host.plugins.setEnabled(entry.id, true)).ok, true);
  assert.equal((await invoke()).ok, true);
  assert.equal((await host.plugins.install({ spec: pluginStarterManifest.name })).ok, true);
  assert.equal(host.plugins.bundles_().find(row => row.name === entry.name).source.kind, 'local');
  const stored = JSON.parse(await fs.readFile(host.plugins.bundlesFile(), 'utf8'));
  assert.match(JSON.stringify(stored), /"kind":"local"/);
});
