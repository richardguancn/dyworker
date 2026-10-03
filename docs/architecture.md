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
      rules.mts               ctx.rules：常驻允许规则读写 + 可生效性校验
      skills.mts              ctx.skills：工作模板读写/内置模板合并/文件技能与覆盖表
      memory.mts              ctx.memory：记忆队列 + 内置认知覆盖表 + LLM Wiki 读写与整合
      inbox.mts               ctx.inbox：无人值守审批/提问的挂起-决议-超时-孤儿兜底
      scheduler.mts           ctx.scheduler：定时计划/唤醒存储 + 到期判定 + 调度循环
      runtime-domains.mts     运行期域插件（channels/telemetry/remoteMessages/backgroundTasks）
    plugins/
      rules-ipc.mts              IPC：rules:*            （inject: ["rules"]）
      skills-ipc.mts             IPC：skills:*/skill-libraries:*（inject: ["skills","settings"]）
      memories-ipc.mts           IPC：memories:*         （inject: ["memory"]）
      inbox-ipc.mts              IPC：inbox:*            （inject: ["inbox"]）
      schedules-ipc.mts          IPC：schedules:*/wakes:* （inject: ["scheduler"]）
      background-tasks-ipc.mts   IPC：background-tasks:* （inject: ["backgroundTasksManager"]）
      channels-ipc.mts           IPC：channels:get-status （inject: ["channelManager"]）
      telemetry-ipc.mts          IPC：telemetry:*/system-messages:*（inject: ["telemetryController","remoteMessages"]）
      git-ipc.mts                IPC：git:*             （领域直接 import git.mts）
      workspace-ipc.mts          IPC：workspace:*/workspace-pins:*
      traces-ipc.mts             IPC：traces:*
      usage-hooks-ipc.mts        IPC：usage:*/hooks:*
      audit-ipc.mts              IPC：audit:open         （inject: ["audit"]）
      window-ipc.mts             IPC：window:*
      attachments-ipc.mts        IPC：attachments:*
      clipboard-ipc.mts          IPC：clipboard:*
      app-update-ipc.mts         IPC：app-update:*       （更新器实例经 getter 注入）
      local-models-ipc.mts       IPC：reviewer-local:*/voice-local:*/tts-local:*
      speech-ipc.mts             IPC：voice:transcribe/tts:speak/audio:read-attachment
      settings-ipc.mts           IPC：settings:probe-credentials/list-models
      sessions-ipc.mts           IPC：sessions:save        （inject: ["sessions"]）
      app-ipc.mts                IPC：app:initial-state    （inject: ["sessions"]）
      browser-ipc.mts            IPC：browser:*           （webview 登记表经 getter 注入）
      browser-control-ipc.mts    IPC：browser-control:*
      browser-import-ipc.mts     IPC：browser-import:*
      appearance-ipc.mts         IPC：appearance:*        （外观状态经 bridge 访问）
      agent-ipc.mts              IPC：agent:*             （inject: ["scheduler"]，运行期状态经 deps）
      chat-ipc.mts               IPC：chat:complete
      sensitive-path-guard.mts   策略插件：敏感凭据路径强制审批（tools/pre-execute 消费者）
  agent.mts                   代理循环纯核心（不依赖 electron/cordis，node --test 直测）
  ...其余领域模块              均不 import electron；消费方经 host 或 main 注入
