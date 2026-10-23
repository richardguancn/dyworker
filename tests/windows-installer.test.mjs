import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createWindowsUpgradeFixture } from './helpers/windows-upgrade-fixture.mjs';

const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const include = fileURLToPath(new URL(`../${packageJson.build.nsis.include}`, import.meta.url));
const escapeNsis = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
let compilerPromise;
const childProcesses = new WeakMap();
const fixtureCleanups = new WeakMap();
function compiler() {
  return compilerPromise ||= (async () => {
    // Windows CI uses the same downloaded compiler as the release packager.
    if (process.platform === 'win32') {
      const { getMakeNsisPath } = await import('app-builder-lib/out/toolsets/windows.js');
      return getMakeNsisPath();
    }
    for (const candidate of ['makensis', '/opt/homebrew/bin/makensis']) {
      if (spawnSync(candidate, ['-VERSION']).status === 0) return { path: candidate };
    }
    return null;
  })();
}

async function compile(t, root, { uninstall = false, query = false } = {}) {
  const tool = await compiler();
  if (!tool) { t.skip('本机没有 NSIS；Windows 发布检查会编译并运行'); return null; }
  const name = `${uninstall ? 'uninstall' : 'install'}-${query ? 'query' : 'check'}`;
  const exe = path.join(root, `${name}.exe`);
  const source = path.join(root, `${name}.nsi`);
  const body = query ? `
    StrCpy $dywMode 0
    Call ${uninstall ? 'un.' : ''}dywInspectProcesses
    SetErrorLevel $dywResult
  ` : `!insertmacro customCheckAppRunning`;
  await fs.writeFile(source, `
    Unicode true
    RequestExecutionLevel user
    SilentInstall silent
    SilentUnInstall silent
    Name "DYWorker installer regression"
    OutFile "${escapeNsis(exe)}"
    !include "LogicLib.nsh"
    !define APP_EXECUTABLE_FILENAME "DYWorker.exe"
    !define isUpdated '1 == 1'
    ${query ? '!define DYW_PROCESS_TRACE' : ''}
    ${uninstall ? '!define BUILD_UNINSTALLER' : ''}
    !include "${escapeNsis(include)}"
    !insertmacro customHeader
    LoadLanguageFile "\u0024{NSISDIR}\\Contrib\\Language files\\English.nlf"
    ${query ? '' : `
      LangString appRunning 1033 "Running"
      LangString appClosing 1033 "Closing"
      LangString appCannotBeClosed 1033 "Cannot close"
    `}
    Section
      ${uninstall ? `WriteUninstaller "$EXEDIR\\uninstaller.exe"` : body}
    SectionEnd
    ${uninstall ? `Section "Uninstall"\n${body}\nSectionEnd` : ''}
  `);
  const args = ['-V2', '-WX', source];
  // NSIS on Windows uses / switches; this also avoids treating /D= paths as flags.
  if (process.platform === 'win32') { args[0] = '/V2'; args[1] = '/WX'; }
  execFileSync(tool.path, args, { env: { ...process.env, ...tool.env }, timeout: 60_000, stdio: 'pipe' });
  return exe;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-installer-'));
  const children = [];
  childProcesses.set(t, children);
  fixtureCleanups.set(t, []);
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited;
      }
    }
    for (const cleanup of fixtureCleanups.get(t)) await cleanup();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  return root;
}

test('Windows 安装和卸载均能编译应用关闭检查', async t => {
  const root = await fixture(t);
  for (const uninstall of [false, true]) {
    for (const query of [false, true]) {
      if (!await compile(t, root, { uninstall, query })) return;
    }
  }
});

// NSIS requires /D= and _?= to be an unquoted final command-line tail, including
// when it contains spaces. libuv's normal argv quoting changes their meaning.
const nsisCommandLine = exe => ({ windowsVerbatimArguments: true, argv0: `"${exe}"` });
function run(exe, directory, extra = []) {
  return spawnSync(exe, ['/S', ...extra, `/D=${directory}`], { ...nsisCommandLine(exe), timeout: 20_000, encoding: 'utf8' });
}

async function dummy(t, directory, filename = 'DYWorker.exe') {
  await fs.mkdir(directory, { recursive: true });
  const exe = path.join(directory, filename);
  await fs.copyFile(process.execPath, exe);
  return launch(t, exe);
}

