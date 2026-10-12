#!/usr/bin/env python3
"""Validate the Investment Banking banker runtime readiness inventory."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[1]
VALID_GAP_TYPES = {
    "runtime_missing",
    "model_citation_missing",
    "native_office_missing",
    "stdout_machine_readable",
    "pdf_ocr_missing",
    "visual_review_missing",
    "domain_depth_partial",
    "manifest_nonstandard",
    "source_gate_partial",
}
VALID_MATURITY = {
    "instruction_only",
    "support_script",
    "deterministic_human_artifact",
    "banker_operational",
    "senior_ready",
    "external_ready",
}
VALID_STATUS = {"planned", "in_progress", "fixed", "accepted_gap"}
VALID_PRIORITY = {"P0", "P1", "P2"}
REQUIRED = {
    "skill",
    "gap_type",
    "current_runtime",
    "target_runtime",
    "hero_artifact",
    "companion_artifact",
    "support_artifacts",
    "validator_needed",
    "eval_needed",
    "priority",
    "runtime_maturity",
    "status",
}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def validate_inventory(payload: Mapping[str, Any], root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    if payload.get("plugin") != "investment-banking":
        errors.append("plugin must be investment-banking")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        errors.append("rows must be a non-empty array")
        return errors
    seen: set[tuple[str, str]] = set()
    for idx, row in enumerate(rows):
        prefix = f"rows[{idx}]"
        if not isinstance(row, dict):
            errors.append(f"{prefix} must be an object")
            continue
        missing = sorted(REQUIRED - set(row))
        if missing:
            errors.append(f"{prefix} missing required fields: {', '.join(missing)}")
        key = (str(row.get("skill", "")), str(row.get("gap_type", "")))
        if key in seen:
            errors.append(f"{prefix} duplicate skill/gap_type pair: {key}")
        seen.add(key)
        if row.get("gap_type") not in VALID_GAP_TYPES:
            errors.append(f"{prefix}.gap_type invalid: {row.get('gap_type')}")
        if row.get("runtime_maturity") not in VALID_MATURITY:
            errors.append(f"{prefix}.runtime_maturity invalid: {row.get('runtime_maturity')}")
        if row.get("status") not in VALID_STATUS:
            errors.append(f"{prefix}.status invalid: {row.get('status')}")
        if row.get("priority") not in VALID_PRIORITY:
            errors.append(f"{prefix}.priority invalid: {row.get('priority')}")
        for field in ("support_artifacts", "validator_needed", "eval_needed", "eval_prompt_ids"):
            if field in row and not isinstance(row[field], list):
                errors.append(f"{prefix}.{field} must be an array")
        skill = row.get("skill")
        if (
            skill
            and not (root / "skills" / str(skill)).exists()
            and str(skill) != "dashboard-builder"
        ):
            errors.append(f"{prefix}.skill directory not found: {skill}")
        if row.get("status") == "fixed":
            script = str(row.get("runtime_script", ""))
            test = str(row.get("primary_test", ""))
            if not script or not (root / script).exists():
                errors.append(f"{prefix} fixed gap must name an existing runtime_script")
            if not test or not (root / test).exists():
                errors.append(f"{prefix} fixed gap must name an existing primary_test")
            if not _as_list(row.get("eval_prompt_ids")):
                errors.append(f"{prefix} fixed gap must include eval_prompt_ids")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    args = parser.parse_args(argv)
    payload = json.loads(args.inventory.read_text(encoding="utf-8"))
    errors = validate_inventory(payload)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"OK: {len(payload.get('rows', []))} banker runtime readiness rows validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
