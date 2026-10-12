# Diligence Question Engine (Falsification-first)

## Table of contents
1. What a "great" diligence question looks like
2. Claims -> evidence -> question mapping logic
3. Priority scoring model (impact x uncertainty x downside x urgency)
4. Owner assignment (PE/Growth/CorpDev/DD lead)
5. Question templates by category
6. Branching follow-ups (if X, then Y)
7. Data request wording library (exact exports)
8. Common anti-patterns (bad questions)

---

## 1) What a "great" diligence question looks like
A great question is:
- falsifiable (can be proven wrong)
- anchored to a specific claim + citation
- includes the exact evidence required
- tells the seller what "good" looks like

**Gold-standard example**
- Related claim: "NRR is 125% FY2025" (CIM p.18 Ex.7)
- Question: "Please provide a customer-level ARR bridge for FY2025 (starting ARR, expansion, contraction, churn, ending ARR) with customer IDs and segment. Recalculate FY2025 NRR and GRR using the attached definition. We will tie total ending ARR to the FY2025 exit ARR reported in the CIM. If your NRR excludes cohorts or migrations, list every exclusion explicitly."

**Bad example**
- "Can you talk about your retention?"

---

## 2) Claims -> evidence -> question mapping logic
For each claim:
1. Identify what would make it false (failure modes)
2. Identify the minimum evidence that would settle the dispute
3. Write the question to obtain that evidence and define the acceptance criteria

Heuristic:
- If claim is about a metric -> demand the underlying export + definition + tie-out
- If claim is about differentiation -> demand win/loss + references + competitive verification
- If claim is about forecast -> demand forecast vs actual history + pipeline history

---

## 3) Priority scoring model
Use the default rubric unless overridden in plan.json:

`Priority Score = Impact (1-5) * Uncertainty (1-5) * Downside Risk (1-5) * Time Urgency (1-5)`

Guidance:
- Impact: how much it moves underwriting / valuation
- Uncertainty: how weak the evidence is
- Downside risk: magnitude of negative outcome if wrong
- Time urgency: how quickly you need to resolve (pre-IOI vs confirmatory)

Tie-breakers:
- Prefer questions that unlock many downstream questions (high "dependency value")
- Prefer questions with short time-to-verify

---

## 4) Owner assignment
Map each question to:
- Owner (your team): Finance, GTM, Product, Tech, Legal, Ops
- Owner (seller): CFO/FP&A, RevOps, Sales Ops, Product, Security, Legal

Default mapping:
- Revenue/GM/ARR/working capital -> Finance/QoE lead
- NRR/cohorts/concentration -> Customer analytics / RevOps
- Win rates/pipeline/forecast -> RevOps/Sales Ops
- Security -> Security lead
- Legal/regulatory -> Legal counsel

---

## 5) Templates by category
Use these as copy/paste starters.

### Market / TAM
- "Provide your TAM model in Excel with sources for each assumption. Define ICP and show how TAM changes when restricting to ICP and to your current geographies. Provide a sensitivity table for price x adoption x target count."

### Product differentiation
- "Provide a feature-by-feature matrix for top 5 competitors, with links/screenshots as evidence. Provide top 20 win/loss notes where differentiation was the stated reason, and 5 customer references we can contact."

### Revenue growth
- "Provide monthly revenue by product line and customer segment for last 36 months, with a reconciliation to the GL/trial balance. Provide revenue bridge (price/volume/mix)."

### Gross margin
- "Provide monthly COGS detail with hosting, support, third-party fees, and services delivery separated. Provide cloud cost export (AWS/GCP/Azure) and headcount allocation assumptions."

### Retention (NRR/GRR)
- "Provide customer-level ARR bridge for last 8 quarters with cohort start date and segment. Provide the exact NRR/GRR definitions used in the CIM. We will recalculate NRR/GRR and reconcile ending ARR to the exit ARR shown in the CIM."

### Churn
- "Provide a churn log (logo + ARR churn) with churn reason codes and competitor displacement where known. Include downsells and partial churn."

### CAC / payback
- "Provide S&M expense detail (GL) and headcount by function, plus new ARR/bookings by month. Provide your CAC definition and compute CAC and payback by segment and channel."

### Pipeline coverage
- "Provide weekly pipeline snapshots for last 6 quarters and opportunity stage history. Recreate your pipeline coverage metric and compare forecast vs actual."

### Working capital
- "Provide AR aging by month, collections notes, deferred revenue rollforward, and write-off history."

### Tech/security
- "Provide SOC2 report (or gap assessment), latest pen test report, incident log for last 24 months, and cloud architecture diagram."

### Legal/regulatory
- "Provide list of material contracts with key terms (termination, auto-renew, SLAs, indemnities), any litigation summaries, and compliance attestations relevant to regulated customers."

---

## 6) Branching follow-ups
Use conditional follow-ups so calls do not stall.

Examples:
- If NRR recalculation differs by >2 pts -> request customer-level exclusions list + data mapping
- If GM <80% due to services mix -> request services margin and plan to improve
- If pipeline coverage relies on unweighted pipeline -> request stage conversion rates and build weighted model
- If TAM is top-down only -> request bottom-up with ICP counts

---

## 7) Data request wording library
For exact field lists, see `data-requests-library.md`.

---

## 8) Anti-patterns
Avoid:
- open-ended questions with no evidence request
- asking for opinions instead of data
- questions that cannot be answered in diligence timeline
- duplicates that do not add incremental information
