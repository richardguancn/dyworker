# DYWorker 主进程架构（Cordis 宿主）

> 2026-09 起主进程底层架构从「main 直接 import + 工厂单例 + before-quit 手工清理链」
> 迁移到 Cordis（4.0.0-rc.10）插件/服务模型，参照 deepseek-harness（dsh）的框架用法。
> 渐进迁移：本分支完成地基与核心域，其余域按本文档模式增量跟进。

## 总览

```
electron/
  main.mts                    Electron 壳：窗口、app 生命周期、IPC 注册、领域回调
  host/
    context.mts               createHost()/disposeHost()：根 Context + 服务装配 + dispose
    events.mts                事件契约（tools/pre-execute 等，cordis 声明合并）
    io.mts                    原子 JSON 读写（串行化 + 敏感文件 0600）
    services/
      audit.mts               ctx.audit：审计 JSONL 落盘
      settings.mts            ctx.settings：设置读盘/解密/migrator/密文回写
      session-archive.mts     ctx.sessions：会话存档 + 合并写入器（dispose flush）
      agent.mts               ctx.agent：四类任务入口统一的 runAgent 装配与收尾
      runtime-domains.mts     运行期域生命周期插件（channels/telemetry/remoteMessages/backgroundTasks）
  agent.mts                   代理循环纯核心（不依赖 electron/cordis，node --test 直测）
  ...其余领域模块              均不 import electron；消费方经 host 或 main 注入
```

装配原则（对齐 dsh「一切皆插件」但组合由代码驱动，不引入 YAML loader）：

- **宿主**：`main.mts` 顶层 `await createHost({...})` 建根 Context；四个核心服务
  在 `createHost` 内构造并 await 根 fiber 激活后返回。
- **运行期域**：依赖 whenReady 阶段才就绪的对象（渠道管理器等）经
  `registerService(ctx)` 延迟挂载，返回 fiber 列表由 createHost 等待。
- **清理**：`app.on("before-quit")` 里 `disposeHost(ctx)` 一次触发全部
  effect 清理（逆序）：会话写盘 flush、域停机、审计收尾。

## 服务清单

| ctx 访问 | 服务 | 职责 | dispose 动作 |
|---|---|---|---|
| `ctx.settings` | SettingsService | 设置持久化/解密/migrator/密文回写（safeStorage 注入） | — |
| `ctx.audit` | AuditService | 审计 JSONL 追加与轮转 | — |
| `ctx.sessions` | SessionsService | 会话存档（拆分文件+index）与合并写入器 | flush 合并写入器 |
| `ctx.agent` | AgentService | 四类任务入口统一的 runAgent 装配、循环续跑、记忆落盘、sleeping→唤醒登记 | 外部工具路由 dispose |
| `ctx.channelManager` | 运行期挂载 | QQ/微信适配器管理 | stopAll |
| `ctx.telemetryController` | 运行期挂载 | 用量统计（默认关闭） | shutdown |
| `ctx.remoteMessages` | 运行期挂载 | 运营消息中心 | stop |
| `ctx.backgroundTasksManager` | 运行期挂载 | 后台任务 | cleanupAll |

## AgentService：四个入口的统一

桌面会话（`executeAgentRun`）、定时唤醒续跑（`resumeWake`）、定时任务
（`runScheduledTask`）、IM 渠道（`runChannelTask`）全部经 `ctx.agent.run(options)`
执行。服务负责公共装配（hooks/记忆页/技能/常驻规则/审计/MCP 工具/sleepGuard/
startBackgroundTask）与统一收尾（每轮记忆落盘、sleeping→唤醒登记、取消时撤回
唤醒、循环续跑推进）。入口只声明差异：

- 桌面：流式合并 emit、pending-map 审批（`agent:resolve-approval` IPC）、abort 信号、循环事件
- 无人值守（唤醒/定时）：收件箱审批与提问（`runningScheduledTask` 锁释放）
- 渠道：定制工具路由（send_media 等接管、switch_workspace 中途重建）、
  IM 审批卡片、`workspacePath` 以 getter 传入（切换后记忆/唤醒跟随最新目录）

领域函数（记忆/技能/唤醒/MCP）经 `createHost({ agentResolvers })` 注入；
各域插件化后逐项替换为 `ctx.<domain>` 直连。

## 事件契约（host/events.mts）

| 事件 | 分发模式 | 语义 |
|---|---|---|
| `tools/pre-execute` | waterfall | 工具执行前策略判定。监听器 `(name, args, current, next)` 返回 `{ action: "block" \| "require_approval", message? }` 或调 `next()`。用户/工作区钩子规则（runAgent hooks）优先；事件只能追加限制，不能放行。 |

审批请求链路保持原样（入口 requestApproval → pending-map/收件箱 → IPC →
ApprovalCard），后续按需事件化。

## 新增一个能力域（模式）

1. 领域实现放 `electron/<domain>.mts`，不 import electron（平台能力注入参数）。
2. 有状态/需清理的域：`host/services/<domain>.mts` 写 `Service` 子类，
   `super(ctx, "<name>")` 注册，清理动作放 `ctx.effect(() => () => {...})`。
3. 在 `context.mts` 装配（或运行期经 `registerService`）。
4. main 的消费点改为 `ctx.<name>`；`tests/host.test.mjs` 补装配/dispose 用例。
5. 领域函数纯逻辑直接导出，`node --test` 直测（沿用既有模式）。

## IPC 拆分（增量跟进，模式已确立）

main.mts 仍持有全部 `trustedHandle` 注册。拆分方向：按域抽
`host/plugins/ipc-<domain>.mts`（`{ name, inject: ["<service>"], apply(ctx) }`），
handler 从注入的服务取能力，通道名与 preload 保持不变。抽离一个域的步骤：
把对应 `trustedHandle` 块移入插件、经 `ctx.inject` 声明依赖、main 装配点
`ctx.plugin(ipcPlugin)`。桌面契约测试（desktop-contract）按源码文本断言，
拆分时同步迁移断言到新文件。

## 构建与测试

- 源码 `.mts` → `tsc`（bundler 解析、可擦除语法约束）→ `dist/electron/**/*.mjs`，
  产物文件名与旧布局一致；`scripts/build-electron.mjs` 附带拷贝
  preload/scripts/reviewer-policy 等静态资源。
- 测试：`node --test`（Node ≥22.18 原生类型剥离）直跑 `.mts` 源码；
  host/服务测试不依赖 electron。
- 打包：electron-builder `files: dist/client/**, dist/electron/**`，
  asarUnpack 指向 dist 布局。
- 渐进类型化债务：`electron/migration-types.d.ts`（Error 索引签名等宽限）
  与各处 `as any` 随域类型化逐步收紧删除。
