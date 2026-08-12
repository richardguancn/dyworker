# Agent 循环机制深度解读（packages/agent）

> 解读对象：`pi-project/packages/agent/src/agent-loop.ts` 及其配套（`types.ts`、`agent.ts`、`stream-fn.ts`、`proxy.ts`，以及 pi-ai 的 `EventStream`、coding-agent 的 `convertToLlm` 生产实现）
> 数据日期：克隆仓库 v0.84.x 状态

---

## 一、定位与设计哲学

agent-loop.ts 是整个 Pi 运行时**与模型无关的"思考—行动"内核**。它的设计核心只有一条原则：

> **循环内部全程只操作 `AgentMessage`，只有到调用 LLM 的边界才转换成各家 provider 需要的 `Message[]`。**

`AgentMessage` 是"标准 LLM 消息 + 应用自定义消息"的联合类型：

```ts
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

- 标准消息：`user` / `assistant` / `toolResult`（LLM 认识这三种）；
- 自定义消息：通过 TypeScript 声明合并（declaration merging）扩展，比如 coding-agent 就扩展了 `bashExecution`（`!` 命令记录）、`custom`（扩展注入消息）、`branchSummary`、`compactionSummary` 四种。

这样做的收益：循环的"记忆"（transcript）可以容纳 UI 通知、命令回显等**仅供展示、不发给模型**的消息，而把这些消息翻译/过滤成 LLM 能懂的格式，是一个独立可替换的 `convertToLlm` 钩子——各家 provider 的差异被全部隔离在这个边界函数里。

**分层关系**（理解整个包的关键）：

```
agentLoop() / agentLoopContinue()   ← 无状态低层循环（本文件，纯函数式）
        ↑ 被包装
Agent 类（agent.ts）                ← 有状态外壳：持有 transcript、工具、模型，
        │                             暴露 prompt/steer/followUp/abort 等 API，
        │                             维护 steering/followUp 两个队列
        ↓
