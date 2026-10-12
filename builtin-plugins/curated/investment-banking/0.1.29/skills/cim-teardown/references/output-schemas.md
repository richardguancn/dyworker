# Output Schemas (CSV + JSON)

## Table of contents
1. Purpose and non-negotiables
2. Citation pointer format
3. ID conventions
4. Required deliverables
   - Decision-grade memo (`cim_teardown_report.html`)
   - Claims Ledger (`claims_ledger.csv`)
   - Evidence Checklist (`evidence_checklist.csv`)
   - Diligence Questions (`diligence_questions.csv`)
   - Red-Flag Register (`red_flag_register.csv`)
   - Workplan (`workplan.csv`)
5. Optional deliverables
   - Deal package (`deal_package.json`)
   - Model input handoff (`model_input_handoff.csv`)
6. Plan file schema (`plan.json`)
7. Validation rules

---

## 1) Purpose and non-negotiables
These schemas make outputs auditable, linkable, and machine-usable.

MUST rules:
- Every row that references source evidence includes a `CIM Citation` field.
- The field name stays `CIM Citation` for compatibility, but the value can be `CIM ...`, `WEB ...`, or `CITATION_TBD`.
- IDs are stable and cross-linked: claim -> evidence -> question -> red flag -> workplan.
- Never leave core fields blank. If unknown, use `UNKNOWN`, `TBD`, `ASSUMPTION`, or `CITATION_TBD`.
- Default memo output is a standalone decision-grade HTML report and starts with an `Initial IC Recommendation`.

---

## 2) Citation pointer format
Use a pointer that can be resolved back to the original source.

Canonical formats:
- `CIM <file> | p.<page> | <section_path> | <exhibit_id> | <object> | <span>`
- `WEB | <source_name> | <url> | <title> | <date_accessed> | <span/lines>`

Examples:
- `CIM cim_v3.pdf | p.18 | 3.2 Customers | Ex.7 Retention | Chart 7B | lines 4-7`
- `WEB | Texas DOT | https://... | 2024 AADT Map | 2026-03-11 | station 12345 row`

Rules:
- If the CIM has no explicit section numbers, use best-effort section names.
- If page numbers are slide numbers, still record as `p.<n>`.
- If you cannot locate a fact precisely, set `CITATION_TBD` and create an evidence request to resolve.

---

## 3) ID conventions
Use these IDs so files can join cleanly:
- `claim_id`: `C-0001`, `C-0002`, ...
- `evidence_id`: `E-0001`, `E-0002`, ...
- `question_id`: `Q-0001`, `Q-0002`, ...
- `red_flag_id`: `RF-0001`, `RF-0002`, ...
- `task_id`: `T-0001`, `T-0002`, ...

Do not reuse IDs for different items. If something is removed, mark status as `DEPRECATED` and keep the row for audit.

---

## 4) Required deliverables

### 4.1 Decision-grade memo (`cim_teardown_report.html`)
The summary memo is a standalone HTML report following `../../../references/html-artifact-standard.md` and should have three layers:
1. compact `Initial IC Recommendation`
2. curated first-wave diligence sections
3. full appendix or exported diligence pack when useful

Required sections:
- setup
- `Initial IC Recommendation`
- one combined initial IC gating/red-flag/kill-test table for an initial screen
- `Claims That Matter Most`
- incremental `Red Flags And Kill Tests` only when they add risks not already shown in the initial IC table; the full register may be an appendix or export
- `First-Wave Seller Data Request`
- email-ready seller request block
- `Quick Underwriting Implications` when price and any earnings or cashflow metric are present
- second-wave diligence if gates clear
- external triangulation pack when connectors or primary exports are missing
- workplan
- missing evidence, assumptions, and open questions

Formatting rules:
- the first layer is `<= 25` lines
- any table shown in chat should be `<= 6` columns
- each gating item links to `E-` and `Q-` IDs
- each gating item includes explicit kill criteria
- each red flag includes `What resolves it`
- first-wave gating asks are separated from second-wave confirmatory asks
- process details not sourced from the CIM are labeled `screening default` or `assumption`
- no duplicate open-diligence table repeats gates, red flags, or first-wave requests
- an initial IC screen does not repeat the same gating risks in separate main-body tables
- omit report navigation unless it is materially useful for a long or complex artifact
- `blocked_or_partial_status.status` is `partial` when material seller evidence remains missing for the proceed, reprice, or pass recommendation, even if the screen itself is completed
- support exports and stable IDs remain available without introducing dashboard-renderer controls into the report

