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

export const chartGuidance = [
  '# 数据图表',
  '- 本地内置 ECharts，统计、对比、趋势、占比、分布等数据图表默认必须使用 ```echarts 代码块；用户明确指定其他格式时遵循要求，否则不得用 Mermaid xychart/pie、ASCII 或图片替代；Mermaid 仅用于流程/时序/关系图。',
  '- 支持十种图表：bar、line、pie、scatter、radar、funnel、gauge、heatmap、treemap、sunburst；组件支持 title、grid、tooltip、legend、dataZoom、dataset、markLine、markPoint、markArea、radar、visualMap。按数据关系选图，不输出未注册类型、3D 或地图。',
  '- 代码块内容必须是严格 JSON（ECharts option），无注释、无函数、无多余逗号；渐变使用纯 JSON 线性渐变对象，formatter 只用字符串模板，不设 backgroundColor（主题自动适配），一个代码块一张图。示例（勿照抄数值）：',
  ...examples.map(option => '```echarts\n' + JSON.stringify(option) + '\n```'),
].join('\n\n');