coding-agent 的 AgentSession        ← 再上层：会话持久化、压缩、bash、分支（另有文档）
```

## 二、两个入口与事件流封装

```ts
export function agentLoop(prompts, context, config, signal, streamFn): EventStream<AgentEvent, AgentMessage[]>
export function agentLoopContinue(context, config, signal, streamFn): EventStream<AgentEvent, AgentMessage[]>
```

- **agentLoop**：注入一批新消息（`prompts`）启动循环；prompts 会复制进 context，先补发 `agent_start`/`turn_start` 和每条 prompt 的 `message_start`/`message_end` 事件。
- **agentLoopContinue**：不注入新消息，直接从当前 context 继续——用于**重试**（上次出错后再次尝试）。前提校验：context 非空，且最后一条消息不能是 `assistant`（因为 LLM 只接受以 user/toolResult 结尾的请求；assistant 结尾意味着"该轮到用户了"，provider 会拒收）。

两者都返回 `EventStream<AgentEvent, AgentMessage[]>`：

```ts
new EventStream(
  (event) => event.type === "agent_end",   // 结束条件：agent_end 事件
  (event) => (event.type === "agent_end" ? event.messages : []), // 结束时的最终消息列表
)
```

`EventStream`（pi-ai/src/utils/event-stream.ts）是一个**生产者 push、消费者 for await 拉取**的异步流：事件先入队，`agent_end` 到来时置 done 并 resolve 最终结果；`result()` 拿到最终消息数组。agentLoop 内部启动一个 fire-and-forget 的 `runAgentLoop`，把每个事件 push 进流，结束调 `stream.end(messages)`。

## 三、runLoop：双层循环主结构

`runLoop` 是所有轮次的真正驱动器。外层负责"排队消息"，内层负责"工具调用闭环"：

```ts
// 外层循环：agent 本来要停了，但 follow-up 队列里还有消息 → 继续
while (true) {
  let hasMoreToolCalls = true;

  // 内层循环：模型出工具调用 → 执行 → 结果回填 → 再让模型继续，
  // 直到模型不再调工具、且没有插队消息为止
  while (hasMoreToolCalls || pendingMessages.length > 0) {
    // ① turn_start（第一轮在入口处已发）
    // ② 注入 pendingMessages（steering 插队消息），入 context 并逐条发事件
    // ③ streamAssistantResponse()：调 LLM，流式写入 context，返回完整 AssistantMessage
    // ④ 若 stopReason 是 error/aborted → 发 turn_end + agent_end，直接退出
    // ⑤ 取出消息里的 toolCall 块；若有：
    //      - stopReason == "length" → 全部工具调用判失败（防截断参数）
    //      - 否则 executeToolCalls()，得到 { messages, terminate }
    //    hasMoreToolCalls = !terminate（只要本批不要求终止，就继续让模型消化结果）
    //    工具结果逐条推回 context
    // ⑥ turn_end 事件
    // ⑦ config.prepareNextTurn?.(...)：可换模型/换思维级别/换 context（下一轮生效）
    // ⑧ config.shouldStopAfterTurn?.(...) === true → agent_end 提前退出
    // ⑨ 再取一次 steering 队列 → 作为新的 pendingMessages
  }

  // 内层退出（模型不再调工具、无插队消息）→ 检查 follow-up 队列
  const followUps = config.getFollowUpMessages?.() ?? [];
  if (followUps.length > 0) { pendingMessages = followUps; continue; }
  break;  // 两边队列都空，循环真正结束
}
emit({ type: "agent_end", messages: newMessages });
```

**关键语义**：

- **turn = 一次 LLM 回复 + 它触发的一批工具调用**。一轮 `turn_start`…`turn_end` 只对应一次 provider 请求；模型要消化工具结果继续干活，会进入下一轮（再次 `turn_start`）。
- `hasMoreToolCalls` 的实际含义是"本批工具调用被执行且批次未被 terminate"——只要为 true，内层就继续让模型看到工具结果后接着回答。
- `newMessages` 是"本次循环新产生的消息"（区别于历史 context），随 `agent_end` 返回，供调用方增量持久化。

## 四、streamAssistantResponse：流式回复的就地更新

每次调用 LLM 前的四步预处理：

1. **transformContext（可选）**：在 AgentMessage 层面对整个历史做变换——典型用途是**上下文窗口管理**（裁掉旧消息、注入外部 context）。契约：不许抛异常。
2. **convertToLlm（必选）**：`AgentMessage[] → Message[]`，把自定义消息翻译/过滤成 LLM 认识的三类。这是"内部统一、边界转换"原则的落点。
3. 组装 `llmContext = { systemPrompt, messages, tools }`。
4. **getApiKey（可选）**：每次请求前动态解析 API key——专门为**会过期的 OAuth token**（如 GitHub Copilot）设计，工具执行耗时长时 key 可能已失效。

然后调用 `streamFunction(model, llmContext, { ...config, apiKey, signal })`，拿到 `AssistantMessageEventStream`，进入事件循环：

```ts
for await (const event of response) {
  case "start":            // 第一个事件：partial 消息入 context 尾部，发 message_start
  case "text_delta" / "thinking_delta" / "toolcall_delta" 等：
                           // 就地更新 context 最后一条消息（逐帧替换），发 message_update
  case "done" / "error":   // 取 response.result() 最终消息，覆盖 context 尾部，发 message_end
}
```

**就地更新**是核心细节：LLM 返回的 partial 消息在流式过程中一直放在 `context.messages` 最后一条的位置上被反复替换，保证"循环内可见的 transcript 永远是最新状态"；结束时用最终消息覆盖。这避免了"流式过程中循环读到旧状态"的竞态。

## 五、工具调用的完整生命周期

### 5.1 顺序 or 并行？

```ts
const hasSequentialToolCall = toolCalls.some(
  (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
);
if (config.toolExecution === "sequential" || hasSequentialToolCall) → 顺序执行
else → 并行执行
```

- 全局配置 `toolExecution`（默认 `"parallel"`）；
- 任一工具声明了 `executionMode: "sequential"`，则**整批**降级为顺序执行（防止该工具与其他工具并发出问题）；
- 顺序模式：逐个"准备→执行→收尾→发事件"；遇到 abort 就停。
- 并行模式：**准备阶段仍逐个顺序做**（保证 beforeToolCall 钩子的可预期性），通过后允许的工具**并发执行**；`tool_execution_end` 按完成顺序发，但最终 toolResult 消息按 assistant 声明的源顺序（`Promise.all` 后排序）发——保证 transcript 顺序稳定。

### 5.2 prepare → execute → finalize 三段式

每个工具调用都要经过三个可干预的环节：

```
prepareToolCall（每个调用）
  ├─ 按名字找工具；找不到 → 立即产出"Tool xxx not found"错误结果
  ├─ tool.prepareArguments?.(args)  ← 兼容层：把原始参数适配成 schema 要的形状
  ├─ validateToolArguments(tool, args)  ← typebox schema 校验（失败即错误结果）
  ├─ config.beforeToolCall?.({assistantMessage, toolCall, args, context}, signal)
  │     └─ 返回 { block: true } → 不执行，产出错误结果（可带 terminate: true）
  └─ 返回 { kind: "prepared", tool, args }

executePreparedToolCall
  ├─ tool.execute(toolCallId, args, signal, onUpdate)
  │     └─ 工具内部通过 onUpdate(partialResult) 流式上报进度 → tool_execution_update 事件
  │        注意 acceptingUpdates 标志：工具的 promise settle 后不再接收更新
  └─ 抛异常 → 捕获为 isError 结果（约定：工具失败要 throw，不要塞进 content）

finalizeExecutedToolCall
  └─ config.afterToolCall?.({assistantMessage, toolCall, args, result, isError, context}, signal)
        └─ 返回 { content? / details? / isError? / usage? / terminate? } 字段级覆盖结果
```

`beforeToolCall` / `afterToolCall` 是循环留给宿主的两道闸门：前者可在执行前拦截（审批、安全策略），后者可在执行后改写结果（审计、脱敏、截断超长输出）。

### 5.3 terminate：整批提前停止

工具结果、被 block 的 beforeToolCall、afterToolCall 覆盖都可以设置 `terminate: true`。规则是**全批一致才生效**：

```ts
function shouldTerminateToolBatch(finalizedCalls) {
  return finalizedCalls.length > 0 && finalizedCalls.every((f) => f.result.terminate === true);
}
```

即：本批所有工具结果都要求终止 → `hasMoreToolCalls = false`，跳过"让模型消化工具结果"的下一轮，直接去查队列。单个 terminate 不生效（防止误终止）。这是"工具跑完了还要不要再让模型说一句话"的控制开关。

### 5.4 length 截断保护（failToolCallsFromTruncatedMessage）

`stopReason === "length"` 表示输出被 token 上限截断。流式拼出来的工具调用参数可能**通过校验但内容残缺**（例如 JSON 参数被拦腰截断成恰好合法的对象）。Pi 的处理非常保守：**一个都不执行**，全部立即标记为失败，错误信息明确告知"响应触达输出上限，参数可能被截断，请用完整参数重新发起调用"，让模型自己重发。宁可多花一轮，不执行半截参数。

## 六、Agent 类：有状态外壳

`agent-loop` 本身是无状态的（context 全部由调用方传入），`Agent` 类（agent.ts）给它套上有状态外壳：

### 6.1 状态与队列

- **状态**（`agent.state`）：`systemPrompt`、`model`、`thinkingLevel`、`tools`、`messages`，加运行期只读字段 `isStreaming`、`streamingMessage`、`pendingToolCalls`、`errorMessage`。`tools`/`messages` 用访问器属性，**赋值即拷贝**（防外部篡改运行中数组）。
- **两个队列**（`PendingMessageQueue`，模式 `one-at-a-time` 默认 / `all`）：
  - `steeringQueue`：`steer()` 入队——**插话**，在当前工具批次跑完后立刻注入；
  - `followUpQueue`：`followUp()` 入队——**排队追问**，只在 agent 将要停止时才注入。

这两个队列通过 `createLoopConfig` 里的 `getSteeringMessages` / `getFollowUpMessages` 钩子接到 runLoop 上（每个 drain 点调用一次）。注意 `continue()` 的一个特殊分支：若最后一条消息是 assistant 但队列里有插队消息，会先以队列消息为 prompt 开新循环，而不是报错。

### 6.2 事件如何还原成状态（processEvents）

订阅者（UI、持久化、遥测）通过 `subscribe(listener)` 挂接，listener 收到 `(event, signal)`。Agent 内部先把事件还原到自身状态，再按注册顺序 await 所有 listener：

- `message_start` → 记 `streamingMessage`；
- `message_end` → **才真正 push 进 transcript**、清 `streamingMessage`；
- `tool_execution_start/end` → 维护 `pendingToolCalls` 集合；
- `turn_end` → 若有 errorMessage 记入状态；
- `agent_end` → 清 `streamingMessage`。

由于 `runLoop` 里的 `emit` 是 await 的（`agentLoop` 低层流是 push 不等；但 `Agent` 传入的 emit 是 `processEvents`，会 await 所有 listener），**assistant 的 `message_end` 处理形成了一道屏障**：工具 preflight（beforeToolCall）开始时，transcript 里已经包含请求该工具调用的 assistant 消息，外部订阅者也已看到完整的消息流——这就是 README 强调的"低层 agentLoop 是观察性的，Agent 类才保证 barrier"。

### 6.3 生命周期与失败兜底

`runWithLifecycle` 创建 `AbortController`，置 `isStreaming`，跑 executor，最后 `finishRun()`（清流式状态、resolve 等待者）。失败（executor 抛错）走 `handleRunFailure`：**不中断事件流**，而是合成一条 `stopReason: "error"/"aborted"` 的 assistant 消息，按正常顺序发 `message_start` → `message_end` → `turn_end` → `agent_end`，让所有订阅者看到统一的错误形态。`abort()` 中止当前 run；`waitForIdle()` 在 `agent_end` 事件**及其所有 listener** 都跑完后才 resolve——"agent_end 只表示不再有新事件，真正的 idle 要等听众散场"。

## 七、周边接线

### 7.1 StreamFn 契约

```ts
type StreamFn = (model, context, options?) => AssistantMessageEventStream | Promise<...>;
```

契约：**不许 throw 或 reject**，请求/模型/运行时失败必须编码成流内事件 + 最终消息的 `stopReason: "error"/"aborted"` + `errorMessage`。这让上层循环可以把"失败"当作普通消息处理，错误处理路径统一。默认值通过 `setDefaultStreamFn()` 注入——pi-agent-core 保持 provider 无关，由宿主提供；coding-agent 的 `core/sdk.ts` 在模块加载时执行 `setDefaultStreamFn(streamSimple)`（来自 `@earendil-works/pi-ai/compat`）完成接线。

### 7.2 proxy.ts：远程代理流

浏览器等场景无法直连 provider 时，`streamProxy` 把请求 POST 到代理服务器 `/api/stream`（服务端管 auth），按 SSE 逐行读取 `data:` 事件。为省带宽，服务端发的 delta 事件**剥掉 partial 字段**，客户端在 `processProxyEvent` 里重建 partial 消息（文本拼接、JSON 参数用 `parseStreamingJson` 增量解析）。这是同一套 StreamFn 契约的另一种实现——换 transport 不换循环。

### 7.3 convertToLlm 的生产实现（coding-agent/core/messages.ts）

```
bashExecution    → user 文本消息（命令+输出+退出码；!! 前缀的排除出上下文）
custom           → user 文本消息
branchSummary    → user 消息，包在 <summary> 标签里（分支归来摘要）
compactionSummary→ user 消息，包在 <summary> 标签里（压缩摘要）
user/assistant/toolResult → 原样直通
其它未知类型     → 过滤掉
```

`Agent` 的默认实现（agent.ts 里的 `defaultConvertToLlm`）只是简单过滤出三类标准消息；coding-agent 用上面这个更完整的版本注册。

## 八、事件时序图（速查）

**纯对话（无工具）：**

```
agent_start → turn_start → message_start(user) → message_end(user)
→ message_start(assistant) → message_update ×N → message_end(assistant)
→ turn_end → agent_end
```

**带工具调用（一轮消化）：**

```
… message_end(assistant, 含 toolCall)
→ tool_execution_start → tool_execution_update ×N → tool_execution_end
→ message_start(toolResult) → message_end(toolResult)
→ turn_end
→ turn_start                      ← 模型消化工具结果的新一轮
→ message_start(assistant) → … → message_end(assistant)
→ turn_end → agent_end
```

**steer 插话**：发生在某轮 turn_end 之后、下一次 LLM 调用之前（`getSteeringMessages` 注入）。
**followUp 排队**：发生在内层循环结束（无工具、无插队）之后、外层判断退出之前。

## 九、设计取舍小结

1. **内部统一类型、边界转换**：AgentMessage 贯穿全程，provider 差异锁死在 convertToLlm，新增供应商不改循环。
2. **无状态核心 + 有状态外壳**：agent-loop 可被任意宿主复用（Agent、SDK、代理），状态与副作用归 Agent 管。
3. **事件驱动解耦**：循环只发事件，UI/持久化/遥测全部订阅，互不阻塞核心逻辑（但 Agent 层用 await 制造屏障保证状态一致性）。
4. **钩子而非内建功能**：beforeToolCall/afterToolCall/shouldStopAfterTurn/prepareNextTurn 都是可选钩子——审批、压缩、换模型、提前停这些需求不必改内核。
5. **失败即消息**：LLM 错误、工具异常、abort 全部归一到事件流里，订阅者只有一条错误处理路径。
6. **安全保守**：length 截断的参数一律不执行；terminate 需要全批一致才生效。
