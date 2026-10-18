// 仅用于真实 Windows 诊断：直接调用官方后端，在自建夹具中观察实际写入。
// 不通过应用的临时停用门槛，也不把这个独立诊断入口暴露为助手工具。
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error('此诊断必须在真实 Windows 上运行；未创建目录或修改权限。');
  process.exitCode = 2;
} else {
  const report = { diagnosticOnly: true, platform: process.platform, node: process.version, observations: [] };
  const execute = (argv, cwd) => {
    const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 20000, maxBuffer: 256 * 1024,
      cwd, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    return { exitCode: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '',
      ...(result.error ? { error: result.error.message } : {}) };
  };
  let root, ctx;
  try {
    const { Context } = await import('@deepseek-ai/cordis');
    const { default: LocalSandbox } = await import('@deepseek-ai/dsh-sandbox-local');
    const { classifyRunnerFailure } = await import('@deepseek-ai/dsh-sandbox');
    root = await fs.realpath(await fs.mkdtemp(path.join(process.cwd(), '.dyw-windows-acl-probe-')));
    // CI checkout 目录只有 Administrators 写权限；LUA 令牌会去掉该组。
    // 给本次自建夹具的同一用户授予 Modify，确保下面测到的是限制侧而非普通用户侧拒绝。
    const identity = execute(['whoami.exe', '/user', '/fo', 'csv', '/nh']);
    const sid = identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];
    if (identity.exitCode !== 0 || !sid) throw new Error('无法确认诊断夹具所属用户');
    report.fixturePrincipal = sid;
    report.fixtureAclPreparation = execute(['icacls.exe', root, '/grant', `*${sid}:(OI)(CI)M`]);
    if (report.fixtureAclPreparation.exitCode !== 0) throw new Error('无法为诊断夹具建立普通用户写权限');
    const work = path.join(root, 'work');
    await fs.mkdir(work);
    const inside = path.join(work, 'inside.txt'), outside = path.join(root, 'outside.txt');
    await fs.writeFile(inside, 'original'); await fs.writeFile(outside, 'original');
    ctx = new Context();
    await ctx.plugin(LocalSandbox); await ctx.fiber.await();
    const run = async (workspaceRoot, mode, program, invocation = 'node-direct') => {
      const command = `node -e "${program}"`;
      const argv = invocation === 'cmd-shell' ? ['cmd.exe', '/d', '/s', '/c', command]
        : invocation === 'node-shell-bridge' ? [process.execPath,
          fileURLToPath(new URL('../electron/scripts/windows_command_runner.cjs', import.meta.url)), Buffer.from(command).toString('base64')]
        : [process.execPath, '-e', program];
      const confined = await ctx.sandbox.confine(argv, { workspaceRoot, mode });
      const outcome = execute(confined.argv, workspaceRoot);
      return { enforcement: confined.enforcement, denialSignatures: confined.denialSignatures,
        runnerFailureRules: confined.runnerFailureRules, ...outcome,
        runnerFailure: classifyRunnerFailure(outcome.exitCode, outcome.stderr, confined.runnerFailureRules) };
    };
    const acls = () => [root, work, inside, outside].map(target => ({ target, ...execute(['icacls.exe', target]) }));
    const exactLegacy = await run(work, 'workspace-write', "require('fs').writeFileSync(require('path').join('..','out'+'side.txt'),'changed')", 'cmd-shell');
    report.exactLegacyCommand = { ...exactLegacy, actualWrite: (await fs.readFile(outside, 'utf8')) === 'changed' };
    await fs.writeFile(outside, 'original');
    for (const phase of ['fresh-workspace', 'after-broader-workspace-grant']) {
      if (phase === 'after-broader-workspace-grant') {
        // 模拟较早把父目录作为工作区运行过的情形，授权范围仅限本次自建夹具。
        report.observations.push({ phase: 'broader-grant', result: await run(root, 'workspace-write', 'process.exitCode=0') });
      }
      const invocations = process.argv.includes('--compare-launchers') ? ['node-direct', 'cmd-shell', 'node-shell-bridge'] : ['node-shell-bridge'];
      for (const mode of ['workspace-write', 'read-only']) for (const invocation of invocations) {
        const before = acls();
        const readiness = await run(work, mode, "process.stdout.write('DYWORKER_PROBE_READY')", invocation);
        const results = [];
        const created = path.join(work, `new-${phase}-${mode}-${invocation}.txt`);
        for (const [kind, target, relative] of [['inside-existing', inside, "'inside.txt'"],
          ['inside-new', created, `'${path.basename(created)}'`], ['outside', outside, "require('path').join('..','out'+'side.txt')"]]) {
          if (kind !== 'inside-new') await fs.writeFile(target, 'original');
          const changed = async () => (await fs.readFile(target, 'utf8').catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
          })) === 'changed';
          try {
            // cmd 路径保留原失败用例的相对路径和单引号程序正文；不能用直接启动替代它。
            const result = await run(work, mode, `require('fs').writeFileSync(${relative},'changed');process.stdout.write('WRITE_DONE')`, invocation);
            results.push({ kind, target, ...result, actualWrite: await changed() });
          } catch (error) {
            results.push({ kind, target, error: error.message, actualWrite: await changed() });
          }
        }
        report.observations.push({ phase, mode, invocation, before, readiness, results, after: acls() });
      }
    }
    const checks = report.observations.filter(item => item.results);
    const leak = checks.some(item => item.results.some(result => result.actualWrite && (item.mode === 'read-only' || result.kind === 'outside')));
    const inconclusive = checks.some(item => item.readiness.exitCode !== 0 || !item.readiness.stdout.includes('DYWORKER_PROBE_READY')
      || item.results.some(result => result.error || result.runnerFailure || result.exitCode === null)
      || [...item.before, ...item.after].some(acl => acl.exitCode !== 0)
      || (item.mode === 'workspace-write' && !item.results.find(result => result.kind === 'inside-new').actualWrite));
    report.conclusion = leak ? 'outside-or-read-only-write-observed' : inconclusive ? 'probe-inconclusive' : 'not-reproduced-in-these-fixtures';
    process.exitCode = leak ? 1 : inconclusive ? 2 : 0;
  } catch (error) {
    report.error = error.message; report.conclusion = 'probe-inconclusive'; process.exitCode = 2;
  } finally {
    try { await ctx?.fiber.dispose(); }
    catch (error) { report.disposeError = error.message; process.exitCode = 2; }
    try { if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { report.cleanupError = error.message; report.fixture = root; process.exitCode = 2; }
    console.log(JSON.stringify(report, null, 2));
  }
}
