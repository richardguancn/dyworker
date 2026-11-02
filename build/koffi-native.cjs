const { copyFileSync, existsSync, mkdirSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

// Koffi 3 的平台二进制来自可选包。不能只信任打包器的间接依赖收集，
// 将目标平台文件放到 Koffi 自身支持的 build/koffi/<triplet> 查找目录。
exports.stageKoffiNative = function stageKoffiNative({ projectDir, unpackedDir, platform, arch }) {
  const resolve = createRequire(path.join(projectDir, 'package.json')).resolve;
  const nativeName = `@koromix/koffi-${platform}-${arch}`;
  let koffiDir, nativeDir;
  try {
    // koffi 的 exports 不公开 package.json，从公开入口找到根目录。
    koffiDir = path.dirname(resolve('koffi'));
    nativeDir = path.dirname(resolve(`${nativeName}/package.json`));
  } catch { /* 统一报错 */ }
  if (!koffiDir || !nativeDir) throw new Error(`缺少 ${nativeName}，无法打包 Windows 执行保护组件；请安装目标平台的可选依赖后重新打包`);
  const readPackage = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const koffi = readPackage(koffiDir), native = readPackage(nativeDir);
  if (native.version !== koffi.version) throw new Error(`Koffi 与 ${nativeName} 版本不一致（${koffi.version} / ${native.version}），拒绝打包`);
  const triplet = `${platform}_${arch}`;
  const source = path.join(nativeDir, triplet, 'koffi.node');
  const packagedDir = path.join(unpackedDir, 'node_modules/koffi');
  if (!existsSync(source)) throw new Error(`缺少 ${source}，拒绝打包`);
  if (!existsSync(path.join(packagedDir, 'index.cjs'))) throw new Error('应用包缺少 Koffi 加载程序，拒绝打包');
  if (readPackage(packagedDir).version !== koffi.version) throw new Error('应用包中的 Koffi 版本不一致，拒绝打包');
  const destination = path.join(packagedDir, 'build/koffi', triplet, 'koffi.node');
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  return destination;
};
