# Investment Banking Skill Integrations

## Role of financial-source-of-truth

Use this skill as a pre-flight and final QA layer for the Investment Banking skill stack. It controls source hierarchy, citations, freshness, conflicts, and evidence labels; it does not replace the domain skill that builds the model, memo, deck, or underwriting output.

## Integration map

| Other skill | How this skill should support it |
|---|---|
| cim-teardown | Treat seller statements as claims; build claims ledger, evidence asks, kill criteria support, and diligence gap list. |
| comps-valuation | Check peer evidence, market-data timestamp, EV bridge support, multiple definitions, outlier treatment, and source caveats. |
| comps-valuation | Require workbook source notes, calculation provenance, date stamps, peer rationale, and QA flags. |
| dcf-model-builder | Separate sourced facts from forecast assumptions; flag unsupported WACC, terminal growth, margin, capex, and working-capital assumptions. |
| merger-model-builder | Map signed/filed/audited, management-case, consensus, financing-commitment, estimate, placeholder, and unsupported labels to the shared taxonomy before calling a model decision-grade. |
| scenario-sensitivity-generator | Separate verified catalyst and market facts from second-order inferences; preserve source posture across downside, financing, covenant, merger, and returns scenarios. |
| memo-builder | Add evidence posture, source inventory, assumption register, conflict register, and open diligence items. |
| lbo-model-build | Label management forecast, diligence-adjusted forecast, financing assumptions, covenant terms, and exit assumptions distinctly. |
| financials-normalizer | Use the shared crosswalk for `fact_source_reported`, provider-standardized, derived, adjusted, assumption, consensus-estimate, and missing-source labels. |
| pitch-deck-builder | Use the shared crosswalk for fact, source/model-derived estimate, banker judgment, client/external assumption, placeholder, supported, and needs-source labels. |
| three-statement-model-builder | Tie source notes to forecast drivers, historical periods, debt schedules, working capital, capex, and controls. |
| private-credit-underwriting | Prioritize executed docs, compliance certificates, QoE, collateral schedules, borrowing base support, and covenant definitions. |
| ib-deck-qc | Check that citations, footnotes, units, dates, and repeated metrics support the exact investment-banking deck narrative. |

## Handoff rules

- Preserve the producing skill's native labels when they are part of a schema, workbook, or validator.
- Add the canonical category from `../../../../../../../references/evidence-label-taxonomy.md` for cross-skill review.
- Carry source IDs, as-of dates, freshness status, conflict status, confidence, and treatment into downstream model, memo, deck, or underwriting work when available.
- If the evidence issue blocks a decision, make it a visible caveat, sensitivity, or diligence ask before handoff.
