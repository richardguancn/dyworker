# DS Bot 内置接入

2026-10-11 接入 `ds-bot@0.1.0`，上游提交 `351ae74b1c1bef0c21bf914a2687046a526190ee`。

## 使用

启用插件后，点击左侧“项目”后面的“机器人团队”，在主区域打开团队页面。在 DYWorker 模型设置中配置模型后，编辑总管选择模型，即可发送消息。创建第二个机器人后可以新建群聊，至少选择两位成员；群聊编辑页可设置管理员、群公告和回复方式。机器人“记忆”页面可以查看及整理记忆，“用量”页面显示团队累计用量。

聊天支持 Enter 发送、Shift+Enter 换行和复制消息；群聊输入 `@` 或点击输入框下方的 `@`，可选择本群成员或“所有人”。可用方向键选择、Enter/Tab 确认、Esc 关闭候选列表；回复中按 Esc 或点击停止按钮可停止当前回复。切换对话和返回普通任务会保留未发送的文字（当前应用窗口关闭后不保留）。

插件页可停用或重新启用“机器人团队”。对话、群聊、记忆保存在 DYWorker 数据目录的 `ds-bot/` 中。无需重新安装 GitHub 仓库，不使用失败安装的 staging 目录。

## 接入范围

保留上游团队运行代码，按 DYWorker 的模型设置提供模型，单独持有团队会话与保存目录，并在主区域提供操作界面。上游目录原样文件已逐一比对，28 个文件的来源和 SHA-256 记录在 `builtin-plugins/ds-bot/sources.json`；许可证及版权声明一并保留。

本适配版未接入上游整套主界面、独立浏览器、GitHub 连接、凭据面板或定时任务管理页面。模型工具列表也不提供会声称打开凭据卡片的工具。网页搜索插件未导入。可用功能详见 `builtin-plugins/ds-bot/README.md`。

## 2026-10-13：入口迁移与聊天交互验证

- 机器人团队改为 `workspace.page` 贡献；左侧“项目”之后显示入口，点击时在主区域打开，不加入普通任务的“轨迹/上下文”标签，也不再登记右侧标签。
- 插件停用时收回入口；重新启用后恢复入口。点击当前普通会话、首页、新建任务均可回到普通会话，团队不会继续占用主区域。
- 消息与输入框复用普通会话样式和 Markdown 显示；支持复制、Enter 发送、Shift+Enter 换行、停止当前回复，群聊 `@` 候选仅含本群成员及“所有人”。
- 每个机器人和群聊的未发送文字、最近选择保存在当前窗口的 `sessionStorage` 中，支持切换聊天、返回普通任务、页面重新载入及插件启停后恢复；不承诺关闭窗口后的草稿恢复。
- 修复切换聊天时旧请求覆盖消息的问题，以及 Esc 关闭候选后被选择事件重新打开的问题。

自动化检查 28 项通过：

```sh
node --test tests/bot-team-mentions.test.mjs tests/bot-team.test.mjs tests/bot-team-harness.test.mjs tests/builtin-plugins.test.mjs tests/plugin-ui.test.mjs
node scripts/build-plugins.mjs --check
npm run build:electron
npm run build:renderer
```

使用独立数据目录的 macOS Electron 窗口及本机测试模型验证：插件启停隐藏/恢复入口、新建机器人/群聊、`@写手` 仅写手回复、消息 Markdown 排版、复制成功提示、换行、切换聊天及返回普通任务后草稿保留、停止群聊回复、发送 60 行长消息后输入框仍在窗口内且无横向溢出。候选的方向键选择、Enter 确认、Esc 关闭及随后选择事件补测使用页面键盘事件；浅色/深色截图均已查看，深色检查通过切换页面主题属性进行。页面错误记录为空。未调用用户的模型服务，未替换 `/Applications/DYWorker.app`。

截图：[浅色聊天](../verification/bot-team-2026-10-13/team-chat-light.png)、[深色成员列表](../verification/bot-team-2026-10-13/team-mentions-dark.png)。

## 2026-10-11：首次接入验证

执行以下检查，共 117 项通过：

```sh
node --test tests/bot-team.test.mjs tests/builtin-plugins.test.mjs tests/host.test.mjs tests/plugin-host.test.mjs tests/plugin-management.test.mjs
npm run build:electron
npm run build:renderer
```

覆盖内置发现、默认启用、启停、面板注册、无模型时不发请求、选择与保留模型、机器人对话、提问回答、群聊两位成员回复、记忆整理及重启恢复、模型失败提示和重新发送恢复、停止群聊同时取消成员请求、拒绝读取团队以外的会话。

实际用 macOS Electron 窗口、独立临时数据和仅监听本机的测试模型服务验收了：无模型提示、选择模型、新建机器人、发送消息与显示回复、保存记忆、新建两位成员群聊、修改回复方式、显示成员回复、重新打开和重启后保留对话。检查并修正了深色界面文字和长对话使输入框滑出面板的问题。

验证调用的是本机测试模型，没有使用用户现有模型的付费接口。使用隔离的测试数据，未改动正在使用的应用数据；现有 `/Applications/DYWorker.app` 未替换。
