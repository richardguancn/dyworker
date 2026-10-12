# Dashboard Citation Readiness Policy

Use this policy for every Investment Banking HTML report, dashboard, or hybrid package rendered through `dashboard-builder`.

## Readiness Postures

Draft-tolerant postures may render with citation warnings:

- `draft`
- `screen-grade`
- `preliminary`
- `working_draft`
- `source-caveat`

Hard-fail postures must not render with material citation gaps:

- `senior-review-ready`
- `client-ready`
- `committee-ready`
- `board-ready`
- `external`
- `lender-ready`
- `final-circulation-candidate`

If a contract uses a mixed label, the stricter interpretation controls. For example, `committee-ready-with-caveats` is still committee-ready and must pass citation validation.

## Material Citation Failures

For hard-fail postures, `dashboard-builder` blocks rendering when it finds:

- unresolved `citation_ids`, `source_ids`, bracket citations, or `source_id` references;
- material numeric text without inline citation support;
- a missing source register for a senior/client/committee/board/external-ready output;
- model-derived metrics without a source ID or workbook-cell/range citation when the model citation ledger is available;
- date-sensitive claims without source or as-of support.

## Accepted Draft Gaps

If the user explicitly accepts draft status, pass `--accept-draft-citation-gaps` and provide `--citation-gap-acceptance-reason`, or set equivalent contract metadata:

```json
{
  "metadata": {
    "accept_draft_citation_gaps": true,
    "citation_gap_acceptance_reason": "User requested a draft review copy before source IDs are repaired."
  }
}
```

The renderer must then downgrade the visible readiness posture to `Draft With Citation Gaps` and mark the output as not for external circulation. Do not use this override to preserve a senior/client/committee/board/external-ready label.

## Source Skill Rule

Source skills own the analytical content and source mapping. Before sending a contract to `dashboard-builder`, they should either:

- add source-specific inline citation support for every material number, estimate, date-sensitive fact, sourced claim, assumption, and recommendation; or
- downgrade the posture to draft/screen-grade and surface the missing evidence as explicit source gaps.
