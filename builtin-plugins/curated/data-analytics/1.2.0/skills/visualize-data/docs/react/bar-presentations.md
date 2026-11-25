# Bar presentations

Use `Chart` for bar-family plots, bullet/target charts, segmented compositions, grouped/ranked lists, progress, ranges, and comparisons. Ordinary chart specs are unchanged; presentations are explicit rather than an automatic visual conversion.

For shared bindings and host behavior, see [charts](app-charts.md).

## Size controls

Chart `height` is a minimum for ordinary horizontal bars; width follows the containing page or card. Inline JSON has no top-level `width`. `spec.rowHeight` sets minimum category spacing, not painted bar thickness. Larger chart heights and wrapped labels can increase that spacing. Ordinary single-series `horizontalBar` charts with one-line labels compact toward 600px when their usual 42px rows would exceed it, with at least 22px spacing by default. This is a target, not a height cap. Short charts, wrapped labels, grouped/stacked bars, uncertainty and leaderboards retain their usual defaults. Explicit `rowHeight` overrides the default, subject to a 20px one-line minimum in compact charts; larger `height` still wins. The inline input minimum remains `40 + 20 * categoryCount` (600px for 28 rows).

To control painted thickness, `presentation: "plot"` with `barOptions: { style: { thickness: 8 } }` requests 8px mark height for horizontal bars or width for vertical bars. `thickness` also sizes bullet, segmented, grouped-list, ranked-list, progress and comparison marks; their labels and row gaps can reserve more space. `rangePosition` does not use it. Ordinary bars without a presentation ignore this presentation-only option and derive thickness from their category spacing. `rowHeight` does not size presentation layouts or ordinary vertical bars. Presentations with uncertainty or reference features are not interchangeable with the ordinary chart path.

## Recipes and field bindings

```jsx
<EvidenceChart queryId="team_plan" sourceRows={rows} config={{
  id: "team-plan", title: "Revenue against plan",
  spec: { type: "horizontalBar", x: "revenueUsd", y: "team", presentation: "bullet",
    barOptions: { target: "planUsd" },
    valueFormat: { style: "currency", currency: "USD", maximumFractionDigits: 0 } },
  rows
}} />
```

Use the [shared presentation contract](../charts/presentation.md). `barOptions` contains recipe-specific settings; axis bindings and `valueFormat` stay on `spec`. The old `barChartSpec` helper remains compatible with retained apps. Materialize calculated ranges/labels in reviewed rows, never callback-valued configs. Source projection retains referenced measure, goal, range, tooltip and display fields.

Use chart-level `valueFormat` for numeric labels, target/range values, tooltips, and accessible text, with the same units and precision contract as ordinary charts. It takes precedence over legacy `barOptions.format` (or recipe `format`) Intl options; legacy-only recipes retain their existing formatting. Callbacks are not supported inside the JSON config. Progress attainment percentages and composition shares retain their separate ratio meaning; `valueFormat` formats the reviewed amounts without changing them.

Progress hover content defaults to a concise actual-of-goal summary and percentage. Set `unitField` to a reviewed row field such as `unit: "hours"`; explicit `tooltipFields`
still request the structured tooltip. Segmented comparisons may use `annotations: "auto"`
to retain aligned labels only when every segment's label and value fits; otherwise they show a value table. The legacy `"aligned"` mode uses the same overflow protection.
Hover or keyboard focus emphasizes the same segment across both periods and their annotations, including the narrow-layout table. Category colors remain unchanged.

## Progress and ranges

- For attainment against a positive goal, use `presentation: "progress", track: { max: "goalField" }`. Optional `style: { segments: 10 }` renders 2–40 equal steps, rounding the filled step count while keeping exact attainment in text/hover. This is not a part-to-whole composition. `detailField` plus `labels: { position: "summary" }` gives a compact percentage/detail row.
- For a current value within known bounds, use `presentation: "rangePosition", category: "label", value: "current", range: ["low", "high"]`. It supports signed values; a collapsed interval centers its matching value. Outside values pin the marker to the appropriate end but retain their exact value in text, hover and source. Missing bounds/current never produce a fabricated marker. `labels: { primary: false }` omits the duplicate heading when embedded under an existing label. It is not a confidence interval unless the supplied evidence actually defines one.

## Editing and data requirements

Specialized presentations edit compatible reviewed-field mappings. Arbitrary type changes, splitting, or generic appearance toggles that would discard presentation requirements are not offered. Signed values belong in plots or range-position indicators; progress needs positive reviewed goals; composition needs complete, mutually exclusive additive segment values. Missing values are not zero, absent targets are not invented, and zero-total composition has no percentage share.
