# DSH 轨迹 (Trajectory) 视图 — 实现级规范

来源包（只读研究）：`/Users/gdy/Documents/My/App/ai-learning/deepseek-harness/apps/cli/node_modules/@deepseek-ai/dsh-web-app/node_modules/@deepseek-ai/dsh-client-ui-trajectory`

下列 `file:line` 均相对该包 `src/client/`。CSS 值直接抄录自 `*.module.css`（`--dsw-*` 为宿主主题别名 token）。中文标签全部出自 `locales.ts` 的 `zh`（第 7–183 行），英文对照见同文件 `en`（200–376）。

---

## 1. 整体布局

### 1.1 顶层结构（`TrajectoryView.tsx:506-567`）

```
div.root[data-conversation-composer-overlay]   ← 视图外壳
├── TrajectoryToolbar                          ← 粘性工具栏
├── TrajectoryTimeline                         ← 泳道时间条（固定高 50px）
└── div.ledger
    └── TrajectoryTable
        └── div.split                          ← 横向 flex
            ├── div.tablePane                  ← 唯一滚动区（账本）
            └── aside.details                  ← 检查器侧栏（条件渲染）
```

工具栏/时间条/账本同属一个 flex 列；**只有账本滚动**；检查器是 `split` 的第二 flex 子项，不参与滚动。

### 1.2 尺寸与 flex

| 区域 | 规则 | 出处 |
|---|---|---|
| `div.root` | `display:flex; flex-direction:column; overflow:hidden; height:100%; min-height:0; width:100%`；自定变量 `--dsh-trajectory-toolbar-height:32px` | `views.module.css:2-14` |
| `div.root` | `data-conversation-composer-overlay=""`：请求宿主把输入框浮在视图上；宿主据此设 `viewArea{flex:1 1 0;min-height:0;overflow:hidden}` | `TrajectoryView.tsx:507`；宿主 `ui-conversation/.../ConversationRoot.module.css:392-396` |
| 工具栏 | `position:sticky; top:0; z-index:4; height:var(--dsh-trajectory-toolbar-height)`=32px；`border-bottom:0.5px solid var(--dsw-alias-border-l2)` | `TrajectoryToolbar.module.css:1-10` |
| 时间条 | `position:relative; z-index:1; isolation:isolate; flex:none; border-bottom:0.5px solid var(--dsw-alias-border-l2)`；`.plot` 高 **50px**、`grid-template-columns:44px minmax(0,1fr)` | `TrajectoryTimeline.module.css:1-20` |
| `div.ledger` | `position:relative; z-index:0; isolation:isolate; display:flex; flex:1; min-height:0; min-width:0; overflow:hidden`；`--dsh-trajectory-bottom-clearance: calc(var(--dsh-composer-height,152px) + 16px)` | `views.module.css:16-27` |
| `div.split` | `display:flex; flex:1; width:100%; min-height:0; overflow:hidden; container-type:inline-size` | `TrajectoryTable.module.css:1-13` |
| `div.tablePane` | `flex:1; min-width:0; overflow-x:hidden; overflow-y:auto; padding-bottom:var(--dsh-trajectory-bottom-clearance,0px)`；`container: trajectory-table / inline-size` | 同上 `:15-23` |
| `aside.details` | `flex:none; flex-direction:column; width:clamp(320px,38%,440px); max-width:calc(100% - 280px)` | 同上 `:866-877` |

### 1.3 粘性与滚动

- 工具栏/时间条是账本的 flex 兄弟，天然不随账本滚动（工具栏另声明 `sticky`，`TrajectoryToolbar.module.css:2-4`）。
- 唯一纵向滚动容器＝`div.tablePane`（`TrajectoryTable.module.css:20`）。
- `.table th{position:sticky;top:0;z-index:3;height:30px}`，但 `<table>` **没有 `<thead>`**（`TrajectoryTable.tsx:2326-2334` 只有 `<colgroup>` + `<tbody>`），该规则不产生可见表头。
- `historyLoading` 覆盖条：`position:sticky;top:0;z-index:5;height:0;overflow:visible;pointer-events:none`，内条高 30px（CSS `:25-46`）。
- 检查器内部：`.detailsHeader` 42px、`.detailTabs` 34px（均 `flex:none`），`.detailBody{flex:1;min-height:0;overflow-y:auto}`（CSS `:898-907, 962-978, 1021-1028`）。
- `@media (max-width:760px)`：`.details{position:absolute;top:0;right:0;bottom:0;width:min(92%,420px);box-shadow:-12px 0 32px rgba(0,0,0,.14)}`（CSS `:1761-1772`）。
- 容器查询 `@container trajectory-table (max-width:620px)`：`eventColumn` 122→50px、`.kindSlot` 76→19px、`.turnLabelFull` 隐藏 / `.turnLabelCompact`（`#N`）显示（CSS `:504-550`）。

### 1.4 默认窗口

挂载时只取「以挂载时刻尾部结尾的 50 个 Node」：`HISTORY_PAGE_NODES=50`（`TrajectoryView.tsx:34,161,169-185`）；更早历史由首行按钮按页追加。

---

## 2. 工具栏

`TrajectoryToolbar.tsx:51-126`。根 `role="toolbar"`，`aria-label=t('toolbar.aria')`=**「轨迹工具栏」**（`locales.ts:9`）。`.inner`：flex、高 100%、`padding:0 6px; gap:8px`（CSS `:12-20`）。

### 2.1 控件顺序

**① 时长按钮（图标+文本）** — `:55-73`
- 图标：内联 SVG 12×12，圆 `r=5.25` + `M8 4.75V8l2.25 1.5`（时钟/表盘），`stroke-width:1.25`，`stroke:currentColor`（`:63-71`；CSS `:59-67`）。
- 文本 `t('toolbar.duration')`=**「时长」**（`locales.ts:10`）。
- `aria-label` 恒为 `t('toolbar.useActualDuration')`=**「使用实际时长」**（`:58`）。
- `aria-pressed=actualDuration`；`title` 按下时为 `t('toolbar.useEqualWidth')`=**「使用等宽操作」**，未按下时为**「使用实际时长」**（`:60`）。
- 点击 `onActualDurationChange(!actualDuration)`（`:61`）。样式：高 20px、`padding:0 7px`、`gap:4px`、`border-radius:3px`；`aria-pressed=true` 时 `color:label-primary; background:interactive-bg-hover`（CSS `:29-52`）。
- 语义（`TrajectoryView.tsx:342-344`）：开＝用真实时长画块宽（`duration`/`actual`）；关＝等宽（`sequence`/`time`）。**默认 false**（`duration-store.ts:10` `createSnapshotStore(false)`，持久化键 `dsh.trajectory.duration`）。切换时清空时间轴选区（`TrajectoryView.tsx:510-513`）。

**② 「实际时间」开关 —— 当前被隐藏** — `:74-86`
`role="switch"`、`aria-checked={actualTime}`、文本 `t('toolbar.actualTime')`=**「实际时间」**（`locales.ts:13`）、自带 `.controlTrack`/`.controlThumb` 轨道滑块，但带 **`hidden`**，CSS `.control[hidden]{display:none}`（CSS `:87-89`）→ 不可见不可点。它控制的 `actualTime` 恒为 `false`（`TrajectoryView.tsx:145`），但语义已内建：开＝保留空闲空隙（真实挂钟），关＝压缩空闲（`timeline.ts:79-84,120-184`）。重实现时应保留该语义，是否展示由产品定。

**③ 轮次折叠按钮** — `:87-99`
- 图标字符：全折叠 `⊞`，否则 `⊟`（`:96`），`font:14px/14px var(--ds-font-family-code)`（CSS `:163-166`）。文本 `t('toolbar.turns')`=**「轮次」**（`locales.ts:14`）。
- `aria-label`/`title`：`allTurnsCollapsed ? '展开所有轮次' : '收起所有轮次'`（`:90,92`；`locales.ts:15-16`）；`aria-pressed=allTurnsCollapsed`。
- 作用：批量折叠/展开所有可折叠轮次（`TrajectoryView.tsx:467-477`）。
- 「可折叠轮次」判定（`TrajectoryView.tsx:424-437`）：`turn!==null` 且该轮内「非 `requestOnly` 且非 `system`」单元数 **>1**。
- 折叠效果（`TrajectoryTable.tsx:609-642`）：保留该轮首条内容行，其余替换为一条 20px 高 `collapsedSummary` 行，文本为 `"{步骤数} 个步骤 · {工具调用数} 个工具调用"`（`:588-607,630-640`）。

