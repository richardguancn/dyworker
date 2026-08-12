# Pi Agent Harness 开源项目调研报告

> 调研对象：https://github.com/earendil-works/pi
> 调研方式：项目主页 + 官网（pi.dev）+ 完整克隆源码逐层阅读
> 数据日期：以克隆时的仓库状态为准（v0.84.x，约 5,600 次提交）

---

## 一、项目一句话定位

**Pi 是一个极简的 AI Agent「工作马具」（harness）**：把 40 家以上 LLM 供应商统一成一套 API，再在上面跑一个带工具调用能力的 Agent 循环，最后套一个终端交互界面和一个自扩展的编码助手 CLI。官方 slogan 是「Adapt Pi to your workflows, not the other way around」——让马具适应你的工作流，而不是让你去适应马具。

## 二、项目档案

| 项目 | 内容 |
|---|---|
| 全名 | Pi Agent Harness |
| 仓库 | github.com/earendil-works/pi |
| 热度 | ★87.1k stars / 10.8k forks / 5,609 commits / 84 open issues |
| 协议 | MIT |
| 维护方 | Earendil Inc.（核心贡献者 @badlogicgames / badlogic，游戏开发框架 libGDX 的作者） |
| 官网 | pi.dev（含文档、演示视频、发行包浏览） |
| 技术栈 | TypeScript + Node.js（≥22.19）monorepo（npm workspaces），可用 Bun 编译成无 Node 的独立二进制 |
| 版本策略 | 所有包锁步同版本号（当前 0.84.x），patch=修 bug+加功能，minor=破坏性变更 |
| 相关项目 | pi-chat（Slack 自动化）、pi-share-hf（发布会话数据到 Hugging Face） |

## 三、它能做什么（功能总览）

### 1. 四种使用模式
- **交互模式（interactive）**：完整终端 UI（TUI），支持斜杠命令、快捷键、图片粘贴、树形会话导航；
- **打印/JSON 模式**：`pi -p "问题"` 一次性问答，适合写脚本；`--mode json` 输出结构化事件流；
- **RPC 模式**：通过 stdin/stdout 跑 JSON 协议，供非 Node 程序集成；
- **SDK 模式**：把 Agent 嵌入你自己的应用（参考案例：OpenClaw）。

### 2. 统一多供应商 LLM 接入（pi-ai 包）
- 覆盖 **40+ 内置 provider**：Anthropic、OpenAI、Google、Azure、AWS Bedrock、Mistral、Groq、Cerebras、xAI、DeepSeek、Kimi、MiniMax、Moonshot、智谱 Z.ai、通义千问、小米、NVIDIA、Hugging Face、OpenRouter、Ollama（经兼容层）、GitHub Copilot 等；
- 底层统一为 **10 种 API 协议**（openai-responses、anthropic-messages、google-generative-ai、bedrock-converse-stream、mistral-conversations 等）；
- 认证方式多样：环境变量 API Key、交互式登录保存、**OAuth 订阅登录**（Claude Pro/Max、ChatGPT Plus/Pro Codex、GitHub Copilot）；
- 会话中随时 `/model` 或 Ctrl+L 切换模型，Ctrl+P 在收藏模型间循环；
- 支持思维链（thinking）分级（off/minimal/low/medium/high/xhigh/max）、流式输出、延迟响应（deferred）、图像生成（OpenRouter）。

### 3. 编码助手能力（coding-agent 包）
- 默认给模型 4 个工具：**read / write / edit / bash**，另有 grep、find、ls 等只读工具可选；
- `!命令` 直接执行 shell 并把输出喂给模型，`!!命令` 执行但不进上下文；
- `@文件` 引用项目文件，Ctrl+V 粘贴图片；
- 自动读取 `AGENTS.md` / `CLAUDE.md`（全局 + 父目录 + 当前目录逐级加载）作为项目指令；
- 会话树管理：/fork 从历史任意节点分叉、/clone 复制当前会话、/tree 浏览切换分支，全部存于单一文件；/export 导出 HTML，/share 匿名分享成 gist。

### 4. 上下文工程（Pi 的核心卖点）
- **极简系统提示词**：默认提示词只有几行，靠按需注入而不是长篇预设；
- **Skills（技能）**：带 YAML 头部的 Markdown 文件，按任务描述渐进式加载（先在系统提示词里只放技能名+描述，模型需要时再读全文），不炸提示词缓存；
- **Prompt templates**：可复用的 Markdown 提示词，`/名称` 展开；
- **Compaction（压缩）**：接近上下文上限时自动总结旧消息，可自定义压缩模型与策略；
- **动态上下文**：扩展可在每轮前注入消息、过滤历史、实现 RAG 或长期记忆。

