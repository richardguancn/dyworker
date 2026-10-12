# Output templates

## Table of contents
1. Standalone HTML coverage meeting brief
2. Short one-page meeting brief
3. Default detailed meeting prep packet
4. Question list
5. Diligence ask list
6. Talk track
7. No-context fallback
8. Source log
9. Existing-brief review

## 1. Standalone HTML Coverage Meeting Brief

Use when HTML is requested or selected for an introductory coverage, management, CFO, investor-relations, or relationship-development meeting. Follow `../../../references/html-artifact-standard.md`. The artifact should help the banker run a credible conversation and earn a next step, not look like a diligence request list for an active process.

First-read hierarchy:

1. **Meeting objective and recommended posture.** State the relationship objective, why the dialogue matters now, and the appropriate banker stance without implying a financing need, M&A process, or mandate.
2. **Must-know snapshot.** Present a compact set of sourced metrics or strategic facts that shape the conversation, including dates and company-defined metric labels where relevant.
3. **Coverage angles and mandate triggers.** Explain the small number of strategic angles worth testing and what management response would make follow-up work relevant.
4. **Questions to land.** Use one consolidated prioritized table, normally three to five core questions with focused evidence asks. If useful, include no more than two or three conditional follow-up prompts, each tied to a management signal surfaced during the meeting.
5. **Talk track and guardrails.** Include a suggested opening, transition, close, internal-only do-not-say guidance when appropriate, and missing meeting/relationship context to confirm.
6. **Permissioned next step and sources.** Present one recommended permissioned next step. Include no more than two alternatives only when distinct mandate triggers would justify different follow-up work, plus a readable evidence/limitations section.

Do not repeat growth, M&A, and capital-markets questions across three extensive tables when one integrated sequence will run the conversation better. Do not add a generic dashboard shell, related-file controls, visible render inputs, or an exhaustive diligence register solely because the output is HTML.

```markdown
# [Company] | Introductory Coverage Meeting Prep

## Meeting Objective And Recommended Posture
- Relationship objective: [specific next step to earn]
- Recommended posture: [strategic curiosity / validate a defined need / other]
- Do not presume: [mandate, financing requirement, M&A intent, etc.]

## Must-Know Snapshot
| Fact Or Metric | Why It Matters For The Meeting | Source / As Of |
|---|---|---|

## Coverage Angles And Mandate Triggers
| Angle To Test | Current Public-Source View | Signal That Warrants Follow-Up |
|---|---|---|

## Questions To Land
| Priority | Question | Why It Matters | Listening Signal / Follow-Up |
|---:|---|---|---|

## Talk Track, Guardrails And Next Steps
- Open:
- Close:
- Do not say or presume:
- Confirm before meeting:

## Recommended Permissioned Next Step
| Recommendation / Alternative | Follow-Up Work | Owner / Timing | Trigger / Permission Required |
|---|---|---|---|

## Evidence And Limitations
- [readable sources, dates, public-source posture, missing relationship/logistics context]
```

## 2. Short one-page meeting brief
Use when the user explicitly asks for a one-page brief, the meeting is live/time-boxed, or source context is too thin for a full prep packet without false precision.

```markdown
# Meeting prep: [meeting / company / counterparty]

## 1. Objective
- [What we need from the meeting]
- Decision or outcome to drive: [decision / commitment / information / relationship outcome]

## 2. Must-know context
- [Verified fact] ... [source]
- [Verified fact] ... [source]
- [Assumption / inference] ... [why reasonable]

## 3. What matters most
1. [Issue] - [so what]
2. [Issue] - [so what]
3. [Issue] - [so what]

## 4. Questions to ask
1. [Question] - Why it matters: [decision impact]
2. [Question] - Why it matters: [decision impact]
3. [Question] - Why it matters: [decision impact]

## 5. Diligence asks / evidence needed
- [Ask] - Owner/source: [owner] - Needed by: [date if known]

## 6. Likely pushbacks and suggested responses
- If they say: [pushback]
  - Respond with: [response]
  - Follow-up: [question]

## 7. Follow-ups
| Action | Owner | Due | Dependency | Status |
|---|---|---|---|---|
| [action] | [owner] | [date] | [dependency] | [not started] |

## 8. Sources and gaps
- Reviewed: [sources]
- Verify before meeting: [gaps]
```

