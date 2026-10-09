# 官方布局辅助模块

来源：DeepSeek Harness 固定提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，MIT 许可。

`primitives/` 原样保留该提交的焦点、输入法、菜单与提示组件和样式。提示组件保持锚点、原引用、焦点和鼠标行为，不额外包裹图表列。菜单选择器值来自同版本 `useModalLayer.ts`。
`index.js` 在构建时由固定发布包 `@deepseek-ai/dsh-client-ui-dockkit@0.2.1-alpha.1` 转换，保留布局算法、组件及 CSS 模块；React 使用应用共享实例，图标和提示使用应用已有入口。生成脚本位于 `scripts/build-client-helpers.mjs`。

转换用于避免把普通 ESM 包当作插件经典脚本执行，不扩展插件的服务或权限范围。
