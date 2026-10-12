# Output Templates

Use these templates flexibly. Adapt section names to the user's request, but preserve the underlying fields.

## Table of Contents

- [1. Standalone HTML buyer-universe report](#1-standalone-html-buyer-universe-report)
- [2. Executive summary](#2-executive-summary)
- [3. Ranked table columns](#3-ranked-table-columns)
- [4. Top-call notes](#4-top-call-notes)
- [5. Sensitive-party and hold table](#5-sensitive-party-and-hold-table)
- [6. Outreach wave plan](#6-outreach-wave-plan)
- [7. Pre-outreach decisions](#7-pre-outreach-decisions)
- [8. Tracker-ready export](#8-tracker-ready-export)
- [9. Refresh/change-log output](#9-refreshchange-log-output)

## 1. Standalone HTML buyer-universe report

Use this structure when HTML is requested or selected for a pitch-stage, prioritization, or outreach-sequencing deliverable. Follow `../../../references/html-artifact-standard.md`.

1. **Process recommendation.** State the process posture, conditional first wave, high-value holds, and client/MD decisions required before outreach.
2. **Outreach sequencing.** Use one wave-and-gates table for the disclosure protocol, approvals, validation needs, and sequencing rationale.
3. **Prioritized buyer universe.** Present one central ranked table focused on tier/wave, thesis, ability-to-transact evidence or validation need, information-control handling, next action, and confidence.
4. **Sensitive parties and holds.** Consolidate restricted, held, and excluded buyers with reconsideration triggers and approval gates.
5. **Pre-outreach decisions.** Combine client approvals, legal/compliance checks, relationship validation, sponsor-capacity validation, and other gating diligence in one action table.
6. **Evidence and limitations.** Explain whether the report is public-source, preliminary, client-ready, or otherwise constrained, then provide readable source notes.

Avoid a generic dashboard shell, related-file panels, repeated call-sheet and diligence tables, and visible renderer support files. In the standalone HTML report, keep the central ranked table focused on actionable or conditionally actionable parties; normally place held or excluded sensitive parties only in the dedicated hold register, unless direct comparison is important to the decision. Include numerical scoring in the first-read report only when the user asks for it or it changes a decision; otherwise keep it in a supporting analytical schedule or workbook.

## 2. Executive summary

```markdown
# Buyer / Investor Universe: [Company or Project]

## Executive summary
- Recommendation: [targeted / broad / two-stage / quiet / lender-first / sponsor-first process]
- Universe: [x] tier 1, [y] tier 2, [z] tier 3/watchlist, [n] hold/exclude.
- Highest-probability demand: [strategic category / sponsor platforms / lenders / investors].
- Highest valuation potential: [party types or named parties].
- Highest execution certainty: [party types or named parties].
- Key risks: [confidentiality, antitrust, financing, conflicts, timing, process fatigue].
- Recommended first wave: [summary].
- Decisions needed from client/MD: [do-not-contact, competitor outreach, valuation vs certainty, timing].
```

## 3. Ranked table columns

Use these columns for an operational workbook or full analytical schedule. For the standalone HTML first read, favor the starred decision columns and demote detailed scoring fields unless specifically requested.

| Column | Description |
|---|---|
| Rank | Overall priority after risk adjustment. |
| Tier / wave* | Tier 1, Tier 1 controlled, Tier 2, Tier 3, watchlist, hold, or exclude plus recommended sequencing. |
| Party* | Canonical institution name. |
| Party type | Strategic, sponsor, platform, lender, family office, growth equity, pipe investor, etc. |
| Relevant unit/fund/platform | Business unit, fund, lender affiliate, or portfolio company that matters. |
| Rationale* | Specific reason the party should care. |
| Ability to transact or validate* | Supported capacity evidence, or the precise validation needed before outreach. |
| Evidence | Specific support from materials, connected source, data source, filing, news, or inference. |
| Strategic/mandate fit | High/medium/low plus short explanation. |
| Structure fit | Control, minority, debt, preferred, distressed, asset sale, pipe, etc. |
| Valuation posture | Premium, market, disciplined, low-price likely, unknown. |
| Execution certainty | High/medium/low. |
| Confidentiality/regulatory handling* | Required disclosure protocol, approval gate, clean team, or hold rationale. |
| Relationship owner | Banker/team/person if known. |
| Key contact | Verified decision maker or `requires validation`. |
| Outreach angle | Message theme for first call/email. |
| Next action* | Validate, seek approval, approach conditionally, hold, or exclude. |
| Source/confidence* | Source type and confidence level. |
| Raw / final score | Working analytical schedule only by default; do not let a score imply approval, interest, or capacity. |

## 4. Top-call notes

```markdown
## Top priority calls

### 1. [Party]
- Why they matter: [specific thesis]
- Why they can transact: [capacity/mandate]
- What they need to believe: [key underwriting point]
- Key risk: [confidentiality/regulatory/valuation/financing/etc.]
- Best outreach path: [relationship owner/contact]
- Recommended approach: [blind teaser / named teaser / MD call / sponsor coverage call]
```

Use this when an MD asks "who should I call first?" or when relationship approach materially changes the recommendation. Do not add it as a second retelling of the central ranked table when it provides no new decision information.

## 5. Sensitive-party and hold table

| Party | Status | Sensitivity / reason | Required handling | Reconsideration trigger | Approval needed |
|---|---|---|---|---|---|
| [Name] | Conditional/Hold/Exclude | [Specific concern] | [Blind teaser / NDA / clean team / none] | [Event that changes status] | [Client/legal/MD] |

Never omit obvious but excluded names without explaining them somewhere.

## 6. Outreach wave plan

| Wave / status | Purpose | Parties | Disclosure approach | Required validation / approval | Timing / gating item |
|---|---|---|---|---|---|
| Wave 0 | Validate appetite quietly | [Names/archetypes] | Blind/no-name sounding | MD/coverage | Before broad launch |
| Conditional Wave 1 | Highest value/probability after required checks | [Names] | Teaser/NDA as appropriate | [Capacity/conflict/client approval] | Only after identified gates clear |
| Wave 2 | Broader tension/backups | [Names] | Standard process | [Owner] | After wave 1 feedback |
| Hold | Sensitive/conditional | [Names] | None until approved | MD/client/legal | Trigger needed |

Do not present a candidate as cleared for first-wave outreach if ownership, capacity, conflicts, relationship path, or client/legal authorization remains unverified.

## 7. Pre-outreach decisions

Use one consolidated table instead of separate open-diligence and validation registers.

| Priority | Decision or validation required | Affected parties / process step | Why it matters | Owner / approval gate |
|---|---|---|---|---|
| Critical | [Client do-not-contact list] | [All waves] | [Overrides recommendation] | [Client / MD] |

## 8. Tracker-ready export

Use when handing off to `deal-process-tracker`:

- Party
- Party type
- Tier
- Wave
- Relationship owner
- Key contact
- Outreach status
- NDA status
- Materials sent
- Last touch
- Next action
- Next action owner
- Due date
- Risk flags
- Rationale
- Source/confidence
- Notes

## 9. Refresh/change-log output

When refreshing an existing list, include:

| Change type | Party | Prior status | Proposed status | Reason | Source/confidence |
|---|---|---|---|---|---|
| Add | [Name] | Not on list | Tier 2 | [Reason] | [Source] |
| Retier | [Name] | Tier 1 | Hold | [Reason] | [Source] |
| Validate | [Name] | Unknown | Watchlist | [Reason] | [Source] |

Do not delete. Use `proposed_remove_from_active_outreach = yes` if a party should be removed from the active process.