**④ 调用折叠按钮** — `:100-112`
- 图标 `⊞`/`⊟`（`:109`）。文本 `t('toolbar.calls')`=**「调用」**（`locales.ts:17`）。
- `aria-label`/`title`：`allAssistantsCollapsed ? '展开所有调用' : '收起所有调用'`（`:103,105`；`locales.ts:18-19`）；`aria-pressed=allAssistantsCollapsed`。
- 作用：折叠/展开每个可折叠助手下的工具调用（`TrajectoryView.tsx:488-498`）。
- 「可折叠助手」判定（`TrajectoryView.tsx:440-454`）：某 `message` 单元的下一个单元是 `tool`/`subtool`。
- 折叠效果（`TrajectoryTable.tsx:673-711`）：在该助手行后插入一条 20px `collapsedSummary` 行，文本 `"{N} 个工具调用 · {去重工具名,逗号分隔}"`（`:660-671`），并跳过原工具行。

**⑤ 搜索框（右对齐）** — `:114-124`
- 图标 `IconSearchOutline16 size={11}`（11×11 放大镜轮廓，`:115`；图形 `ui-primitives/src/icons/index.tsx:20-30`）。`type="search"`。
- `aria-label=t('toolbar.search')`=**「搜索轨迹」**（`:119`）；`placeholder=t('toolbar.searchPlaceholder')`=**「搜索」**（`:120`）。
- 布局 `.search{flex:0 1 164px; min-width:84px; height:22px; margin-left:auto; padding:0 6px; gap:4px; border:0.5px solid var(--dsw-alias-border-l4); border-radius:4px}`；hover 加深边框，`:focus-within` 转 business 主色（CSS `:168-205`）。

**匹配字段**（`trajectory-search-index.ts:39-73`）：拼成小写全文并做**空格分词 AND 全命中**（`terms.every(t=>text.includes(t))`，`:124-131`）：轮次位置标签（`turn N`／`between turns`）、组标题、`cell.kind`（message 另加字符串 `assistant`）、`cell.text`、`previewMarkdown`、`inputDetail`、`outputDetail`、`thinkingDetail`、`schemaDetail`、`result`、`resultPreviewMarkdown`、`callId`、所有 `sourceBlocks`/`outputBlocks` 的 `type/content/callId/toolName/attachment.name`、`JSON.stringify` 后的 `messageSource`/`promptDetail`/`previousPromptDetail`，再加 `markdownPreview(cell)` 与 `resultPreview(cell)`（`:26-37`）。索引重建 3s 节流（`TrajectoryView.tsx:33,355-373`）。

**呈现方式**＝过滤＋压暗（非高亮）：① `filterRecords`（`TrajectoryTable.tsx:501-524`）只保留命中行并重算 `groupStart/turnStart/turnEnd`（搜索时忽略轮次折叠，`TrajectoryTable.tsx:1875-1883`）；② 时间条 `data-search-match='true'/'false'`，未命中 `opacity:0.14`（`TrajectoryTimeline.tsx:713-715`；CSS `:249-251`）。

---

## 3. 时间条（泳道时间条）

组件 `TrajectoryTimeline.tsx`，投影逻辑在 `timeline.ts`。

### 3.1 泳道模型

固定 3 条语义泳道，`LaneLabels`（`aria-hidden`，`TrajectoryTimeline.tsx:192-200`）：

| lane | 顶部偏移 | 标签 |
|---|---|---|
| 0 | `top:7px` | `column.input`=**「输入」** |
| 1 | `top:21px` | `column.model`=**「模型」** |
| 2 | `top:35px` | `column.tools`=**「工具」** |

（标签 `TrajectoryTimeline.module.css:31-51`；块 `top:calc(var(--trajectory-span-lane) * 14px)`，`.lanes{top:7px;bottom:7px}`，CSS `:118-125,153-170`）

分配规则（`timeline.ts:51-55`）：`tool|subtool→2`；`message|compacted→1`；`system|user|context→0`。

### 3.2 四种投影模式

`TrajectoryTimelineMode='sequence'|'duration'|'time'|'actual'`（`timeline.ts:9`），由两布尔合成（`TrajectoryView.tsx:342-344`）：

| 实际时长 | 实际时间 | mode | 含义 |
|---|---|---|---|
| 关 | 关 | `sequence` | 等宽操作序列，忽略所有时间戳（**默认**） |
| 开 | 关 | `duration` | 真实时长宽度，空闲间隙被压缩 |
| 关 | 开 | `time` | 每块固定 8px 宽，位置按真实开始时间 |
| 开 | 开 | `actual` | 真实时长宽度 + 真实挂钟位置（保留空闲） |

`requestOnly===true` 的单元在任何模式都不产生块（`timeline.ts:91,128`）。

### 3.3 `sequence` 模式

`deriveTrajectoryTimeline`（`timeline.ts:86-118`）：按 turn→group→cell 摊平，每块占 `[i,i+1)`，域 `[0,spans.length]`；轮次边界 `{turn, time: spans.length}` 取该轮首块之前位置（`:94-99`）；空则返回 `null`。

### 3.4 时间域（timed 模式）

`deriveTimedTimeline(turns, actualDuration, compressIdle)`（`timeline.ts:120-185`）：
- 原始区间（`cellRange`，`:61-67`）：`start = cell.startedAt`（Unix 毫秒），`end = start + max(0, cell.timeSeconds*1000)`；`startedAt` 非有限数则整块丢弃。
- **空闲压缩**仅在 `compressIdle`（`duration` 模式）生效（`:147-157`）：区间按 `start`（再按 `end`）排序，维护 `coveredUntil`；当 `span.start > coveredUntil` 时把间隙累加进 `removedIdle`，并记录「该块之前的累计移除量」。每块 `start/end` 同减该累计值。
- **宽度**：`actualDuration ? span.end : span.start`（`:167`）——关闭「实际时长」时 `end` 塌缩到 `start`，宽度 0（渲染时受 `max(2px,…)` 保护）。
- **域**：`start=min(块 start)`，`end=max(块 end)`（`:179-184`）；轮次边界取该轮块 `start` 最小值（`:171-176`）。

### 3.5 块的水平位置与宽度（渲染）

每个可见 span（`TrajectoryTimeline.tsx:684-733`）：

```
left  = (span.start - model.start)/fullDuration   → --trajectory-span-left  = left*100%
width = (span.end - span.start)/fullDuration      → --trajectory-span-width = width*100%
gap   = min(widthPercent*0.08%, 1px)              → --trajectory-span-gap
```

CSS（`TrajectoryTimeline.module.css:153-170`）：

```css
left: calc(var(--trajectory-span-left) + var(--trajectory-span-gap));
width: max(2px, calc(var(--trajectory-span-width) - 2*var(--trajectory-span-gap)));
height: 8px; min-width: 2px; border-radius: 1px;
```

即块间留 8% 宽（≤1px）缝隙、最小可见宽 2px。`data-equal-duration`（=`mode==='time'`）时强制 `width:8px;min-width:8px`（`TrajectoryTimeline.tsx:710`；CSS `:220-223`）——「等宽」在保留真实位置时的表现。

**缩放**：`.root` 上 `wheel`（`passive:false`+`preventDefault`），以指针比例为锚：

```
nextDuration = clamp(domainDuration*exp(deltaY*0.0015),
                     min(mode==='sequence' ? 4 : 20, fullDuration),
                     fullDuration)
```

（`:355-386`；`MINIMUM_ZOOM_OPERATIONS=4`，timed 模式单位为毫秒故下限 20ms）。≥`fullDuration*0.999` 时视口复位 `null`（全量）。放大后经 CSS 变量把「域」映射到整条轨道：

```
--trajectory-domain-left  = -(domainStart - model.start)/domainDuration*100%
--trajectory-domain-width =  fullDuration/domainDuration*100%
```

（`:340-346`；`.lanes`/`.turnBoundaries` 消费 `left/width`，CSS `:118-135`）
**平移**：右键（`button===2`）拖动平移已放大视口（`:432-447,469-482`）；纯右键点击（位移<3px）清空选区（`:520-529`）。
**自动跟随**：选中块越出视口时平移过去，带 `data-animate-viewport` 180ms `left` 过渡（`:295-317`；CSS `:137-142`）。

> 长会话策略＝**整体概览 + 滚轮缩放 + 右键平移**；时间条本身**不虚拟化**，只渲染落在当前域内或当前选中的块（`:681-683`）；账本侧才用 `@tanstack/react-virtual`（§4.6）。

### 3.6 颜色与语义

基色 `background:var(--dsw-alias-label-secondary); opacity:.78`（CSS `:168-169`），按 `data-timeline-span` 覆写：

