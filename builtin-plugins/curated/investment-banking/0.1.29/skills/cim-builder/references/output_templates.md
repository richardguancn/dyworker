# Output Templates

Use these templates as flexible defaults. Adapt to user request, transaction type, sector, available inputs, and whether the output is external-ready or banker-internal.

## Table of contents

- [Initial response template](#initial-response-template)
- [Standalone HTML CIM or storyboard](#standalone-html-cim-or-storyboard)
- [Equity story spine template](#equity-story-spine-template)
- [CIM page plan template](#cim-page-plan-template)
- [Investment highlights template](#investment-highlights-template)
- [Financial exhibit plan template](#financial-exhibit-plan-template)
- [Risk and disclosure matrix template](#risk-and-disclosure-matrix-template)
- [Refresh change log template](#refresh-change-log-template)
- [Missing information request list](#missing-information-request-list)
- [Management follow-up questions](#management-follow-up-questions)
- [External-ready vs internal banker notes](#external-ready-vs-internal-banker-notes)

## Initial response template

Use when starting a CIM build or refresh.

```markdown
# CIM build / refresh plan for [company/project]

## 1. Transaction context
- transaction type:
- seller type:
- buyer universe:
- process objective:
- confidentiality level:
- key assumptions:

## 2. Input completeness
| area | status | confidence | notes / gaps |
|---|---:|---:|---|
| company overview |  |  |  |
| financials |  |  |  |
| KPIs |  |  |  |
| customers |  |  |  |
| market |  |  |  |
| forecast |  |  |  |
| management interviews |  |  |  |

## 3. Equity story spine
[concise narrative]

## 4. Recommended outputs
[what can be drafted now vs what requires more data]

## 5. Immediate data asks
[prioritized list]
```

## Standalone HTML CIM or storyboard

Use this structure when a written CIM, teaser, or CIM storyboard is requested or when format is not otherwise resolved. Follow `../../../references/html-artifact-standard.md`; the result is a polished document owned by `cim-builder`, not a `dashboard-builder` package.

Recommended first-read sequence:

1. Cover, circulation posture, transaction context, and as-of date.
2. Executive story or proposed buyer narrative with clear evidence posture.
3. Transaction perimeter, process status, and any marketing constraint that affects use of the draft.
4. Investment highlights or storyboard rationale.
5. Proposed page flow and key exhibit plan.
6. Supported operating, financial, valuation, or transaction facts relevant to the story.
7. Buyer diligence pressure points and credible framing.
8. Management, counsel, and QC support required before circulation.
9. Source register and readiness conclusion.

Design and content rules:

- Use a document-style hierarchy, restrained color, readable tables, and decision-useful callouts rather than dashboard cards or operational control bars.
- Keep external draft language distinct from internal drafting notes and circulation blockers.
- In a public-source storyboard, label public facts, analytical hypotheses, and unavailable management proof plainly.
- Cite material facts close to their use and retain a concise source register.
- Do not expose render contracts, local implementation paths, manifests, support JSON, or generic `Open report` / `Model file` controls.
- Render and visually inspect the opening view and at least one downstream evidence or readiness section through local headless-browser screenshots before delivery.

## Equity story spine template

```markdown
## Equity story spine

1. Business definition: [one sentence]
2. Customer problem: [pain point and buyer]
3. Why now: [market/regulatory/technology/customer inflection]
4. Why this company wins: [specific defensibility]
5. Financial proof: [metrics and source]
6. Growth runway: [credible levers]
7. Buyer-specific upside: [strategic/sponsor/lender logic]
8. Diligence pressure points: [issues]
9. Recommended framing: [how to present responsibly]
```

## CIM page plan template

```markdown
### Page [#]: [argument-led title]

Purpose:
[why this page exists]

Buyer question answered:
[what underwriting question this page answers]

Key message:
[one-sentence so-what]

Exhibit concept:
[chart, table, map, waterfall, bridge, case study, or diagram]

Required data:
- [data item]

Draft bullets:
- [bullet 1]
- [bullet 2]
- [bullet 3]

Sources:
- [source name, date, location]

Open questions:
- [question]

Diligence / disclosure note:
[buyer pushback, risk, or review need]
```

## Investment highlights template

```markdown
## Draft investment highlights

1. [specific highlight with proof]
   - Evidence: [metric/source]
   - Buyer relevance: [why strategic/sponsor/lender cares]
   - Diligence note: [what must be supported]

2. [specific highlight with proof]
   - Evidence:
   - Buyer relevance:
   - Diligence note:
```

## Financial exhibit plan template

```markdown
| exhibit | purpose | required data | source | open issues |
|---|---|---|---|---|
| revenue bridge | explain growth drivers | revenue by segment/product/customer |  |  |
| EBITDA bridge | tie reported to adjusted EBITDA | EBITDA and add-back schedule |  |  |
| customer concentration | assess durability | top customers and revenue |  |  |
| retention/cohorts | prove revenue quality | customer cohorts |  |  |
| forecast bridge | support management case | forecast drivers |  |  |
```

## Risk and disclosure matrix template

```markdown
| issue | buyer concern | current evidence | recommended external framing | internal note | owner | status |
|---|---|---|---|---|---|---|
| customer concentration | revenue durability |  |  |  |  |  |
| forecast step-up | achievability |  |  |  |  |  |
| add-backs | EBITDA quality |  |  |  |  |  |
```

## Refresh change log template

```markdown
| page / section | old claim or metric | updated claim or metric | reason for change | source | review needed |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
```

## Missing information request list

Prioritize by impact on launch readiness.

```markdown
## Priority 1 - blocks external-ready CIM
- [data / confirmation needed]

## Priority 2 - improves valuation or buyer confidence
- [data / confirmation needed]

## Priority 3 - nice to have / appendix support
- [data / confirmation needed]
```

## Management follow-up questions

```markdown
| topic | question | why it matters | owner | needed by |
|---|---|---|---|---|
| financials |  |  | CFO |  |
| customers |  |  | CRO |  |
| market |  |  | CEO |  |
| operations |  |  | COO |  |
```

## External-ready vs internal banker notes

Always separate these sections:

```markdown
## External-ready language
[language suitable for CIM draft subject to firm/client review]

## Banker-internal notes
[candid diligence risks, process concerns, and recommended follow-up]

## Counsel / compliance review flags
[items requiring review before distribution]
```
