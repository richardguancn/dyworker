#!/usr/bin/env python3
"""
Validate an investment-banking or finance evidence ledger in CSV or JSON format.

The script checks for required fields, accepted evidence labels, canonical evidence
categories, freshness labels, missing source IDs, missing as-of dates for
market-sensitive claims, and unsupported high-impact assumptions.

Usage:
  python scripts/validate_evidence_ledger.py evidence_ledger.csv
  python scripts/validate_evidence_ledger.py evidence_ledger.json

JSON may be either a list of row objects or an object with a top-level "rows" list.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

CANONICAL_LABELS = {
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

LEGACY_LABEL_TO_CANONICAL = {
    "verified fact": "verified_fact",
    "reported fact": "reported_fact",
    "seller claim": "seller_claim",
    "management statement": "management_statement",
    "assumption": "assumption",
    "inference": "inference",
    "estimate": "estimate",
    "pro forma adjustment": "pro_forma_adjustment",
    "stale item": "stale",
    "contradicted item": "contradicted",
    "unknown": "unknown",
}

ACCEPTED_FRESHNESS = {
    "current",
    "current but volatile",
    "stale but usable for history",
    "potentially superseded",
    "stale for decision",
    "unknown freshness",
    "unknown",
    "n/a",
    "na",
    "",
}

REQUIRED_CANONICAL = ["claim", "label", "support"]

FIELD_ALIASES = {
    "claim": ["claim", "claim / metric", "metric", "seller / management claim", "issue"],
    "label": [
        "canonical_evidence_category",
        "canonical evidence category",
        "label",
        "evidence label",
        "type",
        "status",
    ],
    "source": ["source", "source id", "source ids", "source id(s)", "sources"],
    "support": ["support", "exact support", "evidence support", "basis"],
    "freshness": ["freshness", "staleness", "freshness label"],
    "as_of": ["as of", "as-of", "as-of date", "date / as-of", "date"],
    "impact": ["impact", "decision impact", "materiality"],
    "caveat": ["caveat", "caveat / conflict", "conflict", "notes"],
}

MARKET_SENSITIVE_TERMS = re.compile(
    r"\b(price|yield|spread|fx|foreign exchange|rate|rates|curve|vol|volatility|"
    r"market cap|enterprise value|ev/|multiple|consensus|rating|cap rate|rent roll|"
    r"liquidity|covenant|headroom|debt balance|borrowing base)\b",
    re.IGNORECASE,
)


def normalize_key(key: str) -> str:
    return re.sub(r"\s+", " ", key.strip().lower())


def canonicalize_label(label: str) -> str:
    normalized = label.strip().lower()
    normalized = normalized.replace("-", "_")
    if normalized in CANONICAL_LABELS:
        return normalized
    return LEGACY_LABEL_TO_CANONICAL.get(normalized.replace("_", " "), "")


def canonicalize_row(row: dict[str, Any]) -> dict[str, str]:
    normalized = {
        normalize_key(str(k)): "" if v is None else str(v).strip() for k, v in row.items()
    }
    out: dict[str, str] = {}
    for canonical, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                out[canonical] = normalized[alias]
                break
        else:
            out[canonical] = ""
    return out


def load_rows(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    warnings: list[str] = []
    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                raise ValueError("CSV has no header row")
            raw_rows = list(reader)
    elif suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("rows"), list):
            raw_rows = data["rows"]
        elif isinstance(data, list):
            raw_rows = data
        else:
            raise ValueError(
                "JSON must be a list of objects or an object with a top-level 'rows' list"
            )
        if not all(isinstance(r, dict) for r in raw_rows):
            raise ValueError("Each JSON row must be an object")
    else:
        raise ValueError("Only .csv and .json ledgers are supported")

    rows = [canonicalize_row(r) for r in raw_rows]
    if not rows:
        warnings.append("Ledger contains no rows")
    return rows, warnings


def validate_rows(rows: Iterable[dict[str, str]]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    for idx, row in enumerate(rows, start=1):
        prefix = f"row {idx}"
        for field in REQUIRED_CANONICAL:
            if not row.get(field):
                errors.append(f"{prefix}: missing required field '{field}'")

        raw_label = row.get("label", "")
        label = canonicalize_label(raw_label)
        if raw_label and not label:
            warnings.append(f"{prefix}: unrecognized evidence label '{row.get('label')}'")

        freshness = row.get("freshness", "").lower()
        if freshness not in ACCEPTED_FRESHNESS:
            warnings.append(f"{prefix}: unrecognized freshness label '{row.get('freshness')}'")

        claim = row.get("claim", "")
        source = row.get("source", "")
        as_of = row.get("as_of", "")
        impact = row.get("impact", "").lower()
        support = row.get("support", "")

        if (
            label
            in {
                "verified_fact",
                "reported_fact",
                "management_statement",
                "seller_claim",
                "pro_forma_adjustment",
            }
            and not source
        ):
            errors.append(f"{prefix}: '{label}' requires a source ID")

        if label == "assumption" and source and not support:
            warnings.append(
                f"{prefix}: assumption has a source ID but no basis/support explanation"
            )

        if label == "seller_claim" and not row.get("caveat"):
            warnings.append(f"{prefix}: seller claim should include caveat, test, or diligence ask")

        if MARKET_SENSITIVE_TERMS.search(claim) and not as_of:
            warnings.append(f"{prefix}: market-sensitive claim may need an as-of date")

        if label in {"assumption", "estimate", "inference"} and any(
            x in impact for x in ["high", "critical", "decision", "valuation", "credit"]
        ):
            warnings.append(f"{prefix}: high-impact {label} should be sensitized or escalated")

    return errors, warnings


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "Usage: python validate_evidence_ledger.py <evidence_ledger.csv|evidence_ledger.json>"
        )
        return 2

    path = Path(argv[1])
    if not path.exists():
        print(f"Error: file not found: {path}")
        return 2

    try:
        rows, load_warnings = load_rows(path)
        errors, warnings = validate_rows(rows)
        warnings = load_warnings + warnings
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}")
        return 2

    print(f"Validated {len(rows)} ledger row(s).")
    if errors:
        print("\nErrors:")
        for item in errors:
            print(f"- {item}")
    if warnings:
        print("\nWarnings:")
        for item in warnings:
            print(f"- {item}")

    if errors:
        print("\nResult: FAIL")
        return 1
    if warnings:
        print("\nResult: PASS WITH WARNINGS")
        return 0
    print("\nResult: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
