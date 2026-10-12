# Internal Support Policy

## Purpose

This file is the Investment Banking adapter layer for bundled support capabilities. Visible skills own banker transaction workflows and explicit client, board, committee, model, or circulation deliverables. Internal playbooks provide supporting execution without crowding the selectable skill catalogue.

## Internal Capability Registry

These capabilities are packaged with this plugin but are not registered `SKILL.md` entrypoints:

| Capability label | Internal playbook | Plugin-specific obligation |
| --- | --- | --- |
| `dashboard-builder` | `internal-support/dashboard-builder/INTERNAL.md` | Preserve banker-facing HTML hierarchy, circulation posture, and citation-readiness gates. |
| `financial-source-of-truth` | `internal-support/financial-source-of-truth/INTERNAL.md` | Preserve transaction source hierarchy, dated market facts, conflicts, and client/committee evidence posture. |
| `excel-data-cleaner` | `internal-support/excel-data-cleaner/INTERNAL.md` | Preserve transaction, source, period, unit, covenant, and model-import fields. |
| `style-guide-adapter` | `internal-support/style-guide-adapter/INTERNAL.md` | Apply client/firm precedent style without changing analysis, numbers, formulas, or citations. |
| `daloopa-provider-guide` | `internal-support/daloopa-provider-guide/INTERNAL.md` | Shape bounded, explicit-period Daloopa calls and preserve provider citations. |
| `quartr-provider-guide` | `internal-support/quartr-provider-guide/INTERNAL.md` | Shape bounded Quartr filing, document, event, and standardized-financial calls with provenance. |

`financials-normalizer` and `model-audit-tieout` remain visible in this release because financial spreading/model updates and model QA can be explicit banker jobs. `ib-deck-qc` and `scenario-sensitivity-generator` remain visible because final circulation review and transaction scenario work can be explicit banker deliverables.

## Routing Rule

After the invocation gate admits an Investment Banking request, the lead skill may load a matching internal playbook for its support workstreams. Existing routing metadata and documents may retain the capability labels above; resolve each label to its `INTERNAL.md` file rather than presenting it as a selectable skill.

For an explicit Investment Banking support-only request, such as cleaning a deal workbook, applying client style, checking evidence, or rendering an already-scoped HTML deliverable, the root router coordinates the work and loads the matching playbook while preserving artifact hierarchy, source gates, and circulation posture.

Provider guides are narrower: load one only after an ordinary workflow attempts a semantic source category, selects Quartr or Daloopa as the concrete route, and confirms that route is callable in the current runtime. Do not load provider guides during preflight, onboarding, broad setup, or merely because `.app.json` declares a dependency.

## Customization Boundary

This policy and the referenced internal playbooks are plugin-owned adapters. Customized plugin distributions may change client style, readiness, evidence, workbook, and dashboard requirements here. Reusable support engines must consume those Investment Banking obligations rather than replacing them with generic output rules.
