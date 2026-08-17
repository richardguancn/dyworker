# 对话「需求 → 实现」链路可视化 实施计划

状态：草案（待确认后实施）
日期：2026-08-14
范围：仅 DYWorker 桌面端（electron/ 与 src/ 渲染端），不涉及其他项目
关联：底层统一事件流与轨迹控制台共用，详见 `designs/trace-console-plan.md`；本计划是上层「过程链路」投影

## 0. 现状基线（已核实）

- 事件源：`electron/agent.mjs` 的 `runAgent` 在执行时已经通过 `emit` 输出类型化事件：`activity` / `activity-update`（thinking、各工具、finish）、`file-change`、`plan-update`、`approval-request`、`ask-user`、`loop-state`、`agent-finished` 等。
- 转发：`electron/main.mjs` 的 `executeAgentRun` 把这些事件经 `agent:event` 原样发给渲染端（带 sessionId 与 runId）。
- 渲染端现状：`src/App.tsx` 已把事件归约为每条消息的 `plan`（计划卡）、`activities`（活动列表）、`changes`（文件变更摘要/评审）、`durationMs`；会话存档包含这些字段，历史可回看。
- 缺口：
  1. 计划、活动、文件变更是三块并排的卡片，没有形成「需求 → 计划 → 执行 → 验证 → 交付」的完整链路；
  2. 活动没有挂到具体计划步骤下，看不出某一步具体做了什么、是否通过；
  3. `dispatch_agent` 子代理的活动被刻意过滤（不进主界面活动流），并行分支看不到；
  4. 验证通过/失败、失败后重试没有显式语义，只能从命令输出里猜；
  5. 没有一个统一的过程视图入口。
- 基线验证：2026-08-14 运行 `npm test`，387 项中 370 通过、0 失败、17 跳过（Linux 专属跳过项）。
- 工作树状态：存在进行中的未提交改动（`electron/agent.mjs`、`electron/main.mjs`、`src/App.tsx`、`tests/*` 等）。实施时在这些改动基础上窄改，不覆盖、不顺手重构。

## 1. 目标与完成标准

目标：一个任务内，用户能在界面上看到从「提出需求」到「解决/实现并交付」的完整链路，执行中实时更新，结束后历史可回看。

交付前检查清单（DoD）：

- 需求、计划、执行、验证、修复重试、交付六个环节在一条时间线里可见，状态实时流转；
- 子代理分支可见，且与主链路明显区分；
- 点击节点能定位到对应消息 / 文件差异 / 日志；
- 一个真实样例会话端到端走通：改文件 → 测试失败 → 修复 → 测试通过 → 交付，且包含一次子代理分支；
- `npm run verify` 全绿；老会话（没有新字段）仍按现有卡片显示、不报错；
- 现有聊天布局不被破坏，过程视图默认可折叠。

## 2. 方案要点

分三层推进：

- 事件层（`electron/agent.mjs`）：给活动打「步骤/阶段」标签，子代理事件走独立分支通道；
- 归约层（`src/types.ts`、`src/App.tsx`）：从事件构建任务链路树，新字段全部可选、向后兼容；
- 视图层（新增 `src/ProcessTimeline.tsx` 与 `styles.css` 样式）：时间线渲染与交互。

### 2.1 事件层改动（最小侵入）

1. `PlanStep` 增加可选 `id`（`plan-update` 时补稳定 id，用于挂活动）；`activity` 事件增加可选 `stepId`、`phase`（`plan` / `execute` / `verify` / `fix` / `deliver`）、`branch`（`parentId` / `title` / `depth`）。
2. `dispatch_agent` 子代理：保留「不混入主活动流」的现行为；新增转发子代理的 `activity` / `activity-update`，带分支标记，作为独立 trace 事件，父链用父活动 id 关联。
3. 验证类工具（测试、构建、校验类 `run_command` 等）打 `phase=verify`；同一目标在 `error` 之后再次执行打 `fix`，供渲染端画重试环。
4. `tests/agent.test.mjs` 补事件形状回归：分支事件、阶段标签、活动与步骤关联、旧路径不受影响。

### 2.2 归约层

- 事件监听处（`App.tsx` 的 `onAgentEvent`）不动现有 `plan` / `activities` / `changes` 字段，另建 `TaskTrace`：
  - `request`：本条用户消息摘要；
  - `steps`：`plan-update` 步骤（含状态与 id）；
  - 每个步骤下挂其活动（有 `stepId` 用 `stepId`，没有则按时间归到最近的步骤）；
  - `changes` 归到对应执行步骤；失败 → 修复 → 成功合并为「重试组」；
  - `branches`：子代理分支；
  - `deliver`：`agent-finished` 的最终答复与 `durationMs`。
- 上限保护：活动 / 节点超过上限时折叠（如每步骤活动 ≤ 50、分支深度 ≤ 3），避免长任务卡顿。

### 2.3 视图层

- 垂直时间线 + 状态色（进行中 / 成功 / 失败 / 等待）；分支缩进；失败重试画环；交付节点收口。
- 助手消息上加「查看过程链路」开关（默认折叠）；桌面宽屏可选右侧面板（二期）。
- 交互：点节点定位消息、打开文件差异、展开日志详情；尊重 reduced-motion。

## 3. 分阶段实施

- Phase 0 基线锁定：记录当前 `npm run verify` 结果与工作树改动边界；不迁移老数据。
- Phase 1 事件层：完成 2.1 全部改动并通过单测。
- Phase 2 归约层：构建 `TaskTrace`、补类型、加上限保护。
- Phase 3 视图层：时间线组件、折叠开关、点击联动。
- Phase 4 端到端验证：真实样例会话走查 + `npm run verify` + 老数据回退检查。
- Phase 5 收口：README 能力说明与截图、RELEASE_NOTES、提交。

## 4. 风险与取舍

- 子代理事件噪音：走独立分支通道，不污染现有活动列表。
- 阶段语义可信度：以事件打标为主、时间推导为辅，不依赖模型「自述」。
- 性能：折叠 + 上限；归约只在当前消息的监听器内更新，不动全局状态。
- 兼容：新字段全部可选；老会话无 trace 时回退现有卡片。
- 与现有未提交改动共存：窄改，Phase 0 先确认改动边界。

## 5. 验收清单

以第 1 节 DoD 为准，逐项验收；任何一项不通过，回到对应阶段修复并重测，不标记问题甩回。
