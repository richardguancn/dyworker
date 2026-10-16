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

新增 `interaction` 场景验证连续拖动期间宽度变化、松手后的宽度及渲染次数；`routes` 场景操作真实页面的发送与停止，并回放计划、唤醒入口；`search` 场景用真实快捷键打开会话搜索并输入命中词，确认命中高亮落在实际消息行、滚动定位后可见区域内存在内容。后端使用模拟桥接，不表示真实模型或真实设备已验收。

持续输出现在使用 DSH 会话事件，并断言 `.streaming-markdown` 实际出现。单纯传入 `streamingPath=true` 不算覆盖通过。夹具加载与正式入口相同的布局、外观和终端样式；`idle` 是主动触发更新的场景，不表示静置 CPU。

`longstream` 在计时前独立渲染参考正文，取得完整可见文字后移除参考区域。输出过程中须与参考全文匹配（忽略空白差异），再记录结构并结束任务；重复出现的末句不能提前满足这项检查。结果中的 `streamDisplayComplete` 表示全文核对通过，`expectedDisplayLength` 是去除空白后的参考长度，`displayCatchupMs` 记录最后一个事件送出后等待画面追上的时间，这部分仍计入本轮耗时。前后比较还应核对输出中结构与结束后的完整正文；不能只凭事件已送完判断显示已完成。

旧版对比可设置 `BENCH_APP_SOURCE` 为提前保存的旧版 `src/App.tsx` 绝对路径，配合 `BENCH_VARIANT=before` 构建到 `render-bench/dist-before/`；运行时也设置 `BENCH_VARIANT=before`。旧源码仍按项目 `src/` 目录解析相对导入。两边应使用相同夹具、依赖、数据、样式和图形设置，交替运行至少三次。不要在记录性能时同时运行构建或完整测试。

`BENCH_PLATFORM=linux` 只选择 Linux 界面分支，不能模拟 Linux 系统和驱动。`BENCH_MANUAL=1` 显示隔离的检查窗口，`BENCH_CDP_PORT` 可指定本机调试端口供交互检查；不连接已安装应用。每次运行使用独立的临时用户目录。结果附带 Electron 的进程资源采样，单位与含义遵循 Electron API；不能与系统监视器截图直接混比。

目标 Linux 电脑可使用 `scripts/sample-linux-performance.py`：必填 `--pid` 为 DYWorker 主进程号，默认每秒采样一次、共 300 次；`--samples 1800` 记录约 30 分钟，`--output` 指定新的 JSONL 文件。文件达到 10 MB 会停止。记录包含子进程关系、CPU、RSS、可读取的 PSS 和磁盘读写增量，不读取命令行、环境、凭据或聊天正文。`null` 表示无法读取或首次没有比较值，不可当作零。CPU 100% 表示一个逻辑核；RSS 总和包含共享内存，优先用完整的 PSS 总量比较。

成功运行会输出 `BENCH_RESULT`；还应确认其中 `errors` 为空。出现 `BENCH_ERROR`、窗口进程退出或等待超时，均不能算作检查通过。构建产物位于 `render-bench/dist/`，由项目现有忽略规则排除，不提交。
