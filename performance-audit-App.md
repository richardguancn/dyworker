# DYWorker / src/App.tsx 渲染性能审计

保存说明（2026-10-09）：本文保留原审计时的源码规模、行号和结论。后续源码已有改动，本文不是对当前版本重新检查后的报告；复查时请运行 `.perf-harness` 中的检查工具并重新定位引用。

审计对象：`src/App.tsx`（13615 行 / 622935 字节）、`src/styles.css`、`electron/main.mts`、`src/InteractiveMessage.tsx`、`src/contextUsage.ts`
审计方法：行号区间切分 + grep 精确定位，所有引用均来自实际读取内容。

---

## 一、结论

**命题成立：`App()` 主组件确实是当前渲染路径上最主要的性能瓶颈。置信度：高。**

一句话机制：`App()` 是一个 6569 行、在组件顶层持有 **130 个 `useState`** 的单体组件，并且把整个会话状态树 `sessions` 作为**单一 state atom 放在根部**；流式 token、面板拖拽、轨迹事件都直接改写这个根部 state，于是每一次更新都会重建 **2131 行 JSX**、重新生成全部 N 条消息的 React 元素，并让 17 个 `useMemo` 中依赖 `sessions`/`activeSession` 的那几个在每个事件上重新求值。

关键放大比：**任意一个 App 级 state 变化 → App 整个 2131 行 JSX 子树重建**。全应用只有 2 个 memo 边界（`ProcessTimeline`、`InteractiveMessage`），其中 `ProcessTimeline` 恰好是有效的，这是当前唯一挡住雪崩的堤坝。

需要同时说明的三点边界（否则结论会被误读）：

1. **主进程已经把流式事件节流到 50ms**（`electron/main.mts:1920`），渲染端每秒最多收到约 20 次 `assistant-text`/`assistant-reasoning`，**不是逐 token**。所以放大系数是 ~20×/秒，不是 ~60×/秒。
2. **用户点名的两个 interval 都不是 App 的渲染驱动源**（详见 §2.4），真正的 1 秒定时器已经被隔离在 `RunningStatusLabel` 内部。
3. **存在一种 CSS 级"伪虚拟化"**（`content-visibility: auto`），但它只在 Linux 之外的平台生效，且它只跳过 layout/paint，**完全不减少 React 协调与 DOM 节点创建**。

---

## 二、与背景事实不符之处

| 背景事实 | 实测 | 说明 |
|---|---|---|
| `App()` 从 6826 行"一直到文件末尾（约 13615 行），本体约 6800 行" | **6826–13394，共 6569 行**；13395–13615 是 `ContextMenuItem` 类型 + 3 个独立组件 | App 在 **13394 行**就由 `}` 闭合。其后的 `SelectionQuoteBar`(13405)、`AnnotationEditorCard`(13467)、`ContextMenuPopup`(13555) 都在 App 之外。6569 行 vs "约 6800" 数量级接近，但**结束边界是错的** |
| "绝大多数 state 属于 App 主组件" | App 占 **130/257 = 50.6%** | 是最大的单点集中，但"绝大多数"偏高；另外 127 个分散在其余 64 个组件里 |
| useState 分桶 "6000-6999:81" | 6000–6825 区间 **useState 数为 0**，81 个全部落在 **6826–6999** | 桶标签有误导性：这 81 个 100% 属于 App，不是 SettingsDialog |
| useEffect 96 / useMemo 26 / useCallback 4 | 全文件命中数一致 ✅ | 但 **App 体内**是 useEffect 54、useMemo 17、useCallback 2 |
| "React.memo 仅 1 次" | App.tsx 中 1 处（`ProcessTimeline`，3535）✅；但**全应用还有第 2 处**：`InteractiveMessage`（`src/InteractiveMessage.tsx:768`），而它恰恰是每条消息最重的 Markdown 渲染器 | 说"只有 1 个 memo"会漏掉最重要的那个 |
| "约 235 处 `window.dyworker.*` IPC 调用" | `src/App.tsx` 中 231 处 ✅ | 数量级吻合；其中 151 处在 App 体内 |
| 第 3641 行 interval 是高频源 | 该 interval **在 `RunningStatusLabel` 内部**，只 setState 到自己的局部 `useState(0)`，**不触发 App 重渲染** | 且 3632 行的注释表明这是**已经做过的优化**（"不再驱动整个 App 每秒重渲染（原 elapsedTick 方案）"） |
| 第 7674 行 interval 是高频源 | 该 interval 周期是 **30000ms**（`SESSION_STREAMING_SAVE_INTERVAL_MS = 30000`，第 110 行），且**只调 IPC，不 setState** | 完全不是渲染热点 |

