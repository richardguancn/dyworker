<!-- Generated chart reference. -->

Read the [shared types](shared.md) and the [selected chart family](../../SKILL.md#choose-the-chart) when authoring a chart.

```typescript
type FamilySpec =
  | LineSpec
  | AreaSpec
  | StackedAreaSpec
  | BarSpec
  | StackedBarSpec
  | NormalizedBarSpec
  | SparklineSpec
  | ScatterSpec
  | PieSpec
  | HistogramSpec
  | WaterfallSpec
  | HeatmapSpec
  | RankingSpec
  | FunnelSpec
  | BoxPlotSpec
  | SankeySpec;
type WithPresentation<S> = S extends { type: infer T } ? S & PresentationOptions<T> : never;
export type StandardChartSpec = WithPresentation<FamilySpec>;
export type SingleChart = Chart<StandardChartSpec>;
/** Only charts belongs on the comparison wrapper; metadata belongs on each chart. */
export type Comparison = {
  schemaVersion?: 1;
  charts: [SingleChart, SingleChart] | [SingleChart, SingleChart, SingleChart];
} & { [Key in Exclude<keyof SingleChart, "schemaVersion">]?: never };
export type ChartConfig = (SingleChart & { charts?: never }) | Comparison;
export interface VisualizeChartElement extends HTMLElement {
  /** Assign a full envelope to update. Nested mutations alone do not render. */
  config: ChartConfig | null;
}
/** Synchronous return, asynchronous rendering. Owns/replaces container contents.
 * Later validation/loading errors appear in the element and window error stream.
 * Removal disconnects/disposes the chart; no public ready/update/dispose handle.
 */
export declare function mountChart(
  container: HTMLElement,
  config: ChartConfig,
): VisualizeChartElement;
export interface WidgetSnapshot {
  modelContent?: JsonValue;
  privateContent?: JsonValue;
}
export interface VisualizeStateHost {
  widgetState: WidgetSnapshot | null;
  /** Replaces the snapshot; optimistic local state, best-effort persistence. */
  setWidgetState(next: WidgetSnapshot): Promise<void>;
}
/** Local typing for hosted/standalone contexts without changing global Window. */
export type VisualizeWindow = Window & { openai?: VisualizeStateHost };
export type WidgetGlobalsEvent = CustomEvent<{
  globals: { widgetState?: WidgetSnapshot | null };
}>;
```