| 类型 | 颜色 | 出处 |
|---|---|---|
| `user` | `var(--dsw-alias-state-business-primary)` | CSS `:172-174` |
| `context` | `color-mix(in srgb, var(--dsw-alias-state-success-primary) 68%, var(--dsw-alias-label-secondary))` | CSS `:176-182` |
| `tool` | `var(--dsw-alias-state-warn-label)`，`opacity:1` | CSS `:210-214` |
| `subtool` | 同 tool | CSS `:210-214` |
| `message` | 解码色 `--trajectory-assistant-decoding-color = color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 60%, var(--dsw-alias-state-error-secondary))`，`opacity:1` | CSS `:184-198` |
| 任意 `data-error="true"` | `var(--dsw-alias-state-error-primary)`（覆盖以上全部） | CSS `:216-218`；写入 `TrajectoryTimeline.tsx:709` |
| `system`/`compacted` | 回落到基础灰（`label-secondary`，opacity .78） | 无专属规则 |

**工具块何时变红**：`span.isError===true` ← `cell.isError`（`timeline.ts:104,136`）；对工具而言源自工具结果 `isError`（`layout.ts:463,780`）或被中断调用（`trajectory-tool-definition.ts:183-194` 合成 `isError:true,error:{name:'Interrupted',code:'interrupted'}`）。

**模型块两段色（浅+深）**：当 `assistantTimingDetail` 可用（`TrajectoryTimeline.tsx:51-69`：`timingRecorded===true` 且 `stepStartTime/firstTokenTime/completedTime` 均有限、`first>=start`、`completed>=first`）时：

```
ttftFraction = ttftMs / (ttftMs + decodingMs)     → --trajectory-assistant-ttft = ttftFraction*100%
```

（`:689-695,726-728`）CSS 线性渐变切两段（`TrajectoryTimeline.module.css:200-208`）：

```css
background: linear-gradient(to right,
  var(--trajectory-assistant-ttft-color) 0,
  var(--trajectory-assistant-ttft-color) var(--trajectory-assistant-ttft),
  var(--trajectory-assistant-decoding-color) var(--trajectory-assistant-ttft),
  var(--trajectory-assistant-decoding-color) 100%);
```

浅色 `--trajectory-assistant-ttft-color = color-mix(in srgb, 解码色 54%, var(--dsw-alias-bg-layer-2))`（CSS `:190-194`）。**浅段＝首 token 之前等待（TTFT），深段＝生成/解码**。计时不全时不加 `data-assistant-timing`，退化为纯深色。

### 3.7 选中/悬停高亮（蓝色环）

- 悬停（且非当前选中）：`box-shadow: 0 0 0 1px var(--dsw-alias-bg-layer-2), 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 80%, transparent)`（CSS `:229-239`，`data-hovered="true"`）。
- 当前选中：同样双层描边、外层为**实色** `var(--dsw-alias-state-business-primary)`（CSS `:241-247`，`data-current="true"`）。块自身 `border-radius:1px`，故环为微圆角矩形。

> 该环是 `box-shadow` 描边。真正明显的「蓝色圆角环」出现在**账本行**：`tr:focus-visible{box-shadow:inset 0 0 0 1px business-primary}`（CSS `:225-227`）与左侧 3px `selectionRail`（CSS `:349-354`）。

其它：有选区时域外块 `data-selected='false'` → `opacity:0.2`（`:716-720`；CSS `:225-227`）；搜索未命中 `opacity:0.14`（CSS `:249-251`）。

### 3.8 点击与拖拽

| 手势 | 行为 | 出处 |
|---|---|---|
| 左键点**块** | `onRangeChange(null)` + `onRecordSelect(index)`：账本选中并滚动到该行（打开检查器） | `:538-546`；`TrajectoryView.tsx:416-420` |
| 左键点**空白** | 以点击点为锚扩成至少 `fullDuration/spans.length` 宽的最小选区并提交，同时 `onRecordFocus(最近块)`（只滚动不改选中） | `:547-568`；`TrajectoryView.tsx:421-423` |
| 左键拖拽 | 实时草稿选区（`data-dragging='true'`，18% 蓝底），松手提交 | `:432-463,520-536`；CSS `:321-326` |
| 拖到边缘 | 边缘 8%（≤32px）自动平移，步长 `domainDuration*2.5%`，强度随靠近程度（≥0.2） | `:486-515`；常量 `:21-23` |
| 拖拽 <3px | 判为点击（`MINIMUM_DRAG_PX=3`） | `:19,538` |
| 双击 | 清空选区 | `:603-606` |
| `Escape` | 清空选区 | `:571-575` |
| 右键点击 | 清空选区 | `:520-529` |
| 悬停空白 | 2px 竖线游标（`data-timeline-hover-line`，`--trajectory-hover-left`） | `:619-628`；CSS `:283-296` |

选区视觉：`.selection` 12% 蓝填充 + 左右各 100vw 的 58% 遮罩（压暗域外）；`.selectionEdges::before/::after` 为域边界 3px 蓝竖条（拖拽中 2px）（CSS `:253-319`）。

**时间条 → 账本联动**（`TrajectoryView.tsx:398-404,405-412`）：选区反查所有「与区间相交」的记录（`trajectoryTimelineFocusIndexes`，`timeline.ts:194-205`，条件 `span.start<=range.end && span.end>=range.start`），账本把命中行标 `data-timeline-focus="inside"`、其余 `"outside"` 并 `opacity:0.24`（`TrajectoryTable.tsx:2448-2450`；CSS `:196-198`），并自动滚到焦点中心/起点（`:2177-2243`）。若在账本点了焦点集之外的记录，选区被清除（`TrajectoryView.tsx:405-412`）。

### 3.9 Tooltip 与历史边界

- 每块挂 500ms `Tooltip`（`TIMELINE_TOOLTIP_DELAY_MS=500`，`:24,697-702`）。内容三行（`timelineTooltipLabel`，`:106-131`）：类型名（`kind.*`）；时间范围 `HH:MM:SS.mmm → HH:MM:SS.mmm`（本地时区，`toLocaleTimeString` 带 `fractionalSecondDigits:3`，`:97-104`）或仅 `开始于 {time}`；`总计 {duration}` 与 `首 token {ttft} · 解码 {decoding}` 以 ` · ` 连接。
- 空模型时 `.track` 居中显示 `timeline.noTimingData`=**「无计时数据」**（`:388-406`；CSS `:104-111`）。
- `hasEarlierRecords` 且当前域贴左边界时，轨道左上角出现高占满、宽 28px 的 `…` 按钮（`data-earlier-history`）；tooltip/aria=「点击加载更早的历史」/「正在加载更早的历史…」（`:202-238,611-618`；CSS `:64-102`）。

---

## 4. 账本行

`TrajectoryTable.tsx`。`<table class="table">` + `<colgroup>`（`.eventColumn` 122px / `.contentColumn` auto）+ 纯 `<tbody>`（`:2326-2334`；CSS `:120-142`）。行高统一 30px（CSS `:168-176`），折叠摘要行 20px（CSS `:734-737`），请求分隔行 0 或 9px（CSS `:208-218`）。

### 4.1 行类型（kind）

7 种（`trajectory-record.ts:9-16`），标签映射（`TrajectoryTable.tsx:42-50`）：

| kind | 中文标签 | 图标（13px 内联 SVG） |
|---|---|---|
| `system` | **系统** | `IconSettingsOutline16` 齿轮 |
| `user` | **用户** | `IconUserOutline16` 人形 |
| `context` | **上下文** | 信息圆环+i（`:71-89`） |
| `compacted` | **已压缩** | 四向收拢箭头（`:91-111`） |
| `message` | **助手** | `IconSparkle16` 星芒 |
| `tool` | **工具** | 扳手（`:52-69`） |
| `subtool` | **子工具** | 同扳手 |

> 账本用 `kind.assistant`=「助手」映射 `message`。旧版独立单元格 `TrajectoryCell.tsx:24-26` 用的是 `kind.message`=「消息」/`kind.sub`=「子项」；现行账本**不出现**「消息」「子项」。

**「轮次之间」不是 kind**，而是 section 标签：`turn===null`（独立压缩）时 `sectionLabel` 返回 `section.betweenTurns`=**「轮次之间」**（`TrajectoryTable.tsx:551-553`；`locales.ts:38`）。
**「第 N 轮」**＝`turn.label`=`第 {turn} 轮`（`locales.ts:37`），由 `.turnLabel` 徽标承担（§4.5）。
**组标题**（不渲染为独立行，仅用于分组/请求边界/搜索/标题）：`group.message`=**「消息」**（`layout.ts:192-196`）、`group.step`=`步骤 {step}`（`layout.ts:198-208`）、`group.compaction`=`压缩 {seq}`（`layout.ts:361`）（`locales.ts:39-41`）。

