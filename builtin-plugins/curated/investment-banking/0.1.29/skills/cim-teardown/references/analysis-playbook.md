# Analysis Playbook (Operating Rules + Deal Logic)

## Table of contents
1. Operating rules
2. Inputs and incomplete materials
3. Asset-type detection and overlay use
4. CIM credibility anomaly pass
5. Claim extraction rules
6. Definitions and core tie-outs
7. Underwriting math pass
8. Canonical internal datasets
9. Owner mapping
10. Persona emphasis
11. Red-flag detection rules
12. Edge cases
13. Escalate / do not do

---

## 1) Operating rules
- Adapt the deliverable to the user's requested scope. If the user asks for a short teardown, give a tight first-pass view. If the user asks for a claims ledger, red-flag register, workplan, external triangulation plan, or deeper diligence pack, make that artifact the center.
- Decision-grade top layer is required by default: deal snapshot, go / no-go / gated-sprint posture, gating items, explicit kill criteria, first-wave seller asks, and next actions with owners and timing.
- In screening mode, senior compression beats exhaustive display. Keep dense IDs, registries, and citation scaffolding in appendices unless they materially help the top-layer decision.
- Gating items before broad narrative. Do not spend time on market or product background until the most important gating items are named and linked to Evidence IDs and Question IDs where possible.
- Kill criteria must be explicit. For each gating item, say what outcome triggers `pause`, `price reset`, or `hard pass`.
- Definitions before numbers. Do not accept ARR, NRR, GRR, churn, gross margin, CAC, payback, volume, same-store sales, cap rate, NOI, EBITDA, or adjusted EBITDA without definition and scope.
- Falsification first. Each material claim needs at least one question designed to disprove it quickly.
- Split diligence into `first_wave_gate` and `second_wave_confirmatory`. First-wave asks should be the 5-8 documents or exports most likely to kill, pause, or reset price quickly.
- Underwriting math is mandatory when price and any earnings or cashflow metric appear.
- Tie-outs are mandatory for the metrics driving underwriting, valuation, or downside.
- Every output is linked. Questions link to claim IDs. Red flags link to claim IDs and question IDs. Workplan tasks link to claims, evidence, and questions.
- Be explicit about uncertainty. Lower confidence when definitions are weak, evidence is missing, or external facts are only partially corroborated.

## 2) Inputs and incomplete materials
Minimum inputs:
- at least one CIM, teaser, investor deck, or seller memo
- deal or company name if obvious from the materials

Helpful inputs:
- financials, GL, trial balance, or bank support
- customer metrics, cohort files, ARR bridges, or volume reports
- CRM, pipeline, and forecast exports
- operating KPIs, maintenance logs, permits, or utility data
- data-room index
- connector access to systems of record
- persona lens: `pe`, `growth_vc`, `corpdev`, `dd_lead`, or `mixed`

If inputs are incomplete:
- still produce the full HTML diligence report or the specific requested artifact
- mark unresolved items with `UNKNOWN`, `TBD`, `ASSUMPTION`, or `CITATION_TBD`
- convert missing proof into evidence requests and seller follow-ups
- if connectors are unavailable, use external triangulation where appropriate and label confidence clearly
- do not invent precision around process timing, owners, or thresholds

## 3) Asset-type detection and overlay use
Before owner mapping, question generation, or deep-dive narratives, determine one primary asset type:
- `software/saas`
- `consumer/retail`
- `local / field services`
- `staffing / labor services`
- `fuel / convenience / site retail`
- `industrial/manufacturing`
- `healthcare`
- `financial services`
- `real assets / single-site`
- `real estate heavy`

Overlay rules:
- load the matching overlay before assigning owners or writing the final gating list
- use the overlay to adjust the driver tree, denominators, evidence asks, owner mapping, and kill criteria
- if the company spans multiple types, pick one primary type, note any secondary type, and borrow only the needed checks
- do not default to SaaS-flavored owners or questions unless the asset type is actually `software/saas`

## 4) CIM credibility anomaly pass
Before finalizing the gating list, run a credibility pass on the seller material itself. Promote anomalies into the IC view when they affect trust, price, structure, or timing.

