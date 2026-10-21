// ECharts 按需装配：注册聊天报表支持的图表和组件，与 host/chart-guidance.mts 保持一致。
// 由 InteractiveMessage 在消息里真的出现 echarts 代码块时才动态导入，不进首屏包。
import * as echarts from "echarts/core";
import {
  BarChart, CustomChart, FunnelChart, GaugeChart, HeatmapChart, LineChart,
  PieChart, RadarChart, ScatterChart, SunburstChart, TreemapChart,
} from "echarts/charts";
import {
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  TreemapChart,
  SunburstChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  RadarComponent,
  VisualMapComponent,
  DatasetComponent,
  CanvasRenderer,
]);

export { echarts };
