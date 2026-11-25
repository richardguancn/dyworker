<!-- Generated chart reference. -->

```typescript
/** Shared portable chart inputs. Field bindings are case-sensitive row keys. */
export type Scalar = string | number | boolean | null;
export type JsonValue = Scalar | JsonValue[] | { [key: string]: JsonValue };
export type Domain = [number, number];
export type SortOrder = "original" | "ascending" | "descending";
/** Display only: keep raw numbers. Percent expects fractions; digit bounds are integers 0–15, min ≤ max. */
export type ValueFormat = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
} & (
  | { style: "decimal" | "percent"; currency?: never }
  | { style: "currency"; currency: string }
);
/** Opaque #RGB/#RRGGBB or one of the documented theme variables. */
export type ChartColors = Record<string, string>;
export type PointAnnotation = {
  kind: "point";
  id: string;
  field: string;
  label: string;
  /** Use warning for a supplied-bound exceedance, negative for failure, positive for a favorable result. Default neutral; labels stay beside the point without arrows. */
  tone?: "neutral" | "warning" | "negative" | "positive";
} & (
  | { at: string | number; rowId?: never }
  | { rowId: string | number; at?: never }
);
export type ChartAnnotation = PointAnnotation
  | { kind: "benchmark"; id: string; label: string; field: string; measure: string; at?: string | number }
  | { kind: "event"; id: string; label: string; field: string; at: string | number }
  | { kind: "range"; id: string; label: string; at: string | number; end: string | number };
export type References<Axis extends string = "y"> = {
  referenceLines?: { axis: Axis; value: number; label: string }[];
  referenceBands?: { axis: Axis; from: number; to: number; label: string }[];
  annotations?: ChartAnnotation[];
  /** Stable string/numeric row identity; annotations use rowId instead of at. */
  rowId?: string;
};
export type Uncertainty<Style extends string = "bars"> = {
  lower: string;
  upper: string;
  style: Style;
  /** Supplied meaning, e.g. "95% confidence interval"; otherwise "Interval". */
  label?: string;
};
/** Wide measures bind a physical-axis tuple; long form binds one measure plus series. */
export type Measures =
  | { y: string; series?: string }
  | { y: [string, ...string[]]; series?: never };
export type SingleMeasure = { y: string | [string]; series?: never };
export type MeasuredFeatures<Features> =
  | (Measures & { [Key in Exclude<keyof Features, "annotations" | "rowId">]?: never } & { annotations?: ChartAnnotation[]; rowId?: string })
  | (SingleMeasure & Features);
/** Labels always refer to the physical horizontal (x) and vertical (y) axes. */
export type AxisLabels = { xLabel?: string; yLabel?: string };
/** Trend X: unique coordinates (or coordinate/series pairs), numeric distances or ISO dates.
 * Explicit null Y values leave gaps; measures on the same axis share comparable units.
 * Use xScale: "category" for ordinal strings; category X has no domain or references.
 */
export type Cartesian = AxisLabels & {
  x: string;
  xOrder?: (string | number)[];
  seriesOrder?: string[];
  showValues?: boolean;
  showLegend?: boolean;
  startAtZero?: boolean;
  yDomain?: Domain;
  yAxisPosition?: "left" | "right";
  /** @deprecated Use valueFormat. */
  valueDecimals?: number;
};
export type ChartData =
  | { columns?: never; rows: Record<string, Scalar>[] }
  | { columns: [string, ...string[]]; rows: Scalar[][] };
export type Chart<Spec> = ChartData & {
  /** Contract version; omission is v1 for existing configurations. */
  schemaVersion?: 1;
  id: string;
  title: string;
  spec: Spec;
  /** Shown in the info popup, not as a visible caption. Put decisive figures in a visible title, annotation or adjacent figcaption. */
  description?: string | null;
  /** Accessible chart label; not rendered as a visible finding or annotation. */
  summary?: string | null;
  /** Pixels, 120–800. */
  height?: number | null;
};
```
