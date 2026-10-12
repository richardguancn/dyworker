# Staleness and Source Conflict Handling

Use this guide to decide when a source is too old, incomplete, or contradicted to support an investment-banking or finance conclusion.

## Required freshness fields

For each material source, record:

- Document date
- Period covered
- As-of date
- Access date
- Version or draft status if available
- Whether the source may have been superseded

If one of these fields is missing and it matters to the decision, mark freshness as unknown.

## Freshness thresholds by data type

These thresholds are defaults. Tighten them when markets are volatile, the company is distressed, the deal is live, or the user asks for current information.

| Data type | Freshness expectation | Flag as stale when |
|---|---|---|
| Public-company historical annual financials | Latest filed annual period | New annual filing or restatement likely supersedes it |
| Public-company quarterly financials | Latest filed quarter or latest earnings release for the relevant period | New quarter has reported, filing/release supersedes it, or period is ambiguous |
| Earnings release and transcript | Exact reported quarter | New guidance, 10-Q/6-K, 8-K, or later management update supersedes it |
| Market prices, FX, yields, spreads, commodities | Timestamp or current date | No timestamp, old quote, volatile market, or output implies live precision |
| Consensus estimates | Vendor and date | No date, changed after earnings/guidance, or source does not identify estimate set |
| Credit ratings and outlooks | Agency, date, issuer/instrument | Later rating action, watch/outlook change, or debt instrument mismatch |
| Debt balances and liquidity | Latest reporting period or compliance package | Quarter-end or latest monthly data likely changed materially |
| Covenants and legal terms | Current executed agreement or current draft | Summary only, outdated draft, amendment likely supersedes it |
| Private-company financials | Latest monthly package for operating trends; audited/QoE for historical support | Data is old relative to transaction timeline, unaudited without support, or period missing |
| CIM / investor deck | Date of pack and period referenced | Updated deck, VDR data, management accounts, QoE, or diligence source supersedes it |
| QoE adjustments | Document-supported period and adjustment date | Unsupported management add-back, old diligence report, or incomplete support |
| Real-estate rent roll | Property-specific as-of date | Leasing changes, rollover, vacancy, or stale OM data likely supersedes it |
| Macro releases | Official release date, revision status | Revised data, newer release, preliminary estimate superseded by final |

## Staleness labels

Use these labels in evidence ledgers:

| Label | Meaning |
|---|---|
| current | Fresh enough for the stated use |
| current but volatile | Fresh now, but likely to change quickly; timestamp required |
| stale but usable for history | Old but appropriate for historical context |
| potentially superseded | There may be newer source material; avoid definitive conclusions |
| stale for decision | Too old for the decision; use only as context |
| unknown freshness | Missing date/as-of/version information |

## Conflict handling workflow

1. Identify the exact conflict.
   - Metric mismatch: revenue, EBITDA, leverage, FCF, NWC, debt balance, cap rate, covenant headroom.
   - Definition mismatch: adjusted EBITDA, ARR, net debt, same-store NOI, active customer, organic growth.
   - Timing mismatch: LTM period, fiscal year, quarter, as-of date, spot price.
   - Scope mismatch: consolidated versus segment, continuing ops versus total, property-level versus portfolio, restricted group versus issuer.
   - Source type mismatch: filed number versus management presentation versus broker summary.

2. Classify materiality.
   - High: changes recommendation, valuation range, leverage, covenant headroom, risk rating, or decision to proceed.
   - Medium: changes framing but not decision.
   - Low: immaterial or disclosure-only.

3. Select preferred source.
   - Prefer the source that is most authoritative for that claim.
   - Prefer the source with the most precise scope, period, and definition.
   - Prefer current executed/filed/audited/source-system data over summaries.
   - If using a lower-tier source, explain why.

4. Document treatment.
   - Resolved: explain reconciliation and use corrected figure.
   - Partially resolved: use preferred figure and flag caveat.
   - Unresolved: present both figures and convert to diligence ask.
   - Sensitivity: run both versions if the conflict affects value or credit.

## Conflict register template

```markdown
| Issue | Source A | Source B | Difference | Materiality | Preferred source | Treatment | Diligence ask |
|---|---|---|---|---|---|---|---|
| [metric/claim] | [S1] | [S2] | [variance] | [high/medium/low] | [source ID/unresolved] | [resolved/partial/unresolved/sensitivity] | [specific ask] |
```

## Examples of correct treatment

- If a CIM claims 30 percent EBITDA growth but monthly financials show flat adjusted EBITDA, label the CIM statement as a seller claim, use monthly financials as preferred evidence for actual performance, and ask for EBITDA bridge support.
- If consensus revenue differs across two vendors, cite both, state date and vendor, and avoid false precision. If the delta matters, run sensitivity.
- If a credit agreement summary says a covenant is springing but the executed agreement defines the springing test differently, use the executed agreement and flag the summary as superseded or incomplete.
- If a market price is from yesterday and the user asks for current valuation, either retrieve current data or state that the price is stale for live valuation.

## Do-not-do list

- Do not average conflicting numbers without explaining source, definition, and timing differences.
- Do not use a seller presentation as proof of adjusted EBITDA.
- Do not treat management guidance as achieved performance.
- Do not cite a transcript quote as proof that the strategy will work.
- Do not use stale market data in a conclusion that implies live pricing.
- Do not hide unresolved conflicts in footnotes if they affect the decision.