### 5. 扩展系统
- 扩展是 TypeScript 模块，可挂接：自定义工具、斜杠命令、键盘快捷键、事件监听、TUI 组件（状态栏、覆盖层等）；
- 官方示例 50+：子代理、计划模式、权限弹窗、路径保护、SSH 执行、沙箱、MCP 集成、画图扩展（@termdraw/pi）、DOOM 游戏扩展（pi-doom）；
- 扩展 + 技能 + 提示词 + 主题可打包成 **Pi 包**，`pi install npm:xxx` / `pi install git:xxx` 安装，从 npm 或 git 分发；
- 甚至可以让 Pi 自己给自己写扩展，`/reload` 热加载后继续。

### 6. 明确「不做」的清单（设计取舍）
无内置权限系统、无子代理、无计划模式、无权限弹窗、无 MCP、无内置 todo、无后台 bash（建议用 tmux）。这些能力留给扩展或容器方案，保持核心最小。

## 四、整体架构（包结构）

```
pi（monorepo）
├── packages/ai            @earendil-works/pi-ai        统一多供应商 LLM API（底层）
├── packages/agent         @earendil-works/pi-agent-core  Agent 运行时：循环、工具、状态
├── packages/coding-agent  @earendil-works/pi-coding-agent 编码 CLI：四种模式 + 会话管理
├── packages/tui           @earendil-works/pi-tui        终端 UI 库（差分渲染）
├── packages/telemetry     @earendil-works/pi-telemetry  供应商中立遥测契约
├── packages/protocol/client/server  @earendil-works/pi-*  远程会话 CBOR 二进制协议（RPC）
├── packages/evals         @earendil-works/pi-evals      评估套件
└── packages/session-backends/sqlite-node                 会话持久化后端（SQLite）
```

依赖方向：`ai` 在最底层，`agent` 依赖 `ai`，`coding-agent` 依赖 `agent + ai + tui + protocol`。`agent` 通过「默认 stream 函数」机制不直接依赖 `ai` 的 provider 目录，由宿主注入，保持分层解耦。

## 五、核心实现逻辑

### 1. 统一 LLM API 层（packages/ai）——怎么把 40 家 API 归一成一套

**关键抽象：`Model` + `Provider` + `Models` 集合。**

- **Model**（`types.ts`）统一描述一个模型：id、name、所属 `api` 协议、`provider`、baseUrl、是否支持推理（reasoning）、思维级别映射表、输入类型（文本/图片）、**价格费率**（$/百万 token，含分级定价 tiers）、上下文窗口、最大输出、采样参数、**兼容性开关 compat**。
- **Provider**（`models.ts`）是具体运行单元：拥有 id/name/baseUrl、**认证方式**（apiKey/oauth）、模型清单（`getModels()`）、流式请求入口（`stream()`/`streamSimple()`）。动态 provider（如 OpenCode）额外实现 `refreshModels()` 联网拉取最新模型目录。
- **Models 集合** 是个注册表（Map）：`setProvider` 注册，`stream()` 按模型找到所属 provider 并委托请求；所有请求前先走 `getAuth()` 解析凭据（API key / OAuth 刷新 / 环境变量），再带上已解析的鉴权头发出。
- **模型数据是生成的**：内置模型目录在 `models.generated.ts`（由脚本从各家供应商官方目录抓取生成），生成时间记录在 `.manifest.json`。所以「几百个模型」是静态快照 + 动态刷新组合出来的。

**兼容层是这套设计的精华**：各家 OpenAI 兼容 API 行为差异极大，`OpenAICompletionsCompat` 提供了 20 多个开关（是否支持 `store` 字段、`developer` 角色、`reasoning_effort`、thinking 格式是 openai/deepseek/qwen/chat-template……、缓存控制格式是 anthropic 式还是 prompt_cache_key 式、会话亲和头格式等），按 baseUrl 自动探测 + 模型元数据覆盖，从而让 llama.cpp、vLLM、SGLang 等本地推理服务也能被统一接入。

**统一流式事件协议 `AssistantMessageEventStream`**：所有 provider 最终都吐同一种事件流——`start` →（`text_start/text_delta/text_end`、`thinking_*`、`toolcall_*`）→ `done`（或 `error`），每个事件都携带当前「部分完成」的 AssistantMessage。

