import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canReuse, environmentFingerprint, fingerprint, readReceipt, writeReceipt } from '../scripts/build-cache.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dyw-build-pipeline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  };
  write('package.json', '{"type":"module"}');
  for (const file of ['build.mjs', 'build-cache.mjs']) {
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    cpSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
  }
  // 用真实子进程和文件模拟各阶段；事件文件放在不参与输入摘要的输出目录。
  const event = label => `import fs from 'node:fs'; fs.mkdirSync('output',{recursive:true}); fs.appendFileSync('output/events.log', '${label}\\n');`;
  write('scripts/build-plugins.mjs', event('plugins'));
  write('scripts/build-electron.mjs', event('electron') + "fs.mkdirSync('dist/electron',{recursive:true});fs.writeFileSync('dist/electron/main.mjs','desktop');");
  write('node_modules/typescript/bin/tsc', event('types'));
  write('node_modules/vite/bin/vite.js', event('renderer') + "fs.mkdirSync('dist/client',{recursive:true});fs.writeFileSync('dist/client/index.html','page');");
  write('node_modules/electron-builder/cli.js', event('package'));
  write('tests/pass.test.mjs', event('test') + "import test from 'node:test';test('fixture',()=>{});");
  write('src/input.ts', 'original');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // 真实嵌套测试进程不能继承父测试的内部标记。
  const run = (...args) => spawnSync(process.execPath, ['scripts/build.mjs', ...args], {
    cwd: root, encoding: 'utf8', env, timeout: 15000,
  });
  const events = () => readFileSync(path.join(root, 'output/events.log'), 'utf8').trim().split('\n');
  return { root, write, run, events };
}

test('输入按内容检查，同时间戳改写、增加和删除均会失效', t => {
  const { root, write } = fixture(t);
  const original = fingerprint(root, ['src']);
  write('src/input.ts', 'modified'); utimesSync(path.join(root, 'src/input.ts'), 1, 1);
  assert.notEqual(fingerprint(root, ['src']), original);
  const modified = fingerprint(root, ['src']);
  write('src/new.ts', 'new'); assert.notEqual(fingerprint(root, ['src']), modified);
  rmSync(path.join(root, 'src/new.ts')); assert.equal(fingerprint(root, ['src']), modified);
});

test('依赖修补和目录链接目标变化均会失效；循环链接明确失败', t => {
  const { root, write } = fixture(t);
  write('dependency/lib.js', 'first');
  symlinkSync('../dependency', path.join(root, 'src/dependency'), 'dir');
  const original = fingerprint(root, ['src'], { metadataOnly: true });
  write('dependency/lib.js', 'changed dependency');
  assert.notEqual(fingerprint(root, ['src'], { metadataOnly: true }), original);
  symlinkSync('../src', path.join(root, 'dependency/cycle'), 'dir');
  assert.throws(() => fingerprint(root, ['src']), /循环/);
});

test('只有完整匹配的成功记录可复用，损坏记录不通过', t => {
  const { root, write } = fixture(t);
  const file = path.join(root, 'output/receipt.json');
  writeReceipt(file, { version: 1, inputs: 'input', outputs: 'output' });
  assert.equal(canReuse(readReceipt(file), 'input', 'output'), true);
  assert.equal(canReuse(readReceipt(file), 'changed', 'output'), false);
  assert.equal(canReuse(readReceipt(file), 'input', 'deleted'), false);
  write('output/receipt.json', 'broken');
  assert.equal(canReuse(readReceipt(file), 'input', 'output'), false);
});

test('运行环境变化撤销复用，npm 命令名称不影响复用', () => {
  const first = environmentFingerprint({ NODE_OPTIONS: '--conditions=original', npm_lifecycle_event: 'verify' });
  assert.equal(first, environmentFingerprint({ NODE_OPTIONS: '--conditions=original', npm_lifecycle_event: 'package' }));
  assert.notEqual(first, environmentFingerprint({ NODE_OPTIONS: '--conditions=changed' }));
  assert.notEqual(first, environmentFingerprint({ NODE_OPTIONS: '--conditions=original', npm_config_arch: 'x64' }));
});

