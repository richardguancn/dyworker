// 普通下载版：要求 Developer ID 正式签名，安全检查由交付前的独立步骤完成。
const { build } = require('../package.json');

module.exports = {
  ...build,
  extends: null,
  forceCodeSigning: true,
  publish: null,
  directories: { ...build.directories, output: 'output/developer-id' },
  dmg: { ...build.dmg, sign: true },
  mac: {
    ...build.mac,
    target: ['dmg', 'zip'],
    identity: 'Dengyu Guan (FB2LB8L36P)',
    hardenedRuntime: true,
    notarize: false,
    extendInfo: {
      NSMicrophoneUsageDescription: '用于将你的语音转换为任务输入。',
      NSAppleEventsUsageDescription: '根据你的任务操作其他应用。',
    },
  },
};
