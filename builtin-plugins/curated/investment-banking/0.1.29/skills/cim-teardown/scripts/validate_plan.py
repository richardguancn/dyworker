#!/usr/bin/env python3
"""Validate a CIM teardown plan.json file.

This is intentionally strict and dependency-free (standard library only).

Usage:
  python scripts/validate_plan.py plan.json

Exit codes:
  0 = valid
  1 = invalid
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ALLOWED_PERSONAS = {"pe", "growth_vc", "corpdev", "dd_lead", "mixed"}
ALLOWED_STAGES = {"screening", "ioi", "confirmatory", "signing"}
ALLOWED_OUTPUT_FORMATS = {"csv", "json", "both"}


def _err(errors: list[str], msg: str) -> None:
    errors.append(msg)


def _is_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except Exception:
        return False


def _validate_inputs(inputs: dict[str, Any], errors: list[str]) -> None:
    if not isinstance(inputs, dict):
        _err(errors, "inputs must be an object")
        return

    # At minimum, CIM is expected.
    cim = inputs.get("cim")
    if not isinstance(cim, list) or len(cim) == 0:
        _err(errors, "inputs.cim must be a non-empty list")
    else:
        for i, item in enumerate(cim):
            if not isinstance(item, dict):
                _err(errors, f"inputs.cim[{i}] must be an object")
                continue
            if not item.get("path"):
                _err(errors, f"inputs.cim[{i}].path is required")
            if item.get("type") not in {"pdf", "pptx", "txt", "docx"}:
                _err(errors, f"inputs.cim[{i}].type must be one of pdf/pptx/txt/docx")

    # Optional groups; if present, must be lists of objects with path/type.
    for key in [
        "financials",
        "customer_metrics",
        "pipeline",
        "market_materials",
        "data_room_index",
    ]:
        if key not in inputs:
            continue
        arr = inputs.get(key)
        if not isinstance(arr, list):
            _err(errors, f"inputs.{key} must be a list if provided")
            continue
        for i, item in enumerate(arr):
            if not isinstance(item, dict):
                _err(errors, f"inputs.{key}[{i}] must be an object")
                continue
            if not item.get("path"):
                _err(errors, f"inputs.{key}[{i}].path is required")


def validate_plan(plan: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if not isinstance(plan, dict):
        return ["Plan must be a JSON object"]

    deal_name = plan.get("deal_name")
    if not isinstance(deal_name, str) or not deal_name.strip():
        _err(errors, "deal_name (string) is required")

    persona = plan.get("persona")
    if persona not in ALLOWED_PERSONAS:
        _err(errors, f"persona must be one of: {', '.join(sorted(ALLOWED_PERSONAS))}")

    stage = plan.get("deal_stage")
    if stage not in ALLOWED_STAGES:
        _err(errors, f"deal_stage must be one of: {', '.join(sorted(ALLOWED_STAGES))}")

    as_of = plan.get("as_of")
    if not isinstance(as_of, str) or not _is_date(as_of):
        _err(errors, "as_of must be a date string YYYY-MM-DD")

    inputs = plan.get("inputs")
    _validate_inputs(inputs, errors)

    output = plan.get("output")
    if not isinstance(output, dict):
        _err(errors, "output must be an object")
    else:
        fmt = output.get("format")
        if fmt not in ALLOWED_OUTPUT_FORMATS:
            _err(
                errors, f"output.format must be one of: {', '.join(sorted(ALLOWED_OUTPUT_FORMATS))}"
            )
        out_dir = output.get("output_dir")
        if not isinstance(out_dir, str) or not out_dir.strip():
            _err(errors, "output.output_dir (string) is required")
        citation_style = output.get("citation_style")
        if not isinstance(citation_style, str) or not citation_style.strip():
            _err(errors, "output.citation_style (string) is required")

    scoring = plan.get("scoring")
    if scoring is not None:
        if not isinstance(scoring, dict):
            _err(errors, "scoring must be an object if provided")
        else:
            formula = scoring.get("formula")
            if not isinstance(formula, str) or "priority" not in formula:
                _err(errors, "scoring.formula should be a string describing the priority formula")
            defaults = scoring.get("defaults")
            if defaults is not None and not isinstance(defaults, dict):
                _err(errors, "scoring.defaults must be an object if provided")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/validate_plan.py plan.json")
        return 1

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"ERROR: plan file not found: {path}")
        return 1

    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERROR: failed to parse JSON: {e}")
        return 1

    errors = validate_plan(plan)
    if errors:
        print("❌ Plan validation failed:")
        for e in errors:
            print(f" - {e}")
        return 1

    print("✅ Plan is valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
