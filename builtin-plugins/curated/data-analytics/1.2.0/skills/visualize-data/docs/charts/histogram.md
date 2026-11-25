<!-- Generated chart reference. -->

# Histogram
Explain the center and sparse tail in the final answer; name the few observations forming a tail, rather than reporting only its maximum.

Raw input binds observations to x and derives y; equally weighted finite numbers go directly to renderer, repeats retained, max counted once; no prebinning unless requested, no null/string/boolean coercion. Automatic equal rounded widths. Supplied bins: ≤200 increasing nonoverlapping finite lower<upper intervals, gaps allowed, nonnegative counts; lower/upper/label/y fields distinct, unique labels≤1000chars state endpoint inclusion. Never reconstruct raw observations/rebin/redistribute counts. Equal layout uses categorical slots; proportional preserves boundaries/widths/gaps and unequal widths require frequency(count/width) or density(count/total/width, positive finite total). Original numeric widths define normalization; density height is probability per unit, not bin probability. Proportional frequency area tracks counts/density area sums1; equal-slot area has no probability/count meaning. Tooltips preserve interval/count/statistic. Raw cannot set y/statistic/binLayout. No weights/grouped/cumulative/fitted curves/log/references/valueFormat/custom autobins. Extreme indistinct boundaries require reviewed units; don't use exact float equality.

## Example

```json
{
  "id": "latency",
  "title": "Response latency distribution",
  "spec": {"type":"histogram","xLabel":"Latency (ms)","yLabel":"Observations","input":"raw","x":"latency"},
  "rows": [
    {"latency":0},
    {"latency":40},
    {"latency":50},
    {"latency":50},
    {"latency":120}
  ]
}
```

```typescript
export type HistogramSpec = AxisLabels & {
  type: "histogram";
  showValues?: boolean;
  showLegend?: boolean;
} & (
    | {
        /** Equally weighted finite observations, including repeats; automatic equal-width bins. */
        input: "raw";
        x: string;
        y?: never;
        binLayout?: never;
        statistic?: never;
      }
    | {
        /** Reviewed nonoverlapping lower < upper intervals and nonnegative counts; preserve them. */
        input: "binned";
        x: { lower: string; upper: string; label: string };
        y: string;
        /** Equal-width interval slots by default; proportional preserves numeric widths. */
        binLayout?: "equal" | "proportional";
        /** Unequal proportional widths require frequency (count/width) or density (count/total/width). */
        statistic?: "count" | "frequency" | "density";
      }
  );
export type HistogramChart = Chart<HistogramSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
