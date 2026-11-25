import React from "react";
import { configuredCharts, ChartConfigurationError } from "../charting/configured-charts.jsx";
import { ChartRenderer } from "../charting/ChartRenderer.jsx";
import { resolveChartSpec } from "../charting/chart-overrides.js";
import { useOptionalDataAppShell } from "../DataAppContext.jsx";
import { DataComponent } from "./DataComponent.jsx";

/** A source-backed chart, without choosing its layout or analytical content. */
function ResolvedEvidenceChart({
  id, spec, dataInputs, rows, sourceRows, height = 240, chartOptions, renderPlot, children,
  ...componentProps
}) {
  const shell = useOptionalDataAppShell();
  if (shell?.visible?.(id) === false) return null;
  const chart = resolveChartSpec(spec, shell?.chartOverrides?.[id], dataInputs);
  const plot = <ChartRenderer {...chartOptions} {...shell?.chartProps?.(id)}
    chartId={id} spec={chart} rows={rows} height={height} />;
  return <DataComponent {...componentProps} id={id} kind="chart" chart={chart}
    displayRows={rows} sourceRows={sourceRows} loadingHeight={componentProps.loadingHeight ?? height}>
    {renderPlot ? renderPlot(plot, chart) : plot}
    {children != null && <div className="evidence-chart-details">{children}</div>}
  </DataComponent>;
}

export function EvidenceChart({ config, evidenceById, ...props }) {
  if (config === undefined) return <ResolvedEvidenceChart {...props} />;
  try {
    const { charts, resolveColor } = configuredCharts(config, props);
    return charts.map(chart => {
      const evidence = { ...props, ...evidenceById?.[chart.id] };
      const queryId = evidenceById?.[chart.id]?.queryId ?? props.queryId;
      if (typeof queryId !== "string" || !queryId.trim()) throw new Error(`Chart ${chart.id} requires a queryId evidence binding.`);
      return <ResolvedEvidenceChart {...evidence} key={chart.id} id={chart.id} queryId={queryId}
        title={chart.title} description={chart.description} spec={chart.spec} rows={chart.rows} height={chart.height}
        sourceRows={evidenceById?.[chart.id]?.sourceRows ?? props.sourceRows ?? chart.rows}
        chartOptions={{ resolveColor, ...evidence.chartOptions, accessibleLabel: evidence.chartOptions?.accessibleLabel ?? chart.summary ?? chart.title }} />;
    });
  } catch (error) { return <ChartConfigurationError config={config} error={error} />; }
}
