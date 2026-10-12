# Source And Evidence Reference

Use this reference when deciding what evidence can support private credit underwriting conclusions.

## Table Of Contents

- [Source Routing Order](#source-routing-order)
- [Evidence Hierarchy By Claim Type](#evidence-hierarchy-by-claim-type)
- [Credit-Specific Evidence Labels](#credit-specific-evidence-labels)
- [Freshness Rules](#freshness-rules)
- [Source Conflict Handling](#source-conflict-handling)
- [Public-Source Fallback Rules](#public-source-fallback-rules)
- [Ask-For-More Protocol](#ask-for-more-protocol)

## Source Routing Order

Use the best available source before asking the user for more.

1. User-provided attachments and current conversation context.
2. Callable connected routes or user-provided exports, including drive folders, data rooms, internal docs, email, CRM, research systems, market-data connectors, and prior model outputs.
3. Transaction source documents: CIM, lender presentation, VDR files, QoE report, trial balance, general ledger, management accounts, customer schedules, AR/AP/inventory aging, debt agreements, borrowing-base certificates, collateral reports, appraisals, insurance, legal / tax diligence, and sponsor materials.
4. Public primary or near-primary sources when borrower or sponsor is public or when market context is needed: regulator filings, official exchange announcements, company press releases, IR pages, earnings releases, presentations, transcripts, rating-agency releases, court filings, and official macro / lending data.
5. Reputable secondary sources for context only: reliable news, industry research, or broker commentary. Do not use these as controlling evidence for borrower financials.

Do not begin with a broad data request. Ask for more only when the missing item materially changes the recommendation, covenant / liquidity conclusion, or downside loss view.

## Evidence Hierarchy By Claim Type

| Claim type | Highest support | Lower support | Do not rely on |
|---|---|---|---|
| historical revenue / EBITDA | audited/reviewed financials, trial balance, GL, management accounts tied to source | CIM, lender presentation, public filing | unsourced narrative |
| adjusted / normalized EBITDA | QoE schedule with support, GL population, documented adjustments | management bridge, banker add-back schedule | naked add-back list |
| lender EBITDA | credit agreement definition plus supported adjustment schedule | lender-view proxy with haircut logic | management adjusted EBITDA alone |
| cash / liquidity | bank statements, cash reports, revolver availability, borrowing-base certificate | management liquidity schedule | stale cash balance in CIM |
| debt and interest | executed credit agreement, debt schedule, lender statement | management debt schedule | verbal summary |
| collateral | appraisals, AR/AP/inventory aging, field exam, lien search, borrowing-base certificate | management collateral schedule | generic asset description |
| sponsor support | executed equity commitment, support agreement, prior funded support | sponsor letter / reputation | informal willingness statement |
| covenant headroom | governing agreement definition and model calculation | term sheet proxy | undefined covenant term |
| market / industry context | official data, filings, rating releases, market-data connectors | reputable research / news | unattributed market chatter |

## Credit-Specific Evidence Labels

Apply labels from `financial-source-of-truth` to material claims:

- `fact_primary`: primary, source-supported fact.
- `fact_secondary`: reliable secondary or provider-sourced fact.
- `management_claim`: provided by borrower / management and not independently verified.
- `seller_claim`: seller, banker, CIM, or teaser claim.
- `third_party_estimate`: ratings, consensus, market-data estimate, appraiser view, or third-party research.
- `internal_estimate`: analyst-created estimate based on available evidence.
- `assumption`: needed input not directly sourced.
- `inference`: reasoned conclusion from evidence.
- `opinion`: qualitative judgment.
- `unsupported`: claim lacks sufficient support.

Credit-specific mapping:

- Audited or reviewed historical borrower financials are `fact_primary` once tied to source.
- Public filings are `fact_primary` for disclosed facts, but not a private-company ledger tie-out.
- Bank statements, collateral reports, appraisals, borrowing-base certificates, and executed debt documents are high-priority primary support when authentic and current.
- Management forecasts, budgets, lender presentations, and sponsor cases are `management_claim` until stress-tested.
- Sponsor equity support or future cost savings are `assumption` unless legally committed or already executed.
- CIM add-backs are `seller_claim` until supported through QoE or source evidence.
- Market spreads, comps, or rating commentary are `third_party_estimate` or context, not borrower facts.

### Reader-Facing Presentation

Keep the formal evidence taxonomy for analytical control, handoffs, and audit support. In a polished reader-facing memo, do not scatter raw labels such as `fact_primary`, `management_claim`, `internal_estimate`, or `opinion` as pills through the narrative and core tables. Translate them into normal lender language:

| Internal label | Reader-facing wording example |
|---|---|
| `fact_primary` | SEC-reported; executed agreement; filed exhibit |
| `management_claim` | management forecast; management representation; not independently verified |
| `internal_estimate` | analyst calculation from disclosed inputs |
| `assumption` | illustrative assumption; requires confirmation |
| `unsupported` | not provided; conclusion not supportable |

Formal labels may remain in the source/evidence appendix or support manifest when they improve traceability without cluttering the first-read memo.

## Freshness Rules

Private credit underwriting is time-sensitive. Use these default freshness thresholds unless the user or deal context requires stricter rules:

- cash balance: latest available, ideally within 30 days for live deals or stressed credits
- borrowing base / revolver availability: latest available, ideally within 30 days
- monthly financials: latest closed month; flag if older than 60 days in a live deal
- quarterly financials: flag if next quarter should already be available
- QoE: check period covered and whether recent months are stubbed or missing
- customer concentration / backlog / pipeline: flag if older than the last reporting period
- inventory / AR aging: latest available; flag if older than 30-45 days for ABL or liquidity-sensitive deals
- interest rate / base rate / spread: use current or as-of date; flag if rate environment changed materially
- public filings / press releases: use latest available; note filing date and period end

If source dates differ, disclose mixed as-of dates. Do not hide the mismatch.

## Source Conflict Handling

When sources disagree:

1. Identify the exact conflict: amount, period, definition, entity scope, accounting basis, date, or currency.
2. Rank sources using the hierarchy above.
3. Preserve both values until resolved.
4. Use the more conservative value for lender downside if the conflict affects debt capacity, liquidity, covenant headroom, or loss risk.
5. Add a precise diligence ask for the reconciling schedule.
6. Do not average conflicting values unless the user explicitly asks for a blended scenario.

## Public-Source Fallback Rules

When no private materials are available, produce only a `screening-only` or `diligence-grade` output, not a final committee memo.

Use public sources to:

- understand business model, risks, and operating history
- identify public debt, liquidity, and covenant disclosures when available
- build a preliminary earnings and cash-flow view
- compare to public peers, market spreads, and industry indicators
- define diligence asks for private materials

Do not use public sources to:

- assert final lender EBITDA
- conclude on covenant EBITDA without the governing definition
- publish a final NWC peg
- conclude on private collateral value
- assume sponsor support

## Ask-For-More Protocol

Ask for more only if the missing item blocks a material conclusion. Ask for the exact missing file or field, not a generic data dump.

Use this format:

| Priority | Needed item | Why it matters | Affected conclusion | Minimum substitute |
|---|---|---|---|---|
| high | latest monthly financials | supports LTM EBITDA and liquidity | leverage, coverage, lender case | quarterly financials plus management bridge |
| high | credit agreement or term sheet | covenant definitions and baskets | covenant headroom | summary term sheet for proxy only |
| medium | AR aging | collateral quality and borrowing base | liquidity and recovery | latest borrowing-base certificate |
