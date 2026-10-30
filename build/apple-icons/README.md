# DYWorker 图标素材

当前使用版本：按照用户最新要求，以 `../dyworker.svg` 为基础，只为浅色版本替换背景。图案路径、渐变、原有比例和外形保持不变；输出尺寸沿用 1024 × 1024。

- 画布：1024 × 1024，正方形。
- 色彩：SVG 使用 sRGB 插值；PNG 带 sRGB 色彩配置。
- 浅色背景：柔和浅灰 `#ECEDE8`。
- 深色界面 LOGO：直接使用 `../dyworker.svg`；本次没有修改这个文件。
- 原文件包含圆角外形，本次按用户要求保留，不继续使用此前另行居中缩放的排版。

## 文件

- `../dyworker-light.svg`：从原文件派生的浅灰背景 SVG。
- `../dyworker.svg`：用户指定的原始深色 LOGO。
- `../dyworker-dark.svg`、`foreground.svg`、`background-dark.svg`：上一版素材，本次未修改，保留备用；不是当前界面深色 LOGO 的来源。
- `background-light.svg`：同色的独立背景素材。
- `../icon-light.png`、`../icon-dark.png`：1024 × 1024 的完整 PNG；Windows/Linux 窗口图标使用它们。深色版本直接复用 `../icon.png` 的原始圆角图片，保留透明四角、原图案和比例。

此前查阅的 [Apple App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) 建议使用 1024 × 1024、未预裁圆角的分层素材。本次最新版本优先遵循用户“基于现有文件只改背景”的要求，保留原有外形；未导出或验证 `.icon` 文件，也未替换 macOS 安装包中的 `icon.icns`。
