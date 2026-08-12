# DYWorker 与 Pi Agent Harness 架构对比与改进清单

> 对比基准：DYWorker（本仓库，Electron + React + TypeScript，核心循环 `electron/agent.mjs`）对照 Pi Agent Harness v0.84.x（`pi-project/`，TypeScript monorepo）
> 依据材料：`electron/agent.mjs`（3644 行全文）、`memory.mjs`、`skills.mjs`、`session-queue.mjs`、`risk.mjs` 与《Pi开源项目调研报告.md》《Agent循环机制深度解读.md》
> 结论先行：**DYWorker 在安全审批、记忆、子代理、MCP、本机操作、政务适配上明显强于 Pi；差距集中在「运行时架构的抽象度」——统一消息模型、事件流、工具钩子三段式、供应商能力目录、输出截断处理。** 下面按优先级给出改进点。

---

## 一、架构对照总览

| 维度 | DYWorker 现状 | Pi 的做法 | 评价 |
| --- | --- | --- | --- |
| 主循环 | 单层 `for round`：一次 LLM 调用 → 执行本批工具 → 结果回填 → 下一轮 | 双层：内层工具调用闭环 + 外层 follow-up 队列 | Pi 结构更清晰，DYWorker 用单层也能工作 |
| 消息模型 | 直接用 OpenAI 格式（system/user/assistant/tool + tool_calls），仅 2 套协议适配（Chat / Responses） | 内部统一 `AgentMessage`（可声明合并扩展自定义类型），LLM 边界才经 `convertToLlm` 转换 | **Pi 明显更优**，DYWorker 无自定义消息扩展点 |
| 事件流 | `emit()` 回调，事件类型为硬编码字符串 | `EventStream<T>` 通用异步流 + `AgentEvent` 联合类型，订阅者按注册顺序 await，`agent_end` 才算 settle | Pi 更通用、可组合、可测试 |
| 工具执行 | `switch(name)` 大分派 + try/catch，参数宽容解析不校验 | 三段式：prepareArguments → typebox 校验 → beforeToolCall 钩子 → execute → afterToolCall | **Pi 明显更优**：DYWorker 缺参数校验与钩子扩展点 |
| 工具并行 | 仅「全只读 + dispatch_agent」批次并行 | 默认 parallel：preflight 顺序、执行并发、结果按声明顺序回填 | 可借鉴，但 DYWorker 需保留审批串行化 |
| 输出截断处理 | 不检查 `finish_reason`/length；Responses 端 `incomplete` 直接抛错终止 | `stopReason=="length"` 时本批工具调用**全部判失败让模型重发**，防止执行「合法但残缺」的参数 | **Pi 更安全**，DYWorker 存在截断参数被执行的风险 |
| 上下文管理 | microcompact（裁剪旧工具结果）+ 结构化中文摘要压缩 + 服务端超限强制压缩重试 + token 估算 | transformContext 钩子（可插拔）+ compaction 摘要消息类型 | 功能上 DYWorker 更强，架构上 Pi 更钩子化 |
| 会话 | 消息快照 + 会话串行队列 + 工作记录（workingContext）跨轮续跑；无分支 | AgentSession 树形会话 + fork/分支 + 继续/浏览历史（pi -c / -r） | DYWorker 无分支能力 |
| 打断/排队 | 取消当前任务 + 新消息入会话队列（可 promote 提前） | steer 插话（工具跑完立即插入）+ followUp 排队追问，双队列 | Pi 语义更细，DYWorker 是粗暴版 |
| 记忆系统 | **有**：五类记忆、全局/工作区、相关度选取注入 | 无 | DYWorker 强项 |
| 技能/模板 | 文件 SKILL.md + 数据库工作模板；**命中后把完整 instructions 一次性注入系统提示词** | Skills 渐进披露：只给名称+描述，模型命中后下一轮注入全文 | Pi 的渐进披露更省 token、匹配更准 |
| 模型供应商 | 仅 OpenAI 兼容（Chat + Responses，DeepSeek 特化），上下文窗口硬编码 128k，视觉靠探测降级 | 40+ provider、10 种协议、模型目录 models.generated.ts、thinking 级别与预算、轮间换模型 | **Pi 明显更优**，但 DYWorker 场景（国内/内网模型）不需要 40+ |
| 审批/审计 | **极强**：五级审批模式、审核助手（allow/deny/ask + 熔断）、钩子、审计日志、常驻规则、工作区外路径授权 | 无内置权限系统（README 明说需容器化），仅 beforeToolCall 可 block | DYWorker 强项 |
| 子代理 | **内置** dispatch_agent（深度≤1、审批串行化） | 无内置，靠 extensions 示例 | DYWorker 强项 |
| MCP | **内置**（electron/mcp.mjs，mcp__ 前缀） | 无内置，靠扩展 | DYWorker 强项 |
| 定时/续跑 | **有**：sleep_until 挂起唤醒、任务续跑、会话队列 | 无 | DYWorker 强项 |

