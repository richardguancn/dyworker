<!-- Generated chart reference. -->

# Pie

For a part-to-whole question, keep categories and their shares visible in labels or an adjacent legend, with amounts available. Native value labels show amounts; tooltips alone need interaction. Use authored category labels/captions for percentages rather than applying percent formatting to raw counts.

Nonnegative mutually exclusive parts of a known whole. innerRadius 0 gives pie; 0≤radius<1 is a fraction, default54/82 gives donut. Max40 unique categories, positive finite total; negative/null/duplicate/all-zero invalid. Zero retained without arc; never automatic Other. Values default off, legend available; >8 categories alone is not a fallback reason. Tooltips give value and visible share; valueFormat formats measured values, not derived shares or caller-owned center. centerValue is explicit number/formatted string ≤1000 chars; centerLabel requires value, both donut-only and must fit. Legend toggles change shares but not center: visibly note "Shares reflect visible categories" and label fixed totals. External filters must update center if its meaning changes. Legacy decimals0–6 default1/currency must not conflict with valueFormat. Permanent labels that cannot fit need fallback; no grouping/nested pies/additional rings.

## Example

```json
{
  "id": "mix",
  "title": "Active users by plan",
  "spec": {"type":"pie","innerRadius":0,"category":"plan","value":"users"},
  "rows": [
    {"plan":"Pro","users":420},
    {"plan":"Team","users":280},
    {"plan":"Business","users":190}
  ]
}
```

```typescript
/** Unique, nonnegative, mutually exclusive parts; positive total, at most 40 categories. */
export type PieSpec = {
  type: "pie";
  category: string;
  value: string;
  /** Fraction of outer radius in [0, 1): 0 is solid; omitted preserves the 54/82 donut ratio. */
  innerRadius?: number;
  showValues?: boolean;
  showLegend?: boolean;
  currency?: string;
  valueDecimals?: number;
  colors?: ChartColors;
  valueFormat?: ValueFormat;
} & (
  /** Donut only. Legend toggles change visible shares but do not update this caller-owned center. */
  | { centerValue?: number | string; centerLabel?: never }
  | { centerValue: number | string; centerLabel?: string }
);
export type PieChart = Chart<PieSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
