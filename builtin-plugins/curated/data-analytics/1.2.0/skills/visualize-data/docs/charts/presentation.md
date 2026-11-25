<!-- Generated chart reference. -->

```typescript
/** Serializable presentation options shared by inline charts and React.
 * Callbacks, source bindings, selection and hosting limits belong to the host.
 */
export type CommonPresentation = {
  showXAxisLabel?: boolean; showYAxisLabel?: boolean; showAnnotations?: boolean;
  baseColor?: string; tooltipFields?: { field: string; label: string }[];
  legend?: { position?: "top" | "bottom" | "left" | "right"; comparisons?: "grouped"; labels?: Record<string, string> };
  stackable?: boolean;
};
export type AxisPresentation = {
  xLabelPosition?: "bottom" | "top" | "inline-right";
  xTickLabelLayout?: "auto" | "horizontal" | "wrapped" | "angled" | "date-time";
  axisPercentDigits?: number; showCategoryTicks?: boolean; yTickCount?: number;
};
export type HorizontalAxisPresentation = Omit<AxisPresentation, "xLabelPosition" | "xTickLabelLayout" | "yTickCount"> & {
  yLabelPosition?: AxisPresentation["xLabelPosition"];
  yTickLabelLayout?: AxisPresentation["xTickLabelLayout"];
  xTickCount?: number;
};
export type TrendPresentation = {
  dashedFields?: string[]; rightAxisFields?: string[]; rightYAxisLabel?: string;
  barFields?: string[]; lineGradients?: Record<string, (string | { color: string; offset: number })[]>;
};
export type BarStyling = {
  colorBySign?: boolean; rowHeight?: number; markRadius?: number; markStartRadius?: number;
  initialVisibleCount?: number; labelMaxLength?: number;
};
export type HeatmapPresentation = {
  rowHeight?: number; colorScaleStartAtZero?: boolean; reverseRows?: boolean;
  colorBands?: { max?: number; color: string; label?: string; legendGroup?: string }[];
  cellLabel?: { text?: string; color?: string; showWhen?: number; fontSize?: number; fontWeight?: number };
  hoverHighlight?: boolean | { color?: string; width?: number };
};
export type SankeyPresentation = {
  sankeyLabelFontSize?: number; sankeyLinkColorMode?: "source" | "target" | "gradient";
  sankeyNodeWidth?: number; sankeySortNodes?: boolean; sankeyTerminalLabelAlignment?: string;
  sankeyValueFontSize?: number; penultimateLabelAlignment?: string;
};
export type PresentationOptions<Type> = CommonPresentation &
  (Type extends "bar" | "horizontalBar" ? { presentation?: BarPresentation; barOptions?: BarPresentationOptions } : {}) &
  (Type extends "line" | "area" | "stackedArea" | "sparkline" ? AxisPresentation & TrendPresentation :
   Type extends "horizontalBar" | "horizontalStackedBar" | "horizontalStackedBar100" ? HorizontalAxisPresentation & BarStyling :
   Type extends "bar" | "stackedBar" | "stackedBar100" ? AxisPresentation & BarStyling :
   Type extends "heatmap" ? AxisPresentation & HeatmapPresentation :
   Type extends "sankey" ? SankeyPresentation :
   Type extends "scatter" ? AxisPresentation :
   Type extends "pie" ? { groupOther?: boolean; maxCategories?: number; preserveCategories?: string[] } :
   Type extends "leaderboard" | "rankedList" | "funnel" ? Pick<BarStyling, "rowHeight" | "markRadius" | "markStartRadius" | "initialVisibleCount" | "labelMaxLength"> : {});
export type BarPresentation = "plot" | "bullet" | "segmented" | "groupedList" | "rankedList" | "progress" | "comparison" | "rangePosition";
export interface BarPresentationOptions {
  orientation?: "horizontal" | "vertical"; annotations?: "auto" | "aligned" | "none";
  target?: string; projection?: string; sort?: string; visibleRows?: number; expandable?: boolean;
  grid?: boolean; barCategoryGap?: number | string; categoryWidth?: number; valueWidth?: number;
  rangeLabelField?: string; unitField?: string; detailField?: string;
  style?: { color?: string; colorField?: string; textColor?: string; textColorField?: string; thickness?: number;
    thicknessField?: string; fontSize?: number; gap?: number; radius?: number; segmentGap?: number;
    roundedSegments?: boolean; segments?: number };
  labels?: { value?: boolean; position?: string; align?: string; primary?: boolean; secondary?: boolean; suffix?: string };
  axes?: boolean | { category?: boolean; value?: boolean }; interaction?: { tooltip?: boolean };
  format?: { style?: "decimal" | "percent" | "currency"; currency?: string; notation?: "standard" | "scientific" | "engineering" | "compact"; minimumFractionDigits?: number; maximumFractionDigits?: number };
  track?: boolean | { max: string | number; color?: string }; comparison?: boolean | { colors?: readonly string[] };
  series?: readonly (string | { key: string; label?: string; color?: string; comparisonColor?: string; textColor?: string;
    stackId?: string; colors?: readonly string[]; textColors?: readonly string[] })[];
  markers?: readonly { value: number; label?: string; color?: string; width?: number }[];
  tooltipFields?: readonly { key: string; label?: string; color?: string }[];
  range?: readonly [string, string]; domain?: readonly [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
}
```
