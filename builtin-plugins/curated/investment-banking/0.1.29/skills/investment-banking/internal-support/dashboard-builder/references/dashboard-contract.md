# Dashboard Builder Render Contract

The internal render contract is the handoff between an analytical Investment Banking skill and `dashboard-builder`.

The contract may be JSON for structure, but it is not the user-facing deliverable. The renderer turns it into `report.html` or `dashboard.html`.

## Top-Level Fields

Required for good output:

- `dashboard_title`: Reader-facing title.
- `entity`: Company, asset, borrower, target, or process name.
- `skill`: Source skill slug.
- `deliverable.render_mode`: `dashboard`, `report_only`, or `hybrid`.
- `hero`: Optional reader-facing hero override with `eyebrow`, `headline`, `dek`, `callout_label`, and `callout`.
- `issuer`: Optional identity tile data with `ticker`, `name`, `accent_color`, and `identity_color`.
- `snapshot`: Optional highlight tiles with `label`, `value`, `detail`, `status`, and inline citation fields.
- `deliverable.primary_artifact`: Optional model/deck/workbook path used as a short link only.
- `deliverable.hero_callout`: Backward-compatible headline, answer, confidence, and next action fields.
- `sources` or `citations`: Source objects with `id`, `name`/`title`, `url`, `date`/`as_of`, `type`, `quality`, and `notes`.
- Inline citation fields on hero callouts, snapshot tiles, metrics, report paragraphs, bullets, table rows/cells, modules, and notes. Accepted aliases are `citations`, `citation_ids`, `citation`, `source_id`, and `source_ids`; bracket markers like `$15.0B [S1]` are supported inside strings.
- External-only fallback fields on any value/row/module: `source_url`, `source_title`, `as_of`/`date`, and `excerpt`/`pinpoint`/`note`.
- `model_citations` or `workbook_citations`: Optional workbook cell/range records with `id`, `workbook_path`, `sheet`, `cell` or `range`, `value`, optional `formula`, and aliases.
- `model_citations_path` or `workbook_citations_path`: Optional JSON path to the same records. Relative paths resolve from the dashboard contract file.

Use inline citations wherever claims or numbers need source support. The renderer turns cited numbers into quiet links on the number itself, and uses small citation chips for non-numeric claims. Hover/focus previews show title, type/status, date/as-of, pinpoint/excerpt, and workbook cell/range metadata when available. If claim-like text or a numeric value has no explicit or inferred source, the renderer adds a visible `Needs source` marker and validation warns so the gap can be fixed upstream. Use `report_body` for text-heavy output; the renderer groups each report entry as a subsection inside one copyable Analysis module. Use `sections` for dashboard modules. Use both for hybrid workbook-plus-report or dashboard-plus-report packages.

## Report-Only Body

```json
{
  "deliverable": {"render_mode": "report_only", "primary_artifact": "report.html"},
  "hero": {
    "headline": "ExampleCo IC Memo",
    "dek": "Decision read, valuation support, diligence gaps, and next action.",
    "callout_label": "Core Question",
    "callout": "Should the sponsor proceed to confirmatory diligence?",
    "citation_ids": ["src1"]
  },
  "sources": [
    {"id": "src1", "name": "Management presentation", "date": "2026-05-16", "quality": "company_provided"}
  ],
  "model_citations": [
    {
      "id": "model-output:base-returns-irr-fy2030",
      "title": "Base IRR",
      "workbook_path": "ExampleCo_LBO_Model.xlsx",
      "sheet": "Model",
      "range": "I332",
      "value": "20.2%",
      "type": "model_cell",
      "quality": "model_output",
      "aliases": ["base irr", "irr", "20.2%"]
    }
  ],
  "report_body": [
    {
      "id": "summary",
      "title": "Executive Summary",
      "body": [
        {"text": "Paragraph one with a non-numeric claim.", "citation_ids": ["src1"]},
        {"text": "Base IRR is 20.2% [model-output:base-returns-irr-fy2030]."}
      ],
      "tables": []
    }
  ]
}
```

## Citation Discipline

Source skills should cite at the smallest practical grain:

- Put citation fields directly on numeric metrics and snapshot values. The rendered number should be the link: `{"value": "$15.0B", "citations": ["S1"]}`.
- Use bracket markers inside strings when that is the least invasive handoff: `"Base IRR is 20.2% [model-output:base-returns-irr-fy2030]"`.
- Put row-level citations on tables when every cell comes from the same source, and cell-level citations when sources differ: `{"Metric": "Revenue", "Value": {"value": "$15.0B", "source_id": "S1"}, "Read": "Updated bar"}`.
- Put paragraph/bullet-level citations on narrative claims. If a paragraph blends model output and public-source claims, either split the paragraph or cite both source ids.
- Put repeated section/card citations on the report section or module when a whole subsection uses the same source set. The renderer will show a compact `Section sources` note.
- Use external-only fallback fields when the source should open directly rather than jump to the ledger: `{"value": "June 30, 2026", "source_url": "https://example.com", "source_title": "Closing calendar", "as_of": "2026-05-17", "excerpt": "Calendar entry."}`.
- For generated workbooks, cite the workbook cell/range record, not only the parent workbook. Use ids from `model_citations.json` where available, such as `model-output:base-returns-irr-fy2030`.
- Add every cited id to `sources` or `citations` with a stable `id`, reader-friendly title, date/as-of, quality/type, and `url` when available.
- Treat missing evidence as a gap or diligence request. Do not present a sourced-looking number and rely on the bottom source register alone.

## Blocked Output Context

When a requested artifact is partial or blocked, include:

- `blocked`
- `blocking_reasons`
- `missing_inputs`
- `output_contract_expected`
- `what_was_generated_anyway`
- `how_to_unblock`
- `source_requests`

This context renders as open diligence items beneath the report, so the user does not need to read a raw JSON contract.

## Supporting Artifacts

Use `supporting_outputs` for short related-file links. The visible label should stay short, such as `Open workbook`, while the full local path stays in `href`.

```json
{
  "name": "claims_ledger.csv",
  "type": "CSV",
  "role": "Backing diligence ledger",
  "visibility": "supporting",
  "explanation": "Used to audit seller claims and feed workplan import.",
  "contains_new_analysis": "No; it structures evidence behind the HTML report."
}
```

## Legacy Dashboard Sections

The existing module-based `sections` contract remains supported for dashboards and hybrid layouts. Modules use a responsive grid by default; set `layout` to `wide` or `full` only when a module truly needs the full row.
