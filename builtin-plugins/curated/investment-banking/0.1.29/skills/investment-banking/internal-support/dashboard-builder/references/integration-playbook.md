# Investment Banking Dashboard Integration Playbook

Use `dashboard-builder` as the shared renderer for Investment Banking workflows that still choose a dashboard or legacy renderer path. Analytical skills that opt into it continue to own their core deliverables and produce a dashboard contract as a secondary handoff. Skills migrated to `../../../../../references/html-artifact-standard.md` own standalone HTML directly and do not use this integration path for ordinary reports.

## Recommended Ownership

| Layer | Owner |
|---|---|
| Analysis, calculations, banker judgment | Source skill |
| Skill-specific section map | Source skill |
| `dashboard_contract.json` creation | Source skill, optionally assisted by dashboard-builder |
| HTML/CSS/JS renderer | dashboard-builder |
| Module library and responsive behavior | dashboard-builder |
| Contract schema and artifact audit | dashboard-builder |

## Highest-Priority Dashboard Skills

Priority 2:

- `cim-builder`

Priority 3:

- `style-guide-adapter`
- `financial-source-of-truth`
- `excel-data-cleaner`

## Contract Build Pattern

Each source skill that still uses this renderer should append this packaging step when the user asks for a dashboard or when the skill output is complex enough to benefit from one:

1. Build the normal skill deliverable.
2. Read `references/dashboard-map.md` for that skill.
3. Populate `dashboard_contract.json` with source-aware data.
4. Call dashboard-builder to render the package.
5. Return the normal deliverable and dashboard artifact links together.

For source-aware data, include `sources`/`citations` once and reference them inline on metrics, report paragraphs, bullets, table rows/cells, hero callouts, snapshot tiles, and modules. Accepted fields are `citations`, `citation_ids`, `citation`, `source_id`, and `source_ids`; bracket markers such as `$15.0B [S1]` are also supported. Numeric values should usually be the citation link themselves, while non-numeric claims use small chips. If the same source set supports a whole section/card/table, put the citation ids on that section or module so the renderer can show a compact `Section sources` note. Any uncited claim-like text or numeric value may render with a visible `Needs source` marker and validation warning, so do not rely on the bottom source list alone.

For model-builder skills, also include `model_citations_path` when a workbook was generated. The path should point to a JSON ledger where each record maps a metric to `workbook_path`, `sheet`, `cell`/`range`, `value`, and optional `formula`. Cite those record ids directly in dashboard metrics whenever possible so the rendered number can open the workbook and show the exact cell/range in the hover preview.

## Adapter Guidance

Adapters should stay declarative. Avoid HTML strings. Prefer module definitions and data payloads.

Good adapter output:

```json
{
  "type": "covenant_grid",
  "title": "Covenant Headroom",
  "columns": ["Metric", "Base", "Downside", "Covenant", "Headroom"],
  "rows": [
    {
      "Metric": "Net leverage",
      "Base": {"text": "4.8x", "citation_ids": ["model-output:base-covenant-net-leverage-fy2026"]},
      "Downside": {"value": "5.6x", "source_id": "src_model"},
      "Covenant": {"value": "6.0x", "source_id": "src_credit_agreement"},
      "Headroom": "0.4x",
      "citation_ids": ["src_model"]
    }
  ]
}
```

Avoid adapter output like:

```json
{"html": "<div class='custom-card'>...</div>"}
```

## Rollout Order

1. `dashboard-builder` shared renderer and schema.
2. Optional print/PDF enhancements for retained renderer workflows.
