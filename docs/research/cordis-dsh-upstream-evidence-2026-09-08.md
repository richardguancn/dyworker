# Cordis / DSH 上游核查依据

2026-09-08 开始调研，2026-09-09 完成复核。固定源码基线：[c389f96bf3a9b6807cb71ed6bdad5849be0df6d8](https://github.com/deepseek-ai/deepseek-harness/commit/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8)。以下是该基线的事实，不是未来兼容承诺。已读取下载到临时目录的官方源码；没有安装依赖、执行插件或启动上游应用。

## 版本与框架差异

- 根项目版本 `0.1.3-alpha.2`，要求 Node `^22.19.0 || >=24.0.0`，开发包管理器 `pnpm@11.7.0`。源码声明不证明 Electron 或麒麟 ARM64 可用。[根配置](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/package.json)
- DSH 使用 `@deepseek-ai/cordis`，包版本 `4.0.2`，不能直接视为普通 `cordis` 的等价替代。[包配置](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/vendor/cordis/package.json)
- vendor 来源表仍记录最初的 `4.0.0-rc.7`，同时列有 19 项本地修改，涵盖生命周期清理、配置失败恢复、补丁装配和 Node 内部加载。来源表与当前包版本必须区分。[修改记录](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/vendor/README.md)

## 装配与启动

profile 组合 bundle，包通过 `dsh.profile`、`dsh.bundle` 声明；按 bundle 顺序、profile patch、home patch、命令行 patch 装配。patch 替换目标行的整份配置，不能误实现为逐字段深合并。支持的 Node 应用通过 `dsh` CLI 和 profile 启动；SDK 解析匹配版本的 DSH。`sdk-minimal` 是上游拥有的独立组合，旧私有直接配置载体已移除。DYWorker 自建有限 Cordis 宿主属于自行维护的兼容实现。[架构](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/docs/architecture.md)

官方桌面版单独管理准确版本、可写插件目录和运行进程；其桌面通信能力不能等同于普通 SDK。[桌面说明](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/docs/architecture.md#desktop-application)

## 工具兼容范围

`@deepseek-ai/dsh-tools` 声明 9 个 peer dependencies，包含 Cordis、agent、code-runtime、invariants、llm、scope、session、system-prompt、user-approval。类型依赖、执行依赖和动态服务依赖要分别核对，不能把每个 peer 都等同于必须启动的服务。[依赖](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/packages/core/tools/package.json)

工具运行类注入 `systemPrompt`；工具声明强制包含 `output.schema`、`output.render`，`execute` 返回符合声明的 JSON 值。还涉及作用域、调用身份、前后处理和取消。兼容桥不能只转发注册函数。[实现](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/packages/core/tools/src/index.ts)

Web Client 不消费工具的 `presentCall` / `presentResult`，而是选择单独的客户端渲染器。后端工具执行成功不证明 DSH 界面能在 DYWorker 显示。[文档](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/packages/core/tools/README.md)

## SDK 的明确限制

官方协议的已知限制说明：没有协议版本协商；没有取消与会话关闭方法；客户端通过关闭运行进程放弃轮次；服务器尚不使用 server-to-client 请求，审批应答为未来预留。因此不能直接承诺 DYWorker 的逐任务停止和交互确认体验。这是 SDK 限制，不代表 DSH 所有界面都缺失这些能力。[协议限制](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/packages/sdk/protocol/README.zh.md#known-limitations-and-deferred-work)

`sdk-minimal` 默认 `sandbox-policy.mode: danger-full-access`。最小组合不等于最小权限，不能直接作为受限插件环境。[配置](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/packages/bundle/sdk-minimal/cordis.patch.yml)

工程判断：SDK 路线必须先验证按任务独立进程、审批扩展或其他受支持通道。关闭共享进程不能当作无影响的单任务取消；上游补丁的维护成本也应计入路线选择。

## 分发与可信边界

根 LICENSE、Cordis 和工具包均声明 MIT；应保留适用版权与许可文本。第三方插件和传递依赖仍需逐项检查，不能由 DSH 许可推导所有插件许可。[根许可](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/LICENSE)、[Cordis 许可](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/vendor/cordis/LICENSE)

官方将 DSH 定位为实验性开发预览，不应作为不可信工作负载的唯一安全控制。插件加载、系统访问和模型工具审批是不同边界。首批应限定可信插件，独立进程仅改善故障隔离。[安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/c389f96bf3a9b6807cb71ed6bdad5849be0df6d8/SAFETY.zh.md)

## 尚未验证

尚未指定、安装和执行真实第三方插件；没有验证上游构建、模型服务、卸载、操作系统隔离或安装包。建议先选 2–3 个真实目标插件锁定版本，覆盖纯工具、带副作用工具、会话事件依赖三类，分别记录原样支持、需修改、缺依赖和不支持。
