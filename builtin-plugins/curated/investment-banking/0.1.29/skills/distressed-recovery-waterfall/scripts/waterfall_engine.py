#!/usr/bin/env python3
"""
Mechanical distressed recovery waterfall helper.

This script performs a simple priority waterfall from distributable value to claims.
It is a calculation aid, not a legal, collateral, intercreditor, or plan analysis.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    build_minimal_handoff_payload,
    dict_rows_to_sheet,
    handoff_artifact_item,
    write_artifact_manifest,
    write_cover_first_workbook,
    write_handoff_payload,
)
from shared.model_citations import write_model_citations_from_sheets  # noqa: E402


@dataclass
class ClaimClass:
    name: str
    claim: float
    priority: int
    notes: str = ""
    equity: bool = False


def _number(value: Any, field: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric; got {value!r}") from exc


def load_input(path: Path) -> tuple[str, str, list[dict[str, Any]], list[ClaimClass]]:
    data = json.loads(path.read_text())
    company = str(data.get("company", "company")).strip() or "company"
    currency = str(data.get("currency", "$mm")).strip() or "$mm"

    scenarios = data.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        raise ValueError("input must include a non-empty scenarios list")

    classes_raw = data.get("classes")
    if not isinstance(classes_raw, list) or not classes_raw:
        raise ValueError("input must include a non-empty classes list")

    classes: list[ClaimClass] = []
    for idx, item in enumerate(classes_raw, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"class {idx} must be an object")
        name = str(item.get("name", f"class {idx}")).strip()
        claim = _number(item.get("claim", 0), f"classes[{idx}].claim")
        priority_raw = item.get("priority")
        if priority_raw is None:
            raise ValueError(f"classes[{idx}].priority is required")
        priority = int(_number(priority_raw, f"classes[{idx}].priority"))
        notes = str(item.get("notes", "")).strip()
        equity = bool(item.get("equity", False))
        if claim < 0:
            raise ValueError(f"classes[{idx}].claim cannot be negative")
        classes.append(
            ClaimClass(name=name, claim=claim, priority=priority, notes=notes, equity=equity)
        )

    for idx, scenario in enumerate(scenarios, start=1):
        if not isinstance(scenario, dict):
            raise ValueError(f"scenario {idx} must be an object")
        if "distributable_value" not in scenario:
            raise ValueError(f"scenario {idx} missing distributable_value")
        _number(scenario["distributable_value"], f"scenarios[{idx}].distributable_value")

    return company, currency, scenarios, classes


def allocate_scenario(
    value: float, classes: list[ClaimClass]
) -> tuple[list[dict[str, Any]], str | None, float]:
    remaining = max(value, 0.0)
    rows: list[dict[str, Any]] = []
    fulcrum: str | None = None

    priorities = sorted({c.priority for c in classes})
    for priority in priorities:
        group = [c for c in classes if c.priority == priority]
        debt_group = [c for c in group if not c.equity]
        equity_group = [c for c in group if c.equity]

        group_claim = sum(c.claim for c in debt_group)
        if group_claim > 0:
            available = min(remaining, group_claim)
            recovery_ratio = available / group_claim if group_claim else 0.0
            for c in group:
                if c.equity:
                    allocation = 0.0
                    recovery_pct = None
                else:
                    allocation = c.claim * recovery_ratio
                    recovery_pct = allocation / c.claim if c.claim else None
                    if fulcrum is None and allocation > 1e-9 and allocation < c.claim - 1e-9:
                        fulcrum = c.name
                rows.append(
                    {
                        "priority": c.priority,
                        "name": c.name,
                        "claim": c.claim,
                        "allocation": allocation,
                        "recovery_pct": recovery_pct,
                        "notes": c.notes,
                    }
                )
            remaining -= available
        else:
            # Equity or zero-claim classes receive residual value pro rata by count.
            count = len(equity_group) if equity_group else len(group)
            for c in group:
                allocation = remaining / count if count else 0.0
                rows.append(
                    {
                        "priority": c.priority,
                        "name": c.name,
                        "claim": c.claim,
                        "allocation": allocation,
                        "recovery_pct": None,
                        "notes": c.notes or "residual class",
                    }
                )
            remaining = 0.0

    return rows, fulcrum, remaining


def fmt(value: float, currency: str) -> str:
    return f"{currency} {value:,.1f}"


def pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:,.1f}%"


def render_markdown(
    company: str, currency: str, scenarios: list[dict[str, Any]], classes: list[ClaimClass]
) -> str:
    lines: list[str] = []
    lines.append(f"# Mechanical Recovery Waterfall - {company}")
    lines.append("")
    lines.append(
        "> This output is a simple priority waterfall. It does not resolve collateral, deficiency-claim, intercreditor, legal-entity, plan-settlement, voting, tax, or legal-advice issues."
    )
    lines.append("")

    for scenario in scenarios:
        name = str(scenario.get("name", "scenario")).strip() or "scenario"
        value = _number(scenario.get("distributable_value"), f"scenario {name} distributable_value")
        rows, fulcrum, residual = allocate_scenario(value, classes)
        lines.append(f"## {name}")
        lines.append("")
        lines.append(f"Distributable value: **{fmt(value, currency)}**")
        lines.append("")
        lines.append("| Priority | Class | Claim | Allocation | Recovery | Notes |")
        lines.append("|---:|---|---:|---:|---:|---|")
        for row in rows:
            lines.append(
                f"| {row['priority']} | {row['name']} | {fmt(row['claim'], currency)} | "
                f"{fmt(row['allocation'], currency)} | {pct(row['recovery_pct'])} | {row['notes']} |"
            )
        lines.append("")
        if fulcrum:
            lines.append(f"Mechanical fulcrum: **{fulcrum}**")
        elif residual > 1e-9:
            lines.append(
                f"No impaired debt fulcrum; residual unallocated value: **{fmt(residual, currency)}**"
            )
        else:
            lines.append("No mechanical fulcrum identified.")
        lines.append("")

    lines.append("## Required senior-banker overlay")
    lines.append("")
    lines.append("- Confirm issuer, guarantor, collateral, lien, and intercreditor terms.")
    lines.append("- Separate collateral pools and deficiency claims if material.")
    lines.append(
        "- Add DIP, administrative, priority, professional-fee, lease, trade, litigation, pension, tax, and disputed claims."
    )
    lines.append("- Reconcile model recoveries to market trading prices.")
    lines.append(
        "- Sensitize valuation, claim size, make-whole, default interest, new money, MIP, and liquidation assumptions."
    )
    lines.append("- Flag legal conclusions for counsel review.")
    lines.append("")
    return "\n".join(lines)


def waterfall_rows(
    scenarios: list[dict[str, Any]], classes: list[ClaimClass]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for scenario in scenarios:
        name = str(scenario.get("name", "scenario")).strip() or "scenario"
        value = _number(scenario.get("distributable_value"), f"scenario {name} distributable_value")
        allocations, fulcrum, residual = allocate_scenario(value, classes)
        for row in allocations:
            rows.append(
                {
                    "scenario": name,
                    "distributable_value": value,
                    "priority": row["priority"],
                    "class": row["name"],
                    "claim": row["claim"],
                    "allocation": row["allocation"],
                    "recovery_pct": "" if row["recovery_pct"] is None else row["recovery_pct"],
                    "fulcrum_class": fulcrum or "",
                    "residual_value": residual,
                    "notes": row["notes"],
                }
            )
    return rows


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: python scripts/waterfall_engine.py input.json output.md", file=sys.stderr)
        return 2
    input_path = Path(argv[1])
    output_path = Path(argv[2])
    try:
        company, currency, scenarios, classes = load_input(input_path)
        markdown = render_markdown(company, currency, scenarios, classes)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")

        rows = waterfall_rows(scenarios, classes)
        workbook_path = output_path.parent / "recovery_waterfall.xlsx"
        workbook_tables = {
            "Capital_Structure": dict_rows_to_sheet(
                [
                    {
                        "priority": c.priority,
                        "class": c.name,
                        "claim": c.claim,
                        "equity": c.equity,
                        "notes": c.notes,
                    }
                    for c in classes
                ]
            ),
            "Claims": dict_rows_to_sheet(
                [
                    {"class": c.name, "claim": c.claim, "priority": c.priority, "notes": c.notes}
                    for c in classes
                ]
            ),
            "Valuation_Cases": dict_rows_to_sheet(scenarios),
            "Waterfall": dict_rows_to_sheet(rows),
            "Recoveries_By_Class": dict_rows_to_sheet(rows),
            "Fulcrum_Sensitivity": dict_rows_to_sheet(rows),
            "Stakeholder_Map": [
                ["stakeholder", "review_note"],
                ["Counsel", "Review legal conclusions and priority mechanics."],
                ["Creditors", "Validate claims and recoveries."],
                ["Sponsor/equity", "Review residual value only after debt claims."],
            ],
            "Open_Items": [
                ["item", "owner"],
                ["Collateral and lien analysis", "Counsel / RX banker"],
                ["Intercreditor mechanics", "Counsel"],
                ["Market-implied recoveries", "Banker"],
            ],
            "Sources": [
                ["source", "path"],
                ["input_json", str(input_path)],
                ["support_markdown", str(output_path)],
            ],
        }
        write_cover_first_workbook(
            workbook_path,
            [
                ["Distressed Recovery Waterfall"],
                ["Company", company],
                ["Currency", currency],
                [
                    "First read",
                    "Use this workbook first. The Markdown file is retained as a support narrative only.",
                ],
                [
                    "Counsel flag",
                    "Mechanical output only; legal, collateral, intercreditor, tax, and plan issues require specialist review.",
                ],
            ],
            workbook_tables,
        )
        model_citations = write_model_citations_from_sheets(
            output_path.parent / "model_citations.json", workbook_path, workbook_tables
        )
        handoff_results = [
            write_handoff_payload(
                output_path.parent,
                "distressed_recovery_waterfall_to_memo_builder",
                build_minimal_handoff_payload(
                    "distressed_recovery_waterfall_to_memo_builder",
                    {
                        "company": company,
                        "source_log": [
                            {
                                "source_id": "SRC-001",
                                "source_name": "Distressed recovery waterfall workbook",
                                "source_type": "generated_workbook",
                                "source_date": "not_provided",
                                "document_date": "not_provided",
                                "accessed_date": "not_provided",
                                "as_of_date": "not_provided",
                                "source_pointer": str(workbook_path),
                                "freshness_status": "current",
                                "conflict_status": "unresolved",
                                "confidence": "medium",
                                "native_evidence_label": "mechanical_waterfall_output",
                                "canonical_evidence_category": "estimate",
                                "treatment": "mechanical waterfall output; counsel and restructuring specialist review required",
                                "limitations": "excludes legal, collateral, intercreditor, tax, plan, and trading analysis",
                            }
                        ],
                    },
                ),
                "memo-builder",
            ),
            write_handoff_payload(
                output_path.parent,
                "distressed_recovery_waterfall_to_pitch_deck_builder",
                build_minimal_handoff_payload(
                    "distressed_recovery_waterfall_to_pitch_deck_builder",
                    {
                        "company": company,
                        "source_log": [
                            {
                                "source_id": "SRC-001",
                                "source_name": "Distressed recovery waterfall workbook",
                                "source_type": "generated_workbook",
                                "source_date": "not_provided",
                                "document_date": "not_provided",
                                "accessed_date": "not_provided",
                                "as_of_date": "not_provided",
                                "source_pointer": str(workbook_path),
                                "freshness_status": "current",
                                "conflict_status": "unresolved",
                                "confidence": "medium",
                                "native_evidence_label": "mechanical_waterfall_output",
                                "canonical_evidence_category": "estimate",
                                "treatment": "convert only after specialist review of legal and collateral mechanics",
                                "limitations": "excludes legal, collateral, intercreditor, tax, plan, and trading analysis",
                            }
                        ],
                    },
                ),
                "pitch-deck-builder",
            ),
            write_handoff_payload(
                output_path.parent,
                "distressed_recovery_waterfall_to_ib_deck_qc",
                build_minimal_handoff_payload(
                    "distressed_recovery_waterfall_to_ib_deck_qc",
                    {
                        "company": company,
                        "source_log": [
                            {
                                "source_id": "SRC-001",
                                "source_name": "Distressed recovery waterfall workbook",
                                "source_type": "generated_workbook",
                                "source_date": "not_provided",
                                "document_date": "not_provided",
                                "accessed_date": "not_provided",
                                "as_of_date": "not_provided",
                                "source_pointer": str(workbook_path),
                                "freshness_status": "current",
                                "conflict_status": "unresolved",
                                "confidence": "medium",
                                "native_evidence_label": "mechanical_waterfall_output",
                                "canonical_evidence_category": "estimate",
                                "treatment": "QC recovery, fulcrum, and specialist-review claims before circulation",
                                "limitations": "excludes legal, collateral, intercreditor, tax, plan, and trading analysis",
                            }
                        ],
                    },
                ),
                "ib-deck-qc",
            ),
        ]
        write_artifact_manifest(
            output_path.parent,
            "distressed-recovery-waterfall",
            "workbook",
            workbook_path,
            companion_deliverables=[],
            support_artifacts=[
                artifact_item(
                    output_path,
                    "support_artifact",
                    "markdown",
                    "Markdown waterfall support narrative.",
                    False,
                    True,
                    "Markdown is retained as support data; the workbook is the human deliverable.",
                ),
                artifact_item(
                    output_path.parent / "model_citations.json",
                    "support_artifact",
                    "json",
                    "Workbook cell/range citation ledger for recovery waterfall outputs.",
                    False,
                    True,
                    "Model citations support source-gate traceability and any later standalone memo.",
                ),
                *[handoff_artifact_item(result) for result in handoff_results],
            ],
            blocked_or_partial_status={
                "status": "partial",
                "reason": "Mechanical waterfall excludes legal, collateral, intercreditor, tax, plan, and market-trading analysis.",
                "missing_inputs": [
                    "Counsel review",
                    "Collateral and lien analysis",
                    "Market trading prices",
                    "Plan and intercreditor mechanics",
                ],
            },
            extra={
                "model_citations_path": str(output_path.parent / "model_citations.json"),
                "model_citation_count": len(model_citations),
                "handoffs": [
                    {
                        "handoff_contract_name": result["handoff_contract_name"],
                        "path": result["path"],
                        "schema_path": result["schema_path"],
                        "validator_status": result["validator_status"],
                        "validated_at": result["validated_at"],
                        "consumer_skill": result["consumer_skill"],
                    }
                    for result in handoff_results
                ],
            },
        )
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"wrote primary workbook to {workbook_path}")
    print(f"wrote support markdown to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
