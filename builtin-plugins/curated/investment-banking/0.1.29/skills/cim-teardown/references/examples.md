# Examples (Happy path, edge cases, out-of-scope)

## Table of contents
1. Example A: Happy path (CIM + exports)
2. Example B: CIM only (no exports)
3. Example C: Scanned PDF / images-only tables
4. Example D: Out-of-scope requests
5. Micro worked example (excerpt -> claims -> questions -> red flags)

---

## 1) Example A: Happy path (CIM + exports)
**User request:** "Teardown this CIM and build a diligence..."

**Workflow:**
From the skill root:
1. Create `plan.json`
2. Run `python scripts/validate_plan.py plan.json`
3. Run `python scripts/run_plan.py plan.json` (scaffolds outputs)
4. Extract claims with citations
5. Fill outputs
6. Run `python scripts/validate_outputs.py outputs/`

**Expected outputs:**
- Five CSVs with IDs and citations
- Top-25 questions prioritized
- Red flags linked to claims

---

## 2) Example B: CIM only (no exports)
**Handling:**
- Still output all five files
- Populate Evidence Checklist with requested exports
- Mark unresolved citations as `CITATION_TBD`

---

## 3) Example C: Scanned PDF / image tables
**Handling:**
- Cite the page and table title, but treat values as low-confidence
- Request the underlying Excel for every table-based claim
- Create a red flag: "table values not extractable / require underlying data"

---

## 4) Example D: Out-of-scope
Do not activate this skill for:
- "Build me a DCF / valuation model" (use a valuation/modeling workflow)
- "Write the CIM" (different deliverable)
- "Draft a legal opinion" (counsel)

---

## 5) Micro worked example (Example only)

### 5.1 Hypothetical CIM excerpt (Example only)
Location: `CIM example.pdf | p.12 | 2.3 Highlights | Ex.4 KPIs`

1. "Revenue grew 55% YoY in FY2025 to $48M."
2. "LTM gross margin is 82% (adjusted for one-time implementation costs)."
3. "FY2025 NRR was 125% across the enterprise segment."
4. "Top 10 customers represent <15% of ARR."
5. "Pipeline coverage for next quarter is 3.0x."

### 5.2 Extracted claims (sample rows)
- C-0001: Revenue 55% YoY FY2025 to $48M | Category: Financial performance | Citation: CIM example.pdf | p.12 | 2.3 Highlights | bullet 1 | line 1
- C-0002: LTM GM 82% adjusted | Category: Financial performance | Citation: ... line 2
- C-0003: NRR 125% enterprise FY2025 | Category: Customers | Citation: ... line 3
- C-0004: Top 10 <15% ARR | Category: Concentration risk | Citation: ... line 4
- C-0005: Pipeline coverage 3.0x next quarter | Category: Pipeline/forecast | Citation: ... line 5

### 5.3 Evidence checklist (sample)
- E-0001: Monthly revenue export + GL tie-out (36 months) -> proves C-0001
- E-0002: COGS detail + cloud spend export -> proves C-0002
- E-0003: Customer-level ARR bridge by quarter (8+ qtrs) + NRR definition -> proves C-0003
- E-0004: ARR by customer by ultimate parent + renewal calendar -> proves C-0004
- E-0005: CRM opp history + weekly pipeline snapshots -> proves C-0005

### 5.4 Questions (sample)
- Q-0001 (C-0003): Provide customer-level ARR bridge for FY2025 and 8+ quarters; recompute NRR/GRR by segment.
- Q-0002 (C-0002): Provide COGS breakdown and cloud spend; recompute GM including/excluding implementation costs.
- Q-0003 (C-0005): Provide weekly pipeline snapshots and opp stage history; compute weighted coverage and forecast accuracy.

### 5.5 Red flags (sample)
- RF-0001: GM is "adjusted" (definition risk) -> evidence E-0002 -> question Q-0002
- RF-0002: NRR claimed but definition not shown in excerpt -> evidence E-0003 -> question Q-0001
