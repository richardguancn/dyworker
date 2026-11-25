<!-- Generated chart reference. -->

# Sparkline

Axes and grid are hidden, so name the quantity, units and time span nearby. Missing observations leave gaps; isolated observations remain dots. Use a regular line chart when the reader needs precise axes.

## Example

```json
{
  "id": "usage",
  "title": "Daily requests",
  "spec": {"type":"sparkline","x":"day","y":"requests"},
  "rows": [
    {"day":"2026-01-01","requests":12},
    {"day":"2026-01-02","requests":0},
    {"day":"2026-01-03","requests":null},
    {"day":"2026-01-04","requests":18}
  ]
}
```

```typescript
/** Axes are hidden; put units and time scope in the surrounding text. Nulls leave gaps. */
export type SparklineSpec = Cartesian &
  Measures & {
    type: "sparkline";
    xScale?: "linear" | "category";
    valueFormat?: ValueFormat;
  };
export type SparklineChart = Chart<SparklineSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
