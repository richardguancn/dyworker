# Underwriting Playbook

Use this reference when producing a full credit memo, credit screen, or committee readout.

## Table Of Contents

- [Underwriting Mindset](#underwriting-mindset)
- [Request Classification](#request-classification)
- [Minimum Underwriting Context](#minimum-underwriting-context)
- [Core Workflow](#core-workflow)
- [Borrower Analysis](#borrower-analysis)
- [Earnings Base](#earnings-base)
- [Cash Flow And Repayment Source](#cash-flow-and-repayment-source)
- [Lender Case Design](#lender-case-design)
- [Recommendation Framework](#recommendation-framework)
- [Readiness Checks](#readiness-checks)

## Underwriting Mindset

Private credit underwriting is about downside protection, not just base-case return. A good memo answers:

1. What is the borrower and why does it deserve credit?
2. What is the source of repayment?
3. What breaks first under stress: EBITDA, cash, covenant, borrowing base, customer loss, margin, capex, or maturity?
4. What protects the lender if the business underperforms?
5. What structure, pricing, covenants, monitoring, and conditions make the risk acceptable?

Lead with recommendation, not background. Do not produce generic credit commentary. Produce a view that answers: should the lender proceed, on what structure, with what protections, and what could cause loss.

## Request Classification

Classify the request before responding:

| Request type | Typical user ask | Default output |
|---|---|---|
| `initial_credit_screen` | should we spend time on this deal? | standalone HTML credit screen with go / no-go / diligence asks unless the user explicitly requests quick triage |
| `underwriting_memo` | prepare a credit committee memo | standalone HTML full credit memo with recommendation and conditions |
| `debt_capacity_workbook` | how much debt can this business support? | workbook-first debt capacity, downside and liquidity analysis |
| `terms_protections_review` | review this term sheet or debt package | standalone HTML or workbook structure, pricing, covenants, collateral, and negotiation issues |
| `covenant-liquidity` | assess covenant headroom or liquidity | covenant bridge, liquidity runway, downside triggers |
| `qa-review` | check this credit analysis | issue log, missing support, broken logic, and readiness verdict |
| `distressed-watch` | borrower is stressed | default / amendment / recovery-focused readout and escalation plan |

## Minimum Underwriting Context

Proceed with the strongest supportable output when partial information is available. Use placeholders and diligence asks rather than inventing facts.

Minimum useful inputs:

- borrower name or business description
- purpose of analysis: screen, underwriting, refinancing, amendment, monitoring, distressed, or committee memo
- available financials or operating metrics
- proposed or existing debt structure when relevant
- desired decision: proceed / decline, debt sizing, covenant assessment, risk rating, pricing, or memo

Helpful inputs:

- historical monthly or quarterly financials
- normalized EBITDA bridge and add-back support
- lender EBITDA definition or covenant EBITDA terms
- management forecast, budget, or lender case
- debt schedule, term sheet, credit agreement, maturity schedule, revolver borrowing base, or covenant package
- collateral schedules, AR/AP/inventory aging, fixed asset appraisals, insurance, liens, guarantees
- sponsor history, equity contribution, ownership structure, and support expectations
- customer concentration, backlog, churn, retention, unit economics, industry data, and competitive context
- prior lender presentations, board materials, management Q&A, VDR documents, and diligence reports

### Acquisition-Financing Public Screens

When target public filings are available but acquirer/parent or combined-borrower financials and funded terms are not:

- Do not size a lender hold or claim acquisition-financing capacity.
- State: **No combined-borrower underwriting or hold-size conclusion is supportable without acquirer/parent financials, sources and uses, and committed debt terms.**
- Label a target-only debt-service calculation an `illustrative standalone cash-interest screening ceiling`.
- Treat disclosed committed acquisition financing as transaction-execution context only; without disclosed terms and combined-borrower support, it is not a credit attraction, repayment source, or lender protection.
- Require source-backed funds flow, acquirer/parent financials, QoE-supported lender EBITDA, committed debt terms, liquidity, collateral, and covenant package before credit committee reliance.

## Core Workflow

1. Lock mandate and evidence posture.
   - Identify borrower, deal type, requested decision, audience, period, currency, units, source base, and whether the output is screening, diligence-grade, or committee-ready.

2. Build the borrower snapshot.
   - Summarize business model, revenue drivers, margin structure, cyclicality, concentration, competitive position, management quality, sponsor ownership, and key risks.

3. Establish the earnings base.
   - Start with reported EBITDA, then adjusted EBITDA, normalized EBITDA, and lender EBITDA when support exists.
   - Use `financials-normalizer` and source-backed diligence support for unsupported, disputed, or material adjustments.
   - Never treat CIM or management add-backs as lender EBITDA without evidence and haircut logic.

4. Analyze financial performance and cash conversion.
   - Review revenue growth, margin trend, free cash flow, capex, working capital, cash conversion, leverage, interest coverage, fixed-charge coverage, liquidity, and quality of earnings.

5. Build the lender case and downside.
   - Translate management case into a lender case using conservative but economically coherent assumptions.
   - Stress revenue, margin, working capital, capex, customer loss, rate increases, inflation, borrowing-base availability, and refinancing risk as relevant.

6. Assess debt structure and terms.
   - Review facility size, tranche mix, priority, collateral, pricing, amortization, maturity, call protection, revolver, cash sweep, PIK, fees, mandatory prepayments, and covenant package.

7. Test covenants and liquidity.
   - Calculate headroom under base, lender, downside, and severe downside cases.
   - Identify the first covenant or liquidity breakpoint and the quarter/month when it occurs.

8. Assess collateral and recovery.
   - Evaluate collateral type, lien priority, appraisals, AR/inventory quality, enterprise value cushion, liquidation value, guarantees, sponsor support, and recovery path.

9. Rate risk and form recommendation.
   - Assign a risk posture and recommendation with conditions precedent, ongoing monitoring items, and required diligence.

10. Produce the memo or requested artifact.
   - Lead with recommendation, not background. Include exact open items needed to upgrade confidence.

## Borrower Analysis

Cover:

- business model and revenue engine
- products / services and value proposition
- customer concentration and contract quality
- end-market cyclicality and sensitivity
- pricing power and margin drivers
- supplier / labor / input-cost exposure
- management quality and sponsor ownership
- operational complexity and integration risk
- competitive position and switching costs
- seasonality and working-capital cycle
- regulatory, litigation, environmental, and tax issues if relevant

## Earnings Base

Build the earnings base in layers:

1. reported EBITDA or operating income
2. company adjusted EBITDA
3. QoE-supported adjusted EBITDA
4. normalized EBITDA, if run-rate logic is supportable
5. lender-after-haircut EBITDA
6. covenant EBITDA only with the governing definition

Rules:

- Treat CIM, banker, sponsor, and management adjustments as hypotheses until supported.
- Negative adjustments usually flow through fully.
- Repeated "one-time" charges are usually operating reality.
- Run-rate cost savings should stay outside base lender EBITDA unless executed and evidenced.
- Buyer synergies are not borrower credit support unless legally committed and lender-accepted.
- Use the lower of supported EBITDA and cash-flow reality when debt capacity depends on repayment.
- Always separate reported EBITDA, adjusted EBITDA, normalized EBITDA, lender-after-haircut EBITDA, covenant EBITDA, and cash EBITDA / FCF when cash conversion matters.

## Cash Flow And Repayment Source

Debt is repaid with cash, not adjusted EBITDA. Review:

- EBITDA to operating cash flow conversion
- working-capital investment required for growth
- maintenance vs growth capex
- cash taxes
- interest expense and rate sensitivity
- mandatory amortization
- seasonal liquidity troughs
- minimum cash needs
- debt maturities and refinancing windows
- one-time costs that consume cash even if excluded from EBITDA

Flag high-risk patterns:

- EBITDA grows but cash conversion deteriorates.
- Growth requires inventory or receivables investment not reflected in the model.
- Borrower relies on revolver availability during the same period covenants tighten.
- Rate increases reduce interest coverage below comfort levels.
- Capex is cut below maintenance need to make debt service work.
- Debt paydown is modeled before cash is actually available.

## Lender Case Design

A lender case should be more conservative than management case but economically coherent.

Default stress handles:

- revenue growth haircut or decline
- gross margin compression
- slower cost takeout
- lower add-back credit
- working-capital drag
- higher rates / cash interest
- higher capex or delayed capex savings
- customer loss or churn
- reduced revolver availability / borrowing-base advance rates
- delayed exit or refinancing

Do not make downside merely a flat haircut unless that is the only available data. Explain the business reason behind the stress.

When displaying a public-source debt ceiling, include a cash-flow downside dimension and financing sensitivity. For example, pair an unlevered FCF haircut with rate and/or minimum-coverage sensitivity; varying debt at one fixed assumed interest rate and coverage threshold is not sufficient.

## Recommendation Framework

Use one of:

- `proceed-to-diligence-only`: an initial screen supports spending diligence time but does not support exposure, hold size, or credit approval.
- `pass-on-diligence`: an initial screen does not warrant further underwriting work on the current information.
- `proceed`: credit is attractive under current structure, subject to normal closing diligence.
- `proceed-with-conditions`: credit is attractive only if specified structure, diligence, or covenant changes are made.
- `revise-structure`: acceptable risk may exist but current terms are insufficient.
- `watchlist / monitor`: existing credit requires enhanced monitoring or amendment planning.
- `decline`: insufficient downside protection, cash-flow support, or evidence.

Recommendation must specify:

- maximum debt or facility size supported
- proposed structure and covenants
- required pricing / fees / OID, if in scope
- conditions precedent
- monitoring package
- top 3-5 issues that could change the answer

For `initial_credit_screen`, use `proceed-to-diligence-only`, `pass-on-diligence`, or `decline`. Reserve `proceed-with-conditions` for a proposed credit structure that is sufficiently supported to assess on conditional approval terms.

## Readiness Checks

Before finalizing, confirm:

- Available attachments, callable connected routes, user-provided exports, and primary sources were used before asking for more.
- Source limitations and evidence posture are labeled.
- Reported, adjusted, normalized, lender, and covenant EBITDA are distinguished.
- Management or seller add-backs are not treated as facts without support.
- Downside and liquidity are included, not just base-case leverage.
- Covenant conclusions are tied to actual definitions or labeled as proxies.
- First loss / first breach / first liquidity-pressure driver is identified when relevant.
- Recommendation matches the analysis stage: diligence-stage language for an initial screen, or proceed / decline / proceed-with-conditions for an underwritten credit view.
- Exact next documents or fields required to improve reliability are listed.
