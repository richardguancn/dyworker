# Kimi 原生工具适配任务简报（交给 deepseek-v4-flash 执行）

版本：v2（2026-08-17 依据官方文档逐条复核；deepseek-v4-flash 直接采信本简报的结论，无需再联网查文档）

## 0. 任务目标

在 DYWorker 仓库（/Users/gdy/Documents/My/App/dyworker，Electron + TypeScript）里，为「按模型/厂商适配原生能力」增加一个抽象层。第一版只适配 Kimi（月之暗面）开放平台的官方工具：12 个 Formula API 官方工具，以及可选的内置 `$web_search`。要求可扩展，便于后续为 DeepSeek / GLM / 通义等厂商继续加原生能力。只做窄改，不重构无关代码。

## 1. 官方资料核实结论（2026-08-17）

以下内容来自官方文档逐条核实：

- [如何在 Kimi API 中使用官方工具（Formula API）](https://platform.kimi.com/docs/guide/use-official-tools)
- [使用 Kimi API 完成工具调用（tool_calls，含流式）](https://platform.kimi.com/docs/guide/use-kimi-api-to-complete-tool-calls)
- [使用 Kimi API 的联网搜索功能（$web_search）](https://platform.kimi.com/docs/guide/use-web-search)
- [联网搜索定价](https://platform.kimi.com/docs/pricing/tools)
- [Kimi K3 API 工具调用最佳实践（动态加载 / tool_choice）](https://platform.kimi.com/docs/guide/kimi-k3-tool-calling-best-practice)
- [模型列表](https://platform.kimi.com/docs/models) / [K3 定价](https://platform.kimi.com/docs/pricing/chat-k3)

### 1.1 Kimi 有两套独立产品，这是本任务最大的坑

1. **Kimi 开放平台（Moonshot Open Platform）**：`base_url = https://api.moonshot.cn/v1`，按量付费，密钥从 platform.moonshot.cn 申请（sk- 开头），模型名如 `kimi-k3`。**官方工具（Formula API）和 `$web_search` 内置工具都只在这套端点上文档化。**
2. **Kimi 编程套餐（Kimi for Coding）**：`endpoint = https://api.kimi.com/coding/v1/chat/completions`，订阅制，密钥不同，模型名如 `k3` / `kimi-for-coding`。
3. 当前 `src/providers.ts` 里 Kimi 预设用的是第 2 套（`api.kimi.com/coding/v1/chat/completions`，模型 `k3`、`kimi-k2-0905-preview`）。因此「官方工具」不能直接套在现有 Kimi 预设上。

**结论（必须落实）**：本任务针对「Kimi 开放平台」端点实现原生工具。做法：保留现有 coding 预设不动，新增一个「Kimi（开放平台）」预设，`endpoint=https://api.moonshot.cn/v1/chat/completions`，模型以 `kimi-k3` 为主，`keyHint=platform.moonshot.cn 申请`。原生工具只在检测到 `api.moonshot.cn`（或 `api.moonshot.ai`）主机名时启用。不要假设 coding 端点支持 Formula API。

### 1.2 官方工具（Formula API）机制：4 步，服务端执行

12 个官方工具，formula URI 形如 `moonshot/{slug}:latest`（slug 用连字符，如 web-search、random-choice、code-runner；工具声明里 function.name 用下划线，如 web_search、random_choice、code_runner）。完整 URI 列表：

```text
moonshot/convert:latest
moonshot/web-search:latest
moonshot/rethink:latest
moonshot/random-choice:latest
moonshot/mew:latest
moonshot/memory:latest
moonshot/excel:latest
moonshot/date:latest
moonshot/base64:latest
moonshot/fetch:latest
moonshot/quickjs:latest
moonshot/code-runner:latest
```

调用链路（OpenAI 协议标准 function tool，但执行在 Kimi 服务端）：

1. `GET /v1/formulas/{uri}/tools` —— 返回 tools 数组（type=function 的 OpenAI 工具声明），`Authorization: Bearer`。
2. `POST /v1/chat/completions` —— 把工具声明追加到 tools（**每次请求都要完整带上**），模型返回标准 tool_calls。
3. `POST /v1/formulas/{uri}/fibers` —— body=`{"name": fn.name, "arguments": fn.arguments}`（arguments 原样透传，不要转义），返回 fiber，结果在 `context.output` 或 `context.encrypted_output`（web-search 是 protected，返回 encrypted_output，形如 `----MOONSHOT ENCRYPTED BEGIN----...END----`）。
4. `POST /v1/chat/completions` —— 带 assistant(含 tool_calls) + role:"tool" 结果，得到最终回答。

硬规则：

- 一次请求内 function.name 必须唯一，重复会 400 invalid_request_error。
- 模型可能返回多个 tool_calls，必须全部回填 role=tool 结果，且 tool_call_id 与 tool_calls[].id 一一对齐，否则请求非法。
- 多 formula 时自己维护 function.name -> formula_uri 映射。
- fiber 返回 status 可能非 succeeded，要当错误处理。
- 最佳实践：不要硬编码 function.name，运行时 `GET /formulas/{uri}/tools` 拿真实声明（并做进程内缓存），从声明里建立 name->uri 映射；URI 列表可以硬编码（12 个）。

### 1.3 内置 $web_search（builtin_function，可选，与 Formula 是两回事）

- 工具声明 `type="builtin_function"`，`function.name="$web_search"`（$ 前缀是 Kimi 内置函数约定，普通 function 不允许 $）。**不需要提供 parameters 说明**，只声明 type + name 即可。
- 流程和普通 tool_calls 一样，但执行时只需把 `function.arguments` 原样回传（`JSON.stringify(JSON.parse(arguments))` 即可，官方示例就是把 arguments 反序列化后再序列化返回），无需额外 HTTP 调用。模型看到结果后自己执行搜索并给最终回答。
- 可与普通 function 共存（同一次 tools 里自由混用 type=builtin_function 和 type=function）。
- 适用模型：kimi-k3 始终推理；kimi-k2.6 在思考开启状态下可用。
- 搜索结果的 token 数量可通过 `arguments.usage.total_tokens` 读取（可选做展示，v1 可不做）。

### 1.4 流式 tool_calls 规则（官方明确）

- `finish_reason` 在最后一个数据块才出现；判断是否工具调用建议看 `delta.tool_calls` 是否存在。
- 流式过程中先输出 `delta.content`，再输出 `delta.tool_calls`，必须等 content 输出完成再识别 tool_calls。
- 第一个数据块给出 tool_call.id 和 function.name，后续数据块只追加 function.arguments。
- 多个 tool_calls 用 `index` 字段区分，按 index 拼接 arguments。
- **DYWorker 现有流式解析器已经按此实现**（electron/agent.mjs 约 2522-2541 行：Map 按 index 累积 id/name/arguments），只需补回归测试，不用改解析器。

### 1.5 费用（2026-08-17 复核）

- **官方工具本体：限时免费**。官方原文「目前官方工具限时免费；当工具负载达到容量上限时，可能采取临时的限流措施」。fiber 执行是计费动作（官方原文「此步产生 tool_call 计费」），免费期结束后预计按次计费，具体价格以官方为准。
- **联网搜索**：触发一次 `$web_search` 收 0.03 元（官方联网搜索定价页），另按 token 计费：搜索结果计入 prompt_tokens（`total_tokens = prompt_tokens + search_tokens + completions_tokens`）。如果触发后不继续完成 tool_calls 轮次，只收 0.03 元调用费，搜索结果 token 不计费。Formula 的 web-search 工具链接到的也是「联网搜索价格」页。
- **模型 token 价格（kimi-k3）**：官方定价表格是 JS 渲染抓不到数字；多个独立信源一致报道为「输入 ¥20 / 1M tokens、缓存命中 ¥2 / 1M tokens、输出 ¥100 / 1M tokens」，另有缓存写入 ¥25 / 1M tokens。交付说明里标注「价格以 platform.kimi.com 定价页为准」。
- **K3 默认 reasoning_effort=max**，推理 token 消耗大；官方在编程 Agent 场景文档里建议控制成本（项目设置日消费预算）。
- 开放平台按量付费、无订阅制，与 Kimi 会员/Kimi Code 不同。

### 1.6 边界与隐私（safe-by-default 依据）

- **memory 工具**：把对话历史/用户偏好持久化到 Kimi 服务端 → **默认关闭**。
- **excel 工具**：分析 Excel/CSV，可能需要上传文件内容到 Kimi → **默认关闭**。
- **其余 10 个**（convert、rethink、random-choice、mew、date、base64、quickjs、code-runner、web-search、fetch）只发送参数/查询文本，不发送本地文件 → **默认开启**。其中 web-search、fetch 属联网读取，纳入现有联网审批口径（DYWorker 已有 `internetApprovalTools`：web_search/gov_search/fetch_web_page/browser__open）。
- quickjs / code-runner 在 Kimi 服务端执行代码，只接收代码文本参数，不涉及本地文件。
- **重要不稳定提示**：K3 定价页目前挂出「联网搜索（web_search）正在更新升级中，近期不建议使用该功能」——web-search formula 在免费/升级期间可能限流或不稳定，实现必须容错（失败回填文案、不中断任务），交付说明里如实标注。

### 1.7 模型现状（2026-08）

- `kimi-k3`：旗舰，1M（1048576）token 上下文，始终推理，reasoning_effort=low/high/max（默认 max）。官方工具示例均以 kimi-k3 实测。
- `kimi-k2.7-code` / `kimi-k2.7-code-highspeed`：256K，Coding 模型。
- `kimi-k2.6`：256K，思考/非思考。
- `kimi-k2.5` 与 `moonshot-v1` 系列已停止向新注册用户开放，全平台正式下线 2026-08-31；`kimi-k2` 系列已于 2026-05-25 下线。
- 官方对 K3 的建议：工具几十上百个时用「动态加载工具 + tool_choice + reasoning_effort」编排。**v1 不做动态加载**（记为后续优化，可显著降 token/费用），但要在风险里写明。

## 2. 现有代码落点（已核实行号，2026-08-17）

- `electron/agent.mjs`（约 4010 行，主要改这里，原生 ESM .mjs 不经过 tsc）：
  - `toolDefinitions()` 约 1158 行起，`toolDefinitionsWith(extraTools)` 约 1339 行。
  - `postChat()` 约 2046 行：`Authorization: Bearer`，`stream_options.include_usage` 相关。
  - `normalizeModelEndpoint()` 约 2107 行；`isResponsesEndpoint()` 约 2124 行。
  - `requestModel()` 约 2474 行：`selectedTools = tools || toolDefinitionsWith(extraTools)`，非 Responses 时 `basePayload.tools=selectedTools`、`tool_choice="auto"`。已有 `tools` 参数可注入。
  - 流式解析（delta.tool_calls 按 index 累积）约 2522-2541 行，已符合 Kimi 流式规则。
  - `runAgent()` 约 2857 行：`availableTools=toolDefinitionsWith(extraTools)` 约 3175 行；`toolSchemas` 由 availableTools 生成约 3179 行；requestCurrentModel 约 3281 行；`executeToolCall()` 约 3407 行起（大 switch 执行内置工具，default 分支约 3886 行路由 onExtraTool）。
  - `parseArguments()` 约 2572 行；`toolSummary()` 约 1878 行（对未知名有默认文案）。
- `electron/risk.mjs`：`internetApprovalTools`（16 行）、`internetReadTools`（39 行）、`classify`（46 行，未知工具名兜底返回 READ，不崩）。
- `src/providers.ts`：providerPresets、matchProvider、modelContextLimit。现有 Kimi 预设：id="kimi"，name="Kimi（月之暗面）"，endpoint=`https://api.kimi.com/coding/v1/chat/completions`，models=["k3","kimi-k2-0905-preview"]。
- `src/types.ts`：`ProviderSettings` 约 409 行。
- `electron/settings.mjs`：`normalizeProfiles` 约 163 行、`deserializeSettings` 约 186 行、`serializeSettings` 约 234 行。
- `src/App.tsx`：模型/服务商配置 UI。
- 测试：`tests/agent.test.mjs`（node --test，mock fetch 风格见文件顶部）。
- 注意：主进程 .mjs 不能 import `src/providers.ts`（渲染层 TS），所以主进程需要自己的厂商检测 helper。

## 3. 实施步骤（按序执行，每步跑通再下一步）

### Step 1：新建 `electron/providers.mjs`

导出（纯函数、可注入 fetchImpl，便于单测）：

- `detectProvider(endpoint)`：解析 host，`api.moonshot.cn` / `api.moonshot.ai` → `"kimi-open"`，其余 → null。
- `kimiFormulaBaseUrl(endpoint)`：由 endpoint 推导 base（`/chat/completions` 之前的部分）。
- `KIMI_FORMULA_URIS`：上文的 12 个 URI 常量数组。
- `fetchKimiFormulaDefinitions(fetchImpl, { baseUrl, apiKey, signal, enabledUris })`：并发 GET `/formulas/{uri}/tools`，返回 `{ definitions, nameToUri }`；**进程内缓存**（key=`baseUrl|uri`，缓存的是工具声明数组，可带短 TTL）；GET 幂等，遇 429/5xx 重试 1 次。
- `runKimiFormula(fetchImpl, { baseUrl, apiKey, uri, name, arguments, signal })`：POST `/formulas/{uri}/fibers`，body 为 `{ name, arguments }`，**arguments 原样透传不转义**；解析 `context.output ?? context.encrypted_output ?? ""`；`status !== "succeeded"` 抛错。fibers 是一次性计费动作，只对连接层失败保守重试 1 次。
- `isKimiFormulaToolName(name)`、`KIMI_WEB_SEARCH_DEFINITION`（`{ type:"builtin_function", function:{ name:"$web_search" } }`）。

### Step 2：`runAgent` 内工具装配（约 3175 行附近）

1. `const kimiOpen = detectProvider(settings.endpoint) === "kimi-open"`，且 `settings.enableNativeTools !== false`。
2. kimiOpen 时调用 `fetchKimiFormulaDefinitions`（**失败不要中断任务**：记日志后降级为不带公式工具继续），按 `settings.nativeToolsDisabled`（默认 `["memory","excel"]`）过滤。
3. 组装 `effectiveTools`：
   - 本地 `toolDefinitions()` 中**剔除 `web_search`**（与 Kimi 公式 web_search 重名，避免 400），`gov_search`、`fetch_web_page` 保留；
   - 追加过滤后的 Kimi 公式工具 definitions；
   - `settings.enableWebSearchBuiltin !== false` 时追加 `KIMI_WEB_SEARCH_DEFINITION`（v1 建议默认关闭，见 Step 5）；
   - 最后追加 `extraTools`（用户/MCP 等原样）。
4. `toolSchemas` 用 effectiveTools 重建（复用现有构建逻辑）；`requestModel` 调用改为传 `tools: effectiveTools`（requestModel 已有该参数）。
5. 非 kimi-open 端点完全走原路径，一行都不改。

### Step 3：`executeToolCall` 前置路由（约 3407 行，parseArguments 之后、本地审批流程之前）

1. `name === "$web_search"` → 直接返回 `{ message: { role:"tool", tool_call_id: toolCall.id, content: JSON.stringify(args) } }`（arguments 原样回传语义）。
2. `isKimiFormulaToolName(name)`：
   - 从 nameToUri 取 uri；
   - **web_search / fetch 走联网审批口径**：最小实现是「决策名映射」——把 kimi 的 web_search 映射为本地 `web_search`、kimi 的 fetch 映射为 `fetch_web_page` 参与 `approvalDecision`/`queuedApproval`/`auditRecord`（复用现有审批、审计、活动链路），执行仍然调 fiber；其余 8 个无本地副作用直接执行；
   - 调用 `runKimiFormula`；失败回填 `"失败\n<原因>"`，**不中断任务**；
   - 成功回填 `content = result`（encrypted_output 原样塞给模型）；
   - 提前 return，不进本地 switch / onExtraTool default。
3. 兜底：确保 `classify`/`auditRecord`/`startActivity` 遇这些新工具名不崩（classify 已有 READ 兜底；如需联网语义，可在 `electron/risk.mjs` 的 `internetReadTools`/`internetApprovalTools` 各加 kimi 的两个名字，或在映射名处处理，选改动最小的一种并在交付说明写明）。

### Step 4：`src/providers.ts` 新增 Kimi 开放平台预设

- 新预设：`id="kimi-open"`，name="Kimi（开放平台）"，`endpoint="https://api.moonshot.cn/v1/chat/completions"`，`models=["kimi-k3","kimi-k2.7-code","kimi-k2.6"]`，`defaultModel="kimi-k3"`，`keyHint="platform.moonshot.cn 申请（sk- 开头）"`，`contextLimits={ "kimi-k3":1048576, "kimi-k2.7-code":262144, "kimi-k2.6":262144 }`，`defaultContextLimit=1048576`。
- 现有 `id="kimi"` 预设仅把显示名改为 "Kimi（编程套餐）"（id 不变，不影响 matchProvider 与已保存配置）；models 列表**不动**（`kimi-k2-0905-preview` 已下线的事实写进交付说明即可，避免扩大改动）。

### Step 4.5：K3 reasoning_effort（小步，控费）

- K3 顶层 `reasoning_effort` 默认 max；为控费与速度，kimi-open 分支在 requestModel 的 payload 里固定传 `reasoning_effort: "high"`（一行），不做 UI。若测试发现 high 下工具调用不稳定，可回退 max，并在交付说明注明。

### Step 5：设置开关（settings / types / App）

- `src/types.ts` `ProviderSettings` 增加：`enableNativeTools: boolean`（默认 true）、`nativeToolsDisabled: string[]`（默认 `["memory","excel"]`）、`enableWebSearchBuiltin: boolean`（默认 false）。
- `electron/settings.mjs` 的 normalizeProfiles / deserializeSettings / serializeSettings 补默认值与序列化（缺失字段按默认值补齐，不破坏旧配置）。
- `src/App.tsx` 加最小 UI：原生工具总开关 + 默认关闭工具列表展示（简单可读即可）；**若 UI 改动风险大，退化为只做总开关，关闭列表固定默认，并在交付说明里说明**。

### Step 6：测试

新增 `tests/native-tools.test.mjs`（node --test + mock fetch，写法参考 tests/agent.test.mjs 顶部），覆盖：

1. `detectProvider`：api.moonshot.cn / api.moonshot.ai → kimi-open；api.kimi.com/coding、OpenAI 等 → null。
2. `fetchKimiFormulaDefinitions`：12 URI → name 映射、enabledUris 过滤、进程内缓存（二次调用不再 fetch）、GET 失败重试。
3. `runKimiFormula`：请求 URL/body 正确（name + arguments 原样）、context.output 与 context.encrypted_output 两种解析、status 非 succeeded 抛错。
4. requestModel 集成：kimi 开启时 effectiveTools 含公式工具、本地 web_search 被剔除**无重名**；关闭时行为不变；`$web_search` 开关生效。
5. runAgent 全链路：公式 web_search tool_call → POST fibers（断言 arguments 原样透传）→ role=tool 回填（tool_call_id 对齐）→ 最终回答。
6. `$web_search` 回传：content = JSON.stringify(parseArguments)。
7. 容错：fiber 500 / status=error → tool 消息 "失败..."，任务继续不中断。
8. 非 kimi 端点回归：现有 tests/agent.test.mjs 全绿。
9. 流式回归：delta.tool_calls 多 index 拼接（现有解析器已支持，补一条测试锁行为）。

收口命令：`npm run test:agent` → `npm test` → `npm run build:renderer` → `npm run verify`。

## 4. 完成标准（交付前自检清单）

1. 12 个 Kimi 公式工具能通过公式通道声明并执行（memory、excel 默认关闭）；kimi 开启时本地 web_search 被公式 web_search 替代、**无重名 400 风险**；`$web_search` 由开关控制（默认关）。
2. 非 Kimi 端点行为完全不变（现有测试全绿）。
3. 新单测覆盖 Step 6 的 9 个用例，`npm test` 全绿、`npm run build:renderer` 通过、`npm run verify` 通过。
4. 回复一份简洁中文交付说明：改了哪些文件、新增能力、默认安全边界（memory/excel 关、联网审批、$web_search 关）、验证结果（测试/build）、真实 Kimi 端到端未验证的原因（无密钥）与所需条件（用户提供 sk- 密钥后单独联调）。

## 5. 明确不要做的事 / 约束

- 不要发真实 API 请求（无密钥、网络受限、会产生费用），只用 mock fetch 单测 + 本地 build/test。真实 Kimi 端到端联调由用户提供密钥后单独进行。
- 不要碰 Docker / 发布 / 打包 / 数据库 SQL。
- 当前工作区是脏的（electron/agent.mjs、electron/settings.mjs、src/App.tsx、src/types.ts 等已有未提交改动）。在现有改动之上叠加，**绝不 git reset/checkout/clean**，不碰无关文件，不顺手格式化或清理 lint。
- 保持窄改：厂商能力抽象控制在最小可用边界（一个 providers.mjs + 少量 agent.mjs 接入点 + 预设/设置）。
- 不改动现有 coding 预设的模型列表与端点；不实现动态工具加载（记为后续优化）。

## 6. 风险与开放问题（交付说明必须提及）

- **web-search 官方提示正在升级、近期不建议使用**：公式 web-search 可能限流/不稳定，实现已容错；用户如频繁失败可先关掉该工具。
- **官方工具限时免费**：免费期结束后 fiber 按次计费（官方口径「此步产生 tool_call 计费」）；联网搜索 ¥0.03/次 + 结果 token 计入 prompt_tokens。恢复收费前需要 UI/说明提示用户。
- **token 价格**：K3 输入 ¥20 / 缓存命中 ¥2 / 输出 ¥100（每 1M tokens）为多渠道一致报道，官方表格 JS 渲染未直接抓到数字，以平台定价页为准。
- **按量付费无订阅**：建议用户在开放平台项目设置里配置日消费预算（官方 agent-support 文档建议）。
- **隐私**：memory/excel 默认关；quickjs/code-runner 服务端执行只收代码文本；fetch/web-search 联网读取走审批；系统提示「不得把工作区文件内容上传到外部服务」约束不变。
- **动态加载未做**：DYWorker 工具总量大，K3 官方最佳实践建议几十个工具时动态注入以省 token、提准确率；v1 全量携带，记后续优化。

## 7. 参考资料

- https://platform.kimi.com/docs/guide/use-official-tools
- https://platform.kimi.com/docs/guide/use-kimi-api-to-complete-tool-calls
- https://platform.kimi.com/docs/guide/use-web-search
- https://platform.kimi.com/docs/pricing/tools
- https://platform.kimi.com/docs/pricing/chat-k3
- https://platform.kimi.com/docs/models
- https://platform.kimi.com/docs/guide/kimi-k3-tool-calling-best-practice