另发现 2 个背景未提及的问题：**effect 监听器每帧被摘挂**（§3.7）与 **`traceEventsRef` 原地改数组后 setState 同一引用**（§3.10，正确性问题）。

---

## 三、证据

### 3.1 `App()` 的规模、state 数量与 effect 数量（精确定界）

`src/App.tsx:6826` 起，`src/App.tsx:13394` 止：

```
6826: export function App() {
...
13392:       </>
13393:     );
13394: }
```

App 体内 hook 统计（按**出现次数**，非行数）：

| hook | App 体内 | 全文件 | 占比 |
|---|---|---|---|
| `useState` | **130** | 257 | 50.6% |
| `useEffect` | **54** | 96 | 56.3% |
| `useMemo` | **17** | 26 | 65.4% |
| `useCallback` | **2** | 4 | 50.0% |
| `useRef` | 55 | 87 | 63.2% |
| `useLayoutEffect` | 2 | 3 | — |

这 130 个 `useState` **全部**位于组件顶层作用域（缩进分布唯一值 = 2 空格，无嵌套），即任意一个的 setter 都会让整个 `App()` 函数体重跑：

```
$ grep -n "useState" App_body | sed 's/^\([0-9]*\):\( *\).*/\2/' | awk '{print length($0)}' | sort | uniq -c
 130 2
```

### 3.2 App 的 return JSX 结构（11264 行起，2131 行）

`src/App.tsx:11264`：

```tsx
11264:  return (
11265:    <>
11266:    {/* 外观背景装饰层：背景色 → 背景图 → 遮罩，pointer-events/aria-hidden 保证不占交互 */}
11267:    <div className="appearance-backdrop" aria-hidden="true" />
11268:    <div
11269:      className={`app-shell platform-${platform || "linux"} ${sidebarOpen ? "" : "sidebar-collapsed"} ...`}
11270:      style={panelStyle}
11271:    >
11272:      <header className="titlebar" aria-label="标题栏">
```

`app-shell` 下的直接子节点（顶层缩进 `^      <`）：

```
+11263:      9:      <header className="titlebar" aria-label="标题栏">
+11263:     27:      <aside className="sidebar" aria-label="任务侧栏">
+11263:    198:      <main className="main-panel">
+11263:   1492:      <aside className={`tool-panel ...`} aria-label="右侧工具栏">
```

即 4 个直接子女：`titlebar` / `sidebar`（会话列表）/ `main-panel`（对话流 + 输入区）/ `tool-panel`（浏览器、Git 审阅、轨迹台等）。它们**不是**独立组件，而是内联在 App 里的 JSX —— 因此没有任何 memo 边界，App 一渲染就全部重建。其后 13125–13394 还内联渲染约 10 个条件对话框（`SettingsDialog`、`InboxDialog`、`ImageLightbox`、`FilesSplitPanel`…）。

主面板内的对话流容器（唯一容器，无分页/窗口）：

```tsx
11787:          className="conversation-viewport"
11788:          ref={viewportRef}
...
11796:          <div className="conversation-column">
...
11810:              activeSession.messages.map((message, index) => {
```

### 3.3 核心放大链：流式事件 → 根部 state → 全树重建

**第一跳**，`src/App.tsx:7168` —— 会话更新是"整数组 map + 新对象"：

```tsx
7168:  const updateSession = (id: string, updater: (session: SessionRecord) => SessionRecord) => {
7169:    setSessions((current) => current.map((session) => session.id === id ? updater(session) : session));
7170:  };
```

**第二跳**，`src/App.tsx:10086` —— 每个流式 token 都走这里：

```tsx
10086:        const patchAssistant = (updater: (current: ChatMessage) => ChatMessage) => {
10087:          updateSession(targetSession.id, (session) => ({
10088:            ...session,
10089:            messages: session.messages.map((current) => current.id === assistantId ? updater(current) : current),
10090:          }));
10091:        };
```

**第三跳**，`src/App.tsx:10197`（桌面 runTask 的专属监听器，非渠道分支）：

```tsx
10197:          } else if (agentEvent.type === "assistant-text") {
10198:            patchAssistant((current) => ({ ...current, content: agentEvent.text }));
```

