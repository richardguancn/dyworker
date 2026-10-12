# Integration Guide

## Position in the shared-core stack
`company-tearsheet` is a baseline profile and initial coverage-screen skill. It should be source-backed, complete enough to support the user's workflow, and disciplined about not duplicating deeper workflows. When HTML is selected, it creates a polished standalone banker tearsheet under `../../../references/html-artifact-standard.md`; it does not require a dashboard render contract.

Recommended order:
1. `financial-source-of-truth` for source routing and evidence hierarchy.
2. `financials-normalizer` or `excel-data-cleaner` if the underlying data is messy.
3. `company-tearsheet` to create the baseline profile.
4. Downstream role skill for analysis, modeling, memo, deck, or meeting prep.
5. `ib-deck-qc` or `model-audit-tieout` for final QA where relevant.

## Handoff rules

### To Investment Banking
- `pitch-deck-builder`: use the tearsheet as company profile, overview, or situation summary. Export `entity_profile`, `one_line_business_description`, `business_model`, `sector`, `ownership_status`, `key_products_or_segments`, `key_customers_or_end_markets`, `geography`, `key_metrics`, `recent_developments`, `positioning_angle`, `risks_and_gaps`, `source_log`, `source_as_of_dates`, `confidence`, and `suggested_exhibits`.
- `pitch-deck-builder` should use this package as the factual profile spine and should not embellish unsupported positioning claims. If `positioning_angle` is missing, the deck should use a placeholder storyline and list it as an MD-review item.
- `buyer-investor-list`: use sector, ownership, scale, geography, and strategy fields as matching criteria.
- `cim-builder`: use as the starting company overview, but expand with management narrative and full financials.
- `comps-valuation`, or `dcf-model-builder`: hand off only after key financial metrics are source-backed and normalized.
- `cim-teardown`: if the source is a CIM/management deck and claims need scrutiny, route there.
- `memo-builder`: use the tearsheet as source-backed company context. Export the canonical `company_tearsheet_to_memo_builder` fields from `../../../references/handoff-contracts.md`: `entity_profile`, `one_line_business_description`, `business_model`, `sector`, `ownership_status`, `key_metrics`, `recent_developments`, `source_as_of_dates`, `fact_vs_assumption_labels`, `risks_and_gaps`, `open_questions`, `recommended_next_step`, and `circulation_caveats`.
- `memo-builder` should treat the tearsheet as source-backed context only; it must add transaction judgment, decision framing, and evidence caveats instead of treating the profile as a complete memo.
- To create the memo-builder payload from native tearsheet JSON, run `../scripts/map_tearsheet_to_memo_handoff.py <input_json> <output_json>` from this reference file's directory context, or `scripts/map_tearsheet_to_memo_handoff.py <input_json> <output_json>` from the skill root.
- For automated memo handoffs, validate the payload with `../../../scripts/validate_handoff_payload.py company_tearsheet_to_memo_builder <payload.json>`.

### To IB credit / financing
- `private-credit-underwriting`: use borrower profile as the front page of the credit case.
- `covenant-package-analyzer`: use borrower, issuer, guarantor, debt, and source fields to frame covenant review.
- `capital-markets-issuance`: use issuer profile fields to frame financing market, investor targeting, and use-of-proceeds analysis.
- `distressed-recovery-waterfall`: use issuer, obligor, debt, and source fields to start a restructuring or recovery analysis.

### To Corporate Finance / FP&A
- Use for business-unit, vendor, customer, partner, competitor, or internal reporting profiles.
- Route to FP&A skills for variance, budget, forecast, headcount, MBR, and scenario workflows.

## Boundary rules
- If the user asks "is this a good investment?", do not answer from the tearsheet alone; route to the relevant investing skill.
- If the user asks for a full credit memo, route to `private-credit-underwriting` or `memo-builder`.
- If the user asks for a full model, route to model-building skills after profile creation.
- If the user asks for a meeting brief, use `meeting-prep` after the profile.
- If source financials are unstructured or inconsistent, normalize before using them.
