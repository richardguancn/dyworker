#!/usr/bin/env python3
"""Schema and handoff validator for financials-normalizer CSV outputs."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from pathlib import Path

REQUIRED = {
    "entity",
    "source_id",
    "statement",
    "line_item_original",
    "line_item_standard",
    "line_item_id",
    "period_end",
    "period_label",
    "period_type",
    "currency",
    "units",
    "source_value",
    "normalized_value",
    "normalization_method",
    "source_location",
    "evidence_label",
    "canonical_evidence_category",
    "confidence",
}

EVIDENCE = {
    "fact_source_reported",
    "fact_provider_standardized",
    "derived_calculation",
    "management_adjusted",
    "analyst_adjusted",
    "assumption_user_provided",
    "assumption_inferred",
    "estimate_consensus",
    "missing_required_source",
}

CANONICAL_CATEGORIES = {
    "verified_fact",
    "reported_fact",
    "seller_claim",
    "management_statement",
    "pro_forma_adjustment",
    "assumption",
    "inference",
    "estimate",
    "stale",
    "contradicted",
    "unknown",
}

CANONICAL_BY_NATIVE = {
    "fact_source_reported": {"verified_fact", "reported_fact"},
    "fact_provider_standardized": {"reported_fact"},
    "derived_calculation": {"estimate"},
    "management_adjusted": {"pro_forma_adjustment", "management_statement"},
    "analyst_adjusted": {"pro_forma_adjustment", "assumption", "estimate"},
    "assumption_user_provided": {"assumption"},
    "assumption_inferred": {"inference", "assumption"},
    "estimate_consensus": {"estimate", "reported_fact"},
    "missing_required_source": {"unknown"},
}

CONFIDENCE = {"high", "medium", "low"}

METHODS = {
    "as_reported",
    "scaled_to_mm",
    "sign_flipped",
    "calculated",
    "mapped",
    "currency_converted",
    "percent_to_decimal",
    "bps_to_decimal",
    "missing_value",
    "unparsed_text_value",
}

PACKAGE_FILES = {
    "Source_Index.csv": {
        "source_id",
        "source_name",
        "source_type",
        "owner_or_provider",
        "period_covered",
        "as_of_date",
        "retrieved_at",
        "file_tab_page_url_or_location",
        "source_rank",
        "freshness_status",
        "notes",
    },
    "Mapping_Dictionary.csv": {
        "line_item_original",
        "line_item_standard",
        "line_item_id",
        "statement",
        "mapping_confidence",
        "normalization_note",
    },
    "Adjustments_Log.csv": {
        "adjustment_id",
        "entity",
        "period",
        "metric",
        "amount",
        "direction",
        "reason",
        "source_id",
        "evidence_label",
        "canonical_evidence_category",
        "confidence",
        "included_in_output",
        "preliminary_model_treatment",
    },
    "Conflict_Log.csv": {
        "conflict_id",
        "entity",
        "metric",
        "period",
        "source_a",
        "value_a",
        "source_b",
        "value_b",
        "conflict_type",
        "working_value",
        "resolution_basis",
        "open_question",
    },
    "Assumptions_Register.csv": {
        "assumption_id",
        "assumption",
        "source_or_owner",
        "rationale",
        "affected_outputs",
        "evidence_label",
        "canonical_evidence_category",
        "confidence",
        "replacement_source_needed",
    },
    "QA_Flags.csv": {
        "flag_id",
        "severity",
        "entity",
        "period",
        "area",
        "issue",
        "impact",
        "recommended_fix",
        "source_id",
        "status",
    },
}


def is_number(value: str) -> bool:
    try:
        number = float(str(value).replace(",", ""))
    except Exception:
        return False
    return math.isfinite(number)


def parse_float(value: str) -> float | None:
    try:
        number = float(str(value).replace(",", ""))
    except Exception:
        return None
    return number if math.isfinite(number) else None


def source_suggests_percent(value: str, units: str) -> bool:
    text = f"{value} {units}".lower()
    return "%" in text or "percent" in text or "percentage" in text


def source_suggests_bps(value: str, units: str) -> bool:
    return bool(re.search(r"\b(bps?|basis points?)\b", f"{value} {units}".lower()))


def source_suggests_scale(value: str, units: str) -> bool:
    text = f"{value} {units}".lower()
    return bool(
        re.search(
            r"(\$?\s*000s?|\$?\s*'000|thousand|thousands|\$?\s*mm|\$?\s*million|\$?\s*bn|\$?\s*billion|\bones\b|dollars|\busd\b|\$)",
            text,
        )
        or re.search(r"\d\s*(k|m|mm|b|bn)\b", text)
    )


def validate(path: Path) -> dict[str, object]:
    errors: list[str] = []
    warnings: list[str] = []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        missing = sorted(REQUIRED - fields)
        if missing:
            return {
                "ok": False,
                "rows": 0,
                "errors": ["missing columns: " + ", ".join(missing)],
                "warnings": [],
            }
        rows = list(reader)

    for i, row in enumerate(rows, start=2):
        label = f"row {i}"
        evidence_label = row.get("evidence_label", "")
        canonical = row.get("canonical_evidence_category", "")
        method = row.get("normalization_method", "")
        confidence = row.get("confidence", "")
        source_value = row.get("source_value", "")
        normalized_value = row.get("normalized_value", "")
        units = row.get("units", "")

        if not row.get("source_id", "").startswith("SRC-"):
            warnings.append(f"{label}: source_id should start with SRC-")
        if evidence_label not in EVIDENCE:
            errors.append(f"{label}: invalid evidence_label {evidence_label!r}")
        if canonical not in CANONICAL_CATEGORIES:
            errors.append(f"{label}: invalid canonical_evidence_category {canonical!r}")
        elif (
            evidence_label in CANONICAL_BY_NATIVE
            and canonical not in CANONICAL_BY_NATIVE[evidence_label]
        ):
            errors.append(
                f"{label}: canonical_evidence_category {canonical!r} does not match evidence_label {evidence_label!r}"
            )
        if confidence not in CONFIDENCE:
            errors.append(f"{label}: invalid confidence {confidence!r}")
        if method not in METHODS:
            warnings.append(f"{label}: unrecognized normalization_method {method!r}")

        if evidence_label == "missing_required_source":
            if normalized_value:
                errors.append(
                    f"{label}: missing_required_source rows must not include normalized_value"
                )
            if canonical != "unknown":
                errors.append(
                    f"{label}: missing_required_source must map to canonical_evidence_category 'unknown'"
                )
        elif not is_number(normalized_value):
            errors.append(f"{label}: normalized_value is not numeric")

        if method in {"percent_to_decimal", "bps_to_decimal"}:
            value = parse_float(normalized_value)
            if units != "decimal":
                errors.append(f"{label}: {method} must output units 'decimal'")
            if value is None:
                errors.append(f"{label}: {method} did not produce a numeric normalized_value")
            elif abs(value) > 10:
                warnings.append(
                    f"{label}: {method} normalized value is unusually large for a decimal rate"
                )
        if source_suggests_percent(source_value, units) and method != "percent_to_decimal":
            errors.append(
                f"{label}: source appears percent-like but normalization_method is {method!r}"
            )
        if source_suggests_bps(source_value, units) and method != "bps_to_decimal":
            errors.append(
                f"{label}: source appears bps-like but normalization_method is {method!r}"
            )
        if source_suggests_scale(source_value, units) and method == "as_reported":
            warnings.append(
                f"{label}: source appears scaled or currency-like but method is as_reported"
            )
        if method == "scaled_to_mm" and units != "$mm":
            errors.append(f"{label}: scaled_to_mm must output units '$mm'")
        if method == "unparsed_text_value":
            errors.append(
                f"{label}: source_value could not be safely parsed and still needs analyst review"
            )

        if not row.get("source_location") and evidence_label not in {
            "assumption_user_provided",
            "assumption_inferred",
            "missing_required_source",
        }:
            warnings.append(f"{label}: missing source_location")
        if canonical in {"assumption", "inference", "unknown"} and confidence == "high":
            warnings.append(f"{label}: high confidence is unusual for {canonical}")
        if not row.get("line_item_id"):
            errors.append(f"{label}: missing line_item_id")
        if not row.get("period_label"):
            warnings.append(f"{label}: missing period_label")

    return {"ok": not errors, "rows": len(rows), "errors": errors, "warnings": warnings}


def validate_package(package_dir: Path) -> dict[str, object]:
    errors: list[str] = []
    warnings: list[str] = []
    for filename, required_columns in PACKAGE_FILES.items():
        path = package_dir / filename
        if not path.exists():
            errors.append(f"missing package file: {filename}")
            continue
        with path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            fields = set(reader.fieldnames or [])
            missing = sorted(required_columns - fields)
            if missing:
                errors.append(f"{filename}: missing columns: {', '.join(missing)}")
            rows = list(reader)
        if filename in {"Source_Index.csv", "Mapping_Dictionary.csv"} and not rows:
            warnings.append(f"{filename}: no rows found")
        if filename == "Adjustments_Log.csv":
            for i, row in enumerate(rows, start=2):
                if not row.get("preliminary_model_treatment", "").strip():
                    errors.append(f"{filename} row {i}: missing preliminary_model_treatment")
    return {"ok": not errors, "errors": errors, "warnings": warnings}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--require-package",
        action="store_true",
        help="Also validate companion package files in the CSV directory",
    )
    args = parser.parse_args()
    if not args.csv_path.exists():
        print(f"file not found: {args.csv_path}", file=sys.stderr)
        return 2
    result = validate(args.csv_path)
    if args.require_package:
        package_result = validate_package(args.csv_path.parent)
        result["errors"] = [*result["errors"], *package_result["errors"]]  # type: ignore[index]
        result["warnings"] = [*result["warnings"], *package_result["warnings"]]  # type: ignore[index]
        result["ok"] = bool(result["ok"] and package_result["ok"])
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("ok" if result["ok"] else "failed")
        print(f"rows: {result['rows']}")
        for error in result["errors"]:
            print(f"error: {error}")
        for warning in result["warnings"]:
            print(f"warning: {warning}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
