# Integration Guide

Use this skill as the investment banking deck orchestration layer. It should not duplicate specialized analysis when a dedicated skill exists.

## Table Of Contents

- [Shared core dependencies](#shared-core-dependencies)
- [Investment banking skill dependencies](#investment-banking-skill-dependencies)
- [Downstream outputs](#downstream-outputs)

## Shared core dependencies

Use specialized skills as upstream components when the deck needs their native analysis, then bring back only cited outputs, caveats, and handoff fields needed for the page plan. Do not recreate full model, diligence, buyer-list, credit, or valuation workflows inside the deck builder.

### financial-source-of-truth

Use when:

- source hierarchy is unclear;
- citations, stale-data checks, or conflict handling are requested;
- the deck will be circulated externally or to senior audiences.

Handoff expected:

- source register;
- freshness flags;
- fact/assumption labels;
- conflict resolution notes.

### financials-normalizer

Use when:

- source financials come from filings, PDFs, VDR exports, statements, CSVs, or messy spreadsheet extracts;
- the deck needs normalized revenue, EBITDA, cash flow, balance sheet, or KPI tables.

Handoff expected:

- normalized financials;
- period, currency, and scale;
- QA flags;
- source references.

### company-tearsheet

Use when:

- a baseline company, borrower, issuer, buyer, or fund profile is needed;
- a quick first page or company profile section is required.

Handoff expected:

- `entity_profile`;
- `one_line_business_description`;
- `business_model`, `sector`, `ownership_status`, `geography`;
- `key_products_or_segments` and `key_customers_or_end_markets`;
- `key_metrics` with period, unit, source, and confidence;
- `recent_developments`;
- `positioning_angle`, if source-backed or labeled as MD-review-needed;
- `risks_and_gaps`;
- `source_log`, `source_as_of_dates`, and `suggested_exhibits`.

Use the tearsheet as the factual profile spine. Do not convert unsupported positioning into banker conclusion language without a visible caveat.

If a `company-tearsheet` handoff is missing `positioning_angle`, draft the deck with a placeholder storyline and list the angle as an MD-review item. Carry `risks_and_gaps` into open items or diligence pages instead of hiding them.

### style-guide-adapter

Use after facts and storyline are stable and before final `ib-deck-qc`. If style output is structured, consume `style_profile_package` and `style_change_log_package` using `style_guide_adapter_style_profile` and `style_guide_adapter_change_log` from `../../../references/handoff-contracts.md`.

Do not let style changes obscure evidence gaps, assumptions, or source conflicts. Style provenance is not factual evidence.

### ib-deck-qc

Use as the final banker/client circulation review gate for investment banking output.

## Investment banking skill dependencies

### Valuation skills

Use for:

- football field;
- trading comps;
- precedent transactions;
- DCF/SOTP valuation ranges.

Use installed valuation skills such as `comps-valuation`, `dcf-model-builder`, and `scenario-sensitivity-generator`. Do not hand-build full valuation analysis inside this skill unless the user only asks for a high-level placeholder page.

### buyer-investor-list

Use for:

- buyer universe;
- investor/lender targeting;
- sponsor vs strategic segmentation;
- prioritization rationale.

### lbo-model-build

Use for:

- sponsor returns;
- acquisition financing;
- downside leverage/covenant cases;
- sponsor payability analysis.

### Financing and debt-capacity skills

Use for:

- financing pitch;
- debt capacity;
- pro forma leverage/coverage;
- market capacity vs model capacity.

Use installed skills such as `private-credit-underwriting`, `covenant-package-analyzer`, `lbo-model-build`, `capital-markets-issuance`, and `scenario-sensitivity-generator`.

### cim-teardown

Use for:

- diligence question pages;
- seller-claim validation;
- red flags;
- process preparation.

### distressed-recovery-waterfall

Use for restructuring decks, creditor materials, distressed alternatives, recovery pages, value-break analysis, fulcrum-security framing, or waterfall sensitivities.

Consume `distressed_recovery_waterfall_to_pitch_deck_builder` from `../../../references/handoff-contracts.md`. Keep legal-entitlement economics, negotiated plan economics, collateral/liquidation waterfalls, and enterprise-value waterfalls separate in the page plan.

## Downstream outputs

A deck plan can feed:

- a native PowerPoint/Slides generation tool;
- `style-guide-adapter` for client/firm style;
- `ib-deck-qc` for final review;
- `meeting-prep` for live-meeting prep;
- `memo-builder` for a parallel banker memo.

When a handoff expects the shared Investment Banking evidence taxonomy, add `canonical_evidence_category` from `../../../references/evidence-label-taxonomy.md` while preserving the deck plan's native evidence labels.

When handing a deck plan to `ib-deck-qc`, map it to `pitch_deck_builder_to_ib_deck_qc` in `../../../references/handoff-contracts.md`.
