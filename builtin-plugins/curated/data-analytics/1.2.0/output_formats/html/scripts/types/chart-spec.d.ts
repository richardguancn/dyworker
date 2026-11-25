/** App bindings are category x / measure y, including horizontal bars.
 * Canonical portable primitives are copied into the generated checker at build
 * time. These declarations do not claim inference of reviewed row field names;
 * runtime validation still checks data, finite values and semantic combinations.
 */
import type { StandardChartSpec, Domain as PortableDomain, ValueFormat, PointAnnotation, ChartColors, SortOrder } from "./canonical-chart";
export type { ValueFormat, ChartColors, SortOrder } from "./canonical-chart";
export type Domain = Readonly<PortableDomain>;
export type ChartDataInputs = { beginning?: number; ending?: number };
import type { ChartAnnotation } from "./canonical-chart";
export type { ChartAnnotation } from "./canonical-chart";
type ReferenceLine<Axis extends string> = { axis: Axis; value: number; label: string };
type ReferenceBand<Axis extends string> = { axis: Axis; from: number; to: number; label: string };
type References<Axis extends string = "y" | "value"> = {
  referenceLines?: readonly ReferenceLine<Axis>[];
  referenceBands?: readonly ReferenceBand<Axis>[];
};
type Uncertainty<Style extends string = "bars"> = { lower: string; upper: string; style: Style; label?: string };
type AnnotationOptions = { annotations?: readonly ChartAnnotation[]; showAnnotations?: boolean; rowId?: string };
type Common = {
  xLabel?: string; yLabel?: string; showXAxisLabel?: boolean; showYAxisLabel?: boolean;
  showValues?: boolean; showLegend?: boolean; baseColor?: string; valueDecimals?: number; currency?: string;
  yAxisPosition?: "left" | "right"; sortOrder?: SortOrder; categoryOrder?: readonly string[];
  seriesOrder?: readonly string[]; tooltipFields?: readonly { field: string; label: string }[];
  legend?: { position?: "top" | "bottom" | "left" | "right"; comparisons?: "grouped"; labels?: Record<string, string> };
  stackable?: boolean; startAtZero?: boolean;
};
type Cartesian = Common & { x: string; startAtZero?: boolean; valueDomain?: Domain;
  xLabelPosition?: "bottom" | "top" | "inline-right"; xTickLabelLayout?: "auto" | "horizontal" | "wrapped" | "angled" | "date-time";
  axisPercentDigits?: number; showCategoryTicks?: boolean; yTickCount?: number;
};
type Measures = { y: string; fields?: readonly string[]; series?: string }
  | { y?: string; fields: readonly [string, ...string[]]; series?: string };
type Formatted = { valueFormat?: ValueFormat };
type Colored = { colors?: ChartColors };
type Trend = Cartesian & Measures & Formatted & {
  dashedFields?: readonly string[]; rightAxisFields?: readonly string[]; rightYAxisLabel?: string;
  barFields?: readonly string[]; lineGradients?: Record<string, readonly (string | { color: string; offset: number })[]>;
};
export type AppLineSpec = Trend & Colored & AnnotationOptions & Omit<References<"x" | "y" | "value">, "referenceLines"> & {
  type: "line"; xScale?: "linear" | "log" | "category"; yScale?: "linear" | "log"; xDomain?: Domain;
  uncertainty?: Uncertainty<"bars" | "band">;
  referenceLines?: readonly (ReferenceLine<"x" | "y" | "value">
    | { axis: "x"; value: string; label: string; between?: never; fraction?: never }
    | { axis: "x"; between: readonly [string, string]; fraction?: number; label: string; value?: never })[];
};
export type AppAreaSpec = Trend & Colored & AnnotationOptions & References & {
  type: "area"; xScale?: "linear" | "category"; yScale?: "linear" | "log";
};
export type AppStackedAreaSpec = Trend & Colored & { type: "stackedArea"; xScale?: "linear" | "category"; yScale?: "linear" };
export type AppSparklineSpec = Trend & { type: "sparkline"; xScale?: "linear" | "category"; yScale?: "linear" };
export type { BarPresentation } from "./canonical-chart";
import type { BarPresentation, BarPresentationOptions } from "./canonical-chart";
export type BarOptions = BarPresentationOptions & { formatValue?: (value: number) => string };
type BarMeasures = Measures | { y?: string; fields?: never; series?: string; presentation: BarPresentation;
  barOptions: BarOptions & { series: readonly [NonNullable<BarOptions["series"]>[number], ...NonNullable<BarOptions["series"]>[number][]] } };
