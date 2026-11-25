<!-- Generated chart reference. -->

# Bar

Stacks require complete, nonnegative, additive parts of the same whole. Normalized stacks take original counts with positive category totals; legend toggles recompute shares, so label them "Shares of visible categories". Value axes include zero. Categories retain their supplied order unless sorted.

For contribution comparisons, encode original amounts; show the leading amount and share together in a visible caption or annotation. For before/after questions, retain both measures and keep capacity/target context visible.

At most 40 vertical or 38 horizontal categories fit; horizontal height must be at least `40 + 20 × categories` pixels. Labels wrap and expose full text on hover; never silently drop categories or invent an Other group.

For an explicitly requested square-corner theme, set CSS `--mark-radius: 0` on each rendered `[data-chart-root]`'s shadow host (`chartRoot.getRootNode().host`). The chart roots are inside nested open shadow roots. After changing the style, reassign the complete `chart.config` so geometry updates. The shared JSON `markRadius` option can also set the bar radius explicitly.

## Example

```json
{
  "id": "channels",
  "title": "Signups by acquisition channel",
  "height": 280,
  "spec": {"type":"horizontalBar","x":"signups","y":"channel","xLabel":"Signups","yLabel":"Acquisition channel"},
  "rows": [
    {"channel":"Organic search","signups":420},
    {"channel":"Product referrals","signups":280},
    {"channel":"Community partnerships","signups":190}
  ]
}
```

```typescript
export type BarOptions = {
  sortOrder?: SortOrder;
  colors?: ChartColors;
};
export type HorizontalMeasures =
  | { x: string; series?: string }
  | { x: [string, ...string[]]; series?: never };
export type HorizontalSingleMeasure = { x: string | [string]; series?: never };
export type HorizontalMeasuredFeatures<Features> =
  | (HorizontalMeasures & { [Key in keyof Features]?: never })
  | (HorizontalSingleMeasure & Features);
/** Bar bindings and labels name physical axes. Horizontal bars put categories on y. */
export type HorizontalCartesian = Omit<Cartesian, "x" | "yDomain" | "xOrder"> & {
  y: string;
  yOrder?: (string | number)[];
  xDomain?: Domain;
};
export type BarSpec = BarOptions & { valueFormat?: ValueFormat } & (
    | (Cartesian &
        MeasuredFeatures<References & { uncertainty?: Uncertainty }> & {
          type: "bar";
        })
    | (HorizontalCartesian &
        HorizontalMeasuredFeatures<
          References<"x"> & { uncertainty?: Uncertainty }
        > & { type: "horizontalBar" })
  );
/** Stack only complete additive measures; bars include zero in their value domain. */
export type StackedBarSpec = BarOptions & { valueFormat?: ValueFormat } & (
    | (Cartesian & Measures & { type: "stackedBar" })
    | (HorizontalCartesian &
        HorizontalMeasures & { type: "horizontalStackedBar" })
  );
/** Nonnegative parts of a whole; visible parts renormalize after local legend toggles. */
export type NormalizedBarSpec = BarOptions &
  (
    | (Cartesian & Measures & { type: "stackedBar100" })
    | (HorizontalCartesian &
        HorizontalMeasures & { type: "horizontalStackedBar100" })
  );
export type BarChart = Chart<BarSpec | StackedBarSpec | NormalizedBarSpec>;
```

[Using this chart in React](../../SKILL.md#react-reports-and-dashboards)
