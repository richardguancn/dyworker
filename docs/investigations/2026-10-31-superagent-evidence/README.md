**调研验证记录**

`local-tests.log`：本项目第一组检查，107 项通过。

`runtime-tests.log`：本项目第二组检查，27 项通过。

`upstream-probe.log`：对上游真实源码的独立验证，8 项通过。不是上游完整测试集，也没有调用真实模型或外发消息。

`research.test.mjs`：独立验证用例。外部执行和发送由测试替身提供，存储与任务处理使用上游实现。

`verify-upstream.mjs`：检查上游版本，在新建临时目录转换源码并运行验证。不改动上游源码、项目依赖或用户数据。运行前需要本项目现有依赖和指定版本的上游仓库。

从 DYWorker 项目根目录运行：

```sh
node docs/investigations/2026-10-31-superagent-evidence/verify-upstream.mjs /tmp/dyworker-dsh-superagent-research
```

末尾目录是本次取得的上游副本位置，重新验证时应替换为实际路径。要求上游提交为 `6337fc823ce20251c8de8085948165c81aaa701e`。

本次环境为 Node `v26.12.1`，验证借用本项目的 TypeScript 和 Zod `4.6.5`；不是上游完整锁定依赖环境。结果的适用范围和功能建议见同级调研文档。

2026-11-01 补充记录：

- `article-source.json`：用户提供正文的来源、校验值和核对范围，未保存文章全文。
- `article-checks.log`：输入与跨任务搜索，20 项通过。
- `article-input.log`：真实运行中的补充要求与停止，2 项通过。
- `article-runtime-initial.log`：原话保留、长工具结果及后台工作，首次 2 项通过、1 项失败。
- `article-background-initial-error.json`：实际失败原因，外层执行限制阻止启动应用自己的隔离环境。
- `article-background-recheck.log`：在获准的执行环境中重跑后台工作用例，1 项通过；未修改应用源码或测试断言。

补充检查涉及 25 项不同用例，最终全部通过。记录中的首次失败不应被遗漏，也不应误计为又一个独立用例。