**第四跳**：`setSessions` 得到**新数组 + 新 session 对象**，`activeSession` 随之变化 → 依赖 `sessions`/`activeSession` 的 memo 全部失效重算，App 重建 2131 行 JSX。

**上游节流**，`electron/main.mts:1919`：

```ts
1919:  // 流式文本事件（assistant-text / assistant-reasoning）每个 token 携带累积全文，
1920:  // 逐 token 发 IPC 是 O(n²) 的结构化克隆；这里按 50ms 合并只发最新快照。
1923:  let pendingStreamEvents = null;
1925:  const flushPendingStreamEvents = () => {
...
1934:  const emit = (agentEvent) => {
1935:    if (agentEvent?.type === "assistant-text" || agentEvent?.type === "assistant-reasoning") {
1936:      if (!pendingStreamEvents) pendingStreamEvents = new Map();
1937:      pendingStreamEvents.set(agentEvent.type, agentEvent);
1938:      if (!streamFlushTimer) {
1939:        streamFlushTimer = setTimeout(() => {
1940:          streamFlushTimer = null;
1941:          flushPendingStreamEvents();
1942:        }, 50);
1943:      }
1944:      return;
```

**⇒ 有效事件率 ≈ 20 次/秒**（而非每 token 一次）。这是把结论限定在"20×/秒"而非更高数量级的依据。

### 3.4 每次流式事件重新计算的 O(n) / O(n²) 工作

**(a) 渲染期 O(U²)：每条用户消息都在对话回合数组里线性查找** — `src/App.tsx:11810`：

```tsx
11810:              activeSession.messages.map((message, index) => {
11811:                const turnIndex = message.role === "user"
11812:                  ? conversationTurns.findIndex((turn) => turn.messageIndex === index)
11813:                  : -1;
```

外层遍历 N 条消息，对每条 user 消息在长度 U 的 `conversationTurns` 里 `findIndex`。共 **N + U²/2** 次比较。

**(b) memo 内 O(U × N)：`conversationTurns` 依赖 `activeSession`，每事件重算** — `src/App.tsx:8387`：

```tsx
8387:  const conversationTurns = useMemo(() => {
8388:    if (!activeSession) return [];
8389:    return activeSession.messages.reduce<Array<{...}>>((turns, message, messageIndex) => {
8390:      if (message.role === "user") {
8391:        turns.push({
8392:          messageIndex,
8393:          preview: conversationTurnPreview(activeSession.messages, messageIndex),
8394:        });
8395:      }
8396:      return turns;
8397:    }, []);
8398:  }, [activeSession]);
```

而 `conversationTurnPreview` 自身是 O(N)（一次 `findIndex` + 一次 `slice` 分配）— `src/App.tsx:764`：

```tsx
764: function conversationTurnPreview(messages: ChatMessage[], messageIndex: number) {
765:   const userMessage = messages[messageIndex];
766:   const userText = plainConversationText(userMessage.displayContent ?? userMessage.content);
767:   const nextUserIndex = messages.findIndex((message, index) => index > messageIndex && message.role === "user");
768:   const assistantText = plainConversationText(
769:     messages
770:       .slice(messageIndex + 1, nextUserIndex === -1 ? undefined : nextUserIndex)
771:       .find((message) => message.role === "assistant")?.content || "",
772:   );
```

⇒ **(a) + (b) 合计每个流式事件 O(U² + U·N)**。500 条消息（约 250 用户 / 250 助手）时约 **15.6 万次元素访问 + 250 次数组分配**，20 次/秒 ⇒ **约 310 万次/秒 + 5000 次分配/秒**。这是"JSX 之前、纯计算"的最大单项。

**(c) 全量 token 估算 O(总字符数)** — `src/App.tsx:10670` 的 memo 依赖 `activeSession?.messages`（每事件变新引用）：

```tsx
10670:  const contextUsage = useMemo(() => {
...
10681:    const tokens = estimateSessionTokens(activeSession?.messages || [], activeSession?.workingContext || "");
10682:    return { used: tokens, limit: modelContextLimit(settings.model, settings.endpoint), exact: false };
10683:  }, [
10684:    activeSession?.messages,
```

`src/contextUsage.ts:27`：

```ts
27: export function estimateSessionTokens(messages: MessageLike[], workingContext = "") {
28:   let tokens = 3;
29:   tokens += estimateTextTokens(String(workingContext || ""));
30:   for (const message of messages || []) {
31:     tokens += 4 + estimateTextTokens(String(message.content || ""));
32:     for (const attachment of message.attachments || []) {
```

