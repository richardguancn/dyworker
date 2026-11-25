# Risk Rubric

Use this rubric for procurement and commercial execution risks. Keep impact, likelihood of disruption, and confidence in the supporting evidence separate.

## Risk Types

- `procurement_process`
- `legal_terms`
- `security_review`
- `privacy_or_data_governance`
- `budget_or_funding`
- `executive_alignment`
- `stakeholder_coverage`
- `timeline_dependency`
- `technical_dependency`
- `other`

## Severity

- `high`: if the risk materializes, it can block signature or force a material close-date slip.
- `medium`: if the risk materializes, it can delay momentum or require escalation without clearly blocking the deal.
- `low`: limited execution impact if the risk materializes.

## Likelihood

- `high`: current evidence indicates disruption is likely, such as an unresolved blocker or a required step whose expected timing exceeds the remaining window.
- `medium`: a credible path to disruption exists, but its timing, mitigation, or counter-signals leave the outcome uncertain.
- `low`: affirmative evidence supports timely completion or effective mitigation; weak or stale evidence alone does not establish low likelihood.
- `unknown`: there is insufficient evidence to estimate disruption. Identify the smallest check that would resolve it.

A confirmed requirement establishes that the requirement exists, not that it will delay the deal. Assess its progress, expected duration, available time, and mitigation before estimating delay likelihood. Separate resolved conditions from live risks.

## Confidence

Confidence describes the evidence supporting the stated requirement or risk, not the probability of delay. High confidence in a requirement can coexist with unknown or low delay likelihood.

- `high`: corroborated by multiple sources or direct explicit statement from a primary source.
- `medium`: single-source but credible, or partially inferred from clear context.
- `low`: weak, stale, or conflicting evidence.

## Precision Guardrails

- Do not present exact calendar dates unless the date is directly evidenced.
- For low-confidence or sparse-evidence situations, prefer relative timing (`this week`, `next week`, `this month`) or `TBD`.
- Do not present customer-side owners as confirmed unless explicitly supported.
- When customer-side ownership is inferred, label as `Suggested owner`.

## Prioritization

Prioritize next actions by weighing severity, likelihood of disruption, decision urgency, and remaining mitigation needs together. High-severity risks with high or medium likelihood need timely mitigation or checks to resolve material uncertainty. Do not automatically rank a remote, effectively mitigated high-impact risk above an imminent medium-impact risk. Prioritize ownership gaps when they block required work. Monitor low-likelihood risks and reassess if timing, evidence, or mitigation changes.

For high-impact risks with unknown likelihood and a near-term decision, prioritize the timing or ownership check needed to assess exposure; do not silently treat unknown as low.

## Required risk row fields

Each risk row must include:

- `risk_id`
- `risk_summary`
- `risk_type`
- `severity`
- `likelihood`
- `confidence`
- `owner`
- `mitigation`
- `target_date`
- `source`
