import React from "react";
import { configuredCharts, ChartConfigurationError } from "../charting/configured-charts.jsx";

import { ChartRenderer } from "../charting/ChartRenderer.jsx";
import { resolveChartSpec } from "../charting/chart-overrides.js";
import { useOptionalDataAppShell } from "../DataAppContext.jsx";

/** Connect authored charts to saved settings; editor previews use the pure renderer. */
function ResolvedChart({ chartId, spec, dataInputs, ...props }) {
  const shell = useOptionalDataAppShell();
  const chart = resolveChartSpec(spec, chartId ? shell?.chartOverrides?.[chartId] : undefined, dataInputs);
  return <ChartRenderer {...props} chartId={chartId} spec={chart} />;
}

/** Adapt the public configuration contract to the retained HTML chart lifecycle. */
export function Chart({ config, ...props }) {
  if (config === undefined) return <ResolvedChart {...props} />;
  try {
    const { charts, resolveColor } = configuredCharts(config, props);
    return charts.map(chart => <ResolvedChart {...props} key={chart.id} chartId={chart.id}
      spec={chart.spec} rows={chart.rows} height={chart.height}
      resolveColor={props.resolveColor ?? resolveColor} accessibleLabel={props.accessibleLabel ?? chart.summary ?? chart.title} />);
  } catch (error) { return <ChartConfigurationError config={config} error={error} />; }
}