---

## 二、需要改进的点（按优先级）

### P0 —— 安全与正确性，建议尽快做

**1. 输出截断（finish_reason=length）时不执行工具调用**
- 现状：`electron/agent.mjs` 全文不读 `finish_reason`；Chat Completions 流式路径拼完 `tool_calls` 直接执行；Responses 端遇 `incomplete` 直接抛错终止整个任务。
- 风险：模型在长输出中被 token 截断时，工具参数可能「恰好合法但残缺」——比如 `edit_file` 的 `find` 只传了一半、`write_file` 内容被腰斩。现在会被当成完整参数执行，属于静默写坏文件。
- 建议（对齐 Pi）：在请求解析处读取 `finish_reason`（Chat）与 `incomplete_details.reason`（Responses，现状已有字段）；`finish_reason === "length"` 时把本批 tool_calls 全部判失败（`失败\n模型输出被长度上限截断，参数可能不完整，请重试`）回填给模型，而不是执行。仅当没有 tool_calls 时才按文本截断提示用户。
- 工作量：小（改 `requestModel` 返回值与 `runAgent` 工具分派之间的一处判断），风险低，收益直接。

**2. 工具参数 JSON Schema 校验（typebox/JSON Schema 层）**
- 现状：`parseArguments` 宽容解析，非法 JSON 静默成 `{}`；`toolDefinitions()` 里已有完整的 `properties/required` 声明，但没有被用来校验。
- 风险：模型传错类型（如 `days: "5"`、`limit: -1`、漏必填参数）时，错误要到工具内部才暴露，且报错文案不稳定，容易让模型原地打转。
- 建议：在 `toolDefinitions()` 之上生成校验器（无新依赖可手写轻量校验，或引入 typebox——Pi 同款），在 executeToolCall 开头、审批之前执行；校验失败直接返回固定格式错误消息（含缺哪些字段、类型不符在哪），并提示「不要重试同样的调用」。对齐 Pi 的 `validateToolArguments` 位置。
- 工作量：中。建议先覆盖写类工具（write/edit/append/export_*）与数值参数（calculate_workdays/sleep_until 等）。

### P1 —— 运行时架构抽象度，值得投入

**3. 统一消息模型 + convertToLlm 边界函数**
- 现状：循环内部直接操作 OpenAI 消息数组；压缩摘要、工作记录、AGENTS.md 等全部以 `user`/`system` 消息塞进数组，模型和 UI 看到的是同一条原始消息——「仅供展示」与「发给模型」的内容没有分层。新增一种消息类型（比如 `!` 命令回显、分支摘要）没有任何扩展点。
- 建议（对齐 Pi 的核心哲学）：定义内部 `AgentMessage` 联合类型（标准三种 + 声明合并扩展自定义类型），循环内只用它；在 `requestModel` 前加一个 `convertToLlm(messages)` 钩子做过滤与翻译。落地时可以只做最小版：先让「压缩摘要」从 `user` 消息升级为独立的 `compactionSummary` 类型（持久化时保留、转换时包 `<summary>` 块），再逐步把 workingContext、AGENTS.md 也纳入。
- 收益：为多协议、调试回放、遥测、远程会话（Pi 有 CBOR protocol 包）铺路；循环与 LLM 供应商彻底解耦。这是本次对比里**架构价值最高的一条**。
- 工作量：中-大，但可以分两步（先自定义类型 + 转换函数，再迁移现有注入点）。

