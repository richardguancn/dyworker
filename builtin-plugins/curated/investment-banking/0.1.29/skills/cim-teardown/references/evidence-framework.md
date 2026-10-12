# Evidence Framework (Proof Standards + Seller Tricks)

## Table of contents
1. Source-of-truth hierarchy (what beats what)
2. Evidence types and acceptance standards
3. Proof requirements by claim category
4. Definition games and common seller tactics
5. Data room request hygiene (how to ask for the exact export)
6. Evidence retrieval ladder
7. External triangulation pack

---

## 1) Source-of-truth hierarchy
Use this hierarchy when rating evidence strength (stronger -> weaker):
1. System-of-record exports with transaction-level data (GL, billing system, CRM opp history)
2. Signed contracts / invoices / bank statements
3. Audited or reviewed financial statements
4. Internal management reporting packages with reconciliations
5. CIM tables/charts without underlying data
6. Slide text assertions with no data
7. Anecdotes

Rule: CIM is a claim source, rarely the proof.

---

## 2) Evidence types and acceptance standards

### Strong evidence (acceptable)
- GL detail export (by month, account)
- Billing system invoices + subscription objects
- CRM opportunity history (stage changes + close dates)
- Customer-level ARR bridge with customer IDs and dates
- Bank statements / cash receipts for collections validation
- SOC2 report, penetration test report (for security claims)

### Weak evidence (not acceptable alone)
- A screenshot of a dashboard
- A summary table with no methodology
- "Select customer" case studies
- A slide that says "best-in-class" without peer set

### Must-have metadata on any export
- Extract timestamp
- System name + report name
- Filters used
- Currency and units
- Date field semantics (created vs closed vs invoice date)

---

## 3) Proof requirements by claim category
Below are minimum proof types. When claims are material, require both:
- underlying export
- reconciliation to a financial statement or system-of-record

### Market (TAM, growth)
- Methodology doc (top-down and/or bottom-up)
- TAM model in Excel with assumptions
- Third-party citations (full source excerpt) and mapping to ICP
- Sensitivity table (boundary conditions)

### Product (performance, roadmap)
- Uptime/incident logs
- Release notes and roadmap artifacts
- Customer tickets (Zendesk/Jira) summaries
- Architecture diagram + cloud bills (for scale claims)

### GTM (win rates, cycle times)
- CRM opp history export including closed-lost/no decision
- Stage conversion and velocity analysis
- Rep-level quota and attainment
- Discounting report by segment

### Customers (logos, concentration)
- Customer master list with ultimate parent mapping
- ARR by customer by month
- Contract terms (renewals, termination clauses)
- Reference call list and consent

### Financial performance
- Trial balance / GL detail
- Revenue waterfall / rev rec schedules
- Bank statements (if needed)
- QoE bridge (if available)

### Unit economics
- S&M GL detail, headcount, commissions
- Attribution rules for CAC
- Cohort contribution margin model

### Moat/competition
- Win/loss report with reasons
- Competitive matrix with feature verification
- Customer reference call notes (verbatim)

### Tech/security
- SOC2/ISO artifacts
- Pen test report + remediation plan
- Security incident log
- Data processing agreements (DPAs)

### Legal/regulatory
- Material contracts list
- Litigation summary + counsel memo
- Compliance policies and audits

### Pipeline/forecast
- Pipeline snapshot history (weekly snapshots)
- Forecast vs actual history by quarter
- Renewal pipeline report

### Working capital
- AR aging
- Deferred revenue rollforward
- Collections notes / write-offs

---

## 4) Definition games and common seller tactics

### Metric windowing
- "NRR last quarter" presented as representative; ask for 8+ quarters.

### Cohort selection bias
- Retention shown only for customers that are still active.
- Customers excluded due to "migration" or "product sunset".

### Pro forma addbacks
- "Adjusted EBITDA" inflated by recurring addbacks.

### Pipeline double counting
- Same opportunity appears in multiple pipelines (renewal + expansion).

### Customer concentration masking
- Grouping customers by brand instead of ultimate parent.

If any tactic appears:
- lower claim confidence
- create a red flag
- request the raw export and rebuild metric

---

## 5) Data room request hygiene
Write requests so the seller cannot answer with a screenshot.
Good request pattern:
- System
- Report name
- Filters
- Fields
- Granularity
- Time period
- Format

Example:
"Salesforce Opportunity Field History export (CSV), all opportunities created since 2023-01-01, include: opp_id, account_id, created_date, close_date (original + current), amount, stage_name, stage_change_date, forecast_category, owner, lead_source, is_closed_won, is_closed_lost, loss_reason, product, segment."

## 6) Evidence retrieval ladder
Use this order of operations:
1. connectors and systems of record
2. user-provided exports, uploads, or data-room files
3. web research from credible primary sources
4. web research from secondary aggregators

Rules:
- resolve gating items from tiers `1-2` first whenever possible
- use web research to triangulate context, not replace primary operating data
- ask for exports, not screenshots
- every evidence request should specify the system, report or table name, required fields, granularity, time window, format, and acceptance criteria
- classify each evidence request as `first_wave_gate` or `second_wave_confirmatory`
- include a `basis` for acceptance criteria when useful: `sourced`, `calculated`, `screening default`, or `assumption`

## 7) External triangulation pack
If connectors and primary exports are missing, produce an external triangulation pack for material open items.

Cover the relevant subset of:
- trade area basics such as population and income proxies
- traffic counts from DOT or transport authorities
- competition mapping using reputable mapping and review sources
- property records from county assessor or tax sites
- permits and zoning basics from municipal or county pages
- environmental enforcement databases where relevant, such as EPA ECHO

Use external facts as lower-confidence triangulation unless they come from primary government, regulator, utility, SEC/filing, court, or official company sources.
