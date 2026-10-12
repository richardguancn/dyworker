#!/usr/bin/env python3
"""
Score and tier a buyer / investor / lender universe from a CSV file.

This helper is intentionally conservative:
- It never deletes or modifies original columns.
- It appends new scoring, tiering, wave, judgment, and QA columns.
- It treats scores as a first-pass decision aid, not a substitute for banker judgment.

Expected optional score columns use a 0-5 scale. Values on a 0-100 scale are
converted to 0-5 automatically. The canonical positive dimensions match
references/scoring-framework.md:
strategic_or_mandate_fit, ability_to_transact, probability_of_interest,
execution_certainty, process_value, relationship_access.

Usage:
  python scripts/score_buyer_universe.py input.csv output.csv
  python scripts/score_buyer_universe.py input.csv output.csv --objective preserve_confidentiality
  python scripts/score_buyer_universe.py input.csv output.csv --weights weights.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Iterable, Sequence

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    dict_rows_to_sheet,
    write_artifact_manifest,
    write_cover_first_workbook,
)

DimensionFields = tuple[str, ...]

DEFAULT_WEIGHTS: dict[str, float] = {
    "strategic_or_mandate_fit": 0.25,
    "ability_to_transact": 0.20,
    "probability_of_interest": 0.20,
    "execution_certainty": 0.15,
    "process_value": 0.10,
    "relationship_access": 0.10,
}

OBJECTIVE_WEIGHTS: dict[str, dict[str, float]] = {
    "default": DEFAULT_WEIGHTS,
    "maximize_valuation": {
        "strategic_or_mandate_fit": 0.30,
        "ability_to_transact": 0.25,
        "probability_of_interest": 0.15,
        "execution_certainty": 0.10,
        "process_value": 0.15,
        "relationship_access": 0.05,
    },
    "maximize_certainty": {
        "strategic_or_mandate_fit": 0.15,
        "ability_to_transact": 0.25,
        "probability_of_interest": 0.15,
        "execution_certainty": 0.25,
        "process_value": 0.05,
        "relationship_access": 0.15,
    },
    "preserve_confidentiality": {
        "strategic_or_mandate_fit": 0.15,
        "ability_to_transact": 0.15,
        "probability_of_interest": 0.15,
        "execution_certainty": 0.20,
        "process_value": 0.05,
        "relationship_access": 0.30,
    },
    "founder_friendly_recap": {
        "strategic_or_mandate_fit": 0.25,
        "ability_to_transact": 0.15,
        "probability_of_interest": 0.15,
        "execution_certainty": 0.15,
        "process_value": 0.10,
        "relationship_access": 0.20,
    },
    "lender_process": {
        "strategic_or_mandate_fit": 0.25,
        "ability_to_transact": 0.25,
        "probability_of_interest": 0.15,
        "execution_certainty": 0.20,
        "process_value": 0.05,
        "relationship_access": 0.10,
    },
    "distressed_restructuring": {
        "strategic_or_mandate_fit": 0.15,
        "ability_to_transact": 0.25,
        "probability_of_interest": 0.15,
        "execution_certainty": 0.25,
        "process_value": 0.10,
        "relationship_access": 0.10,
    },
}

DIMENSION_FIELDS: dict[str, DimensionFields] = {
    "strategic_or_mandate_fit": (
        "strategic_or_mandate_fit",
        "strategic_fit",
        "mandate_fit",
        "credit_mandate_fit",
        "lender_mandate_fit",
        "fit",
    ),
    "ability_to_transact": (
        "ability_to_transact",
        "ability_to_pay",
        "ability_to_invest",
        "capacity_fit",
        "financing_capacity",
        "hold_size_fit",
        "check_size_fit",
        "capital_capacity",
    ),
    "probability_of_interest": (
        "probability_of_interest",
        "interest_probability",
        "likely_interest",
        "appetite",
        "probability",
    ),
    "execution_certainty": (
        "execution_certainty",
        "certainty",
        "speed",
        "diligence_capability",
        "ic_complexity_score",
    ),
    "process_value": (
        "process_value",
        "valuation_potential",
        "competitive_tension",
        "stalking_horse_value",
        "signaling_value",
    ),
    "relationship_access": (
        "relationship_access",
        "relationship",
        "access",
        "warm_path",
        "coverage_relationship",
    ),
}

WEIGHT_ALIASES = {
    "strategic_fit": "strategic_or_mandate_fit",
    "mandate_fit": "strategic_or_mandate_fit",
    "credit_mandate_fit": "strategic_or_mandate_fit",
    "lender_mandate_fit": "strategic_or_mandate_fit",
    "ability_to_pay": "ability_to_transact",
    "ability_to_invest": "ability_to_transact",
    "capacity_fit": "ability_to_transact",
    "financing_capacity": "ability_to_transact",
    "interest_probability": "probability_of_interest",
    "likely_interest": "probability_of_interest",
    "certainty": "execution_certainty",
    "relationship": "relationship_access",
    "access": "relationship_access",
}

RISK_WEIGHTS = {
    "confidentiality_risk": 4.0,
    "regulatory_risk": 5.0,
    "conflict_risk": 5.0,
    "financing_risk": 3.0,
    "bad_process_risk": 5.0,
}

HARD_SCREEN_PATTERNS = re.compile(
    r"\b(do\s*not\s*contact|dnc|exclude|restricted|sanction|explicit\s*no|client\s*no|client\s*restriction)\b",
    re.IGNORECASE,
)

HOLD_PATTERNS = re.compile(
    r"\b(client approval|legal review|compliance review|conflicts review|antitrust review|clean team|approval gate)\b",
    re.IGNORECASE,
)

YES_VALUES = {"yes", "y", "true", "1", "x"}
LOW_VALUES = {"low", "thin", "stale", "inference", "inferred", "unknown", "needs validation"}
MEDIUM_VALUES = {"medium", "structured", "public", "relationship"}
HIGH_VALUES = {"high", "direct", "verified", "user provided", "user-provided", "connected"}


def norm_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def normalize_objective(value: str | None) -> str:
    objective = norm_header(value or "default")
    aliases = {
        "max_value": "maximize_valuation",
        "valuation": "maximize_valuation",
        "price": "maximize_valuation",
        "certainty": "maximize_certainty",
        "speed": "maximize_certainty",
        "confidentiality": "preserve_confidentiality",
        "confidential": "preserve_confidentiality",
        "founder": "founder_friendly_recap",
        "recap": "founder_friendly_recap",
        "lender": "lender_process",
        "credit": "lender_process",
        "distressed": "distressed_restructuring",
        "restructuring": "distressed_restructuring",
    }
    return aliases.get(objective, objective)


def as_float(value: str | None, default: float = 0.0) -> float:
    if value is None:
        return default
    text = str(value).strip()
    if not text:
        return default
    try:
        number = float(text)
    except ValueError:
        return default
    if 5.0 < number <= 100.0:
        number = number / 20.0
    return max(0.0, min(5.0, number))


def truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in YES_VALUES


def first_present(row: dict[str, str], candidates: Iterable[str]) -> str:
    for candidate in candidates:
        if candidate in row and str(row[candidate]).strip():
            return str(row[candidate]).strip()
    return ""


def clean_party_name(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    text = re.sub(r"\s*\([^)]*\)\s*$", "", text).strip()
    return text


def normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    normalized = {key: 0.0 for key in DEFAULT_WEIGHTS}
    for key, value in weights.items():
        canonical = WEIGHT_ALIASES.get(norm_header(key), norm_header(key))
        if canonical not in normalized:
            raise SystemExit(f"Unknown score dimension in weights file: {key!r}")
        normalized[canonical] += float(value)
    total = sum(max(0.0, value) for value in normalized.values())
    if total <= 0:
        raise SystemExit("Weights must sum to more than zero.")
    return {key: max(0.0, value) / total for key, value in normalized.items()}


def load_weights(path: str | None, objective: str) -> dict[str, float]:
    if objective not in OBJECTIVE_WEIGHTS:
        valid = ", ".join(sorted(OBJECTIVE_WEIGHTS))
        raise SystemExit(f"Unknown objective {objective!r}. Valid objectives: {valid}")
    weights = dict(OBJECTIVE_WEIGHTS[objective])
    if not path:
        return normalize_weights(weights)
    with open(path, "r", encoding="utf-8") as f:
        incoming = json.load(f)
    if not isinstance(incoming, dict):
        raise SystemExit("Weights JSON must be an object of dimension names to numeric weights.")
    for key, value in incoming.items():
        canonical = WEIGHT_ALIASES.get(norm_header(key), norm_header(key))
        if canonical not in DEFAULT_WEIGHTS:
            raise SystemExit(f"Unknown score dimension in weights file: {key!r}")
        try:
            weights[canonical] = float(value)
        except (TypeError, ValueError):
            raise SystemExit(f"Invalid weight for {key!r}: {value!r}")
    return normalize_weights(weights)


def read_csv(path: Path) -> tuple[list[str], list[tuple[list[str], dict[str, str]]]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        try:
            original_headers = next(reader)
        except StopIteration:
            raise SystemExit("Input CSV has no header row.")
        if not original_headers:
            raise SystemExit("Input CSV has no header row.")
        normalized_headers = [norm_header(h) for h in original_headers]
        rows: list[tuple[list[str], dict[str, str]]] = []
        for values in reader:
            original_values = values[: len(original_headers)]
            if len(original_values) < len(original_headers):
                original_values.extend([""] * (len(original_headers) - len(original_values)))
            row: dict[str, str] = {}
            for normalized, value in zip(normalized_headers, original_values):
                if normalized and (normalized not in row or not row[normalized]):
                    row[normalized] = value
            rows.append((original_values, row))
    return original_headers, rows


def score_dimension(row: dict[str, str], fields: Sequence[str]) -> tuple[float, list[str]]:
    values: list[float] = []
    used_fields: list[str] = []
    for field in fields:
        if field in row and str(row[field]).strip():
            values.append(as_float(row.get(field)))
            used_fields.append(field)
    if not values:
        return 0.0, []
    return sum(values) / len(values), used_fields


def compute_score(
    row: dict[str, str], weights: dict[str, float]
) -> tuple[float, float, float, dict[str, float], list[str]]:
    dimension_scores: dict[str, float] = {}
    score_inputs: list[str] = []
    positive_total = 0.0
    for dimension, weight in weights.items():
        value, used_fields = score_dimension(row, DIMENSION_FIELDS[dimension])
        dimension_scores[dimension] = value
        if used_fields:
            score_inputs.append(f"{dimension}={value:.1f} from {','.join(used_fields)}")
        else:
            score_inputs.append(f"{dimension}=0.0 missing")
        positive_total += value * weight
    raw_score = positive_total * 20.0

    risk_penalty = 0.0
    for key, multiplier in RISK_WEIGHTS.items():
        value = as_float(row.get(key))
        risk_penalty += max(0.0, value - 1.0) * multiplier

    if source_confidence(row) == "low":
        risk_penalty += 5.0
    if not has_contact_path(row):
        risk_penalty += 5.0
    if HOLD_PATTERNS.search(risk_text(row)):
        risk_penalty += 5.0

    final_score = max(0.0, min(100.0, raw_score - risk_penalty))
    return (
        round(raw_score, 1),
        round(risk_penalty, 1),
        round(final_score, 1),
        dimension_scores,
        score_inputs,
    )


def risk_text(row: dict[str, str]) -> str:
    fields = [
        "status",
        "proposed_status",
        "notes",
        "risk_flags",
        "rationale",
        "investment_rationale",
        "strategic_rationale",
        "do_not_contact",
        "hard_screen",
        "conflict",
        "client_restriction",
        "confidentiality_notes",
        "approval_required",
    ]
    return " ".join(str(row.get(field, "")) for field in fields)


def has_hard_screen(row: dict[str, str]) -> bool:
    text = risk_text(row)
    if HARD_SCREEN_PATTERNS.search(text):
        return True
    if truthy(row.get("do_not_contact")) or truthy(row.get("hard_screen")):
        return True
    return False


def has_hold_gate(row: dict[str, str]) -> bool:
    status = norm_header(first_present(row, ["status", "proposed_status", "proposed_action"]))
    if status in {"hold", "on_hold", "hold_pending_approval", "hold_pending_review"}:
        return True
    if truthy(row.get("approval_required")) or truthy(row.get("client_approval_required")):
        return True
    return bool(HOLD_PATTERNS.search(risk_text(row)))


def has_contact_path(row: dict[str, str]) -> bool:
    return bool(
        first_present(
            row,
            [
                "key_contact",
                "contact",
                "relationship_owner",
                "owner",
                "coverage_owner",
                "banker_owner",
            ],
        )
    )


def has_capacity_gap(row: dict[str, str], dimension_scores: dict[str, float]) -> bool:
    explicit_gap_fields = [
        "insufficient_check_size",
        "insufficient_hold_size",
        "cannot_lead",
        "capacity_gap",
    ]
    if any(truthy(row.get(field)) for field in explicit_gap_fields):
        return True
    low_capacity_fields = [
        "check_size_fit",
        "hold_size_fit",
        "capacity_fit",
        "ability_to_transact",
        "ability_to_pay",
    ]
    if any(
        field in row and str(row[field]).strip() and as_float(row.get(field)) <= 1.0
        for field in low_capacity_fields
    ):
        return True
    return dimension_scores.get("ability_to_transact", 0.0) <= 1.0


def risk_summary(row: dict[str, str]) -> str:
    risks: list[str] = []
    for key in RISK_WEIGHTS:
        value = as_float(row.get(key))
        if value >= 4.0:
            risks.append(key.replace("_", " ") + " high")
        elif value >= 3.0:
            risks.append(key.replace("_", " ") + " medium")
    if has_hold_gate(row):
        risks.append("approval or review gate")
    if has_hard_screen(row):
        risks.append("hard screen")
    return "; ".join(risks) if risks else "no high deterministic risk flags"


def source_quality(row: dict[str, str]) -> str:
    explicit = norm_header(first_present(row, ["source_quality", "source_type", "evidence_type"]))
    if explicit in {"direct", "structured", "public", "relationship", "inference"}:
        return explicit
    text = " ".join(
        first_present(row, [field])
        for field in ["source", "evidence", "citation", "source_confidence", "source_quality"]
    ).lower()
    if any(
        token in text
        for token in ["crm", "user", "provided", "connected", "direct", "tracker", "management"]
    ):
        return "direct"
    if any(
        token in text
        for token in [
            "database",
            "cap iq",
            "pitchbook",
            "factset",
            "preqin",
            "source scrubbing",
            "structured",
        ]
    ):
        return "structured"
    if any(token in text for token in ["website", "filing", "press", "news", "public"]):
        return "public"
    if any(
        token in text for token in ["relationship", "coverage", "banker", "md", "sponsor coverage"]
    ):
        return "relationship"
    if any(token in text for token in ["infer", "assume", "unknown", "stale"]):
        return "inference"
    return "unknown"


def source_confidence(row: dict[str, str]) -> str:
    explicit = (
        first_present(row, ["source_confidence", "confidence", "evidence_confidence"])
        .strip()
        .lower()
    )
    if explicit in HIGH_VALUES:
        return "high"
    if explicit in MEDIUM_VALUES:
        return "medium"
    if explicit in LOW_VALUES:
        return "low"
    quality = source_quality(row)
    if quality in {"direct", "relationship"} and has_contact_path(row):
        return "high"
    if quality in {"direct", "structured", "public", "relationship"}:
        return "medium"
    return "low"


def rationale_quality(row: dict[str, str]) -> tuple[str, list[str]]:
    checks: list[str] = []
    if first_present(
        row, ["rationale", "investment_rationale", "strategic_rationale", "why_they_care"]
    ):
        checks.append("why care")
    if first_present(
        row,
        [
            "ability_to_transact",
            "ability_to_pay",
            "check_size",
            "hold_size",
            "fund_size",
            "capital_capacity",
        ],
    ):
        checks.append("capacity")
    if first_present(
        row,
        [
            "probability_of_interest",
            "recent_activity",
            "prior_interest",
            "evidence",
            "source",
            "mandate_evidence",
        ],
    ):
        checks.append("interest now")
    if first_present(
        row, ["outreach_angle", "message_theme", "key_contact", "relationship_owner", "contact"]
    ):
        checks.append("outreach path")
    if first_present(
        row,
        [
            "risk_flags",
            "confidentiality_risk",
            "regulatory_risk",
            "conflict_risk",
            "bad_process_risk",
            "notes",
        ],
    ):
        checks.append("risk")
    if first_present(
        row, ["structure_fit", "transaction_structure", "control_fit", "minority_fit", "lender_fit"]
    ):
        checks.append("structure")
    if len(checks) >= 3:
        return "pass", checks
    if len(checks) == 2:
        return "partial - add one more support point", checks
    return "thin - needs specific rationale", checks


def suggest_tier(
    row: dict[str, str], final_score: float, dimension_scores: dict[str, float]
) -> tuple[str, str]:
    if has_hard_screen(row):
        return "exclude / do not contact", "explicit hard screen overrides score"

    high_conf = as_float(row.get("confidentiality_risk")) >= 4.0
    high_reg = as_float(row.get("regulatory_risk")) >= 4.0
    high_conflict = as_float(row.get("conflict_risk")) >= 4.0
    hold_gate = has_hold_gate(row)
    capacity_gap = has_capacity_gap(row, dimension_scores)

    if high_conf or high_reg or high_conflict or hold_gate:
        if final_score >= 75.0 and not capacity_gap:
            return (
                "tier 1 controlled outreach",
                "high score but risk/approval gate requires controlled process",
            )
        return "hold", "risk/approval gate requires review before outreach"

    if capacity_gap:
        if final_score >= 65.0:
            return "watchlist / validate", "capacity/check-size gap prevents tier 1 treatment"
        return "low priority", "capacity/check-size gap limits actionability"

    if final_score >= 85.0:
        return "tier 1 / must contact", "risk-adjusted score supports must-contact priority"
    if final_score >= 75.0:
        return "tier 2 / strong fit", "score is strong but not must-contact absent MD upgrade"
    if final_score >= 65.0:
        return "tier 2 / strong fit", "score meets strong-fit threshold"
    if final_score >= 50.0:
        return "tier 3 / selective", "selective outreach candidate"
    if final_score >= 35.0:
        return "watchlist / validate", "needs more validation before active outreach"
    return "low priority", "low score after risk adjustment"


def suggest_wave(tier: str) -> str:
    lower = tier.lower()
    if "exclude" in lower:
        return "exclude"
    if "hold" in lower:
        return "hold / approval gate"
    if "controlled" in lower:
        return "wave 0 / controlled validation"
    if "tier 1" in lower:
        return "wave 1"
    if "tier 2" in lower:
        return "wave 2"
    if "tier 3" in lower:
        return "wave 3"
    return "validate"


def recommended_action(tier: str, confidence: str) -> str:
    lower = tier.lower()
    if "exclude" in lower:
        return "exclude"
    if "hold" in lower:
        return "hold pending approval/review"
    if "controlled" in lower:
        return "client approval then controlled outreach"
    if "tier 1" in lower:
        return "contact"
    if "tier 2" in lower:
        return (
            "contact after wave plan approval" if confidence != "low" else "validate then contact"
        )
    if "tier 3" in lower:
        return "selective outreach or validate"
    if "watchlist" in lower:
        return "validate"
    return "deprioritize"


def qa_flags(
    row: dict[str, str], confidence: str, rationale_status: str, duplicate_note: str
) -> str:
    flags: list[str] = []
    party = first_present(row, ["party", "buyer", "investor", "lender", "company", "name"])
    if not party:
        flags.append("missing party name")
    if rationale_status != "pass":
        flags.append("needs rationale quality upgrade")
    if source_quality(row) == "unknown":
        flags.append("needs source/evidence classification")
    elif confidence == "low":
        flags.append("low source confidence; validate")
    if not has_contact_path(row):
        flags.append("needs contact/relationship validation")
    if not first_present(row, ["party_type", "type", "buyer_type", "investor_type"]):
        flags.append("needs party type")
    if duplicate_note:
        flags.append(duplicate_note)
    return "; ".join(flags) if flags else "ok"


def build_md_note(tier_reason: str, risk: str, confidence: str, rationale_status: str) -> str:
    note_parts = [tier_reason]
    if risk != "no high deterministic risk flags":
        note_parts.append(risk)
    if confidence == "low":
        note_parts.append("validate source/contact support before relying on rank")
    if rationale_status != "pass":
        note_parts.append(rationale_status)
    return "; ".join(note_parts)


def append_unique_headers(
    existing_headers: list[str], appended: list[str]
) -> tuple[list[str], dict[str, str]]:
    output_headers = list(existing_headers)
    used_headers = set(output_headers)
    output_name_by_base: dict[str, str] = {}
    for col in appended:
        output_col = col
        suffix = 2
        while output_col in used_headers:
            output_col = f"{col}_{suffix}"
            suffix += 1
        used_headers.add(output_col)
        output_headers.append(output_col)
        output_name_by_base[col] = output_col
    return output_headers, output_name_by_base


def process(input_path: Path, output_path: Path, weights: dict[str, float], objective: str) -> None:
    headers, rows = read_csv(input_path)
    appended = [
        "party_clean",
        "buyer_list_scoring_objective",
        "buyer_list_raw_score",
        "buyer_list_risk_penalty",
        "buyer_list_final_score",
        "buyer_list_suggested_tier",
        "buyer_list_suggested_wave",
        "buyer_list_recommended_action",
        "buyer_list_confidence_level",
        "buyer_list_source_quality",
        "buyer_list_rationale_quality",
        "buyer_list_risk_summary",
        "buyer_list_md_judgment_note",
        "buyer_list_score_basis",
        "buyer_list_qa_flags",
        "buyer_list_change_log",
    ]
    output_headers, output_name_by_base = append_unique_headers(headers, appended)

    output_rows: list[list[str]] = []
    seen: dict[str, int] = {}
    for original_values, row in rows:
        party = first_present(row, ["party", "buyer", "investor", "lender", "company", "name"])
        party_clean = clean_party_name(party)
        raw_score, risk_penalty, final_score, dimension_scores, score_inputs = compute_score(
            row, weights
        )
        tier, tier_reason = suggest_tier(row, final_score, dimension_scores)
        wave = suggest_wave(tier)
        confidence = source_confidence(row)
        quality = source_quality(row)
        rationale_status, rationale_checks = rationale_quality(row)
        risk = risk_summary(row)

        duplicate_note = ""
        key = party_clean.lower()
        if key:
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:
                duplicate_note = "possible duplicate party name; review entity resolution"

        appended_values = {
            "party_clean": party_clean,
            "buyer_list_scoring_objective": objective,
            "buyer_list_raw_score": f"{raw_score:.1f}",
            "buyer_list_risk_penalty": f"{risk_penalty:.1f}",
            "buyer_list_final_score": f"{final_score:.1f}",
            "buyer_list_suggested_tier": tier,
            "buyer_list_suggested_wave": wave,
            "buyer_list_recommended_action": recommended_action(tier, confidence),
            "buyer_list_confidence_level": confidence,
            "buyer_list_source_quality": quality,
            "buyer_list_rationale_quality": f"{rationale_status} ({', '.join(rationale_checks) if rationale_checks else 'no checks met'})",
            "buyer_list_risk_summary": risk,
            "buyer_list_md_judgment_note": build_md_note(
                tier_reason, risk, confidence, rationale_status
            ),
            "buyer_list_score_basis": "; ".join(score_inputs),
            "buyer_list_qa_flags": qa_flags(row, confidence, rationale_status, duplicate_note),
            "buyer_list_change_log": "original columns preserved; appended framework-aligned suggested scoring/tiering fields",
        }
        output_rows.append(
            original_values + [appended_values[base] for base in output_name_by_base]
        )

    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(output_headers)
        writer.writerows(output_rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score a buyer/investor/lender universe CSV without overwriting original columns."
    )
    parser.add_argument("input_csv", help="Path to input CSV")
    parser.add_argument("output_csv", help="Path to output CSV")
    parser.add_argument("--weights", help="Optional JSON file with custom weights", default=None)
    parser.add_argument(
        "--objective",
        default="default",
        help="Scoring objective: default, maximize_valuation, maximize_certainty, preserve_confidentiality, founder_friendly_recap, lender_process, distressed_restructuring",
    )
    args = parser.parse_args()

    input_path = Path(args.input_csv)
    output_path = Path(args.output_csv)
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")
    objective = normalize_objective(args.objective)
    weights = load_weights(args.weights, objective)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    process(input_path, output_path, weights, objective)
    with output_path.open(newline="", encoding="utf-8") as handle:
        scored_rows = list(csv.DictReader(handle))
        headers = list(scored_rows[0].keys()) if scored_rows else []
    workbook_path = output_path.with_name("buyer_investor_universe.xlsx")
    top_calls = [
        row
        for row in scored_rows
        if str(row.get("buyer_list_tier", "")).lower()
        in {"tier 1", "tier 1 / priority", "priority"}
        or str(row.get("buyer_list_outreach_wave", "")).lower().startswith("wave 1")
    ]
    exclusions = [
        row
        for row in scored_rows
        if "exclude" in str(row.get("buyer_list_tier", "")).lower()
        or "hold" in str(row.get("buyer_list_tier", "")).lower()
    ]
    write_cover_first_workbook(
        workbook_path,
        [
            ["Buyer / Investor Universe"],
            ["Objective", objective],
            ["Rows scored", len(scored_rows)],
            ["First read", "Use this workbook first. The scored CSV is support/import data."],
        ],
        {
            "Ranked_Universe": dict_rows_to_sheet(scored_rows, headers),
            "Top_Calls": dict_rows_to_sheet(top_calls, headers),
            "Holds_Exclusions": dict_rows_to_sheet(exclusions, headers),
            "Conflicts": dict_rows_to_sheet(
                [row for row in scored_rows if row.get("buyer_list_conflict_note")], headers
            ),
            "Outreach_Waves": dict_rows_to_sheet(scored_rows, headers),
            "Source_Confidence": dict_rows_to_sheet(scored_rows, headers),
            "Tracker_Handoff": [
                ["field", "value"],
                ["scored_csv", str(output_path)],
                ["objective", objective],
            ],
        },
    )
    write_artifact_manifest(
        output_path.parent,
        "buyer-investor-list",
        "workbook",
        workbook_path,
        support_artifacts=[
            artifact_item(
                output_path,
                "support_artifact",
                "csv",
                "Scored buyer universe CSV for import/filtering.",
                False,
                True,
                "CSV is support/import data; workbook is the banker-facing first read.",
            ),
        ],
        extra={
            "inputs": {
                "input_csv": str(input_path),
                "objective": objective,
                "weights_file": args.weights or "",
            }
        },
    )
    print(f"Wrote buyer/investor universe workbook to {workbook_path}")
    print(f"Wrote scored CSV support file to {output_path}")


if __name__ == "__main__":
    main()