test('完整检查后重复打包只出包；verify 每次测试，force 每步重做', t => {
  const { run, events } = fixture(t);
  let result = run('verify'); assert.equal(result.status, 0, result.stderr + result.stdout);
  const first = events(); assert.equal(first.filter(event => event === 'test').length, 1);
  result = run('package', 'mac'); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(events().slice(first.length), ['package']);
  assert.match(result.stdout, /复用本机已通过/);
  result = run('verify'); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(events().filter(event => event === 'test').length, 2);
  assert.equal(events().filter(event => event === 'electron').length, 1);
  result = run('package', 'dir', '--force'); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(events().filter(event => event === 'test').length, 3);
  assert.equal(events().filter(event => event === 'electron').length, 2);
});

test('输入变化只重建受影响一端；产物缺失必须重建和重测', t => {
  const { root, write, run, events } = fixture(t);
  let result = run('verify'); assert.equal(result.status, 0, result.stderr + result.stdout);
  write('src/input.ts', 'modified');
  result = run('package'); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(events().filter(event => event === 'electron').length, 1);
  assert.equal(events().filter(event => event === 'renderer').length, 2);
  rmSync(path.join(root, 'dist/electron/main.mjs'));
  result = run('package'); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(events().filter(event => event === 'electron').length, 2);
  assert.equal(events().filter(event => event === 'test').length, 3);
});

test('测试失败撤销旧记录且禁止出包，修好后可恢复', t => {
  const { root, write, run, events } = fixture(t);
  let result = run('verify'); assert.equal(result.status, 0, result.stderr + result.stdout);
  write('tests/pass.test.mjs', 'process.exit(1);');
  result = run('package'); assert.notEqual(result.status, 0);
  assert.equal(existsSync(path.join(root, 'output/.build-cache/verify.json')), false);
  assert.equal(existsSync(path.join(root, 'output/.build-cache/lock.json')), false);
  assert.equal(events().includes('package'), false);
  write('tests/pass.test.mjs', "import test from 'node:test';test('repaired',()=>{});");
  result = run('package'); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(events().includes('package'), true);
});

test('输入在检查过程中被改写不能保存通过记录或出包', t => {
  const { root, write, run, events } = fixture(t);
  write('tests/pass.test.mjs', "import fs from 'node:fs'; fs.writeFileSync('src/input.ts','changed during tests');");
  const result = run('package'); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /检查期间/);
  assert.equal(existsSync(path.join(root, 'output/.build-cache/verify.json')), false);
  assert.equal(events().includes('package'), false);
});

test('同时运行的构建不能互相覆盖产物，失效锁可恢复', t => {
  const { root, write, run } = fixture(t);
  write('output/.build-cache/lock.json', JSON.stringify({ pid: process.pid }));
  let result = run('build'); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /已有构建/);
  assert.equal(readReceipt(path.join(root, 'output/.build-cache/lock.json')).pid, process.pid);
  write('output/.build-cache/lock.json', JSON.stringify({ pid: 2147483647 }));
  result = run('build'); assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('桌面构建完成后页面构建改动桌面输入，拒绝记录混合产物', t => {
  const { root, write, run, events } = fixture(t);
  write('electron/input.mts', 'original');
  write('node_modules/vite/bin/vite.js', "import fs from 'node:fs';fs.mkdirSync('dist/client',{recursive:true});fs.writeFileSync('dist/client/index.html','page');fs.writeFileSync('electron/input.mts','changed after desktop build');");
  const result = run('package'); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /构建期间/);
  assert.equal(existsSync(path.join(root, 'output/.build-cache/verify.json')), false);
  assert.equal(events().includes('package'), false);
});

test('检查过程中新增根配置也会失效', t => {
  const { root, write, run } = fixture(t);
  write('tests/pass.test.mjs', "import fs from 'node:fs';fs.writeFileSync('.env.production','VITE_NEW=value');");
  const result = run('package'); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /检查期间/);
  assert.equal(existsSync(path.join(root, 'output/.build-cache/verify.json')), false);
});

test('生成包途中改写输入不会报告成功，并撤销检查记录', t => {
  const { root, write, run } = fixture(t);
  write('node_modules/electron-builder/cli.js', "import fs from 'node:fs';fs.writeFileSync('src/input.ts','changed during packaging');");
  const result = run('package'); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /打包期间/);
  assert.equal(existsSync(path.join(root, 'output/.build-cache/verify.json')), false);
});
