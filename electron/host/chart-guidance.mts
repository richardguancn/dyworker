// 新旧对话运行方式共用；类型与组件必须在 src/echarts-setup.ts 注册。
// 示例只演示格式与不同表达方式，不是每次都要照搬的固定模板。
const examples = [
  {
    title: { text: '示例：月度趋势（假设数据）', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' }, grid: { left: 12, right: 20, top: 50, bottom: 20, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: ['一月', '二月', '三月', '四月'] },
    yAxis: { type: 'value', name: '件' },
    series: [{ type: 'line', name: '数量', smooth: true, symbolSize: 7,
      lineStyle: { width: 3 }, itemStyle: { color: '#5470c6' },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{ offset: 0, color: 'rgba(84,112,198,0.35)' }, { offset: 1, color: 'rgba(84,112,198,0.02)' }] } },
      data: [12, 18, 15, 24] }],
  },
  {
    title: { text: '示例：类别占比（假设数据）', left: 'center', textStyle: { fontSize: 14 } },
    color: ['#5470c6', '#73c0de', '#91cc75'], tooltip: { trigger: 'item' },
    legend: { type: 'scroll', bottom: 0 },
    series: [{ type: 'pie', name: '数量', radius: ['42%', '65%'], center: ['50%', '48%'],
      label: { position: 'inside', formatter: '{d}%', fontSize: 11 }, itemStyle: { borderRadius: 6 },
      data: [{ name: '甲类', value: 42 }, { name: '乙类', value: 35 }, { name: '丙类', value: 23 }] }],
  },
  {
    title: { text: '示例：多维对比（假设数据）', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: {}, legend: { bottom: 0 },
    radar: { center: ['50%', '50%'], radius: '58%', indicator: [
      { name: '质量', max: 100 }, { name: '效率', max: 100 }, { name: '覆盖', max: 100 },
      { name: '满意度', max: 100 }, { name: '完成度', max: 100 },
    ] },
    series: [{ type: 'radar', areaStyle: { opacity: 0.15 },
      data: [{ name: '本期', value: [85, 78, 92, 88, 80] }, { name: '上期', value: [72, 83, 76, 81, 68] }] }],
  },
];

export const chartGuidance = [
  '# 数据图表',
  '- 应用本地内置了 ECharts，```echarts 代码块会在消息里直接渲染成真实图表。统计、对比、趋势、占比、分布等数据图表默认必须使用 ECharts；除非用户明确指定其他格式，不得使用 Mermaid（包括 xychart、pie）、ASCII 字符画或生成图片替代。即使旧会话或参考材料用了 Mermaid 数据图，新图也遵循本规则。Mermaid 仅用于流程图、时序图、关系图等非数据图表。',
  '- 先判断数据关系和最需要传达的结论，再选择图形与风格，不要每次都默认普通柱状图，也不要机械照搬示例。同一报表保持视觉一致，按各个问题选择合适的图，不为凑样式重复展示同一数据或绘制无关图表。',
  '- 本地支持十种数据图表：bar（柱状/横向条形/分组/堆叠）、line（折线/面积/堆叠面积）、pie（饼图/环形/玫瑰图）、scatter（散点/气泡）、radar（雷达）、funnel（漏斗）、gauge（仪表盘）、heatmap（热力图）、treemap（矩形树图）、sunburst（旭日图）。不要输出未注册的图表类型、地图、3D 或需要额外扩展的效果。',
  '- 选图依据：时间趋势用折线或面积图；排名和长类别名用横向条形；分组比较用分组柱状；总量及构成变化用堆叠柱状或面积图；少量类别占比用环形图；多维且量纲一致或已明确归一化的对比用雷达图；真实先后转化环节用漏斗图；有明确目标与上下界的完成率用仪表盘；两个分类维度的强弱分布用热力图；有真实层级的构成用矩形树图或旭日图；两个数值的关系用散点图。仅在第三个数值确有含义时用气泡大小表达；只用 JSON 时可给每个数据项设置数值 symbolSize，不写函数。',
  '- 风格可使用协调的 color 调色板、渐变色、圆角条形、低透明度面积填充、重点项强调、环形留白及清晰的数据标签。同一指标跨图保持同色，正负/状态颜色语义一致；轴线和文字颜色交给应用主题。趋势可用 smooth 和 areaStyle，但需要精确呈现突变时保留直线。玫瑰图仅在面积/半径编码有助理解时使用；柱状数值轴从 0 起，不用装饰扭曲比例，不编造数据、层级、转化关系或目标值。',
  '- 组件支持 title、grid、tooltip、legend、dataZoom、dataset、markLine、markPoint、markArea、radar、visualMap。热力图用两个 category 轴、[横轴索引,纵轴索引,数值] 数据和 visualMap；雷达图必须有 radar.indicator；仪表盘用真实 min/max；层级图在 data 中用 children。数量多时按需使用滚动图例、dataZoom 或合理筛选，并说明范围。',
  '- 内容必须是能过 JSON.parse 的严格 JSON，即 ECharts option，无注释、无函数、无多余逗号，不使用 new echarts.graphic.LinearGradient；渐变可用普通 JSON 对象 {"type":"linear","x":0,"y":0,"x2":0,"y2":1,"colorStops":[{"offset":0,"color":"#5470c6"},{"offset":1,"color":"#91cc75"}]}。tooltip/label 的 formatter 只能用受支持的字符串模板。一个代码块一张图。',
  '- 深浅色主题和透明背景由应用自动处理，不设置 backgroundColor；可以自选数据配色。默认画布高 320px，标题要短、单位要清楚；给标题、图例、坐标轴和标签留空间，grid 可设 containLabel:true。窄面板避免过密标签和长标题，环形图可将百分比放在环内、名称放图例，避免外侧文字被裁切；数据不足以支撑合适图表时用表格并说明，不输出半成品。',
  '- 以下是假设数据的不同风格示例，只演示格式；实际图形与数值必须根据本次任务选择，不得照抄示例数值：',
  ...examples.map(option => '```echarts\n' + JSON.stringify(option) + '\n```'),
].join('\n\n');
