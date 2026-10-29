import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { build } = require('../package.json');
const developerId = require('../build/mac-developer-id.cjs');
const rules = build.mac.signIgnore.map(pattern => new RegExp(pattern));
const ignored = file => rules.some(rule => rule.test(file));
const app = '/output/DYWorker.app';

test('普通包和 Developer ID 包共用资源签名规则，并保留正式签名要求', () => {
  assert.deepEqual(developerId.mac.signIgnore, build.mac.signIgnore);
  assert.equal(developerId.forceCodeSigning, true);
  assert.equal(developerId.mac.hardenedRuntime, true);
  assert.equal(build.mac.timestamp, undefined, '正式签名仍使用默认可信时间戳');
});

test('语言、字体、PDF 资源及内置文档不逐个请求签名', () => {
  const resources = [
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/zh_CN.lproj/locale.pak',
    'Contents/Frameworks/Electron Framework.framework/Versions/Current/Resources/zh_CN.lproj/locale.pak',
    'Contents/Frameworks/Electron Framework.framework/Resources/zh_CN.lproj/locale.pak',
    'Contents/Resources/app.asar',
    ...['png','jpg','jpeg','gif','icns','xlsx','pptx','docx','json','wasm','bcmap','icc','pfb','ttf','otf','woff','woff2','nib','dat','bin'].map(ext => `Contents/Resources/resource.${ext}`),
    'Contents/Resources/app.asar.unpacked/node_modules/node-llama-cpp/llama/gitRelease.bundle',
  ];
  for (const resource of resources) assert.ok(ignored(`${app}/${resource}`), resource);
  assert.equal(ignored(`${app}/Contents/Resources/localeXpak`), false, '后缀前的点必须按字面匹配');
});

test('应用、辅助程序和所有原生模块继续签名，其他 bundle 也保留', () => {
  const executables = [
    app,
    `${app}/Contents/MacOS/DYWorker`,
    `${app}/Contents/Frameworks/DYWorker Helper.app`,
    `${app}/Contents/Frameworks/Electron Framework.framework`,
    `${app}/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`,
    `${app}/Contents/Resources/app.asar.unpacked/node_modules/native/addon.node`,
    `${app}/Contents/Resources/app.asar.unpacked/node_modules/native/libnative.dylib`,
    `${app}/Contents/Resources/app.asar.unpacked/node_modules/native/libnative.so`,
    `${app}/Contents/Resources/app.asar.unpacked/node_modules/native/native.bundle`,
    `${app}/Contents/Resources/app.asar.unpacked/node_modules/node-llama-cpp/llama/gitReleaseXbundle`,
  ];
  for (const file of executables) assert.equal(ignored(file), false, file);
});
