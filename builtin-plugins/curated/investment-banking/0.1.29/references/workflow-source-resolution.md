# Workflow Source Resolution

Use this reference during ordinary Investment Banking workflows after the router or focused skill identifies the source categories needed for the task. The cross-skill runtime contract in `skills/investment-banking/SKILL.md` owns dependency resolution and category-to-app mapping. Explicit saved source setup remains owned by `skills/user-context/references/source-category-runtime.md`.

Resolve only the categories needed for the current workflow. Prefer a user-named source first, then one available app, connector, file, export, or pasted input whose `.app.json` `category` or `categories` value satisfies the attempted category. Treat saved setup confirmations as optional hints, not as required preconditions. Attempt the smallest useful native read only when the workflow needs that source. If a route needs authentication, connection, entitlement, or setup, state the practical limitation and continue from prompt context, active artifacts, pasted or exported material, and public sources when the workflow can still be useful. Do not inspect unrelated categories, run broad source setup, write connector readiness, or create, read, migrate, or update `category-state.json`.

Treat named providers, data rooms, internal systems, calendars, email, messaging, and document stores as callable only when the runtime exposes a scoped route. Otherwise request a user-provided export or use a clearly labeled fallback. A configured `.app.json` entry is not proof of availability or entitlement.

## Provider Guides

Load a provider guide only after the current workflow attempts a category, selects that provider as its concrete route, and confirms the scoped route is callable. Do not load provider guides merely because `.app.json` declares the dependency or the static category catalog names a preferred provider.

- If the selected callable route is Daloopa, load `skills/investment-banking/internal-support/daloopa-provider-guide/INTERNAL.md`.
- If the selected callable route is Quartr, load `skills/investment-banking/internal-support/quartr-provider-guide/INTERNAL.md`.

## Categories

- `deal_materials`: deal documents, VDR exports, diligence sources, and management materials.
- `process_updates`: trackers, notes, messages, and status updates.
- `relationship_counterparty_context`: relationship, sponsor, buyer, lender, investor, and counterparty context.
- `market_data_public_sources`: filings, ratings, market data, provider exports, public sources, and transaction benchmarks.
- `models_workbooks_templates`: models, workbook extracts, templates, and spreadsheet inputs.