### 2. Agent 循环（packages/agent/agent-loop.ts）——整个运行时的心脏

**双层循环结构**：

```
外层 while(true)（负责 follow-up 排队消息）
  └─ 内层 while(hasMoreToolCalls || pendingMessages)（负责工具调用闭环）
       ├─ 注入 pending 消息（用户 steer 的插队消息）
       ├─ streamAssistantResponse()：调用 LLM，边流式边把 partial 消息写进 context
       ├─ 解析消息里的 toolCall（若有）
       │    ├─ 若 stopReason == "length"（输出被 token 上限截断）→ 全部工具调用判失败，让模型重发
       │    └─ 否则 executeToolCalls（并行或按工具声明顺序执行）
       │         ├─ prepareToolCall：找工具 → prepareArguments → typebox 参数校验 → beforeToolCall 钩子（可 block）
       │         ├─ executePreparedToolCall：跑工具，支持流式 partialResult 上报
       │         └─ finalizeExecutedToolCall：afterToolCall 钩子可改写结果
       ├─ 工具结果转成 ToolResultMessage 推回 context
       ├─ prepareNextTurn()：可在轮间换模型/换思维级别
       └─ shouldStopAfterTurn()：决定是否提前终止
  └─ 外层检查 followUpQueue，有则继续，无则退出
```

**关键设计点**：
- **内部统一用 `AgentMessage`**（含 role: user/assistant/toolResult），只在调用 LLM 的边界处通过 `convertToLlm()` 转成各家 provider 需要的 `Message[]`，隔离了内部状态与外部差异。
- **流式消息就地更新**：LLM 返回的 partial 消息直接放回 `context.messages` 最后一条并逐帧替换，保证 agent 状态始终是最新；`done/error` 时用最终消息覆盖。
- **steer（插话）与 follow-up（排队追问）双队列**：用户在 agent 干活时按 Enter 发的消息进 steering 队列（当前工具跑完后立刻插入），Alt+Enter 的跟进消息进 followUp 队列（agent 打算停时再继续）。队列可配置一次只取一条还是全部取走。
- **事件总线**：整个循环以事件方式向外广播（agent_start、turn_start、message_start/update/end、tool_execution_start/update/end、turn_end、agent_end），UI、持久化、遥测都靠订阅这些事件工作，与核心循环解耦。

### 3. Agent 类（agent.ts）——有状态的外壳

`Agent` 是 `agent-loop` 的低层循环的有状态包装：持有 transcript（消息列表）、tools、当前模型、思维级别；暴露 `prompt()`、`steer()`、`followUp()`、`continue()`（重试）、`abort()`、`waitForIdle()`、`reset()`、`subscribe()` 等 API。所有生命周期事件会广播给订阅者；`agent_end` 只是「不再有新事件」，真正 idle 要等所有监听器跑完。

### 4. 上下文构建（coding-agent/core/system-prompt.ts）

`buildSystemPrompt()` 动态拼装系统提示词：
- 工具列表只放一行简介（按实际启用的工具过滤）；
- 准则按工具能力自动推导（比如有 bash 没 grep/find/ls 才提示「用 bash 做文件操作」）；
- AGENTS.md 等上下文文件包进 `<project_instructions path=...>` 块；
- Skills 包进 `<available_skills>` 块（只列名称+描述+位置）；
- 最后附当前工作目录。整份提示词保持精简，把 token 预算留给真实内容。

### 5. Skills 机制（agent/harness/skills.ts）

- 递归扫描目录找 `SKILL.md`（目录名即技能名），也支持直接以 `.md` 文件作为根级技能；
- 解析 YAML frontmatter（name、description、disable-model-invocation），校验命名规则（小写字母数字连字符）；
- 尊重 `.gitignore/.ignore/.fdignore`，自动跳过被忽略的文件；
- 加载后只把「名称+描述」给模型（渐进式披露），模型命中后通过 `formatSkillInvocation()` 把完整内容包成 `<skill name=... location=...>` 块注入下一轮。

### 6. 会话管理（coding-agent/core/agent-session.ts）

- `AgentSession` 是四种模式共享的会话抽象：封装 agent 状态、事件订阅 + 自动持久化、模型与思维级别管理、压缩（手动/自动）、bash 执行、会话切换与分支；
- 会话以**树**存储：每次用户消息是树节点，fork/clone 产生分支，全部写进同一会话文件；`pi -c` 继续最近会话，`pi -r` 浏览历史；
- 持久化后端可插拔（默认 SQLite，session-backends 目录），协议包支持远程会话。

