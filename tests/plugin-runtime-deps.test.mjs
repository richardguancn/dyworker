import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readRuntimeImports, runtimeImportsOf } from '../electron/host/plugin-runtime-deps.mts';

test('实际入口扫描忽略注释、示例字符串和内置库，保留 import/export/require', () => {
  const names = readRuntimeImports(`
    // import 'not-used-a';
    /* require('not-used-b') */
    const example = "import 'not-used-c';";
    const template = \`require('not-used-d')\`;
    import fs from 'node:fs'; import path from 'path';
    import { x } from 'used-a';
    export * from 'used-b';
    require('used-c'); import 'used-d';
  `);
  assert.deepEqual(names, ['used-a', 'used-b', 'used-c', 'used-d']);
});

test('实际入口扫描沿包内文件继续查找，不能读取包目录之外的文件', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-runtime-imports-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'lib'));
  await fs.writeFile(path.join(dir, 'index.js'), "import './lib/helper.js'; import '../outside.js';");
  await fs.writeFile(path.join(dir, 'lib/helper.js'), "import '@scope/actually-used'; export * from '../index.js';");
  assert.deepEqual(await runtimeImportsOf(dir, [path.join(dir, 'index.js')]), ['@scope/actually-used']);
});
