# 渲染性能检查工具

这些工具只使用模拟会话和本机代码，不连接在线模型，也不读取真实用户会话。`performance-audit-App.md` 保留原审计记录；工具运行结果反映运行时的源码和电脑环境。

在项目根目录安装依赖后运行：

```sh
node .perf-harness/span.mjs
node .perf-harness/perf-ast.mjs
npx vite build --config .perf-harness/render-bench/vite.config.mjs
```

用与本机系统匹配的 Electron 运行基准页，确保未设置 `ELECTRON_RUN_AS_NODE`：

```sh
env -u ELECTRON_RUN_AS_NODE BENCH_MESSAGES=120 BENCH_MODE=all npx electron .perf-harness/run-bench.cjs
```

可用场景：`all`、`idle`、`stream`、`longstream`、`snapshot`、`misclass`。`BENCH_MESSAGES` 控制历史消息数量；`BENCH_CHARS`、`BENCH_CHUNK` 控制长回复长度和每次增加的字数。`snapshot` 场景可设置 `BENCH_SHOT` 为截图保存路径。`misclass` 场景可配合 `BENCH_SETTLELAST=1` 检查唤醒期间的历史消息显示。

成功运行会输出 `BENCH_RESULT`；还应确认其中 `errors` 为空。出现 `BENCH_ERROR`、窗口进程退出或等待超时，均不能算作检查通过。构建产物位于 `render-bench/dist/`，由项目现有忽略规则排除，不提交。
