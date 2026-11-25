<!-- Generated chart reference. -->

# Waterfall

Reconcile beginning + ordered signed movements = ending. beginning is required in spec; rows contain movements only, no start/end totals. Optional ending must reconcile; retain decimal precision, never manufacture adjustment or round before reconciling. Empty rows show empty state. Start/end bars, signed colors and value labels are built in. No second measure, grouping or uncertainty overlays; valueFormat changes display only. Rendering metadata must not overwrite authored fields.

## Example

```json
{
  "id": "revenue",
  "title": "Revenue bridge",
  "spec": {"type":"waterfall","x":"driver","y":"amount","beginning":120000,"ending":137000,"yLabel":"Revenue (USD)"},
  "rows": [
    {"driver":"New customers","amount":28000},
    {"driver":"Expansion","amount":12000},
    {"driver":"Contraction","amount":-8000},
    {"driver":"Churn","amount":-15000}
  ]
}
```

```typescript
export type WaterfallSpec = AxisLabels & {
  type: "waterfall";
  x: string;
  y: string;
  /** Rows contain signed movements only; beginning + sum(movements) must equal ending. */
  beginning: number;
  ending?: number;
  valueFormat?: ValueFormat;
};
export type WaterfallChart = Chart<WaterfallSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