**请求编号行**（`requestOnly`）：为「有 request 但无可见 assistant 记录」插入的纯锚点，`kind` 借用 `message`（`layout.ts:274-296`），DOM 上 `data-request-only`、高 0、不可点、`tabIndex=-1`（`TrajectoryTable.tsx:2386,2416-2440,2451-2452`；CSS `:204-223`）。

### 4.2 每行内容

行＝`<tr>`（两 td）：左 `td.event`（`padding-left:36px; padding-right:4px`；窄屏 28px），右 `td.content`（`padding-left:4px`）（`TrajectoryTable.tsx:2497-2627`；CSS `:386-390,458-461,504-550`）。

**左列 `td.event`**（`:2498-2587`）：

1. **请求边界控件**（条件）：绝对定位 16×16 按钮，`top:-8px; left:calc(12px + runIndex*8px)`；`::before` 画 5px 圆点 + 2px 底色环；`::after` 用 `content:attr(data-label)` 的 9px/12px 等宽悬浮标签（`opacity` 0→1 + `translateX(-2px)→0`）。配色：hover/active 用品牌蓝；`data-request-status="error"` 用 `state-error-primary`；选中态为 18% 蓝底 + 1.5px 蓝环（CSS `:233-323`）。`aria-label`=`request.label`=`请求 #{request}`（压缩时 `请求 #{request} · 压缩`，`locales.ts:129-130`），`aria-pressed` 表是否正在检查该请求（`:2499-2517,2404-2408`）。
2. **轮次竖轨 `span.turnRail`**：`position:absolute; left:0; top:-1px; bottom:-1px; width:2px; background:var(--trajectory-turn-accent)`，`--trajectory-turn-accent = color-mix(in srgb, var(--dsw-static-blue-500) 22%, var(--dsw-alias-bg-layer-1))`；该轮内所有行都带（末行 `bottom:0`），错误行改 22% 红（CSS `:121-125,337-347,356-362`）。`activeTurn===record.turn` 时渲染（`:2519-2523`）。
3. **选中竖条 `span.selectionRail`**：`left:0;width:3px` 品牌蓝实色，仅当前选中行（CSS `:349-354`）。
4. **轮次徽标 `span.turnLabel`**：仅 `turnStart` 行。`position:absolute; top:0; left:0; padding:1px 5px; border-radius:0 0 2px; font:8px/10px var(--ds-font-family-code); font-variant-numeric:tabular-nums`，背景 `bg-module-platform`。内容两套：`.turnLabelFull`（完整 `第 N 轮`，`max-width:64px`）与 `.turnLabelCompact`（`#N`，`max-width:0;opacity:0`），窄容器互换（CSS `:392-433,541-549`）。`aria-label`=section 标签；激活轮次用 `.turnLabelActive`（蓝字+蓝底）（`:2527-2549`）。`system` 且为全表首行时不显示（`isInitialSystem`，`:2387-2388,2521`）。
5. **类型徽标 `span.kindTag`**：`inline-flex; height:19px; padding:0 5px; border-radius:4px; font-size:10px; line-height:16px; font-weight:650; letter-spacing:.035em`；内含 tooltip 图标槽 `.kindTagIcon`（宽 0、`opacity:0`、`scale(.8)`；窄容器展开为 13px）与文本 `.kindTagLabel`（`max-width:72px`）（CSS `:443-502,518-539`）。Tooltip 内容＝类型名，`side="right"`（`:2551-2586`）。

徽标配色（CSS）：`.user{color:state-business-primary;background:state-business-tertiary}`（`:594-597`）；`.systemNeutral`/`.compacted`＝`label-secondary`+`bg-module-platform`（`:599-602,613-616`）；`.contextGreen`＝68% success 混色 + `state-success-tertiary`（`:604-611`）；`.assistantVioletBright`＝解码色 + 该色 15% 混底色（`:687-702`）；`.toolAmber`＝`state-warn-label`+`state-warn-tertiary`（`:704-707`）；`.subtoolAmber`＝warn 62%+`label-tertiary` / warn-tertiary 58% 混底色（`:709-720`）。

**右列 `td.content`**（`:2589-2627`）：
- 折叠摘要行：`…` + 摘要文本（`.collapsedTurnContent` 12px/16px 省略号）（CSS `:753-775`）。
- 普通行：外层 `span`（有结果用 `.resultPreview`，否则 `.contentText`），`title`＝显示文本或 `"{请求侧} → {结果侧}"`。
- `.resultPreview`＝两列网格 + 8px 间距（CSS `:777-797`）：

```css
grid-template-columns:
  clamp(180px, var(--trajectory-tool-request-width, calc(36cqw - 56px)), 480px)
  minmax(0, 1fr);
```

左列＝工具调用/请求侧（默认 `36cqw-56px`，夹在 180–480px），右列＝结果侧；两列各自 ellipsis + nowrap。
- **工具调用等宽排版**：`name` 用 `.toolCallNameTypeface`（`400 12px/18px Menlo, Consolas, 'Liberation Mono', 'PingFang SC', 'Microsoft YaHei'`），`args` 用 `.toolCallPayload`（`margin-left:7px`，`400 12px/18px var(--ds-font-family-code)`，次要色）。`tool`/`subtool` 行的 `.contentText`/`.resultPreview` 整体切等宽 12px（CSS `:799-817`）。
- **箭头分隔符**：`<span class="arrow">→</span>`（`margin-right:8px`，caption 色）+ `.inlineResultText`（`TrajectoryTable.tsx:2614-2624`；CSS `:823-838`）；结果侧 `isError` 时整段变红（CSS `:840-842`）。
- **无输出压暗**：结果等于 `record.noOutput`（**「无输出」**）时用 `.noOutputText`（caption 色）（`:2617-2619`；CSS `:830-832`）。
- **仅工具调用的助手行**：显示 `record.toolCallOnly`=**「（仅工具调用）」**（半角括号）（`:1021-1026,1080-1082`；`locales.ts:103`）。
- 缺文本兜底 `—`（`:1083`）。

**截断上限**：单行 CSS 省略号 + 预览硬上限——Markdown 源取前 **2048** 字符，抽纯文本后压空白，再截到 **512** 字符，超限补 `…`（`trajectory-preview.ts:5-20`）。`cell.text`（工具名等）不走该路径（`TrajectoryTable.tsx:986-1006`）。
**子工具缩进**：`tr[data-kind='subtool'] .content{padding-left:26px}`（CSS `:819-821`）——仅内容列缩进。

### 4.3 分组/缩进规则

1. **轮次 section**：`turn → 多个 group`；section 标签只在 `turnStart` 行出现（`flattenRecords`，`:474-499`）。`turn===null` 的独立压缩自成一 section，按首 cell index 排序（`layout.ts:535-545`）。
2. **组（消息/步骤 N/压缩 N）在账本中无独立标题行**：`group.title` 只用于 `groupStart` 标记、请求边界键、搜索索引、检查器标题（`:487-488,2389-2393`）。旧版 `TrajectoryGroupHeader`（36px 高，标题+次要描述）**只剩测试引用**，现行账本不渲染。
3. **`turnStart`**：每 section 第一条「非 requestOnly、非 system、且（非 compacted 或 `turn===null`）」的行（`:479-483`）；该行上方画 2px 分隔线 `td::before{height:2px;background:var(--dsw-alias-border-l1);transform:translateY(-50%)}`（CSS `:368-384`），紧跟「加载更早的历史」行时不画（CSS `:64-67`）。
4. **`turnEnd`**：section 末行（`:495-497`），使轮次竖轨收口。
5. 全程**扁平**：层级只通过 `data-turn-start`/`data-group-start`/`data-turn-end` + 单条轮次竖轨表达（`:2441-2445`）。

### 4.4 展开/折叠

| 交互 | 效果 | 出处 |
|---|---|---|
| 单击折叠摘要行 | 展开对应轮次或助手的工具调用 | `:2451-2458` |
| 单击普通行 | 选中该记录（打开检查器） | `:2459` |
| 双击折叠中的轮次任意行 | 展开该轮 | `:2460-2466` |
| 双击助手行 | 其下有工具调用则折叠/展开这些调用 | `:2467-2474` |
| 双击 `turnStart` 行 | 折叠/展开该轮（内容行 ≤1 时忽略） | `:2475-2482` |
| `Enter`/`Space` | 同单击语义 | `:2484-2495` |
| 点表盘空白 | 清空记录选择 + 清空时间轴选区 | `:2314-2316` |

