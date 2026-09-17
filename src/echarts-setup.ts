// ECharts 按需装配：只注册报表常用图表（柱状/折线/饼图/散点）与组件（坐标轴/提示框/图例/标题/缩放/标线），
// 由 InteractiveMessage 在消息里真的出现 echarts 代码块时才动态导入，不进首屏包。
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export { echarts };