**注意**：该 memo 开头有一个短路（若 `activeSession.contextTokens != null && contextModel === settings.model && contextEndpoint === settings.endpoint` 则直接返回）。所以全量扫描只在"本轮尚无实测 context-usage"或模型/端点不匹配时发生；一旦 `context-usage` 事件到达，后续每次只剩一次廉价比较。**这是当前被低估的一条隐藏成本，但不是常态成本。**

**(d) 带搜索词时，全库消息拼接 O(全部字符)** — `src/App.tsx:8462`，依赖含 `sessions`：

```tsx
8462:  const visibleSessions = useMemo(() => {
8463:    const needle = query.trim().toLocaleLowerCase();
8464:    const pool = sessions
8465:      .filter((session) => showArchived || !session.archived)
8466:      .filter((session) => !needle
8467:        || `${session.title} ${session.messages.map((message) => message.content).join(" ")}`.toLocaleLowerCase().includes(needle));
8468:    return [...pool].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
8469:  }, [query, sessions, showArchived]);
```

`!needle ||` 使空搜索词时短路（O(会话数)）。但**一旦搜索框有内容且同时在跑任务**，每个流式事件都会把全部会话的全部消息正文 `map+join+toLowerCase` 一遍。

**(e) 渲染期未 memo 的小规模 O(n)**（每条渲染都跑，但不随消息数爆炸）：

```tsx
8193:   const activeSession = sessions.find((session) => session.id === activeId) || sessions[0];
8449:   const inboxPendingCount = inboxItems.filter((item) => item.status === "pending").length;
9695:   const browserActiveDownloadCount = browserDownloads.filter((entry) => entry.state === "progressing" || entry.state === "interrupted").length;
11122:   const addMenuItems = toolPanelMenuItems.filter((item) => {
```

### 3.5 唯一有效的 memo：`ProcessTimeline`（3535）

`src/App.tsx:3535`：

```tsx
3535: const ProcessTimeline = memo(function ProcessTimeline({
3536:   message,
3537:   messageIndex,
3538:   isStreaming,
3539:   collapsedActivities,
3540:   onToggleCollapse,
```

调用点 `src/App.tsx:11951`：

```tsx
11951:                        <ProcessTimeline
11952:                        message={message}
11953:                        messageIndex={index}
11954:                        isStreaming={activeTaskRunning && !message.taskStatus && index === streamingAssistantIndex}
11955:                        collapsedActivities={collapsedActivities}
11956:                        onToggleCollapse={toggleActivityCollapse}
```

**有效性判定：有效。** 5 个 props 中 4 个引用稳定：`message` 由 `patchAssistant` 的 `.map()` 保证未变消息保持同一对象；`messageIndex`/`isStreaming` 是原始值；`collapsedActivities` 是 state（`7013`）；`onToggleCollapse` 是 `useCallback(..., [])`（`7016`）。所以一次流式事件只让 1 条消息的 `ProcessTimeline` 重渲染，其余 N−1 条被挡住。

**但这只挡住了子树内部，没挡住父级的元素创建**：App 仍然为全部 N 条消息调用 `messages.map()`（11810）并生成 React 元素，`conversationTurns.findIndex`（11812）也照跑。

另一个 memo 边界在 `src/InteractiveMessage.tsx:768`：

```tsx
768: export const InteractiveMessage = memo(function InteractiveMessage({ content }: { content: string }) {
773:   const segments = useMemo(() => parseInteractiveMessage(deferredContent), [deferredContent]);
```

其 props 由 `src/App.tsx:11970` 提供，靠值缓存维持引用稳定：

```tsx
11970:                      {message.content && <InteractiveMessage content={stripControlMarkersCached(message.content)} />}
```

### 3.6 inline props 的真实影响：不是"memo 失效"，而是"没有 memo 可失效"

App 的 JSX 区域内（11264–13394）：

| 模式 | 数量 |
|---|---|
| inline 箭头函数 props（`x={() => ...}` / `x={(a,b) => ...}`） | **190** |
| 其中 `onX={() => ...}` | 141 |
| inline 对象字面量 props（`={{`） | 5 |
| inline 数组字面量 props（`={[`） | 0 |
| `.map(` / `.filter(` | 34 / 18 |

**必须纠正提问中的预设**：这 190 个 inline props 并没有"让 memo 失效"，因为接收它们的内联 JSX（`titlebar`/`sidebar`/`main-panel`/`tool-panel` 及其下的绝大多数节点）**根本不是独立组件、也没有 memo**。两个 memo 组件的 props 恰好都是干净的：`ProcessTimeline` 收 `toggleActivityCollapse`（`useCallback` 稳定引用），`InteractiveMessage` 只收 `content`。

