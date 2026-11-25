<!-- Generated chart reference. -->

# Area

Stacked areas require complete, nonnegative, additive parts of the same whole; rates, averages and overlapping populations cannot be stacked. Unstacked missing observations remain gaps. Linear Y includes zero by default; use a line when the filled baseline would mislead.

## Example

```json
{
  "id": "activity",
  "title": "Active users by plan",
  "spec": {"type":"stackedArea","x":"week","y":["Pro","Team"],"yLabel":"Active users"},
  "rows": [
    {"week":"Week 1","Pro":12000,"Team":8000},
    {"week":"Week 2","Pro":14000,"Team":9000}
  ]
}
```

```typescript
export type AreaSpec = Cartesian &
  MeasuredFeatures<References> & {
    type: "area";
    xScale?: "linear" | "category";
    /** Log requires positive values/bounds and no startAtZero. */
    yScale?: "linear" | "log";
    colors?: ChartColors;
    valueFormat?: ValueFormat;
  };
/** Stack only nonnegative additive measures with complete observations. */
export type StackedAreaSpec = Cartesian &
  Measures & {
    type: "stackedArea";
    xScale?: "linear" | "category";
    colors?: ChartColors;
    valueFormat?: ValueFormat;
  };
export type AreaChart = Chart<AreaSpec | StackedAreaSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
