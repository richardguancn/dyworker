#!/usr/bin/env python3
"""Map native company-tearsheet JSON into the memo-builder handoff contract.

The mapper preserves source-backed profile context and caveats. It does not turn
a tearsheet into a recommendation; missing required memo fields are represented
as explicit open items instead of invented facts.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CONTRACT_NAME = "company_tearsheet_to_memo_builder"

REQUIRED_MEMO_FIELDS = [
    "entity_profile",
    "one_line_business_description",
    "business_model",
    "sector",
    "ownership_status",
    "key_metrics",
    "recent_developments",
    "source_as_of_dates",
    "fact_vs_assumption_labels",
    "risks_and_gaps",
    "open_questions",
    "recommended_next_step",
    "circulation_caveats",
]

SOFT_EMPTY = {"", "unknown", "not_provided", "not provided", "n/a", "na", "none"}


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid json in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("top-level tearsheet json must be an object")
    return data


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split())
    return str(value).strip()


def soft_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip().lower() in SOFT_EMPTY:
        return True
    if isinstance(value, list) and not value:
        return True
    if isinstance(value, dict) and not value:
        return True
    return False


def listify(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str) and not value.strip():
        return []
    return [value]


def get_sections(data: dict[str, Any]) -> dict[str, Any]:
    sections = data.get("sections")
    return sections if isinstance(sections, dict) else {}


def first_present(data: dict[str, Any], sections: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in data and not soft_empty(data.get(key)):
            return data[key]
        if key in sections and not soft_empty(sections.get(key)):
            return sections[key]
    return ""


def source_id_from_ref(value: Any) -> str:
    text = clean(value)
    if not text:
        return ""
    return text.split()[0]


def normalize_source(source: Any) -> dict[str, Any]:
    if not isinstance(source, dict):
        return {
            "source_id": "",
            "source_name": clean(source),
            "source_type": "",
            "as_of_date": "",
            "freshness_status": "",
            "source_location": "",
        }
    return {
        "source_id": clean(source.get("source_id")),
        "source_name": clean(
            source.get("source_name") or source.get("name") or source.get("title")
        ),
        "source_type": clean(source.get("source_type") or source.get("type")),
        "as_of_date": clean(
            source.get("as_of_date") or source.get("date") or source.get("source_date")
        ),
        "freshness_status": clean(source.get("freshness_status") or source.get("freshness")),
        "source_location": clean(
            source.get("source_location")
            or source.get("location")
            or source.get("url")
            or source.get("file")
        ),
    }


def source_lookup(sources: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        clean(source.get("source_id")): source
        for source in sources
        if clean(source.get("source_id"))
    }


def canonical_evidence(
    native_label: str, source_id: str, sources_by_id: dict[str, dict[str, Any]]
) -> str:
    label = clean(native_label)
    if label == "fact_source_reported":
        source = sources_by_id.get(source_id, {})
        source_type = clean(source.get("source_type")).lower()
        if source_type in {
            "user_provided",
            "user_file",
            "connected_app",
            "primary",
            "filing",
            "management_presentation",
        }:
            return "verified_fact"
        return "reported_fact"
    if label == "fact_provider_standardized":
        return "reported_fact"
    if label == "derived_calculation":
        return "estimate"
    if label == "management_claim":
        return "management_statement"
    if label == "estimate_consensus":
        return "estimate"
    if label == "analyst_interpretation":
        return "inference"
    if label == "assumption_user_provided":
        return "assumption"
    if label == "assumption_inferred":
        return "inference"
    if label == "missing_required_source":
        return "unknown"
    return "unknown"


def detail_from_snapshot(
    data: dict[str, Any], sections: dict[str, Any], field_names: list[str]
) -> str:
    snapshots = listify(sections.get("business_snapshot")) + listify(data.get("business_snapshot"))
    wanted = {name.lower() for name in field_names}
    for item in snapshots:
        if isinstance(item, dict):
            label = clean(item.get("field") or item.get("label") or item.get("name")).lower()
            if label in wanted:
                return clean(item.get("detail") or item.get("value") or item.get("text"))
        elif isinstance(item, str):
            lower = item.lower()
            for name in wanted:
                if lower.startswith(name + ":"):
                    return clean(item.split(":", 1)[1])
    return ""


def fallback_field(entity: str, field_label: str) -> str:
    target = entity or "the entity"
    return f"{field_label} not provided in native tearsheet for {target}; memo-builder should keep as an open item."


def map_metrics(
    metrics: Any, sources_by_id: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    mapped: list[dict[str, Any]] = []
    labels: list[str] = []
    for index, metric in enumerate(listify(metrics), start=1):
        if not isinstance(metric, dict):
            mapped.append(
                {
                    "metric": f"Metric {index}",
                    "value": clean(metric),
                    "period": "",
                    "units": "",
                    "source_id": "",
                    "native_evidence_label": "unknown",
                    "canonical_evidence_category": "unknown",
                    "confidence": "low",
                }
            )
            labels.append(
                f"Metric {index} has unknown evidence and should be validated before memo use."
            )
            continue

        source_id = source_id_from_ref(metric.get("source") or metric.get("source_id"))
        native_label = clean(
            metric.get("evidence")
            or metric.get("evidence_label")
            or metric.get("native_evidence_label")
        )
        canonical = canonical_evidence(native_label, source_id, sources_by_id)
        mapped_metric = {
            "metric": clean(metric.get("metric") or metric.get("name") or metric.get("label")),
            "period": clean(metric.get("period") or metric.get("period_label")),
            "value": metric.get("value"),
            "units": clean(metric.get("units") or metric.get("unit")),
            "source_id": source_id,
            "source": clean(metric.get("source") or metric.get("source_id")),
            "native_evidence_label": native_label or "unknown",
            "canonical_evidence_category": canonical,
            "confidence": clean(metric.get("confidence")) or "low",
            "source_location": clean(metric.get("source_location") or metric.get("location")),
            "notes": clean(metric.get("notes") or metric.get("note")),
        }
        mapped.append(mapped_metric)
        metric_name = mapped_metric["metric"] or f"Metric {index}"
        source_note = f" from {source_id}" if source_id else " with no source_id"
        labels.append(
            f"{metric_name} is {mapped_metric['native_evidence_label']} / {canonical}{source_note}."
        )
    return mapped, labels


def map_developments(value: Any) -> list[Any]:
    developments: list[Any] = []
    for item in listify(value):
        if isinstance(item, dict):
            developments.append(
                {
                    "development": clean(
                        item.get("development") or item.get("text") or item.get("summary") or item
                    ),
                    "source": clean(item.get("source") or item.get("source_id")),
                    "evidence": clean(item.get("evidence") or item.get("evidence_label")),
                    "confidence": clean(item.get("confidence")),
                }
            )
        else:
            developments.append(clean(item))
    return [item for item in developments if not soft_empty(item)]


def map_source_as_of_dates(
    sources: list[dict[str, Any]], tearsheet_as_of_date: str
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for source in sources:
        rows.append(
            {
                "source_id": clean(source.get("source_id")),
                "source_name": clean(source.get("source_name")),
                "as_of_date": clean(source.get("as_of_date")) or "unknown",
                "freshness_status": clean(source.get("freshness_status")) or "unknown",
            }
        )
    if tearsheet_as_of_date and not rows:
        rows.append(
            {
                "source_id": "tearsheet",
                "source_name": "native tearsheet as-of date",
                "as_of_date": tearsheet_as_of_date,
                "freshness_status": "unknown",
            }
        )
    return rows


def collect_risks_and_gaps(
    data: dict[str, Any], sections: dict[str, Any], sources: list[dict[str, Any]]
) -> list[Any]:
    risks: list[Any] = []
    risks.extend(
        listify(first_present(data, sections, ["risks_and_gaps", "risks_gaps_flags", "risk_flags"]))
    )
    risks.extend(listify(data.get("data_quality_flags")))
    source_caveat = clean(data.get("source_caveat"))
    if source_caveat:
        risks.append(f"Source caveat: {source_caveat}.")
    for source in sources:
        if clean(source.get("freshness_status")).lower() in {"stale", "preliminary", "unknown"}:
            risks.append(
                {
                    "issue": "source freshness requires review",
                    "source_id": clean(source.get("source_id")),
                    "freshness_status": clean(source.get("freshness_status")) or "unknown",
                }
            )
    return [risk for risk in risks if not soft_empty(risk)]


def collect_open_questions(
    data: dict[str, Any],
    sections: dict[str, Any],
    missing_fields: list[str],
) -> list[Any]:
    questions: list[Any] = []
    questions.extend(
        listify(
            first_present(data, sections, ["open_questions", "questions", "diligence_questions"])
        )
    )
    for field in missing_fields:
        questions.append(f"Confirm {field} before relying on the memo profile.")
    return [question for question in questions if not soft_empty(question)]


def collect_caveats(data: dict[str, Any], sections: dict[str, Any], risks: list[Any]) -> list[Any]:
    caveats: list[Any] = []
    caveats.extend(listify(first_present(data, sections, ["circulation_caveats", "caveats"])))
    caveats.append(
        "Company-tearsheet handoff is source-backed context only; it is not an investment recommendation, diligence conclusion, model output, or final-circulation memo."
    )
    if risks:
        caveats.append(
            "Memo-builder must carry forward risks, gaps, and source limitations from this package."
        )
    return [caveat for caveat in caveats if not soft_empty(caveat)]


def build_entity_profile(
    data: dict[str, Any],
    sources: list[dict[str, Any]],
    business_model: str,
    sector: str,
    ownership_status: str,
) -> dict[str, Any]:
    return {
        "entity": clean(data.get("entity")),
        "profile_type": clean(data.get("profile_type")),
        "as_of_date": clean(data.get("as_of_date")),
        "scope": clean(data.get("scope")),
        "source_caveat": clean(data.get("source_caveat")),
        "business_model": business_model,
        "sector": sector,
        "ownership_status": ownership_status,
        "source_count": len(sources),
    }


def validate_output(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if payload.get("contract_name") != CONTRACT_NAME:
        errors.append("contract_name mismatch")
    package = payload.get("memo_package")
    if not isinstance(package, dict):
        errors.append("memo_package must be an object")
        return errors, warnings
    for field in REQUIRED_MEMO_FIELDS:
        if field not in package:
            errors.append(f"memo_package missing field: {field}")
        elif soft_empty(package[field]):
            warnings.append(f"memo_package has empty/placeholder field: {field}")
    return errors, warnings


def map_tearsheet_to_memo_handoff(data: dict[str, Any]) -> dict[str, Any]:
    sections = get_sections(data)
    entity = clean(data.get("entity"))
    tearsheet_as_of_date = clean(data.get("as_of_date"))
    sources = [normalize_source(source) for source in listify(data.get("sources"))]
    sources_by_id = source_lookup(sources)
    key_metrics, metric_labels = map_metrics(data.get("metrics"), sources_by_id)

    missing_fields: list[str] = []
    business_model = clean(
        first_present(data, sections, ["business_model", "revenue_model", "model"])
    )
    if not business_model:
        business_model = detail_from_snapshot(
            data, sections, ["business model", "revenue model", "model"]
        )
    if not business_model:
        missing_fields.append("business_model")
        business_model = fallback_field(entity, "Business model")

    sector = clean(first_present(data, sections, ["sector", "industry", "subsector"]))
    if not sector:
        sector = detail_from_snapshot(data, sections, ["sector", "industry", "subsector"])
    if not sector:
        missing_fields.append("sector")
        sector = fallback_field(entity, "Sector")

    ownership_status = clean(
        first_present(data, sections, ["ownership_status", "ownership", "sponsor_owner"])
    )
    if not ownership_status:
        ownership_status = detail_from_snapshot(
            data, sections, ["ownership", "ownership status", "sponsor owner"]
        )
    if not ownership_status:
        missing_fields.append("ownership_status")
        ownership_status = fallback_field(entity, "Ownership status")

    one_line = clean(
        first_present(
            data,
            sections,
            ["one_line_business_description", "one_line_view", "business_description"],
        )
    )
    if not one_line:
        one_line = f"Source-backed profile context for {entity or 'the entity'}; one-line business description was not provided in the native tearsheet."

    recent_developments = map_developments(
        first_present(data, sections, ["recent_developments", "developments"])
    )
    if not recent_developments:
        recent_developments = [
            "No recent developments were provided in the native tearsheet; memo-builder should avoid implying a current catalyst."
        ]

    risks_and_gaps = collect_risks_and_gaps(data, sections, sources)
    if not risks_and_gaps:
        risks_and_gaps = [
            "No explicit risks or gaps were provided in the native tearsheet; memo-builder should still run memo QA before circulation."
        ]

    open_questions = collect_open_questions(data, sections, missing_fields)
    if not open_questions:
        open_questions = [
            "Confirm whether additional memo-specific diligence questions are needed before circulation."
        ]

    source_as_of_dates = map_source_as_of_dates(sources, tearsheet_as_of_date)
    fact_vs_assumption_labels = metric_labels
    if not fact_vs_assumption_labels:
        fact_vs_assumption_labels = [
            "No metrics were provided; memo-builder should treat profile facts as context only and request metric support if needed."
        ]

    package = {
        "entity_profile": build_entity_profile(
            data, sources, business_model, sector, ownership_status
        ),
        "one_line_business_description": one_line,
        "business_model": business_model,
        "sector": sector,
        "ownership_status": ownership_status,
        "key_metrics": key_metrics,
        "recent_developments": recent_developments,
        "source_as_of_dates": source_as_of_dates,
        "fact_vs_assumption_labels": fact_vs_assumption_labels,
        "risks_and_gaps": risks_and_gaps,
        "open_questions": open_questions,
        "recommended_next_step": clean(first_present(data, sections, ["recommended_next_step"]))
        or "Use as the source-backed company profile spine in memo-builder; add transaction judgment, decision framing, and memo QA separately.",
        "circulation_caveats": collect_caveats(data, sections, risks_and_gaps),
        "source_log": sources,
        "tearsheet_profile_type": clean(data.get("profile_type")),
        "tearsheet_as_of_date": tearsheet_as_of_date,
        "data_quality_flags": listify(data.get("data_quality_flags")),
        "mapper_warnings": [
            f"Native tearsheet did not provide {field}." for field in missing_fields
        ],
    }

    return {
        "contract_name": CONTRACT_NAME,
        "memo_package": package,
        "open_items": open_questions,
        "mapper_metadata": {
            "mapper": "company-tearsheet/scripts/map_tearsheet_to_memo_handoff.py",
            "mapped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source_contract": "company-tearsheet structured JSON",
            "target_contract": CONTRACT_NAME,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Map company-tearsheet JSON into memo-builder handoff JSON"
    )
    parser.add_argument("input_json", type=Path, help="Native company-tearsheet JSON")
    parser.add_argument("output_json", type=Path, help="Output memo-builder handoff JSON")
    parser.add_argument("--strict", action="store_true", help="Treat mapper warnings as failures")
    args = parser.parse_args()

    data = load_json(args.input_json)
    payload = map_tearsheet_to_memo_handoff(data)
    errors, warnings = validate_output(payload)

    for message in errors:
        print(f"ERROR: {message}")
    for message in warnings:
        print(f"WARNING: {message}")

    if errors or (args.strict and warnings):
        return 1

    write_json(args.output_json, payload)
    print(f"wrote memo-builder handoff to {args.output_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
