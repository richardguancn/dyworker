import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { stageKoffiNative } = require('../build/koffi-native.cjs');

test('Windows 目标组件显式声明且与 Koffi 和锁定文件的版本一致', () => {
  const pkg = require('../package.json'), lock = require('../package-lock.json');
  const version = pkg.optionalDependencies['@koromix/koffi-win32-x64'];
  assert.equal(version, require('koffi').version);
  assert.equal(version, lock.packages[''].optionalDependencies['@koromix/koffi-win32-x64']);
  assert.equal(version, lock.packages['node_modules/@koromix/koffi-win32-x64'].version);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dyw-koffi-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const projectDir = path.join(root, 'source');
  const unpackedDir = path.join(root, 'app.asar.unpacked');
  const koffi = path.join(projectDir, 'node_modules/koffi');
  const native = path.join(projectDir, 'node_modules/@koromix/koffi-win32-x64');
  write(path.join(projectDir, 'package.json'), '{}');
  for (const dir of [koffi, path.join(unpackedDir, 'node_modules/koffi')]) {
    write(path.join(dir, 'package.json'), '{"name":"koffi","version":"3.1.1","main":"index.cjs"}');
    write(path.join(dir, 'index.cjs'), '');
  }
  write(path.join(native, 'package.json'), '{"version":"3.1.1"}');
  write(path.join(native, 'win32_x64/koffi.node'), 'native fixture');
  return { root, write, projectDir, unpackedDir, native, options: { projectDir, unpackedDir, platform: 'win32', arch: 'x64' } };
}

test('Windows 打包钩子将匹配版本的二进制放到 Koffi 的实际查找目录', async t => {
  const f = fixture(t);
  const afterPack = require('../build/afterPack.cjs').default;
  const appOutDir = path.join(f.root, 'program');
  const packaged = path.join(appOutDir, 'resources/app.asar.unpacked');
  fs.mkdirSync(path.dirname(packaged), { recursive: true });
  fs.renameSync(f.unpackedDir, packaged);
  // 在 Windows 上此测试还会触发真实 exe 检查；无 exe 的夹具仅验证跨平台打包分支。
  if (process.platform === 'win32') {
    const destination = stageKoffiNative({ ...f.options, unpackedDir: packaged });
    assert.equal(fs.readFileSync(destination, 'utf8'), 'native fixture');
  } else {
    const { Arch } = require('builder-util');
    const context = { electronPlatformName: 'win32', arch: Arch.x64, appOutDir,
      packager: { projectDir: f.projectDir, appInfo: { productFilename: 'DYWorker' } } };
    await assert.rejects(afterPack(context), /安装包缺少本机应用操作文件/);
    for (const asset of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'windows/amd64/open-computer-use.exe']) {
      f.write(path.join(appOutDir, 'resources/computer-use', asset), 'computer-use fixture');
    }
    await afterPack(context);
    assert.equal(fs.readFileSync(path.join(packaged, 'node_modules/koffi/build/koffi/win32_x64/koffi.node'), 'utf8'), 'native fixture');
  }
});

test('缺少目标平台、二进制或版本不匹配时拒绝出包', t => {
  const f = fixture(t);
  assert.throws(() => stageKoffiNative({ ...f.options, arch: 'arm64' }), /缺少 @koromix\/koffi-win32-arm64/);
  f.write(path.join(f.native, 'package.json'), '{"version":"2.0.0"}');
  assert.throws(() => stageKoffiNative(f.options), /版本不一致/);
  f.write(path.join(f.native, 'package.json'), '{"version":"3.1.1"}');
  fs.rmSync(path.join(f.native, 'win32_x64/koffi.node'));
  assert.throws(() => stageKoffiNative(f.options), /koffi\.node.*拒绝打包/);
});

test('真实 Koffi 独立复制后复现缺失报错，补齐文件后实际加载成功', t => {
  const f = fixture(t);
  const source = path.dirname(require.resolve('koffi'));
  const target = path.join(f.unpackedDir, 'node_modules/koffi');
  fs.rmSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, filter: file => !file.startsWith(path.join(source, 'build')) });
  const load = () => spawnSync(process.execPath, ['-e', `const koffi=require(${JSON.stringify(target)});console.log('KOFFI_LOADED='+koffi.version)`],
    { cwd: f.root, env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8' });
  const before = load();
  assert.notEqual(before.status, 0);
  assert.match(before.stderr, /Cannot find the native Koffi module/);
  stageKoffiNative({ projectDir: path.resolve('.'), unpackedDir: f.unpackedDir, platform: process.platform, arch: process.arch });
  const after = load();
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /KOFFI_LOADED=3\.1\.1/);
});
