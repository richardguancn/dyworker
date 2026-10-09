# 官方浏览器模块系统

来源：deepseek-ai/deepseek-harness 提交 5badb15009ae1756c3afe0ae0cef1faafc290ccc，`packages/client/modules/src/client/`。
版本：0.2.1-alpha.1，MIT，许可证见 LICENSE。

四个 JavaScript 文件由同名 TypeScript 原文件通过 TypeScript `transpileModule` 编译，目标 ES2022 / ESNext，只将相对导入的 `.ts` 改为 `.js`。无功能改写。上游发布包只提供浏览器注册 bundle，不能直接作为 ES module 导入，因此保留这份浏览器安全的官方实现。

宿主适配在 ../../moduleLoader.ts：保留现有同步读取和诊断接口；实际注册、惰性执行、require.async、chunk 身份、代次失效、样式清理由官方实现完成。升级时必须同时更新固定基线和对应回归测试。
