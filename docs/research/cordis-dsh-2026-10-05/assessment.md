**DYWorker 的 Cordis 与 DSH 插件兼容评估及修改方案**

评估日期：2026-10-05。结论依据当前工作区、DSH 官方源码和实际运行检查。本次没有修改应用功能、安装第三方插件或改动用户的 DSH 配置。

**结论与建议**

保留 Cordis。项目使用的是 DSH 同系列的 `@deepseek-ai/cordis`，框架选择正确，而且已经完成了相当一部分插件基础工作。现在的主要差距是 DSH 在 Cordis 之上定义的服务、事件、会话数据和浏览器模块行为，而不是缺少 Cordis 本身。升级 Cordis 版本不能单独解决这些问题。

当前应描述为“已有插件管理基础，支持部分 DSH 插件能力”，不能描述为“普遍兼容 DSH 插件”。现有实现对特定界面插件做了适配，但通用工具插件仍存在明确阻断；已启用状态、停止、停用和版本管理也需要完善。

建议采用两层支持方式：

1. **近期交付：明确清单内的工具和界面插件。** 保持 DYWorker 现有任务、历史、渠道、定时与唤醒功能，提供按版本验证的 DSH 兼容环境。兼容定义是插件包无需修改，声明支持的功能完整可用，而不是只要求安装成功。
2. **较完整的生态兼容：独立运行官方 DSH。** 深度依赖 DSH agent loop、子任务、上下文压缩、工作流或完整界面的插件进入独立运行环境，按官方配置装配。DYWorker 负责启动、任务入口、权限和展示衔接。其停止、审批、数据归属和界面衔接必须先验证，不能直接把 SDK 接上就宣布完成。

不要在当前应用的同一个 Context 中持续增加空服务来满足依赖。建议把 DYWorker 自有服务和 DSH 服务放在不同的 Context 中；对于外部插件，最终以独立进程承载。每个运行环境内部保持同一份 Cordis 实例，两个进程之间不要求共享 JS 对象。短期受控样例可以先用独立 Context 验证，但不能把它称为权限隔离。

**评估基线与完成标准**

