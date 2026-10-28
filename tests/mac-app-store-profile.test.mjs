import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { isStoreDistributionProfile } from '../scripts/mac-app-store-profile.mjs';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('app-builder-lib'))('plist');
const bundleId = 'com.maquesoft.dyworker.app';
const now = Date.parse('2026-10-26T00:00:00Z');
const profile = () => ({
  TeamIdentifier: ['EXAMPLETEAM'],
  ExpirationDate: new Date('2027-10-26T00:00:00Z'),
  // 合成示例，不是真实证书或真实描述文件。
  DeveloperCertificates: [Buffer.from('synthetic-test-certificate')],
  Entitlements: { 'com.apple.application-identifier': `EXAMPLETEAM.${bundleId}` },
});

test('商店描述文件可解析日期和证书数据，且必须匹配应用与团队', () => {
  assert.equal(isStoreDistributionProfile(build(profile()), bundleId, now), true);
  assert.equal(isStoreDistributionProfile(build(profile()), 'com.other.app', now), false);
  const mismatch = profile();
  mismatch.TeamIdentifier = ['OTHERTEAM'];
  assert.equal(isStoreDistributionProfile(build(mismatch), bundleId, now), false);
});

test('过期、开发、设备分发、企业分发和损坏文件不能作为商店发布文件', () => {
  const cases = [
    value => { value.ExpirationDate = new Date(now); },
    value => { value.Entitlements['get-task-allow'] = true; },
    value => { value.Entitlements['com.apple.security.get-task-allow'] = true; },
    value => { value.ProvisionedDevices = ['test-device']; },
    value => { value.ProvisionsAllDevices = true; },
    value => { delete value.TeamIdentifier; },
    value => { delete value.ExpirationDate; },
  ];
  for (const mutate of cases) {
    const value = profile();
    mutate(value);
    assert.equal(isStoreDistributionProfile(build(value), bundleId, now), false);
  }
  assert.equal(isStoreDistributionProfile('broken', bundleId, now), false);
});
