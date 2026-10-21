// 用假设数据验证模型示例、扩展图表和 JSON 样式可以由同一个内置引擎实际绘制。
import { chartGuidance } from '../../electron/host/chart-guidance.mts';
const title = text => ({ text, left: 'center', textStyle: { fontSize: 14 } });
export const chartOptions = [
  ...[...chartGuidance.matchAll(/```echarts\n([\s\S]+?)\n```/g)].map(match => JSON.parse(match[1])),
  {
    title: title('排名与构成（假设数据）'), tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0 }, grid: { left: 12, right: 20, top: 50, bottom: 40, containLabel: true },
    xAxis: { type: 'value' }, yAxis: { type: 'category', data: ['甲类', '乙类', '丙类'] },
    dataset: { source: [['category', '本期', '上期'], ['甲类', 42, 35], ['乙类', 35, 30], ['丙类', 23, 20]] },
    series: [{ type: 'bar', name: '本期', stack: '总量', encode: { x: '本期', y: 'category' },
      itemStyle: { color: '#5470c6' } },
    { type: 'bar', name: '上期', stack: '总量', encode: { x: '上期', y: 'category' },
      itemStyle: { color: '#91cc75', borderRadius: [0, 5, 5, 0] } }],
  },
  {
    title: title('数值关系（假设数据）'), tooltip: {},
    grid: { left: 12, right: 20, top: 50, bottom: 20, containLabel: true },
    xAxis: { type: 'value' }, yAxis: { type: 'value' },
    series: [{ type: 'scatter', data: [{ value: [1, 12], symbolSize: 10 }, { value: [2, 18], symbolSize: 20 }, { value: [3, 15], symbolSize: 15 }] }],
  },
  {
    title: title('转化环节（假设数据）'), tooltip: { trigger: 'item' },
    series: [{ type: 'funnel', top: 55, bottom: 20, left: '15%', width: '70%', label: { position: 'inside' },
      data: [{ name: '访问', value: 100 }, { name: '咨询', value: 65 }, { name: '提交', value: 40 }, { name: '完成', value: 25 }] }],
  },
  {
    title: title('目标进度（假设数据）'),
    series: [{ type: 'gauge', min: 0, max: 100, splitNumber: 5, radius: '70%',
      progress: { show: true, roundCap: true, width: 12 }, axisLine: { lineStyle: { width: 12 } },
      axisLabel: { distance: 18, fontSize: 10 }, detail: { valueAnimation: true, formatter: '{value}%', fontSize: 22 },
      data: [{ name: '完成率', value: 72 }] }],
  },
  {
    title: title('区域时段分布（假设数据）'), tooltip: { position: 'top' },
    grid: { left: 12, right: 20, top: 50, bottom: 70, containLabel: true },
    xAxis: { type: 'category', data: ['上午', '中午', '下午'] },
    yAxis: { type: 'category', data: ['甲区', '乙区'] },
    visualMap: { min: 0, max: 30, orient: 'horizontal', left: 'center', bottom: 5,
      inRange: { color: ['#e0f3f8', '#73c0de', '#5470c6'] } },
    series: [{ type: 'heatmap', label: { show: true }, data: [[0, 0, 12], [1, 0, 24], [2, 0, 18], [0, 1, 28], [1, 1, 16], [2, 1, 6]] }],
  },
  {
    title: title('层级构成（假设数据）'), tooltip: {},
    series: [{ type: 'treemap', top: 50, bottom: 30, breadcrumb: { show: false },
      data: [{ name: '甲组', value: 60, children: [{ name: '甲一', value: 40 }, { name: '甲二', value: 20 }] },
        { name: '乙组', value: 40, children: [{ name: '乙一', value: 25 }, { name: '乙二', value: 15 }] }] }],
  },
  {
    title: title('多层占比（假设数据）'), tooltip: {},
    series: [{ type: 'sunburst', radius: ['15%', '70%'], center: ['50%', '55%'],
      data: [{ name: '甲组', children: [{ name: '甲一', value: 40 }, { name: '甲二', value: 20 }] },
        { name: '乙组', children: [{ name: '乙一', value: 25 }, { name: '乙二', value: 15 }] }] }],
  },
];
