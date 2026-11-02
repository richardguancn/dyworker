// 新旧对话运行方式共用；类型与组件必须在 src/echarts-setup.ts 注册。
// 示例只演示格式与不同表达方式，不是每次都要照搬的固定模板。
const examples = [
  {
    title: { text: '示例：月度趋势（假设数据）', left: 'center' },
    tooltip: { trigger: 'axis' }, grid: { containLabel: true },
    xAxis: { type: 'category', data: ['1月', '2月', '3月'] },
    yAxis: { type: 'value', name: '件' },
    series: [{ type: 'line', name: '数量', smooth: true, data: [12, 18, 24] }],
  },
  {
    title: { text: '示例：类别占比（假设数据）', left: 'center' },
    tooltip: { trigger: 'item' }, legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['42%', '65%'],
      data: [{ name: '甲', value: 42 }, { name: '乙', value: 35 }, { name: '丙', value: 23 }] }],
  },
  {
    title: { text: '示例：多维对比（假设数据）', left: 'center' },
    tooltip: {}, legend: { bottom: 0 },
    radar: { indicator: [{ name: '质量', max: 100 }, { name: '效率', max: 100 }, { name: '覆盖', max: 100 }] },
    series: [{ type: 'radar', data: [{ name: '本期', value: [85, 78, 92] }] }],
  },
];

export const VISUAL_SKILL_ID = 'builtin-visual-output';

export const visualSkillInstructions = [
  '## 1. ECharts 数据图表（```echarts）',
  '- 支持十种图表：bar、line、pie、scatter、radar、funnel、gauge、heatmap、treemap、sunburst；组件支持 title、grid、tooltip、legend、dataZoom、dataset、markLine、markPoint、markArea、radar、visualMap。按数据关系选图，不输出未注册类型、3D 或地图。',
  '- 代码块内容必须是严格 JSON（ECharts option），无注释、无函数、无多余逗号；渐变使用纯 JSON 线性渐变对象，formatter 只用字符串模板，不设 backgroundColor（主题自动适配），一个代码块一张图。示例（勿照抄数值）：',
  ...examples.map(option => '```echarts\n' + JSON.stringify(option) + '\n```'),
  '## 2. 聊天内交互卡片（```dyworker-ui）',
  '- 仅用于辅助查看选项比较、参数模拟、横向对比或步骤进度（不代表用户确认），内容为严格 JSON：',
  '  1. choice：{"type":"choice","title":"...","options":[{"id":"a","label":"...","description":"...","tag":"推荐","summary":"...","metrics":[{"label":"...","value":"..."}]}]}',
  '  2. slider：{"type":"slider","title":"...","label":"...","min":10,"max":90,"step":5,"value":40,"unit":"...","feedback":[{"from":10,"label":"...","description":"..."}]}',
  '  3. bars：{"type":"bars","title":"...","items":[{"id":"a","label":"...","value":42,"max":90,"unit":"..."}]}',
  '  4. steps：{"type":"steps","title":"...","current":1,"steps":[{"label":"...","description":"..."}]}',
].join('\n\n');

export const visualOutputSkill = {
  id: VISUAL_SKILL_ID,
  name: '图表与交互卡片',
  description: '输出 ECharts 数据图表（```echarts）或聊天交互卡片（```dyworker-ui）时的支持类型与严格 JSON 规范',
  instructions: visualSkillInstructions,
};

export const chartGuidance = [
  '# 图表与交互卡片',
  '- 统计、对比、趋势、占比、分布等数据图表默认使用 ```echarts 严格 JSON 代码块（用户未指定其他格式时勿用 Mermaid 统计图/ASCII/图片替代；Mermaid 仅画流程/时序/关系图）；选项比较、参数模拟、数据条或分步说明可用 ```dyworker-ui 严格 JSON 代码块。',
  `- 首次输出 \`\`\`echarts 或 \`\`\`dyworker-ui 前，先用 load_skill("${VISUAL_SKILL_ID}") 读取支持组件与 JSON 规范（单代码块单图，无注释、无函数、不设 backgroundColor）。`,
].join('\n');
