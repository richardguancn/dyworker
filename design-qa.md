# 界面对照验收

## 对照目标

- source visual truth: `/var/folders/6h/rpqn03ds5sb4_jmp35lcbl8h0000gr/T/codex-clipboard-ff528874-d34a-4692-91c3-7c1e58e98f28.png`
- implementation screenshot: `/tmp/dyworker-aligned.png`
- tab interaction screenshot: `/tmp/dyworker-tabs.png`
- collapsed right panel screenshot: `/tmp/dyworker-right-collapsed.png`
- inline browser screenshot: `/tmp/dyworker-inline-browser.png`
- focused implementation crop: `/tmp/dyworker-aligned-right.png`
- combined comparison input: `/tmp/dyworker-qa-comparison-aligned.png`
- source pixels: 1344 × 1080
- implementation pixels: 1280 × 720 CSS viewport, device scale 1
- focused crop pixels: 358 × 720, right browser panel
- state: 浏览器空白页、文件/浏览器标签页、最近分组展开、默认工作目录会话与无工作目录新任务均已检查

## 对照结果

全视图和右侧面板局部对照确认：顶部标签、加号、右上操作、后退/前进/刷新、URL 输入框、打开地址按钮、空白页居中提示和暖色背景均已落到同一组视觉层级。源图是独立浏览器面板，成品是在三栏任务界面中的可调右侧面板，因此右侧可用宽度不同，属于布局场景差异，不是样式偏差。

左侧专项检查确认：有工作目录的分组行不再显示箭头，展开和收起只切换文件夹图标；没有工作目录的新任务进入“最近”，该分组保留箭头并可收起/展开。

## 交互验收

- 点击“新建任务”：新任务工作目录为空，并出现在“最近”。
- 点击工作目录分组：分组内容展开/收起，图标随状态切换。
- 点击右侧操作菜单：审阅、终端、浏览器、文件、侧边聊天均可见；浏览器与文件面板可切换。
- 拖动左侧分隔条：网格列宽从 `300px 622px 358px` 变为 `366px 556px 358px`。
- 拖动右侧分隔条：网格列宽变为 `366px 482px 432px`。
- 浏览器控制台错误数：0。
- 文件和浏览器已统一进入同一排标签页；可新增浏览器标签、切换文件/网页标签并关闭标签。
- 输入公开网址后，网页直接显示在当前浏览器标签页内容区，不再打开独立弹窗。
- 右侧工具栏展开时不再显示顶部展开图标，收起后才显示“展开右侧工具栏”。
- 应用首次打开时右侧工具栏默认收起，需要时点击顶部按钮展开。
- 点击标签栏“+”或三点按钮都会打开同一组侧边操作菜单，菜单不会被标签栏裁剪遮挡。
- 任务完成后，工作计划会自动把剩余步骤收口为“已完成”；旧任务记录也会按正常完成状态兼容显示。
- 顶部对齐实测：主顶栏 54px，浏览器标签栏 54px；浏览器导航栏从 y=54 开始，高 45px。

## 对照历史

### 第一次检查

- 发现：浏览器页顶部多出“打开文件”标题行，且空白页提示垂直居中偏高。
- 修复：浏览器模式移除文件标题行，将菜单和收起按钮放入标签栏；空白页提示调整到参考图的下方区域。
- 复查证据：`/tmp/dyworker-qa-comparison.png`。

### 最终检查

- 未发现可阻断交付的 P0/P1/P2 差异。
- 已将浏览器标签栏、导航栏、图标和字号恢复为主界面同级尺寸，消除右侧顶部比左侧高一倍的问题。
- 右侧面板拖拽上限改为跟随窗口可用空间，不再固定卡在 760px。
- P3：面板被拖到很窄时，URL 文案会自然截断；这是自由调宽后的正常响应行为。

## Implementation Checklist

- [x] 最近分组正确收纳无工作目录会话
- [x] 工作目录分组去掉箭头并切换文件夹图标
- [x] 右侧浏览器面板按参考图重排
- [x] 左右面板均支持拖动调宽
- [x] 构建通过
- [x] 全量测试通过

final result: passed