Look for:
- cross-page conflicts in transaction structure, price, perimeter, or ownership
- stale periods, missing current trading, or forecast periods that are already historical
- metric-label drift such as EBITDA, adjusted EBITDA, SDE, NOI, gross profit, or cash flow used interchangeably
- unexplained addback gaps, impossible margins, sign errors, or bridge math that does not foot
- source mismatches, such as summary page says tax returns while detail says unaudited P&L
- copy/paste errors, wrong company names, missing tables, blank inventory or working-capital fields, or inconsistent entity names
- perimeter issues: real estate, inventory, licenses, contracts, phone numbers, websites, leases, assets, debt-like items, and liabilities not clearly included or excluded

For each material anomaly, state `why it matters`, `what would resolve it`, and `underwriting consequence`.

## 5) Claim extraction rules
Extract a claim when it would change underwriting, price, structure, or risk if false.

Always extract:
- numeric statements
- forecasts, targets, and ramp assumptions
- benchmark, causal, competitive, permit, regulatory, or asset-condition assertions
- customer, volume, utilization, margin, throughput, or location claims

Usually ignore unless material:
- generic marketing language
- company history with no underwriting impact

Normalize every claim by capturing:
- category and subcategory
- claim type: `Fact`, `Estimate`, `Projection`, `Opinion`, `Benchmark`, or `Third-party`
- metric name, period, scope, and qualifiers
- definition status
- evidence needed to settle the claim

Split compound claims into atomic claims. Use [claims-taxonomy.md](claims-taxonomy.md) for detailed taxonomy and examples.

## 6) Definitions and core tie-outs
For every key metric, capture:
- canonical metric name
- written definition or formula
- period and frequency
- numerator and denominator
- inclusions and exclusions

If the definition is missing, set status to `NEEDS_DEFINITION` and create an evidence request.

Mandatory tie-outs when relevant:
- `ARR -> revenue -> billings -> cash`
- bookings -> billings -> deferred revenue
- NRR and GRR recomputation
- gross margin recomputation from revenue and COGS detail
- local services: call volume -> booked jobs -> completed jobs -> invoice -> collection -> technician/truck productivity
- staffing: hours billed -> bill rate -> payroll cost -> gross spread -> collections -> payroll funding
- fuel / convenience: POS sales -> category margin -> fuel gallons and cents per gallon -> inventory/fuel true-up -> cash deposits
- pipeline coverage and forecast accuracy
- operational or site-driven assets: volume, utilization, throughput, and downtime
- real-estate-heavy assets: rent, taxes, maintenance capex, and NOI

Use [metric-definitions.md](metric-definitions.md) for definitions and [reconciliation-playbooks.md](reconciliation-playbooks.md) for tie-out mechanics.

## 7) Underwriting math pass
After claim extraction, compute the quick math that answers `so what`.

If the materials include a price and any earnings or cashflow metric such as `NOI`, `EBITDA`, or `FCF`, include:
- implied multiple, cap rate, or payback
- a small `what metric is required for X yield or multiple` table
- a `reported -> adjusted -> normalized` bridge, even if some rows are placeholders
- a short sensitivity table or range analysis
- the one or two asset-specific sensitivities most likely to change the deal

Common asset-specific sensitivities:
- local services: lead-source cost, booked jobs, average ticket, tech productivity, replacement labor
- staffing: top-client loss, gross spread, DSO, workers' comp / payroll tax leakage, payroll funding cost
- fuel / convenience / site retail: rent/site cost, inventory/fuel true-up, fuel gallons, cents per gallon, inside-sales margin, maintenance capex
- real assets: volume/visits, price per unit, utility burden, maintenance capex, permits/zoning
- software/saas: retention, CAC/payback, gross margin definition, pipeline conversion

If inputs are missing:
- compute explicit ranges using stated assumptions
- tag every invented input `ASSUMPTION`
- show the unknown that matters most and the evidence needed to collapse the range

This is a quick-math pass, not a full model.

