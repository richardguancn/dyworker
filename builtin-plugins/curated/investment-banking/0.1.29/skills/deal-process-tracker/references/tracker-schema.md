# Tracker Schema

Use this reference when building or updating structured deal-process trackers, especially spreadsheet-style outputs.

## Table of Contents

- [Default workbook / tracker modules](#default-workbook--tracker-modules)
- [Dashboard fields](#dashboard-fields)
- [Buyer Master fields](#buyer-master-fields)
- [Contacts fields](#contacts-fields)
- [Outreach Log fields](#outreach-log-fields)
- [NDA Tracker fields](#nda-tracker-fields)
- [Document Access / Data Room fields](#document-access--data-room-fields)
- [Management Meetings fields](#management-meetings-fields)
- [Diligence Requests fields](#diligence-requests-fields)
- [Process Calendar fields](#process-calendar-fields)
- [IOI / LOI / Bid Comparison fields](#ioi--loi--bid-comparison-fields)
- [Open Issues / Escalations fields](#open-issues--escalations-fields)
- [Change Log fields](#change-log-fields)
- [Controlled values](#controlled-values)

## Default workbook / tracker modules

Create these modules unless the user asks for a narrower tracker:

1. Dashboard
2. Buyer Master
3. Contacts
4. Outreach Log
5. NDA Tracker
6. Document Access / Data Room
7. Management Meetings
8. Diligence Requests
9. Process Calendar
10. IOI / LOI / Bid Comparison
11. Open Issues / Escalations
12. Change Log
13. Definitions

For chat-only answers, default to an extended command view with the dashboard logic, buyer/funnel status, key risks, source/caveat notes, and next actions. Use compact markdown sections only when the user explicitly asks for a short update, the task is a narrow delta, or a richer workbook/dashboard carries the full tracker. For spreadsheets, use separate tabs and freeze header rows.

## Dashboard fields

| field | purpose |
|---|---|
| deal name | common transaction label |
| client / seller | party being advised |
| asset / company | business being sold or financed |
| transaction type | broad auction, targeted auction, bilateral, carve-out, public-company sale, distressed sale, etc. |
| current phase | preparation, NDA/CIM, first-round, second-round, exclusivity, confirmatory diligence, signing, closing |
| last updated | tracker currency |
| total buyers in universe | overall funnel size |
| buyers contacted | outreach progress |
| ndas sent / executed / stuck | confidentiality gating |
| buyers with cim / data-room access | information distribution |
| active diligence buyers | current process depth |
| management meetings scheduled / completed | buyer seriousness and scheduling load |
| iois / lois / final bids received | bid progress |
| hot / warm / cooling buyers | MD process judgment |
| critical deadlines | next decision points |
| top open issues | process bottlenecks |
| md interventions | senior calls/escalations required |
| client decisions required | seller-side blockers |
| process risk rating | green, yellow, orange, red |

## Buyer Master fields

| field | guidance |
|---|---|
| buyer id | stable unique ID for cross-tab matching |
| buyer name | normalized entity name |
| buyer type | strategic, sponsor, sponsor portfolio company, infrastructure fund, sovereign/pension, family office, existing shareholder, management, other |
| parent / affiliate | capture controlling entity or relevant affiliate |
| geography | buyer HQ or relevant region |
| sector relevance | how buyer maps to the asset |
| prior relationship | client/bank/coverage relationship |
| competitor / customer / supplier | confidentiality and strategic sensitivity |
| strategic rationale | why buyer is in process |
| likely concerns | anticipated diligence/value issues |
| relationship owner | banker or client owner |
| key contacts | primary buyer contacts; link to Contacts tab where possible |
| current stage | use controlled stage list below |
| current status | use controlled status list below |
| last interaction date | most recent source-backed touchpoint |
| days since last activity | formula-driven when possible |
| next action | specific action, not generic "follow up" |
| next action owner | named banker/client/counsel owner |
| next action due | date or explicit timing |
| engagement level | high, medium, low, dormant, unknown |
| buyer temperature | hot, warm, cooling, cold, passed, unknown |
| probability of bid | high, medium, low, unknown |
| probability of close | high, medium, low, unknown |
| md attention required | yes/no plus reason |
| process risk | low, medium, high, critical |
| latest feedback | concise factual buyer feedback |
| banker view | MD-style interpretation and recommendation |
| confidence | confirmed, inferred, unverified, conflicting, needs human review |
| source | link/citation/description of latest source |
| last updated | timestamp/date |

## Contacts fields

| field | guidance |
|---|---|
| buyer id | links to Buyer Master |
| buyer name | normalized buyer |
| contact name | person |
| title | role/seniority |
| role in process | CorpDev, deal partner, legal, financing, operating executive, advisor, etc. |
| email / phone | include only if provided and appropriate |
| seniority | senior decision-maker, execution lead, legal, advisor, junior team |
| relationship owner | banker/client with relationship |
| notes | relationship context, prior deals, communication preference |

## Outreach Log fields

| field | guidance |
|---|---|
| date | communication date |
| buyer id / buyer | entity |
| contact | person contacted |
| banker sender / owner | who reached out |
| outreach type | soft sound, teaser, NDA follow-up, MD call, diligence follow-up, bid deadline reminder, etc. |
| topic | concise subject |
| response / signal | factual response |
| follow-up required | yes/no |
| follow-up owner | person |
| follow-up due | date |
| source | email/chat/calendar/document reference |
| confidence | confirmed/inferred/etc. |

## NDA Tracker fields

| field | guidance |
|---|---|
| buyer id / buyer | entity |
| nda status | not sent, sent, under review, redline received, with counsel, awaiting buyer, executed, rejected, deferred |
| nda sent date | date |
| buyer legal contact | if known |
| counsel owner | seller/bank counsel owner |
| latest redline date | date |
| open nda issues | standstill, non-solicit, affiliates, financing sources, term, representatives, residuals, jurisdiction, etc. |
| business vs legal issue | distinguish process impact |
| clean-team required | yes/no/unknown |
| competitor sensitivity | yes/no/unknown |
| standstill applicable | yes/no/unknown |
| financing-source sharing permitted | yes/no/unknown |
| executed date | date |
| executed document source | link/reference |
| materials access approved | yes/no/conditional |
| next action / owner / due | explicit |
| risk level | low/medium/high/critical |
| confidence | confirmed/inferred/etc. |

## Document Access / Data Room fields

| field | guidance |
|---|---|
| buyer id / buyer | entity |
| teaser sent date | date |
| cim version sent | exact version if known |
| cim sent date | date |
| data-room access granted | yes/no/date |
| access level | standard, restricted, clean-team, legal-only, financial-only, etc. |
| restricted folders | customer, pricing, employee, contracts, technology, legal, etc. |
| process letter version/date | document control |
| management presentation version/date | document control |
| supplemental materials shared | description |
| latest data-room activity | last view/download/advisor added if available |
| access issues | missing NDA, permissions, clean-team, buyer request, etc. |
| source | VDR/export/email reference |
| confidence | confirmed/inferred/etc. |

## Management Meetings fields

| field | guidance |
|---|---|
| buyer id / buyer | entity |
| meeting type | intro, management presentation, diligence call, expert session, site visit, final bidder call |
| requested / scheduled / completed | status |
| date/time/time zone | be explicit |
| buyer attendees | names/titles |
| seller attendees | management/bankers |
| seniority signal | senior decision-maker present? |
| key questions | focused diligence themes |
| follow-up items | buyer/seller asks |
| banker read | high-quality questions vs tourist behavior |
| next action / owner / due | explicit |
| source | calendar/email/notes |
| confidence | confirmed/inferred/etc. |

## Diligence Requests fields

| field | guidance |
|---|---|
| request id | stable ID |
| buyer id / buyer | requesting party |
| date received | date |
| category | financial, commercial, customer, product, operations, tech, tax, legal, HR, regulatory, environmental, insurance, real estate, debt/financing, separation/carve-out, management/retention, working capital, QoE, cybersecurity, IP, litigation |
| request | exact or summarized ask |
| diligence type | routine, value-relevant, certainty-relevant, timing-relevant, fishing/overreaching, red-flag, process-leverage |
| owner | banker/client/counsel owner |
| approver | if disclosure approval needed |
| due date | date |
| status | not started, in progress, answered, approved, sent, blocked, deferred, rejected, superseded |
| response source | document or answer reference |
| sharing restrictions | none, NDA-only, clean-team, restricted, counsel review required |
| impact | value, certainty, timing, legal, confidentiality, none/unknown |
| risk level | low/medium/high/critical |
| next action | explicit |
| confidence | confirmed/inferred/etc. |

## Process Calendar fields

| field | guidance |
|---|---|
| date/time/time zone | explicit |
| milestone | IOI due, LOI due, management meeting, board meeting, process letter distribution, data-room cutoff, exclusivity expiration, signing target, closing target |
| buyer/workstream | buyer-specific or all-parties |
| owner | accountable person |
| dependency | preceding item required |
| status | upcoming, completed, at risk, missed, changed |
| source | process letter/calendar/email |
| confidence | confirmed/inferred/etc. |

## IOI / LOI / Bid Comparison fields

| field | guidance |
|---|---|
| buyer id / buyer | entity |
| bid stage | IOI, LOI, final bid, revised bid |
| received date/time | exact if available |
| headline enterprise value | value and currency |
| equity value | if available |
| valuation range | if range |
| multiple | EBITDA/revenue/other basis |
| structure | cash, stock, rollover, earnout, contingent value, mix |
| financing status | fully committed, highly confident, preliminary, uncertain, not applicable |
| approvals required | board, IC, regulatory, shareholder, financing committee |
| conditionality | diligence, financing, regulatory, documentation, third-party consents |
| regulatory risk | low/medium/high/unknown |
| timing to sign/close | expected timeline |
| diligence remaining | key gaps |
| bid expiration | date/time |
| risk-adjusted value view | concise commentary |
| recommendation | advance, hold, reject, request clarification, backup, exclusivity candidate |
| source | bid letter/email |
| confidence | confirmed/inferred/etc. |

## Open Issues / Escalations fields

| field | guidance |
|---|---|
| issue id | stable ID |
| issue | concise description |
| buyer/workstream | impacted buyer or overall workstream |
| category | buyer, NDA, diligence, legal, data room, client, bid, financing, regulatory, calendar, confidentiality |
| impact | value, certainty, timing, legal, confidentiality, relationship, process fairness |
| severity | low, medium, high, critical |
| owner | named person |
| due date | date |
| status | open, in progress, blocked, escalated, resolved, deferred |
| recommended action | concrete action |
| escalation required | yes/no and to whom |
| md commentary | why this matters |
| source | reference |
| confidence | confirmed/inferred/etc. |

## Change Log fields

| field | guidance |
|---|---|
| timestamp/date | update time |
| module | buyer master, NDA, diligence, etc. |
| buyer/issue id | item updated |
| field changed | field |
| prior value | preserve old value |
| new value | update |
| source | evidence |
| confidence | confirmed/inferred/conflicting/etc. |
| human review needed | yes/no |
| note | rationale |

## Controlled values

### Process type

- broad auction
- targeted auction
- bilateral negotiation
- sponsor-led sale
- sponsor-to-sponsor exit
- corporate divestiture / carve-out
- public-company sale
- take-private
- minority investment / growth equity raise
- recapitalization
- distressed / special situations sale
- asset sale
- dual-track ipo / m&a process
- cross-border process

### Process stage

- not approached
- teaser sent
- reviewing teaser
- passed pre-nda
- nda sent
- nda in negotiation
- nda executed
- cim sent
- data-room access granted
- initial diligence
- management meeting scheduled
- management meeting completed
- ioi submitted
- advanced to next round
- round 2 diligence
- loi / final bid submitted
- exclusivity
- confirmatory diligence
- signed
- closed
- passed
- dropped
- backup bidder

### Status

- on track
- waiting on buyer
- waiting on seller
- waiting on counsel
- waiting on financing
- needs follow-up
- stalled
- high priority
- low conviction
- escalate
- at risk
- completed
- passed
- conflicting

### Engagement level

- high
- medium
- low
- dormant
- unknown

### Buyer temperature

- hot
- warm
- cooling
- cold
- passed
- unknown

### Risk level

- low
- medium
- high
- critical

### Confidence level

- confirmed
- inferred
- unverified
- conflicting
- needs human review
