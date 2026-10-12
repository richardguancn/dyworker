# Output Templates

Use these templates when producing credit screens, memos, monitoring updates, QA reviews, or data requests. Default to a polished standalone HTML lender underwriting memo for `initial_credit_screen` and `underwriting_memo` work when context supports it; use shorter chat screens only when the user explicitly asks for early triage, quick go/no-go, or a narrow update to an existing package.

## Table Of Contents

- [Output Posture Labels](#output-posture-labels)
- [Standard Output Contract](#standard-output-contract)
- [Full Credit Memo](#full-credit-memo)
- [Explicit Quick Credit Screen](#explicit-quick-credit-screen)
- [Portfolio Monitoring Update](#portfolio-monitoring-update)
- [QA Review](#qa-review)
- [Data Request Format](#data-request-format)
- [Final Self-Check](#final-self-check)
- [Structured Downstream Handoffs](#structured-downstream-handoffs)

## Output Posture Labels

End with one posture label:

- `screening-only`: useful for early decision, not committee-ready.
- `diligence-grade`: supportable with named evidence gaps and conditions.
- `committee-ready-with-caveats`: memo can support committee discussion, subject to listed caveats.
- `not-committee-ready`: material missing data, failed tie-outs, or unresolved conflicts block decision use.
- `decline-recommended`: risks, structure, leverage, liquidity, or evidence gaps make the deal unattractive absent major changes.

## Standard Output Contract

Unless the user asks for another format, use this structure:

1. `Recommendation and posture`
2. `Borrower snapshot`
3. `Sources and evidence base`
4. `Transaction overview`
5. `Earnings base and QoE view`
6. `Credit metrics`
7. `Lender case and downside`
8. `Covenants, liquidity, and debt service`
9. `Collateral, recovery, and sponsor support`
10. `Key risks and mitigants`
11. `Required Before Credit Committee` as one prioritized gating table
12. `Decision summary and source/evidence appendix`

For an explicitly requested quick screen, compress sections 2-10 into a one-page style memo but keep recommendation, evidence base, metrics, risks, and next asks.

For an initial screen or narrative underwriting memo, use one prioritized `Required Before Credit Committee` table and one source/evidence appendix. Do not append a second generic diligence module or a dashboard shell around the memo.

For an `initial_credit_screen`, use a diligence-stage recommendation: `proceed-to-diligence-only`, `pass-on-diligence`, or `decline`. Do not use `proceed-with-conditions` unless the work has advanced to a supportable proposed credit structure.

In reader-facing HTML, describe evidence naturally (`SEC-reported`, `management forecast`, `illustrative assumption`, `analyst calculation`, `not provided`) and keep internal evidence taxonomy codes in the appendix or support artifacts rather than displaying raw code pills throughout the memo.

## Full Credit Memo

```markdown
# [Borrower] Private Credit Underwriting Memo

## Recommendation and posture
- recommendation: [proceed / proceed-with-conditions / revise-structure / decline / monitor]
- output posture: [screening-only / diligence-grade / committee-ready-with-caveats / not-committee-ready / decline-recommended]
- proposed exposure: $[x]
- facility: [type]
- debt sizing conclusion: [supportable debt, if fully underwritten / illustrative standalone cash-interest screening ceiling, if public target-only screen]
- key condition: [most important condition]

## Borrower snapshot
[business model, revenue drivers, ownership, sponsor, end markets, concentration]

## Sources and evidence base
| Source | Date / period | Reader-facing support status | Use | Limitation |
|---|---|---|---|---|

## Transaction overview
| Item | Detail |
|---|---|
| Borrower | |
| Sponsor / owner | |
| Use of proceeds | |
| Facility | |
| Pricing / fees | |
| Maturity | |
| Collateral / guarantees | |
| Covenants | |

## Earnings base and QoE view
| EBITDA basis | Amount | Source | Treatment |
|---|---:|---|---|
| Reported EBITDA | | | |
| Company adjusted EBITDA | | | |
| QoE-supported adjusted EBITDA | | | |
| Normalized EBITDA | | | |
| Lender-after-haircut EBITDA | | | |
| Covenant EBITDA | | | |

## Credit metrics
| Metric | Base | Lender case | Downside | Severe downside | Covenant / threshold | Comment |
|---|---:|---:|---:|---:|---:|---|

## Lender case and downside
[stress assumptions, first breakpoints, liquidity trough, covenant pressure]

## Covenants, liquidity, and debt service
[covenant headroom, revolver availability, cash balance, debt maturity]

## Collateral, recovery, and sponsor support
[collateral value, lien, recovery cushion, sponsor equity, sponsor support]

## Key risks and mitigants
| Risk | Severity | Evidence | Impact | Mitigant / condition |
|---|---|---|---|---|

## Required Before Credit Committee
| Priority | Ask / condition | Why it matters | Owner / source | Required before |
|---|---|---|---|---|

## Decision summary
[one-paragraph conclusion]
```

For acquisition financing where only target-company public information is available, label any target-only debt-service calculation as an `illustrative standalone cash-interest screening ceiling`. State that no combined-borrower underwriting or hold-size conclusion is supportable without acquirer/parent financials, sources and uses, and committed debt terms. Show a cash-flow downside dimension before presenting the ceiling as decision-useful.

Treat disclosed committed acquisition financing as transaction-execution context only until debt terms and combined-borrower effects are underwritten; it is not a credit attraction or lender protection by itself.

For standalone HTML, prioritize a readable recommendation, key facts, downside, and committee gates over dashboard navigation, export controls, or duplicated module shells. Render and inspect the memo through local headless-browser screenshots before delivery.

## Explicit Quick Credit Screen

```markdown
## Recommendation
[proceed-to-diligence-only / pass-on-diligence / decline]

## Why this could work
- [credit strength]
- [repayment source]
- [structure support]

## Why this could fail
- [risk]
- [risk]
- [risk]

## Numbers that matter
| Metric | Value | Source / basis | Caveat |
|---|---:|---|---|

## Diligence required before committee
| Priority | Item | Reason |
|---|---|---|
```

## Portfolio Monitoring Update

```markdown
# [Borrower] Monitoring Update

## Status
- rating / watchlist: [status]
- trend: [improving / stable / deteriorating]
- action: [continue / increase monitoring / amendment / reserve / exit]

## KPI and financial update
| Metric | Current | Prior | Budget | Covenant | Comment |
|---|---:|---:|---:|---:|---|

## Liquidity and covenant watch
[headroom, liquidity trough, first breach risk]

## Risks, actions, and next report
[action items]
```

## QA Review

```markdown
## Readiness verdict
[committee-ready / diligence-grade / not committee-ready / blocked]

## Critical issues
| Severity | Issue | Why it matters | Evidence needed | Fix |
|---|---|---|---|---|

## Metric tie-out
| Metric | Presented | Source / recalculated | Status | Comment |
|---|---:|---:|---|---|

## Covenant and liquidity checks
[definition source, headroom, first breach, proxy caveats]

## Required fixes before reliance
[ordered list]
```

## Data Request Format

```markdown
| Priority | Needed item | Why it matters | Affected conclusion | Minimum substitute |
|---|---|---|---|---|
```

## Final Self-Check

- Used available attachments, callable connected routes, user-provided exports, and primary sources before asking for more.
- Labeled source limitations and evidence posture.
- Used diligence-stage recommendation language for an initial screen rather than approval-stage `proceed-with-conditions`.
- Kept raw internal evidence taxonomy out of reader-facing narrative and core tables.
- Did not treat committed transaction financing as a credit strength without underwritten combined-borrower terms.
- Distinguished reported, adjusted, normalized, lender, and covenant EBITDA.
- Did not treat management or seller add-backs as facts without support.
- Included downside and liquidity, not just base-case leverage.
- Tied covenant conclusions to actual definitions or labeled them as proxies.
- Identified first loss / first breach / first liquidity-pressure driver when relevant.
- Gave a recommendation appropriate to the stage: diligence action for an initial screen or proceed / decline / proceed-with-conditions for an underwritten credit view.
- Listed exact next documents or fields required to improve reliability.

## Structured Downstream Handoffs

Use `../../../references/handoff-contracts.md` when a credit output feeds adjacent workflows:

- `private_credit_underwriting_to_covenant_package_analyzer`: covenant definitions, ratio definitions, threshold/headroom questions, collateral/guarantee concerns, lender protections, and counsel-review flags.
- `private_credit_underwriting_to_distressed_recovery_waterfall`: watchlist/default trigger, debt stack, liquidity trough, first breakpoint, lien/collateral summary, recovery range, sponsor support, and restructuring alternatives to test.

Keep lender-after-haircut EBITDA, covenant EBITDA proxy, selected EBITDA basis, headroom/proxy headroom, and first-breach/breakpoint as separate fields.