## 8) Canonical internal datasets
Keep these internally even when the user only wants the memo:
- `Claims Ledger`: claim, metric, scope, citation, confidence, materiality, linked `Q-` and `RF-` IDs
- `Evidence Checklist`: `E-` ID, wave, source/system, fields, time window, format, purpose, acceptance criteria, basis, status
- `Diligence Questions`: `Q-` ID, linked claims, priority, exact ask, tie-out, owners, kill implication, citation
- `Red Flag Register`: `RF-` ID, severity, linked claims/questions, evidence needed, `What resolves it`, impact, status
- `Workplan`: `T-` ID, workstream, linked IDs, owners, dependencies, timing, timing basis, output artifact, status

## 9) Owner mapping
Map each question to an owner on both sides. Use industry-native owners before generic corporate functions.

Default mapping:
- revenue, margin, cashflow, working capital, and addbacks -> Finance or QoE lead -> CFO, controller, bookkeeper, or CPA
- customer, traffic, mix, pricing, and demand -> commercial lead -> GM, operator, sales lead, or marketing lead
- throughput, downtime, labor, capex, or maintenance -> operations lead -> site manager, plant manager, equipment vendor, or facilities lead
- product, architecture, data, or security -> product or tech lead -> CTO, IT lead, or security lead
- permits, compliance, reimbursement, or licensing -> legal or regulatory lead -> counsel, compliance officer, city or county contact, or agency contact
- property, site, lease, taxes, or utility issues -> real estate or facilities lead -> landlord, assessor, utility provider, or facilities manager

Asset-type overlays override these defaults.

## 10) Persona emphasis
Adjust emphasis based on the user's lens:
- `pe`: cash conversion, margin durability, working capital, debt-like items, capex burden, renewal calendar, and downside protection
- `growth_vc`: retention, expansion, CAC efficiency, product usage, demand quality, and forecast accuracy
- `corpdev`: integration complexity, security, roadmap overlap, customer overlap, and synergy realism
- `dd_lead`: coverage completeness, evidence tracking, workstream ownership, blockers, and escalation thresholds
- `mixed`: merge the highest-priority items across lenses and deduplicate

For deeper persona guidance, use [persona-overlays.md](persona-overlays.md) after choosing the primary asset-type overlay.

## 11) Red-flag detection rules
Red flags must be specific, testable, and linked to both claims and questions.

Core cross-checks:
- narrative vs KPI exhibits
- KPI exhibits vs underlying exports
- price vs earnings or cashflow quality
- reported metrics vs definitions
- revenue or volume claims vs underlying transactions
- margin claims vs cost detail and maintenance burden
- forecast claims vs historical accuracy
- customer, site, or property claims vs external records when primary data is missing

Severity guide:
- `5`: likely deal-breaker or major value impairment
- `4`: highly material and could change price, structure, or timing
- `3`: material but potentially fixable
- `2`: minor but worth resolving
- `1`: informational only

Use [red-flag-catalog.md](red-flag-catalog.md) for the detailed catalog and detection logic.

## 12) Edge cases
- If the CIM is the only input, still produce claims, evidence asks, ranked questions, red flags, underwriting quick math, and a workplan.
- If the PDF is scanned or a table is image-only, cite the page and table title, lower confidence, and request the underlying file.
- If multiple CIM versions exist, include the filename or version in every citation and do not reuse stale pointers.
- If units, currencies, or units-of-measure conflict, normalize carefully and call out the mismatch.
- If web facts materially influence the decision, include the exact `WEB | ...` pointer.
- If price is given without a usable earnings or cashflow metric, say so explicitly and show the minimum metric needed to justify the price.
- If a CIM is extremely short, still produce the requested artifacts, but compress the body and let appendices carry the linked detail.
- If the prompt asks only for a claims ledger, red-flag register, workplan, or triangulation plan, do not force a full narrative memo before the requested artifact.

## 13) Escalate / do not do
- Do not present weak CIM statements as proof.
- Do not accept seller-defined metrics without definitions.
- Do not override system-of-record data with web research.
- Do not write a legal opinion or give legal advice.
- Do not turn this into a full valuation model unless the user separately asks for one.
- Stop and ask for clarification when key deal context, persona lens, asset type, or document versions conflict.
- If the user asks you to omit citations or skip evidence requests, refuse that part and preserve auditability.
