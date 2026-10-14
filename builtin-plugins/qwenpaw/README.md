# QwenPaw 试用插件

通过独立本机服务打开 QwenPaw 2.2.1 的原版界面。插件只负责启动、关闭和打开页面，不重写上游助手、记忆或协作逻辑，不继承 DYWorker 的模型密钥和审批设置。

QwenPaw 在插件列表中默认停用，启用后新版 DYWorker 显示「QwenPaw 助手」侧栏入口。旧版可以从会话工具选择「QwenPaw 助手」，再点击「启动 QwenPaw」和「打开助手」。

## 安装运行环境

需要已安装 `uv`，安装脚本使用 Python 3.12，固定安装正式发布版 `qwenpaw==2.2.1`：

```sh
node scripts/setup-qwenpaw.mjs
```

默认安装到应用数据目录下的 `qwenpaw/runtime`，聊天与记忆保存在 `qwenpaw/data`，运行日志为 `qwenpaw/runtime.log`。可以通过 `DYWORKER_USER_DATA_DIR` 指定测试目录，通过插件配置 `python` 指定已安装环境的 Python。Windows 使用 `runtime/Scripts/python.exe`，macOS/Linux 使用 `runtime/bin/python`。

运行服务仅绑定 `127.0.0.1:18888`。端口占用时明确报错，不连接其他进程。停用插件或关闭应用时结束插件拥有的服务，不删除数据。匿名统计通过启动环境关闭。

首次进入原版页面后需要配置模型。QwenPaw 的模型、工具和操作确认在自己的界面设置，与 DYWorker 的设置分别管理；DeepSeek-Bot 的数据不会自动迁移。

上游项目：https://github.com/agentscope-ai/QwenPaw 。此目录包含 DYWorker 自行编写的连接插件，上游软件通过官方 Python 包仓库单独安装，没有将其源码复制为内置运行代码。

## 当前验证范围

2026-10-14，在 macOS 上用独立 DYWorker 窗口、独立数据和本机测试模型验证启动、中文界面、消息回复、停止工作及重开后聊天保留。未使用用户付费模型，尚未验证真实模型下的协作效果、浏览器操作、文档任务或 Windows/Linux 运行。
