#!/usr/bin/env python3
"""Validate a user-facing investment-banking deck/page plan JSON file.

This checks the pitch-deck-builder planning contract in
references/output-schema.md: the banker-readable storyline, page sequence,
evidence, sources, assumptions, open items, and QC flags that guide a deck.
It is intentionally not a validator for the lower-level slide construction
blueprint used by presentation rendering tools.
"""

import argparse
import json
from pathlib import Path

VALID_DECK_TYPES = {
    "buyer_pitch",
    "sell_side_pitch",
    "financing_pitch",
    "strategic_alternatives",
    "company_profile",
    "market_map",
    "board_client_meeting",
}
VALID_EVIDENCE_STATUS = {"supported", "needs_source", "assumption", "placeholder"}
VALID_EVIDENCE_LABELS = {
    "fact",
    "source_derived_estimate",
    "model_derived_estimate",
    "banker_judgment",
    "client_assumption",
    "external_assumption",
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
DEFAULT_CANONICAL_BY_EVIDENCE_LABEL = {
    "source_derived_estimate": "estimate",
    "model_derived_estimate": "estimate",
    "banker_judgment": "inference",
    "client_assumption": "assumption",
    "external_assumption": "assumption",
    "placeholder": "unknown",
    "unknown": "unknown",
}
GENERIC_TITLES = {
    "market overview",
    "financial summary",
    "valuation",
    "buyer universe",
    "strategic alternatives",
    "company overview",
    "transaction overview",
    "next steps",
    "summary",
}


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid json: {exc}") from exc


def is_generic_title(title: str) -> bool:
    return title.strip().lower() in GENERIC_TITLES


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Validate a user-facing investment-banking deck/page plan JSON file. "
            "This is the planning-layer contract, not the slide construction blueprint."
        ),
        epilog="For lower-level slide construction blueprints, use validate_deck_blueprint.py instead.",
    )
    parser.add_argument(
        "json_file", type=Path, help="Path to the user-facing deck/page plan JSON file."
    )
    args = parser.parse_args()

    data = load_json(args.json_file)
    errors = []
    warnings = []

    metadata = data.get("deck_metadata", {})
    deck_type = metadata.get("deck_type")
    if deck_type not in VALID_DECK_TYPES:
        errors.append(f"deck_metadata.deck_type must be one of {sorted(VALID_DECK_TYPES)}")
    for field in ["client_or_subject", "audience", "objective", "prepared_date"]:
        if not metadata.get(field):
            errors.append(f"deck_metadata.{field} is required")
    if metadata.get("non_destructive_mode") is not True:
        errors.append("deck_metadata.non_destructive_mode must be true")

    storyline = data.get("md_storyline", {})
    if not storyline.get("recommended_action"):
        errors.append("md_storyline.recommended_action is required")
    if not storyline.get("why_now"):
        warnings.append("md_storyline.why_now is empty; MD-level pitch should explain urgency")
    if len(storyline.get("proof_pillars", [])) < 2:
        warnings.append("md_storyline.proof_pillars should include at least two proof pillars")

    source_ids = {
        source.get("source_id") for source in data.get("sources", []) if source.get("source_id")
    }
    slides = data.get("slides")
    if not isinstance(slides, list) or not slides:
        errors.append("slides must be a non-empty list of planned deck pages")
    else:
        for idx, slide in enumerate(slides, start=1):
            prefix = f"slides[{idx}]"
            title = slide.get("slide_title", "")
            if not title:
                errors.append(f"{prefix}.slide_title is required")
            elif is_generic_title(title):
                warnings.append(f"{prefix}.slide_title appears generic: {title!r}")
            if not slide.get("key_message"):
                errors.append(f"{prefix}.key_message is required")
            status = slide.get("evidence_status")
            if status not in VALID_EVIDENCE_STATUS:
                errors.append(
                    f"{prefix}.evidence_status must be one of {sorted(VALID_EVIDENCE_STATUS)}"
                )
            if not slide.get("recommended_visual"):
                warnings.append(
                    f"{prefix}.recommended_visual is empty; describe the intended page visual at a planning level"
                )
            for m_idx, metric in enumerate(slide.get("metrics", []), start=1):
                label = metric.get("evidence_label")
                if label not in VALID_EVIDENCE_LABELS:
                    errors.append(f"{prefix}.metrics[{m_idx}].evidence_label is invalid")
                canonical = metric.get("canonical_evidence_category")
                if canonical and canonical not in VALID_CANONICAL_EVIDENCE_CATEGORIES:
                    errors.append(
                        f"{prefix}.metrics[{m_idx}].canonical_evidence_category must use the shared "
                        "Investment Banking evidence-label taxonomy"
                    )
                expected_canonical = DEFAULT_CANONICAL_BY_EVIDENCE_LABEL.get(label)
                if canonical and expected_canonical and canonical != expected_canonical:
                    warnings.append(
                        f"{prefix}.metrics[{m_idx}].canonical_evidence_category usually maps to "
                        f"{expected_canonical!r} for native label {label!r}; confirm source context if using {canonical!r}"
                    )
                source_id = metric.get("source_id")
                if label in {"fact", "source_derived_estimate", "model_derived_estimate"}:
                    if not source_id or (source_id not in source_ids and source_id != "assumption"):
                        errors.append(
                            f"{prefix}.metrics[{m_idx}] needs a valid source_id for label {label}"
                        )
                if not metric.get("period"):
                    warnings.append(f"{prefix}.metrics[{m_idx}] missing period")

    qa = data.get("qa", {})
    if qa.get("assumptions_labeled") is not True:
        warnings.append("qa.assumptions_labeled should be true before final delivery")
    if qa.get("template_preserved") is not True:
        warnings.append("qa.template_preserved should be true unless user asked to change style")

    if errors:
        print("INVALID user-facing deck/page plan")
        for error in errors:
            print(f"ERROR: {error}")
        for warning in warnings:
            print(f"WARNING: {warning}")
        return 1

    print("VALID user-facing deck/page plan")
    for warning in warnings:
        print(f"WARNING: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
