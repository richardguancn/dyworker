export type CreationExampleSlotLabel = "独立页面" | "右侧面板" | "会话视图" | "AI 工具";

export interface CreationExample {
  id: string;
  title: string;
  slotLabel: CreationExampleSlotLabel;
  summary: string;
  prompt: string;
}

export const CREATION_MODE_EXAMPLES: CreationExample[] = [
  {
    id: "weekly-report-dashboard",
    title: "每周系统报表看板",
    slotLabel: "独立页面",
    summary: "导入每周 Excel/CSV 报表，看核心数字、上周涨跌与近几周趋势图，历史自动留存",
    prompt: "我每周会从业务系统导出一份 Excel/CSV 报表，请帮我做一个单独的周报看板页面：能看本周关键指标和相比上周的变化，自动画出近几周趋势图和分类占比图，并且支持每周导入新文件或配合定时任务自动更新数据。",
  },
  {
    id: "project-kanban",
    title: "项目进度看板",
    slotLabel: "独立页面",
    summary: "按待办、进行中、已完成分类跟进事项，顶部带进度统计图，数据本机持久保存",
    prompt: "帮我做一个单独的项目进度看板页面：把工作按待办、进行中、已完成三列管理，支持随时新建、修改状态、按截止日期筛选，顶部配一个状态分布统计图，关闭软件后数据也不会丢。",
  },
  {
    id: "doc-review-checklist",
    title: "文档审校自查清单",
    slotLabel: "右侧面板",
    summary: "放在对话框旁边的核对面板，公文、汇报、合同边聊边打勾，还能自己加条目",
    prompt: "帮我在对话框右侧加一个随手可打开的「文档审校自查清单」小面板：内置公文、周报汇报和合同三组检查项，支持一边写内容一边勾选打勾、显示完成进度，也能自己增删检查条款并一键重置。",
  },
  {
    id: "snippet-template-library",
    title: "常用话术与模板库",
    slotLabel: "右侧面板",
    summary: "分类存放高频回复话术、通知邮件和汇报开头，搜关键词就能一键复制",
    prompt: "帮我在对话框右侧做一个「常用话术与模板库」小工具：可以按场景分类保存我常用的回复、会议通知和汇报模板，支持按关键词快速搜索、随时新建修改，点一下就能复制到剪贴板。",
  },
  {
    id: "meeting-action-tracker",
    title: "会议行动项追踪",
    slotLabel: "会话视图",
    summary: "在当前会话顶部多一个跟踪表标签，随时记录负责人、优先级和截止日期",
    prompt: "帮我在对话顶部新增一个「会议行动项追踪」切换视图：方便我直接记录每次讨论定下的待办事项、负责人、优先级和截止时间，支持按完成状态筛选和一键标记完成，内容持久化保留。",
  },
  {
    id: "text-clean-numbering-tool",
    title: "格式清洗与文件编号助手",
    slotLabel: "AI 工具",
    summary: "给助手增加专属自动化小工具，以后聊天里一句话就能批量清理空行、统一标点或生成编号",
    prompt: "帮我给助手新增两个实用小工具：一个是自动清理文稿里多余空行、统一中英文标点，另一个是按日期前缀自动生成规范的文件编号。做完后帮我试跑验证一下，以后我直接让你用就行。",
  },
];
