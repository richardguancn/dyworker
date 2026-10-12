# Quality Checks

Run these checks before finalizing a tracker, update, spreadsheet, client summary, board update, or recommendation.

## Completeness checks

- Every buyer has a normalized buyer name and buyer type or is marked unknown.
- Every active buyer has current stage, status, last interaction date, next action, owner, and confidence.
- Every open issue has owner, due date/timing, impact, severity, and recommended action.
- Every diligence request has category, status, owner, and sharing restriction where relevant.
- Every critical deadline has date/time/timezone where available, source, owner, and status.
- Every bid value has source and confidence.
- Every recommendation is traceable to facts, inferences, or explicit assumptions.

## Data preservation checks

- No original rows, notes, bid values, or pass reasons were removed unless explicitly requested.
- Existing workbook formulas/formatting were preserved where possible.
- Duplicates were flagged, not merged/deleted, unless user confirmed.
- Prior statuses were captured in the change log when updated.
- Aliases were preserved when buyer names were normalized.

## Source and confidence checks

- Material dates and deadlines cite/source back to process letter, email, calendar, tracker, or user instruction.
- Inferred buyer temperature is labeled as inferred.
- Conflicting sources are not resolved silently.
- High-impact unresolved items are marked needs human review.
- Public web facts, if used, are cited and separated from deal-confidential sources.

## Confidentiality and legal-process checks

- No buyer is shown as approved for CIM/data-room access without NDA/access basis or explicit user instruction.
- Competitor/strategic buyers have clean-team/restricted-access status where relevant.
- Sensitive categories are flagged: customer, pricing, employee, contracts, technology, legal, product, MNPI.
- NDA/legal issues are framed as process implications unless the user explicitly asks for legal analysis and appropriate legal workflow is available.
- Public-company or board-sensitive process issues flag counsel/human review.
- Inconsistent information access, deadline extensions, or bidder treatment are flagged as potential process-fairness issues.

## Process-momentum checks

- Buyers with no touchpoint for more than the expected follow-up window are flagged as stale/cooling.
- NDA stuck items show whether the bottleneck is buyer, seller, counsel, or unknown.
- Buyers with CIM/data-room access but no activity are flagged.
- Upcoming bid deadlines are reconciled against open diligence and unanswered buyer questions.
- Management meeting status is not treated as complete unless source supports completion.
- Extension requests are tied to buyer credibility and process strategy.

## Bid and decision checks

- Bids are compared on risk-adjusted value, not headline price alone.
- Financing, approvals, conditionality, regulatory risk, timing, and diligence burden are captured or marked unknown.
- LOIs/final bids with unclear economics are marked not fully comparable.
- Exclusivity recommendations consider backup bidder warmth and remaining leverage.
- Recommendation explicitly states advance/hold/drop/request clarification/exclusivity candidate when relevant.

## Output-quality checks

- MD summary leads with bottom line, not a data dump.
- Client-ready summary removes internal speculation and uses controlled language.
- Tables are not overloaded with irrelevant columns for the audience.
- Open questions are prioritized by decision impact.
- Next actions are specific: owner + action + timing + reason.
- The final output states assumptions and limitations clearly.

## Workbook usability checks

- The first visible tab is an executive `Dashboard` that answers the process question before the reader navigates the operating tabs.
- Long operating tabs use frozen header rows and filters or structured tables where feasible.
- The workbook has a readable source register, and material process claims, values, deadlines and recommendations map to source IDs or source notes.
- A live-process tracker retains editable owner, status, next-action and change-log fields; a public-process reconstruction does not invent these fields where the filing does not support them.
- A native chart or compact visual is included when funnel, bidder attrition, timing or price progression data makes it decision-useful.
- The workbook is rendered and visually inspected for its executive `Dashboard` and material detail tabs; fix clipped headers, unreadable row height, broken charts and illegible source notes before delivery.

## Public-process reconstruction checks

- Scope states that the workbook reconstructs publicly disclosed events and does not assert undisclosed communications or legal conclusions.
- Disclosed facts are separated from banker inference, recommendations and counsel-review flags.
- Bidder progression, access gates, formal deadlines, go-shop/no-shop mechanics where applicable, and the point of weakened competitive tension are visible.
- Contractual restrictions or differential-access observations are framed for counsel review rather than characterized as legal conclusions.
- Narrative HTML or board-memo requests are routed to `memo-builder`; this skill does not create an automatic HTML dashboard or render contract for its workbook.

## Common failure corrections

- If many fields are unknown, keep the tracker structure but add a setup questions section.
- If buyer status is stale, do not leave as active; use active but stale / cooling / needs follow-up.
- If NDA is not executed, block or flag material access fields.
- If user asks for a clean client version, remove internal labels such as process tourist, likely no-bid, or retrade risk unless softened and supported.
- If there is not enough evidence for MD recommendation, provide a provisional recommendation and list the information needed to firm it up.
