---
name: visualize-data
description: "Design or revise quantitative figures as part of a Data analytical report, dashboard, or notebook. Use this workflow for an existing Data artifact or when an analytical deliverable needs Data chart bindings or evidence inspection. For a new single chart in chat or in a plain HTML file, use Visualize directly."
---

# Charts in durable artifacts

Choose the encoding, units, comparisons and source for the requested artifact. For a new chart in a Page or standalone HTML file that supports the Visualize component library, use the installed Visualize chart interface and its selected family. Embed the reviewed fragment directly in the destination. For a standalone file, include the required shell and verify the actual file opens. Use the requested medium’s native figures for notebooks and static exports.

Existing Data HTML reports and dashboards bind their charts to reviewed rows, filters, source panels and exports. Use their public React bindings below. Preserve the saved renderer and its pin when revising an existing artifact. The following family guides describe those Data bindings. For inline charts or calculators, follow the installed Visualize workflow directly.

## Chart selection

Read this skill, the [shared chart fields](docs/charts/shared.md), and the chosen family guide together. The family guide supplies the fields, limits and an example. Choose the relationship first, then render the same reviewed configuration on the target surface.

### Choose the chart

<!-- chart-family-index:start -->
- [`line`](docs/charts/line.md)
- [`area`, `stackedArea`](docs/charts/area.md)
- [`bar`, `horizontalBar`, `stackedBar`, `stackedBar100`, `horizontalStackedBar`, `horizontalStackedBar100`](docs/charts/bar.md)
- [`histogram`](docs/charts/histogram.md)
- [`scatter`](docs/charts/scatter.md)
- [`heatmap`](docs/charts/heatmap.md)
- [`pie`](docs/charts/pie.md)
- [`leaderboard`, `rankedList`](docs/charts/ranking.md)
- [`sparkline`](docs/charts/sparkline.md)
- [`funnel`](docs/charts/funnel.md)
- [`waterfall`](docs/charts/waterfall.md)
- [`boxPlot`](docs/charts/box-plot.md)
- [`sankey`](docs/charts/sankey.md)
<!-- chart-family-index:end -->

### Recommended chart scenarios

Use these chart families by default for the scenarios below. Honor explicit table-only, text-only, and no-chart requests.

- **Cohort retention:** use a heatmap by cohort and elapsed period to compare retention at matched tenure. Keep missing observations distinct from zero.
- **Estimates and uncertainty:** use the [uncertainty fields](docs/charts/shared.md) to show the estimate and its confidence bounds together.
- **Break down a change:** waterfall when contributions reconcile the opening and closing totals.
- **Compare groups:** use `bar` with a series for platform; preserve distinct plan codes such as “Edu” and “Education.” A donut is `pie` with an inner radius.
- **Ordered stages:** funnel for conversion across comparable populations; point to the transition that changed.

Keep reviewed numbers, observed zeroes, null gaps, units, and denominators intact. State decisive values, exceptions, uncertainty or scenario assumptions beside the chart. For contribution comparisons, name the leading amount and its share and compare it with the remainder. Use [data writing](../../shared/data-writing.md) when interpreting substantive findings. A table and chart may accompany one another when they answer different questions.

For bar chart height, row spacing, and painted thickness, use the [size controls and their limits](docs/react/bar-presentations.md#size-controls).

### Sources

Connect the chart to its source and expose the underlying figures, period, grain, filters and material transformations. For coordinated Data dashboard views use the [controls](docs/charts/controls.md) and [composition](docs/charts/composition.md) guides.

## Chart rendering

### Page

Use the [Page chart workflow](docs/rendering/page-chart-fragment.md) for native insertion, per-Page upload and saved references.

### React reports and dashboards

Use the [dashboard](../build-dashboard/SKILL.md) or [HTML report](../../output_formats/html/report.md) starter's public `EvidenceChart` with the scoped reviewed rows. The current renderer runs behind the production chart interfaces. Example from `src/content/report/` or `src/content/dashboard/`:

```jsx
import React from "react";
import { EvidenceChart, useDataApp } from "../../data-app-public.jsx";

export function PlanActivity() {
  const { reviewedRows } = useDataApp();
  const rows = reviewedRows("active_users_by_plan", ["week"]);
  return <EvidenceChart id="activity" queryId="active_users_by_plan" title="Active users by plan"
    spec={{ type: "stackedArea", x: "week", y: "Pro", fields: ["Pro", "Team"], yLabel: "Active users" }}
    rows={rows} sourceRows={rows} />;
}
```

Use the [public chart bindings](docs/react/app-charts.md) for HTML apps; plain chart fragments use `mountChart`. For standalone chart HTML use the installed Visualize workflow for new charts. To re-export an existing Data chart, use the [saved Data export path](docs/rendering/native-inline-visualizations.md#standalone-preview-and-export).

### Verify an authored fragment

For a Data fragment on the [bundled chart release](docs/rendering/saved-chart-fragments.md#author-a-chart-fragment), run `assets/visualize-data/scripts/runtime/check-chart.mjs chart.html` when an executor is available (`--surface page` for Pages). This checks the fragment source. For an older saved pin, use its matching checker if available and verify in the intended reader. Keep the saved import URL. A `dynamic-payload` warning means the config was not validated: pass concrete initial and changed configurations as JSON files to the same checker. For example, numeric formatting requires `valueFormat: {style: "decimal", maximumFractionDigits: 2}`.

Inspect actual plotted marks or an explicit empty/error state and exercise an authored control; the outer element or a changing readout alone does not prove the chart rendered. Keep failures distinct from unavailable checks. Unchanged standard Page renderer output follows the Page path above.

Page fragments allow 256 KiB UTF-8, inline/HTML 1 MB subject to tighter host limits; 2,000 rows per chart and 2 MB JSON. Disclose necessary reductions. Keep previously published URLs in saved artifacts.
