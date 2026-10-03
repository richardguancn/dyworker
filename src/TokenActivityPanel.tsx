// 设置「用量统计」顶部的 Token 活动图：GitHub 风格的每天热力图，以及每周/累计总量两种方块柱视图。
// 用 ECharts 自定义系列逐格绘制（calendar 组件做不了底部月份标签和方块柱），布局按容器宽度现场计算。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UsageRecord } from "./types";
import { useResolvedTheme } from "./appearance/controller";
import {
  aggregateTokenActivity,
  cumulativeTooltipTitle,
  dailyTooltipTitle,
  formatTokenCN,
  MAX_BLOCKS,
  weeklyTooltipTitle,
  type TokenActivityData,
} from "./tokenActivity";

type ActivityMode = "daily" | "weekly" | "cumulative";

const MODES: Array<{ id: ActivityMode; label: string }> = [
  { id: "daily", label: "每天" },
  { id: "weekly", label: "每周" },
  { id: "cumulative", label: "累计总量" },
];

// 绿色梯度沿用 GitHub 贡献图；空格与标签色按深浅主题各配一套，与米色/深色底协调
interface ActivityPalette {
  empty: string;
  levels: [string, string, string, string];
  block: string;
  label: string;
}

const PALETTES: Record<"light" | "dark", ActivityPalette> = {
  light: { empty: "#e8e5d9", levels: ["#ade3b1", "#57c964", "#2fa14e", "#1e6f38"], block: "#31b84d", label: "#8f8b7d" },
  dark: { empty: "#2e2f2b", levels: ["#0e4429", "#006d32", "#26a641", "#39d353"], block: "#2ea043", label: "#87887f" },
};

const WEEK_COUNT = 53;
const LABEL_HEIGHT = 22;

interface CellSpec {
  col: number;
  first: boolean; // 该列第一条数据：月份标签挂在这一条上，避免整列重复绘制
  rects: Array<{ x: number; y: number; color: string }>;
  title: string;
  body: string;
}

function buildOption(mode: ActivityMode, data: TokenActivityData, width: number, palette: ActivityPalette): Record<string, unknown> {
  const rows = mode === "daily" ? 7 : MAX_BLOCKS;
  let pitch = width / WEEK_COUNT;
  let offsetX = 0;
  if (pitch > 16) {
    pitch = 16;
    offsetX = (width - pitch * WEEK_COUNT) / 2;
  }
  const cell = Math.max(5, Math.floor(pitch - (pitch >= 12 ? 3 : 2)));
  const colX = (col: number) => offsetX + col * pitch + (pitch - cell) / 2;
  const gridRight = offsetX + pitch * WEEK_COUNT;

  const labelsByCol = new Map<number, string>();
  let prevMonth = -1;
  data.weeks.forEach((week, col) => {
    // 取周中（周三）的月份：半月的首尾列不会各占一个标签，标签落在该月占比最大的列
    const month = week.days[3].date.getMonth();
    if (month !== prevMonth) {
      labelsByCol.set(col, `${month + 1}月`);
      prevMonth = month;
    }
  });

  const specs: CellSpec[] = [];
  data.weeks.forEach((week, col) => {
    if (mode === "daily") {
      week.days.forEach((day, row) => {
        const level = data.dayLevels[col * 7 + row];
        specs.push({
          col,
          first: row === 0,
          rects: [{ x: colX(col), y: row * pitch + (pitch - cell) / 2, color: level > 0 ? palette.levels[level - 1] : palette.empty }],
          title: dailyTooltipTitle(day.date),
          body: `${formatTokenCN(day.tokens)} 个 Token`,
        });
      });
    } else {
      const blocks = mode === "weekly" ? data.weeklyBlocks[col] : data.cumulativeBlocks[col];
      const value = mode === "weekly" ? week.tokens : week.cumulative;
      const rects = [];
      for (let b = 0; b < blocks; b += 1) {
        rects.push({ x: colX(col), y: (rows - 1 - b) * pitch + (pitch - cell) / 2, color: palette.block });
      }
      specs.push({
        col,
        first: true,
        rects,
        title: mode === "weekly" ? weeklyTooltipTitle(week.start) : cumulativeTooltipTitle(week.start),
        body: `${formatTokenCN(value)} 个 Token`,
      });
    }
  });

  const renderItem = (params: { dataIndex: number }) => {
    const spec = specs[params.dataIndex];
    if (!spec) return { type: "group" as const, children: [] };
    const children: unknown[] = spec.rects.map((rect) => ({
      type: "rect",
      shape: { x: rect.x, y: rect.y, width: cell, height: cell, r: Math.min(3, cell * 0.3) },
      style: { fill: rect.color },
    }));
    const label = spec.first ? labelsByCol.get(spec.col) : undefined;
    if (label) {
      // 末列的标签贴右缘溢出时改右对齐，避免被裁掉
      const labelX = offsetX + spec.col * pitch;
      const overflow = labelX + 34 > gridRight;
      children.push({
        type: "text",
        silent: true,
        style: {
          text: label,
          x: overflow ? gridRight : labelX,
          y: rows * pitch + 5,
          fill: palette.label,
          font: "11px system-ui, -apple-system, 'Segoe UI', sans-serif",
          align: overflow ? "right" : "left",
          verticalAlign: "top",
        },
      });
    }
    return { type: "group" as const, children };
  };

  return {
    animation: false,
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: "#3d4757",
      borderWidth: 0,
      borderRadius: 12,
      padding: [10, 14],
      textStyle: { color: "#ffffff", fontSize: 13.5 },
      extraCssText: "box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);",
      formatter: (params: { data?: { title?: string; body?: string } }) => {
        const meta = params?.data || {};
        return `<div style="white-space:nowrap">${meta.title || ""}<br/>${meta.body || ""}</div>`;
      },
    },
    series: [
      {
        type: "custom",
        coordinateSystem: "none",
        clip: false,
        renderItem,
        data: specs.map((spec) => ({ value: spec.rects.length, title: spec.title, body: spec.body })),
      },
    ],
  };
}

