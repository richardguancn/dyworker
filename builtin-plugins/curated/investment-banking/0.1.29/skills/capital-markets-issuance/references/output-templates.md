# Output templates

Use these templates as flexible defaults. Adapt to the user's requested audience and format.

## Table Of Contents

- [Full issuance recommendation](#full-issuance-recommendation)
- [Quick market-window output](#quick-market-window-output)
- [Investor targeting output](#investor-targeting-output)
- [Comparable deals output](#comparable-deals-output)
- [Client/board one-page output](#clientboard-one-page-output)
- [Structured handoff packages](#structured-handoff-packages)
- [Tone rules](#tone-rules)

## Standalone HTML issuance recommendation

# Capital markets issuance recommendation: [issuer]

Use for an issuer-side financing decision when HTML is requested or selected. Follow `../../../references/html-artifact-standard.md`; create a polished standalone financing report owned by `capital-markets-issuance`, not a dashboard-builder package.

## 1. Recommendation and decision requested
- **recommendation**: [proceed / prepare / defer / switch instrument / dual-track / no issuance]
- **instrument**: [recommended security]
- **size**: [recommended base transaction if executable data supports it, otherwise illustrative planning case/readiness range]
- **indicative terms**: [pricing/yield/coupon/discount/conversion premium]
- **launch window**: [timing and conditions]
- **use of proceeds**: [specific narrative]
- **key risks**: [top 3]
- **fallback**: [plan b]

## 2. Why raise or not raise now
- amount required;
- existing funding sufficiency and liquidity runway;
- timing need;
- strategic rationale;
- investor optics;
- alternatives to external issuance.

For a recommendation to wait or prepare, use conditional headline language such as `Wait now; prepare common equity as the preferred contingent financing path` and state exactly what new need or market condition would change the answer. Do not say the issuer will use a security later unless the launch gates are satisfied.

## 3. Financing alternatives
| Alternative | Pros | Cons | Market receptivity | Cost | Certainty | Strategic fit | Recommendation |
|---|---|---|---|---|---|---|---|

Keep the table focused on decision-relevant alternatives. A common-equity versus convertible versus wait decision should not expand into every possible security unless an additional path is credible.

## 4. Recommended transaction and pro forma impact
- structure and use of proceeds;
- minimum viable, base, and maximum advisable size where relevant; when current price, liquidity, volatility, comparable issuance, or investor feedback is stale or missing, label these as planning cases or a readiness range rather than an executable recommendation;
- indicative pricing or terms, visibly labeled as illustrative unless supported by transaction evidence;
- proceeds, dilution, liquidity, leverage, interest cost, conversion dilution, or equity-linked overhang as applicable;
- ratings/covenant/disclosure considerations where material.

## 5. Market window and execution conditions
- market rating: [open / open but selective / conditional / closed / urgent despite poor window];
- supporting evidence;
- market-data timestamp and staleness warning where applicable;
- launch triggers;
- delay triggers.

## 6. Optional decision-changing modules

Include these only when the evidence exists and the module changes the recommendation or execution path.

### Investor targeting
| Tier | Investor/type | Why likely | Expected objection | Outreach angle | Next action |
|---|---|---|---|---|---|

Add anchor strategy, accounts to avoid/deprioritize, wall-crossing notes, and allocation/book-quality considerations.

### Comparable transactions
| Relevance | Issuer | Date | Instrument | Size | Terms | Use of proceeds | Aftermarket | Implication |
|---:|---|---|---|---:|---|---|---|---|

Add adjustments and pricing/sizing implications.

### Detailed execution plan
| Phase | Timing | Key actions | Decision gate | Owner | Risk | Fallback |
|---|---|---|---|---|---|---|

## 7. Risks, verification items, and fallback
| Risk | Why it matters | Mitigant | Decision trigger |
|---|---|---|---|

End with source posture, unresolved diligence items, fallback, and exactly what management, board, or client should approve or do next.

## Standalone HTML presentation rules

- Lead with the financing decision and its conditions, followed by four or five decision-useful figures at most.
- Avoid repeating the conclusion through a hero statement, metric row, summary module, and action register.
- For pre-commercial, development-stage, or materially milestone-dependent issuers, keep simplified runway or coverage proxies below the headline metrics unless essential to the recommendation; prefer reported liquidity, guided spending, or direct cash-use figures above the fold.
- Do not add dashboard navigation, related-file modules, render-contract metadata, or repeated export controls by default.
- Display terms, assumptions, and market timestamps in reader-facing language, not internal schema language.
- If modeled proceeds, dilution, leverage, interest, conversion, or liquidity appear in the report, retain both the calculation inputs and results as supporting artifacts and list them in `manifest.json`.
- Render and visually inspect the opening viewport and the key alternatives or execution section using local headless-browser screenshots before delivery.

## Quick market-window output
Use when the user asks for a quick read.

1. **bottom line**: [open/conditional/closed and recommendation]
2. **why**: 3-5 bullets with current evidence
3. **issuer-specific constraints**: [catalysts, ratings, liquidity, disclosure]
4. **transaction feasibility**: [size/terms likely to clear]
5. **go/no-go triggers**: [specific thresholds]
6. **next step**: [prepare, sound anchors, wait, switch structure]

## Investor targeting output
1. **targeting strategy**: who to approach first and why;
2. **tiered list**: anchor/core/incremental/education/avoid;
3. **objection map**: likely pushback and responses;
4. **outreach sequence**: relationship owners, wall-crossing, timing;
5. **book-quality guidance**: allocation priorities and risks.

## Comparable deals output
1. **comp universe and filters**;
2. **relevance-scored table**;
3. **outliers and exclusions**;
4. **pricing/terms range**;
5. **adjustments for issuer and market**;
6. **implication for recommendation**.

## Client/board one-page output
- **decision requested**;
- **recommended financing**;
- **why now**;
- **expected terms and sizing**;
- **investor/market support**;
- **risks and mitigants**;
- **next steps and approvals**.

## Structured handoff packages

Use `../../../references/handoff-contracts.md` when a capital markets output feeds credit or covenant workflows:

- `capital_markets_issuance_to_private_credit_underwriting`: issuer financing view, proposed instrument, sizing, terms, pro forma leverage/coverage, market-clearing assumptions, lender objections, source/evidence register, covenant/rating caveats, and open items.
- `capital_markets_issuance_to_covenant_package_analyzer`: proposed facility/security, debt incurrence need, covenant/basket questions, document universe, amendment/waiver questions, source/evidence register, counsel-review flags, and open items.

These handoffs are inputs for underwriting or document analysis. They are not lender approval and not legal covenant conclusions.

## Tone rules
- Use banker language: decisive, commercial, risk-aware.
- Avoid hype and generic market commentary.
- Do not bury the recommendation.
- Include numbers in ranges when precise data is unavailable.
- State assumptions and verification needs clearly.
