#!/usr/bin/env python3
"""Validate required teardown outputs.

Usage:
  python scripts/validate_outputs.py outputs/

Checks:
- required CSVs exist
- headers match templates
- ID formats and uniqueness
- cross-links reference existing IDs
- citations present (or CITATION_TBD)
- priority score math (if components provided)

Dependency-free (standard library only).
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

CLAIMS_HEADERS = [
    "Claim ID",
    "Claim Text (Verbatim)",
    "Category",
    "Subcategory",
    "Claim Type",
    "Metric(s)",
    "Period / As-of",
    "Scope (Segment/Geo/Cohort)",
    "Qualifiers",
    "CIM Citation",
    "Supporting Doc Citations",
    "Confidence (1-5)",
    "Materiality (H/M/L)",
    "Implied Assumptions",
    "Required Evidence (Minimum)",
    "Verification Method",
    "Linked Question IDs",
    "Linked Red-Flag IDs",
    "Status",
    "Notes",
]

EVIDENCE_HEADERS = [
    "Evidence ID",
    "Related Claim ID(s)",
    "Evidence Name",
    "Evidence Type (Export/Doc/Report)",
    "System of Record",
    "Owner (Seller)",
    "Granularity Required",
    "Period Covered",
    "Format Required",
    "Purpose (What it proves)",
    "Acceptance Criteria",
    "CIM Citation",
    "Received? (Y/N)",
    "Received Date",
    "Location (Data room path)",
    "Issues / Gaps",
    "Status",
]

QUESTIONS_HEADERS = [
    "Question ID",
    "Related Claim ID(s)",
    "Priority Score",
    "Impact (1-5)",
    "Uncertainty (1-5)",
    "Downside Risk (1-5)",
    "Time Urgency (1-5)",
    "Category",
    "Question (Falsification-first)",
    "Why it matters",
    "Evidence Request (Exact)",
    "Tie-out / Analysis Plan",
    "Owner (Your team)",
    "Owner (Seller)",
    "Meeting Type (Email/Call/Data room)",
    "Due Date",
    "Status",
    "CIM Citation",
    "Follow-ups / Branching",
    "Notes",
]

REDFLAG_HEADERS = [
    "Red-Flag ID",
    "Severity (1-5)",
    "Related Claim ID(s)",
    "Related Question ID(s)",
    "Red Flag Description",
    "Detection Method / Rule",
    "Evidence Needed",
    "What resolves it",
    "Potential Impact",
    "Status",
    "Owner",
    "CIM Citation",
    "Notes",
]

WORKPLAN_HEADERS = [
    "Workstream",
    "Task ID",
    "Task Description",
    "Related Claim ID(s)",
    "Evidence ID(s)",
    "Question ID(s)",
    "Owner (Your team)",
    "Seller Owner",
    "Dependencies",
    "Start Date",
    "Due Date",
    "Status",
    "CIM Citation",
    "Output Artifact",
    "Notes",
]

REQUIRED = {
    "claims_ledger.csv": CLAIMS_HEADERS,
    "evidence_checklist.csv": EVIDENCE_HEADERS,
    "diligence_questions.csv": QUESTIONS_HEADERS,
    "red_flag_register.csv": REDFLAG_HEADERS,
    "workplan.csv": WORKPLAN_HEADERS,
}

ID_PATTERNS = {
    "claim": re.compile(r"^C-\d{4}$"),
    "evidence": re.compile(r"^E-\d{4}$"),
    "question": re.compile(r"^Q-\d{4}$"),
    "redflag": re.compile(r"^RF-\d{4}$"),
    "task": re.compile(r"^T-\d{4}$"),
}


def _split_ids(value: str) -> list[str]:
    if value is None:
        return []
    value = value.strip()
    if not value:
        return []
    # Accept comma, semicolon, or pipe-separated lists
    parts = re.split(r"[;,|]", value)
    return [p.strip() for p in parts if p.strip()]


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        rows = list(reader)
    return headers, rows


def _assert_headers(file: str, actual: list[str], expected: list[str], errors: list[str]) -> None:
    if actual == expected:
        return
    # Allow superset, but keep strict ordering for the expected prefix.
    if len(actual) >= len(expected) and actual[: len(expected)] == expected:
        # warn-only behavior (still accept)
        return
    errors.append(
        f"{file}: header mismatch. Expected {len(expected)} cols; got {len(actual)}.\n"
        f"Expected: {expected}\nGot: {actual}"
    )


def _require_nonempty(field_value: str, context: str, errors: list[str]) -> None:
    if field_value is None or not str(field_value).strip():
        errors.append(f"Missing required field: {context}")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/validate_outputs.py outputs/")
        return 1

    out_dir = Path(sys.argv[1])
    if not out_dir.exists() or not out_dir.is_dir():
        print(f"ERROR: outputs directory not found: {out_dir}")
        return 1

    errors: list[str] = []

    # Load files
    data: dict[str, tuple[list[str], list[dict[str, str]]]] = {}
    for fname, expected_headers in REQUIRED.items():
        path = out_dir / fname
        if not path.exists():
            errors.append(f"Missing required output file: {fname}")
            continue
        headers, rows = _read_csv(path)
        _assert_headers(fname, headers, expected_headers, errors)
        data[fname] = (headers, rows)

    if errors:
        print("❌ Output validation failed (missing files/headers):")
        for e in errors:
            print(" -", e)
        return 1

    # Collect IDs
    claim_ids: set[str] = set()
    evidence_ids: set[str] = set()
    question_ids: set[str] = set()
    redflag_ids: set[str] = set()
    task_ids: set[str] = set()

    # Claims
    _, claim_rows = data["claims_ledger.csv"]
    for i, r in enumerate(claim_rows, start=2):
        cid = (r.get("Claim ID") or "").strip()
        if not cid:
            errors.append(f"claims_ledger.csv:{i} missing Claim ID")
            continue
        if cid in claim_ids:
            errors.append(f"claims_ledger.csv:{i} duplicate Claim ID: {cid}")
        claim_ids.add(cid)
        if not ID_PATTERNS["claim"].match(cid):
            errors.append(f"claims_ledger.csv:{i} invalid Claim ID format: {cid}")

        status = (r.get("Status") or "").strip().upper()
        citation = (r.get("CIM Citation") or "").strip()
        if status != "DEPRECATED":
            _require_nonempty(citation, f"claims_ledger.csv:{i} CIM Citation", errors)

    # Evidence
    _, evid_rows = data["evidence_checklist.csv"]
    for i, r in enumerate(evid_rows, start=2):
        eid = (r.get("Evidence ID") or "").strip()
        if not eid:
            errors.append(f"evidence_checklist.csv:{i} missing Evidence ID")
            continue
        if eid in evidence_ids:
            errors.append(f"evidence_checklist.csv:{i} duplicate Evidence ID: {eid}")
        evidence_ids.add(eid)
        if not ID_PATTERNS["evidence"].match(eid):
            errors.append(f"evidence_checklist.csv:{i} invalid Evidence ID format: {eid}")

        rel = _split_ids(r.get("Related Claim ID(s)") or "")
        for cid in rel:
            if cid not in claim_ids:
                errors.append(f"evidence_checklist.csv:{i} references unknown Claim ID: {cid}")

    # Questions
    _, q_rows = data["diligence_questions.csv"]
    for i, r in enumerate(q_rows, start=2):
        qid = (r.get("Question ID") or "").strip()
        if not qid:
            errors.append(f"diligence_questions.csv:{i} missing Question ID")
            continue
        if qid in question_ids:
            errors.append(f"diligence_questions.csv:{i} duplicate Question ID: {qid}")
        question_ids.add(qid)
        if not ID_PATTERNS["question"].match(qid):
            errors.append(f"diligence_questions.csv:{i} invalid Question ID format: {qid}")

        rel = _split_ids(r.get("Related Claim ID(s)") or "")
        for cid in rel:
            if cid not in claim_ids:
                errors.append(f"diligence_questions.csv:{i} references unknown Claim ID: {cid}")

        # Citation required when question is active
        status = (r.get("Status") or "").strip().upper()
        if status != "DEPRECATED":
            _require_nonempty(
                (r.get("CIM Citation") or "").strip(),
                f"diligence_questions.csv:{i} CIM Citation",
                errors,
            )

        # Priority math check (if numeric)
        def _to_int(x: str) -> int | None:
            x = (x or "").strip()
            if not x:
                return None
            try:
                return int(float(x))
            except Exception:
                return None

        ps = _to_int(r.get("Priority Score") or "")
        impact = _to_int(r.get("Impact (1-5)") or "")
        unc = _to_int(r.get("Uncertainty (1-5)") or "")
        down = _to_int(r.get("Downside Risk (1-5)") or "")
        urg = _to_int(r.get("Time Urgency (1-5)") or "")
        if None not in (ps, impact, unc, down, urg):
            expected = impact * unc * down * urg
            if ps != expected:
                errors.append(
                    f"diligence_questions.csv:{i} Priority Score mismatch: got {ps}, expected {expected} (impact*uncertainty*downside*urgency)"
                )

    # Red flags
    _, rf_rows = data["red_flag_register.csv"]
    for i, r in enumerate(rf_rows, start=2):
        rfid = (r.get("Red-Flag ID") or "").strip()
        if not rfid:
            errors.append(f"red_flag_register.csv:{i} missing Red-Flag ID")
            continue
        if rfid in redflag_ids:
            errors.append(f"red_flag_register.csv:{i} duplicate Red-Flag ID: {rfid}")
        redflag_ids.add(rfid)
        if not ID_PATTERNS["redflag"].match(rfid):
            errors.append(f"red_flag_register.csv:{i} invalid Red-Flag ID format: {rfid}")

        rel_c = _split_ids(r.get("Related Claim ID(s)") or "")
        rel_q = _split_ids(r.get("Related Question ID(s)") or "")
        for cid in rel_c:
            if cid not in claim_ids:
                errors.append(f"red_flag_register.csv:{i} references unknown Claim ID: {cid}")
        for qid in rel_q:
            if qid not in question_ids:
                errors.append(f"red_flag_register.csv:{i} references unknown Question ID: {qid}")

        status = (r.get("Status") or "").strip().upper()
        if status != "DEPRECATED":
            _require_nonempty(
                (r.get("What resolves it") or "").strip(),
                f"red_flag_register.csv:{i} What resolves it",
                errors,
            )

    # Workplan
    _, t_rows = data["workplan.csv"]
    for i, r in enumerate(t_rows, start=2):
        tid = (r.get("Task ID") or "").strip()
        if not tid:
            errors.append(f"workplan.csv:{i} missing Task ID")
            continue
        if tid in task_ids:
            errors.append(f"workplan.csv:{i} duplicate Task ID: {tid}")
        task_ids.add(tid)
        if not ID_PATTERNS["task"].match(tid):
            errors.append(f"workplan.csv:{i} invalid Task ID format: {tid}")

        for cid in _split_ids(r.get("Related Claim ID(s)") or ""):
            if cid and cid not in claim_ids:
                errors.append(f"workplan.csv:{i} references unknown Claim ID: {cid}")
        for eid in _split_ids(r.get("Evidence ID(s)") or ""):
            if eid and eid not in evidence_ids:
                errors.append(f"workplan.csv:{i} references unknown Evidence ID: {eid}")
        for qid in _split_ids(r.get("Question ID(s)") or ""):
            if qid and qid not in question_ids:
                errors.append(f"workplan.csv:{i} references unknown Question ID: {qid}")

    if errors:
        print("❌ Output validation failed:")
        for e in errors:
            print(" -", e)
        return 1

    print("✅ Outputs look valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
