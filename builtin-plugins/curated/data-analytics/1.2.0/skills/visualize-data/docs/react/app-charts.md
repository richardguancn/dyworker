# Charts in HTML reports and dashboards

Use the starter's production public interfaces, backed by the current Data chart renderer. Follow the [HTML chart component guide](../../../../output_formats/html/docs/components/charts/charts.md) for field mappings, sizing, interactions, editing and export, and [bar presentations](../../../../output_formats/html/docs/components/charts/bar-presentations.md) for those compositions.

```jsx
import React from "react";
import { EvidenceChart, useDataApp } from "../../data-app-public.jsx";

export function AdoptionTrend() {
  const { reviewedRows } = useDataApp();
  const rows = reviewedRows("usage_summary", ["week"]);
  return <EvidenceChart id="adoption-trend" queryId="usage_summary"
    title="Weekly adoption" spec={{ type: "line", x: "week", y: "activeUsers" }}
    rows={rows} sourceRows={rows} height={260} />;
}
```

Pass `rows` for plotted values and `sourceRows` for their original scoped evidence. `EvidenceChart` connects the effective edited spec to the plot and source/actions record. The shared shell owns filtering, source inspection, editing, persistence and export. The HTML runtime includes the chart engine and styles for portable offline delivery.

`Chart` and `ChartRenderer` retain the same split `spec`/`rows` interface. Keep an existing project's public bindings and stable component identities. Author native inline and Page chart fragments through their existing `mountChart` workflow.

## Example with supplied uncertainty

This synthetic example keeps estimates and their supplied bounds together. Use actual reviewed bounds and their documented meaning; do not invent intervals.

```js
const forecastSpec = {
  type: "line", x: "week", y: "activation",
  valueFormat: { style: "percent", maximumFractionDigits: 1 },
  yDomain: [0, 1],
  referenceLines: [{ axis: "y", value: 0.8, label: "Reviewed target" }],
  uncertainty: {
    lower: "lower", upper: "upper", style: "band",
    label: "95% prediction interval",
  },
};
const forecastRows = [
  { week: "2026-10-05", activation: 0.65, lower: 0.60, upper: 0.70 },
  { week: "2026-10-12", activation: 0.69, lower: 0.63, upper: 0.75 },
];
```

The versioned chart configuration uses physical-axis fields such as `yDomain`. Normalize that configuration through the public `chartConfigEntries` helper before passing its `spec` and `rows` to the HTML component:

```jsx
import { chartConfigEntries, EvidenceChart } from "../../data-app-public.jsx";

const [forecast] = chartConfigEntries({
  id: "forecast", title: "Activation forecast", spec: forecastSpec, rows: forecastRows,
});
<EvidenceChart {...forecast} queryId="forecast_outlook" sourceRows={forecastRows} />;
```

Bind `queryId` to the actual reviewed query and keep `sourceRows` scoped to the plotted population. Reopening and exporting must preserve the effective spec, including its domain, reference and interval fields.
