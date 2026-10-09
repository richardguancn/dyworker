# dyworker-trajectory（轨迹插件）

自研内置插件：把会话区的「轨迹」标签做成插件，而不是硬编码在 `src/App.tsx` 里。
契约与官方 DSH 轨迹插件同一套（`conversation.view` 插槽），但**视图代码是我们自己的**
（`src/TraceView.tsx`，构建时打进 `client.js`），数据也只来自我们自己的 trace 事件流。

## 两个半边

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| 主机 | `index.js` | 一条路由 `POST /api/dyworker-trajectory/read`：按 `{ sessionId, offset, limit }` 分页读 `userData/traces/<id>.jsonl` |
| 客户端 | `src/client.tsx` → 构建产物 `client.js` | 注册 `conversation.view`（id/key = `trajectory`，标签「轨迹」）；按 2 秒轮询增量取事件，交给 `TraceView` 渲染 |

为什么走自己的路由而不是复用渲染端内存里的轨迹：插件是独立的一份代码，走 `/api` 才能
既服务活动会话、又服务几十天前的历史会话；`offset` 增量则避免每次轮询重传整个 jsonl。

## 构建

`client.js` 是产物，由仓库根目录的脚本打包（esbuild，把 `src/client.tsx` 与它 import 的
`src/TraceView.tsx` / `src/traceModel.ts` 打成一个 DSH 客户端 bundle）：

```sh
npm run build:plugins     # 全量；只改了某个插件也可以直接跑这个
```

改 `src/client.tsx` 后必须重新构建，否则应用里跑的还是旧产物（契约测试会先失败提醒）。
主机半边 `index.js` 是纯 ESM，改完**重启 Electron** 才生效（宿主只在启动时 import 一次）。

## 停用

插件页可以停用（内置插件默认启用、不可卸载）。停用后「轨迹」标签消失，会话区只剩「对话」。