**4. 事件流抽象：从 emit() 回调到可订阅事件流**
- 现状：`emit({type, ...})` 直接推给渲染端，事件种类硬编码（activity/assistant-text/debug-log/context-usage/plan-update/file-change/memory-saved 等），没有完成语义——UI 只能靠消息流自己判断「这轮跑完没有」。
- 建议：引入一个轻量 `EventStream`（Pi 的 `event-stream.ts` 只有约 60 行：push + 异步迭代 + 完成信号 + finalResult），把 `runAgent` 内部事件先入流，再在流外接一层转发给渲染端。事件类型收拢成文档化的联合类型。`agent_end`/任务结束事件带上最终消息，订阅者（UI、审计、遥测、测试）可以 await 完成。
- 收益：测试可以直接断言事件序列（现在是黑盒）；未来可做回放、暂停、遥测采样。
- 工作量：中。

**5. 工具执行三段式 + beforeToolCall/afterToolCall 钩子**
- 现状：一个巨型 `switch` 内联执行全部工具；审批管线是绕在 switch 外面的 if 逻辑，没有钩子抽象；没有 afterToolCall（结果后处理）扩展点。想给「某个工具的结果做统一后处理」（比如给所有写文件的返回里附 diff、统一脱敏）只能改 switch。
- 建议（对齐 Pi）：把 executeToolCall 拆成 prepare（找实现 + 校验参数 + beforeToolCall 钩子）→ execute（执行 + 可选流式结果）→ finalize（afterToolCall 钩子可改写结果/附加 terminate 提示）三段。现有审批管线（evaluateApproval / hooks / reviewer / audit）保留，但可以作为 beforeToolCall 钩子链的一部分被调用，让「新增一道检查」不必动循环主体。
- 收益：扩展点与循环解耦；钩子可组合（安全、审计、脱敏、统计各自一个钩子）。
- 工作量：中-大（switch 重构），建议与第 2、3 条一起做，一次把工具层理顺。

**6. 工具并行执行面扩大（保留审批串行化）**
- 现状：只对「整批全是只读或 dispatch_agent」并行；有写操作或含审批需求的批次全部串行。
- 建议（对齐 Pi parallel 模式）：preflight 阶段（校验 + 审批判定）保持顺序执行（审批串行化已有 approvalChain），执行阶段对无副作用的工具并发跑，结果按模型声明顺序回填。注意：DYWorker 现有串行实现天然保证审计顺序，改成并行时要给审计加批内序号。
- 收益：多文件读取、多搜索场景提速明显；与「同批并发只读」现状相比，主要收益是**混合批次**。
- 工作量：中。

### P2 —— 体验与扩展性，按需做

**7. Skills/技能渐进披露**
- 现状：`runAgent` 里按关键词匹配最多 3 个技能，把**完整 instructions** 一次性注入系统提示词——token 开销大、关键词匹配粗糙（`queryText.includes`），长技能文档会挤占上下文。
- 建议（对齐 Pi skills.ts）：系统提示词里只放技能「名称 + 一句话描述 + 位置」（可以放 10-20 个不心疼），模型命中后用现有的 `load_skill` 工具（或模型自己说要用）拉全文，下一轮再注入完整指令。同时给技能加「是否允许模型自行调用」标志（对齐 Pi 的 `disable-model-invocation`）。
- 收益：每轮省下大量 token；技能匹配从「关键词猜」变成「模型判断」。
- 工作量：小-中。

**8. 供应商能力目录（上下文窗口 / 视觉 / thinking）**
- 现状：`contextLimit` 默认 128000 硬编码；视觉能力靠 `hasInterfaceImages` 报错后降级重试（试错式）；模型切换时不知道各家上下文上限。
- 建议：建一个轻量模型目录（内置常见国内模型：DeepSeek V4 Flash/Pro、GLM、通义、Kimi 的上下文窗口、视觉能力、thinking 支持，注明核对日期——可复用 `memory.mjs` 里 builtinMemories 的模式），设置里选择模型时带上能力数据，`runAgent` 的 contextLimit 按目录取值而不是默认 128k。
- 收益：压缩阈值更准；视觉降级从「报错再试」变成「提前知道」。不必做 40+ provider（DYWorker 场景 OpenAI 兼容已够），但能力目录值得做。
- 工作量：小-中。

