// macOS 无开发者证书时的兜底签名：Electron 官方二进制只带 ld 链接器的 ad-hoc 签名
//（Sealed Resources=none），codesign --verify --deep 会报
// "code has no resources but signature indicates they must be present"，
// Squirrel/ShipIt 自动更新因此拒绝安装下载好的更新包。
// 这里用 ad-hoc 身份（-）重签名整个 bundle，让每个组件带上完整的资源封印，
// 深度校验即可通过，自动更新就能正常工作。
// 另外把指定要求（designated requirement）锚定到 bundle identifier：
// ad-hoc 默认的 DR 是 cdhash（每次构建都不同），electron-updater 下载完更新后
// 会用旧版本的 DR 校验新包，cdhash 必然不匹配（"代码未能满足指定的代码要求"）。
// 锚定 identifier 后，同一应用的新版本才能通过校验。
// 注意用 afterPack 而不是 afterSign：没有签名身份时 electron-builder 不会触发 afterSign。
// 之后如果配置了正式证书（CSC_LINK/CSC_NAME），electron-builder 会在本钩子之后用正式证书覆盖签名。
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { stageKoffiNative } = require('./koffi-native.cjs');

exports.default = async function afterPack(context) {
  const { Arch } = require('builder-util');
  const arch = Arch[context.arch];
  const nativeArch = arch === 'x64' ? 'amd64' : arch;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const isMac = context.electronPlatformName === "darwin";
  const resources = isMac ? path.join(appPath, 'Contents', 'Resources') : path.join(context.appOutDir, 'resources');
  const computerUseRoot = path.join(resources, 'computer-use');
  const computerUseApp = path.join(computerUseRoot, 'Open Computer Use.app');
  const nativeCommand = isMac ? path.join(computerUseApp, 'Contents', 'MacOS', 'OpenComputerUse')
    : path.join(computerUseRoot, context.electronPlatformName === 'win32' ? 'windows' : 'linux',
      nativeArch, context.electronPlatformName === 'win32' ? 'open-computer-use.exe' : 'open-computer-use');
  for (const file of [nativeCommand, path.join(computerUseRoot, 'LICENSE'), path.join(computerUseRoot, 'THIRD_PARTY_NOTICES.md')]) {
    if (!fs.existsSync(file)) throw new Error(`安装包缺少本机应用操作文件：${file}`);
  }
  if (process.platform === 'darwin' && isMac) {
    execFileSync('codesign', ['--verify', '--deep', '--strict', computerUseApp], { stdio: 'inherit' });
  }
  if (context.electronPlatformName === 'win32') {
    const unpackedDir = path.join(context.appOutDir, 'resources/app.asar.unpacked');
    stageKoffiNative({ projectDir: context.packager.projectDir, unpackedDir, platform: 'win32', arch });
    if (process.platform === 'win32') {
      const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
      const probe = path.join(unpackedDir, 'dist/electron/scripts/windows_package_probe.cjs');
      // cwd 设为应用目录，防止漏包时意外借用源码目录中的依赖。
      execFileSync(executable, [probe], { cwd: context.appOutDir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' },
        timeout: 90000, stdio: 'inherit' });
    }
  }
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const bundleId = context.packager.appInfo.id;
  const scratch = fs.mkdtempSync(path.join(context.appOutDir, '.ocu-sign-'));
  const signedApp = path.join(scratch, path.basename(computerUseApp));
  // Deep signing Electron would overwrite the already-signed helper's identity.
  fs.renameSync(computerUseApp, signedApp);
  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  } finally {
    fs.renameSync(signedApp, computerUseApp);
    fs.rmdirSync(scratch);
  }
  // 顶层再签一次，写入 identifier 锚定的指定要求（--deep 会破坏嵌套组件各自的 DR，所以分两步）
  execFileSync("codesign", ["--force", "--sign", "-", `-r=designated => identifier "${bundleId}"`, appPath], { stdio: "inherit" });
  // 构建期即做深度校验，签名不合格直接失败，不把坏的包发出去
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};