```

装配原则（对齐 dsh「一切皆插件」但组合由代码驱动，不引入 YAML loader）：

- **宿主**：`main.mts` 顶层 `await createHost({...})` 建根 Context；九个核心服务
  （audit/settings/sessions/agent/rules/skills/memory/inbox/scheduler）在 `createHost`
  内构造并 await 根 fiber 激活后返回。
- **运行期域**：渠道/用量统计/运营消息/后台任务由 `runtime-domains.mts` 的插件
  **创建 + 挂载 + 停机**：壳层传工厂（`() => createXxx({...deps})`），插件在
  `apply` 时调用它并 `ctx.provide` 出 `ctx.<name>`，实例存活期 = 插件 fiber 存活期，
  main 不再持有模块级域对象。插件间依赖用 `inject` 声明（运营消息 inject
  `telemetryController`：依赖未就绪则不 apply，而不是运行期读到 undefined）。
  注意 `createHost({ registerService })` 回调是在顶层 await 期间同步执行的，
  那时 main 模块中靠后的绑定仍处于 TDZ——运行期域不要走这个回调挂载
  （channelManager 曾因此让主进程启动即 `ReferenceError`）。
- **策略**：`tools/pre-execute` 的第一个真实消费者是
  `plugins/sensitive-path-guard.mts`（敏感凭据文件强制审批）。事件只收紧不放行，
  命中后走既有审批链路（审计/收件箱/IM 卡片），不另开治理通道。
- **清理**：`app.on("before-quit")` 在清空待决议收件箱后 `await disposeHost(ctx)`
  （1.5s 上限）一次触发全部 effect 清理。清理按注册的**逆序发起**
  （backgroundTasks → remoteMessages → telemetry → channels → agent →
  sessions flush → settings → audit），cordis 内部并发等待各 disposer；
  带异步停止动作的域（runtime-domains）disposer 返回 promise，因此
  `disposeHost` 解析完成即代表域停机会话 flush 完成。
- **打包**：`main` 指向构建产物 `dist/electron/main.mjs`，而 `dist/` 被 gitignore，
  所以 `npm run verify` 必须先跑 `build:electron`——发布 CI 与
  `package*` 脚本都只依赖 `verify`。

## 服务清单

| ctx 访问 | 服务 | 职责 | dispose 动作 |
|---|---|---|---|
| `ctx.settings` | SettingsService | 设置持久化/解密/migrator/密文回写（safeStorage 注入） | — |
| `ctx.audit` | AuditService | 审计 JSONL 追加与轮转 | — |
| `ctx.sessions` | SessionsService | 会话存档（拆分文件+index）与合并写入器 | flush 合并写入器 |
| `ctx.agent` | AgentService | 四类任务入口统一的 runAgent 装配、循环续跑、记忆落盘、sleeping→唤醒登记 | 外部工具路由 dispose |
| `ctx.rules` | RulesService | 常驻允许规则读写 + 「这类操作能否始终允许」校验 | — |
| `ctx.skills` | SkillsService | 工作模板读写、内置模板合并、文件技能发现与覆盖表 | — |
| `ctx.memory` | MemoryService | 记忆队列、内置认知覆盖表、LLM Wiki 页面读写与整合 | 清整合定时器 |
| `ctx.inbox` | InboxService | 无人值守审批/提问挂起、决议恢复、超时收尾、孤儿兜底 | — |
| `ctx.scheduler` | SchedulerService | 定时计划/唤醒记录存储、到期推进、调度循环与忙碌判定 | 清调度定时器 |
| `ctx.channelManager` | 运行期域插件创建 | QQ/微信适配器管理 | stopAll |
| `ctx.telemetryController` | 运行期域插件创建 | 用量统计（默认关闭） | shutdown |
| `ctx.remoteMessages` | 运行期域插件创建（inject telemetryController） | 运营消息中心 | stop |
| `ctx.backgroundTasksManager` | 运行期域插件创建 | 后台任务 | cleanupAll |

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
| `tools/pre-execute` | waterfall | 工具执行前策略判定。装配方必须写成 `ctx.waterfall("tools/pre-execute", name, args, null, () => null)`——cordis 的 waterfall 把**最后一个实参**当兜底函数（无监听器时调用它），其余实参原样传给监听器并追加 `next`；漏传兜底会让无监听器时对 `null` 调用而抛 `TypeError`，打断每个工具调用，同时使监听器签名错位。监听器 `(name, args, current, next)`（`current` 恒为装配方传入的 `null`）返回 `{ action: "block" \| "require_approval", message? }` 做决定，或调 `next()` 委托后续监听器；全部委托时兜底返回 `null`（放行，走默认审批策略）。用户/工作区钩子规则（runAgent hooks）先于事件判定，事件只能追加限制，不能放行。 |

审批请求链路保持原样（入口 requestApproval → pending-map/收件箱 → IPC →
ApprovalCard），后续按需事件化。

## 新增一个能力域（模式）

1. 领域实现放 `electron/<domain>.mts`，不 import electron（平台能力注入参数）。
2. 有状态/需清理的域：`host/services/<domain>.mts` 写 `Service` 子类，
   `super(ctx, "<name>")` 注册，清理动作放 `ctx.effect(() => () => {...})`
   （disposer 要 **return** 异步停机 promise，否则 disposeHost 不会等它跑完）。
3. 在 `context.mts` 装配；需要「创建 + 停机」的运行期域走插件（见
   `runtime-domains.mts`：壳层传工厂，插件 apply 时创建并 provide）。
4. main 的消费点改为 `ctx.<name>`；`tests/host.test.mjs` 补装配/dispose 用例。
5. 领域函数纯逻辑直接导出，`node --test` 直测（沿用既有模式）。

## IPC 拆分（增量跟进，模式已确立）

**main.mts 里已不再有任何 `trustedHandle` 注册**（原 122 个 handler 全部拆出，共 125 个通道，与重构前逐个一致）：

| 插件 | 通道 | 依赖 | 领域逻辑 |
|---|---|---|---|
| `rules-ipc.mts` | `rules:list/add/delete` | `inject: ["rules"]` | RulesService |
| `skills-ipc.mts` | `skills:list/set-enabled/delete/create/update`、`skill-libraries:search/install` | `inject: ["skills","settings"]` | SkillsService + 壳层注入的技能库能力 |
| `memories-ipc.mts` | `memories:list/update/delete/lint` | `inject: ["memory"]` | MemoryService |
| `inbox-ipc.mts` | `inbox:list/resolve/dismiss` | `inject: ["inbox"]` | InboxService（广播/系统通知由壳层注入） |
| `schedules-ipc.mts` | `schedules:list/save/delete/set-enabled/trigger-now`、`wakes:cancel-for-session` | `inject: ["scheduler"]` | SchedulerService（任务执行/忙碌判定由壳层 hooks 注入） |
| `git-ipc.mts` | `git:*`（11） | 无（直接 import `git.mts`） | 纯领域函数；仅"生成提交信息"经 deps 注入 |
| `workspace-ipc.mts` | `workspace:*`、`workspace-pins:save`（9） | 无（直接 import `workspace.mts`） | 纯领域函数 + 原生选择器/系统打开 |
| `traces-ipc.mts` | `traces:list/read` | 无 | 痕迹 jsonl 读取 |
| `usage-hooks-ipc.mts` | `usage:list/clear`、`hooks:list/open-user` | 无 | 读 JSON + 系统打开 |
| `audit-ipc.mts` | `audit:open` | `inject: ["audit"]` | AuditService |
| `window-ipc.mts` | `window:minimize/toggle-maximize/close` | 无 | 主窗口句柄由 getter 注入（窗口会重建） |
| `attachments-ipc.mts` | `attachments:choose/save-clipboard-image` | 无 | 原生选择器/剪贴板图片 |
| `clipboard-ipc.mts` | `clipboard:read-text/write-text/write-image` | 无 | 原生剪贴板 |
| `app-update-ipc.mts` | `app-update:status/check/download/install` | 无 | 更新器经 getter 注入（whenReady 后才创建/可被替换） |
| `local-models-ipc.mts` | `reviewer-local:*`、`voice-local:*`、`tts-local:*`（12） | 无 | 直接 import 各 `local-*.mts`；"已应用目录"经 deps 注入 |
| `speech-ipc.mts` | `voice:transcribe`、`tts:speak`、`audio:read-attachment` | 无 | 本地合成直接 import；设置读取/转写执行经 deps |
| `settings-ipc.mts` | `settings:probe-credentials`、`settings:list-models` | 无 | 直接 import agent.mts 的端点归一化/模型列举 |
| `sessions-ipc.mts` | `sessions:save` | `inject: ["sessions"]` | 存档走服务；渠道工作区同步经 deps |
| `app-ipc.mts` | `app:initial-state` | `inject: ["sessions"]` | 聚合会话/工作区/设置，各来源经 deps |
| `browser-ipc.mts` | `browser:*`（8） | 无 | webview 登记表经 getter 注入（登记表在 `web-contents-created` 维护） |
| `browser-control-ipc.mts` | `browser-control:*`（4） | 无 | 控制器实例经 deps 注入 |
| `browser-import-ipc.mts` | `browser-import:*`（5） | 无 | 直接 import `browser-import.mts` |
| `appearance-ipc.mts` | `appearance:*`（8） | 无 | 外观状态与窗口应用逻辑经 `bridge` 读写同一份 |
| `agent-ipc.mts` | `agent:*`（6） | `inject: ["scheduler"]` | 运行期状态（activeAgents/队列）与执行函数经 deps |
| `chat-ipc.mts` | `chat:complete` | 无 | 侧边聊天只读工具循环；请求/工具定义直接 import |

**壳层边界依赖包**：`main.mts` 里有一个 `shellDeps` 对象（`dataFile`/`readJson`/`writeJson`/
`dialog`/`shell`/`clipboard`/`nativeImage`/`getMainWindow`/`isTrustedRendererUrl` 等），
按域以 `{ trustedHandle, ...shellDeps }` 注入。只放"边界"能力，领域逻辑仍在域模块或
ctx 服务里——这是让剩余域能机械拆分的关键，避免每个插件各自重新拼一遍壳层 helper。
| `background-tasks-ipc.mts` | `background-tasks:list/start/stop/restart/get-logs` | `inject: ["backgroundTasksManager"]` | 运行期域 |
| `channels-ipc.mts` | `channels:get-status` | `inject: ["channelManager"]` | 运行期域 |
| `telemetry-ipc.mts` | `telemetry:status/delete-data`、`system-messages:list/mark-read/mark-clicked` | `inject: ["telemetryController","remoteMessages"]` | 运行期域 |

拆分方向：按域抽 `host/plugins/<domain>-ipc.mts`，插件用 `inject: ["<service>"]`
声明依赖，handler 只做「通道 → 服务方法」映射，领域逻辑留在 `ctx.<service>`；
只有 electron 边界的 `trustedHandle` 由壳层注入（host 不 import electron）。
通道名与 preload 保持不变。抽离一个域的步骤：
把对应 `trustedHandle` 块移入插件、领域逻辑上收为服务、main 装配点
`ctx.plugin(xxxIpcPlugin({ trustedHandle }))`。桌面契约测试（desktop-contract）
按源码文本断言，拆分时同步迁移断言到新文件。

**挂载时机**：`inject` 未满足时插件不 apply，相关通道也就不存在。若依赖的服务
在 whenReady 才创建（如 `telemetryController`），IPC 插件必须在**窗口创建之前**
挂载——渲染端一拿到窗口就会 invoke，晚了会拿到 `No handler registered`。
main.mts 里运营域初始化已前移到 `createWindow()` 之前。

## 构建与测试

- 源码 `.mts` → `tsc`（bundler 解析、可擦除语法约束）→ `dist/electron/**/*.mjs`，
  产物文件名与旧布局一致；`scripts/build-electron.mjs` 附带拷贝
  preload/scripts/reviewer-policy 等静态资源。
- 主进程产物在 `dist/electron/`，渲染产物在 `dist/client/`；`dist/` 不入库，
  因此 **`npm run verify` 先 `build:electron`**（发布 CI 与 `package*` 都走 verify），
  主进程代码里引用渲染产物用 `../client`（相对产物目录，不是 `../dist/client`）。
- 测试：`node --test`（Node ≥22.18 原生类型剥离）直跑 `.mts` 源码；
  host/服务测试不依赖 electron。
- 打包：electron-builder `files: dist/client/**, dist/electron/**`，
  asarUnpack 指向 dist 布局。
- 渐进类型化债务：`electron/migration-types.d.ts`（Error 索引签名等宽限）
  与各处 `as any` 随域类型化逐步收紧删除。

## 插件层（可安装/启停/配置 Cordis 插件）

宿主跑在 **`@deepseek-ai/cordis@4.0.4`**（DSH vendored 的那份，不是上游 `cordis`）。
这不是随便选的：插件里的 `Context`/`Service` 必须与宿主是同一份实现，否则插件的
`ctx.plugin` 永远挂不上。loader 也是 DSH 在用的同一套
（`@deepseek-ai/cordis-plugin-loader@1.0.5`）。

### 目录与文件

```
<userData>/plugins/
  package.json            profile 清单（与 DSH profile 同构，但**不共用**）
  dyworker.yml            用户层条目（与 dsh 的 cordis.yml 同方言）
  dyworker.bundles.json   已安装插件包记录（≈ dsh 的 package.json#dsh.profile.bundles）
  node_modules/<包>       插件包本体
  data/                   插件私有数据（ctx.storage 的相对路径落点）
```

刻意不叫 `cordis.yml`、不读也不写 `~/.dsh`：避免与 DSH 的 CLI 互相污染锁文件和启用状态。

### 装配模型（对齐 dsh）

```
用户层（dyworker.yml）
      + 各 bundle 的 patch（按安装顺序，applyEntryPatches 语义）
      = 合成条目 → 交给 loader 装载
```

`insert` / `disable` / `config` 覆盖、id 定位、name 校验、未命中告警都**直接复用上游
`applyEntryPatches`**（它同时被 dsh 的挂载路径与 `dsh --dump-config` 使用），
所以语义与 dsh 一致。卸载 = 丢掉记录重新合成，用户层原样恢复。

### 契约服务（插件只 inject 这些，不接内部 deps 大包）

| 服务 | 能力 | 说明 |
|---|---|---|
| `ctx.ipc` | `handle(channel, handler)` → 注销函数 | 来源校验统一在壳层完成；必须配 `ctx.effect` 绑定生命周期，否则停用再启用会撞 Electron 的 second handler |
| `ctx.storage` | `file/readJson/writeJson/readText/writeText/exists/remove` | 相对名只能落在 `plugins/data` 内（穿越拒绝）；绝对路径限定在 userData 内 |
| `ctx.window` | `current`（调用期 getter）/`focus`/`broadcast`/`dialog`/`shell`/`clipboard`/`nativeImage`/`nativeTheme` | 主窗口在插件挂载**之后**才创建，所以必须实时读取 |
| 已有服务 | `settings` `sessions` `skills` `memory` `inbox` `scheduler` `audit` `plugins` | 见「服务清单」 |

### 编写一个插件

```js
// 包主入口：一个普通 cordis 插件
export const name = "demo"
export function apply(ctx, config) {
  ctx.effect(() => ctx.ipc.handle("demo:ping", () => "pong"))
  const state = await ctx.storage.readJson("state.json", {})
}
export default { name, apply }
```

包可以声明 bundle patch（dsh 插件用 `dsh.bundle.patch`，一行不用改）：

```json
{ "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

```yaml
- insert:
    - id: demo
      name: demo
```

没有 patch 的包按「单条目安装」处理。已验证真实的 `dsh-context@0.62.2`
能被识别（`dsh.bundle.patch` → `insert: [{id: dsh-context, name: dsh-context}]`）。

### 已知限制

- **DSH 插件的 UI 半边跑不了**：DSH 把界面半边（`dsh.client`）交给它的 Web shell
  与 `dsh-client-*` 服务加载，DYWorker 没有客户端插件宿主。能加载的是 host 半边。
- 插件与宿主**同进程**，同进程不提供任何隔离；面向第三方开放前需要独立宿主进程。
- `shellDeps`（内部 25 个 IPC 插件的注入包）仍在，迁移到契约层是渐进过程，
  已完成样板：`plugins/audit-ipc.mts`。

### DSH 兼容矩阵

DSH 插件声明依赖的服务名（`export const inject` / `static inject` / `ctx.inject([...])`），
cordis 的 inject **只看名字不看形状**：名字缺失 → 永不 apply（界面上只是"装了什么都没发生"）；
名字撞上但语义不同 → apply 之后按 DSH API 调用失败。所以安装前先判定并把结论说清楚：

```
ctx.plugins.compatibility({ spec })   // 只判定不安装
ctx.plugins.install({ spec })         // 不兼容默认拒绝，返回 verdict/analysis/matrix
ctx.plugins.install({ spec, allowIncompatible: true })  // 显式放行 partial
```

判定三档：

| verdict | 含义 | 默认行为 |
|---|---|---|
| `runnable` | 主入口可 import，声明的服务本宿主都提供 | 允许安装 |
| `partial` | 同名但语义不同（如 `skills`），装上会踩 API 差异 | **拒绝**，需显式 `allowIncompatible` |
| `unsupported` | 缺依赖包导致 import 失败 / 需要本宿主没有的服务 / 含浏览器半边 | 拒绝 |

判定依据全部来自插件包自身：模块能否 import、模块导出的 `inject`、`lib/` 里
`ctx.inject([...])` 的静态扫描、`dsh.client` 声明、`dependencies`/`peerDependencies` 解析。
「声明依赖解析不到但主入口能 import」按**内联**处理，不阻断（实测 DSH 有这类包）。

**实测（本机 DSH 0.1.3-alpha.1 发布包）**：

| 插件 | verdict | 原因 |
|---|---|---|
| `@deepseek-ai/dsh-agent-instructions` | ✅ runnable | 未声明服务依赖，主入口可 import——**已实际安装并处于 active** |
| `@deepseek-ai/dsh-skill-filesystem` | ⚠️ partial | 依赖 `skills`，与本宿主同名服务语义不同 |
| `@deepseek-ai/dsh-token-meter` | ❌ unsupported | 需要 `sessionProjections`（本宿主未提供） |
| `@deepseek-ai/dsh-tool-bash` | ❌ unsupported | 需要 `tools` / `shell` / `systemPrompt` / `shellEnv` |
| `dsh-context@0.62.2` | ❌ unsupported | 含浏览器半边（`dsh.client`），需要 DSH 的 Web shell |

**结论**：DSH 插件不是孤立单元，多数依赖 DSH 自己的服务图（`tools`/`llm`/`agents`/
`sessionProjections`…）。本宿主能装的是**不依赖这些服务**的 host 插件；否则要么补
等价服务适配器，要么走官方 DSH 后端。这一点在安装时就直接讲明，不做"假装装上"。

### 插件工具的受管链路（ctx.tools）

插件注册的工具**不是**自由入口，四道约束写在 `host/services/tools.mts`：

| 约束 | 做法 |
|---|---|
| 名字由宿主生成 | 一律 `plugin__<插件>__<工具>`；`browser__` / `mcp__` / `plugin__` 是保留前缀，插件无法冒充内置工具或覆盖他人工具 |
| 风险不降级 | 风险以 `host/risk.mts` 的 `classify` 判定为准；插件声明的 `risk` 只能**抬高**，把有副作用的工具说成只读无效 |
| 内部调用也受管 | `execute(name, args, { source })`：`source !== "agent"`（插件在加载时/后台计时器/内部互调）且工具有副作用时**直接拒绝**并留痕——只保护模型入口是不够的 |
| 全程留痕 | 每次调用（含被拒绝的）`await` 写入审计：工具名、归属、riskClass、decision、会话/任务标识 |

`classify` 的兜底也收紧了：**未识别的命名空间工具**（`plugin__*`、`dsh__*` 等）一律
`RISK.EXTERNAL` / 有副作用。此前它们会落进"默认只读"，在只读模式下被直接放行。
已知命名空间（`browser__`、`mcp__`）与无命名空间的内置工具行为不变。

审批出口：插件工具默认**永远要问**（交互/替我审批模式均 `ask`，只读模式 `deny`）。
用户显式"始终允许"使用常驻规则 `{ kind: "plugin-tool", pattern: "plugin__a__b" }`，
与 `mcp-tool` 同款逐工具白名单；只读模式在常驻规则之前判定，不被覆盖。

内置插件迁移样板见 `host/plugins/audit-ipc.mts`（契约层）与 `host/plugins/plugins-ipc.mts`（管理面）。
