import React from "react";
import { appChartConfigEntries, chartConfigColors } from "./chart-config.js";

export function configuredCharts(config, props) {
  for (const key of ["id", "title", "description", "spec", "rows", "height", "dataInputs", "chartId"])
    if (props[key] !== undefined) throw new Error(`config cannot be combined with ${key}.`);
  const charts = appChartConfigEntries(config).map(chart => ({ ...chart,
    // Registration, saved overrides and exports all use HTML's physical-axis labels.
    spec: ["horizontalBar", "horizontal-bar", "horizontalStackedBar", "horizontalStackedBar100"].includes(chart.spec.type)
      ? { ...chart.spec, xLabel: chart.spec.yLabel, yLabel: chart.spec.xLabel } : chart.spec,
  }));
  return { charts, resolveColor: chartConfigColors(charts) };
}

export function ChartConfigurationError({ config, error }) {
  return <div className="component-data-state" role="alert" data-chart-config-error="true" data-chart-id={config?.id}>
    <strong>Chart configuration error</strong><p>{error.message}</p>
  </div>;
}
