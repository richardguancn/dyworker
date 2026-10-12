# Risk Taxonomies

Use this reference when building a private credit risk register, assigning issue severity, shaping mitigants, or setting monitoring triggers.

## Table Of Contents

- [Risk Rating Posture](#risk-rating-posture)
- [Issue Severity](#issue-severity)
- [Core Risk Register](#core-risk-register)
- [Risk And Mitigant Logic](#risk-and-mitigant-logic)
- [Watchlist And Escalation Triggers](#watchlist-and-escalation-triggers)
- [Decision Impact](#decision-impact)

## Risk Rating Posture

Use plain-language risk posture unless the user provides an internal rating scale:

- `low`: stable cash-flow profile, conservative leverage, strong liquidity, clean evidence, and strong lender protections.
- `moderate`: supportable credit with identifiable risks that are mitigated by structure, covenants, sponsor support, or collateral.
- `elevated`: credit may be supportable only with tighter terms, lower leverage, more diligence, or stronger monitoring.
- `high`: downside protection is weak, liquidity or covenant headroom is thin, evidence is incomplete, or repayment depends on optimistic assumptions.
- `watchlist`: existing credit has deteriorating performance, covenant/liquidity pressure, amendment risk, or refinancing risk.
- `decline`: insufficient downside protection, repayment capacity, evidence, or structure.

## Issue Severity

| Severity | Meaning | Default action |
|---|---|---|
| Blocker | Cannot support the requested conclusion or lender protection appears materially compromised | Stop, request source, resize/restructure, or decline |
| High | Material repayment, liquidity, covenant, collateral, sponsor, or evidence issue | Fix before approval or make a closing condition |
| Medium | Important caveat that affects pricing, monitoring, conditions, or downside confidence | Track, diligence, or add monitoring protection |
| Low | Limited decision impact but should be disclosed or cleaned up | Note or add to follow-up list |
| Question | May be intentional but requires deal-team, borrower, sponsor, counsel, or source confirmation | Ask a targeted question |

## Core Risk Register

| Risk category | What to test | Common red flags | Possible mitigants |
|---|---|---|---|
| earnings quality | EBITDA support, add-backs, run-rate adjustments, recurring costs | unsupported add-backs, repeated one-time costs, negative QoE adjustments ignored | lender EBITDA haircuts, QoE condition, lower leverage |
| cash conversion | FCF, working capital, capex, taxes, one-time cash costs | EBITDA growth without cash, capex underfunding, working-capital drag | lower debt, cash sweep, minimum liquidity, reporting |
| leverage and coverage | debt / EBITDA, interest coverage, FCCR, DSCR | debt capacity relies on base case only, coverage weak after rate stress | resize, amortization relief, pricing change, equity cushion |
| liquidity | cash, revolver, seasonal troughs, borrowing-base availability | liquidity trough before recovery, revolver over-reliance, stale cash | min liquidity covenant, borrowing-base reporting, reserve |
| covenant | headroom, definition, testing frequency, cure rights | no definition, loose add-backs, breach under modest downside | tighter covenant, reporting, cure limits, step-down |
| collateral | lien, appraisal, AR/inventory quality, liquidation value | stale appraisals, junior lien, eligibility issues, weak perfection | updated appraisal, field exam, borrowing-base limits |
| sponsor | equity contribution, support history, legal commitments | high leverage with no sponsor support, fund-life issues | funded equity, support agreement, guarantee, tighter control |
| customer / supplier | concentration, contract quality, churn, credit quality | top customer loss breaks liquidity, weak renewals, supplier dependency | concentration limits, reporting, lower leverage |
| industry / cyclicality | demand, pricing, margins, regulation, input costs | borrower is peak-cycle, margin compression, regulatory exposure | lower leverage, covenant cushion, downside case |
| maturity / refinancing | maturity wall, exit market, deleveraging path | maturity before credible paydown, market window dependency | shorter approvals, mandatory paydown, refinancing milestones |
| documentation / leakage | debt, liens, RPs, investments, unrestricted subs | value leakage, large baskets, weak reporting | covenant package changes, counsel review, basket limits |

## Risk And Mitigant Logic

For each material risk, connect the chain:

1. evidence: what source supports the concern
2. mechanism: how the risk hurts repayment, liquidity, covenant headroom, collateral, or recovery
3. magnitude: base, lender, downside, severe downside impact if available
4. mitigant: structure, covenant, collateral, sponsor, reporting, diligence, or pricing protection
5. decision impact: proceed, resize, reprice, condition, monitor, or decline

Avoid generic mitigants. "Monitor performance" is not enough unless the monitoring package has frequency, metrics, thresholds, owners, and escalation actions.

## Watchlist And Escalation Triggers

Use these as monitoring triggers for existing credits:

- monthly revenue or EBITDA misses budget by a material amount for two consecutive periods
- liquidity falls near minimum cash needs or revolver availability is materially reduced
- covenant headroom narrows below agreed cushion or first breach appears in the forecast
- AR aging, inventory obsolescence, borrowing-base eligibility, or collateral value deteriorates
- sponsor refuses or delays expected support
- top customer loss, backlog decline, churn spike, or pricing pressure changes the lender case
- capex deferral or working-capital stretch creates future cash need
- maturity runway shortens without credible refinancing or sale path
- amendment, waiver, default, audit qualification, litigation, or regulatory issue emerges

Escalation actions include enhanced reporting, borrower call, sponsor call, amendment planning, reserve, collateral update, appraisal, field exam, counsel review, exit/refinancing plan, or decline/new-money refusal.

## Decision Impact

Translate risk severity into action:

- `Blocker`: do not call the memo committee-ready; request exact source, restructure, or decline.
- `High`: make it a condition precedent, resize debt, add covenant/collateral protection, or require sponsor support.
- `Medium`: disclose in memo, add diligence ask or monitoring trigger, and consider pricing/structure adjustment.
- `Low`: note in open items or housekeeping.
- `Question`: ask the specific owner or source needed to resolve it.
