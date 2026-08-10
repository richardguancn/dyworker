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

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const appName = context.packager.appInfo.productFilename;
  const bundleId = context.packager.appInfo.id;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  // 顶层再签一次，写入 identifier 锚定的指定要求（--deep 会破坏嵌套组件各自的 DR，所以分两步）
  execFileSync("codesign", ["--force", "--sign", "-", `-r=designated => identifier "${bundleId}"`, appPath], { stdio: "inherit" });
  // 构建期即做深度校验，签名不合格直接失败，不把坏的包发出去
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};