export function TokenActivity({ records }: { records: UsageRecord[] }) {
  const [mode, setMode] = useState<ActivityMode>("daily");
  const theme = useResolvedTheme();
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const data = useMemo(() => aggregateTokenActivity(records), [records]);

  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = mode === "daily" ? 7 : MAX_BLOCKS;
  // 高度与 buildOption 用同一套 pitch 口径（宽容器下格子 16px 封顶），避免底部多出空白
  const pitch = Math.min(16, width / WEEK_COUNT);
  const height = width > 0 ? Math.round(rows * pitch) + LABEL_HEIGHT : 0;
  const hasWidth = width > 0;

  useEffect(() => {
    const el = chartRef.current;
    if (!el || !hasWidth) return;
    let disposed = false;
    let chart: import("echarts/core").ECharts | null = null;
    let observer: ResizeObserver | null = null;
    void import("./echarts-setup").then(({ echarts }) => {
      if (disposed || !chartRef.current) return;
      // 全部颜色由组件按主题显式给出，不走 echarts 内置主题；主题变化靠 effect 依赖重建
      chart = echarts.init(chartRef.current, null, { renderer: "canvas" });
      const render = () => {
        if (!chart || !chartRef.current) return;
        chart.setOption(buildOption(mode, data, chartRef.current.clientWidth, PALETTES[theme]), true);
      };
      render();
      observer = new ResizeObserver(() => {
        chart?.resize();
        render();
      });
      observer.observe(el);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [mode, data, theme, hasWidth]);

  return (
    <div className="token-activity">
      <div className="token-activity-head">
        <span className="token-activity-title">Token 活动</span>
        <div className="token-activity-tabs" role="tablist" aria-label="Token 活动视图">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={mode === item.id ? "active" : ""}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={chartRef}
        className="token-activity-chart"
        style={{ height }}
        role="img"
        aria-label={`Token 活动图，近一年合计 ${formatTokenCN(data.total)} 个 Token`}
      />
    </div>
  );
}
