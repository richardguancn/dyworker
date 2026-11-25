<!-- Generated chart reference. -->

# Box-plot

Choose raw observations or one reviewed ordered five-number summary/category, never mix. Summary minimum≤lowerQuartile≤median≤upperQuartile≤maximum; y names quantity; omit whiskers, preserve endpoints, cannot infer outlier counts. Raw quartiles linearly interpolated; observations outside whiskers remain visible/in domains/tooltips. minMax uses full range/no outliers. Percentile whiskers use observed endpoints or quartile for sparse cases, not interpolated endpoints; [0,100]=minMax. Signed/decimal/single/zero-width valid; missing/nonfinite require reviewed decision. No notches/grouping/log/references/valueFormat. Category cannot use minimum/lowerQuartile/median/upperQuartile/maximum/spread/lowerWhisker/upperWhisker/outliers/whiskerLabel/sampleCount. Check units/order/quartiles/whiskers.

## Example

```json
{
  "id": "delivery",
  "title": "Delivery time by region",
  "spec": {"type":"boxPlot","x":"region","y":"minutes","yLabel":"Delivery time (min)"},
  "rows": [
    {"region":"East","minutes":15},
    {"region":"East","minutes":18},
    {"region":"East","minutes":20},
    {"region":"East","minutes":22},
    {"region":"East","minutes":100},
    {"region":"West","minutes":20},
    {"region":"West","minutes":40}
  ]
}
```

```typescript
export type BoxPlotSpec = AxisLabels & {
  type: "boxPlot";
  x: string;
  /** Raw quantity, or use fixed minimum/lowerQuartile/median/upperQuartile/maximum fields per category. */
  y: string;
  yAxisPosition?: "left" | "right";
  /** Raw only: default Tukey; quartiles interpolate. Summaries preserve ordered endpoints and omit whiskers. */
  whiskers?: "tukey" | "minMax" | { percentiles: Domain };
};
export type BoxPlotChart = Chart<BoxPlotSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