### 7. TUI 差分渲染（packages/tui）

- 组件模型：`Component` 接口只有 `render(width)`、`handleInput(data)`、`invalidate()` 三个核心方法；
- 渲染器（tui-main-screen.ts）保存上一次渲染的行数组，**逐行对比新旧内容，只重绘第一个变化行往后的部分**；变化行在视口上方时退回全量重绘；
- 性能技巧：使用终端「同步输出」（`\x1b[?2026h`）避免闪烁；Kitty 图像协议支持终端内嵌图片；用零宽 APC 序列 `CURSOR_MARKER` 让组件标注光标位置、TUI 据此移动硬件光标（保证输入法候选框位置正确）；
- 附带完整组件库：多行编辑器（带 undo 栈、kill-ring、模糊补全、自动补全、字导航）、Markdown 渲染、主题系统（可探测终端配色并自适应深/浅色）。

### 8. 扩展加载（coding-agent/core/extensions）

- 扩展是 TypeScript 模块（支持带依赖的 npm 包），通过 loader 在启动时用 jiti 加载；
- 提供 API 面：注册工具（可声明流式结果）、斜杠命令、快捷键、事件监听（session start/end、message start/end、turn 等）、UI 上下文（状态栏、提示、确认框）；
- 工具注册后可被模型调用，与内置工具走同一套执行管线。

### 9. 供应链安全（项目工程实践亮点）

- 直接依赖全部精确锁版本，内部包保持版本区间；`package-lock.json` 是依赖事实来源，预提交钩子阻止无授权改动 lockfile；
- 发布 CLI 附带 `npm-shrinkwrap.json` 固定传递依赖；带生命周期脚本的新依赖必须进显式白名单；
- CI 用 `npm ci --ignore-scripts`，定时跑 `npm audit`；发布前本地构建+隔离安装冒烟测试，再经 GitHub Actions OIDC 信任发布到 npm。

## 六、快速上手

```bash
# 安装（任一方式）
curl -fsSL https://pi.dev/install.sh | sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 进入项目目录启动
cd /path/to/project
pi

# 登录订阅供应商（Claude Pro / ChatGPT Plus 等），或设置 API Key 环境变量
/login          # 或 export ANTHROPIC_API_KEY=sk-ant-...

# 常用操作
pi -p "总结这个仓库"        # 一次性问答
pi -c                        # 继续最近会话
/@file "看一下这个文件"      # 引用文件
!npm test                    # 执行命令并把输出给模型
/model                        # 切换模型
/tree                        # 会话树导航
```

## 七、评价与注意事项

**亮点**
- 统一的 LLM 接入层成熟度高：40+ provider、OAuth 订阅登录、细粒度兼容开关，替换/切换模型成本极低；
- 「最小核心 + 强扩展」哲学执行得彻底，官方 50+ 扩展示例覆盖了子代理、MCP、沙箱等被砍掉的功能，用户可自选；
- 上下文工程（极简提示词 + Skills 渐进披露 + AGENTS.md + 可自定义压缩）在 token 成本与质量上确实有优势；
- 树形会话 + 分支 + 分享是区别于其他编码 agent 的独特体验；
- 工程规范（供应链安全、monorepo 纪律、发布流程）很扎实，适合学习。

**注意事项**
- **无内置权限系统**：默认以启动用户的完整权限运行，生产使用必须自行容器化/沙箱（官方提供 Gondolin、Docker、OpenShell 三种模式文档）；
- 刻意不内置子代理、计划模式等，需要者得装扩展或自己写；
- 版本迭代快（0.84.x，锁步发布），API 仍在演进，升级需看 CHANGELOG；
- 与 Claude Code / Codex 等相比，生态（插件数量、社区教程）还在成长期。

**一句话结论**：Pi 是把「多供应商统一 API、Agent 循环、终端 UI、编码助手 CLI」四层做进一个 MIT 开源仓库的完整 Agent 工具包；它的竞争力不在单点功能，而在于分层解耦的架构 + 极小的默认系统提示词 + 让用户（甚至让 Pi 自己）按需扩展一切的能力。

---

*本报告基于仓库源码（main 分支快照）与 pi.dev 官方文档整理；引用事实均出自源码注释、README 与官方文档，未发现需要保留的存疑数据。*
