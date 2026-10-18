import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classifyRunnerFailure, matchesSignature } from '@deepseek-ai/dsh-sandbox';
import { requireCommandProtection, createCommandDiagnostics } from '../electron/command-protection.mts';

const full = () => ({ argv: [process.execPath, '-e', ''], enforcement: 'full',
  denialSignatures: ['access is denied', 'permission denied'],
  runnerFailureRules: [{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run:'], informationalLines: ['windows-acl-run: informational'] }] });

test('不完整、未知或缺失的保护均拒绝，完全访问只能来自本次明确授权', () => {
  for (const enforcement of ['partial', undefined, 'unknown', 'explicit-host-grant']) {
    assert.throws(() => requireCommandProtection({ ...full(), enforcement }), { code: 'SANDBOX_UNAVAILABLE' });
  }
  for (const value of [null, { ...full(), argv: [] }, { ...full(), denialSignatures: undefined },
    { ...full(), runnerFailureRules: [{}] }, { ...full(), runnerFailureRules: [{ fatalSignatures: [''] }] }]) {
    assert.throws(() => requireCommandProtection(value), { code: 'SANDBOX_UNAVAILABLE' });
  }
  assert.equal(requireCommandProtection(full()).enforcement, 'full');
  assert.equal(requireCommandProtection(full(), 'read-only').enforcement, 'full');
  assert.equal(requireCommandProtection({ argv: ['host'], enforcement: 'explicit-host-grant' }, 'danger-full-access').enforcement, 'explicit-host-grant');
  assert.throws(() => requireCommandProtection(full(), 'unknown'), { code: 'SANDBOX_UNAVAILABLE' });
  const windows = { ...full(), enforcement: 'partial', runnerFailureRules: [
    { allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] },
  ] };
  assert.throws(() => requireCommandProtection(windows), { code: 'SANDBOX_UNAVAILABLE' });
  assert.equal(requireCommandProtection(windows, 'workspace-write', 'windows-acl').enforcement, 'partial');
  assert.throws(() => requireCommandProtection({ ...windows, runnerFailureRules: [] }, 'workspace-write', 'windows-acl'), { code: 'SANDBOX_UNAVAILABLE' });
});

const cases = [
  [127, 'windows-acl-run: token failed\n', 'unavailable'],
  [1, 'windows-acl-run: token failed\n', 'ready'],
  [0, 'windows-acl-run: cleanup failed\n', 'ready'],
  [null, 'windows-acl-run: token failed\n', 'ready'],
  [127, 'WINDOWS-ACL-RUN: INFORMATIONAL\r\n', 'ready'],
  [127, 'windows-acl-run: informational extra\r\n', 'unavailable'],
  [1, 'Error: ACCESS IS DENIED\n', 'denied'],
  [0, 'permission denied\n', 'ready'],
  [127, 'windows-acl-run: permission denied\n', 'unavailable'],
  [127, 'ordinary command error\n', 'ready'],
];
for (const [code, stderr, expected] of cases) {
  test(`结果检查遵守后端约定：${String(code)} ${JSON.stringify(stderr)}`, () => {
    const plan = full();
    const reference = classifyRunnerFailure(code, stderr, plan.runnerFailureRules) ? 'unavailable'
      : matchesSignature(code, stderr, plan.denialSignatures) ? 'denied' : 'ready';
    assert.equal(reference, expected);
    // 逐字节送入：覆盖 CRLF、大小写、签名跨片段，不只检查一次性完整输出。
    const diagnostics = createCommandDiagnostics(plan);
    for (const byte of Buffer.from(stderr)) diagnostics.write(Buffer.from([byte]));
    assert.equal(diagnostics.finish(code).state, expected);
  });
}

test('输出超过显示上限、签名在超长行中或日志末尾时仍保留故障依据', () => {
  for (const stderr of ['windows-acl-run: token failed\n' + 'x'.repeat(200000),
    'x'.repeat(200000) + 'windows-acl-run: token failed',
    'windows-acl-run: token failed' + 'x'.repeat(200000)]) {
    const diagnostics = createCommandDiagnostics(full());
    for (let i = 0; i < stderr.length; i += 37) diagnostics.write(Buffer.from(stderr.slice(i, i + 37)));
    assert.equal(diagnostics.finish(127).state, 'unavailable');
  }
});

test('无退出码门槛及多条规则遵守相同约定，普通提示不能掩盖后续故障', () => {
  const plan = { ...full(), runnerFailureRules: [
    { allowedExitCodes: [125], fatalSignatures: ['landlock-run:'], informationalLines: ['landlock-run: partial enforcement'] },
    { fatalSignatures: ['sandbox-exec:'] },
  ] };
  for (const [code, stderr, expected] of [[125, 'landlock-run: partial enforcement\r\n', 'ready'],
    [125, 'landlock-run: partial enforcement\r\nlandlock-run: fatal', 'unavailable'],
    [71, 'sandbox-exec: sandbox_apply: Operation not permitted', 'unavailable'],
    [0, 'sandbox-exec: harmless printed text', 'ready']]) {
    const diagnostics = createCommandDiagnostics(plan);
    for (const byte of Buffer.from(stderr)) diagnostics.write(Buffer.from([byte]));
    assert.equal(diagnostics.finish(code).state, expected);
  }
});

test('实际前台和后台入口：partial 不启动程序，故障与拒绝被保留，正常退出仍成功', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-protection-')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const runner = path.join(root, 'check.mjs');
  const providerSource = `
    import { Service } from '@deepseek-ai/cordis';
    export default class extends Service {
      constructor(ctx) { super(ctx, 'sandbox'); }
      confine() { return JSON.parse(process.env.DYW_TEST_CONFINED); }
    }`;
  // 仅在独立测试进程替换第三方提供者；应用的准备、启动与结果收集均运行真实代码。
  // 不依赖本机内核提供 Windows ACL，也不把这组模拟元信息检查当作真实 Windows 验收。
  await fs.writeFile(runner, `
    import { registerHooks } from 'node:module';
    import fs from 'node:fs/promises';
    import assert from 'node:assert/strict';
    import path from 'node:path';
    const root = ${JSON.stringify(root)};
    const plan = ${JSON.stringify(full())};
    const marker = path.join(root, 'started.txt');
    registerHooks({ load(url, context, next) {
      if (url.includes('/dsh-sandbox-local/lib/index.js')) return { format: 'module', shortCircuit: true, source: ${JSON.stringify(providerSource)} };
      return next(url, context);
    } });
    const { Workspace } = await import(${JSON.stringify(pathToFileURL(path.resolve('electron/agent.mts')).href)});
    const { createBackgroundTasksManager } = await import(${JSON.stringify(pathToFileURL(path.resolve('electron/background-tasks.mts')).href)});
    const { prepareCommandExecution } = await import(${JSON.stringify(pathToFileURL(path.resolve('electron/command-execution.mts')).href)});
    const originalPlatform = process.platform;
    // 未识别的 partial 仍然拒绝；只有准备层识别出的官方 Windows runner 才有单独策略。
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.DYW_TEST_CONFINED = JSON.stringify({ ...plan, enforcement: 'partial', argv: [process.execPath, 'unknown-runner'] });
    for (const mode of ['read-only', 'workspace-write']) {
      await assert.rejects(prepareCommandExecution('unused', { workspacePath: root, mode }), { code: 'SANDBOX_UNAVAILABLE' });
    }
    const host = await prepareCommandExecution('unused', { workspacePath: root, mode: 'danger-full-access' });
    assert.equal(host.enforcement, 'explicit-host-grant');
    assert.equal(host.argv[0], process.execPath);
    assert.ok(host.argv[1].endsWith('windows_command_runner.cjs'));
    assert.equal(Buffer.from(host.argv[2], 'base64').toString(), 'unused');
    assert.equal(host.env.ELECTRON_RUN_AS_NODE, '1');
    // 在宿主系统测试完整的调用链；在 Windows CI 中也走相同的模拟提供者分支。
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const workspace = new Workspace(root);
    const manager = createBackgroundTasksManager();
    try {
      const configure = (enforcement, body) => {
        process.env.DYW_TEST_CONFINED = JSON.stringify({ ...plan, enforcement, argv: [process.execPath, '-e', body] });
      };
      configure('partial', "require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'started')");
      assert.equal((await workspace.runCommand('unused')).errorCode, 'SANDBOX_UNAVAILABLE');
      await assert.rejects(manager.startTask({ command: 'unused', cwd: root }), { code: 'SANDBOX_UNAVAILABLE' });
      await assert.rejects(fs.access(marker), { code: 'ENOENT' });
      assert.equal(manager.listTasks().length, 0);
      for (const [code, stderr, state] of ${JSON.stringify(cases.filter(([code]) => code !== null))}) {
        configure('full', 'process.stderr.write(' + JSON.stringify(stderr) + '); process.exitCode=' + code);
        const result = await workspace.runCommand('unused');
        assert.equal(result.ok, code === 0);
        assert.equal(result.protection.state, state, JSON.stringify(result));
        const task = await manager.startTask({ command: 'unused', cwd: root });
        const deadline = Date.now() + 5000;
        let ended;
        do {
          await new Promise(resolve => setTimeout(resolve, 10));
          ended = manager.listTasks().find(item => item.id === task.id);
        } while (!ended.endTime && Date.now() < deadline);
        assert.ok(ended.endTime, '后台进程必须实际结束');
        assert.equal(ended.protection.state, state, JSON.stringify(ended));
        assert.equal(ended.status, code === 0 ? 'stopped' : 'error');
      }
      configure('full', "require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'normal')");
      assert.equal((await workspace.runCommand('unused')).ok, true);
      assert.equal(await fs.readFile(marker, 'utf8'), 'normal');
      console.log('PROTECTION_ENTRYPOINTS_OK');
    } finally {
      manager.cleanupAll();
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  `);
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /PROTECTION_ENTRYPOINTS_OK/);
});

for (const scenario of ['passthrough-leak', 'runner-unavailable']) {
  test(`Windows 诊断程序的本地模拟：${scenario} 如实报告并清理夹具`, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-diagnostic-')));
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
    const fixture = path.join(root, 'diagnostic-fixture.mjs');
    const provider = `
      import { Service } from '@deepseek-ai/cordis';
      export default class extends Service {
        constructor(ctx) { super(ctx, 'sandbox'); }
        confine(argv) { return { argv: ${scenario === 'passthrough-leak' ? 'argv' : JSON.stringify([process.execPath, '-e', 'process.stderr.write("windows-acl-run: token failed"); process.exitCode=127'])},
          enforcement: 'partial', denialSignatures: ['permission denied'],
          runnerFailureRules: [{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run:'] }] }; }
      }`;
    await fs.writeFile(fixture, `
      import { registerHooks, createRequire, syncBuiltinESMExports } from 'node:module';
      const require = createRequire(import.meta.url);
      const childProcess = require('node:child_process');
      const originalSpawn = childProcess.spawnSync;
      childProcess.spawnSync = (command, ...args) => command === 'icacls.exe' || command === 'whoami.exe'
        ? { status: 0, signal: null, stdout: command === 'whoami.exe' ? 'S-1-5-21-12345' : 'SIMULATED_ACL_METADATA', stderr: '' }
        : originalSpawn(command, ...args);
      syncBuiltinESMExports();
      registerHooks({ load(url, context, next) {
        if (url.includes('/dsh-sandbox-local/lib/index.js')) return { format: 'module', shortCircuit: true, source: ${JSON.stringify(provider)} };
        return next(url, context);
      } });
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/diagnose-windows-command-protection.mjs')).href)});
    `);
    const result = spawnSync(process.execPath, [fixture, '--compare-launchers'], { cwd: root, encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024 });
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, scenario === 'passthrough-leak' ? 1 : 2, result.stderr + result.stdout);
    assert.equal(report.conclusion, scenario === 'passthrough-leak' ? 'outside-or-read-only-write-observed' : 'probe-inconclusive');
    assert.equal(report.observations.filter(item => item.results).length, 12);
    assert.equal(report.cleanupError, undefined);
    assert.deepEqual(await fs.readdir(root), ['diagnostic-fixture.mjs']);
  });
}
