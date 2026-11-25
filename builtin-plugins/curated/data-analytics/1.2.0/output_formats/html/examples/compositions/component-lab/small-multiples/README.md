# Shared-scale regional panels

This optional recipe renders six synthetic monthly revenue-index charts using existing `EvidenceChart` components. The report and dashboard share the same authored component, source queries, and chart specification. It adds no runtime API, control, forecast, or snapshot feature.

The interface describes panels rather than returning mutable axis objects:

```jsx
<SmallMultiples
  panels={regionalPanels}
  columns={3}
  spec={{
    type: "line", x: "month", y: "revenueIndex",
    valueDomain: [90, 130], startAtZero: false,
    valueFormat: { style: "decimal", maximumFractionDigits: 0 },
    colors: { revenueIndex: "var(--chart-1)" },
  }}
/>
```

Each panel supplies a stable `id`, `title`, `queryId`, plotted `rows`, and scoped original `sourceRows`. `SmallMultiples` is local authored code copied into `src/content/shared/small-multiples/`, not an export from `data-app-public.jsx`. It accepts one, two, or three columns; that count is a maximum. Container widths below 900px reduce three columns to two, and below 600px all layouts become one column. Reports retain their normal editorial column and therefore typically show two columns on desktop.

`fixture.mjs` explicitly lists the six regions and January–June dates. The fixture-specific alignment helper requires one finite numeric or null index value per source month. Duplicate and out-of-period rows fail rather than silently aggregate or disappear. Regions with observations get null display rows for missing dates without adding them to the source evidence; null is never converted to zero. An empty source query keeps its titled panel with `rows: []`, allowing the shared renderer to show its native empty state. The recipe never suppresses a plot based on the authored measure: the renderer applies saved bindings and reports invalid configurations. Replace every synthetic value and source description before adapting this example to real analysis.

Initially, all authored panels use the same 90–130 value domain, date coverage, formatter, and metric color. Dates remain elapsed-time coordinates. Index values represent relative movement from each region's own January baseline; they do not compare regional revenue size. Ordinary chart editing, visibility, source inspection, and image export remain shell-owned. Saved chart settings take precedence independently for each panel: editing an axis, measure, chart type, or zoom can make panels incomparable. Revalidate the comparison after those edits; this recipe does not enforce linked editing or overwrite saved settings. Any authored copy describing the shared scale must be updated if the owner intentionally changes it.

From the canonical template directory:

```sh
node examples/component-lab/small-multiples/build.mjs
```

The builder creates separate temporary report and dashboard projects, then runs their normal build workflow. Pass `report` or `dashboard` to build one surface; add `--output-root /absolute/new/directory` to retain the projects. Existing surface directories are never overwritten. `--local-preview` uses installed canonical template dependencies, copies the protected shared UI sources into the temporary app, and resolves the chart adapter from the installed plugin. It verifies that copied runtime before building with local actions. That private loopback preview embeds its project path and must not be published or distributed. No canonical starter content or protected infrastructure is changed.

Check the built charts at desktop and mobile widths, including actual axes and marks. Remove a middle-month source row to verify a genuine line gap, clear one region's query rows to inspect its retained empty slot, and inspect a region's source to confirm that no other region or synthetic gap row appears. Verify saved edits survive reopening, and recheck scales before sharing the comparison.
