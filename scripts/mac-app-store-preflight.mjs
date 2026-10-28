// 只读检查本机上架准备情况。不会创建证书、导出私钥或上传应用。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isStoreDistributionProfile } from './mac-app-store-profile.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：node scripts/mac-app-store-preflight.mjs [--json]\n只读检查本机发布环境；通过不代表应用已完成商店适配。');
  process.exit(0);
}
if (args.some(arg => arg !== '--json')) {
  console.error('不支持的参数；使用 --help 查看用法。');
  process.exit(2);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const checks = [];
const add = (name, passed, detail) => checks.push({ name, passed, detail });
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000 });
  return { ok: !result.error && result.status === 0, output: result.stdout || '' };
}
add('macOS', process.platform === 'darwin', process.platform);
if (process.platform === 'darwin') {
  const xcode = run('xcodebuild', ['-version']);
  add('Xcode', xcode.ok, xcode.ok ? xcode.output.trim() : '无法运行 Xcode 命令行工具');
  // 安装包证书不属于 codesigning 策略，使用 basic 策略同时检查两种身份。
  const identities = run('security', ['find-identity', '-v', '-p', 'basic']);
  add('应用发布证书', identities.ok && /"(?:Apple Distribution:|3rd Party Mac Developer Application:)/.test(identities.output),
    identities.ok ? '检查有效的 Apple Distribution 或 Mac App Distribution 身份（含私钥）；未检出也可能是钥匙串访问受限' : '无法读取钥匙串中的有效身份');
  add('商店安装包证书', identities.ok && /"3rd Party Mac Developer Installer:/.test(identities.output),
    '需要有效的 Mac Installer Distribution 身份（含私钥）');
}
const profilePath = process.env.MAS_PROVISIONING_PROFILE;
let profileMatches = false;
if (profilePath && existsSync(profilePath) && process.platform === 'darwin') {
  let decoded = run('security', ['cms', '-D', '-i', path.resolve(profilePath)]);
  // 受限运行环境中的 security cms 可能无法访问证书服务；OpenSSL 仍可校验
  // CMS 内容签名并解码。-noverify 不核验苹果证书信任链，最终签署须另行验证。
  if (!decoded.ok) decoded = run('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', path.resolve(profilePath)]);
  if (decoded.ok) {
    profileMatches = isStoreDistributionProfile(decoded.output, pkg.build.appId);
  }
}
add('应用发布描述文件', profileMatches,
  `通过 MAS_PROVISIONING_PROFILE 指定未过期、匹配 ${pkg.build.appId} 的商店发布描述文件`);
add('上传构建编号', /^[1-9]\d{0,3}(?:\.\d{1,2}){0,2}$/.test(process.env.MAS_BUILD_NUMBER || ''),
  '通过 MAS_BUILD_NUMBER 指定构建编号；必须高于后台已上传的编号（需另外核对）');
const report = {
  app: pkg.productName, version: pkg.version, bundleId: pkg.build.appId,
  environmentReady: checks.every(check => check.passed),
  submissionReady: false,
  checks,
  remaining: [
    '确认开发者会员和 App Store Connect 登录状态',
    '确定商店版功能范围、售价及发布地区',
    '完成文件授权恢复、更新方式、扩展安装及电脑操控的商店适配',
    '完成第三方 AI 数据告知与授权、隐私政策及商店隐私申报',
    '在商店测试包中验证启动、文件读写、重启恢复、对话及文档处理',
    '准备截图、审核体验方式、审核联系人并上传送审',
  ],
};
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${report.app} ${report.version} / ${report.bundleId}`);
  for (const item of checks) console.log(`${item.passed ? '通过' : '未通过'}：${item.name} — ${item.detail}`);
  console.log('\n应用尚未完成商店适配，不能直接送审。后续事项：');
  for (const item of report.remaining) console.log(`- ${item}`);
}
process.exitCode = report.environmentReady ? 0 : 1;
