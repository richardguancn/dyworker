#!/usr/bin/env python3
"""Validate a lower-level pitch-deck slide blueprint JSON file.

This validator is for the construction blueprint used after the deck plan has
been approved or stabilized. It is not the validator for the user-facing page
plan; use validate_deck_plan_json.py for that upstream contract.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

VALID_STATUS = {"ready", "needs_source", "assumption", "placeholder"}
VALID_EVIDENCE = {
    "fact",
    "source_derived",
    "model_derived",
    "banker_view",
    "assumption",
    "placeholder",
    "unknown",
}
VALID_CANONICAL_EVIDENCE_CATEGORIES = {
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
VALID_PLAN_STATUS = {"approved", "stabilized", "md_reviewed", "user_confirmed"}
VALID_DECK_TYPES = {
    "buyer_pitch",
    "sell_side_pitch",
    "financing_pitch",
    "strategic_alternatives",
    "company_profile",
    "market_map",
    "board_client_meeting",
}


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover
        raise ValueError(f"Could not read JSON: {exc}") from exc


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for field in [
        "deck_type",
        "audience",
        "objective",
        "entity",
        "prepared_date",
        "source_confidence",
        "banker_thesis",
        "slides",
    ]:
        if field not in data:
            errors.append(f"Missing top-level field: {field}")
    deck_type = data.get("deck_type")
    if deck_type and deck_type not in VALID_DECK_TYPES:
        errors.append(f"deck_type must be one of {sorted(VALID_DECK_TYPES)}")
    slides = data.get("slides", [])
    if not isinstance(slides, list) or not slides:
        errors.append("slides must be a non-empty list")
        return errors
    plan_status = data.get("plan_status")
    if plan_status and plan_status not in VALID_PLAN_STATUS:
        errors.append(f"plan_status must be one of {sorted(VALID_PLAN_STATUS)}")

    source_ids = {
        s.get("source_id") for s in data.get("source_register", []) if isinstance(s, dict)
    }

    for idx, slide in enumerate(slides, 1):
        prefix = f"slide {idx}"
        for field in [
            "slide_number",
            "section",
            "slide_title",
            "executive_takeaway",
            "slide_purpose",
            "recommended_visual",
            "status",
        ]:
            if not slide.get(field):
                errors.append(f"{prefix}: missing {field}")
        status = slide.get("status")
        if status and status not in VALID_STATUS:
            errors.append(f"{prefix}: invalid status {status}")
        if status == "ready" and not (slide.get("sources") or slide.get("content_blocks")):
            errors.append(f"{prefix}: ready slide needs sources or content blocks")
        for sid in slide.get("sources", []) or []:
            if source_ids and sid not in source_ids:
                errors.append(f"{prefix}: source {sid} not found in source_register")
        for block_num, block in enumerate(slide.get("content_blocks", []) or [], 1):
            label = block.get("evidence_label")
            if label not in VALID_EVIDENCE:
                errors.append(f"{prefix} block {block_num}: invalid or missing evidence_label")
            canonical = block.get("canonical_evidence_category")
            if canonical and canonical not in VALID_CANONICAL_EVIDENCE_CATEGORIES:
                errors.append(
                    f"{prefix} block {block_num}: canonical_evidence_category must use the shared "
                    "Investment Banking evidence-label taxonomy"
                )
            if label in {"fact", "source_derived"} and not block.get("source_ids"):
                errors.append(f"{prefix} block {block_num}: {label} requires source_ids")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Validate a lower-level pitch-deck slide blueprint JSON file used after "
            "the deck plan has been approved or stabilized."
        ),
        epilog="For the user-facing structured deck plan, use validate_deck_plan_json.py instead.",
    )
    parser.add_argument(
        "json_file", type=Path, help="Path to the slide construction blueprint JSON file."
    )
    args = parser.parse_args()
    data = load_json(args.json_file)
    errors = validate(data)
    if errors:
        print("INVALID pitch-deck slide blueprint:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("VALID pitch-deck slide blueprint")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