inline props 的真实代价是两条：
1. **每次事件 190 个闭包 + 5 个对象字面量的分配**（在 20 次/秒的流式期间），纯 GC 压力；
2. **它把"未来任何局部 memo 化"的路全部封死** —— 只要父级还在重渲染，任何子组件想 memo 都得先把这 190 处 props 稳定下来。

### 3.7 高频 state 的真实来源：pointermove 拖拽（不是定时器）

`src/App.tsx:7566` —— 拖拽面板时每个指针事件都 setState 到 App 级 state：

```tsx
7566:  useEffect(() => {
7567:    const onPointerMove = (event: PointerEvent) => {
7568:      const resize = panelResizeRef.current;
7569:      if (!resize) return;
7570:      if (resize.edge === "left") {
7571:        const maxWidth = Math.max(260, window.innerWidth - (rightPanelOpen ? appliedToolPanelWidth : 0) - 420);
7572:        setSidebarWidth(Math.min(Math.max(event.clientX, 220), Math.min(520, maxWidth)));
7573:      } else {
7574:        const nextWidth = window.innerWidth - event.clientX;
7575:        const maxWidth = Math.max(360, window.innerWidth - (sidebarOpen ? appliedSidebarWidth : 0) - 420);
7576:        setToolPanelWidth(Math.min(Math.max(nextWidth, 320), maxWidth));
7577:      }
7578:    };
...
7587:  }, [rightPanelOpen, sidebarOpen, appliedSidebarWidth, appliedToolPanelWidth]);
```

`setSidebarWidth`/`setToolPanelWidth` 是 App 级 state（`6931`/`6932`）⇒ 每个 pointermove 都重建整个 App 树，频率 = 显示刷新率（60–120Hz）。**比流式事件（20Hz）更高**。

**额外缺陷**：effect 依赖里放了 `appliedSidebarWidth`/`appliedToolPanelWidth`，而它们在 `6947`/`6951` 由 `sidebarWidth`/`toolPanelWidth` 派生：

```tsx
6947:  const appliedToolPanelWidth = Math.min(
6948:    toolPanelWidth,
6949:    Math.max(360, viewportWidth - (sidebarOpen ? sidebarWidth : 0) - 420),
6950:  );
6951:  const appliedSidebarWidth = Math.min(
6952:    sidebarWidth,
6953:    Math.max(260, viewportWidth - (rightPanelOpen ? appliedToolPanelWidth : 0) - 420),
6954:  );
```

⇒ **handler 正在写的 state 又出现在 effect 依赖里**：每帧 setState → 派生值变化 → effect 重跑 → `removeEventListener` + `addEventListener` 摘挂一轮。拖拽期间每帧两次 DOM API 调用。

### 3.8 滚动跟随 effect 依赖 `sessions`（每事件重跑）

`src/App.tsx:8183`：

```tsx
8183:  const syncAtBottom = () => {
8184:    const viewport = viewportRef.current;
8185:    if (!viewport) return;
8186:    setAtBottom(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 48);
8187:  };
8188:
8189:  useEffect(() => {
8190:    syncAtBottom();
8191:  }, [sessions, runningSessionIds, activeId]);
```

依赖 `sessions` ⇒ 每个流式事件跑一次，读取 `scrollHeight`/`clientHeight`（**强制同步布局**）后 setState。因 `setAtBottom` 值通常不变，React 会 bail out，成本主要是每事件一次强制 reflow。

另有一条 `[sessions, ...]` 的 effect 在 `7797`，以及 `[activeId, sessions]` 的未读清理在 `8235`：

```tsx
8231:  useEffect(() => {
8232:    setSessions((current) => current.some((session) => session.id === activeId && session.unread)
8233:      ? current.map((session) => session.id === activeId ? { ...session, unread: false } : session)
8234:      : current);
8235:  }, [activeId, sessions]);
```

也会在每个流式事件上跑一次 `some()`（O(会话数)），靠返回同一引用 bail out —— 不构成死循环，但属于"用 effect 做派生"的反模式。

### 3.9 长列表：**没有虚拟化**

唯一的"虚拟化"是 CSS，且 Linux 上被关闭 —— `src/styles.css:3278`：

