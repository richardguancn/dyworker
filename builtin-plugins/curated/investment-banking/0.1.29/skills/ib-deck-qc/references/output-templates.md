# Output Templates

## Table Of Contents

- [Standalone HTML QC report](#standalone-html-qc-report)
- [Fast senior-readout format](#fast-senior-readout-format)
- [Issue log CSV schema](#issue-log-csv-schema)
- [Circulation posture language](#circulation-posture-language)
- [Remediation routing language](#remediation-routing-language)

## Standalone HTML QC report

Use this as the default first-read structure for substantial circulation-gate work delivered as HTML. Follow `../../../references/html-artifact-standard.md`; the report should be a compact banker redline memo rather than a generic dashboard package.

Presentation rules:
- Lead with one circulation verdict and one concise consequence statement.
- Show three to five blocking issues before the full issue register, each with location, why it matters, required fix/support, and owner/route.
- Keep missing support and residual verification limits visible in one compact block.
- Include precise page references and, where it materially speeds review, a small page excerpt or thumbnail for visible critical/high defects.
- Use compact point-of-use citations by paragraph or issue row and a clean source register; avoid citation badges repeated in every table cell.
- Avoid persistent action bars, repeated posture cards, generic dashboard tabs, broad export controls, or visible render-contract machinery.

```markdown
# IB Deck QC

## Executive QC verdict
- Circulation posture: [client-ready | senior-review-ready | needs-targeted-fixes | not-circulable | blocked]
- Circulation audience: [analyst fix pass | VP/director review | MD review | client circulation | buyer/lender circulation | committee/board use]
- Highest severity: [critical | high | medium | low | needs_review]
- Bottom line: [1-3 sentences]
- Banker/client implication: [what must change before the material can be used]

## Missing support / limits to verification
- [missing source, model, instruction, or supporting document; what remains unverified]

## Top issues to fix first
| Priority | Severity | Location | Issue | Why it matters | Required fix / support | Owner / route |
|---:|---|---|---|---|---|
| 1 | high | Slide 7 | FY25E EBITDA differs from valuation summary | impacts multiple and valuation range | tie to model tab Outputs cell X | Deal team / model audit |

## Visual evidence for confirmed blockers
| Issue ID | Page / slide | Visible evidence | Remediation implication |
|---|---|---|---|
| QC-01 | Pages 3-5 | [precise conflicting statements or compact excerpt] | [align approved perimeter throughout] |

## Issue log
| ID | Severity | Type | Confidence | Location | Finding | Evidence | Suggested fix | Owner/route |
|---|---|---|---|---|---|---|---|---|

## Repeated metric / number tie-out
| Metric | Locations | Values found | Unit/period/scenario | Status | Comment |
|---|---|---|---|---|---|

## Source and footnote coverage
| Location | Material data/claim | Source present? | As-of/period present? | Caveat needed? | Status |
|---|---|---:|---:|---:|---|

## Chart and narrative tie-out
| Location | Chart / table | Narrative claim | Tie-out status | Issue / fix |
|---|---|---|---|---|

## Style-guide conformance
| Source package | Visual review status | Key style gaps | Blocks client-ready? | Fix |
|---|---|---|---:|---|

## Banker page logic
| Location | Page title / message | So-what clear? | Decision relevance | Fix |
|---|---|---:|---|---|

## Formatting and readability
| Location | Issue | Suggested fix |
|---|---|---|

## Missing files / open questions
- [source/model/file needed and why]

## Recommended remediation sequence
1. [fix]
2. [fix]
3. [fix]
```

## Fast senior-readout format

Use this only when the user asks for a quick review, top issues, or red flags only:

```markdown
## QC readout
Posture: [posture]

Must fix before circulation:
1. [issue - location - why it matters]
2. [issue - location - why it matters]

Should fix:
1. [issue]
2. [issue]

Looks clean:
- [area reviewed]

Blocked / not verified:
- [missing support]
```

## Issue log CSV schema

Use these columns if producing a CSV issue log:

```text
issue_id,severity,issue_type,confidence,source_file,location,metric_or_claim,finding,evidence,why_it_matters,suggested_fix,owner_route,status
```

## Circulation posture language

Use concise language:
- `client-ready`: no material issues identified; only immaterial polish remains.
- `senior-review-ready`: suitable for MD/PM/partner review with limited marked questions.
- `needs-targeted-fixes`: do not circulate externally until listed fixes are made.
- `not-circulable`: material inconsistencies remain; artifact could mislead decision-makers.
- `blocked`: cannot assess because required source/model files are missing.

## Remediation routing language

Examples:
- `route to model-audit-tieout`: formula/model output issue, not a deck-only issue.
- `route to financial-source-of-truth`: source conflict or stale-data rule needed.
- `route to excel-data-cleaner`: source table is too messy to tie out reliably.
- `route to dcf-model-builder`: valuation model needs rebuild or scenario correction.
- `route to memo-builder`: after fixes, synthesize issue implications for IC.
