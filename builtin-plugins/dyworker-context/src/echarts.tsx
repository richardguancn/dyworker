// ECharts 封装：仓库约定「输出图表优先用 ECharts」（AGENTS.md），
// 所以插件的构成环 / 趋势 / 每日用量 / 热力图 / 请求时间条统一走 ECharts。
// 只 import 用到的图表与组件，避免把整个 echarts 打包进来。

import * as React from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, PieChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  HeatmapChart,
  PieChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export interface EChartProps {
  /** ECharts option（整体 setOption，不做增量合并，避免残留旧 series） */
  option: any;
  height?: number;
  /** 事件名 → 处理函数（点击柱子固定明细之类） */
  onEvents?: Record<string, (params: any) => void>;
  className?: string;
  /** 容器居中的叠字（构成环中间的总量） */
  overlay?: React.ReactNode;
}

export function EChart(props: EChartProps) {
  const host = React.useRef<HTMLDivElement | null>(null);
  const instance = React.useRef<any>(null);
  const handlers = React.useRef(props.onEvents);
  handlers.current = props.onEvents;

  React.useEffect(() => {
    if (!host.current) return undefined;
    const chart = echarts.init(host.current, undefined, { renderer: "canvas" });
    instance.current = chart;
    // 插件面板宽高会变（右栏可拖宽），跟着容器走
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host.current);
    // 事件只订阅一次，处理函数从 ref 里取最新的一份
    for (const name of Object.keys(handlers.current || {})) {
      chart.on(name, (params: any) => handlers.current?.[name]?.(params));
    }
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);

  React.useEffect(() => {
    instance.current?.setOption(props.option, true);
  }, [props.option]);

  return (
    <div className={`dyw-ctx-echart ${props.className || ""}`} style={{ height: props.height || 200 }}>
      <div ref={host} className="dyw-ctx-echart-canvas" />
      {props.overlay ? <div className="dyw-ctx-echart-overlay">{props.overlay}</div> : null}
    </div>
  );
}
