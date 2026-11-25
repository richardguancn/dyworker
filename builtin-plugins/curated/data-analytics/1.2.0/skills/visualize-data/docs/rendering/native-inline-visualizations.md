# Standalone output and compatibility

Use installed Visualize for new inline charts, interactive tools, and new charts in a plain HTML document, including an existing document with no chart yet. Follow the installed Visualize authoring and export guide. Use the Data workflow for existing React reports and dashboards. When revising a saved Data fragment, preserve its [versioned component](saved-chart-fragments.md).

## When native inline delivery fails

Preserve the Visualize fragment and any working interactive output. After checking the host and attempting a scoped repair, state the delivery limitation and provide the reviewed finding and values in prose or a compact table. If the user requested a separate export, follow the installed Visualize skill's export workflow.

## Standalone preview and export

To re-export an existing standalone Data chart, use its reviewed JSON with the
Data renderer's HTML surface:

```sh
node "<data-plugin>/assets/visualize-data/scripts/runtime/render-chart.mjs" \
  --input /absolute/chart.json --output /absolute/chart-export.html --surface html
```

Use the standalone wrapper below to preview or export an existing Data fragment. Native inline and Page delivery do not run or require `render.py`;
retain the unwrapped fragment for those surfaces. For a new report/dashboard,
use its selected Data workflow instead.

A browser opened only for inline QA is temporary. Do not call `markDeliverable()` or retain it as a second sidebar output. After inspection, close or release only task-created QA tabs and stop only task-owned preview processes; preserve unrelated tabs and report unavailable cleanup. Deliver the native inline reference in the final answer. An explicitly requested separate output and sidebar opening of a standalone report/dashboard or Page retain their own delivery workflow.

Resolve the helper under the installed **Data** plugin, not another plugin with the same filename:

```sh
python3 "<data-plugin>/assets/visualize-data/scripts/runtime/render.py" /absolute/chart.html --serve
python3 "<data-plugin>/assets/visualize-data/scripts/runtime/render.py" /absolute/chart.html /absolute/chart-export.html
```

After editing the fragment, regenerate the same task-owned export with `--force`; without it, an existing file is deliberately preserved. Confirm the output is the export being revised, not a source file or another user's artifact. Pass `--title` for a useful document title rather than inheriting a working filename. In a desktop task, use its local browser capability to inspect a loopback preview; a browser connector on a different host cannot reach that local server. Elsewhere use the browser on the execution host. Do not probe unrelated browser tools after the preview is already reachable.

These commands build a restricted standalone HTML document; they do not run the chart checker. Use Data's `check-chart.mjs` for standard Data charts. Do not substitute `render.py --check` or the separate Visualize plugin's helper. Preserve the pinned Data import and component when wrapping a standard chart. Review any host-only interactions before standalone export.

When revising a saved Data scenario tool with custom controls, let this helper wrap the existing Data fragment for export and preview. Omit `--port` to use an available loopback port; read the actual URL from the running process and keep that process alive for preview. Do not probe a free port and release it before binding, guess a fixed port, or stop an unrelated server after a collision. Reuse this preview for custom-control checks and export the same fragment after the final edit. Page reports need this companion only when explicitly requested.

Choose numeric-control precision from the measure: integer steps for discrete counts, fractional steps for rates, durations, expected volumes and monetary amounts when meaningful. Keep blank, invalid and missing inputs distinct from zero; commit only finite values within the stated domain. Allow signed changes when the measure permits them without allowing negative populations or durations. Retain full precision in calculations and chart rows; normalize a displayed rounded zero to `0` rather than `-0`. Derive controls, readouts, tables and the complete standard chart config from one state object. For plain HTML, `mountChart(container, initialConfig)` returns the chart element; update it with `chart.config = nextConfig` (the complete config with new rows). It has no public `update()` or `setConfig()` method. See the [public API](../charts/public-api.md) only for additional lifecycle details. Reset restores every default and clears pending updates. Test a fractional input, a valid boundary, rapid input followed by reset, and a meaningful changed result; do not require a particular business model or a loss case when it is irrelevant.

The Data-bundled wrapper permits chart modules under `https://persistent.oaistatic.com/plugins/visualize/charts/`. An actual host may apply a different or stricter policy. A successful standalone check is evidence for that document only; inspect the real target surface for claims about its rendering, interactions or reload behavior. Do not change host permissions or CDN pins to work around an inconclusive preview.
