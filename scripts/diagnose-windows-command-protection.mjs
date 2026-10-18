// 仅用于真实 Windows 诊断：直接调用官方后端，在自建夹具中观察实际写入。
// 不通过应用的临时停用门槛，也不把这个独立诊断入口暴露为助手工具。
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.error('此诊断必须在真实 Windows 上运行；未创建目录或修改权限。');
  process.exitCode = 2;
} else {
  const report = { diagnosticOnly: true, platform: process.platform, node: process.version, observations: [] };
  const execute = argv => {
    const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 20000, maxBuffer: 256 * 1024,
      windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    return { exitCode: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '',
      ...(result.error ? { error: result.error.message } : {}) };
  };
  let root, ctx;
  try {
    const { Context } = await import('@deepseek-ai/cordis');
    const { default: LocalSandbox } = await import('@deepseek-ai/dsh-sandbox-local');
    const { classifyRunnerFailure } = await import('@deepseek-ai/dsh-sandbox');
    root = await fs.realpath(await fs.mkdtemp(path.join(process.cwd(), '.dyw-windows-acl-probe-')));
    const work = path.join(root, 'work');
    await fs.mkdir(work);
    const inside = path.join(work, 'inside.txt'), outside = path.join(root, 'outside.txt');
    await fs.writeFile(inside, 'original'); await fs.writeFile(outside, 'original');
    ctx = new Context();
    await ctx.plugin(LocalSandbox); await ctx.fiber.await();
    const run = async (workspaceRoot, mode, program) => {
      const confined = await ctx.sandbox.confine([process.execPath, '-e', program], { workspaceRoot, mode });
      const outcome = execute(confined.argv);
      return { enforcement: confined.enforcement, denialSignatures: confined.denialSignatures,
        runnerFailureRules: confined.runnerFailureRules, ...outcome,
        runnerFailure: classifyRunnerFailure(outcome.exitCode, outcome.stderr, confined.runnerFailureRules) };
    };
    const acls = () => [root, work, inside, outside].map(target => ({ target, ...execute(['icacls.exe', target]) }));
    for (const phase of ['fresh-workspace', 'after-broader-workspace-grant']) {
      if (phase === 'after-broader-workspace-grant') {
        // 模拟较早把父目录作为工作区运行过的情形，授权范围仅限本次自建夹具。
        report.observations.push({ phase: 'broader-grant', result: await run(root, 'workspace-write', 'process.exitCode=0') });
      }
      for (const mode of ['workspace-write', 'read-only']) {
        const before = acls();
        const readiness = await run(work, mode, "process.stdout.write('DYWORKER_PROBE_READY')");
        const results = [];
        for (const [kind, target] of [['inside', inside], ['outside', outside]]) {
          await fs.writeFile(target, 'original');
          try {
            const result = await run(work, mode, `require('fs').writeFileSync(${JSON.stringify(target)}, 'changed')`);
            results.push({ kind, target, ...result, actualWrite: (await fs.readFile(target, 'utf8')) === 'changed' });
          } catch (error) {
            results.push({ kind, target, error: error.message, actualWrite: (await fs.readFile(target, 'utf8')) === 'changed' });
          }
        }
        report.observations.push({ phase, mode, before, readiness, results, after: acls() });
      }
    }
    const checks = report.observations.filter(item => item.results);
    const leak = checks.some(item => item.results.some(result => result.actualWrite && (item.mode === 'read-only' || result.kind === 'outside')));
    const inconclusive = checks.some(item => item.readiness.exitCode !== 0 || !item.readiness.stdout.includes('DYWORKER_PROBE_READY')
      || item.results.some(result => result.error || result.runnerFailure || result.exitCode === null)
      || [...item.before, ...item.after].some(acl => acl.exitCode !== 0)
      || (item.mode === 'workspace-write' && !item.results.find(result => result.kind === 'inside').actualWrite));
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
