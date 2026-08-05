# wigolo 上游研究笔记

研究日期：2026-08-05。仅依据 [上游仓库](https://github.com/KnockOutEZ/wigolo) 的 README、源码、配置、文档、许可证、Release 和提交记录。

## 关键结论

### 1. 解决的问题、架构和运行方式

- wigolo 是面向 AI 代理的本地网页情报服务，集中解决公开网页的搜索、读取、爬取、抽取、研究和缓存问题；核心能力可不配置 API Key。[README](https://github.com/KnockOutEZ/wigolo/blob/main/README.md#L198-L228)
- 一个 Node 进程通过 MCP stdio、REST/HTTP、SDK 或 CLI 提供同一套工具；源码侧组合了搜索引擎、抓取路由器、浏览器池、本地 SQLite/向量缓存、本地模型和可选插件。[源码入口](https://github.com/KnockOutEZ/wigolo/blob/main/src/index.ts#L46-L179)、[MCP 服务](https://github.com/KnockOutEZ/wigolo/blob/main/src/server.ts#L1-L7)、[REST](https://github.com/KnockOutEZ/wigolo/blob/main/docs/rest-api.md#L0-L33)
- 本地 MCP 的最小运行方式是 `npx -y wigolo`；`npx wigolo init` 会下载浏览器和本地模型并做检查；默认数据目录是 `~/.wigolo`。[mcp.json](https://github.com/KnockOutEZ/wigolo/blob/main/mcp.json#L0-L7)、[安装](https://github.com/KnockOutEZ/wigolo/blob/main/docs/installation.md#L0-L18)、[隐私与安全](https://github.com/KnockOutEZ/wigolo/blob/main/docs/privacy-security.md#L194-L213)

### 2. 主要功能与边界

- 十个工具：`search`、`fetch`、`crawl`、`cache`、`extract`、`find_similar`、`research`、`agent`、`diff`、`watch`。[工具参考](https://github.com/KnockOutEZ/wigolo/blob/main/docs/tools.md#L0-L5)
- 结果可带摘录、引用 ID、原文位置、证据分数、来源新鲜度和引擎状态；抓取遇到挑战页会返回 `blocked_by_challenge`，不会把错误页面当正文。[工具参考](https://github.com/KnockOutEZ/wigolo/blob/main/docs/tools.md#L27-L55)
- 默认遵守 robots.txt、按域限速，定位是研究级网页索引，不是批量采集器；缓存、浏览器和模型主要存放在本机。[工具参考](https://github.com/KnockOutEZ/wigolo/blob/main/docs/tools.md#L61-L77)、[隐私与安全](https://github.com/KnockOutEZ/wigolo/blob/main/docs/privacy-security.md#L214-L231)
- “免 Key”不等于“完全离线”：搜索/网页读取仍访问目标网站和搜索引擎，首次使用还会下载浏览器和模型；配置远程 LLM 后，资料会按配置离开本机。[隐私与安全](https://github.com/KnockOutEZ/wigolo/blob/main/docs/privacy-security.md#L214-L224)
- `watch` 只有在 `serve` 或 MCP 会话存活时才会执行；远程 `serve` 非回环绑定默认要求 Bearer Token，并默认阻止服务端访问本机回环地址。[工具参考](https://github.com/KnockOutEZ/wigolo/blob/main/docs/tools.md#L174-L187)、[REST](https://github.com/KnockOutEZ/wigolo/blob/main/docs/rest-api.md#L27-L43)

### 3. 成熟度、许可证、活跃度和风险

- 当前仍是 **Public beta**；上游宣称有 7,600 个测试，但不能按稳定版兼容承诺使用。[README](https://github.com/KnockOutEZ/wigolo/blob/main/README.md#L403-L418)
- 最新 Release 是 `v0.2.1`（2026-07-19，提交 `185afb5`）；近期持续修复新装、下载、SPA、依赖和 Linux ARM64 问题，项目活跃但仍在快速变化。[v0.2.1 Release](https://github.com/KnockOutEZ/wigolo/releases/tag/v0.2.1)、[提交记录](https://github.com/KnockOutEZ/wigolo/commits/main)
- 许可证是 `AGPL-3.0-only`。直接复制源码或改造后并入 DYWorker，不能继续简单按 DYWorker 的 MIT 方式发布；独立未修改 MCP 进程调用与源码合并是不同情形，需法务确认。[package.json](https://github.com/KnockOutEZ/wigolo/blob/main/package.json#L64-L74)、[LICENSE](https://github.com/KnockOutEZ/wigolo/blob/main/LICENSE#L0-L14)、[DYWorker README](https://github.com/richardguancn/dyworker/blob/main/README.md#L163-L165)
- 运行要求 Node `>=20`、约 1.5 GB 磁盘；依赖含 Playwright、`better-sqlite3`、`sqlite-vec`、Transformers/FastEmbed 等原生或模型组件。上游曾记录 Node 20 原生 SQLite 预构建和 Linux ARM64 tokenizer/嵌入问题。[README](https://github.com/KnockOutEZ/wigolo/blob/main/README.md#L208-L218)、[package.json](https://github.com/KnockOutEZ/wigolo/blob/main/package.json#L95-L147)、[相关提交](https://github.com/KnockOutEZ/wigolo/commits/main)
- Linux 浏览器需要系统库；“npm 安装成功”不代表浏览器能力已可用。[Dockerfile](https://github.com/KnockOutEZ/wigolo/blob/main/Dockerfile#L20-L66)、[故障排查](https://github.com/KnockOutEZ/wigolo/blob/main/docs/troubleshooting.md#L196-L215)

### 4. 对 DYWorker 的建议

#### 直接可借鉴

- 先作为独立的本地 stdio MCP 服务试用。DYWorker 已支持用户配置外部 MCP 服务，因此无需改业务代码即可验证。[DYWorker MCP 实现](https://github.com/richardguancn/dyworker/blob/main/electron/main.mjs#L1032-L1176)、[wigolo mcp.json](https://github.com/KnockOutEZ/wigolo/blob/main/mcp.json#L0-L7)
- 借鉴证据字段、缓存优先、失败透明、健康检查和修复提示，不必复制 wigolo 源码。[工具参考](https://github.com/KnockOutEZ/wigolo/blob/main/docs/tools.md#L1-L35)、[故障排查](https://github.com/KnockOutEZ/wigolo/blob/main/docs/troubleshooting.md#L194-L211)

#### 需要改造

- 接入 DYWorker 的联网审批、取消/超时、审计、进度展示和敏感信息规则；`research`、`agent`、`watch` 不是普通一次性查询。[DYWorker 风险规则](https://github.com/richardguancn/dyworker/blob/main/electron/risk.mjs#L13-L68)、[wigolo 工具边界](https://github.com/KnockOutEZ/wigolo/blob/main/docs/tools.md#L127-L187)
- 保留 DYWorker 的政府官网优先、境内来源和用户确认策略，不能直接让 wigolo 的公开互联网搜索替换现有联网链。[DYWorker agent 规则](https://github.com/richardguancn/dyworker/blob/main/electron/agent.mjs#L1792-L1804)、[wigolo README](https://github.com/KnockOutEZ/wigolo/blob/main/README.md#L245-L264)
- 如需内置，必须重新处理 Electron 数据目录、浏览器/模型生命周期、打包体积，以及 macOS、Windows、Linux ARM64/Kylin 的实机兼容。[DYWorker 发布说明](https://github.com/richardguancn/dyworker/blob/main/README.md#L96-L139)、[wigolo 配置](https://github.com/KnockOutEZ/wigolo/blob/main/docs/configuration.md#L218-L238)

#### 不建议引入

- 不建议复制或合并 wigolo 源码：许可证和依赖风险都过大。
- 不建议第一阶段引入远程 `serve`、Webhook 或常驻 `watch`：会新增端口、Token、后台任务、远程访问和多客户端并发边界。[REST](https://github.com/KnockOutEZ/wigolo/blob/main/docs/rest-api.md#L17-L43)

## 仍需我方验证

- DYWorker 外部 MCP 是否能稳定列出并调用 wigolo 的全部工具，尤其核对包内 MCP 清单与源码注册清单是否存在同步差异。[package.json](https://github.com/KnockOutEZ/wigolo/blob/main/package.json#L78-L94)、[src/server.ts](https://github.com/KnockOutEZ/wigolo/blob/main/src/server.ts#L1-L7)
- macOS、Windows、Linux 和麒麟/UOS ARM64 的安装、首次下载、浏览器、原生 SQLite、断网恢复、卸载和退出清理。
- 联网审批、敏感数据隔离、远程 LLM/插件/遥测关闭、缓存和密钥目录权限。
- AGPL 下独立进程调用、随安装包分发和源码改造分发三种方案的法务结论。
- 固定 `v0.2.1` 后的升级、回滚、漏洞响应和依赖安全审查。