行的可访问名（`:2418-2431`）：折叠行用 `request.collapsedSummary`=`已收起的{kind}概述，{summary}`（kind＝「轮次」/「助手」，`locales.ts:134-136`）；`requestOnly` 行用 `请求 {request}，压缩`；普通行用 `{request}{kind}，{content}`（`request` 前缀 `请求 {request}，`，`content` 空时用 `无内容`）（`locales.ts:137-140`）。`aria-selected` 同步选中态（`:2432`）。

### 4.5 请求编号与边界圆点

- 请求编号为**会话全局**：`TrajectoryView.tsx:210-310` 把 assistant 请求与 assistant 节点按 `startSeq`/`seq` 归并排序后依次编号（`number=index+1`），同时累加 `cumulativeUsage`；压缩请求也占号，`group`＝`压缩 {startSeq}`。
- 组内若该「请求组」存在且首行不是 `user`/`context`，就在该行渲染边界圆点（`indexRequestBoundaries`，`:536-549`）。
- 多个 requestOnly 锚点连续堆积时，圆点用 `--request-boundary-offset: runIndex*8px` 逐级右移（`indexRequestBoundaryRuns`，`:565-586`；`:2400-2403`）。
- 表尾残留的悬挂圆点行高 9px（`data-terminal-request-boundary`，CSS `:215-218`）。

### 4.6 虚拟化与历史分页

- 阈值：`records.length > 100` 或存在更早历史（`VIRTUALIZATION_THRESHOLD=100`，`:38,1889-1890`）。
- `useVirtualizer`：`estimateSize` 用稳定结构缓存的高度、`getItemKey` 用语义 key、`overscan:12`、`scrollMargin: hasOlderRecords?30:0`、`anchorTo:'end'`、`followOnAppend:'auto'`、`scrollEndThreshold:2`（`:1891-1913`；常量 `:35-40`）。
- **虚拟行合并**：`requestOnly`（0 高）并入**下一条**可测行，作为同一虚拟项的多个 `<tr>`；行尾残留的单独成 9px 项（`trajectory-virtual-rows.ts:51-82`；高度常量 30/20/9，`:6-8`）。
- 上下用零内容 `<tr class="virtualSpacer">` 撑高（`:2368-2377,2633-2642`；CSS `:178-186`）。
- 首次定位：等初始历史加载完成后 `scrollToEnd({behavior:'auto'})`（或非虚拟路径直接 `pane.scrollTop=pane.scrollHeight`）；就绪前表体 `visibility:hidden`（CSS `:106-108`，逻辑 `:2266-2295`）。
- 尾部跟随：`scrollHeight-clientHeight-scrollTop <= 2` 视为贴底，新增记录自动贴底；上滑即暂停（`:2307-2312,2287-2288`）。
- 加载更早：滚动到 `scrollTop <= 48` 自动请求，或点首行按钮（`:2244-2265`；`OLDER_LOAD_THRESHOLD_PX=48`）。前置分页后用 `scrollTop + (newScrollHeight-oldScrollHeight)` 复原视觉位置（`:2266-2277`）。
- 行 key＝`trajectoryVirtualRecordKey`（`encodeURIComponent(trajectoryRecordId(cell))`，折叠摘要追加 `\u0000summary\u0000{kind}`），前置历史不打乱测量缓存（`trajectory-virtual-rows.ts:35-42`）。
- 记录身份 `trajectoryRecordId`：优先 `recordId`，否则 `kind\0call\0{callId}`，否则 `kind\0seq\0{sourceSeq}`，否则 `kind\0index\0{index}`（`trajectory-record.ts:106-111`）；助手稳定 id 形如 `assistant\0{turn}\0{step}`（`layout.ts:727`）。

---

## 5. 检查器（右面板）

`aside.details`，`aria-label=details.event`=**「事件详情」**（`TrajectoryTable.tsx:2649-2653`；`locales.ts:145`）。

### 5.1 顶部标题

`.detailsHeader` 高 42px，左侧按对象分三种（`:2730-2787`）：

1. **请求**：`<span.requestDetailsDot>` 5px 圆点 + `request.label`=**`请求 #{N}`**（压缩请求也是 `请求 #{N}`）+ `.detailsLocation`；压缩时位置用 `request.compaction`=`压缩 · {section}`，否则为 section 标签（`第 N 轮`/`轮次之间`）（`:2732-2745`）。
2. **系统提示词记录**：**「系统」** 徽标 + `selected.cell.text`（即「初始系统提示词」/「系统提示词已更新」/「工具已更新」/「系统提示词和工具已更新」，`layout.ts:808-813`）。
3. **普通记录**：类型徽标（系统/用户/上下文/已压缩/助手/工具/子工具）+ 位置 `"{section} · {group}"`；`已压缩` 只显示 section（`:2753-2777`）。

> 用户举例的标题格式 **「助手 第 1 轮 · 第 31 步」** 对应形态 3：徽标 `助手`，位置 `{sectionLabel} · {group.title}`＝`第 1 轮 · 步骤 31`。注意现行 `group.step` 文案是 **「步骤 {step}」**，不是「第 31 步」。

右上角关闭按钮 `×`（28×28、圆角 6px），`aria-label=关闭详情`（`:2779-2786`；`locales.ts:148`）。
另有**拖拽调宽手柄** `.detailsResizeHandle`：`left:-4px;width:8px;cursor:col-resize`，`role="separator"`、`aria-label=调整事件详情宽度`、`title=拖动调整大小；双击恢复默认值。`；支持指针拖拽、`←/→` 每次 16px、双击复位（`:2654-2729`；`locales.ts:146-147`）。宽度由 `clampDetailsWidth` 限制在 `[320, min(720, splitWidth-280)]`（`:202-205,266-272`）；拖拽同时按 `TOOL_REQUEST_SHARE=0.58` 联动工具行左列宽度（`:2056,2685-2726`）。

### 5.2 标签页集合

由对象类型决定（`detailTabs`，`:955-984`）：

| 对象 | Tab 次序（labelKey → 中文） |
|---|---|
| 请求（`selectedRequestInfo`） | `overview`=**概述**、`options`=**选项**（仅有 requestConfig）、`usage`=**用量**、`timing`=**计时** —— `REQUEST_TABS`（`:219-224,2031-2033`） |
| `system`（初始） | `system-prompt`=**系统提示词**、`tools`=**工具** —— `SYSTEM_PROMPT_TABS`（`:211-214`） |
| `system`（更新，有 previous） | `diff`=**差异**、`system-prompt`=**系统提示词**、`tools`=**工具** —— `SYSTEM_UPDATE_TABS`（`:215-218`） |
| `compacted` | `overview`=**概述**、`raw`=**原始输出**（`:961-966`） |
| markdown 类（`user`/`context`/`message`） | `overview`=**概述**、`rendered`=**预览**、`raw`=**原始内容**、`source`=**来源**（仅有 `messageSource`）（`:967-976`） |
| 其它（`tool`/`subtool`） | `overview`=**概述**、`input`=**参数**（有 `inputDetail`）、`output`=**结果**（有 `outputDetail`）、`schema`=**Schema**、`timing`=**计时**（`:977-983`） |

标签栏 `.detailTabs` 高 34px、横向可滚、隐藏滚动条；激活 tab 用 2px 品牌蓝下划线（左右各 9px 缩进）（CSS `:962-1013`）。切换时维护「最近使用 tab」并按新对象可用集合回退（`activateTab` `:2058-2062`；`selectRecord` `:2074-2084`）。

### 5.3 概述（概述 tab）

概述 = 上半部定义列表（可滚动，`data-summary-scroll-region`）+ 下半部可折叠子块（`.overviewSections`）。

#### A. 请求对象的概述字段（顺序固定，`:2816-2911`）

| 顺序 | 标签 | 值 | 出处 |
|---|---|---|---|
| 1 | `details.status`=**状态** | `statusLabel`：失败/等待中/已完成 | `:2820-2825`；`:723-727` |
| 2 | `details.purpose`=**用途**（仅压缩） | `request.compactionPurpose`=**压缩** | `:2826-2831` |
| 3 | `details.provider`=**提供方**（有值时） | `provider ?? requestConfig.provider` | `:2832-2841` |
| 4 | `details.model`=**模型**（有值时） | `model ?? requestConfig.model` | `:2842-2851` |
| 5 | `details.toolCalls`=**工具调用** | 组内 `kind==='tool'` 计数 | `:2852-2855,1991-1993` |
| 6 | `details.subtoolCalls`=**子工具调用**（>0） | `kind==='subtool'` 计数 | `:2856-2861,1994-1996` |
| 7 | `details.error`=**错误**（有值，红字） | `requestErrorMessage`：`errorCode==='AUTH'`→**「API 密钥无效」**；`error==='trajectory.compaction-interrupted'`→**「上下文压缩在完成前被中断。」**；否则原始 `error` | `:2862-2867,729-736`；`locales.ts:156,182` |
| 8 | `details.retry`=**重试**（有值） | `{details.scheduled=已计划} {retry}`；有 `maxRetries` 时用 `request.retryProgress`=`{retry}/{maximum}` | `:2868-2880`；`locales.ts:132,157-158` |
| 9 | `details.retryDelay`=**重试延迟**（有值） | `formatDurationMs` | `:2881-2886` |
| 10 | `details.result`=**结果**（有值） | 可点跳转：压缩→**已压缩**，否则→**助手消息**，带 11px 右箭头 | `:2887-2910` |

