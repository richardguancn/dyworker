# Output Templates

## Table Of Contents

- Style standard
- Standalone HTML restructuring memo
- Quick-read format
- Full memo format
- Board summary format
- Creditor-side format
- Recovery table template
- Fulcrum table template
- Alternatives table template
- Diligence gap template
- Structured handoff packages
- Example language

## Style standard

Write like a senior restructuring banker:

- Put the answer at the top.
- Use ranges, not false precision, when inputs are uncertain.
- Explain what matters and why.
- Identify the decision, not just the math.
- Separate facts, assumptions, and recommendations.
- Use readable tables for recoveries, alternatives, and diligence gaps.
- Flag legal conclusions for counsel review.

## Standalone HTML restructuring memo

Use this as the default reader-facing deliverable for debtor-side sale-path, restructuring-alternatives, and board-recommendation analysis. Follow `../../../references/html-artifact-standard.md`; this skill owns its standalone HTML memo rather than packaging ordinary narrative work through `dashboard-builder`.

Recommended first-read sequence:

1. Recommendation, audience, source cutoff, and board-readiness posture.
2. Decision gates: the few unresolved facts that prevent or support reliance.
3. DIP and transaction perimeter: cash, credit bid, assumed liabilities, liens, fees, cure, and process conditions.
4. Value bridge and value-break analysis: clearly distinguish estate proceeds from illustrative residual value.
5. Recovery sensitivity and practical fulcrum, with allowed-claim and collateral limitations visible.
6. Alternatives and higher-and-better process requirements.
7. Board information request, counsel/valuation flags, sources, and posture conclusion.

Design and evidence rules:

- Use a restrained memo layout with a clear recommendation and compact decision tables, not dashboard navigation, copy/export controls, or a related-files panel.
- Put the board-decision gates before detailed claim and sensitivity schedules.
- Show source citations close to material terms and workbook cell/range support for displayed calculated outputs without covering the opening view in citation badges.
- Describe visible evidence as `Executed DIP agreement`, `Filed asset purchase agreement`, `Company disclosure`, `Analyst calculation`, `Illustrative sensitivity`, or `Not yet supported`; retain internal codes in support data or handoffs only.
- Treat known-funded-GUC-only percentages or thresholds as upper-bound sensitivities before additional allowed claims; do not present them as distributable recovery.
- Render and visually inspect the opening view plus value-break/recovery and board-gates sections through local headless-browser screenshots before delivery.

## Quick-read format

Use only when the user explicitly needs a fast answer, live meeting prep, or triage against thin source context.

```markdown
# Distressed Recovery Waterfall - Quick Read

## Executive conclusion
[3-6 bullets: value break, fulcrum, recoveries, best path, risks, next step]

## Capital structure snapshot
| Priority | Class | Claim | Collateral/lien | Est. recovery | Notes |
|---:|---|---:|---|---:|---|

## Recovery by scenario
| Class | Claim | Low | Base | High | Trading price | Banker view |
|---|---:|---:|---:|---:|---:|---|

## Fulcrum and value break
[Explain where value breaks and how sensitive it is.]

## Key diligence gaps
| Gap | Why it matters | Owner/review |
|---|---|---|

## Recommended next steps
[Action-oriented list.]
```

## Full memo format

```markdown
# Distressed Recovery Waterfall and Restructuring Alternatives

## 1. Executive summary
- [Where value breaks]
- [Fulcrum security]
- [Recovery ranges]
- [Recommended restructuring path]
- [Largest diligence/legal/valuation risks]

## 2. Situation and mandate
[Company, stage, client posture, decision needed, jurisdiction, process status]

## 3. Sources, assumptions, and confidence
| Item | Source | Date | Confidence | Notes |
|---|---|---|---|---|

## 4. Capital structure and claims
[Debt stack and claims register]

## 5. Legal entity, guarantor, collateral, and priority map
[Entity and collateral analysis, counsel flags]

## 6. Valuation and distributable value
[Reorg value, sale value, liquidation value, bridge to distributable value]

## 7. Recovery waterfall
[Low/base/high and relevant alternative cases]

## 8. Fulcrum security and value-break sensitivity
[Class where value breaks and control implications]

## 9. Restructuring alternatives
[Alternatives comparison matrix]

## 10. Stakeholder leverage and plan feasibility
[Creditor groups, votes, new-money ability, litigation, process leverage]

## 11. Recommendation
[What to do, who to engage, what to offer, what to diligence]

## 12. Appendix
[Detailed assumptions, calculations, QA checks]
```

