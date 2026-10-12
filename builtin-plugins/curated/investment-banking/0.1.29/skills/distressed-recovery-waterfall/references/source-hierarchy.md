# Source Hierarchy and Evidence Discipline

## Table Of Contents

- Goal
- Source priority
- Required labels
- Stale-data checks
- Document extraction discipline
- Connected-app preference
- Web fallback rules
- Citation and confidence standard
- Missing-source language

## Goal

Make every recovery waterfall evidence-safe. Distressed capital structures are document-driven and adversarial. Never treat a clean-looking model as correct unless debt terms, claim amounts, collateral, guarantees, and valuation assumptions tie to sources.

When consuming private-credit inputs, use `private_credit_underwriting_to_distressed_recovery_waterfall` from `../../../references/handoff-contracts.md` and preserve source, evidence, legal-review, and valuation-review flags.

## Source priority

Use this hierarchy unless the user specifies otherwise:

1. User-provided documents and direct instructions.
2. Callable connected routes and user-provided exports.
3. Executed legal documents: credit agreements, indentures, intercreditor agreements, security agreements, guarantees, pledge agreements, amendments, waivers, forbearance agreements, RSAs, DIP term sheets, plan documents, disclosure statements.
4. Company files: debt schedules, 13-week cash flows, liquidity forecasts, board decks, management plans, VDR exports, QofE reports, appraisals, liquidation analyses, lender presentations.
5. Official public sources: SEC filings, prospectuses, earnings releases, investor presentations, bankruptcy docket filings, court declarations, regulatory filings.
6. Market data: loan or bond pricing, TRACE-style data, equity prices, CDS, ratings reports, broker commentary, comparable restructurings, DIP or exit-financing terms.
7. Public web sources and news.
8. User-confirmed or clearly labeled assumptions.

## Required labels

Label material numbers and assertions as one of:

- Documented: directly sourced to a provided or connected document.
- Calculated: formula-derived from sourced inputs.
- User-provided: stated by the user in the prompt or conversation.
- Market-derived: based on market price, comps, precedent terms, or trading data.
- Assumed: no direct source; clearly disclose and sensitize.
- Counsel review required: depends on legal interpretation, enforceability, priority, entitlement, perfection, or plan confirmation.
- Specialist review required: depends on tax, pension, environmental, regulatory, industry, appraisal, or valuation expertise.

## Stale-data checks

For any number likely to change, record date and source:

- Cash balance.
- Revolver availability.
- Borrowing base.
- Debt principal and accrued interest.
- Trading price.
- Market capitalization.
- EBITDA and latest LTM period.
- Projections and board plan date.
- DIP or exit-financing term sheet.
- RSA support levels.
- Claims register.
- Docket status.

If dates conflict, prefer the most authoritative current source, not the newest file timestamp.

## Document extraction discipline

When reviewing legal or financing documents, extract only what is visible and supportable. Do not infer hidden terms.

For each instrument, capture:

- Issuer or borrower.
- Guarantors.
- Principal amount.
- Accrued interest and rate basis.
- Maturity.
- Lien priority.
- Collateral.
- Intercreditor agreement.
- Security package.
- Covenants and baskets relevant to LME or new debt.
- Consent thresholds and sacred rights.
- Call protection, make-whole, prepayment premium, default interest.
- Subordination, turnover, release, and enforcement-control terms.
- Amendment history.

Mark legal interpretation as counsel review required.

## Connected-app preference

When scoped connected routes or user-provided exports are available, prefer them before web fallback. Examples:

- Drive or document repositories for models, board decks, debt schedules, credit agreements, and VDR exports.
- Email or Slack for latest process updates, creditor group status, banker comments, and term-sheet revisions.
- Financial-data connectors for filings, market prices, comps, transcripts, ratings, and capital-structure data.
- Internal knowledge bases for precedent templates, firm style, and committee requirements.

If connected-app results appear stale or incomplete, say so and use public data or ask for missing documents.

## Web fallback rules

Use web search for:

- Public-company filings and recent announcements.
- Current bankruptcy docket or case updates, if accessible.
- Recent market prices or press reports when no market connector is available.
- Recent restructuring precedent and LME market context.
- Current legal or regulatory references when required.

Do not rely on web summaries for precise debt terms if underlying credit documents are available.

## Citation and confidence standard

For client-ready output, show a source column or footnotes for material inputs. If sources cannot be cited in the final environment, include a source log table:

| Item | Value | Source | Date | Confidence | Notes |
|---|---:|---|---|---|---|
| First-lien term loan principal | $1,200mm | Debt schedule | 2026-03-31 | High | Tie to model tab Debt Schedule |
| Second-lien claim | $600mm | User-provided | n/a | Medium | Accrued interest not confirmed |
| Base reorg EV | $1,800mm | Assumed | n/a | Low | Sensitize +/- $300mm |

## Missing-source language

Use direct language:

- "I can build an illustrative waterfall, but lien priority and collateral coverage are assumed until the credit agreement, security agreement, and intercreditor agreement are reviewed."
- "The fulcrum appears to be second lien on the provided enterprise value, but that conclusion is not robust without collateral-pool detail and a current debt schedule."
- "Make-whole, default interest, and deficiency-claim treatment require counsel review. I have sensitized them rather than treating them as settled."
