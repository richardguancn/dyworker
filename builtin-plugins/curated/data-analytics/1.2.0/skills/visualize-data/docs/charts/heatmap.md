<!-- Generated chart reference. -->

# Heatmap

Grid of category pairs: x=column, y=row, value=number. Each coordinate unique; duplicates need reviewed aggregation. Null/absent cells unknown, zero observed; hiding missing cells never imputes or reduces grid size. Full Cartesian grid≤2000 cells. Order lists unique; colorDomain finite increasing (rate fractions commonly[0,1]); rates need reviewed denominator and comparisons need intentional shared domain. missingValues only gap; no color-stop/interpolation/imputation settings. Preserve authored field names and original values; valueFormat affects measured display only.

## Example

```json
{
  "id": "retention",
  "title": "Cohort retention",
  "description": "Retention uses each original signup cohort as denominator. Future weeks are unknown.",
  "spec": {"type":"heatmap","x":"week","y":"cohort","colorDomain":[0,1],"hideMissingCells":true,"value":"retentionRate"},
  "rows": [
    {"week":"Week 0","cohort":"A","retentionRate":1},
    {"week":"Week 1","cohort":"A","retentionRate":0},
    {"week":"Week 1","cohort":"B","retentionRate":null}
  ]
}
```

```typescript
export type HeatmapSpec = AxisLabels & {
  type: "heatmap";
  x: string;
  y: string;
  /** One row per X/Y pair; null or absent cells are unknown, zero is observed. Grid ≤2,000 cells. */
  value: string;
  xOrder?: (string | number)[];
  yOrder?: (string | number)[];
  colorDomain?: Domain;
  hideMissingCells?: boolean;
  showValues?: boolean;
  missingValues?: "gap";
  valueFormat?: ValueFormat;
};
export type HeatmapChart = Chart<HeatmapSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