| 对象 | 本次实际核对的版本或状态 |
|---|---|
| DYWorker | 0.2.2；HEAD `7ffab8784c80e28b147d6c646c905b0b08139a4f`，包含用户已有未提交修改，按当前文件内容评估 |
| 本地安装的 Cordis / loader / include | 4.0.4 / 1.0.5 / 1.0.9 |
| DSH | 本次拉取的 master 提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`；根包 0.2.1-alpha.1 |
| 该 DSH 提交内 Cordis / loader / include | 4.0.5-alpha.1 / 1.0.6-alpha.1 / 1.0.10-alpha.1 |
| 额外样本 | 当前市场包含的 dsh-office-tools、dsh-context 的作者公开源码/清单；仅用于需求对照，未安装运行 |

上游仍明确标为开发预览，可能出现不兼容变化。本文固定提交作为研究依据，不建议直接把全部依赖切到最新 alpha；实施时选定一套真实插件也支持的完整版本组合，验证后锁定。[DSH 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/README.md)

本次评估完成标准：核对现有能力；找到双方具体代码差异；运行现有测试；对关键缺口提供可复现结果；提出文件范围、实施顺序、验收条件及尚未验证的边界。这不是兼容改造完成的声明。

**已有工作可以保留**

- 主进程已使用 Cordis 管理服务与生命周期，并统一了一部分任务入口。
- 已采用官方 loader，以及官方 include 的 patch 合成逻辑；能够管理插件树、安装包、启停与配置。
- 插件数据目录与 DSH profile 分开，避免直接改动用户原有 DSH 环境。
- 插件工具已有独立命名、模型入口、风险判断和调用记录；旧评估中的“未知插件工具名按只读处理”不能照搬为当前结论，当前相关测试已经通过。
- 浏览器端已有模块加载器、界面位置、翻译、API 桥，以及上下文和轨迹的适配。
- 依赖修复已经按实际引用查找，并处理了 Cordis 共用与失败缓存问题。这些工作有价值，但还不足以构成通用 DSH 运行环境。

主要入口：[宿主装配](../../../electron/host/context.mts)、[插件管理](../../../electron/host/plugin-host.mts)、[工具服务](../../../electron/host/services/tools.mts)、[浏览器运行环境](../../../src/pluginRuntime/index.ts)。

**必须修改的差距**

| 优先级 | 差距与证据 | 用户可见影响 | 修改要求 |
|---|---|---|---|
| P0 | 插件路由使用模块全局表，注销函数不清理；宿主只导入 `clearPluginRoutes`，没有实际调用。补充检查发现停用和销毁宿主后接口仍返回 200 | 停用后仍可能执行插件功能；多个宿主也可能共用残留接口 | 按宿主实例、插件和运行代次登记；归属由宿主确定；注销只删除自己的记录，拒绝重名抢占，等待在途操作结束 |
| P0 | 缺服务的插件 `apply` 没运行，但 `entries()` 返回 `active: true`；兼容检查只读取数组形式 inject，对合法的对象形式漏判 | “已启用”与实际可用不一致 | 状态来自真实 fiber；区分已下载、待依赖、启动中、已启动、部分可用、失败；解析所有受支持的注入声明 |
| P0 | 兼容检查会在应用进程中动态 import 插件；合成样例证实检查阶段执行了顶层代码 | 点击检查并不等于只读检查，可能先执行后拒绝 | 清单静态分析与执行探测分开；执行探测移至受控子进程，不加载应用秘密或完整应用服务 |
| P0 | `ToolsService.execute` 不接收和传递 AbortSignal；主入口调用它也未传 signal | 用户停止任务后插件工作可能继续 | 将停止、超时和实际收尾连通；不合作代码由进程终止兜底，终止范围按会话隔离；完成状态以工作确实结束为准 |
| P1 | 当前 `tools.register` 要求 `plugin + handler`；DSH 使用 `execute + output.schema/render`，并有 scope、agent、上下文追加和结果展示等约定 | 原样 DSH 工具不能注册或执行 | 在 DSH 兼容 Context 提供真正的工具契约，优先复用锁定版本的官方 tools、scope、systemPrompt 组件；注册归属由宿主推导 |
| P1 | 双方都有 `tools/pre-execute`，但参数、返回值与后续事件不同 | 直接加载 DSH 策略插件会错接，不能靠同名事件互通 | 分离事件总线；显式转换前置审批、执行、后置处理、最终结果，确保 DSH 不能撤销 DYWorker 已作出的拒绝 |
| P1 | sessions/settings/skills 与 DSH 同名不同义；投影服务只专门处理 contextTimeline，没有通用 register | 待办、设置、工作流、上下文类插件不能完整工作 | 使用独立 DSH Context 消除命名冲突；实现或复用会话事件、投影注册、配置描述/修改/版本冲突、工作区与文件访问 |
| P1 | 浏览器模块立即执行 factory；不支持 require.async、chunk 身份；依赖主要处理 inject 和扫描 require，缺少完整 external 语义 | 新插件的延迟页面和分块功能失败；新旧加载行为不一致 | 优先接入固定版本官方 client-modules，再对接 DYWorker 的资源地址和界面；保留必要的旧包兼容分支 |
| P1 | 客户端 sessions/workspaces 返回空集合，部分运行能力固定返回 false/null，未知调用兜底 undefined | 界面出现但列表、切换、状态更新等功能缺失；问题被掩盖 | 真正实现目标插件依赖；不支持的能力显示明确原因，不能以空结果表示已实现 |
| P1 | 依赖修复会选择可用新版本，部分失败修复不带原版本范围；浏览器解析还会回退本机 ~/.dsh | 本机可用不能证明新机器可用；更新后组合漂移 | 独立、固定的运行环境清单和锁文件；在暂存目录安装并验收，失败恢复旧版本；正式验收不读取 ~/.dsh |
| P2 | 市场 `verified: true` 直接显示“本机已验证”，但未记录插件版本、宿主版本和通过范围 | 历史界面检查可能被理解成当前完整兼容 | 改为带版本和测试范围的支持记录；发现清单与已验证支持清单分开 |

以上 P0/P1 是本方案的执行顺序，不是外部安全等级认证。

本地证据：[路由服务](../../../electron/host/services/connection.mts)、[兼容分析](../../../electron/host/dsh-compat.mts)、[插件状态与依赖](../../../electron/host/plugin-host.mts)、[工具服务](../../../electron/host/services/tools.mts)、[事件声明](../../../electron/host/events.mts)、[模型调用入口](../../../electron/main.mts)、[投影适配](../../../electron/host/services/projections.mts)、[浏览器宿主](../../../src/pluginRuntime/clientHost.ts)、[模块加载](../../../src/pluginRuntime/moduleLoader.ts)、[占位能力](../../../src/pluginRuntime/dshClientShims.ts)。

上游对照：[工具执行约定](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/tools/src/index.ts)、[会话](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/session/src/index.ts)、[投影](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/session/session-projection/src/index.ts)、[配置服务](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/settings/settings/src/index.ts)、[浏览器模块](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/modules/src/client/system.ts)。

**三个代表样本说明为什么要补这些能力**

| 样本 | 从源码核对到的要求 | 目前结论 | 应验收的完整动作 |
|---|---|---|---|
| dsh-office-tools | 入口明确注入 tools、fs，文件访问依赖会话工作区 | 本项目缺 fs 服务，tools 约定也不同；目前不能原样正常启用 | 创建、读取、修改真实 Word/Excel 文件；取消写入；禁止越出批准目录；输出文件可打开 |
| 官方 dsh-tool-todo | 注册 todos 投影，注册 DSH 工具，按所属 agent 的会话写事件 | 当前没有通用投影 register；工具和会话也需要对齐 | 两个会话的待办各自更新；停用、重启、历史查看符合选定 DSH 版本语义 |
| dsh-context | 同时有后台和 web 部分，要求会话、设置、界面与客户端模块；本地已对 contextTimeline 做专门适配 | 可以保留已有适配，但不能外推为通用能力或当前最新版全部可用 | 真实请求的上下文统计、注入、压缩、详情、切会话、设置、停用与恢复 |

作者源码：[office-tools 入口](https://github.com/kw78/dsh-office-tools/blob/main/src/index.ts)、[office-tools 包清单](https://github.com/kw78/dsh-office-tools/blob/main/package.json)、[context 包清单](https://github.com/bowenliang123/dsh-context/blob/main/package.json)。这三个第三方链接指向动态分支，仅作本次读到的需求依据；实施阶段必须固定到提交和发布包。第三方作者声明兼容 DSH，不代表兼容 DYWorker。

官方待办源码：[dsh-tool-todo](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/todo/tool-todo/src/index.ts)。本次未新安装这些插件。测试中加载了本机已有 dsh-context 的客户端文件，但未运行它的完整后台与界面流程；上述兼容结论仍是源码判断和合成样例验证，不是完整插件验收。

**实现边界与具体修改范围**

1. 插件的 DSH 环境拥有自己的服务和事件；DYWorker 的 `ctx.tools`、`ctx.settings`、`ctx.sessions` 不直接冒充对应 DSH 服务。内部代码可逐步加 `dyw*` 名称，但首期不要求一次性重命名所有应用服务。
2. DYWorker 保持现有任务驱动，支持清单内的工具调用经适配进入 DSH 工具运行环境。适配必须带入不可伪造的会话/任务归属、工作区、停止信号、原始工具名称和结果。对外名称可保持现有前缀，但插件内部互调、提示内容和 scoped lookup 要有明确映射，不能简单改字符串后丢失原工具身份。
3. 直接写文件、启动程序等能力由对应运行环境的权限边界控制。当前把插件 import 到 Electron 主进程，插件代码可以直接使用 Node；仅在工具入口审批不能限制这类代码。`source: 'agent'` 是当前函数参数，不应被当成不可伪造的审批凭证。独立进程用于隔离崩溃和强制停止，限制文件/网络/进程还需要真实执行边界；不能把“分进程”说成“已沙箱化”。
4. 不把完整 DYWorker settings 或已解密凭据交给插件。按插件配置命名空间保存，并根据需要单独提供凭据能力。普通已授权工作沿用现有权限模式，不新增每次操作都问用户的流程。
5. DSH 会话必须有明确的权威数据来源。近期只为所支持插件提供已核对的行为；若需要 DSH 自己驱动任务，则让该会话由 DSH 完整拥有，再投影到 DYWorker。避免同时维护两套互相覆盖的任务状态。
6. 当前 contextTimeline 是按本地消息估算的专项适配，不能充当所有 DSH 插件的通用事件日志。统计应标明估算和缺项；压缩、文件活动、归档等缺少真实事件时不要补造。目标是逐步记录真实事件并提供重放。
7. 浏览器端先复用官方模块系统；再支持有限且公开的界面位置。对需要完整 DSH 页面结构的插件采用独立页面容器，或明确暂不支持。不能仅补上一个插槽名称就认为传给组件的数据和行为已齐全。

建议修改位置：

| 工作 | 现有文件 | 建议新增或独立的部分 |
|---|---|---|
| 兼容版本与状态判定 | electron/host/dsh-compat.mts、plugin-host.mts、src/PluginsPage.tsx | 固定版本的支持清单、按能力描述的兼容报告 |
| 安装、依赖与回退 | electron/host/plugin-install.mts、plugin-runtime-deps.mts、plugin-module-cache.mts、plugin-bundle.mts | 暂存安装/验证/切换/回退管理；插件组合及资源校验 |
| 独立运行环境 | electron/host/context.mts、plugin-host.mts | electron/host/dsh-runtime/ 下的进程入口、通信和官方组件装配；目录名为方案建议 |
| 工具、停止与审批 | electron/host/services/tools.mts、events.mts、services/agent.mts、electron/main.mts | DSH 工具约定适配、执行归属、审批映射、取消与收尾 |
| 会话、投影和配置 | electron/host/services/projections.mts、session-archive.mts、settings.mts | 独立 DSH 会话/配置适配，不覆盖已有自有服务 |
| 界面与网络桥 | src/pluginRuntime/*、src/PluginSlotView.tsx、electron/host/plugin-client.mts、services/connection.mts、plugins/plugin-api-ipc.mts | 官方模块装配、按插件归属清理、所支持的界面位置和行为 |
| 证明兼容 | tests/plugin-*.test.mjs、tests/cordis-architecture.test.mjs | 固定真实发布包的验收样本、干净环境与打包应用检查 |

**完整 DSH 运行路线的限制**

DSH 当前桌面实现已经采用独立 Host，可以参考它的启动、就绪、关闭以及资源交付方式。它同时加载自己的完整 Web 应用；不能据此推断其界面能无改动嵌进 DYWorker。[官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/architecture.zh.md)

本次核对的 SDK 请求仍只有 `initialize`、`session/prompt` 和 `shutdown`。没有独立的逐会话停止、会话关闭请求，也没有完整的客户端插件图和交互审批桥。因此 SDK 可用于小范围任务验证，但不足以直接承接本方案全部目标。[固定版本的 SDK 类型](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/sdk/protocol/src/types.ts)

若进入完整 DSH 路线，先评估并补充上述通信能力，或者使用已核对的 DSH 客户端通信机制。一个进程跑多个会话时，不能用“杀整个进程”代替“停止一个任务”；选择每会话独立进程也要衡量启动和资源开销。此处尚未做性能测量，不能给出具体速度或内存承诺。

**实施顺序、阶段成果和投入**

| 阶段 | 工作及交付 | 通过条件 | 估算 |
|---|---|---|---|
| 0：固定目标并验证路线 | 固定 DSH、Cordis、工具/界面各类真实插件的版本；小范围比较官方组件复用与官方独立运行方式 | dsh-office-tools、官方 todo、dsh-context 至少各选一个可获得的固定发布版本；列明支持/不支持能力；证实无需改插件源码的可行路径 | 3–5 人日 |
| 1：修基础可靠性 | 修正路由归属清理、真实状态、注入声明识别、检查阶段执行隔离、停止与安装回退基础 | 本次补充检查全部转为正确行为；A 插件停用不影响 B；失败安装保留旧可用组合 | 3–5 人日 |
| 2：交付工具兼容 | 完成 tools/scope/会话身份/systemPrompt/输出、审批和取消；按样本需要接入 fs/配置/投影 | 真实办公插件完整读写与取消；官方 todo 两会话隔离；桌面、渠道、定时和唤醒入口一致 | 7–12 人日 |
| 3：交付界面兼容 | 复用官方模块加载，补 external/异步分块/资源回收；替换清单内插件需要的空实现 | 真实插件页面打开并操作；更新会话即时变化；设置保存；停用、重启、更新不残留；未支持位置明确提示 | 7–12 人日 |
| 4：打包与发布验收 | 干净机器、固定依赖、断网重启、安装失败回退、目标系统验证，生成支持记录 | 没安装 DSH 也能使用；macOS、Windows、Linux 目标包分别验证，若仅测一种就只承诺一种 | 5–8 人日 |

限定清单内工具与界面兼容的累计估算为 **25–42 人日**。这是基于现有实现和已知差距的工作量估算，不是已验证工期；阶段 0 后应重新估算。全面兼容任意 DSH 插件、整个 DSH 工作流和所有客户端页面不在此工期内。

如果阶段 0 发现三个核心样本都强依赖完整 DSH 任务运行方式，则优先采用独立官方 DSH 路线，重新划定任务与数据归属，不继续堆叠近似实现。反之，先交付有限兼容清单，深度插件按需进入第二层。

**交付验收条件**

- 使用未经修改的真实发布包，记录插件版本、DSH 基线、依赖锁定结果、操作系统与实际通过的动作。内置仿 DSH 插件不能代替第三方插件验收。
- 工具需覆盖参数错误、结果校验失败、插件抛错、超时、用户取消；停止后确认实际没有继续写入。
- 至少两个插件、两个会话、两个工作区同时存在；分别停用/卸载/更新一个，检查另一个正常，并确认没有串数据或残留接口。
- 插件缺能力、缺服务或等待依赖时不显示“可用”；未实现的客户端调用不能伪装成空数据。
- 审批拒绝不能被插件重新放行；已授权普通任务保持既有权限体验；后台、定时、唤醒和前台一致。
- 下载失败、依赖冲突、启动失败、校验失败均不损坏原组合；运行中的任务固定插件代次，更新在合适时机切换。
- 清理单个插件的工具、接口、界面、订阅、样式和计时任务；同名冲突和旧请求晚到均有确定结果。
- 干净环境不能借用用户的 ~/.dsh；打包后的应用无需依赖开发目录或意外存在的 Node/包管理器。
- 界面插件必须在真实窗口中打开和点击；统计与产物对照真实数据，而不是仅断言“有标签”或“组件没报错”。

**本次实际验证与证据**

执行 `node --test tests/cordis-architecture.test.mjs tests/plugin-*.test.mjs tests/builtin-plugins.test.mjs`：**131 项通过，0 失败，0 跳过**。记录保存在 [tests.tap](tests.tap)。其中在 Node 测试环境中实际加载了本机已有的 dsh-context 0.62.2、dsh-better-sidebar 0.10.3 两个客户端文件，证实了这些产物的模块工厂可以执行。它没有运行插件完整后台、界面渲染或交互。其余测试验证当前自有实现，合起来仍不等于完整 DSH 兼容；其中存在专门认可当前粘性路由和宽松客户端行为的断言，需要随正确约定一起调整。

另外运行 [probes.mjs](probes.mjs)，使用当前宿主及只在临时目录创建的合成样例，结果保存在 [results.json](results.json)：

| 补充检查 | 实际结果 |
|---|---|
| 按 DSH 工具定义形状注册 | 被拒绝，错误为“注册工具需要 plugin（归属插件标识）” |
| 通用投影注册 | sessionProjections.register 为 undefined |
| 向工具执行入口传入停止信号 | handler 收到的上下文没有 signal，也没有 DSH agent |
| 停用已注册接口的插件 | 停用前后均返回 200，接口仍执行 |
| 销毁整个宿主 | 同一接口仍返回 200，之后由检查脚本显式清理 |
| 缺必需服务的插件 | apply 没运行，条目仍显示 active: true、error: null |
| 对象形式的 inject | 依赖被漏掉，检查结论是 runnable |
| 所谓只读兼容检查 | 插件顶层代码实际执行了一次 |
| 客户端 factory 注册 | 注册时就执行，不符合上游当前的惰性物化方式 |
| 客户端异步分块 | 返回 require.async is not a function |

这些检查是诊断样例，不是新的功能实现，也不是对真实第三方插件的完整测试。本次没有运行模型请求、真实办公产物流程、插件窗口交互或跨平台安装。因此没有据此宣布任何新版第三方插件已通过完整验收。

下一步最值得做的是阶段 0 和阶段 1：先确定三个真实目标插件及支持版本，修正已经复现的基础问题，再交付工具兼容。继续扩大插件市场数量或只升级 Cordis，都不能替代这一步。