#### B. 压缩记录（`compacted`）概述（`:2971-3011`）

`状态` → `时长`（`formatElapsedSeconds`）→ **`Token`** 恒为 `—`；其下若有 `outputDetail`，再渲染一块 `.compactedSummary`（Markdown 渲染的压缩摘要）。

#### C. 普通记录概述（`:3013-3161`）

| 顺序 | 标签 | 值/条件 |
|---|---|---|
| 1 | `details.source`=**来源**（有 `messageSource`） | 可点链接，文本由 `messageSourceLabel` 定：`user`→**用户**；`plugin`→**插件 · {plugin}** 或 **插件**；`goal`→**目标 · Round {round}** 或 **目标**；未知→`未知`；其它 kind→首字母大写 | `:3023-3040`；`:866-887`；`locales.ts:81-88` |
| 2 | `details.source`（助手可定位到请求）或 `details.hierarchy`=**层级** | 可点链接集合：`请求 #{N}` / **助手消息** / **工具调用** | `:3041-3092`；`locales.ts:163-165` |
| 3 | `details.status`=**状态** | 失败/等待中/已完成 | `:3093-3098` |
| 4 | `Token`（仅 `message`） | 见 D | `:3099-3101` |
| 5 | `timing.duration`=**时长**（仅 `user`/`context`） | `formatElapsedSeconds` | `:3102-3107` |

#### D. `Token` 行（助手记录，`TokenRows`，`:738-762`）

| 标签 | 值 |
|---|---|
| `usage.tokens`=**Token** | `cell.output` 未定义→`—`，否则 `{value} tok` |
| `usage.reasoning`=**推理**（仅 `think` 有值） | `{think} tok`，缩进类 `.requestTokenDetail` |
| `usage.content`=**内容**（output 与 think 均有值） | `{max(0, output-think)} tok` |

#### E. 概述下半部可折叠子块（顺序，`:3109-3159`）

每块是 `OverviewSection`：`.overviewHeading`（高 28px，标题按钮 + 12px 右箭头）点击**跳到对应整页 tab**；`.overviewPreview` 为可滚动预览区（`data-summary-scroll-region`，滚动条默认透明，hover/focus 才显形）（`:1763-1792`；CSS `:1051-1060,1175-1266`）。

- **markdown 类记录**：① `tab.preview`=**预览**（渲染后 Markdown，含 `思考` 折叠、工具调用列表、图片）。
- **其它记录**：① `tab.payload`=**参数**（有 `inputDetail`）② `tab.result`=**结果**（有 `outputDetail`）③ `tab.schema`=**Schema**。
- 该助手可映射到请求时：追加 **`timing.request`=「请求计时」** 子块（点击跳到计时 tab）。
- `tool`/`subtool`：追加 **`tab.timing`=「计时」** 子块。

> 用户举例的「预览 › 思考」对应：`预览` 子块内 `MarkdownRecordContent` 把思考内容包在 `.thinkingQuote`，标题按钮文案 `record.thinking`=**「思考」**，带右箭头（展开时旋转 90°），`aria-expanded` 同步；默认折叠（`thinkingExpanded=false`，`:1828`）（`:1473-1490`；CSS `:1345-1392`）。

### 5.4 计时（`计时` tab / `请求计时` 子块）

由 `RecordTiming`（`:1544-1554`）分派：

**(a) 助手记录（有 `assistantMetrics`）→ `AssistantTimingPanel`**（`:362-375`），字段顺序与格式：

| 顺序 | 标签 | 计算 | 不可用时回退（按优先级） |
|---|---|---|---|
| 1 | `timing.started`=**开始时间** | `StartedAtValue`：本地 `YYYY-MM-DD HH:MM:SS.mmm`（padStart 补零，本地时区）；点击在本地时间与 Unix 秒（`(ms/1000).toFixed(3)`）间切换，`title`＝「显示本地时间」/「显示 Unix 时间戳」 | 时间戳非有限数→**「不可用」** |
| 2 | `timing.totalDuration`=**总时长** | `formatDurationMs(max(0, completedTime - stepStartTime))` | `!timingRecorded`→**「未记录」**；`stepStartTime===null`→**「步骤开始时间不可用」**；`completedTime===null`→**「等待中」** |
| 3 | `timing.ttft`=**首 token 延迟** | `formatDurationMs(max(0, firstTokenTime - stepStartTime))` | 「未记录」/「步骤开始时间不可用」/ `firstTokenTime===null`→**「首 token 时间不可用」** |
| 4 | `timing.generation`=**生成** | `formatDurationMs(max(0, completedTime - firstTokenTime))` | `!timingRecorded \|\| firstTokenTime===null`→「首 token 时间不可用」；`completedTime===null`→「等待中」 |
| 5 | `timing.throughput`=**吞吐量** | `outputTokens / ((completedTime-firstTokenTime)/1000)`，`toFixed(1)` + ` tok/s` | `!usageProvided`→**「用量不可用」**；`outputTokens===null`→**「输出 token 数不可用」**；缺 firstToken→「首 token 时间不可用」；`completedTime===null`→「等待中」；`generationSeconds<=0`→**「时长过短」** |

（`:330-360` 五个格式化函数；`:310-328` `StartedAtValue`；回退文案 `locales.ts:42-58`。）

**时长格式化规则**（`formatDurationMs`，`:284-289`）：`<1000ms` → `{Math.round(ms)} 毫秒`；`<10000ms` → `{ms/1000 toFixed(2)} 秒`；否则 → `{ms/1000 toFixed(1)} 秒`。
另一路径 `formatElapsedSeconds`（秒入参）→`formatDurationMillis`，输出**整数毫秒带千分位**，null/非有限数→`—`（`trajectory-record.ts:119-141`）。同一时间在不同位置可能呈现为「1,234 毫秒」或「1.23 秒」。

**(b) 有 `request.startedAt` 的请求对象**（`:1568-1582`）：`开始时间`（同上可切换）、`时长`=`formatElapsedSeconds(max(0,(completedAt-startedAt)/1000))`、`计时来源`（`timing.source`=**「计时来源」**）＝`completedAt` 未知时**「会话时间戳（运行中）」**，否则**「会话时间戳」**（`locales.ts:61-62`）。

**(c) 兜底**（`:1583-1591`）：`开始时间` 取锚点记录（或**「不可用」**），`时长` 显示 `—`。

**(d) 非助手记录的 `计时` tab**（`:1547-1553`）：三项——`开始时间`、`时长`=`formatElapsedSeconds(cell.timeSeconds)`、`计时来源`=`cell.timeSeconds===null ? 不可用 : 会话时间戳`。

### 5.5 其余 tab

