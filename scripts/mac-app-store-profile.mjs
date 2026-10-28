import { createRequire } from 'node:module';

// 使用现有打包工具自身声明的 plist 依赖，不依赖偶然提升到根目录的模块。
const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve('app-builder-lib'))('plist');

export function isStoreDistributionProfile(xml, bundleId, now = Date.now()) {
  try {
    // profile 含 date/data，不能把整个 plist 转成 JSON（plutil 会拒绝转换）。
    const profile = parse(xml);
    const entitlements = profile.Entitlements || {};
    const appId = entitlements['com.apple.application-identifier'];
    return Array.isArray(profile.TeamIdentifier)
      && profile.TeamIdentifier.some(team => appId === `${team}.${bundleId}`)
      && Date.parse(profile.ExpirationDate) > now
      && entitlements['get-task-allow'] !== true
      && entitlements['com.apple.security.get-task-allow'] !== true
      && !profile.ProvisionedDevices && !profile.ProvisionsAllDevices;
  } catch {
    return false;
  }
}
