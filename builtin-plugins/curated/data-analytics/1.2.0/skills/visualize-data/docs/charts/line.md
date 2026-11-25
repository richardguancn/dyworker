<!-- Generated chart reference. -->

# Line

Event-impact questions need comparison lines plus a labeled X reference at the supplied time; both wide measures and long-form series support this combination. Y references and uncertainty remain single-measure features. For positive values spanning orders of magnitude, labeled log Y preserves levels while exposing proportional slopes.

Straight segments join observations without invented smoothing. Dots show observations by default for up to 40 rows; denser curves retain hover/isolated dots. Missing observations (`null`) leave gaps. Value labels are off by default, and linear Y starts at zero. Uncertainty bands also join supplied bounds with straight segments.

## Example

```json
{
  "id": "users",
  "title": "Weekly active users",
  "spec": {"type":"line","x":"week","y":["Pro","Team"],"yLabel":"Active users"},
  "rows": [
    {"week":"Week 1","Pro":12000,"Team":8000},
    {"week":"Week 2","Pro":14000,"Team":null}
  ]
}
```

```typescript
export type LineReferences = Omit<References<"y" | "x">, "referenceLines"> & {
  referenceLines?: (
    | {
        axis: "y" | "x";
        value: number;
        label: string;
        between?: never;
        fraction?: never;
      }
    | {
        axis: "x";
        value: string;
        label: string;
        between?: never;
        fraction?: never;
      }
    | {
        axis: "x";
        between: [string, string];
        fraction?: number;
        label: string;
        value?: never;
      }
  )[];
};

/** X markers share the time/category axis across all comparison series. */
export type SharedLineEvents = Measures & {
  referenceLines?: (
    | { axis: "x"; value: number | string; label: string; between?: never; fraction?: never }
    | { axis: "x"; between: [string, string]; fraction?: number; label: string; value?: never }
  )[];
  referenceBands?: never;
  annotations?: never;
  rowId?: never;
  uncertainty?: never;
};

export type LineSpec = Cartesian &
  (MeasuredFeatures<
    LineReferences & {
      /** Supplied bounds; band segments are straight. */
    uncertainty?: Uncertainty<"bars" | "band">;
    }
  > | SharedLineEvents) & {
    type: "line";
    /** Inferred numeric/time spacing; category preserves ordinal order. Log needs positive numeric X. */
    xScale?: "linear" | "log" | "category";
    /** Log requires positive values/bounds and no startAtZero. Linear Y starts at zero by default. */
    yScale?: "linear" | "log";
    /** Numeric X only; cannot combine with category scale. */
    xDomain?: Domain;
    colors?: ChartColors;
    valueFormat?: ValueFormat;
  };
export type LineChart = Chart<LineSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
