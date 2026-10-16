# src/App.tsx（1.5 万行）拆分方案

日期：2026-10-16。状态：方案已按本文执行完毕，本文同时作为执行记录与验收说明。

## 1. 背景与目标

`src/App.tsx` 拆分前为 15,064 行的单体文件（基线副本保存于 `docs/verification/performance-2026-10-16/baseline/src/App.tsx`）：

- `App()` 主组件本体约 7,900 行（第 6945–14853 行），文件内另有 80 余个辅助组件与函数；
- 全文件 284 处 `useState`、129 处 `useEffect`，其中约 130 个 state 集中在 `App()` 根部，任意状态变化都会触发整个 JSX 子树重建（详见 `performance-audit-App.md`）；
- 231 处 `window.dyworker.*` IPC 调用散落在组件体内，渲染、状态、副作用、业务操作四类代码互相缠绕，无法单独测试。

目标：把 App.tsx 拆成「纯函数库 → 状态层 → 功能面板 → 外壳 → 组装层」五层结构，App.tsx 只保留组件组装与少量本地逻辑；每一层可独立阅读、独立测试；不改变任何外部行为。

完成标准：类型检查与构建通过；既有测试全部通过；界面功能人工抽查无回归；App.tsx 降至可单屏把握的规模。

## 2. 目标结构

| 层 | 目录 | 职责 | 规模（行） |
| --- | --- | --- | ---: |
| 纯函数库 | `src/lib/`（6 个模块） | 文本清理、时长格式化、活动记录归并、文件类型判断、设置默认值、提示音，无 React 依赖 | 627 |
| 状态层 | `src/state/`（25 个模块） | zustand store（layout/settings/browser/composer/session/inbox/panel/view）、业务动作函数（sessionActions、gitActions、sendMessageActions 等）、运行时钩子（startupRuntime、sessionIpcRuntime、sessionStreamRuntime）、共享 ref 登记处 sharedRefs | 5,648 |
| 功能面板 | `src/features/`（13 个功能域、24 个文件） | conversation、settings、toolpanel、message、review、files、browser、skills、memory、plans、inbox、usage、annotations，每个域一个目录 | 8,035 |
| 外壳 | `src/app/`（4 个文件） | Sidebar、ShellLayout（标题栏/导航/窗口控制）、DebugConsole、icons | 906 |
| 组装层 | `src/App.tsx` | `App()` 组件：从 store 取状态、接线动作函数、组合面板，仅保留 7 个本地 `useState` 与 playCompletionSound 等少量组件内逻辑 | 2,552 |

依赖方向固定为 `App → app/features → state → lib`，禁止反向引用；IPC 调用集中在 state 层的 actions 与 runtime 模块，组件不再直接调用 `window.dyworker.*`。

## 3. 拆分原则

1. **小步迁移、每步可提交**：每次只迁一类逻辑，提交后立即可构建、可测试，出问题可单独回退。
2. **先组件后状态**：先抽离能独立渲染的面板组件（features、app），再迁移状态与副作用（state），避免一次性大改。
3. **字段名不变**：迁入 zustand store 的状态保留原 `useState` 的字段名与 setter 名，组件内改动最小。
4. **行为不变**：只移动代码与调整引用，不顺手改逻辑；行为修复另起提交（如验收期间的两处修复，见 `docs/performance-acceptance-2026-10-16.md`）。

## 4. 执行记录

按依赖方向分四个阶段，共 25 个 refactor 提交（fd792c3 → b1969f1，`git log` 可查）：

1. **面板组件抽取**（fd792c3 → b1f36c4）：设置弹窗与子面板、会话卡片、标注浮层、侧栏、标题栏外壳、会话区、工具面板迁入 `features/` 与 `app/`。
2. **状态迁入 store**（7c02fd5 → 5cffa3a）：布局/设置、浏览器、输入区、会话/运行态、收件箱/面板/视图状态迁入各 zustand store。
3. **运行时与副作用**（0c42d61、e4f2226、de7bb5b）：IPC 订阅迁入 `sessionIpcRuntime`，agent 事件流归约迁入 `sessionStreamRuntime`，会话辅助函数与共享 ref 抽到 state 模块。
4. **业务动作函数**（748f283 → b1969f1）：会话/工作区、Git、工具面板、输入区、语音/图片、发消息、设置/更新、计划任务、任务切换/导出依次迁入 actions；最后 45 个 effect 迁入 `startupRuntime`。

## 5. 验收结果

| 指标 | 拆分前 | 拆分后 |
| --- | ---: | ---: |
| App.tsx 行数 | 15,064 | 2,552 |
| 文件内 `useState` | 284 | 7 |
| 文件内 `useEffect` | 129 | 40（其中绝大部分在 App 组装层接线，业务 effect 已迁入 runtime 模块） |
| `App()` 组件本体 | 约 7,900 行 | 约 2,050 行（第 500 行至文件尾） |

- 界面类型检查、渲染层构建、主进程构建均通过；
- 测试：除 8 个依赖本机端口与沙箱执行的环境受限文件外全部通过，该 8 个文件在沙箱外 119/119 通过（与拆分前基线一致）；
- 功能验收与性能对照见 `docs/performance-acceptance-2026-10-16.md`：发送/停止/计划/唤醒、搜索定位、审批、浏览器面板、设置弹窗等抽查无回归。

## 6. 剩余事项（不属于本次拆分范围）

- `App()` 仍持有约 2,050 行 JSX 与 40 个 effect，进一步瘦身（如会话区 JSX 下沉到 `ConversationPane`）收益递减，暂不做；
- `SettingsDialog.tsx`（1,214 行）、`ConversationPane.tsx`（1,244 行）已接近需要二次拆分的规模，建议下次触及对应功能时顺带拆分，不单独立项；
- 性能优化的未完成项沿用 `docs/performance-optimization-plan-2026-10-15.md` 第 5、6 节清单。
