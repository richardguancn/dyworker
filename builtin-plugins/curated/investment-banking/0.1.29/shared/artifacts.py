from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

MANIFEST_VERSION = "1.0"
ALLOWED_PRIMARY_SUPPORT_EXTENSIONS = {".csv", ".json", ".md", ".markdown", ".log", ".txt"}
SUPPORT_FOLDER_NAMES = {"support", "logs", "handoffs", "debug", "legacy"}
ALLOWED_WORKBOOK_FIRST_TABS = {"Cover", "Executive Summary", "Dashboard"}
VALID_ROUTING_CONFIDENCES = {"high", "medium", "low", "manual_override", "unknown"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _string_path(path: str | Path | None) -> str:
    return "" if path is None else str(path)


def _string_sequence(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        return [values]
    if isinstance(values, Sequence):
        return [str(value) for value in values]
    return [str(values)]


def _artifact_type_from_path(path: str | Path) -> str:
    suffix = Path(path).suffix.lower()
    return {
        ".xlsx": "xlsx",
        ".xlsm": "xlsm",
        ".html": "html",
        ".htm": "html",
        ".pptx": "native_deck",
        ".ppt": "native_deck",
        ".docx": "native_document",
        ".doc": "native_document",
        ".csv": "csv",
        ".json": "json",
        ".md": "markdown",
        ".markdown": "markdown",
        ".log": "log",
        ".txt": "log",
    }.get(suffix, "file")


def artifact_item(
    path: str | Path,
    role: str,
    artifact_type: str | None = None,
    description: str = "",
    user_visible_default: bool = False,
    contains_new_analysis: bool = False,
    support_reason: str = "",
    user_requested_machine_readable: bool = False,
) -> dict[str, Any]:
    return {
        "path": _string_path(path),
        "role": role,
        "artifact_type": artifact_type or _artifact_type_from_path(path),
        "description": description,
        "user_visible_default": bool(user_visible_default),
        "contains_new_analysis": bool(contains_new_analysis),
        "support_reason": support_reason,
        "user_requested_machine_readable": bool(user_requested_machine_readable),
    }


def routing_context(
    transaction_workflow: str,
    lead_skill: str,
    supporting_skills: Sequence[str] | None = None,
    routing_confidence: str = "medium",
    handoff_contracts_used: Sequence[str] | None = None,
    routing_reason: str = "",
) -> dict[str, Any]:
    confidence = (
        routing_confidence if routing_confidence in VALID_ROUTING_CONFIDENCES else "unknown"
    )
    return {
        "transaction_workflow": str(transaction_workflow),
        "lead_skill": str(lead_skill),
        "supporting_skills": _string_sequence(supporting_skills),
        "routing_confidence": confidence,
        "handoff_contracts_used": _string_sequence(handoff_contracts_used),
        "routing_reason": str(routing_reason),
    }


def support_dir(output_dir: str | Path) -> Path:
    path = Path(output_dir) / "support"
    path.mkdir(parents=True, exist_ok=True)
    return path


def logs_dir(output_dir: str | Path) -> Path:
    path = Path(output_dir) / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def handoffs_dir(output_dir: str | Path) -> Path:
    path = Path(output_dir) / "handoffs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def validate_handoff_payload(
    contract_name: str, payload_path: str | Path, strict: bool = False
) -> dict[str, Any]:
    plugin_root = Path(__file__).resolve().parents[1]
    schema_path = plugin_root / "schemas" / f"{contract_name}.schema.json"
    script_path = plugin_root / "scripts" / "validate_handoff_payload.py"
    args = [sys.executable, str(script_path), contract_name, str(payload_path)]
    if strict:
        args.append("--strict")
    result = subprocess.run(args, text=True, capture_output=True, check=False)
    return {
        "handoff_contract_name": contract_name,
        "path": str(payload_path),
        "schema_path": str(schema_path),
        "validator_status": "passed" if result.returncode == 0 else "failed",
        "validator_returncode": result.returncode,
        "validator_stdout": result.stdout,
        "validator_stderr": result.stderr,
        "validated_at": _now_iso(),
        "strict": bool(strict),
    }


def write_handoff_payload(
    output_dir: str | Path,
    contract_name: str,
    payload: Mapping[str, Any] | Sequence[Any],
    consumer_skill: str = "",
    filename: str | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    handoff_dir = handoffs_dir(output_dir)
    path = handoff_dir / (filename or f"{contract_name}.json")
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    validation = validate_handoff_payload(contract_name, path, strict=strict)
    validation["consumer_skill"] = consumer_skill
    if validation["validator_status"] != "passed":
        raise ValueError(
            f"handoff validation failed for {contract_name}: "
            f"{validation['validator_stdout']}{validation['validator_stderr']}"
        )
    return validation


def handoff_artifact_item(
    handoff_result: Mapping[str, Any],
    description: str = "Validated cross-skill handoff payload.",
) -> dict[str, Any]:
    item = artifact_item(
        handoff_result.get("path", ""),
        "support_artifact",
        "handoff_payload",
        description,
        False,
        True,
        "Handoff JSON is machine-readable support for another skill, not the primary banker-facing deliverable.",
    )
    item.update(
        {
            "handoff_contract_name": handoff_result.get("handoff_contract_name", ""),
            "schema_path": handoff_result.get("schema_path", ""),
            "validator_status": handoff_result.get("validator_status", ""),
            "validated_at": handoff_result.get("validated_at", ""),
            "consumer_skill": handoff_result.get("consumer_skill", ""),
        }
    )
    return item


def register_handoff_in_manifest(
    manifest: dict[str, Any], handoff_result: Mapping[str, Any]
) -> dict[str, Any]:
    manifest.setdefault("support_artifacts", []).append(handoff_artifact_item(handoff_result))
    manifest.setdefault("handoffs", []).append(
        {
            "handoff_contract_name": handoff_result.get("handoff_contract_name", ""),
            "path": handoff_result.get("path", ""),
            "schema_path": handoff_result.get("schema_path", ""),
            "validator_status": handoff_result.get("validator_status", ""),
            "validated_at": handoff_result.get("validated_at", ""),
            "consumer_skill": handoff_result.get("consumer_skill", ""),
        }
    )
    return manifest


def build_minimal_handoff_payload(
    contract_name: str, overrides: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    plugin_root = Path(__file__).resolve().parents[1]
    schema_path = plugin_root / "schemas" / f"{contract_name}.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    required = schema.get("$defs", {}).get("record", {}).get("required", [])
    payload: dict[str, Any] = {"contract_name": contract_name}
    for field in required:
        payload[str(field)] = _default_handoff_value(str(field))
    if contract_name.startswith("distressed_recovery_waterfall_to_"):
        payload.update(
            {
                "strict_legal_entitlement_economics": [
                    _generic_handoff_record("Strict legal entitlement economics")
                ],
                "negotiated_plan_economics": [_generic_handoff_record("Negotiated plan economics")],
                "collateral_liquidation_waterfall": [
                    _generic_handoff_record("Collateral/liquidation waterfall")
                ],
                "enterprise_value_waterfall": [
                    _generic_handoff_record("Enterprise value waterfall")
                ],
            }
        )
    if overrides:
        payload.update(dict(overrides))
    return payload


def _generic_handoff_record(label: str) -> dict[str, Any]:
    return {
        "label": label,
        "description": f"{label} requires banker review.",
        "status": "needs_review",
    }


def _default_handoff_value(field: str) -> Any:
    if field == "source_log":
        return [
            {
                "source_id": "SRC-001",
                "source_name": "Generated source package",
                "source_type": "generated_support",
                "source_date": "not_provided",
                "document_date": "not_provided",
                "accessed_date": "not_provided",
                "as_of_date": "not_provided",
                "source_pointer": "generated handoff",
                "freshness_status": "unknown",
                "conflict_status": "unknown",
                "confidence": "medium",
                "native_evidence_label": "generated_support",
                "canonical_evidence_category": "unknown",
                "treatment": "review before reliance",
                "limitations": "generated handoff scaffold",
            }
        ]
    if field == "evidence_register":
        return [
            {
                "source_id": "SRC-001",
                "source_type": "generated_support",
                "as_of_date": "not_provided",
                "native_evidence_label": "generated_support",
                "canonical_evidence_category": "unknown",
                "freshness_status": "unknown",
                "conflict_status": "unknown",
                "confidence": "medium",
                "treatment": "review before reliance",
                "open_items": ["confirm source evidence"],
            }
        ]
    if field == "key_numbers_to_tie":
        return [
            {
                "metric": "Generated metric",
                "period": "not_provided",
                "unit": "not_provided",
                "scale": "not_provided",
                "value": "not_provided",
                "value_basis": "generated support",
                "page_references": ["not_provided"],
                "slide_references": ["not_provided"],
                "source_id": "SRC-001",
                "related_model_output": "not_provided",
                "tie_out_status": "needs_review",
                "variance_explanation": "requires tie-out",
            }
        ]
    if field == "claim_register":
        return [
            {
                "claim_id": "C-0001",
                "buyer_facing_claim": "Generated claim requires review",
                "claim_type": "generated_support",
                "native_evidence_label": "generated_support",
                "canonical_evidence_category": "unknown",
                "source_id": "SRC-001",
                "caveat": "review before reliance",
                "confidence": "medium",
                "status": "needs_review",
            }
        ]
    if field == "chart_and_visual_register":
        return [
            {
                "location": "not_provided",
                "chart_or_visual": "not_provided",
                "metric_or_claim": "Generated metric",
                "source_id": "SRC-001",
                "unit": "not_provided",
                "period": "not_provided",
                "visual_review_status": "needs_review",
                "tie_out_status": "needs_review",
                "issue": "requires visual review",
                "suggested_remediation": "perform deck QC",
            }
        ]
    if field == "supporting_source_ids":
        return ["SRC-001"]
    if field == "open_items":
        return [
            {
                "item_id": "OI-0001",
                "description": "Review generated handoff",
                "why_it_matters": "prevents unsupported downstream use",
                "owner": "Associate",
                "status": "open",
                "due_date": "not_provided",
                "blocks_circulation": True,
                "suggested_remediation": "complete source review",
            }
        ]
    if field in {"financial_tie_outs", "waterfall_tie_outs", "valuation_case_tie_outs"}:
        return [
            {
                "metric": "Generated metric",
                "source_value": "not_provided",
                "model_value": "not_provided",
                "variance": "not_provided",
                "tie_out_status": "needs_review",
                "owner": "Associate",
            }
        ]
    if field == "circulation_caveats":
        return [
            {
                "caveat": "Generated handoff requires review before circulation",
                "impact": "not client-ready",
                "owner": "VP",
            }
        ]
    if (field.endswith("_flags") and field != "material_red_flags") or field == "qa_checks":
        return [
            {
                "flag_type": field,
                "description": "Review required",
                "owner": "Associate",
                "status": "needs_review",
                "blocks_circulation": True,
            }
        ]
    if field == "style_source_records":
        return [
            {
                "source_id": "SRC-001",
                "source_name": "Style source",
                "source_type": "deck",
                "source_priority": "primary",
                "source_scope": "style",
                "source_date_or_period": "not_provided",
                "freshness": "unknown",
                "relevance": "medium",
                "confidence": "medium",
                "limitations": "generated support",
            }
        ]
    if field == "changes_made":
        return [
            {
                "location": "not_provided",
                "area": "style",
                "change": "generated change",
                "basis": "style profile",
                "provenance_label": "style",
                "confidence": "medium",
                "content_impact": "none",
            }
        ]
    if field in {
        "source_as_of_dates",
        "page_plan",
        "top_claims",
        "material_red_flags",
        "underwriting_implications",
        "diligence_questions",
        "seller_data_requests",
        "open_evidence_gaps",
        "management_follow_ups",
        "risk_mitigants",
        "deck_metadata",
        "md_storyline",
        "slide_blueprint",
        "appendix",
        "qa_status",
        "style_profile_package",
        "style_change_log_package",
        "known_document_gaps",
        "target_covenants_or_baskets",
        "covenant_capacity_questions",
        "restricted_payments_questions",
        "investment_basket_questions",
        "debt_lien_capacity_questions",
        "ebitda_definition_questions",
        "amendment_waiver_or_consent_questions",
        "covenant_questions",
        "ratio_definitions_needed",
        "financial_covenant_tests",
        "thresholds_requested",
        "headroom_or_proxy_headroom",
        "collateral_guarantee_concerns",
        "basket_leakage_concerns",
        "reporting_monitoring_needs",
        "amendment_waiver_or_control_needs",
        "recommended_lender_protections",
        "conditions_precedent",
        "claim_amounts_by_tranche",
        "maturity_wall",
        "lender_case",
        "downside_case",
        "severe_downside_case",
        "collateral_value_summary",
        "lien_priority_summary",
        "guarantor_summary",
        "expected_recovery_range",
        "restructuring_alternatives_to_test",
        "capital_structure_summary",
        "legal_entity_guarantor_collateral_map",
        "valuation_cases",
        "distributable_value_bridge",
        "recovery_waterfall_summary",
        "recovery_ranges_by_class",
        "fulcrum_sensitivity",
        "stakeholder_leverage_map",
        "restructuring_alternatives",
        "diligence_gaps",
        "page_plan_guidance",
        "pro_forma_capitalization",
        "pro_forma_leverage",
        "pro_forma_coverage",
        "indicative_pricing_terms",
        "fees_oid_call_protection",
        "market_clearing_assumptions",
        "investor_lender_targeting_summary",
        "expected_lender_objections",
        "execution_risks",
        "fallback_alternatives",
        "covenant_or_rating_caveats",
        "existing_capital_structure",
        "debt_document_universe",
        "debt_stack_summary",
        "covenant_breach_details",
        "sponsor_support_evidence",
        "review_scope",
        "scenario_outputs",
        "assumption_register",
        "preserved_elements",
        "substantive_edits",
        "non_client_ready_reasons",
        "style_sources_used",
        "style_provenance_labels",
        "style_assumptions",
        "style_conflicts",
        "open_style_questions",
    }:
        return [_generic_handoff_record(field)]
    if field == "claim_id":
        return "C-0001"
    if field == "evidence_id":
        return "E-0001"
    if field == "red_flag_id":
        return "RF-0001"
    if field == "question_id":
        return "Q-0001"
    if field == "task_id":
        return "T-0001"
    if field == "source_id":
        return "SRC-001"
    if field == "canonical_evidence_category":
        return "unknown"
    if field == "source_quality":
        return "unknown"
    if field == "freshness_status":
        return "unknown"
    if field == "conflict_status":
        return "unknown"
    if field == "confidence":
        return "medium"
    if field == "circulation_posture":
        return "working_draft"
    if field == "visual_review_status":
        return "needs_review"
    if field == "downstream_qc_required":
        return True
    if field == "package_type":
        return "pre_meeting_plan"
    return f"{field} generated handoff value"


def is_support_artifact(path: str | Path) -> bool:
    candidate = Path(path)
    suffix = candidate.suffix.lower()
    parts = {part.lower() for part in candidate.parts}
    return suffix in ALLOWED_PRIMARY_SUPPORT_EXTENSIONS or bool(parts & SUPPORT_FOLDER_NAMES)


def _primary_path(manifest: Mapping[str, Any]) -> str:
    primary = manifest.get("primary_human_deliverable")
    if isinstance(primary, Mapping):
        return str(primary.get("path", ""))
    return str(primary or "")


def _first_read_from_primary(primary: str | Path | None) -> dict[str, str]:
    path = _string_path(primary)
    return {
        "path": path,
        "role": "primary human deliverable",
        "why": "Open this first because it is the banker-facing artifact.",
    }


def write_artifact_manifest(
    output_dir: str | Path,
    skill: str,
    artifact_mode: str,
    primary_human_deliverable: str | Path | None = None,
    human_deliverables: Sequence[Mapping[str, Any]] | None = None,
    companion_deliverables: Sequence[Mapping[str, Any]] | None = None,
    support_artifacts: Sequence[Mapping[str, Any]] | None = None,
    agent_artifacts: Sequence[Mapping[str, Any]] | None = None,
    first_read: Mapping[str, Any] | None = None,
    blocked_or_partial_status: Mapping[str, Any] | None = None,
    user_requested_machine_readable: bool = False,
    final_response_guidance: Mapping[str, str] | None = None,
    manifest_name: str = "manifest.json",
    extra: Mapping[str, Any] | None = None,
    routing: Mapping[str, Any] | None = None,
    validate: bool = True,
) -> dict[str, Any]:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    primary = _string_path(primary_human_deliverable)
    human_items = list(human_deliverables or [])
    if primary and not human_items:
        human_items.append(
            artifact_item(
                primary,
                "human_deliverable",
                description="Primary banker-facing deliverable.",
                user_visible_default=True,
                contains_new_analysis=True,
                user_requested_machine_readable=user_requested_machine_readable,
            )
        )
    manifest_path = out / manifest_name
    agent_items = list(agent_artifacts or [])
    if not any(
        str(item.get("path", "")).endswith(manifest_name)
        for item in agent_items
        if isinstance(item, Mapping)
    ):
        agent_items.append(
            artifact_item(
                manifest_path,
                "agent_artifact",
                "json",
                "Artifact manifest used by agents to preserve deliverable hierarchy.",
                False,
                False,
                "Manifest is an audit/routing file, not the primary banker deliverable.",
            )
        )
    manifest: dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "skill": skill,
        "artifact_mode": artifact_mode,
        "output_dir": str(out),
        "first_read": dict(first_read or _first_read_from_primary(primary)),
        "primary_human_deliverable": primary,
        "human_deliverables": human_items,
        "companion_deliverables": list(companion_deliverables or []),
        "support_artifacts": list(support_artifacts or []),
        "agent_artifacts": agent_items,
        "support_artifacts_user_visible_default": False,
        "blocked_or_partial_status": dict(
            blocked_or_partial_status
            or {
                "status": "complete"
                if primary
                else ("blocked" if artifact_mode == "blocked" else "support_only"),
                "reason": "",
                "missing_inputs": [],
            }
        ),
        "final_response_guidance": dict(
            final_response_guidance
            or {
                "lead_with": "primary_human_deliverable",
                "mention_support_artifacts": "only_briefly_unless_requested",
            }
        ),
        "discipline_note": "Use the human deliverable as the main output; support artifacts are for audit/import/debug only.",
        "created_at": _now_iso(),
    }
    if routing:
        manifest.update(
            routing_context(
                str(routing.get("transaction_workflow", "")),
                str(routing.get("lead_skill", "")),
                routing.get("supporting_skills", []),
                str(routing.get("routing_confidence", "unknown")),
                routing.get("handoff_contracts_used", []),
                str(routing.get("routing_reason", "")),
            )
        )
    if extra:
        manifest.update(dict(extra))
    if validate:
        validate_artifact_manifest(manifest)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def validate_artifact_manifest(manifest: Mapping[str, Any]) -> None:
    errors: list[str] = []
    mode = str(manifest.get("artifact_mode", ""))
    primary = _primary_path(manifest)
    status = manifest.get("blocked_or_partial_status", {})
    status_value = status.get("status") if isinstance(status, Mapping) else ""
    primary_exempt = mode in {"blocked", "chat_only", "support_only"} or status_value in {
        "blocked",
        "support_only",
    }

    for field in [
        "manifest_version",
        "skill",
        "artifact_mode",
        "output_dir",
        "first_read",
        "human_deliverables",
        "companion_deliverables",
        "support_artifacts",
        "agent_artifacts",
        "blocked_or_partial_status",
        "discipline_note",
    ]:
        if field not in manifest:
            errors.append(f"missing required field: {field}")

    if manifest.get("manifest_version") != MANIFEST_VERSION:
        errors.append("manifest_version must be 1.0")

    if not primary and not primary_exempt:
        errors.append(
            "primary_human_deliverable is required unless artifact_mode is blocked, chat_only, or support_only"
        )

    if primary:
        primary_suffix = Path(primary).suffix.lower()
        user_requested = bool(manifest.get("user_requested_machine_readable"))
        if primary_suffix in ALLOWED_PRIMARY_SUPPORT_EXTENSIONS and not user_requested:
            errors.append(
                "support-format files cannot be primary unless user_requested_machine_readable is true"
            )
        if mode == "workbook" and primary_suffix not in {".xlsx", ".xlsm"}:
            errors.append("workbook artifact_mode requires an .xlsx or .xlsm primary deliverable")
        if mode in {"html_report", "html_dashboard"} and primary_suffix not in {".html", ".htm"}:
            errors.append("HTML artifact_mode requires an .html primary deliverable")
        if mode == "generated_package":
            first_read = manifest.get("first_read")
            if not isinstance(first_read, Mapping) or not first_read.get("path"):
                errors.append("generated_package manifests must name first_read.path")

    for item in manifest.get("support_artifacts", []) or []:
        if not isinstance(item, Mapping):
            errors.append("support_artifacts entries must be objects")
            continue
        if not item.get("support_reason"):
            errors.append(f"support artifact lacks support_reason: {item.get('path', '<unknown>')}")
        if item.get("user_visible_default") is True:
            errors.append(
                f"support artifact cannot be user_visible_default=true: {item.get('path', '<unknown>')}"
            )

    if errors:
        raise ValueError("; ".join(errors))


def assert_no_support_artifact_as_primary(manifest: Mapping[str, Any]) -> None:
    primary = _primary_path(manifest)
    if (
        primary
        and is_support_artifact(primary)
        and not manifest.get("user_requested_machine_readable")
    ):
        raise AssertionError(f"support artifact cannot be primary by default: {primary}")


def assert_first_visible_sheet(path: str | Path, allowed: set[str] | None = None) -> str:
    allowed = allowed or ALLOWED_WORKBOOK_FIRST_TABS
    with zipfile.ZipFile(path) as archive:
        workbook_xml = archive.read("xl/workbook.xml")
    root = ET.fromstring(workbook_xml)
    ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    sheets = root.find("main:sheets", ns)
    if sheets is None:
        raise AssertionError(f"workbook has no sheets collection: {path}")
    visible = [
        sheet.attrib["name"]
        for sheet in sheets.findall("main:sheet", ns)
        if sheet.attrib.get("state", "visible") == "visible"
    ]
    if not visible:
        raise AssertionError(f"workbook has no visible sheets: {path}")
    first = visible[0]
    if first not in allowed:
        raise AssertionError(f"first visible sheet must be one of {sorted(allowed)}; got {first}")
    return first


def _column_name(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[\[\]:*?/\\]", "_", str(name)).strip() or "Sheet"
    cleaned = cleaned[:31]
    base = cleaned
    suffix = 1
    while cleaned in used:
        tail = f"_{suffix}"
        cleaned = f"{base[: 31 - len(tail)]}{tail}"
        suffix += 1
    used.add(cleaned)
    return cleaned


def _sheet_xml(rows: Sequence[Sequence[Any]]) -> str:
    output = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
    output.append(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    )
    for r_idx, row in enumerate(rows, start=1):
        output.append(f'<row r="{r_idx}">')
        for c_idx, value in enumerate(row):
            if value is None:
                continue
            ref = f"{_column_name(c_idx)}{r_idx}"
            if isinstance(value, bool):
                output.append(f'<c r="{ref}" t="b"><v>{1 if value else 0}</v></c>')
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                output.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                output.append(
                    f'<c r="{ref}" t="inlineStr"><is><t>{html.escape(str(value))}</t></is></c>'
                )
        output.append("</row>")
    output.append("</sheetData></worksheet>")
    return "".join(output)


def write_simple_xlsx_from_tables(
    path: str | Path, sheets: Mapping[str, Sequence[Sequence[Any]]]
) -> Path:
    workbook = Path(path)
    workbook.parent.mkdir(parents=True, exist_ok=True)
    used: set[str] = set()
    normalized = [(_sheet_name(name, used), list(rows)) for name, rows in sheets.items()]
    if not normalized:
        normalized = [("Cover", [["Generated workbook", "No tabular data was supplied."]])]
    first_name = normalized[0][0]
    if first_name not in ALLOWED_WORKBOOK_FIRST_TABS:
        raise ValueError("first sheet must be Cover, Executive Summary, or Dashboard")

    content_types = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
    content_types.append(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    )
    content_types.append(
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    )
    content_types.append('<Default Extension="xml" ContentType="application/xml"/>')
    content_types.append(
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    )
    content_types.append(
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    )
    for idx in range(1, len(normalized) + 1):
        content_types.append(
            f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    content_types.append("</Types>")

    workbook_xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
    workbook_xml.append(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    )
    for idx, (name, _rows) in enumerate(normalized, start=1):
        workbook_xml.append(f'<sheet name="{html.escape(name)}" sheetId="{idx}" r:id="rId{idx}"/>')
    workbook_xml.append("</sheets></workbook>")

    workbook_rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
    workbook_rels.append(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    )
    for idx in range(1, len(normalized) + 1):
        workbook_rels.append(
            f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        )
    workbook_rels.append(
        f'<Relationship Id="rId{len(normalized) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    workbook_rels.append("</Relationships>")

    with zipfile.ZipFile(workbook, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "".join(content_types))
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        )
        archive.writestr("xl/workbook.xml", "".join(workbook_xml))
        archive.writestr("xl/_rels/workbook.xml.rels", "".join(workbook_rels))
        archive.writestr(
            "xl/styles.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>',
        )
        for idx, (_name, rows) in enumerate(normalized, start=1):
            archive.writestr(f"xl/worksheets/sheet{idx}.xml", _sheet_xml(rows))
    return workbook


def write_cover_first_workbook(
    path: str | Path,
    cover_rows: Sequence[Sequence[Any]],
    tables: Mapping[str, Sequence[Sequence[Any]]] | None = None,
) -> Path:
    sheets: dict[str, Sequence[Sequence[Any]]] = {"Cover": cover_rows}
    sheets.update(dict(tables or {}))
    return write_simple_xlsx_from_tables(path, sheets)


def dict_rows_to_sheet(
    rows: Sequence[Mapping[str, Any]], headers: Sequence[str] | None = None
) -> list[list[Any]]:
    if headers is None:
        seen: list[str] = []
        for row in rows:
            for key in row.keys():
                if key not in seen:
                    seen.append(str(key))
        headers = seen
    header_list = [str(header) for header in headers]
    return [header_list, *[[row.get(header, "") for header in header_list] for row in rows]]


def write_dashboard_contract(
    path: str | Path,
    skill: str,
    title: str,
    entity: str,
    render_mode: str,
    primary_artifact: str | Path,
    sections: Sequence[Mapping[str, Any]] | None = None,
    report_body: Sequence[Mapping[str, Any]] | None = None,
    supporting_outputs: Sequence[Mapping[str, Any]] | None = None,
    sources: Sequence[Mapping[str, Any]] | None = None,
    assumptions: Sequence[Mapping[str, Any]] | None = None,
    blocked_output_context: Mapping[str, Any] | None = None,
    readiness_posture: str = "draft",
    citation_policy: str = "block_for_senior",
    accept_draft_citation_gaps: bool = False,
    citation_gap_acceptance_reason: str = "",
    executive_summary: str | Sequence[Any] | Mapping[str, Any] | None = None,
    hero_actions: Sequence[Mapping[str, Any]] | None = None,
    utility_controls: Mapping[str, Any] | None = None,
    table_export_default: bool = True,
    extra: Mapping[str, Any] | None = None,
) -> Path:
    contract = {
        "dashboard_title": title,
        "entity": entity,
        "skill": skill,
        "render_mode": render_mode,
        "posture": readiness_posture,
        "citation_policy": citation_policy,
        "metadata": {
            "readiness_posture": readiness_posture,
            "citation_policy": citation_policy,
            "accept_draft_citation_gaps": bool(accept_draft_citation_gaps),
            "citation_gap_acceptance_reason": citation_gap_acceptance_reason,
        },
        "deliverable": {
            "render_mode": render_mode,
            "primary_artifact": _string_path(primary_artifact),
            "primary_artifact_type": _artifact_type_from_path(primary_artifact),
            "readiness_posture": readiness_posture,
            "citation_policy": citation_policy,
            "accept_draft_citation_gaps": bool(accept_draft_citation_gaps),
            "citation_gap_acceptance_reason": citation_gap_acceptance_reason,
            "executive_summary": executive_summary or [],
            "hero_actions": list(hero_actions or []),
            "utility_controls": dict(
                utility_controls
                or {
                    "copy_full_report": True,
                    "print_pdf": True,
                    "open_primary_artifact": True,
                }
            ),
            "table_export_default": bool(table_export_default),
            "hero_callout": "Open the primary artifact first; support files are audit/import material.",
        },
        "hero": {
            "eyebrow": skill,
            "headline": title,
            "dek": "Reader-facing Investment Banking output generated with support artifacts kept in the background.",
            "callout_label": "First read",
            "callout": _string_path(primary_artifact),
        },
        "sections": list(sections or []),
        "report_body": list(report_body or []),
        "supporting_outputs": list(supporting_outputs or []),
        "sources": list(sources or []),
        "assumptions": list(assumptions or []),
        "blocked_output_context": dict(
            blocked_output_context or {"blocked": False, "reason": "", "missing_inputs": []}
        ),
    }
    if extra:
        contract.update(dict(extra))
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(contract, indent=2) + "\n", encoding="utf-8")
    return target


def add_supporting_outputs_to_contract(
    contract: dict[str, Any], artifacts: Iterable[Mapping[str, Any]]
) -> dict[str, Any]:
    outputs = contract.setdefault("supporting_outputs", [])
    for item in artifacts:
        outputs.append(
            {
                "path": item.get("path"),
                "label": item.get("description") or item.get("path"),
                "role": item.get("role"),
                "support_reason": item.get("support_reason", ""),
            }
        )
    return contract


def render_html_report(
    contract_path: str | Path,
    outdir: str | Path,
    output_name: str | None = None,
    accept_draft_citation_gaps: bool = False,
    citation_gap_acceptance_reason: str = "",
) -> Path:
    return _render_dashboard_builder(
        contract_path,
        outdir,
        output_name,
        accept_draft_citation_gaps,
        citation_gap_acceptance_reason,
    )


def render_html_dashboard(
    contract_path: str | Path,
    outdir: str | Path,
    output_name: str | None = None,
    accept_draft_citation_gaps: bool = False,
    citation_gap_acceptance_reason: str = "",
) -> Path:
    return _render_dashboard_builder(
        contract_path,
        outdir,
        output_name,
        accept_draft_citation_gaps,
        citation_gap_acceptance_reason,
    )


def _render_dashboard_builder(
    contract_path: str | Path,
    outdir: str | Path,
    output_name: str | None = None,
    accept_draft_citation_gaps: bool = False,
    citation_gap_acceptance_reason: str = "",
) -> Path:
    contract = Path(contract_path)
    plugin_root = Path(__file__).resolve().parents[1]
    renderer = (
        plugin_root
        / "skills"
        / "investment-banking"
        / "internal-support"
        / "dashboard-builder"
        / "scripts"
        / "render_dashboard.py"
    )
    args = [
        sys.executable,
        str(renderer),
        "--contract",
        str(contract),
        "--outdir",
        str(outdir),
        "--json-run-log",
    ]
    if accept_draft_citation_gaps:
        args.append("--accept-draft-citation-gaps")
    if citation_gap_acceptance_reason:
        args.extend(["--citation-gap-acceptance-reason", citation_gap_acceptance_reason])
    result = subprocess.run(args, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)
    log = json.loads(result.stdout or "{}")
    rendered = Path(outdir) / str(log.get("output_file") or "dashboard.html")
    if output_name and rendered.name != output_name and rendered.exists():
        target = Path(outdir) / output_name
        if target.exists():
            target.unlink()
        rendered.replace(target)
        return target
    return rendered
