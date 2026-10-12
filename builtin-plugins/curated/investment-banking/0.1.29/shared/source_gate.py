from __future__ import annotations

from typing import Any, Mapping, Sequence

SENIOR_POSTURES = {
    "senior-review-ready",
    "client-ready",
    "committee-ready",
    "board-ready",
    "external",
    "lender-ready",
    "final-circulation-candidate",
}


def validate_source_gate(
    records: Sequence[Mapping[str, Any]], posture: str = "draft"
) -> dict[str, Any]:
    """Return warnings/errors for source posture without mutating caller data."""
    warnings: list[str] = []
    errors: list[str] = []
    senior = str(posture) in SENIOR_POSTURES
    if not records:
        message = "source register is missing"
        (errors if senior else warnings).append(message)
    for idx, record in enumerate(records):
        label = str(
            record.get("native_evidence_label")
            or record.get("evidence_label")
            or record.get("label")
            or ""
        ).lower()
        source_id = record.get("source_id") or record.get("id")
        as_of = record.get("as_of_date") or record.get("source_date") or record.get("document_date")
        if (
            label in {"verified_fact", "reported_financial", "model_output", "market_data"}
            and not source_id
        ):
            (errors if senior else warnings).append(
                f"records[{idx}] fact-like evidence lacks source_id"
            )
        if label in {"market_data", "reported_financial", "model_output"} and not as_of:
            (errors if senior else warnings).append(
                f"records[{idx}] material evidence lacks as-of/source date"
            )
        if label in {"management_assumption", "analyst_assumption", "seller_claim"}:
            warnings.append(f"records[{idx}] assumption/claim requires caveat before senior use")
    return {
        "status": "failed" if errors else "passed",
        "errors": errors,
        "warnings": warnings,
        "posture": posture,
    }
