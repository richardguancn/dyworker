#!/usr/bin/env python3
"""Validate a CIM source log CSV for required columns and missing evidence fields.

Usage:
  python scripts/check_source_log.py path/to/source_log.csv
  python scripts/check_source_log.py path/to/source_log.csv --fail-on-missing
"""

import argparse
import csv
import sys
from pathlib import Path

REQUIRED_COLUMNS = [
    "claim_or_metric",
    "section_or_page",
    "source_name",
    "source_date",
    "fact_tag",
    "confidence",
    "external_ready",
    "review_status",
]

RECOMMENDED_COLUMNS = [
    "value",
    "period",
    "unit",
    "source_location",
    "notes",
    "owner",
]

CRITICAL_FIELDS = [
    "claim_or_metric",
    "section_or_page",
    "source_name",
    "fact_tag",
    "confidence",
]


def read_rows(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"file not found: {path}")
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        rows = list(reader)
    return fieldnames, rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a CIM source log CSV.")
    parser.add_argument("csv_path", help="Path to source_log.csv")
    parser.add_argument(
        "--fail-on-missing",
        action="store_true",
        help="Return non-zero exit code when critical row fields are missing.",
    )
    args = parser.parse_args()

    fieldnames, rows = read_rows(Path(args.csv_path))
    missing_columns = [col for col in REQUIRED_COLUMNS if col not in fieldnames]
    missing_recommended = [col for col in RECOMMENDED_COLUMNS if col not in fieldnames]

    print("CIM source log validation")
    print(f"Rows: {len(rows)}")

    if missing_columns:
        print("Missing required columns:")
        for col in missing_columns:
            print(f"- {col}")
        return 2

    if missing_recommended:
        print("Missing recommended columns:")
        for col in missing_recommended:
            print(f"- {col}")

    problem_rows = []
    for idx, row in enumerate(rows, start=2):
        missing_fields = [field for field in CRITICAL_FIELDS if not (row.get(field) or "").strip()]
        if missing_fields:
            problem_rows.append((idx, missing_fields))

    if problem_rows:
        print("Rows with missing critical fields:")
        for row_num, fields in problem_rows:
            print(f"- row {row_num}: {', '.join(fields)}")
    else:
        print("No missing critical fields found.")

    if args.fail_on_missing and problem_rows:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
