# Dashboard Operational Controls Policy

Investment Banking HTML reports and dashboards must be usable in live banker workflows, not only visually polished. The dashboard-builder renderer should make the first human artifact obvious, keep support artifacts secondary, and provide fast controls for copying, exporting, printing, and opening linked workpapers.

## Required Controls

All rendered HTML reports and dashboards should include:

- Copy Full Report for the reader-facing report body.
- Print / Save PDF through the browser print flow.
- Open the primary workbook, model, deck, document, or companion human artifact when one exists and is not the current HTML page.

Every visible table should include:

- Copy TSV for pasting into Excel, PowerPoint tables, email, and diligence trackers.
- Download CSV generated client-side from the visible table.

## Artifact Hierarchy

Hero actions may point to workbooks, models, native decks, native documents, generated folders, or companion HTML files. They must not point to JSON, CSV, Markdown, logs, manifests, handoff payloads, or files under support/logs/handoffs/debug folders unless the user explicitly requested a machine-readable deliverable.

Support artifacts can still appear in the related files section, but the visible language should describe them as backup, audit, import, or handoff material. They should not be styled as the primary action.

## Contract Fields

Source skills should populate these fields when available:

- `deliverable.primary_artifact`
- `deliverable.primary_artifact_type`
- `deliverable.hero_actions`
- `deliverable.executive_summary`
- `deliverable.utility_controls`
- table-level `table_id`, `download_filename`, and `exportable`

If `exportable` is omitted, visible tables are exportable by default. Set `exportable: false` only for tables that contain layout-only content or controls that should not be exported.

## Print Behavior

Print and PDF output should hide interactive controls while preserving the title, readiness posture, executive summary, sources, assumptions, diligence gaps, and related human artifact links.
