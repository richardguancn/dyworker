# 内置插件目录

随应用分发、**不归 npm 管的插件**放在这里（每个子目录一个包，支持 `@scope/name` 两级）。
宿主启动时扫描本目录，命中 `package.json` 里声明了 `dsh` / `dyworker` 字段的包会：
默认启用、开机自动加载其客户端半边（可用插件页停用，但不能卸载）。

为什么独立于插件目录：`npm install` 会把手工放进 profile 的包剪掉（实测），
内置插件必须是应用产物的一部分（随 `files` 打进 asar，`app.getAppPath()` 定位）。

当前状态：**空**。
原先内置的 `@deepseek-ai/dsh-client-ui-trajectory`（DSH 官方轨迹插件）已移除——
轨迹视图改为原生实现，不再依赖 DSH 的会话视图壳层。
