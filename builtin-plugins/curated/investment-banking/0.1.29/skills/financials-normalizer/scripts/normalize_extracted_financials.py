#!/usr/bin/env python3
"""Normalize already-extracted financial rows into the financials-normalizer schema.

Inputs may be CSV or JSON. The script is intentionally conservative: it
preserves exact source values, maps only clear aliases, normalizes obvious
scales/percentages/basis points, and emits QA flags when analyst review is still
needed.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    dict_rows_to_sheet,
    support_dir,
    write_artifact_manifest,
    write_cover_first_workbook,
)

OUTPUT_COLUMNS = [
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
    "evidence_label_note",
    "confidence",
    "normalization_note",
]

SOURCE_INDEX_COLUMNS = [
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
]

MAPPING_DICTIONARY_COLUMNS = [
    "line_item_original",
    "line_item_standard",
    "line_item_id",
    "statement",
    "mapping_confidence",
    "normalization_note",
]

ADJUSTMENTS_LOG_COLUMNS = [
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
]

CONFLICT_LOG_COLUMNS = [
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
]

ASSUMPTIONS_REGISTER_COLUMNS = [
    "assumption_id",
    "assumption",
    "source_or_owner",
    "rationale",
    "affected_outputs",
    "evidence_label",
    "canonical_evidence_category",
    "confidence",
    "replacement_source_needed",
]

QA_FLAGS_COLUMNS = [
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
]

ALLOWED_STATEMENTS = {
    "income_statement",
    "balance_sheet",
    "cash_flow",
    "kpi_schedule",
    "segment",
    "debt_schedule",
    "share_count",
    "working_capital",
    "adjustment",
}

EVIDENCE_LABELS = {
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

PRIMARY_SOURCE_TYPES = {
    "uploaded_file",
    "connected_system",
    "filing",
    "earnings_release",
    "transcript",
    "investor_deck",
}

MISSING_VALUE_TOKENS = {"", "na", "n/a", "nm", "n.m.", "-", "--", "null", "none"}

NUMBER_RE = re.compile(
    r"(?P<prefix>[-+(]?\s*\$?)"
    r"(?P<number>\d[\d,]*(?:\.\d+)?)"
    r"\s*(?P<suffix>%|bps?|basis points?|billion|bn|million|mm|thousand|k|m|b)?"
    r"(?P<close>\))?",
    re.IGNORECASE,
)


def norm(value: Any) -> str:
    return "" if value is None else str(value).strip()


def first_present(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and norm(row.get(key)):
            return row.get(key)
    return ""


def slug(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return re.sub(r"_+", "_", value).strip("_")


def format_number(value: float) -> str:
    if abs(value) < 0.0000005:
        value = 0.0
    text = f"{value:.10f}".rstrip("0").rstrip(".")
    return text or "0"


def lower_confidence(confidence: str, target: str = "low") -> str:
    confidence = confidence if confidence in {"high", "medium", "low"} else "low"
    if target == "low":
        return "low"
    if target == "medium" and confidence == "high":
        return "medium"
    return confidence


def add_issue(
    issues: list[dict[str, str]],
    severity: str,
    area: str,
    issue: str,
    impact: str,
    recommended_fix: str,
) -> None:
    issues.append(
        {
            "severity": severity,
            "area": area,
            "issue": issue,
            "impact": impact,
            "recommended_fix": recommended_fix,
        }
    )


def canonical_evidence(
    row: dict[str, Any], evidence_label: str, source_location: str
) -> tuple[str, str]:
    source_type = slug(norm(row.get("source_type")) or "uploaded_file")
    if evidence_label == "fact_source_reported":
        if source_type in PRIMARY_SOURCE_TYPES and source_location:
            return (
                "verified_fact",
                "mapped from fact_source_reported with source location and controlling/primary source posture",
            )
        return (
            "reported_fact",
            "mapped from fact_source_reported without enough source context to call verified",
        )
    if evidence_label == "fact_provider_standardized":
        return (
            "reported_fact",
            "provider-standardized value; attribute to provider and compare to primary source when material",
        )
    if evidence_label == "derived_calculation":
        return (
            "estimate",
            "calculated from sourced inputs; preserve formula/support outside the value field",
        )
    if evidence_label == "management_adjusted":
        return (
            "pro_forma_adjustment",
            "management-adjusted metric or add-back; keep bridge/support visible",
        )
    if evidence_label == "analyst_adjusted":
        return (
            "pro_forma_adjustment",
            "analyst-normalized or adjusted metric; keep method and rationale visible",
        )
    if evidence_label == "assumption_user_provided":
        return "assumption", "user/client provided assumption; preserve owner"
    if evidence_label == "assumption_inferred":
        return "inference", "inferred assumption; low confidence until confirmed"
    if evidence_label == "estimate_consensus":
        return "estimate", "consensus/provider forecast; cite provider and as-of date"
    if evidence_label == "missing_required_source":
        return "unknown", "required value is unavailable and should become a source request"
    return "unknown", "unrecognized native evidence label"


def detect_scale(source_text: str, source_units: str, suffix: str) -> tuple[float | None, str, str]:
    text = source_text.lower()
    explicit_unit = f"{source_units} {suffix}".lower()
    if re.search(r"\b(bps?|basis points?)\b", explicit_unit):
        return 0.0001, "decimal", "bps_to_decimal"
    if "%" in text or re.search(r"\b(percent|percentage)\b", explicit_unit):
        return 0.01, "decimal", "percent_to_decimal"
    if re.search(r"(\$?\s*000s?|\$?\s*'000|thousand|thousands|\bk\b)", explicit_unit) or re.search(
        r"\d\s*k\b", text
    ):
        return 0.001, "$mm", "scaled_to_mm"
    if re.search(r"(\$?\s*mm|\$?\s*million|\bmm\b|\bm\b)", explicit_unit) or re.search(
        r"\d\s*m\b", text
    ):
        return 1.0, "$mm", "scaled_to_mm"
    if re.search(r"(\$?\s*bn|\$?\s*billion|\bbn\b|\bb\b)", explicit_unit) or re.search(
        r"\d\s*(b|bn)\b", text
    ):
        return 1000.0, "$mm", "scaled_to_mm"
    if re.search(r"(\bones\b|dollars|\busd\b)", explicit_unit) or "$" in text:
        return 0.000001, "$mm", "scaled_to_mm"
    return None, source_units, "as_reported"


def parse_financial_value(
    source_text: str, source_units: str
) -> tuple[str, str, str, list[str], list[dict[str, str]]]:
    notes: list[str] = []
    issues: list[dict[str, str]] = []
    text = norm(source_text)
    units = norm(source_units)
    if text.lower() in MISSING_VALUE_TOKENS:
        add_issue(
            issues,
            "warning",
            "value",
            "source value is blank or marked not meaningful",
            "output cannot be model-ready until a source value or explicit missing-source label is supplied",
            "replace with sourced value or mark evidence_label as missing_required_source",
        )
        return units, "", "missing_value", notes, issues

    matches = list(NUMBER_RE.finditer(text))
    if len(matches) != 1:
        issue = (
            "source value contains multiple numeric tokens"
            if len(matches) > 1
            else "source value does not contain a parseable number"
        )
        add_issue(
            issues,
            "error",
            "value",
            issue,
            "script cannot safely infer the intended normalized value",
            "extract the exact numeric value into its own field and keep narrative context in notes",
        )
        notes.append("value requires analyst review before normalization")
        return units, "", "unparsed_text_value", notes, issues

    match = matches[0]
    raw_number = match.group("number").replace(",", "")
    value = float(raw_number)
    prefix = match.group("prefix") or ""
    suffix = match.group("suffix") or ""
    if (
        "-" in prefix
        or "(" in prefix
        or (text.startswith("(") and text.endswith(")"))
        or match.group("close")
    ):
        value = -abs(value)

    if re.search(r"\b(approx|approximately|about|around|~|est\.?|estimate)\b", text.lower()):
        notes.append("approximate source value parsed; review precision")
        add_issue(
            issues,
            "warning",
            "value",
            "source value is approximate",
            "normalized value is usable for draft analysis but not final tie-out without support",
            "replace with exact source value if material",
        )

    scale, normalized_units, method = detect_scale(text, units, suffix)
    if scale is None:
        notes.append("units or scale missing; normalized value preserves source numeric")
        add_issue(
            issues,
            "warning",
            "units",
            "source units or scale are missing",
            "downstream model may misread ones, thousands, millions, percentages, or basis points",
            "supply source units such as $mm, $000, %, or bps",
        )
        normalized_value = value
        normalized_units = units
        method = "as_reported"
    else:
        normalized_value = value * scale
        if method == "percent_to_decimal":
            notes.append("percent converted to decimal")
        elif method == "bps_to_decimal":
            notes.append("basis points converted to decimal")
        elif method == "scaled_to_mm":
            notes.append("value scaled to $mm")

    return normalized_units, format_number(normalized_value), method, notes, issues


def infer_period_type(period_label: str, period_type: str) -> str:
    if period_type:
        return period_type
    p = period_label.lower()
    if "ltm" in p:
        return "ltm"
    if "ytd" in p:
        return "ytd"
    if re.search(r"q[1-4]|quarter", p):
        return "quarterly"
    if re.search(r"fy|year", p):
        return "annual"
    if re.search(r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec", p):
        return "monthly"
    if re.search(r"budget|forecast|plan|case|scenario", p):
        return "forecast"
    return ""


def load_aliases(path: Path) -> dict[str, dict[str, str]]:
    aliases: dict[str, dict[str, str]] = {}
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            alias = slug(norm(row.get("alias")))
            if alias:
                aliases[alias] = {
                    "line_item_id": norm(row.get("line_item_id")),
                    "line_item_standard": norm(row.get("line_item_standard")),
                    "statement": norm(row.get("statement")),
                }
    return aliases


def load_input(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as f:
            return [dict(row) for row in csv.DictReader(f)]
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [dict(row) for row in data]
        if isinstance(data, dict):
            rows = data.get("rows") or data.get("records") or data.get("data") or []
            if isinstance(rows, list):
                metadata = data.get("metadata") or {}
                return [dict(metadata, **dict(row)) for row in rows]
        raise ValueError("json input must be a list or an object with rows/records/data")
    raise ValueError("input must be .csv or .json")


def normalize_row(
    row: dict[str, Any],
    aliases: dict[str, dict[str, str]],
) -> tuple[dict[str, str], list[dict[str, str]]]:
    original = norm(first_present(row, "line_item_original", "label", "line_item", "source_label"))
    alias = aliases.get(slug(original), {})
    exact_source_value = norm(first_present(row, "source_value", "value", "amount"))
    statement = norm(first_present(row, "statement")) or alias.get("statement", "")
    line_item_id = norm(first_present(row, "line_item_id")) or alias.get("line_item_id", "")
    line_item_standard = norm(first_present(row, "line_item_standard")) or alias.get(
        "line_item_standard", ""
    )
    confidence = norm(first_present(row, "confidence")) or "high"
    source_location = norm(first_present(row, "source_location", "locator", "cell", "page"))
    evidence_label = norm(first_present(row, "evidence_label")) or "fact_source_reported"
    units = norm(first_present(row, "units", "unit", "scale"))
    notes: list[str] = []
    issues: list[dict[str, str]] = []

    if not line_item_id:
        line_item_id = "unmapped_" + (slug(original) or "unknown")
        line_item_standard = original or "Unmapped"
        confidence = lower_confidence(confidence)
        notes.append("mapping requires analyst review")
        add_issue(
            issues,
            "warning",
            "mapping",
            "line item did not match the alias table",
            "downstream statements may group this row incorrectly",
            "add a reviewed alias or explicit line_item_id",
        )

    if statement not in ALLOWED_STATEMENTS:
        statement = alias.get("statement", statement)
    if not statement or statement not in ALLOWED_STATEMENTS:
        statement = (
            "kpi_schedule"
            if "margin" in slug(original) or "%" in exact_source_value
            else "income_statement"
        )
        confidence = lower_confidence(confidence)
        notes.append("statement inferred; review")
        add_issue(
            issues,
            "warning",
            "mapping",
            "statement was inferred",
            "row may be assigned to the wrong model schedule",
            "supply a reviewed statement value",
        )

    if evidence_label not in EVIDENCE_LABELS:
        confidence = lower_confidence(confidence)
        add_issue(
            issues,
            "error",
            "evidence",
            f"invalid evidence_label {evidence_label!r}",
            "downstream handoffs cannot map source posture reliably",
            "replace with a financials-normalizer native evidence label",
        )

    if not source_location and evidence_label not in {
        "assumption_user_provided",
        "assumption_inferred",
        "missing_required_source",
    }:
        confidence = lower_confidence(confidence)
        notes.append("source location missing")
        add_issue(
            issues,
            "warning",
            "source",
            "source location missing",
            "value cannot be efficiently traced back to page, tab, row, cell, URL, or object",
            "add source_location before formal handoff",
        )

    normalized_units, normalized_value, method, value_notes, value_issues = parse_financial_value(
        exact_source_value, units
    )
    notes.extend(value_notes)
    issues.extend(value_issues)
    if value_issues:
        confidence = lower_confidence(confidence)

    if evidence_label == "missing_required_source" and normalized_value:
        confidence = lower_confidence(confidence)
        add_issue(
            issues,
            "error",
            "evidence",
            "missing_required_source has a normalized value",
            "missing-source rows should not look model-ready",
            "remove the value or change evidence_label after sourcing support",
        )

    if evidence_label == "assumption_inferred":
        confidence = lower_confidence(confidence)
    if evidence_label == "assumption_user_provided" and confidence == "high":
        confidence = "medium"

    canonical_category, evidence_note = canonical_evidence(row, evidence_label, source_location)
    if canonical_category == "unknown" and evidence_label != "missing_required_source":
        confidence = lower_confidence(confidence)

    user_note = norm(first_present(row, "normalization_note", "note", "notes"))
    if user_note:
        notes.insert(0, user_note)

    output = {
        "entity": norm(first_present(row, "entity", "entity_name", "company")),
        "source_id": norm(first_present(row, "source_id")) or "SRC-UNSPECIFIED",
        "statement": statement,
        "line_item_original": original,
        "line_item_standard": line_item_standard,
        "line_item_id": line_item_id,
        "period_end": norm(first_present(row, "period_end")),
        "period_label": norm(first_present(row, "period_label", "period")),
        "period_type": infer_period_type(
            norm(first_present(row, "period_label", "period")),
            norm(first_present(row, "period_type")),
        ),
        "currency": norm(first_present(row, "currency")),
        "units": normalized_units,
        "source_value": exact_source_value,
        "normalized_value": normalized_value,
        "normalization_method": method,
        "source_location": source_location,
        "evidence_label": evidence_label,
        "canonical_evidence_category": canonical_category,
        "evidence_label_note": evidence_note,
        "confidence": confidence if confidence in {"high", "medium", "low"} else "low",
        "normalization_note": "; ".join(p for p in notes if p),
    }
    return output, issues


def write_csv(path: Path, rows: list[dict[str, str]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def source_index_rows(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    sources: dict[str, dict[str, str]] = {}
    retrieved_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for row in rows:
        source_id = norm(first_present(row, "source_id")) or "SRC-UNSPECIFIED"
        if source_id not in sources:
            sources[source_id] = {
                "source_id": source_id,
                "source_name": norm(first_present(row, "source_name", "source")),
                "source_type": norm(first_present(row, "source_type")) or "uploaded_file",
                "owner_or_provider": norm(first_present(row, "owner_or_provider", "provider")),
                "period_covered": norm(first_present(row, "period_label", "period")),
                "as_of_date": norm(first_present(row, "as_of_date", "source_date")),
                "retrieved_at": norm(first_present(row, "retrieved_at")) or retrieved_at,
                "file_tab_page_url_or_location": norm(
                    first_present(row, "source_location", "locator", "file")
                ),
                "source_rank": norm(first_present(row, "source_rank")),
                "freshness_status": norm(first_present(row, "freshness_status")) or "unknown",
                "notes": "review source rank and freshness before relying on output",
            }
    return list(sources.values())


def write_source_index(path: Path, rows: list[dict[str, Any]]) -> None:
    write_csv(path, source_index_rows(rows), SOURCE_INDEX_COLUMNS)


def build_companion_logs(
    normalized: list[dict[str, str]],
    row_issues: list[tuple[int, list[dict[str, str]]]],
) -> dict[str, list[dict[str, str]]]:
    mapping_seen: set[tuple[str, str, str, str]] = set()
    mappings: list[dict[str, str]] = []
    adjustments: list[dict[str, str]] = []
    assumptions: list[dict[str, str]] = []
    qa_flags: list[dict[str, str]] = []

    for row in normalized:
        mapping_key = (
            row["line_item_original"],
            row["line_item_standard"],
            row["line_item_id"],
            row["statement"],
        )
        if mapping_key not in mapping_seen:
            mapping_seen.add(mapping_key)
            mappings.append(
                {
                    "line_item_original": row["line_item_original"],
                    "line_item_standard": row["line_item_standard"],
                    "line_item_id": row["line_item_id"],
                    "statement": row["statement"],
                    "mapping_confidence": row["confidence"],
                    "normalization_note": row["normalization_note"],
                }
            )

        if (
            row["evidence_label"] in {"management_adjusted", "analyst_adjusted"}
            or row["statement"] == "adjustment"
        ):
            amount = row["normalized_value"]
            direction = ""
            if amount:
                direction = "increase" if float(amount) >= 0 else "decrease"
            adjustments.append(
                {
                    "adjustment_id": f"ADJ-{len(adjustments) + 1:03d}",
                    "entity": row["entity"],
                    "period": row["period_label"],
                    "metric": row["line_item_standard"],
                    "amount": amount,
                    "direction": direction,
                    "reason": row["normalization_note"] or row["evidence_label_note"],
                    "source_id": row["source_id"],
                    "evidence_label": row["evidence_label"],
                    "canonical_evidence_category": row["canonical_evidence_category"],
                    "confidence": row["confidence"],
                    "included_in_output": "yes" if amount else "no",
                    "preliminary_model_treatment": (
                        "include_in_normalized_view_only_pending_diligence"
                        if amount
                        else "exclude_pending_quantification_and_support"
                    ),
                }
            )

        if row["evidence_label"] in {
            "assumption_user_provided",
            "assumption_inferred",
            "missing_required_source",
        }:
            assumptions.append(
                {
                    "assumption_id": f"ASM-{len(assumptions) + 1:03d}",
                    "assumption": f"{row['line_item_standard']} / {row['period_label']}".strip(
                        " /"
                    ),
                    "source_or_owner": row["source_id"],
                    "rationale": row["normalization_note"] or row["evidence_label_note"],
                    "affected_outputs": row["line_item_id"],
                    "evidence_label": row["evidence_label"],
                    "canonical_evidence_category": row["canonical_evidence_category"],
                    "confidence": row["confidence"],
                    "replacement_source_needed": "yes"
                    if row["evidence_label"] == "missing_required_source"
                    else "no",
                }
            )

    for row_index, issues in row_issues:
        row = normalized[row_index - 1]
        for issue in issues:
            qa_flags.append(
                {
                    "flag_id": f"QA-{len(qa_flags) + 1:03d}",
                    "severity": issue["severity"],
                    "entity": row["entity"],
                    "period": row["period_label"],
                    "area": issue["area"],
                    "issue": issue["issue"],
                    "impact": issue["impact"],
                    "recommended_fix": issue["recommended_fix"],
                    "source_id": row["source_id"],
                    "status": "open",
                }
            )

    return {
        "Mapping_Dictionary.csv": mappings,
        "Adjustments_Log.csv": adjustments,
        "Conflict_Log.csv": [],
        "Assumptions_Register.csv": assumptions,
        "QA_Flags.csv": qa_flags,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Normalize extracted financial rows into long-form CSV"
    )
    parser.add_argument("input_file", type=Path, help="Extracted financial rows as CSV or JSON")
    parser.add_argument("output_dir", type=Path, help="Directory for output CSV files")
    parser.add_argument(
        "--aliases",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "references" / "line_item_aliases.csv",
    )
    args = parser.parse_args()

    aliases = load_aliases(args.aliases)
    raw_rows = load_input(args.input_file)
    normalized: list[dict[str, str]] = []
    row_issues: list[tuple[int, list[dict[str, str]]]] = []
    for raw_row in raw_rows:
        output_row, issues = normalize_row(raw_row, aliases)
        normalized.append(output_row)
        if issues:
            row_issues.append((len(normalized), issues))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    csv_dir = support_dir(args.output_dir)
    normalized_csv = csv_dir / "Normalized_Financials_Long.csv"
    write_csv(normalized_csv, normalized, OUTPUT_COLUMNS)
    source_rows = source_index_rows(raw_rows)
    write_csv(csv_dir / "Source_Index.csv", source_rows, SOURCE_INDEX_COLUMNS)

    companion_logs = build_companion_logs(normalized, row_issues)
    write_csv(
        csv_dir / "Mapping_Dictionary.csv",
        companion_logs["Mapping_Dictionary.csv"],
        MAPPING_DICTIONARY_COLUMNS,
    )
    write_csv(
        csv_dir / "Adjustments_Log.csv",
        companion_logs["Adjustments_Log.csv"],
        ADJUSTMENTS_LOG_COLUMNS,
    )
    write_csv(
        csv_dir / "Conflict_Log.csv", companion_logs["Conflict_Log.csv"], CONFLICT_LOG_COLUMNS
    )
    write_csv(
        csv_dir / "Assumptions_Register.csv",
        companion_logs["Assumptions_Register.csv"],
        ASSUMPTIONS_REGISTER_COLUMNS,
    )
    write_csv(csv_dir / "QA_Flags.csv", companion_logs["QA_Flags.csv"], QA_FLAGS_COLUMNS)

    workbook_path = args.output_dir / "normalized_financials.xlsx"
    write_cover_first_workbook(
        workbook_path,
        [
            ["Normalized Financials Package"],
            [
                "First read",
                "Use this workbook first. CSVs are support/import files in the support folder.",
            ],
            ["Normalized rows", len(normalized)],
            ["QA flags", len(companion_logs["QA_Flags.csv"])],
            ["Assumptions", len(companion_logs["Assumptions_Register.csv"])],
            ["Conflicts", len(companion_logs["Conflict_Log.csv"])],
        ],
        {
            "Source_Index": dict_rows_to_sheet(source_rows, SOURCE_INDEX_COLUMNS),
            "Normalized_IS": dict_rows_to_sheet(
                [row for row in normalized if row.get("statement") == "income_statement"]
                or normalized,
                OUTPUT_COLUMNS,
            ),
            "Normalized_BS": dict_rows_to_sheet(
                [row for row in normalized if row.get("statement") == "balance_sheet"],
                OUTPUT_COLUMNS,
            ),
            "Normalized_CF": dict_rows_to_sheet(
                [row for row in normalized if row.get("statement") == "cash_flow"], OUTPUT_COLUMNS
            ),
            "KPI_Schedules": dict_rows_to_sheet(
                [row for row in normalized if row.get("statement") == "kpi"], OUTPUT_COLUMNS
            ),
            "Adjustments": dict_rows_to_sheet(
                companion_logs["Adjustments_Log.csv"], ADJUSTMENTS_LOG_COLUMNS
            ),
            "Conflicts": dict_rows_to_sheet(
                companion_logs["Conflict_Log.csv"], CONFLICT_LOG_COLUMNS
            ),
            "QA_Log": dict_rows_to_sheet(companion_logs["QA_Flags.csv"], QA_FLAGS_COLUMNS),
            "Model_Handoff": [
                ["field", "value"],
                ["normalized_csv", str(normalized_csv)],
                ["support_folder", str(csv_dir)],
            ],
        },
    )

    support_artifacts = [
        artifact_item(
            csv_dir / file_name,
            "support_artifact",
            "csv",
            f"{file_name} backing table for audit/import workflows.",
            False,
            file_name == "Normalized_Financials_Long.csv",
            "CSV files are import/audit support; the workbook is the banker-facing first read.",
        )
        for file_name in [
            "Normalized_Financials_Long.csv",
            "Source_Index.csv",
            "Mapping_Dictionary.csv",
            "Adjustments_Log.csv",
            "Conflict_Log.csv",
            "Assumptions_Register.csv",
            "QA_Flags.csv",
        ]
    ]
    write_artifact_manifest(
        args.output_dir,
        "financials-normalizer",
        "workbook",
        workbook_path,
        support_artifacts=support_artifacts,
    )

    print(f"wrote workbook first-read to {workbook_path}")
    print(f"wrote {len(normalized)} normalized rows and support CSVs to {csv_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
