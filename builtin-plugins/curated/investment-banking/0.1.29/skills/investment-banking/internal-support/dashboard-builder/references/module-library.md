# Dashboard Module Library

Use shared modules to keep dashboards consistent across Investment Banking skills.

## Executive Modules

### `metric_strip`

Use for top-of-dashboard KPIs.

```json
{
  "type": "metric_strip",
  "title": "Decision KPIs",
  "metrics": [
    {"label": "Net leverage", "value": "4.8x", "tone": "watch", "note": "At close"}
  ]
}
```

Tones: `positive`, `neutral`, `watch`, `negative`, `info`.

### `verdict`

Use for recommendation posture, readiness, or committee answer.

Fields: `posture`, `score`, `body`, `bullets`.

### `md_question`

Use for the question the dashboard answers. This can also show `answer`, `why_it_matters`, and `next_decision`.

### `evidence_posture`

Use to summarize source quality and data gaps.

Fields: `items`, each with `label`, `status`, `detail`.

## Risk and Action Modules

### `flags`

Use for red flags, diligence issues, process blockers, and negotiation points.

Fields: `flags`, each with `severity`, `title`, `detail`, `owner`, `ask`.

### `action_register`

Use for follow-up tasks.

Fields: `actions`, each with `action`, `owner`, `deadline`, `status`, `priority`.

### `source_readiness`

Use for data-room completeness and evidence quality.

Fields: `items`, each with `item`, `status`, `source`, `gap`, `next_step`.

## Table Modules

### `table`

Use for compact tables that can live in a normal module.

### `wide_table`

Use when the table needs full page width. The renderer should place this in a wide panel and enable horizontal scroll.

Common fields:

```json
{
  "type": "wide_table",
  "title": "Covenant Headroom",
  "columns": ["Metric", "Base", "Downside", "Covenant", "Headroom"],
  "rows": [
    ["Net leverage", "4.8x", "5.6x", "6.0x", "0.4x"]
  ],
  "sticky_first_column": true
}
```

For mobile-friendly stacked rows, add `mobile_labels: true` or provide row objects with named keys.

## Chart Modules

Charts should be rendered without external dependencies unless explicitly allowed. Keep chart data compact and include labels.

### `bar_chart`

Fields: `data` with `label`, `value`, optional `tone`.

### `line_chart`

Fields: `series`, each with `name` and `points` containing `label` and `value`.

### `waterfall`

Fields: `steps`, each with `label`, `value`, optional `kind` where `kind` is `start`, `increase`, `decrease`, or `end`.

### `heatmap`

Fields: `x`, `y`, `values`. Use for risk grids or diligence coverage.

### `sensitivity_matrix`

Fields: `row_label`, `column_label`, `rows`, `columns`, `values`, optional `highlight`.

## Finance-Specific Modules

### `covenant_grid`

Use for leverage, coverage, liquidity, basket, and restricted payment headroom.

### `valuation_bridge`

Use for EV to equity value, purchase price to returns, or claims to recovery bridge.

### `funnel`

Use for buyers, investor outreach, deal process stages, or conversion funnel.

### `timeline`

Use for process milestones, maturity ladder, diligence plan, or committee path.
