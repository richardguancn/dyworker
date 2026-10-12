# Source and Evidence Reference

Use this reference when gathering covenant documents, validating sources, handling public filings, or deciding whether the analysis can be relied on.

## Table Of Contents

- Source hierarchy
- Trusted web fallback rules
- Document version discipline
- Staleness checks
- Source conflicts
- Evidence labels
- Citation and evidence format
- Public-company source notes
- Data request protocol

## Source hierarchy

Always prioritize sources in this order:

1. **User-provided and connected-source documents**
   - executed credit agreement, indenture, note purchase agreement, security agreement, guarantee agreement, intercreditor agreement
   - amendments, waivers, consents, joinders, side letters, fee letters when relevant
   - commitment papers, term sheets, lender presentations, covenant certificates, borrowing-base certificates, notices of default
   - borrower financials, debt schedule, compliance model, QoE output, management plan, portfolio-system data
   - data room, Drive, email, document repository, lender portal, internal memo, portfolio monitoring app, or other connector/app source

2. **Institutional or primary public sources**
   - SEC filings and exhibits, SEDAR+/local regulator filings, court filings, bankruptcy docket materials, company IR documents, press releases
   - rating-agency releases or presale reports when they quote terms or summarize covenant protection
   - official regulator or central-bank materials for market context

3. **Trusted secondary sources**
   - reputable financial news, law-firm client memos, lender/credit-market publications, research providers, data-provider summaries
   - use only for context or to find primary documents unless the user explicitly requests market color

4. **General web fallback**
   - use only when the higher tiers are unavailable or insufficient
   - label clearly as web fallback and do not let it override executed documents or connector-sourced materials

## Trusted web fallback rules

When using web search, focus on:
- SEC EDGAR filings and exhibits
- company investor-relations pages
- official press releases
- bankruptcy court or claims-agent filings
- regulator or central-bank publications
- rating-agency publications
- reputable law-firm or lender memos for market practice context

Avoid relying on:
- unsourced blogs
- scraped summaries when the SEC or company source is available
- social media
- promotional content
- secondary market commentary that does not cite the document

## Document version discipline

For every material document, record:
- source ID
- file name or source name
- document type
- execution or issue date
- amendment number, if any
- draft vs executed status
- borrower / issuer
- facility / notes covered
- source tier
- source date or filing date
- whether schedules or exhibits are missing

Do not silently mix an original agreement with later amendments. Build the operative version by layering amendments and waivers in date order.

## Staleness checks

Treat these as potentially stale unless the date is current for the decision:

| Source | Freshness issue |
|---|---|
| Credit agreement / indenture | later amendments, waivers, incremental facilities, refinancing, maturity extension, or covenant reset may supersede terms |
| Term sheet / commitment paper | may not reflect final documentation |
| Covenant certificate | only valid for the stated test date and definition; may not reflect subsequent debt, EBITDA, or basket usage |
| Debt schedule | must tie to latest reporting date and include revolver, letters of credit, PIK, accrued interest, fees, and off-balance-sheet debt-like items where relevant |
| EBITDA / add-back schedule | must tie to the definition being tested and latest QoE or financial data |
| Basket capacity table | stale unless it includes prior usage, reclassification, investments, restricted payments, debt incurrence, liens, and available amount calculations |
| Public filing summary | may summarize terms; use filed exhibits where available |

## Source conflicts

When sources conflict:
1. Prefer the executed agreement and operative amendment over summaries.
2. Prefer the filed exhibit over a press release or filing narrative summary.
3. Prefer the latest operative amendment over the original agreement for amended provisions.
4. Prefer covenant certificate math only for compliance as of that date; do not let it override definitions.
5. Treat management, sponsor, banker, or seller summaries as claims until tied to documents.
6. Show the conflict, affected conclusion, and exact source needed to resolve it.

## Evidence labels

Use these labels from `financial-source-of-truth`:

| Label | Covenant package use |
|---|---|
| `fact_primary` | executed agreement, filed exhibit, covenant certificate, lender statement, audited financial, court filing |
| `fact_secondary` | rating-agency summary, reputable provider summary, law-firm memo with quoted document terms |
| `management_claim` | borrower-provided covenant interpretation, compliance schedule, management add-back view |
| `seller_claim` | CIM, banker deck, sponsor/seller add-back claim |
| `third_party_estimate` | provider benchmark, rating-agency expectation, market-practice estimate |
| `assumption` | deal-team interpretation, missing usage estimate, assumed financial metric |
| `inference` | analyst conclusion about leakage, flexibility, or negotiation risk |
| `unsupported` | conclusion without source basis |

## Citation and evidence format

For each important finding, preserve:
- finding ID
- source ID
- section or clause reference, if available
- excerpt or summary
- evidence label
- analyst interpretation
- affected metric or covenant
- confidence
- open issue

Example:

| finding_id | source_id | clause | evidence_label | finding | interpretation | open_issue |
|---|---|---|---|---|---|---|
| F001 | CA-2026-03 | EBITDA definition | fact_primary | add-back for run-rate cost savings permitted subject to cap | lender EBITDA may exceed QoE EBITDA | confirm cap and actual add-back usage |

## Public-company source notes

For a named public company, search public filings only after checking attachments and connectors. In SEC filings, credit agreements, indentures, amendments, note purchase agreements, and similar documents often appear as exhibits to Form 8-K, 10-Q, or 10-K. Press releases and 8-K narrative summaries can help find the transaction, but filed exhibits control when available.

## Data request protocol

Ask for missing items in this format:

| Priority | Needed item | Why it matters | Affected conclusion | Minimum substitute |
|---|---|---|---|---|
| 1 | operative credit agreement plus amendments | defines covenants and baskets | all covenant and leakage conclusions | latest redline or filed exhibit |
| 2 | latest covenant certificate | computes actual headroom | compliance / breach risk | management model showing covenant calculations |
| 3 | QoE or lender EBITDA bridge | validates add-backs | EBITDA definition and leverage | reported EBITDA plus add-back schedule |
