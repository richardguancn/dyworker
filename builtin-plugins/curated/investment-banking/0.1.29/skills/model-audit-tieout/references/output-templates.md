# Output Templates

## Table Of Contents
1. Full workbook audit-pack layout
2. Rapid screen template
3. Full audit memo template
4. Issue log row format
5. Formula exception format
6. Source tie-out ledger format
7. Decision-readiness language
8. Follow-up remediation output

## Full workbook audit-pack layout

Use this as the normal hero deliverable for a substantive review of an existing model. Follow `../../../references/workbook-first-tab-standard.md`; keep raw scan inventories, machine-readable outputs, and rendering evidence as support artifacts.

| Tab | Purpose | Must answer |
|---|---|---|
| `Executive Summary` | First read for the transaction team | Is the source model ready for the stated use, what breaks reliability, and what must be fixed next? |
| `Output Bridge` | Formula-driven diagnostic of identified material errors | How do reported outputs change under the minimum audit-indicative correction, and what remains unresolved? |
| `Issue Log` | Risk-ranked findings and ownership | Which errors or evidence gaps matter most, where do they occur, and who fixes them? |
| `Source Tie-Out` | Evidence ledger | Which model inputs and claims tie to primary sources, remain assumption-led, conflict, or were not tested? |
| `Formula Controls` | Mechanical and manual logic tests | What static checks passed, which apparent PASS checks are inadequate, and which core logic tests fail? |
| `Model Map` | Original workbook map and output paths | Where do headline outputs and decision drivers originate? |
| `Scope / Evidence / Limitations` | Reliance boundary | What was reviewed, what was not recalculated or remediated, and what further diligence is required? |

The first sheet should separately state:

- **Audit pack status:** whether the audit work requested is complete, partial, or blocked.
- **Audited model readiness:** `ready for decision`, `ready with caveats`, `not ready`, or `not assessable`.
- **Reliance boundary:** the audit workbook does not alter the supplied model unless remediation was explicitly requested.

When the audit identifies a quantifiable output failure, use an `Output Bridge` with reported versus `audit-indicative` results, formula or source provenance, and a conspicuous note listing corrections not yet incorporated. If an executive-summary metric includes both an incorporated diagnostic adjustment and a remaining unresolved gap, show them as separately labeled amounts; do not collapse both concepts into a single `Change / gap` column.

## Rapid screen template

```markdown
# Model Audit Rapid Screen: [model/company/deal]

## Readiness posture
**Status:** [green/yellow/red/gray]
**Decision use:** [ready / ready with caveats / not ready / not assessable]
**Scope reviewed:** [workbook tabs, source docs, outputs, limitations]

## Top issues
| severity | issue | location | decision impact | fix |
|---|---|---|---|---|
| [critical/high/etc.] | [finding] | [tab/cell/source] | [impact] | [action] |

## What appears solid
- [area]
- [area]

## Must-fix before use
1. [fix]
2. [fix]
3. [fix]

## Open questions / missing files
- [question]
```

## Full audit memo template

```markdown
# Model Audit Tie-out Memo: [model/company/deal]

## Executive summary
[3-6 bullets on model readiness, major issues, source support, and decision impact.]

## Decision-readiness posture
**Posture:** [ready for decision / ready with caveats / not ready / not assessable]
**Audit pack status:** [complete / partial / blocked]
**Reason:** [brief explanation]
**Reviewed for:** [ic, credit committee, client deck, diligence, earnings, trading, board, etc.]
**Materiality lens:** [what would change the decision]

## Model overview
| item | assessment |
|---|---|
| model type | [dcf/lbo/3-statement/etc.] |
| workbook / files reviewed | [file names] |
| key output(s) | [outputs] |
| key tabs | [tabs] |
| source documents reviewed | [sources] |
| limitations | [what was not reviewed] |

## Priority issue log
| severity | category | location | finding | why it matters | recommended fix | owner |
|---|---|---|---|---|---|---|
| [critical/high/etc.] | [category] | [tab/cell/doc] | [finding] | [impact] | [fix] | [owner] |

## Formula and workbook controls
- **Formula consistency:** [findings]
- **Hardcodes:** [findings]
- **External links / hidden tabs:** [findings]
- **Checks:** [findings]
- **Circularity / volatility:** [findings]

## Source tie-out findings
| output_or_driver | model_location | model_value | source | source_value | tie_status | evidence_label | decision_impact |
|---|---|---:|---|---:|---|---|---|
| [driver] | [tab/cell] | [value] | [source] | [value] | [ties/etc.] | [label] | [impact] |

## Assumption and scenario critique
- **Base case:** [support and concerns]
- **Downside case:** [support and concerns]
- **Upside case:** [support and concerns]
- **Sensitivities:** [true drivers vs missing drivers]

## Recommended remediation sequence
1. [critical fix]
2. [high fix]
3. [medium fix]

## Diligence asks
- [source request]
- [management/seller/lender/provider question]

## Appendix: scope and method
[Briefly describe workbook inspection, source documents reviewed, manual checks, and limitations.]
```

## Issue log row format

Use this format for every issue:

```markdown
| severity | category | location | finding | why it matters | recommended fix | owner |
|---|---|---|---|---|---|---|
| high | formula_integrity | Debt Schedule!F42 | revolver paydown formula breaks in the downside case | understates liquidity trough and covenant pressure | correct formula across forecast periods and rerun downside | analyst |
```

## Formula exception format

```markdown
| sheet | cell | issue | formula/value | recommended review |
|---|---|---|---|---|
| [sheet] | [cell] | [hardcoded number in formula / external link / volatile function / inconsistent formula] | `[formula]` | [action] |
```

## Source tie-out ledger format

```markdown
| output_or_driver | model_location | model_value | source_name | source_location | source_value | tie_status | variance | evidence_label | as_of_date | decision_impact | recommended_action |
|---|---|---:|---|---|---:|---|---:|---|---|---|---|
| [driver] | [tab/cell] | [value] | [source] | [page/table] | [value] | [ties] | [variance] | [label] | [date] | [impact] | [action] |
```

## Decision-readiness language

Use direct language:
- "the model is not ready for ic use until the debt schedule and source tie-outs are fixed."
- "the audit pack is complete for internal review; the audited source model is not ready for reliance until the identified output bridge failures are remediated."
- "the valuation output appears mechanically coherent, but the margin and terminal-value assumptions are assumption-led and need sensitivity support."
- "the model can be used for a preliminary screen, but not for a final investment recommendation."
- "the credit case is blocked by missing covenant definitions and unsupported add-backs."

Avoid vague language:
- "looks fine"
- "probably okay"
- "minor issues" when severity is unknown
- "audited" unless a real audit was performed by qualified auditors

## Follow-up remediation output

When the user asks to fix issues after the audit, provide:

```markdown
# Remediation Plan

## Changes I recommend making now
1. [change]
2. [change]

## Changes requiring user/source confirmation
1. [change]
2. [change]

## Changes I would not make without senior review
1. [change]
2. [change]

## Files or data needed
- [file]
```

If actually editing the workbook, preserve raw/source tabs where possible and document every changed cell/range.