| tab | 内容与回退 |
|---|---|
| `选项` | `JsonTree` 渲染 `requestConfig`，标题 `请求选项 JSON`；缺省→**「未记录选项」**（`:844-864`；`locales.ts:79-80`） |
| `用量` | 上下两组 `本次请求`/`会话累计`，各 `UsageRows`（`:821-842`）。`UsageRows` 顺序：`输入`（input+cacheRead+cacheWrite 之和，三者任一有值才显示）、`缓存读取`（缩进）、`缓存写入`（缩进）、`其他`（原始 input，缩进）、`输出`、`推理`（缩进）、`内容`（output-reasoning，缩进）；`usage===undefined`→**「未报告用量」**（`:773-819`；`locales.ts:68-78`） |
| `原始输出`（compacted） | `MarkdownRecordContent rendered={false}`：优先渲染 `sourceBlocks`（逐块 `块 #{index} {type}` + `<pre>`），含 `思考` 折叠 |
| `预览` | 渲染后 Markdown；含 `思考` 折叠、`助手` 工具调用列表（扳手图标+工具名+参数，点击跳到该调用概述）、图片画廊（`conversation.trajectory.images` slot） |
| `原始内容` | 同上但 `rendered={false}`；有 `sourceBlocks` 时按模型块序逐块输出 |
| `来源` | `JsonTree` 渲染 `messageSource`，标题 `消息来源 JSON`；缺省→**「未记录来源」**（`:889-903`；`locales.ts:88`） |
| `参数` | `RecordPayload direction="input"`：无值→**「未捕获参数」**；JSON 容器→`JsonTree`（标题 `参数 JSON`）；否则 `<pre>`（`:1594-1685`；`locales.ts:105,114`） |
| `结果` | direction="output"：无值→**「未捕获结果」**；`isError` 时整块红；单文本块且可解析 JSON→`JsonTree`（标题 `结果 JSON`）；有 `outputBlocks`→`ToolOutputBlocks`（图片走画廊，文本进 `<pre>`）（`:1594-1685,1390-1426`；`locales.ts:106,115`） |
| `Schema` | 无 `schemaDetail`→**「Schema 不可用」**；可解析为 `{name,description,parameters}`→名字+描述+`参数`小节+`{name} 参数 JSON` 树；否则 `<pre>`（`:1687-1752`；`locales.ts:108,113`） |
| `系统提示词` | 空串→**「本次请求没有系统提示词」**；否则 `MarkdownText` 渲染 `prompt.system`（`:2959-2967`；`locales.ts:117`） |
| `工具` | 工具目录：每项 `<details>`（12px 箭头+扳手+名称+截断描述；展开后完整描述+`{name} 参数 JSON` 树）；空列表→**「本次请求没有工具」**（`:1279-1309`；`locales.ts:118`） |
| `差异` | `structuredPatch('','',before,after,undefined,undefined,{context:3})`，逐 hunk 输出 `@@ -a,b +c,d @@` 元行 + 新增/删除/上下文行；分 `系统提示词` 与 `工具` 两节，仅实际变化才渲染该节（`:1311-1388`；`locales.ts:119-120`） |

`.overview` 网格：`dt` 列固定 94px（`grid-template-columns:94px minmax(0,1fr)`），行高 22px，缩进项额外 `padding-left:12px`（CSS `:1066-1118`）。

---

## 6. 数据需求表

### 6.1 事件来源层（`layout.ts` / `*-definition.ts`）

| UI 值 | 语义 | 本实现来源 |
|---|---|---|
| `kind:'user'` | 真人用户消息，开启一轮 | `user/message` 且 `data.source.kind==='user'` 且未被 next-step 认领（`trajectory-message-definitions.ts:139-176`） |
| `kind:'context'` | 非用户来源注入消息（插件/技能/目标/指令/快照/通知/转发/召回） | 同事件、`source.kind!=='user'`；`contextProvenance` 再细分 role/label（`trajectory-event-projection.ts:60-78`） |
| `kind:'user'`（steering） | 被 next-step inbox 认领的用户消息（转向指令） | `agent/inbox/spliced` 的持久 splice 链 + `currentClaimed`（`trajectory-message-definitions.ts:84-134,158-168`） |
| `kind:'assistant'`(message) | 一次助手回复记录 | assistant Definition 装配的 `AssistantMessageNode`（`layout.ts:697-753`） |
| `kind:'tool'`/`'subtool'` | 一次工具调用（及 `run_code` 子派发） | 助手块的 `tool-call` + 对应工具结果节点（`layout.ts:442-475,755-787,1003-1053`） |
| `kind:'system'` | 系统提示词/工具目录的初始或更新状态 | `request/header` 经 `inspectRequestPrompt(previous,event)` 得 `{prompt,change}`（`trajectory-request-header-definition.ts:14-44`） |
| `kind:'compacted'` | 一次上下文压缩请求 | `compaction/*` 事件（`trajectory-compaction-definition.ts:34-99`） |
| 轮次号 `turn` | 会话轮次 | 事件数据 `turn`；`user/message` 无 turn，用「下一个 assistant 的 turn / partial 的 turn / 最后一个 assistant+1 / 1」推断（`layout.ts:869-878`） |
| 步骤号 `step` | 轮内步骤 | 事件数据 `step`；`step<=0` 视为「按消息」而非「按步骤」分组（`layout.ts:415-416`） |
| 排序 seq | 会话日志单调序号 | 各事件 `seq`（`anchorSeq`）；初始 system 用 `-Infinity` 排最前（`layout.ts:106-110`） |
| 绝对时间 `startedAt` | 该操作真实开始时刻（Unix 毫秒） | 消息=`node.time`；系统=`change.time`；工具=`callTime`；压缩/请求=`startedAt`（`layout.ts:143,288,314,356,465,514`） |
| 自身时长 `timeSeconds` | 该操作自身占用秒数 | 消息=`node.time-(timing.stepStartTime ?? prevAbsTime)`；工具=`result.time-result.callTime`；子工具=`sub.time-sub.callTime`（`layout.ts:687-690,713-715,759-761,1040`） |
| `assistantMetrics.timingRecorded` | 是否记录了计时三元组 | `node.timing !== undefined`（`layout.ts:746`） |
| `assistantMetrics.stepStartTime` | 步骤开始时刻 | `node.timing.stepStartTime`（仅当观察到流式 start，否则 null）（`trajectory-assistant-definition.ts:263-265`） |
| `assistantMetrics.firstTokenTime` | 首个可见 token 到达时刻 | 首个非空 `text-delta`/`reasoning-delta`/非空 `tool-call-delta` 的 `time`（`trajectory-event-projection.ts:147-157`；`trajectory-assistant-definition.ts:188-189`） |
| `assistantMetrics.completedTime` | 步骤完成时刻 | `node.time`；流式 partial 恒 null（`layout.ts:749`） |
| `assistantMetrics.usageProvided` | 是否带用量 | `usage!==undefined`（`layout.ts:750`） |
| `assistantMetrics.outputTokens` | 输出 token 数 | `usage.outputTokens`（`layout.ts:751`） |
| `cell.output/input/cacheRead/cacheWrite/think` | 输出/输入/缓存读/缓存写/推理 token | `usage` 的 `outputTokens/inputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens`（`layout.ts:942-950`） |
| `cell.isError` | 失败标记 | 工具结果 `isError`；中断调用合成 `isError:true`；请求 `status==='error'`（`layout.ts:289,352,463,782,1035`；`trajectory-tool-definition.ts:183-194`） |
| `cell.text` | 非 Markdown 摘要或前缀 | 工具=工具名；系统=提示词变更文案；助手=活动摘要；请求锚点与压缩另算（`layout.ts:1055-1063,808-813,791-806,329-337`） |
| `cell.previewMarkdown` | 摘要用原始 Markdown | 消息=文本或思考正文；用户/上下文=首个文本块；工具=参数原文；压缩=摘要首文本块（`layout.ts:725-743,125-137,1061,338-340`） |
| `cell.result`/`resultPreviewMarkdown` | 工具结果摘要 | 出错=`error.code ?? 'error'`；否则首个非空文本块；仅图片=`图片 ×N`；都没有=`无输出`（`layout.ts:1065-1080`） |
| `cell.inputDetail` | 输入全文 | 用户/上下文=文本块拼接；工具=参数原文（`layout.ts:1114-1119,458,774,1028-1029`） |
| `cell.outputDetail` | 输出全文 | 消息=文本块；工具=结果详情（含 `name: code` 错误形态）；压缩=摘要（`layout.ts:738,1093-1112`） |
| `cell.thinkingDetail` | 思考全文 | 消息=推理块拼接；压缩=`rawOutput` 里的 reasoning（`layout.ts:739,1121-1126,322-325`） |
| `cell.sourceBlocks`/`outputBlocks` | 原始内容块（保序、含图片附件与 callId） | 消息/用户/上下文=内容块；工具=结果内容块；`assistantSourceBlock` 把 `reasoning` 归一为 `thinking`（`layout.ts:815-850,740,460,1033`） |
| `cell.schemaDetail` | 调用时工具 schema（JSON 文本） | `callSchemas.get(callId)`（`layout.ts:609-617`；来源 `request/header` 的 `prompt.tools` 按 name 建索引后按 callId 捕获，`trajectory-snapshot-builder.ts:80-89,246-253`） |
| `cell.messageSource` | 消息生产者信息 | `user/message` 的 `data.source`（`layout.ts:139`） |
| `cell.promptDetail`/`previousPromptDetail` | 提示词+工具目录的新/旧状态 | `request.prompt` / `promptChange.previous`（`layout.ts:309-312`） |
| `cell.requestOnly` | 无可见内容的请求锚点 | request 存在但无对应 assistant 节点时插入（`layout.ts:274-296`） |
| `cell.opensTurn` | 该用户消息开启一轮 | `kind==='user'` 时为 true（`layout.ts:384`） |
| 请求编号 `number` | 会话全局请求序号 | 按 `startSeq`/`seq` 排序后的 1-based 序号（含压缩请求）（`TrajectoryView.tsx:210-310`） |
| `request.status` | `complete/running/error` | 有完整节点且未中断→complete；有重试或已关闭边界→error；否则 running（`trajectory-assistant-definition.ts:281-285`）；被中断的压缩改写为 error（`trajectory-snapshot-builder.ts:95-124`）；轮次结束带错时把该轮最后一个 assistant 请求改写为 error（`:126-148`） |
| `request.startedAt/completedAt` | 请求起止时刻 | 事件 `time`（`trajectory-assistant-definition.ts:254`；`trajectory-compaction-definition.ts:54`） |
| `request.retry/maxRetries/retryDelayMs` | 重试进度与延迟 | assistant 重试事件数据（`RetryValue`） |
| `request.provider/model` | 提供方与模型 | `message.source.provider/model`（`trajectory-assistant-definition.ts:258-261`） |
| `request.requestConfig` | 请求选项 | 请求头快照的 `prompt.config`（`trajectory-snapshot-builder.ts:58-77`） |
| `request.usage` | 该请求 token 用量 | 事件 `data.usage` 或累计的流式 `usage` chunk（`trajectory-assistant-definition.ts:119-123,234,258`） |
| `cumulativeUsage` | 会话前缀累计用量 | 逐请求按 5 个桶累加（`TrajectoryView.tsx:105-127,243-246`） |
| 工具名/callId/subCalls | 调用身份与嵌套子调用 | `tool-call` 块的 `name/id`；`run_code` 的 `subCalls`（`layout.ts:1003-1053`） |
| 图片附件 | 可渲染图片引用 | 内容块 `type:'image'` 的 `attachment`；经 `conversation.trajectory.images` slot 用 `loadImage` 授权取 URL（`TrajectoryView.tsx:137-140`；`trajectory-contract.ts:88-96`） |

