# macOS Dock 专用图标

`dock-dark.png` 由 `icon.png` 导出，`dock-light.png` 由 `icon-light.png` 导出。保留原图案和颜色，仅为 Dock 的普通 PNG 更新方式补充留白；不要直接把铺满画布的原图传给 `app.dock.setIcon`。

- 总画布 1024 × 1024。
- 原图等比缩至 824 × 824，四边各加 100 像素透明留白。
- 图标、留白和 sRGB 配置保留在 PNG 中。
- 824 是本次对照本机 Chrome 图标测量后采用的大小，不是 Apple 规范中的固定数值。
- macOS Dock 更新和设置中的选项预览均使用这两份文件；Linux 图标和界面 LOGO 继续使用原有文件。

主进程构建将这两份文件复制到 `dist/electron/assets/`，并检查它们都存在。