```css
3278: .message-row {
3279:   position: relative;
3280:   width: 100%;
3281:   margin: 0 0 29px;
3282:   /* 视口外跳过渲染（长会话数千 DOM 节点的廉价虚拟化）；
3283:      auto 记住上次渲染高度，回滚时不跳滚动条 */
3284:   content-visibility: auto;
3285:   contain-intrinsic-size: auto 160px;
3286: }
3287:
3288: /* Linux 上 Chromium 合成器对 content-visibility 子树有绘制偏移 bug，
3289:    表现为切换会话后整个界面左移、再切换又恢复，故在 Linux 关闭该虚拟化 */
3290: .platform-linux .message-row {
3291:   content-visibility: visible;
3292:   contain-intrinsic-size: none;
3293: }
```

三点必须说清：

1. **`content-visibility` 不减少 React 工作**。它跳过的是视口外元素的 layout/paint；`messages.map()` 该创建的元素、该生成的 DOM 节点一个不少，diff 也照做。它只降低"绘制"成本。
2. **本应用主平台之一 Linux 上它被完全关闭**（`:3290`），而 `App` 的 shell class 默认就是 `platform-${platform || "linux"}`（`11269`）。
3. 没有引入任何窗口化库（`react-window`/`react-virtual`/`virtuoso` 均无引用）。

`.map()` 直接产出全部消息行（`11810`），父容器是单一 `conversation-viewport` → `conversation-column`（`11787`/`11796`），无分页、无窗口。

**DOM 节点量级估算（500 条消息）**：

- **结构骨架（由代码数出来的下限）**：每行固定为 `div.message-row` + `div.assistant-message`（助手）或 `div.user-message-stack` + `div.user-bubble`（用户）+ `div.message-actions`/`span.message-meta` + 若干 icon/span。App JSX 中 `messages.map` 块（11810–12001）共出现 **43 处 JSX 开标签**（含所有条件分支），单条实际路径约 **8–12 个节点**。仅骨架：500 × 8–12 ≈ **4,000–6,000 节点**。
- **加上 `ProcessTimeline`**：默认收起态 4 个节点（容器+按钮+span+svg）；流式中默认展开（`3557`：`const collapsed = userCollapsed ? true : userExpanded ? false : !isStreaming;`），每条 `ActivityRow` 再加 6–8 个节点（`3366`–`3400`）。
- **加上 `InteractiveMessage` → react-markdown + rehype-katex + highlight.js**：这是**主导项**。普通段落级 Markdown 每条约 25–60 节点；但代码块经 `hljs` 高亮后会被切成**大量 `<span>`**（20 行代码块常见 100–400 个 span）。
- **估算结论（非实测，量级判断）**：500 条纯文本消息约 **1.5 万–2 万节点**；含若干代码块的长会话可达 **3 万–4 万节点**。在 Linux（无 content-visibility）下这些节点全部参与布局。

### 3.10 顺带发现的两处正确性风险

**(a) `traceEventsRef` 原地改数组后 setState 同一引用** — `src/App.tsx:10189`：

```tsx
10189:          } else if (agentEvent.type === "trace") {
10190:            traceEventsRef.current.push(agentEvent.trace);
10191:            if (traceEventsRef.current.length > 5000) traceEventsRef.current = traceEventsRef.current.slice(-5000);
10192:            setTraceEvents(traceEventsRef.current);
```

`push` 原地修改，随后传入**同一个数组引用**；React 走 `Object.is` 会判定未变而跳过渲染，导致轨迹台的更新不可靠。（此处不是性能问题，反而少渲染；但与紧邻的 10193 行注释「按 run 归位（不可变更新）」相矛盾——该注释说的是下面 `runTraceEventsRef` 那行，`setTraceEvents` 这行本身仍是可变的。）

**(b) 值缓存全清导致 memo 周期性失效** — `src/App.tsx:496`：

```tsx
496: function stripControlMarkersCached(text: string) {
497:   const source = String(text || "");
498:   const hit = strippedTextCache.get(source);
499:   if (hit !== undefined) return hit;
500:   const stripped = stripControlMarkers(source);
501:   if (strippedTextCache.size >= STRIP_CACHE_LIMIT) strippedTextCache.clear();
502:   strippedTextCache.set(source, stripped);
503:   return stripped;
504: }
```