### 4.2 Claims Ledger (`outputs/claims_ledger.csv`)
Exact column headers:
1. Claim ID
2. Claim Text (Verbatim)
3. Category
4. Subcategory
5. Claim Type
6. Metric(s)
7. Period / As-of
8. Scope (Segment/Geo/Cohort)
9. Qualifiers
10. CIM Citation
11. Supporting Doc Citations
12. Confidence (1-5)
13. Materiality (H/M/L)
14. Implied Assumptions
15. Required Evidence (Minimum)
16. Verification Method
17. Linked Question IDs
18. Linked Red-Flag IDs
19. Status
20. Notes

Recommended values:
- Claim Type: Fact | Estimate | Projection | Opinion | Benchmark | Third-party
- Status: OPEN | VALIDATED | CONTRADICTED | NEEDS_DEFINITION | NEEDS_DATA | DEPRECATED

### 4.3 Evidence Checklist (`outputs/evidence_checklist.csv`)
Exact column headers:
1. Evidence ID
2. Related Claim ID(s)
3. Evidence Name
4. Evidence Type (Export/Doc/Report)
5. System of Record
6. Owner (Seller)
7. Granularity Required
8. Period Covered
9. Format Required
10. Purpose (What it proves)
11. Acceptance Criteria
12. CIM Citation
13. Received? (Y/N)
14. Received Date
15. Location (Data room path)
16. Issues / Gaps
17. Status

Optional extra columns may be appended after `Status` for `Wave` and `Basis`; validators accept a superset when the expected header order is preserved. If extra columns are not used, capture wave and basis in `Purpose (What it proves)`, `Acceptance Criteria`, or `Issues / Gaps`.

Status: REQUESTED | RECEIVED | IN_REVIEW | ACCEPTED | REJECTED | NEEDS_RESUBMIT

### 4.4 Diligence Questions (`outputs/diligence_questions.csv`)
Exact column headers:
1. Question ID
2. Related Claim ID(s)
3. Priority Score
4. Impact (1-5)
5. Uncertainty (1-5)
6. Downside Risk (1-5)
7. Time Urgency (1-5)
8. Category
9. Question (Falsification-first)
10. Why it matters
11. Evidence Request (Exact)
12. Tie-out / Analysis Plan
13. Owner (Your team)
14. Owner (Seller)
15. Meeting Type (Email/Call/Data room)
16. Due Date
17. Status
18. CIM Citation
19. Follow-ups / Branching
20. Notes

Status: OPEN | SENT | ANSWERED | BLOCKED | CLOSED | DEPRECATED

### 4.5 Red-Flag Register (`outputs/red_flag_register.csv`)
Exact column headers:
1. Red-Flag ID
2. Severity (1-5)
3. Related Claim ID(s)
4. Related Question ID(s)
5. Red Flag Description
6. Detection Method / Rule
7. Evidence Needed
8. What resolves it
9. Potential Impact
10. Status
11. Owner
12. CIM Citation
13. Notes

Status: OPEN | MONITOR | RESOLVED | ESCALATED | DEPRECATED

### 4.6 Workplan (`outputs/workplan.csv`)
Exact column headers:
1. Workstream
2. Task ID
3. Task Description
4. Related Claim ID(s)
5. Evidence ID(s)
6. Question ID(s)
7. Owner (Your team)
8. Seller Owner
9. Dependencies
10. Start Date
11. Due Date
12. Status
13. CIM Citation
14. Output Artifact
15. Notes

Status: NOT_STARTED | IN_PROGRESS | BLOCKED | DONE | DEPRECATED

---

## 5) Optional deliverables

### 5.1 Deal package (`outputs/deal_package.json`)
A single JSON bundle for downstream automation.

