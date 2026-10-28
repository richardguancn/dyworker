// Mac App Store 的独立打包配置。当前仅完成发布基础设施，功能适配及实机验收见
// docs/mac-app-store-release.md；不能把配置校验通过当成已经可以送审。
const { build } = require('../package.json');

module.exports = {
  ...build,
  extends: null,
  forceCodeSigning: true,
  publish: null,
  directories: { ...build.directories, output: 'output/mac-app-store' },
  mac: { ...build.mac, target: ['mas'] },
  mas: {
    type: 'distribution',
    hardenedRuntime: false,
    entitlements: 'build/entitlements.mas.plist',
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
    extendInfo: {
      NSMicrophoneUsageDescription: '在你主动开始语音输入时录音，并按你选择的语音服务转写为文字。',
      NSAppleEventsUsageDescription: '在你授权后，按任务要求操作其他应用。',
    },
    ...(process.env.MAS_PROVISIONING_PROFILE
      ? { provisioningProfile: process.env.MAS_PROVISIONING_PROFILE } : {}),
    ...(process.env.MAS_BUILD_NUMBER
      ? { bundleVersion: process.env.MAS_BUILD_NUMBER } : {}),
    artifactName: 'dyworker-${version}-mas-${arch}.${ext}',
  },
  masDev: {
    // 本机开发包无需可信时间戳；发布包继续使用默认的苹果时间戳。
    timestamp: 'none',
    ...(process.env.MAS_DEVELOPMENT_PROFILE
      ? { provisioningProfile: process.env.MAS_DEVELOPMENT_PROFILE } : {}),
  },
};
