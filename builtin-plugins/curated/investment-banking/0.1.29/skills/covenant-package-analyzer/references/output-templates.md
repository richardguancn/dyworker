# Output Templates

Use these templates to keep covenant analyses consistent and decision-ready.

## Table of Contents

- [Issue severity](#issue-severity)
- [Output posture labels](#output-posture-labels)
- [Standalone HTML covenant review memo](#standalone-html-covenant-review-memo)
- [Executive summary](#executive-summary)
- [Source base and scope](#source-base-and-scope)
- [Covenant package snapshot](#covenant-package-snapshot)
- [Financial covenant and headroom table](#financial-covenant-and-headroom-table)
- [EBITDA definition table](#ebitda-definition-table)
- [Basket and leakage map](#basket-and-leakage-map)
- [Negotiation flags](#negotiation-flags)
- [Open items and data requests](#open-items-and-data-requests)
- [Downstream handoff](#downstream-handoff)
- [Upstream structured imports](#upstream-structured-imports)

## Issue severity

| Severity | Meaning | Default action |
|---|---|---|
| Blocker | Cannot support the requested conclusion or lender protection appears materially compromised | Stop, request source, or escalate |
| High | Material credit leakage, covenant weakness, EBITDA inflation, collateral gap, or negotiation issue | Fix or negotiate before approval |
| Medium | Important caveat or flexibility that should affect underwriting, pricing, or documentation | Track and diligence |
| Low | Drafting, reporting, or housekeeping issue with limited decision impact | Note or clean up |
| Question | Provision may be intentional but requires deal-team or counsel confirmation | Ask targeted question |

## Output posture labels

End each covenant analysis with one posture label:

- `decision-grade`: full executed/draft document set reviewed, key definitions extracted, financial data supports headroom, and no blocker source gaps remain.
- `diligence-grade`: document review is useful, but financial headroom, basket usage, or source completeness needs confirmation.
- `screening-only`: based on term sheet, excerpts, public filings, or incomplete documents.
- `not-supportable`: material source conflicts or missing definitions prevent reliance.
- `blocked`: no usable document or financial basis for the requested analysis.

## Standalone HTML covenant review memo

Use this as the default reader-facing deliverable for document-first covenant package, amendment, or waiver reviews. Follow `../../../references/html-artifact-standard.md`; the memo is owned by `covenant-package-analyzer`, not packaged through `dashboard-builder`.

Recommended first-read sequence for amendment or waiver reviews:

1. Title, document scope, as-of date, and reliance posture.
2. Executive answer: what is covered, what remains at risk, and what is required before reliance.
3. Reliance gates: two to four unresolved questions whose answers change whether the banker can use a compliance or headroom conclusion.
4. Document universe and identification of the operative instrument.
5. Coverage map: amended or waived provisions, affected periods, deadlines, and explicit limitations.
6. What is not established: compliance, headroom, availability, basket capacity, or absence of non-waived defaults.
7. Covenant applicability and headroom gating table.
8. Residual-risk register and evidence/data request.
9. Source register and posture conclusion.

Design and evidence rules:

- Use a restrained document layout with a concise opening conclusion and compact tables, not metric-card dashboards or control bars.
- Put the operative instrument ahead of summary filings where terms differ or completeness matters.
- Pull the few controlling reliance questions forward before the detailed deadline and headroom mechanics; keep dense tables as substantiation, not as the first place the reader finds the conclusion.
- In visible memo labels, translate internal evidence codes into reader language such as `Executed amendment`, `SEC filing`, `Company disclosure`, `Analyst inference`, or `Not yet supported`; preserve exact codes in structured support or handoffs only.
- Use a clear `Not computed` or `Not supportable` treatment when required covenant inputs are absent.
- When HTML is selected or defaulted, write and deliver the HTML file; do not substitute a complete inline Markdown memo for the artifact.
- Do not add dashboard navigation, default copy/export buttons, renderer JSON, or manifest links.
- Render and visually inspect the opening view plus at least one headroom/reliance section through local headless-browser screenshots before delivery.

## Executive summary

```markdown
## Executive Summary
- Recommendation: [proceed / proceed with changes / defer pending documents / reject]
- Output posture: [decision-grade / diligence-grade / screening-only / not-supportable / blocked]
- Top covenant issue: [one sentence]
- Headroom issue: [one sentence]
- EBITDA definition issue: [one sentence]
- Leakage issue: [one sentence]
- Required next step: [exact document, model, or negotiation ask]
```

## Source base and scope

| Source ID | Document | Type | Date | Status | Source tier | Coverage / notes |
|---|---|---|---|---|---|---|
| S001 | Credit Agreement | executed agreement | YYYY-MM-DD | operative / superseded / draft | connector / SEC / user file | includes covenants, schedules missing |

## Covenant package snapshot

| Area | Key terms | Initial read | Risk |
|---|---|---|---|
| Facilities | [revolver, TLB, notes] | [maturity, pricing, collateral] | [low/med/high] |
| Financial covenants | [max leverage, FCCR, min liquidity] | [frequency, thresholds] | [low/med/high] |
| EBITDA definition | [starting point, add-backs, caps] | [borrower flexibility] | [low/med/high] |
| Debt / lien flexibility | [incremental, ratio debt, liens] | [priming risk] | [low/med/high] |
| Leakage | [RPs, investments, unrestricted subs] | [value movement paths] | [low/med/high] |
| Reporting / defaults | [certificates, notices, EODs] | [monitoring strength] | [low/med/high] |

## Financial covenant and headroom table

| Covenant | Test date | Definition basis | Threshold | Actual | Headroom | Cushion % | Status | Source / notes |
|---|---|---|---:|---:|---:|---:|---|---|
| Max total leverage | Q4-2026 | Total Debt / Covenant EBITDA | 5.50x | 5.10x | 0.40x | 7.3% | pass | covenant certificate |

## EBITDA definition table

| Item | Treatment | Cap / conditions | Risk | QoE / lender view impact | Ask |
|---|---|---|---|---|---|
| Run-rate cost savings | add-back permitted | [cap, time limit] | [risk] | [impact] | [negotiation ask] |

## Basket and leakage map

| Covenant | Basket / permission | Capacity | Conditions | Reclassification / stacking | Leakage path | Severity | Ask |
|---|---|---:|---|---|---|---|---|
| Investments | General basket | $X / grower | no default | reclassification permitted | value to non-guarantor | High | cap and restrict non-loan-party use |

## Negotiation flags

| # | Severity | Provision | Issue | Why it matters | Proposed ask | Fallback | Owner |
|---|---|---|---|---|---|---|---|
| 1 | High | Consolidated EBITDA | uncapped synergies | inflates debt capacity | add 20% cap and action-taken requirement | cap only run-rate savings | credit / counsel |

## Open items and data requests

| Priority | Needed item | Why it matters | Affected conclusion | Minimum substitute |
|---|---|---|---|---|
| 1 | Latest covenant certificate | confirms actual ratio and basket usage | headroom | management covenant model |

## Downstream handoff

```markdown
### Downstream Handoff
- To `financials-normalizer`: [EBITDA definition concerns and add-back support required]
- To `private-credit-underwriting`: [credit decision flags, lender protections, approval conditions]
- To `lbo-model-build`: [thresholds, debt terms, covenant test periods, first-breach stress inputs]
- To `three-statement-model-builder`: [forecast / liquidity / covenant model needs]
- To `model-audit-tieout`: [workbook or covenant calculator QA needs]
- To `ib-deck-qc`: [headline metrics and caveats that must travel with final materials]
```

## Upstream structured imports

When available, consume exact field names from `../../../references/handoff-contracts.md`:

- `capital_markets_issuance_to_covenant_package_analyzer`
- `private_credit_underwriting_to_covenant_package_analyzer`

Treat `covenant_capacity_assumption`, `covenant_ebitda_proxy`, and `headroom_or_proxy_headroom` as items to test against documents and financials, not as final covenant conclusions.

## Sign-off language

Use one:
- `decision-grade in reviewed scope, subject to counsel review of legal enforceability and any missing schedules noted above.`
- `diligence-grade: document terms are mapped, but headroom and basket capacity require the missing financial data listed above.`
- `screening-only: based on term sheet / public summary / excerpts rather than full operative documents.`
- `not supportable: the requested conclusion depends on missing operative definitions or conflicting documents.`