type Bars = Cartesian & BarMeasures & Colored & { colorBySign?: boolean; rowHeight?: number;
  markRadius?: number; markStartRadius?: number; initialVisibleCount?: number; labelMaxLength?: number;
  presentation?: BarPresentation; barOptions?: BarOptions; xScale?: "linear"; yScale?: "linear";
};
export type AppBarSpec = Bars & Formatted & AnnotationOptions & References & {
  type: "bar" | "horizontalBar" | "horizontal-bar"; uncertainty?: Uncertainty;
};
export type AppStackedBarSpec = Bars & Formatted & { type: "stackedBar" | "horizontalStackedBar" };
export type AppNormalizedBarSpec = Bars & { type: "stackedBar100" | "horizontalStackedBar100"; valueFormat?: never };
export type AppScatterSpec = Cartesian & Colored & Formatted & AnnotationOptions & References<"x" | "y" | "value"> & {
  type: "scatter"; y: string; series?: string; fit?: "linear" | "quadratic";
  xScale?: "linear" | "log"; yScale?: "linear" | "log"; xDomain?: Domain; uncertainty?: Uncertainty;
};
export type AppPieSpec = Common & Colored & Formatted & { type: "pie"; x: string; y: string; innerRadius?: number;
  groupOther?: boolean; maxCategories?: number; preserveCategories?: readonly string[];
} & ({ centerValue?: string | number; centerLabel?: never } | { centerValue: string | number; centerLabel?: string });
export type AppHistogramSpec = Common & { type: "histogram"; x?: string; y: string; valueFormat?: never } & (
  { bins?: never; statistic?: never; density?: never; binLayout?: never }
  | { bins: { lower: string; upper: string; label: string }; statistic?: "count" | "frequency" | "density";
      density?: boolean; binLayout?: "equal" | "proportional" }
);
export type AppHeatmapSpec = Common & Formatted & { type: "heatmap"; x: string; y: string; series?: string;
  rowHeight?: number; xTickLabelLayout?: "auto" | "horizontal" | "wrapped" | "angled";
  colorDomain?: Domain; colorScaleStartAtZero?: boolean; reverseRows?: boolean; hideMissingCells?: boolean;
  missingValues?: "gap"; colorBands?: readonly { max?: number; color: string; label?: string; legendGroup?: string }[];
  cellLabel?: { text?: string; color?: string; showWhen?: number; fontSize?: number; fontWeight?: number };
  hoverHighlight?: boolean | { color?: string; width?: number };
};
export type AppRankingSpec = Common & Formatted & { type: "leaderboard" | "rankedList" | "funnel"; x: string; y: string;
  rowHeight?: number; markRadius?: number; markStartRadius?: number; initialVisibleCount?: number; labelMaxLength?: number };
export type AppWaterfallSpec = Common & Formatted & ChartDataInputs & { type: "waterfall"; x: string; y: string };
export type AppBoxPlotSpec = Common & { type: "boxPlot"; x: string; y: string;
  whiskers?: "tukey" | "minMax" | { percentiles: Domain }; valueFormat?: never };
export type AppSankeySpec = Common & { type: "sankey"; y: string; x?: string; series?: string;
  colorByColumn?: boolean; sankeyLabelFontSize?: number; sankeyLinkColorMode?: "source" | "target" | "gradient";
  sankeyNodeWidth?: number; sankeySortNodes?: boolean; sankeyTerminalLabelAlignment?: string;
  sankeyValueFontSize?: number; penultimateLabelAlignment?: string; valueFormat?: never;
} & ({ stages: readonly [string, string, ...string[]]; source?: string; target?: string }
  | { stages?: never; source: string; target: string } | { stages?: never; x: string; series: string });
type ChartFamily = AppLineSpec | AppAreaSpec | AppStackedAreaSpec | AppSparklineSpec | AppBarSpec
  | AppStackedBarSpec | AppNormalizedBarSpec | AppScatterSpec | AppPieSpec | AppHistogramSpec
  | AppHeatmapSpec | AppRankingSpec | AppWaterfallSpec | AppBoxPlotSpec | AppSankeySpec;
type UnionKeys<T> = T extends unknown ? keyof T : never;
type CompleteUnion<Member, Whole> = Member extends unknown
  ? Member & Partial<Record<Exclude<UnionKeys<Whole>, keyof Member>, never>> : never;
/** Optional-never members allow reading generic spec properties without
 * permitting another chart family's unsupported options. */
export type ChartSpec = CompleteUnion<ChartFamily, ChartFamily>;
/** Public React components also accept the portable vertical measure-list binding. */
export type AuthoredChartSpec = ChartSpec | (Extract<StandardChartSpec, { y: [string, ...string[]] }> & {
  type: "line" | "area" | "stackedArea" | "sparkline" | "bar" | "stackedBar" | "stackedBar100";
  fields?: never;
});