**9. thinking 级别管理（可选）**
- 现状：无思维级别概念；复杂任务与简单任务走同一个请求。
- 建议（对齐 Pi thinkingLevel + thinkingBudgets + prepareNextTurn）：至少支持「简单/标准/深度」三档思维预算（DeepSeek 等端点已支持 reasoning 参数），复杂任务（公文起草、长调研）可自动或手动提档。
- 工作量：中。依赖第 8 条的能力目录（知道端点是否支持 thinking）。

**10. 会话分支（可选，优先级最低）**
- 现状：无分支；「实验性改动后想回到岔路」只能靠历史搜索找旧消息。
- 建议：DYWorker 是 GUI 应用，需求与 CLI 不同，**不建议照搬树形会话**。若做，最小可行版是「工作记录快照」：任务开始时存一份 workingContext 快照，允许用户从某个历史任务「以此工作记录续开新任务」——比完整分支树便宜得多，且贴合现有架构。
- 工作量：小（复用现有快照机制）或大（完整分支），视需求定。

---

## 三、DYWorker 已经强于 Pi、保持即可的部分

| 能力 | 说明 |
| --- | --- |
| 审批/审计/安全 | 五级审批、审核助手 + 熔断、钩子、审计落盘、常驻规则、工作区外路径单次授权——Pi 完全没内置，这是 DYWorker 的护城河 |
| 长期记忆 | Pi 没有；DYWorker 的五类记忆 + 相关度选取已成熟 |
| 子代理 | Pi 靠扩展示例；DYWorker 内置且处理了递归、审批串行化、事件转发 |
| MCP / 本机应用操作 / 浏览器面板 | Pi 无；DYWorker 集成度更高 |
| 定时唤醒与续跑 | Pi 无；DYWorker 的 sleep_until + 会话队列 + 工作记录续跑是差异化卖点 |
| 上下文压缩实战能力 | microcompact + 中文结构化摘要 + 服务端超限强制重试，比 Pi 的 compaction 更贴合长任务实战（Pi 靠 transformContext 钩子留扩展点，实现上反而不如 DYWorker 完整） |
| 内容安全/网关容错 | content_filter 识别引导、网关 HTML 错误翻译、SSE 回退 JSON——国内模型场景刚需，Pi 没有 |
| 政务适配 | gov_search、公文检查、敏感信息扫描、工作日计算——DYWorker 独有 |

## 四、不建议照搬 Pi 的部分

- **40+ provider / 10 种协议**：DYWorker 的落地场景是国内模型 + 内网 OpenAI 兼容服务，维护 40+ 适配器是纯负担。做第 8 条的能力目录即可。
- **无内置权限系统**（Pi 靠容器化）：方向相反，DYWorker 绝不能学——审批体系是它的核心价值。
- **树形会话完整分支**：GUI 场景不划算，见 P2-10 的最小可行方案。
- **CBOR 远程会话协议**：DYWorker 无远程多端会话需求（QQ/微信渠道已覆盖远程派活），暂时不需要。

## 五、落地路线图建议

1. **第一批（1-2 周，纯增量，不动架构）**：P0-1 输出截断不执行工具、P0-2 参数校验（先覆盖写类与数值工具）、P2-7 技能渐进披露（改注入策略即可）。
2. **第二批（3-6 周，工具层重构）**：P1-5 工具三段式 + 钩子（审批管线归入 beforeToolCall）、P1-6 并行执行扩大。做之前先跑一遍现有测试（tests/ 已有 agent 相关测试）作为回归基线。
3. **第三批（架构升级，择机）**：P1-3 统一消息模型 + convertToLlm、P1-4 事件流抽象——这两条建议一起做，一次把运行时内核理顺，之后 P2-8 能力目录、P2-9 thinking 都建立在它之上。

> 贯穿原则：**每次改动保持 `electron/agent.mjs` 不依赖 electron**（现状很好，node --test 直接测），新抽象都放纯 JS 模块里，Electron 只在边界接线。