## 3. Default detailed meeting prep packet
Use by default for substantive transaction, diligence, lender, IC, board, or decision-gate meetings unless the user asks for a shorter form. For introductory coverage or relationship-development meetings delivered as HTML, use the standalone HTML coverage meeting brief above instead.

```markdown
# Meeting prep packet

## Executive view
- Objective:
- Recommended stance:
- Decision needed:
- Highest-risk unknown:
- Best next step:

## Attendees and likely motivations
| Attendee | Role | Likely objective | What they may ask | Prep note |
|---|---|---|---|---|

## Context and source-backed facts
| Fact | Source | Date/version | Confidence | Notes |
|---|---|---|---|---|

## Decision architecture
| Decision / issue | Current view | Evidence | Open question | Recommended next step |
|---|---|---|---|---|

## Question plan
| Priority | Topic | Question | Why it matters | Follow-up if vague | Evidence to request |
|---:|---|---|---|---|---|

## Diligence asks
| Ask | Why needed | Source/owner | Timing | Format | Decision supported |
|---|---|---|---|---|---|

## Talking points
- Opening:
- Transition to main questions:
- Pushback response:
- Close / next-step ask:

## Risks and watch-outs
- Do not say/concede:
- Keep internal only:
- Needs verification:
- Escalate to specialist if:

## Follow-up tracker
| Action | Owner | Due | Dependency | Evidence/source | Status |
|---|---|---|---|---|---|
```

## 4. Question list
Use when the user asks only for questions.

```markdown
## Top questions
1. [Question]
   - Why it matters:
   - Good answer:
   - Concern answer:
   - Follow-up:
   - Evidence to request:
```

## 5. Diligence ask list
Use when the user needs a sendable or internal ask list.

```markdown
## Diligence asks

### Highest priority
| Ask | Purpose | Owner/source | Timing | Notes |
|---|---|---|---|---|

### Nice to have
| Ask | Purpose | Owner/source | Timing | Notes |
|---|---|---|---|---|

### Questions for the call
- [Question]
```

## 6. Talk track
Use for live-meeting readiness.

```markdown
## Suggested talk track
- Open: [one sentence]
- Frame objective: [one sentence]
- Topic 1: [point] -> ask [question]
- Topic 2: [point] -> ask [question]
- Topic 3: [point] -> ask [question]
- Close: [confirm decisions, owners, next steps]
```

## 7. No-context fallback
Use when context is sparse.

```markdown
# Starter meeting prep

## Assumed meeting type
- [Assumption based on user wording]

## Useful objective
- [Likely objective]

## Questions to ask
- [Senior generic question tailored to likely meeting type]

## Context that would improve this most
1. Meeting type and attendees
2. Company/counterparty and objective
3. Any pre-read, model, memo, deck, or prior notes
4. Desired output length and audience

## Caveat
- This is a starter brief because no source materials were provided or available.
```

## 8. Source log
Use when citations are unavailable or a traceable audit trail is needed.

```markdown
| Claim / input | Source | Source type | Date/version | Confidence | Notes |
|---|---|---|---|---|---|
```

## 9. Existing-brief review
Use when reviewing a draft prep packet.

```markdown
## Review summary
- Overall readiness: [ready / needs work / not ready]
- Biggest gap:
- Biggest risk:
- Highest-impact fix:

## Recommended edits
| Section | Issue | Proposed fix | Reason |
|---|---|---|---|

## Missing questions
- [Question] - Why it matters:

## Unsupported or stale claims
| Claim | Issue | Source needed | Action |
|---|---|---|---|
```
