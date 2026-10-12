# Quality Checks And Examples

Use this reference before calling a memo senior-review-ready or final-circulation-candidate, and whenever the user asks for a QA review of an existing memo.

## Table Of Contents

- [Quality Bar](#quality-bar)
- [Memo QA Checklist](#memo-qa-checklist)
- [QA Review Mode](#qa-review-mode)
- [Final Response Format](#final-response-format)
- [Examples](#examples)

## Quality Bar

- Lead with the decision, not background.
- Name the audience and circulation posture.
- Include only facts and analysis supported by the source packet or labeled assumptions.
- Tie all model-driven conclusions to the relevant model, scenario, date, and status.
- Make the downside concrete: shock, transmission, constraint, and consequence.
- Separate open diligence items from known risks.
- Use concise banker prose.
- Avoid generic adjectives such as compelling, best-in-class, attractive, or robust unless the evidence proves the claim.
- Do not call anything final until `ib-deck-qc` has reviewed it if it will circulate externally, to a board, to a committee, or to lenders.
- For an HTML memo, follow `../../../references/html-artifact-standard.md` and keep internal render/control mechanics out of the first-read page.

## Memo QA Checklist

Before delivering a draft, check:

- Sources: material claims tie to source packet, source date, model output, or explicit assumption.
- Filing-only rationale: strategic logic is labeled `disclosed`, `stated`, or `board-considered` unless independent diligence supports stronger validation language.
- Numbers: valuation ranges, EBITDA, revenue, FCF, debt terms, multiples, leverage, covenant headroom, and process counts are consistent with the cited source or model.
- Scenarios: base/downside/upside conclusions match the correct model scenario and model status.
- Claims: the memo's 3-5 load-bearing claims have evidence, disconfirmers, caveats, or open diligence items.
- Risks: downside transmission is concrete enough for the audience to act on.
- Open items: missing source support, stale data, unresolved diligence, owner, and due date are visible.
- Audience fit: client, board, committee, lender, and internal drafts use the right level of caveat, recommendation, and next-step specificity.
- Handoff: final-circulation candidates are routed to `ib-deck-qc`; style changes wait until content is correct.
- HTML presentation: the opening viewport makes the recommendation, reliance posture, and decision hinge immediately clear; the report does not expose dashboard contracts, generic reader-action chrome, or support files as analysis.
- Visual inspection: render the local HTML using local headless-browser screenshots and review the opening view plus key projection/risk/diligence sections for legibility, clipping, density, and citation noise.

## QA Review Mode

Return findings first:

1. Critical and high-severity issues.
2. Missing source support or broken model tie-outs.
3. Weak logic, unsupported claims, or bad audience fit.
4. Downside, risk, and open-item gaps.
5. Readiness verdict and exact edits needed.

Severity-order the findings. Give the readiness verdict as `blocked`, `screen-grade`, `senior-review-ready`, `client-draft`, or `final-circulation-candidate` only if the evidence supports that posture.

## Final Response Format

When returning a completed memo in chat:

1. State memo mode, audience, circulation posture, source scope, and date.
2. Link the standalone HTML hero deliverable first and mention a DOCX companion only when generated or requested.
3. List material open items and whether `ib-deck-qc` is required before circulation.

When returning a QA review:

1. Findings first, severity ordered.
2. Readiness verdict.
3. Required fixes.
4. Suggested downstream handoff.

## Examples

These examples show format and evidence posture only. Do not treat the sample facts as real facts.

### Memo Plan Stub

```markdown
memo_type: financing-memo
audience: CFO and sponsor deal team
circulation: client draft
decision_or_question: whether to launch a private credit process before final QofE
source_scope: management model dated [date], lender feedback tracker dated [date], diligence notes dated [date]
source_as_of_dates: financials through [period]; lender feedback as of [date]
model_outputs_used: downside liquidity case from [model name/version/status]
key_numbers_to_tie: adjusted EBITDA, FCF, leverage, covenant headroom, proposed facility size
open_items: final QofE bridge, NWC peg, customer concentration support
recommended_next_step: confirm lender target list and diligence package gaps
ib_deck_qc_required: yes
```

### Evidence Labels

- Reported fact: `[Metric] per audited financials / management financials dated [date]`.
- Management claim: `Management stated [claim] in [meeting/material] dated [date]; not yet independently diligenced`.
- Seller claim: `Seller materials indicate [claim]; supporting backup not yet provided`.
- Model output: `[Result] per [model name/version], [scenario], [status], dated [date]`.
- Banker judgment: `Based on [evidence], the key implication is [judgment]; caveat [limitation]`.
- Assumption: `Assume [assumption] for memo framing pending [source/diligence item]`.

### Open Items Disclosure

```markdown
Open Items
- Source support: [missing metric/source] remains unverified, so the valuation implication is directional.
- Model tie-out: downside liquidity case uses [scenario/date]; update once the revised model is available.
- Diligence: [red flag] needs [proof/source] before committee circulation.
```

### Readiness Verdict

```markdown
Readiness verdict: senior-review-ready.
Rationale: the decision frame, key numbers, and downside case are sourced, but the memo still needs MD/client-team review and `ib-deck-qc` before any client, committee, board, or lender circulation.
```
