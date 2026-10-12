# Profile Templates

## Profile Classification

Select the closest banker-facing profile type and the downstream use case:

- `public_company` or `public_issuer`: public coverage, ECM, strategic alternatives, public M&A, or financing context.
- `private_target` or `portfolio_company`: sell-side, sponsor, acquisition, buyer-screen, or diligence context.
- `borrower` or `financing_issuer`: LevFin, private credit, DCM, refinancing, or covenant context.
- `counterparty` or `client_profile`: meeting, relationship, origination, or strategic-dialogue context.
- `business_unit`: only where a separations, carve-out, divestiture, or transaction mandate makes the unit directly relevant.
- `fund_manager_relationship`: only where the sponsor/fund relationship is directly relevant to an Investment Banking mandate.

Then select the output mode:

- `baseline_tearsheet`: source-backed factual profile and next analytical route.
- `coverage_screen`: baseline plus a mandate-specific banker angle and a consolidated priority-questions table.
- `structured_handoff`: support data for another owning skill.

## Authoring Workflow

1. Classify profile type, mode, mandate, audience, and downstream workflow.
2. Build the source inventory using `source-and-evidence.md`.
3. Extract only mandate-relevant and source-supported facts.
4. Select metrics from `metric-library.md` that answer the banker question.
5. When HTML is requested or selected, create a polished standalone HTML banker tearsheet following `../../../references/html-artifact-standard.md`.
6. Run `quality-checks.md` before delivery or handoff.

## Profile-Critical Facts

Use only fields that are relevant and source-supported:

- Identity and business: legal/common name, listing or ownership, parent/sponsor when relevant, geography, leadership, business description, segments, customers or end markets.
- Financial snapshot: latest revenue, EBITDA/operating income, margin, cash flow, cash, debt, leverage, liquidity, market capitalization or enterprise value only when appropriately sourced and current enough for the use.
- Operating drivers: volume, pricing, backlog, ARR, retention, capacity, utilization, stores, subscribers, production, customer concentration, or other sector KPIs.
- Banking relevance: transaction history, capital structure, maturities, financing need, ownership/process context, strategic alternatives, management objective when sourced, and relationship context when provided.
- Risks and evidence gaps: source limitations, stale inputs, conflicts, missing diligence, and facts that must be refreshed before circulation.

## Standalone HTML Baseline Tearsheet

Use `baseline_tearsheet` for an ordinary factual profile or when the profile is upstream context for a richer workflow. Keep the report complete but disciplined.

Recommended first-read sequence:

1. Mandate context and entity identity, including as-of date and source posture.
2. Banker read: one concise sourced statement explaining why the entity matters for the stated workflow.
3. Four or five high-signal metrics chosen for that workflow.
4. Business and operating profile, using one concise table or a small number of compact objects.
5. Transaction, financing, strategic, or meeting relevance only to the degree required by the prompt.
6. Material risks and evidence gaps.
7. Recommended downstream route and concise source notes.

Do not turn a baseline tearsheet into a pitch workplan, broad diligence request list, full valuation case, or transaction recommendation merely because HTML offers space.

## Standalone HTML Coverage Screen

Use `coverage_screen` only where the prompt or resolved intake indicates initial coverage, pitch preparation, M&A dialogue, financing opportunity, strategic alternatives, or another actionable banker screen.

Recommended first-read sequence:

1. Coverage read: the preliminary mandate-relevant angle and its evidence status.
2. Four or five sourced metrics that establish scale, capacity, exposure, or opportunity.
3. Business and financial profile focused on the potential mandate.
4. Selected transaction, financing, or strategic history that changes the coverage discussion.
5. Preliminary banker angle, clearly labeled as interpretation rather than a mandate or recommendation.
6. One consolidated `Questions To Resolve Before A Pitch` or equivalent action table.
7. Recommended working-team next step and material source gaps.

Do not include a second open-diligence register repeating the priority-questions table. Keep support JSON, manifests, and other generation records out of the reader-facing body unless requested.

## Profile-Specific Emphasis

### Public Company / Public Issuer

Prioritize ticker/exchange, fiscal year-end, operating drivers, current capital structure, relevant valuation context, transaction or financing history, and market inputs only where they are refreshed and appropriate for the intended use.

Use when feeding `comps-valuation`, `dcf-model-builder`, `capital-markets-issuance`, `merger-model-builder`, `memo-builder`, or `pitch-deck-builder`.

### Private Company / Deal Target

Prioritize ownership/sponsor status, business model, customers/end markets, scale, KPI trends, management or seller claims, transaction context, valuation ask if supplied, and focused diligence gaps.

Use when feeding `cim-teardown`, `cim-builder`, `memo-builder`, `lbo-model-build`, `buyer-investor-list`, or `pitch-deck-builder`.

### Borrower / Financing Issuer

Prioritize borrower and parent/guarantor context, use of proceeds, debt stack, liquidity, leverage, maturity profile, coverage, covenant headroom where available, financing alternatives, and missing credit documents.

Use when feeding `private-credit-underwriting`, `capital-markets-issuance`, `covenant-package-analyzer`, `scenario-sensitivity-generator`, or `distressed-recovery-waterfall`.

### Counterparty / Client Profile

Prioritize entity identity, strategic context, relationship information only when supplied, recent developments, potential discussion topics, missing internal intelligence, and meeting relevance.

Use when feeding `meeting-prep`, `memo-builder`, or `pitch-deck-builder`.

## Headline Metric Selection

Choose metrics that advance the requested banking discussion. For example:

| Workflow | Useful headline metrics |
|---|---|
| M&A coverage screen | scale, margin, organic versus acquired growth, leverage/capacity, mandate-relevant exposure |
| ECM / public issuer | scale, growth/margin, current market value only when refreshed, capital structure, issuance consideration |
| Borrower / refinancing | EBITDA/cash flow, total debt, net leverage, liquidity, maturity or covenant headroom |
| Private target / sell-side | revenue, EBITDA, growth, recurring revenue or customer metric, ownership/process fact |

A stale share-price-derived enterprise value is supporting context rather than a headline tile unless valuation is central, its date is unmistakable, and the reader is explicitly warned that refresh is required.

## Structured JSON Handoff

Use structured JSON only when another skill or automation needs source-backed profile context. The expected shape includes:

```json
{
  "entity": "ExampleCo",
  "profile_type": "public_company | public_issuer | private_target | borrower | financing_issuer | counterparty | business_unit | fund_manager_relationship",
  "as_of_date": "YYYY-MM-DD",
  "scope": "requested use case, periods, and source scope",
  "source_caveat": "latest | limited | stale | partial | source package only",
  "sources": [],
  "metrics": [],
  "sections": {
    "one_line_view": "string",
    "business_snapshot": [],
    "recent_developments": [],
    "workflow_relevance": [],
    "risks_gaps_flags": [],
    "recommended_next_step": "string"
  },
  "data_quality_flags": [],
  "recommended_next_step": "string"
}
```

Validate structured JSON with `../scripts/validate_tearsheet_json.py`. Use `../scripts/build_tearsheet_markdown.py` only for an explicit Markdown request or legacy downstream tooling; it is not the path for producing standalone HTML.

## User-Facing Response Pattern

When returning in chat rather than HTML, preserve the selected mode and include:

1. Tearsheet scope: entity, profile type, use case, sources, and as-of date.
2. Banker read: key source-backed implications with interpretations marked.
3. Metric table: only decision-useful metrics with period, units, source, and confidence.
4. Material risks/gaps: stale data, conflicts, missing facts, and required diligence.
5. Recommended next analytical route or handoff.