缓存键是**字符串值**，靠值命中来保证 `InteractiveMessage` 的 `content` prop 引用稳定。`STRIP_CACHE_LIMIT = 400`（第 493 行）且驱逐策略是**整体 `clear()`**（第 501 行），不是 LRU。流式期间每个 50ms 事件都是一个不同的累积全文 ⇒ 20 个新条目/秒 ⇒ **约每 20 秒缓存被整体清空一次**。清空瞬间，所有可见消息的 `content` 都变成新字符串对象 ⇒ `InteractiveMessage` 的 memo 全部失效 ⇒ **整个可见对话的 Markdown 重新解析一轮**（含 highlight.js 高亮）。这正好解释了"长会话流式输出时周期性卡顿"。

---

## 四、量化汇总

| 指标 | 数值 | 依据 |
|---|---|---|
| `App()` 行数 | **6569**（6826–13394） | `grep -n '^}'` + wc |
| App 内 `useState` | **130** / 257（50.6%） | 出现次数；缩进全为 2 空格 |
| App 内 `useEffect` | **54** / 96 | 同上 |
| App 内 `useMemo` / `useCallback` | **17** / **2** | 同上 |
| App 的 JSX 行数 | **2131**（11264–13394） | —
| 顶层 JSX 子女 | 2（fragment）+ app-shell 下 **4** 个内联区块 | `^      <` 缩进扫描 |
| 依赖 `sessions`/`activeSession` 的 memo | **6** 个（7300/7479/7669/7797/8191/8235 等 effect 另有 8 个） | dep 数组扫描 |
| 全应用 memo 边界 | **2**（ProcessTimeline、InteractiveMessage） | 2 处 `memo(` |
| inline 箭头 props | **190**（其中 141 个 `onX`） | JSX 区域正则统计 |
| JSX 内 `.map(` / `.filter(` | 34 / 18 | 同上 |
| 流式事件率 | **≈20/秒**（50ms 节流） | `electron/main.mts:1942` |
| 拖拽事件率 | **60–120/秒**（刷新率） | `App.tsx:7572` |
| 每次流式事件的纯计算量（500 条消息） | **O(U² + U·N) ≈ 15.6 万次访问 + 250 次分配** | 11812 + 764 |
| 每 20 秒一次的全量 Markdown 重解析 | 全部可见消息 | `App.tsx:501` |
| 500 条消息的 DOM 节点 | **骨架 4,000–6,000；含 Markdown/高亮估算 1.5 万–4 万**（估算） | 43 个 JSX 开标签 + react-markdown |
| 虚拟化 | **无**（仅 `content-visibility: auto`，Linux 关闭，且不省 React 工作） | `styles.css:3279/3290` |

---

## 五、按性价比排序的优化清单

### P0 — 把"每事件 O(U×N)"的回合预览 memo 化（收益最大，风险最低）

**问题**：`conversationTurns`（8387）依赖整个 `activeSession`，每事件重算，内部对每条用户消息跑 O(N) 的 `conversationTurnPreview`（764）。

**改法**：`conversationTurnPreview` 的输入只需要"该用户消息 + 下一个用户消息之前的助手消息"，与后续消息内容无关。把它改成按 `messageIndex` 记忆，或把 memo 依赖从 `activeSession` 收窄为"用户消息数量 + 各用户消息引用 + 各自紧随的助手消息引用"。

**预期收益**：消除每事件 ~15.6 万次访问与 250 次分配（20 次/秒 ⇒ 约 310 万次/秒），长会话下主线程占用明显下降。
**风险**：低。需要仔细处理"助手消息内容流式增长时预览 detail 是否应实时更新"——但预览是 hover tooltip，滞后可接受。

### P0 — 给 `stripControlMarkersCached` 换成有界 LRU，或给流式消息单独绕开缓存

**问题**：`STRIP_CACHE_LIMIT = 400` 配整体 `clear()`（501），导致约每 20 秒一次全量 Markdown 重解析。

**改法**：换成 Map 的 LRU（`get` 后 `delete`+`set` 移到队尾，超限淘汰最旧的一条）；或对流式中的那条消息不做缓存（它的 content 每次都变，占满缓存却零命中）。

**预期收益**：消除周期性全量重解析尖峰，把"每 20 秒一次大卡"变成平滑。这是**用户体验感知最强**的一条。
**风险**：低。纯函数缓存语义不变。

### P1 — 把面板拖拽的 state 从 App 根部移出，或改为 ref + CSS 变量

**问题**：`setSidebarWidth`/`setToolPanelWidth`（7572/7576）每个 pointermove 重建整个 App 树；且依赖数组含派生值导致监听器每帧摘挂（7587）。

