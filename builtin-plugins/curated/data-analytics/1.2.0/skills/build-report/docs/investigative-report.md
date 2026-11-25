# Investigative reports

Apply the [central report principles](../SKILL.md#report-principles). An investigation should help the reader understand the current answer to their original question, how confident to be, which explanations have been examined, and what evidence would change the answer.

## Opening summary

Apply [principle 1](../SKILL.md#report-principles) to the opening summary. Distinguish confidence in the measured pattern from confidence in its explanation. If a narrower metric cannot answer the full question, explain that boundary without losing the original question.

For example, a decline in publishing Data-attributed Sites does not alone establish a decline in all Data use. A good summary connects activity and matched conversion evidence, identifies the transition with the largest deterioration, and explains what remains uncertain about the cause. Avoid repeating the same verdict in the title, a subtitle, a separate answer section, and an adjacent next-action box.

## Hypotheses and evidence

Organize the deeper dive around the key explanations explored. For each material hypothesis, connect the evidence that supports or weakens it to the current conclusion. Distinguish a supported explanation, a ruled-down possibility, and an unresolved hypothesis. Do not manufacture an exhaustive hypothesis list, imply a test was performed when it was not, or present temporal coincidence as a causal result.

For each leading explanation, report the before/after numerator, denominator and rate for the exact population and transition named in the claim. An all-population rate cannot establish a subgroup-specific mechanism; calculate the pooled affected-population rate from summed counts, then show useful splits. Keep the pooled and split comparisons together so the reader can distinguish mix from within-group deterioration.

For mix adjustments, compare raw and adjusted estimates on the same eligible population; across horizons, use cohorts observable at both and apply the same adjustment.

Show dependencies in the visuals. If the question concerns invocation → Site creation → publication, make that sequence and its denominators legible. Compare corresponding transitions across matched cohorts and state where conversion worsened most. Separate before-and-after stage bars or funnels can work; unrelated volume bars indexed to a baseline generally cannot establish conversion. If only independent aggregates exist, label them as such and identify the missing linkage rather than drawing a false funnel.

Use evidence sections to build the same argument as the opening. A table may add cohort eligibility, a hypothesis assessment, or a proposed discriminating test; it need not repeat every chart value. Keep material qualifications next to their affected findings and detailed methods or limitations later.

## Next tests and handoff

Prioritize checks that distinguish the remaining explanations. Say what to inspect, which populations or periods to compare, and how the outcome would affect the decision. For an attribution concern, an audit of outputs from invoked conversations without a linked Site may distinguish missing creation, missing tags, and a different output destination. Tie the proposed test to a primary outcome and named guardrails. Carry measured downstream error/failure rates from the investigation into those guardrails even when they were stable: an intervention can introduce a failure that did not cause the original decline. State the comparison and stop/rollback condition without inventing an acceptable numerical threshold. Do not promise that one test will settle every possible cause.

The report contains this reasoning and supporting evidence. The final chat message gives the high-level answer, a direct report link, and the next useful action, with a material confidence limit when needed. Avoid substituting a list of completed formatting changes, routine validation details, or report sections for the answer. Keep the main report visible through handoff when the host supports it.

Preserve the finding that explains the answer when compressing it for chat. For a conversion investigation, name the transition with the larger deterioration and distinguish it from the downstream transition; “an attribution issue” alone loses that relationship. The final message need not repeat every rate, denominator, or hypothesis from the report.
