import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canReuse, environmentFingerprint, fingerprint, readReceipt, writeReceipt } from './build-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'output/.build-cache');
const [command = 'build', ...args] = process.argv.slice(2);
const force = args.includes('--force');
const modes = new Set(['build', 'verify', 'package']);
if (!modes.has(command)) throw new Error(`未知构建命令：${command}`);
const packageTargets = {
  dir: ['--dir'], mac: ['--mac', 'dmg', 'zip'],
  'linux-arm64': ['--linux', 'AppImage', 'deb', '--arm64'],
  'windows-x64': ['--win', '--x64'],
};
const target = args.find(arg => !arg.startsWith('--')) || 'dir';
if (command === 'package' && !packageTargets[target]) throw new Error(`未知打包目标：${target}`);
const allowed = new Set(['--force', ...(command === 'package' ? [target] : [])]);
if (args.some(arg => !allowed.has(arg))) throw new Error(`不支持的参数：${args.filter(arg => !allowed.has(arg)).join(' ')}`);

function digest(values) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
function run(label, executable, arguments_) {
  console.log(`[构建] 开始${label}`);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      console.log(`[构建] ${label} ${(performance.now() - started).toFixed(0) / 1000} 秒`);
      if (code === 0) resolve();
      else reject(new Error(`${label}失败（${signal || code}）`));
    });
  });
}
const node = (label, script, arguments_ = []) => run(label, process.execPath, [path.join(root, script), ...arguments_]);

// 同一工作区避免两个打包命令同时清理/改写产物。上次意外结束的锁可恢复。
mkdirSync(cacheDir, { recursive: true });
const lockFile = path.join(cacheDir, 'lock.json');
function acquireLock() {
  try {
    const fd = openSync(lockFile, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const lock = readReceipt(lockFile);
    if (!Number.isInteger(lock?.pid) || lock.pid <= 0) throw new Error('构建锁无法识别，请确认没有其他构建后删除 output/.build-cache/lock.json');
    try { process.kill(lock.pid, 0); } catch (probe) {
      if (probe.code === 'ESRCH') { rmSync(lockFile); return acquireLock(); }
    }
    throw new Error('这个工作区已有构建正在运行，请等待它结束');
  }
}
acquireLock();
const started = performance.now();
try {
  const environment = environmentFingerprint();
  const dependencies = fingerprint(root, ['node_modules'], { metadataOnly: true });
  const rootFiles = () => readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
  const common = ['scripts'];
  const input = entries => digest([environment, dependencies, fingerprint(root, [...rootFiles(), ...entries])]);
  const output = entries => fingerprint(root, entries);
  const verificationEntries = [...common, 'src', 'electron', 'builtin-plugins', 'vendor', 'public', 'tests', 'evals', 'build', '.github'];
  const verificationOutputs = ['dist/client', 'dist/electron'];
  const verificationFile = path.join(cacheDir, 'verify.json');
  const verificationInputs = () => input(verificationEntries);
  const verificationBefore = verificationInputs();
  const reuseVerification = command === 'package' && !force && existsSync(path.join(root, 'dist/client/index.html'))
    && existsSync(path.join(root, 'dist/electron/main.mjs'))
    && canReuse(readReceipt(verificationFile), verificationBefore, output(verificationOutputs));
  if (reuseVerification) {
    console.log('[构建] 文件和产物未变，复用本机已通过的完整检查');
  } else {
    // 先撤销旧记录，任一步骤失败都不能继续使用旧的通过结果。
    rmSync(verificationFile, { force: true });
    await node('插件构建', 'scripts/build-plugins.mjs');
    const beforeBuild = verificationInputs();
    async function stage(name, entries, outputs, action) {
      const file = path.join(cacheDir, `${name}.json`);
      const before = input([...common, ...entries]);
      if (!force && outputs.every(entry => existsSync(path.join(root, entry)))
        && canReuse(readReceipt(file), before, output(outputs))) {
        console.log(`[构建] ${name}文件和产物未变，复用构建结果`);
        return;
      }
      rmSync(file, { force: true });
      await action();
      if (before !== input([...common, ...entries])) throw new Error(`${name}构建期间输入发生变化，请重新运行`);
      writeReceipt(file, { version: 1, inputs: before, outputs: output(outputs) });
    }
    // 两端输出目录独立；插件生成完成后才允许开始，避免读到旧模块。
    const stages = await Promise.allSettled([
      stage('electron', ['electron'], ['dist/electron'], () => node('桌面构建', 'scripts/build-electron.mjs')),
      stage('renderer', ['src', 'builtin-plugins', 'vendor', 'public'], ['dist/client'], async () => {
        await node('页面类型检查', 'node_modules/typescript/bin/tsc', ['--noEmit']);
        await node('页面构建', 'node_modules/vite/bin/vite.js', ['build']);
      }),
    ]);
    const failure = stages.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    if (beforeBuild !== verificationInputs()) throw new Error('构建期间文件发生变化，请重新运行');
    if (command !== 'build') {
      const beforeTests = verificationInputs();
      const outputsBeforeTests = output(verificationOutputs);
      // 保留串行测试：现有运行期验收包含时间约束，不增加并发负载。
      const tests = readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.mjs')).sort();
      await run('全部测试', process.execPath, ['--test', '--test-concurrency=1', ...tests.map(file => `tests/${file}`)]);
      if (beforeTests !== verificationInputs() || outputsBeforeTests !== output(verificationOutputs)
        || dependencies !== fingerprint(root, ['node_modules'], { metadataOnly: true })) {
        throw new Error('检查期间文件、依赖或产物发生变化，请重新运行');
      }
      writeReceipt(verificationFile, { version: 1, inputs: beforeTests, outputs: outputsBeforeTests, checkedAt: new Date().toISOString() });
    }
  }
  if (command === 'package') {
    const checked = readReceipt(verificationFile);
    const assertChecked = () => {
      if (!canReuse(checked, verificationInputs(), output(verificationOutputs))
        || dependencies !== fingerprint(root, ['node_modules'], { metadataOnly: true })) {
        rmSync(verificationFile, { force: true });
        throw new Error('打包期间文件、依赖或产物发生变化，请重新运行');
      }
    };
    assertChecked();
    await node('生成应用包', 'node_modules/electron-builder/cli.js', [...packageTargets[target], '--publish', 'never']);
    assertChecked();
  }
} finally {
  rmSync(lockFile, { force: true });
  console.log(`[构建] 总耗时 ${((performance.now() - started) / 1000).toFixed(1)} 秒`);
}
