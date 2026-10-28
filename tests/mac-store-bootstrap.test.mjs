import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureMacStoreRuntime } from '../electron/mac-store-bootstrap.mts';

test('商店版在加载依赖前选择包内组件，普通版保留原有设置', () => {
  const storeEnv = { NARB_DISABLE_NATIVE_CACHE: '0', EXISTING_VALUE: 'preserved' };
  configureMacStoreRuntime({ mas: true, env: storeEnv });
  assert.deepEqual(storeEnv, { NARB_DISABLE_NATIVE_CACHE: '1', EXISTING_VALUE: 'preserved' });
  const normalEnv = { NARB_DISABLE_NATIVE_CACHE: '0' };
  configureMacStoreRuntime({ mas: false, env: normalEnv });
  assert.deepEqual(normalEnv, { NARB_DISABLE_NATIVE_CACHE: '0' });
  // ESM 按依赖声明顺序执行，必须位于其他第三方 import 之前。
  const main = readFileSync(new URL('../electron/main.mts', import.meta.url), 'utf8');
  assert.ok(main.startsWith("import './mac-store-bootstrap.mts';"));
});