### 6.2 派生/展示层

| UI 值 | 语义 | 来源 |
|---|---|---|
| 搜索文本 | 上述字段小写拼装 + 空格分词 AND | `trajectory-search-index.ts:39-73,124-131` |
| 预览文本（512 上限） | Markdown→纯文本、压空白、单行截断 | `trajectory-preview.ts:13-20` |
| 组描述（如 `1.5 s bash×6`） | 组内挂钟跨度 + 工具直方图 `name×count` | `layout.ts:644-676` |
| 时间条块位置/宽度 | §3.3–3.5 | `timeline.ts:75-185` |
| 折叠摘要文本 | `N 个步骤 · M 个工具调用` / `M 个工具调用 · 工具名, …` | `TrajectoryTable.tsx:588-607,660-671` |
| 是否有更早历史 | 会话 `hasMore` 或本地窗口被截断 | `TrajectoryView.tsx:186-191` |

---

## 7. 兜底与边界情况

### 7.1 「不可用/未记录」文案（`locales.ts:45-53,103-119`）

| key | 中文 | 出现位置 |
|---|---|---|
| `timing.notAvailable` | **不可用** | 开始时间缺失；计时来源缺失 |
| `timing.notRecorded` | **未记录** | 助手计时三元组未记录 |
| `timing.stepStartUnavailable` | **步骤开始时间不可用** | 总时长/首 token 延迟 |
| `timing.firstTokenUnavailable` | **首 token 时间不可用** | TTFT、生成、吞吐量 |
| `timing.usageUnavailable` | **用量不可用** | 吞吐量（无 usage） |
| `timing.outputTokensUnavailable` | **输出 token 数不可用** | 吞吐量（无 outputTokens） |
| `timing.durationTooShort` | **时长过短** | 吞吐量（生成时长 ≤0） |
| `timing.sessionTimestamps(Running)` | **会话时间戳** / **会话时间戳（运行中）** | 非助手记录计时来源 |
| `record.noContent` | **无内容** | 检查器空内容 |
| `record.noPayload` | **未捕获参数** | 参数 tab 无值 |
| `record.noResult` | **未捕获结果** | 结果 tab 无值 |
| `record.noOutput` | **无输出** | 工具结果为空（账本行额外压暗） |
| `record.toolCallOnly` | **（仅工具调用）** | 助手只有工具调用 |
| `record.schemaUnavailable` | **Schema 不可用** | Schema tab |
| `record.systemPromptMissing` | **本次请求没有系统提示词** | 系统提示词 tab |
| `record.toolsMissing` | **本次请求没有工具** | 工具 tab |
| `usage.notReported` | **未报告用量** | 用量 tab |
| `options.notRecorded` | **未记录选项** | 选项 tab |
| `source.notRecorded` | **未记录来源** | 来源 tab |
| 账本空文本 | `—` | `RecordListText`（`:1083`） |
| 检查器 Token 空 | `—` | `TokenRows`（`:746`）与压缩概述（`:2992`） |
| 无请求编号 | `—` | 标题与层级链接（`:2737,3057`） |

### 7.2 状态文案（`statusLabel`，`TrajectoryTable.tsx:713-727`）

| `RecordState` | 判定 | 文案 |
|---|---|---|
| `error` | `cell.isError===true` | **失败**（红字 `.error`） |
| `running` | `kind==='compacted'` 且 `timeSeconds===null`；或 `tool`/`subtool` 且无 `outputDetail` | **等待中** |
| `complete` | 其余 | **已完成** |

（`locales.ts:42-44`）
请求态优先级：`request.status` 优先；否则助手 `completedTime===null`→running；否则组内有 running 记录→running；否则 complete（`:1982-1990`）。

### 7.3 空态/加载态

| 场景 | 表现 | 出处 |
|---|---|---|
| 时间条无块 | `.track` 居中**「无计时数据」** | `TrajectoryTimeline.tsx:388-406` |
| 账本尾部未就绪 | 表体 `visibility:hidden`；顶部粘性条显示 10px 旋转 spinner + **「正在加载轨迹…」**（`role="status" aria-live="polite"`） | `TrajectoryTable.tsx:2318-2325`；CSS `:34-57,106-108` |
| 还有更早历史 | `<tbody>` 首行 29px 按钮**「加载更早的历史」**；加载中禁用 + spinner + **「正在加载更早的历史…」** + 隐藏 live region | `TrajectoryTable.tsx:2336-2367`；`locales.ts:124-128` |
| 时间条左边界 | 28px `…` 按钮：**「点击加载更早的历史」**/加载中**「正在加载更早的历史…」** | `TrajectoryTimeline.tsx:202-238` |
| 搜索无命中 | 无专门空态：过滤后空表；时间条所有块 `opacity:0.14` | `TrajectoryTable.tsx:501-524`；CSS `:249-251` |
| 选区越界 | 模型变化后自动清空选区/视口 | `TrajectoryTimeline.tsx:278-294` |
| 跨视图 inspect 找不到 | 保持挂起，等历史分页载入后重试；应用后回调确认 | `TrajectoryTable.tsx:2138-2151` |
| 压缩中断 | 合成错误码 `trajectory.compaction-interrupted`；UI 显示**「上下文压缩在完成前被中断。」**；运行中**「正在压缩上下文…」**；失败**「上下文压缩失败」**；成功无摘要**「上下文已压缩」** | `copy-codes.ts:4`；`layout.ts:329-337`；`locales.ts:172-174,182` |
| 空附件摘要 | 无文本但有图片→**「图片 ×{count}」**；有文件→**「文件 ×{count}」**，` · ` 连接 | `layout.ts:127-137`；`locales.ts:176-177` |
| 工具结果仅图片 | 结果文本**「图片 ×{count}」** | `layout.ts:1077-1079` |
| AUTH 失败 | 错误文案替换为**「API 密钥无效」**；`displayFailure` 丢弃可能含凭据的原始 message（仅留 `code`） | `TrajectoryTable.tsx:733`；`trajectory-event-projection.ts:129-140` |

### 7.4 已声明限制

- 进行中的记录（`partial`/`runningCalls`）**不显示时长**，只显示运行态（包 `README.md` Known Limitations）；代码上即 `timeSeconds:null`（`layout.ts:513`）与流式消息 `messageDuration=null`（`layout.ts:713-715`）。
- 记录与时间条选择是视图局部的，无深链锚点。
- 账本无独立表头；`eventColumn` 固定 122px（窄屏 50px）。
- 虚拟化开启时 `data-virtual-position`/`aria-rowindex` 用的是**每个虚拟行内部条目序号**而非全局逻辑序号（`TrajectoryTable.tsx:1939-1953,2417,2435`）——当前实现的一处保真度缺口；重实现时建议改用全局记录序号。