## Board summary format

Emphasize fiduciary posture, process, alternatives, risk, and decision.

```markdown
# Board Summary - Distressed Alternatives and Recovery Analysis

## Recommendation
[Clear recommendation and fallback path]

## What has changed
[Liquidity, maturity, default, valuation, stakeholder pressure]

## Where value breaks
[Plain-English value-break explanation]

## Alternatives considered
| Alternative | Feasibility | Value preservation | Stakeholder support | Risk | Recommendation |
|---|---|---|---|---|---|

## Stakeholder map
| Stakeholder | Recovery | Leverage | Likely position | Board implication |
|---|---:|---|---|---|

## Key risks and mitigants
[Legal, valuation, liquidity, operational, execution]

## Immediate actions
[Next 5-10 actions]
```

## Creditor-side format

Emphasize client recovery, leverage, valuation dispute, blocking rights, and strategy.

```markdown
# Creditor Recovery and Leverage Analysis

## Bottom line for [client class]
[Recovery range, fulcrum status, strategy]

## Our recovery under alternatives
| Alternative | Recovery | Key assumptions | Upside | Downside | Action |
|---|---:|---|---|---|---|

## Where we have leverage
[Economic, legal, voting, liquidity, process]

## Where other classes have leverage
[Potential threats or concessions]

## Negotiation posture
[Opening ask, fallback, walk-away, litigation triggers]

## Diligence and counsel questions
[Issues to validate before taking position]
```

## Recovery table template

| Class | Claim | Low recovery | Base recovery | High recovery | Trading price | Implied view | Banker conclusion |
|---|---:|---:|---:|---:|---:|---|---|

## Fulcrum table template

| Scenario | Distributable value | Value breaks in | Fulcrum class | Money-good classes | Out-of-money classes | Practical implication |
|---|---:|---|---|---|---|---|

## Alternatives table template

| Alternative | Feasibility | Recovery impact | Timing | Support needed | Key risks | MD recommendation |
|---|---|---|---|---|---|---|

## Diligence gap template

| Missing item | Why it matters | Impact if wrong | Needed from | Priority |
|---|---|---|---|---|

## Structured handoff packages

Use `../../../references/handoff-contracts.md` when restructuring analysis feeds another Investment Banking skill:

- `distressed_recovery_waterfall_to_memo_builder`
- `distressed_recovery_waterfall_to_pitch_deck_builder`
- `distressed_recovery_waterfall_to_ib_deck_qc`

All three preserve the same restructuring core: mandate context, client/stakeholder perspective, jurisdiction/process stage, source scope, capital structure, claim register, legal entity/guarantor/collateral map, valuation cases, distributable value bridge, recovery waterfall, recovery ranges by class, value-break class, fulcrum security, stakeholder leverage, alternatives, recommended path, diligence gaps, counsel/specialist flags, key numbers to tie, open items, and circulation caveats.

The QC package also carries artifact version, review scope, waterfall tie-outs, valuation case tie-outs, scenario outputs, assumption register, model status, QA checks, and confidentiality/disclosure flags.

## Example language

Strong language:

- "Base-case value breaks in the second-lien notes; they are the economic fulcrum and likely plan-anchor constituency."
- "The fulcrum conclusion is not robust because a modest EBITDA or multiple downside moves impairment into the first-lien term loan."
- "Unsecured notes are out of the money on strict entitlement but may have settlement value if they can credibly litigate valuation or plan classification."
- "The company should not launch a second-lien-led RSA without either making first lien whole or offering first lien credible takeback paper."
- "This is an illustrative waterfall until collateral, guarantor, and intercreditor terms are reviewed."

Avoid weak language:

- "The model says recovery is 52.3 percent" without explaining sensitivity.
- "This plan is confirmable" unless counsel has provided that conclusion.
- "Secured debt recovers 100 percent" without collateral coverage.
- "Equity is definitely worthless" if valuation range or litigation status is uncertain.
