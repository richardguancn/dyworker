import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

assert.equal(process.platform, 'win32');
const oldInstaller = path.resolve('output/legacy-installer/dyworker-0.3.1-windows-x64-setup.exe');
const installer = path.resolve('output/electron/dyworker-0.3.2-windows-x64-setup.exe');
const installed = path.resolve('output/full-upgrade-check/张三的应用/DYWorker');
assert.notEqual(path.parse(installed).root.toLowerCase(), path.parse(os.tmpdir()).root.toLowerCase());
assert.ok(existsSync(oldInstaller));
assert.ok(existsSync(installer));

function probe(version) {
  const archive = path.join(installed, 'resources/app.asar');
  const code = `const fs=require('node:fs'); const p=${JSON.stringify(archive)}; const pkg=require(p+'/package.json'); if(pkg.version!==${JSON.stringify(version)})throw Error(pkg.version); if(!fs.existsSync(p+'/'+pkg.main))throw Error('missing main'); console.log(pkg.version+' '+process.platform+' '+process.arch);`;
  const result = spawnSync(path.join(installed, 'DYWorker.exe'), ['-e', code], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000, encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`${version.replaceAll('.', '\\.')} win32 x64`));
  console.log(`Installed program verified: ${result.stdout.trim()}`);
}

const old = spawnSync(oldInstaller, ['/S', '/currentuser', `/D=${installed}`], {
  windowsVerbatimArguments: true, argv0: `"${oldInstaller}"`, timeout: 360000, encoding: 'utf8',
});
assert.ifError(old.error);
assert.equal(old.status, 0, old.stdout + old.stderr);
probe('0.3.1');
const marker = path.join(process.env.APPDATA, 'dyworker', 'upgrade-must-keep.txt');
await fs.mkdir(path.dirname(marker), { recursive: true });
await fs.writeFile(marker, 'existing user data');

for (let attempt = 1; attempt <= 2; attempt++) {
  const ui = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.resolve('tests/helpers/windows-installer-ui.ps1'), '-Installer', installer,
    '-InstallDirectory', installed, '-TimeoutSeconds', '480'], {
    timeout: 510000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(ui.error);
  assert.equal(ui.status, 0, ui.stdout + ui.stderr);
  const report = JSON.parse(ui.stdout.trim());
  console.log(`Interactive full upgrade ${attempt}: ${JSON.stringify(report)}`);
  assert.deepEqual(report.dialogs, [], JSON.stringify(report));
  assert.equal(report.exitCode, 0, JSON.stringify(report));
  probe('0.3.2');
  assert.equal(await fs.readFile(marker, 'utf8'), 'existing user data');
}

async function hash(file) {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
let count = 0;
async function compare(relative = '') {
  const source = path.resolve('output/electron/win-unpacked', relative);
  for (const item of await fs.readdir(source, { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) await compare(name);
    else {
      assert.equal(await hash(path.join(installed, name)), await hash(path.resolve('output/electron/win-unpacked', name)), `安装文件缺失或不一致：${name}`);
      count++;
    }
  }
}
await compare();
console.log(`Full Windows upgrade verified: 0.3.1 -> 0.3.2, repeated manual install, preserved user data, ${count} files match.`);