Recommended structure:
```json
{
  "deal": {"name": "...", "stage": "screening", "as_of": "YYYY-MM-DD"},
  "documents": [{"doc_id": "cim_v3", "filename": "cim_v3.pdf"}],
  "claims": [{"claim_id": "C-0001", "claim_text": "...", "cim_citation": "..."}],
  "evidence": [{"evidence_id": "E-0001", "related_claim_ids": ["C-0001"], "request": "..."}],
  "questions": [{"question_id": "Q-0001", "related_claim_ids": ["C-0001"], "priority_score": 375}],
  "red_flags": [{"red_flag_id": "RF-0001", "related_claim_ids": ["C-0001"], "severity": 5}],
  "workplan": [{"task_id": "T-0001", "question_ids": ["Q-0001"], "due_date": "YYYY-MM-DD"}],
  "links": [{"from": "C-0001", "to": "Q-0001", "type": "CLAIM_TO_QUESTION"}]
}
```

### 5.2 Model input handoff (`outputs/model_input_handoff.csv`)

Use this optional CSV when a CIM teardown feeds `dcf-model-builder`, `three-statement-model-builder`, `comps-valuation`, `lbo-model-build`, `merger-model-builder`, or `model-audit-tieout`.

Exact column headers follow the shared `cim_teardown_to_model_builder` contract in `../../../references/handoff-contracts.md`:

`handoff_id`, `target_skill`, `transaction_context`, `deal_name`, `asset_type`, `as_of_date`, `source_scope`, `claim_id`, `evidence_id`, `red_flag_id`, `question_id`, `task_id`, `workstream`, `model_area`, `model_subarea`, `metric_or_driver`, `metric_definition`, `definition_status`, `period`, `segment_or_scope`, `currency`, `unit`, `scale`, `reported_value`, `adjusted_value`, `normalized_value`, `value_basis`, `calculation_method`, `source_id`, `supporting_source_ids`, `source_name`, `source_type`, `source_pointer`, `source_as_of_date`, `native_evidence_label`, `canonical_evidence_category`, `source_quality`, `freshness_status`, `conflict_status`, `confidence`, `evidence_gap`, `required_source_to_resolve`, `recommended_model_treatment`, `case_mapping`, `sensitivity_to_run`, `first_breach_or_failure_mode`, `diligence_owner`, `notes_for_model_builder`.

Append optional extension fields only after the exact required header order.

---

## 6) Plan file schema (`plan.json`)
Use this to coordinate work and enable scripts.

```json
{
  "deal_name": "TargetCo - Project X",
  "persona": "mixed",
  "deal_stage": "screening",
  "as_of": "YYYY-MM-DD",
  "inputs": {
    "cim": [{"path": "inputs/cim.pdf", "type": "pdf"}],
    "financials": [{"path": "inputs/financials.xlsx", "type": "xlsx"}],
    "customer_metrics": [{"path": "inputs/customer_metrics.xlsx", "type": "xlsx"}],
    "pipeline": [{"path": "inputs/pipeline.csv", "type": "csv"}],
    "market_materials": [{"path": "inputs/market.pdf", "type": "pdf"}],
    "data_room_index": [{"path": "inputs/data_room_index.csv", "type": "csv"}]
  },
  "output": {
    "format": "csv",
    "output_dir": "outputs",
    "citation_style": "CIM <file> | p.<page> | <section> | <exhibit> | <object> | <span> OR WEB | <source_name> | <url> | <title> | <date_accessed> | <span/lines>"
  },
  "scoring": {
    "formula": "priority = impact * uncertainty * downside_risk * time_urgency",
    "defaults": {"impact": 3, "uncertainty": 3, "downside_risk": 3, "time_urgency": 3}
  }
}
```

Allowed values:
- persona: pe | growth_vc | corpdev | dd_lead | mixed
- deal_stage: screening | ioi | confirmatory | signing
- output.format: csv | json | both

---

## 7) Validation rules
The validator scripts enforce:
- required files exist
- required columns exist
- IDs are unique
- cross-links reference valid IDs
- `CIM Citation` is not blank for material claims/questions
- priority score equals component product when components are provided

Manual QA should also confirm:
- `Initial IC Recommendation` is first
- there are `3-5` gating items
- gating items link to `E-` and `Q-` IDs
- any non-CIM fact uses a `WEB | ...` pointer
