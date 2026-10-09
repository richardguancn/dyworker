# 官方设置控制器

来源：deepseek-ai/deepseek-harness 提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，`packages/client/ui-settings/src/`，0.2.1-alpha.1，MIT，许可证见 LICENSE。

五个 JavaScript 文件由 TypeScript transpileModule 生成，目标 ES2022 / ESNext；仅改写相对导入路径，没有改动功能。状态存储使用固定版本的官方 dsh-client-store。TypeScript 声明只描述宿主使用的接口。

宿主在 ../../dshSettingsBridge.ts 为每个选中的 DSH 会话提供独立通信实例。保存使用官方设置修改和版本冲突行为；切换会话不会把旧写入改送到新会话。未选择 DSH 会话时设置不可写。

event-projection.js 来自同一提交的 packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts，经相同方式编译；用它替换固定返回 false/空数组的历史占位实现。
