# Integration guide

This skill is a shared-core feeder for other financial services and corporate finance skills. It should create reliable inputs, not complete the downstream analysis itself.

## Shared core handoffs

- `financial-source-of-truth`: use for enterprise-wide evidence policy, source access, conflict policy, and citation discipline. `financials-normalizer` applies those rules to financial statement and KPI data.
- `excel-data-cleaner`: use first when spreadsheet structure blocks extraction. Examples: merged headers, multiple tables per tab, blank rows, malformed dates, export artifacts, or broken table shapes.
- `model-audit-tieout`: use after normalized data is placed into a workbook/model to audit formulas, links, hardcodes, checks, and sign conventions.
- `scenario-sensitivity-generator`: use after a base case exists to build downside/upside cases, sensitivities, breakevens, and stress tests.
- `memo-builder`: use after normalized tables and QA findings are complete to generate decision narratives.
- `ib-deck-qc`: use after normalized outputs are inserted into IB decks or client materials.
- `style-guide-adapter`: use after content is correct to match firm/client formatting and language.

For all handoffs, preserve the normalizer-native `evidence_label` and add `canonical_evidence_category` using `evidence-label-crosswalk.md`. The canonical target is the shared taxonomy at `../../../references/evidence-label-taxonomy.md` when available. Do not replace native labels such as `fact_source_reported` or `management_adjusted`; downstream skills need the canonical category for compatibility and the native label for normalization nuance.

## Investment banking

Use normalized outputs for `comps-valuation`, `dcf-model-builder`, `pitch-deck-builder`, `cim-builder`, `lbo-model-build`, `private-credit-underwriting`, `covenant-package-analyzer`, and `cim-teardown`.

Recommended extra fields: buyer/seller process source, management-adjusted EBITDA, net debt, share count, segment revenue/profit, NWC, capex, D&A, one-time items, and source pages from CIM/VDR/deck.

## IB credit, financing, and restructuring

Use normalized outputs for `private-credit-underwriting`, `covenant-package-analyzer`, `capital-markets-issuance`, `distressed-recovery-waterfall`, and `scenario-sensitivity-generator`.

Recommended extra fields: management vs audited status, source support for EBITDA adjustments, debt schedule, covenant inputs, liquidity, collateral fields, maturity schedule, working-capital support, add-back evidence, and financing assumptions.

## FP&A / corporate finance

Use normalized outputs for forecast roll-up QA, variance explainer, MBR/board packs, revenue driver models, headcount planning, cash forecasting, close-to-FP&A handoff, and accounting reconciliations.

Recommended extra fields: ERP/GL export timestamp, planning version, close status, cost center, department, legal entity, product, region, scenario/version, and owner.

## When not to hand off

Do not hand off as ready when there are blocker flags for missing periods, missing source refs, unresolved source conflicts, unknown currency/scale, material tie-out breaks, or unknown actual/forecast status. Hand off as partial only with explicit limitations.