**改法**：拖拽期间把宽度写进 CSS 自定义属性（`element.style.setProperty('--sidebar-width', ...)`）或 ref，pointerup 时再同步一次到 state；顺手把 `appliedSidebarWidth`/`appliedToolPanelWidth` 从 effect 依赖里去掉（改用 ref 读取）。

**预期收益**：拖拽期间渲染次数从 60–120/秒降到 1–2 次；消除每帧 2 次 `addEventListener`/`removeEventListener`。
**风险**：中低。需保证夹取逻辑在 pointerup 时与拖拽中一致，以及窗口 resize 时重新夹取。

### P1 — 把消息行抽成 memo 组件，并把 `conversationTurns.findIndex` 预算成 Map

**问题**：11812 的 O(U²) 查找在渲染期执行；且消息行是内联 JSX，无法 memo。

**改法**：`useMemo` 一个 `Map<messageIndex, turnIndex>` 供 O(1) 查询；把 `activeSession.messages.map(...)` 的整块（11810–12001）提取为 `MessageRow` 组件并用 `memo` 包裹（props：`message`、`index`、`turnIndex`、`isStreaming` 等标量）。

**预期收益**：一次性消除 O(U²)，并把"每事件生成 N 条消息的全部 React 元素"降为只生成变化的那一条。这是**结构上最根本**的一条。
**风险**：中。这段 JSX 引用了大量 App 作用域闭包（约 20 个 handler），提取时需要用 Context 或 props 下传，改动面较大，容易引入行为回归。

### P2 — 引入真正的列表虚拟化

**问题**：无窗口化；Linux 上 `content-visibility` 被关闭（3290）。

**改法**：接入 `react-window` 或 `@tanstack/react-virtual`；至少为 Linux 恢复一种替代方案（例如按滚动位置裁剪渲染窗口）。

**预期收益**：DOM 节点从 1.5 万–4 万降到 ~1,000 量级，布局/绘制成本与节点数解耦。
**风险**：**高**。会话内有动态高度（流式文本增长、mermaid/echarts、图片懒加载）、有"贴底跟随"逻辑（7711–7797）、有 `content-visibility` 已知的合成器 bug 历史（3288）。虚拟化与现有的跟随/锚定逻辑冲突面大，建议放在 P0/P1 之后再评估。

### P2 — 稳定 190 处 inline props

**改法**：只对"已确定要 memo 的组件"处理，把 `onX={() => ...}` 换成 `useCallback` 稳定的 handler，`={{...}}` 换成 memo 常量。

**预期收益**：只有在 P1（消息行 memo 化）落地后才有实际收益；单独做收益很小。作为 P1 的前置条件看待。
**风险**：低（但对 190 处逐一改动的工时不小）。

### P3 — 修正两处正确性问题

1. `traceEventsRef` 原地 `push` 后 setState 同一引用（10190–10192）：改为不可变更新（`setTraceEvents(current => [...current, entry].slice(-5000))`），或明确只依赖 ref。
2. `8235` 用 effect 做"标记已读"派生：可改为在切换会话的 handler 里直接更新，去掉对 `sessions` 的依赖。

**预期收益**：无直接性能收益（第 1 条反而可能增加渲染），但消除状态不一致隐患。
**风险**：低。

### 不建议做的事

- **不要再给 `App()` 加 `useMemo`**：当前 17 个 `useMemo` 里有 6 个依赖 `sessions`/`activeSession`，加更多只会增加依赖比较开销，不解决根部 state 过大导致的整树重建。真正的解法是**拆分组件边界**（P1）而不是在单体里堆 memo。
- **不要指望 `content-visibility`**：它不省 React 工作，且在 Linux 上被关闭。

---

## 六、结论复述

「App 主组件是最主要的渲染性能瓶颈」——**成立，置信度高**。

准确表述是：瓶颈不在 `App()` 的**行数**，而在于**状态所有权过于集中** —— 130 个 `useState` 与整个 `sessions` 树同处一个组件，使得流式输出（20 次/秒）和面板拖拽（60–120 次/秒）这两条真实高频路径，每次都必须付出"重建 2131 行 JSX + 全部消息 React 元素 + 重算 6 个依赖会话的 memo"的代价。已有的两项优化（`RunningStatusLabel` 自持定时器、`ProcessTimeline` memo）恰好挡在两个最危险的位置上，才使应用在当前规模下尚可运行；但随着会话变长，`conversationTurnPreview` 的 O(U×N) 与 400 条缓存的周期性全清会最先暴露为可见卡顿。