async function launch(t, exe) {
  const child = spawn(exe, ['-e', 'setInterval(() => {}, 1000); console.log("ready")'], { stdio: ['ignore', 'pipe', 'pipe'] });
  // Register before assertions so a failed check cannot leak a dummy process.
  childProcesses.get(t).push(child);
  const [ready] = await once(child.stdout, 'data');
  assert.match(ready.toString(), /ready/);
  return child;
}

test('Windows 真进程：空闲、同目录安装助手、其他安装位置不会误判；残留应用可以关闭', { skip: process.platform !== 'win32', timeout: 90_000 }, async t => {
  const root = await fixture(t);
  // Includes characters that used to break inline PowerShell literals.
  const installed = path.join(root, "张三's 应用 & test", 'DYWorker');
  await fs.mkdir(installed, { recursive: true });
  const query = await compile(t, root, { query: true });
  const check = await compile(t, root);
  const assertRun = async (exe, expected) => {
    const traceFile = path.join(path.dirname(exe), 'process-trace.txt');
    await fs.rm(traceFile, { force: true });
    const result = run(exe, installed);
    assert.equal(result.error, undefined);
    const trace = result.status === expected ? '' : await fs.readFile(traceFile, 'utf16le').catch(() => 'no trace');
    assert.equal(result.status, expected, result.stdout + result.stderr + trace);
  };
  await assertRun(query, 0);
  const setup = await dummy(t, installed, 'dyworker-setup.exe');
  const oldUninstaller = await dummy(t, installed, 'Uninstall DYWorker.exe');
  const elevation = await dummy(t, path.join(installed, 'resources'), 'elevate.exe');
  const other = await dummy(t, `${installed}-other`);
  // Run setup itself from INSTDIR, the original directory-wide false positive.
  const localCheck = path.join(installed, 'install-check.exe');
  await fs.copyFile(check, localCheck);
  await assertRun(query, 0);
  await assertRun(localCheck, 0);
  for (const child of [setup, oldUninstaller, elevation, other]) assert.equal(process.kill(child.pid, 0), true);

  const app = await dummy(t, installed);
  await assertRun(query, 1);
  // Same executable also hosts Electron's renderer and Node child processes.
  const helper = await launch(t, path.join(installed, 'DYWorker.exe'));
  await assertRun(localCheck, 0);
  // spawnSync blocks JS exit events: verify absence through a fresh native scan.
  await assertRun(query, 0);
  for (const child of [setup, oldUninstaller, elevation, other]) assert.equal(process.kill(child.pid, 0), true);
  for (const child of [app, helper]) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

test('Windows 真卸载程序使用相同的进程判断', { skip: process.platform !== 'win32', timeout: 60_000 }, async t => {
  const root = await fixture(t);
  const installed = path.join(root, 'DYWorker');
  await fs.mkdir(installed);
  const writer = await compile(t, root, { uninstall: true });
  assert.equal(run(writer, installed).status, 0);
  const uninstaller = path.join(root, 'uninstaller.exe');
  const other = await dummy(t, `${installed}-other`);
  const app = await dummy(t, installed);
  const result = spawnSync(uninstaller, ['/S', `_?=${installed}`], { ...nsisCommandLine(uninstaller), timeout: 20_000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(process.kill(other.pid, 0), true);
  const query = await compile(t, root, { query: true });
  assert.equal(run(query, installed).status, 0);
  assert.throws(() => process.kill(app.pid, 0), { code: 'ESRCH' });
});

test('Windows 覆盖升级：复现旧卸载失败，验证新版接管、文件占用恢复及数据保留', { skip: process.platform !== 'win32', timeout: 300_000 }, async t => {
  const root = await fixture(t);
  let metadata;
  if (process.env.DYW_PREBUILT_INSTALLER_FIXTURE) {
    const source = process.env.DYW_PREBUILT_INSTALLER_FIXTURE;
    metadata = JSON.parse(await fs.readFile(path.join(source, 'fixture.json'), 'utf8'));
    for (const file of [...Object.values(metadata.installers), 'lock.exe']) {
      await fs.copyFile(path.join(source, file), path.join(root, file));
    }
  } else {
    metadata = await createWindowsUpgradeFixture(root, await compiler());
  }
  const installed = path.join(root, "张三's 应用", 'DYWorker');
  const invoke = name => run(path.join(root, metadata.installers[name]), installed, ['/currentuser']);
  // Unique app ID and disabled shortcuts keep the real DYWorker install intact.
  fixtureCleanups.get(t).push(() => {
    const exe = path.join(installed, 'Uninstall DYWorker.exe');
    spawnSync(exe, ['/S', `_?=${installed}`], { ...nsisCommandLine(exe), timeout: 30_000 });
    // A failed assertion may leave the deliberately broken legacy uninstaller.
    // Remove only this fixture's two unique per-user registration keys.
    const keys = [
      path.win32.join('HKCU', 'Software', metadata.guid),
      path.win32.join('HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Uninstall', metadata.guid),
    ];
    for (const key of keys) {
      spawnSync('reg.exe', ['delete', key, '/f', '/reg:64'], { timeout: 10_000 });
    }
  });
  assert.equal(invoke('old').status, 0);
  const userData = path.join(process.env.APPDATA, metadata.packageName);
  await fs.mkdir(userData, { recursive: true });
  const data = path.join(userData, 'must-keep.txt');
  await fs.writeFile(data, 'user history');
  fixtureCleanups.get(t).push(() => fs.rm(userData, { recursive: true, force: true }));

  const legacyCalled = path.join(installed, 'legacy-uninstaller-called.txt');
  // The upstream error dialog has no silent-mode default and can wait forever.
  // Observe that it reached the broken old uninstaller, then stop ONLY this
  // fixture process tree, rather than depending on a human to dismiss its UI.
  const baselineExe = path.join(root, metadata.installers.baseline);
  const baseline = spawn(baselineExe, ['/S', '/currentuser', `/D=${installed}`], { ...nsisCommandLine(baselineExe), stdio: 'ignore' });
  childProcesses.get(t).push(baseline);
  const baselineDeadline = Date.now() + 20_000;
  while (Date.now() < baselineDeadline) {
    if (await fs.stat(legacyCalled).catch(() => null)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(await fs.readFile(legacyCalled, 'utf8'), 'legacy uninstaller ran');
  assert.equal(await fs.readFile(path.join(installed, 'resources/version.txt'), 'utf8'), '0.3.1');
  if (baseline.exitCode === null && baseline.signalCode === null) {
    const stopped = once(baseline, 'exit');
    spawnSync('taskkill.exe', ['/PID', String(baseline.pid), '/T', '/F'], { timeout: 10_000 });
    await stopped;
  }
  await fs.rm(legacyCalled);

  const lockExe = path.join(root, 'lock.exe');
  const lock = spawn(lockExe, ['/S', `/D=${installed}`], { ...nsisCommandLine(lockExe), stdio: 'ignore' });
  childProcesses.get(t).push(lock);
  const ready = path.join(installed, 'lock-ready.txt');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await fs.stat(ready).catch(() => null)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const lockDiagnostic = await fs.readFile(path.join(root, 'lock-diagnostic.txt'), 'utf16le').catch(() => 'no lock diagnostic');
  assert.equal(await fs.readFile(ready, 'utf8').catch(() => ''), 'ready', lockDiagnostic);
  const blocked = invoke('fixed');
  assert.equal(blocked.error, undefined);
  assert.notEqual(blocked.status, 0, '真实文件占用时不能假装升级成功');
  const diagnostic = await fs.readFile(path.join(os.tmpdir(), 'DYWorker-upgrade-error.txt'), 'utf16le');
  assert.ok(diagnostic.includes(path.join(installed, 'resources/version.txt')), diagnostic);
  assert.equal(await fs.readFile(path.join(installed, 'resources/version.txt'), 'utf8'), '0.3.1');
  assert.equal(await fs.readFile(data, 'utf8'), 'user history');
  await fs.access(path.join(installed, 'DYWorker.exe'));
  await fs.access(path.join(installed, 'Uninstall DYWorker.exe'));
  await assert.rejects(fs.access(legacyCalled), { code: 'ENOENT' });
  const exited = once(lock, 'exit'); lock.kill(); await exited;

  const upgraded = invoke('fixed');
  assert.equal(upgraded.error, undefined);
  const upgradeError = upgraded.status === 0 ? '' : await fs.readFile(path.join(os.tmpdir(), 'DYWorker-upgrade-error.txt'), 'utf16le').catch(() => 'No native uninstall error file');
  assert.equal(upgraded.status, 0, upgraded.stdout + upgraded.stderr + upgradeError);
  assert.equal(await fs.readFile(path.join(installed, 'resources/version.txt'), 'utf8'), '0.3.3');
  assert.equal(await fs.readFile(data, 'utf8'), 'user history');
  await assert.rejects(fs.access(legacyCalled), { code: 'ENOENT' });

  // Also exercise the no-previous-install branch of the new upgrade wrapper.
  // Uninstall keeps user data, and installing again must preserve that data.
  const uninstaller = path.join(installed, 'Uninstall DYWorker.exe');
  const removed = spawnSync(uninstaller, ['/S', `_?=${installed}`], { ...nsisCommandLine(uninstaller), timeout: 30_000, encoding: 'utf8' });
  assert.equal(removed.error, undefined);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  const fresh = invoke('fixed');
  assert.equal(fresh.error, undefined);
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  assert.equal(await fs.readFile(path.join(installed, 'resources/version.txt'), 'utf8'), '0.3.3');
  assert.equal(await fs.readFile(data, 'utf8'), 'user history');
});

test('Windows 跨盘覆盖升级：C 盘临时目录与 D 盘安装目录之间可以升级 0.3.1', { skip: process.platform !== 'win32', timeout: 180_000 }, async t => {
  const temporaryDrive = path.parse(os.tmpdir()).root.toLowerCase();
  const installDrive = path.parse(process.cwd()).root.toLowerCase();
  assert.notEqual(temporaryDrive, installDrive, '此用例需要将仓库与系统临时目录放在不同盘');
  const root = await fixture(t);
  const metadata = await createWindowsUpgradeFixture(root, await compiler());
  const installed = path.join(process.cwd(), 'output', path.basename(root), 'DYWorker');
  const invoke = name => run(path.join(root, metadata.installers[name]), installed, ['/currentuser']);
  fixtureCleanups.get(t).push(async () => {
    const exe = path.join(installed, 'Uninstall DYWorker.exe');
    spawnSync(exe, ['/S', `_?=${installed}`], { ...nsisCommandLine(exe), timeout: 30_000 });
    for (const key of [
      path.win32.join('HKCU', 'Software', metadata.guid),
      path.win32.join('HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Uninstall', metadata.guid),
    ]) spawnSync('reg.exe', ['delete', key, '/f', '/reg:64'], { timeout: 10_000 });
    await fs.rm(path.dirname(installed), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  assert.equal(invoke('stock').status, 0);
  assert.equal(await fs.readFile(path.join(installed, 'resources/version.txt'), 'utf8'), '0.3.1');
  const upgraded = invoke('fixed');
  const diagnostic = await fs.readFile(path.join(os.tmpdir(), 'DYWorker-upgrade-error.txt'), 'utf16le').catch(() => '没有错误文件');
  assert.equal(upgraded.error, undefined);
  assert.equal(upgraded.status, 0, `临时目录=${os.tmpdir()} 安装目录=${installed}\n${diagnostic}`);
  assert.equal(await fs.readFile(path.join(installed, 'resources/version.txt'), 'utf8'), '0.3.3');
});

test('Windows 手动安装：D 盘旧版覆盖升级包含长路径时不能弹出无法关闭提示', { skip: process.platform !== 'win32', timeout: 180_000 }, async t => {
  const root = await fixture(t);
  const metadata = await createWindowsUpgradeFixture(root, await compiler(), { longPaths: true });
  const installed = path.join(process.cwd(), 'output', path.basename(root), 'custom install location with a longer directory name', 'DYWorker');
  fixtureCleanups.get(t).push(async () => {
    const exe = path.join(installed, 'Uninstall DYWorker.exe');
    spawnSync(exe, ['/S', `_?=${installed}`], { ...nsisCommandLine(exe), timeout: 30_000 });
    for (const key of [
      path.win32.join('HKCU', 'Software', metadata.guid),
      path.win32.join('HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Uninstall', metadata.guid),
    ]) spawnSync('reg.exe', ['delete', key, '/f', '/reg:64'], { timeout: 10_000 });
    await fs.rm(path.dirname(installed), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const old = run(path.join(root, metadata.installers.stock), installed, ['/currentuser']);
  assert.equal(old.error, undefined);
  assert.equal(old.status, 0);
  const script = fileURLToPath(new URL('./helpers/windows-installer-ui.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Installer', path.join(root, metadata.installers.fixed), '-InstallDirectory', installed], {
    timeout: 110_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout.trim());
  console.log('Interactive installation report:', JSON.stringify(report));
  assert.deepEqual(report.dialogs, [], JSON.stringify(report));
  assert.equal(report.exitCode, 0, JSON.stringify(report));
  const nested = path.join(installed, 'resources', ...Array(5).fill('nested-dependency-with-a-long-package-name'), 'must-install.txt');
  assert.ok(nested.length > 260, `用例需要覆盖超出旧 Windows 路径上限的文件：${nested.length}`);
  assert.equal(await fs.readFile(nested, 'utf8'), '0.3.3');
});
