#!/usr/bin/env python3
"""Materialize deterministic IB transaction sensitivity table scaffolds.

The script intentionally does not calculate transaction outputs. It creates stable,
mode-specific table skeletons that can be populated from a source model and handed
to model builders, memo builders, deck builders, and QC skills.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any, Iterable

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    dict_rows_to_sheet,
    logs_dir,
    support_dir,
    write_artifact_manifest,
    write_cover_first_workbook,
)

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_MODE_FILE = SKILL_DIR / "assets" / "sensitivity_pack_modes.json"

CANONICAL_MODES = [
    "valuation",
    "debt_capacity",
    "covenant_headroom",
    "financing_terms",
    "merger_model",
    "downside",
    "returns",
]

CASE_SUMMARY_FIELDS = [
    "mode",
    "case",
    "case_headline",
    "primary_output_metric",
    "output_value",
    "delta_vs_base",
    "source_or_model_basis",
    "caveat",
]

SENSITIVITY_FIELDS = [
    "mode",
    "sensitivity_name",
    "driver_1",
    "driver_1_value",
    "driver_2",
    "driver_2_value",
    "output_metric",
    "output_value",
    "delta_vs_base",
    "threshold_or_breakpoint",
    "caveat",
]

OVERLAY_FIELDS = [
    "transaction_version",
    "sensitivity_basis",
    "embedded_corrections_or_adjustments",
    "excluded_unresolved_items",
    "case",
    "model_module",
    "transaction_driver",
    "baseline_value",
    "scenario_value",
    "delta_type",
    "start_period",
    "end_period",
    "deal_rationale",
    "controllability",
    "deal_owner",
    "review_status",
    "expiry_review_date",
    "output_impact",
    "caveat",
]

TRIGGER_FIELDS = [
    "mode",
    "trigger",
    "threshold",
    "monitoring_cadence",
    "likely_cause",
    "deal_action",
    "owner",
    "decision_deadline",
]

ACTION_FIELDS = [
    "mode",
    "action",
    "trigger",
    "expected_deal_impact",
    "deal_owner",
    "timing",
    "reversibility",
    "dependencies",
    "risks",
    "status",
]

BACKSOLVE_FIELDS = [
    "mode",
    "target_metric",
    "target_period",
    "target_value",
    "locked_constraints",
    "allowed_lever",
    "required_lever_value",
    "required_path",
    "feasibility_label",
    "what_must_be_true",
    "deal_owner",
    "caveat",
]


def load_modes(path: Path) -> dict[str, dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    missing = [mode for mode in CANONICAL_MODES if mode not in data]
    if missing:
        raise ValueError(f"mode template missing canonical modes: {', '.join(missing)}")
    return data


def resolve_modes(mode_arg: str) -> list[str]:
    if mode_arg == "all":
        return CANONICAL_MODES
    return [mode_arg]


def write_csv(path: Path, fields: list[str], rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def case_summary_rows(
    modes: dict[str, dict[str, Any]], selected: list[str]
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for mode in selected:
        config = modes[mode]
        primary = config["output_metrics"][0]
        for case in ["base", "upside", "downside", "stress"]:
            rows.append(
                {
                    "mode": mode,
                    "case": case,
                    "case_headline": f"{config['label']} - {case} case",
                    "primary_output_metric": primary,
                    "output_value": "[populate from source model]",
                    "delta_vs_base": "0.0" if case == "base" else "[populate from source model]",
                    "source_or_model_basis": "[model version / source]",
                    "caveat": "[label placeholder, assumption, or model limitation]",
                }
            )
    return rows


def sensitivity_rows(modes: dict[str, dict[str, Any]], mode: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for row in modes[mode]["sensitivity_rows"]:
        rows.append(
            {
                "mode": mode,
                "sensitivity_name": row["sensitivity_name"],
                "driver_1": row["driver_1"],
                "driver_1_value": row["driver_1_value"],
                "driver_2": row["driver_2"],
                "driver_2_value": row["driver_2_value"],
                "output_metric": row["output_metric"],
                "output_value": "[populate from source model]",
                "delta_vs_base": "[populate from source model]",
                "threshold_or_breakpoint": row["threshold_or_breakpoint"],
                "caveat": "[requires model output]",
            }
        )
    return rows


def overlay_rows(
    modes: dict[str, dict[str, Any]],
    selected: list[str],
    transaction_version: str,
    sensitivity_basis: str,
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for mode in selected:
        config = modes[mode]
        for driver in config["drivers"]:
            rows.append(
                {
                    "transaction_version": transaction_version,
                    "sensitivity_basis": sensitivity_basis,
                    "embedded_corrections_or_adjustments": "[none identified / describe corrections incorporated in baseline]",
                    "excluded_unresolved_items": "[material issues excluded from displayed sensitivity outputs]",
                    "case": "downside / upside / stress",
                    "model_module": mode,
                    "transaction_driver": driver,
                    "baseline_value": "[current model value]",
                    "scenario_value": "[scenario value]",
                    "delta_type": "replacement / percentage change / bps change / timing shift",
                    "start_period": "[period]",
                    "end_period": "[period]",
                    "deal_rationale": config["description"],
                    "controllability": "controllable / partially controllable / external market / document-driven",
                    "deal_owner": "[coverage / M&A / LevFin / ECM / DCM / sponsor / lender]",
                    "review_status": "proposed",
                    "expiry_review_date": "[date or committee checkpoint]",
                    "output_impact": ", ".join(config["output_metrics"]),
                    "caveat": "[source, market, or model caveat]",
                }
            )
    return rows


def trigger_rows(modes: dict[str, dict[str, Any]], selected: list[str]) -> list[dict[str, str]]:
    return [
        {
            "mode": mode,
            "trigger": modes[mode]["trigger"],
            "threshold": "[populate threshold]",
            "monitoring_cadence": "model refresh / committee checkpoint / market update",
            "likely_cause": "[driver movement]",
            "deal_action": modes[mode]["deal_action"],
            "owner": "[deal owner]",
            "decision_deadline": "[date or milestone]",
        }
        for mode in selected
    ]


def action_rows(modes: dict[str, dict[str, Any]], selected: list[str]) -> list[dict[str, str]]:
    return [
        {
            "mode": mode,
            "action": modes[mode]["deal_action"],
            "trigger": modes[mode]["trigger"],
            "expected_deal_impact": "[protect value / improve financeability / reduce downside risk]",
            "deal_owner": "[deal owner]",
            "timing": "[now / before bid / before launch / before committee]",
            "reversibility": "reversible / partially reversible / hard to reverse",
            "dependencies": "[source, model, lender, client, market, diligence]",
            "risks": "[execution or market risk]",
            "status": "proposed",
        }
        for mode in selected
    ]


def backsolve_rows(modes: dict[str, dict[str, Any]], selected: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for mode in selected:
        primary = modes[mode]["output_metrics"][0]
        rows.append(
            {
                "mode": mode,
                "target_metric": primary,
                "target_period": "[period or transaction milestone]",
                "target_value": "[target]",
                "locked_constraints": "[constraints that cannot move]",
                "allowed_lever": " / ".join(modes[mode]["drivers"][:3]),
                "required_lever_value": "[solve from source model]",
                "required_path": "[required path]",
                "feasibility_label": "[use target-backsolve-rubric.md]",
                "what_must_be_true": "[execution, market, financing, covenant, or source condition]",
                "deal_owner": "[deal owner]",
                "caveat": "[requires populated model output]",
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create deterministic IB sensitivity pack scaffolds."
    )
    parser.add_argument("--mode", choices=["all", *CANONICAL_MODES], required=True)
    parser.add_argument("--entity", default="Subject Company")
    parser.add_argument("--transaction-version", default="Base model")
    parser.add_argument(
        "--sensitivity-basis",
        choices=[
            "not_assessed_scaffold",
            "supplied_model",
            "corrected_scenario_ready_base",
            "audit_indicative_diagnostic_overlay",
            "not_suitable_for_sensitivity_reliance",
        ],
        default="not_assessed_scaffold",
        help="Classification of the baseline used for sensitivity analysis.",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--mode-file", type=Path, default=DEFAULT_MODE_FILE)
    parser.add_argument(
        "--json-run-log",
        "--json",
        dest="json_run_log",
        action="store_true",
        help="Print machine-readable run summary to stdout. Default stdout is human-readable.",
    )
    parser.add_argument(
        "--quiet-human-output",
        action="store_true",
        help="Suppress human-readable stdout when --json-run-log is not used.",
    )
    args = parser.parse_args()

    modes = load_modes(args.mode_file)
    selected = resolve_modes(args.mode)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    csv_dir = support_dir(args.output_dir)
    log_dir = logs_dir(args.output_dir)

    generated_files: list[str] = []
    output_rows_by_file: dict[str, list[dict[str, Any]]] = {}

    outputs = [
        ("case_summary.csv", CASE_SUMMARY_FIELDS, case_summary_rows(modes, selected)),
        (
            "scenario_overlay.csv",
            OVERLAY_FIELDS,
            overlay_rows(modes, selected, args.transaction_version, args.sensitivity_basis),
        ),
        ("trigger_metrics.csv", TRIGGER_FIELDS, trigger_rows(modes, selected)),
        ("deal_action_register.csv", ACTION_FIELDS, action_rows(modes, selected)),
        ("target_backsolve.csv", BACKSOLVE_FIELDS, backsolve_rows(modes, selected)),
    ]
    for file_name, fields, rows in outputs:
        write_csv(csv_dir / file_name, fields, rows)
        generated_files.append(str(csv_dir / file_name))
        output_rows_by_file[file_name] = rows

    for mode in selected:
        file_name = f"sensitivity_{mode}.csv"
        rows = sensitivity_rows(modes, mode)
        write_csv(csv_dir / file_name, SENSITIVITY_FIELDS, rows)
        generated_files.append(str(csv_dir / file_name))
        output_rows_by_file[file_name] = rows

    manifest = {
        "entity": args.entity,
        "transaction_version": args.transaction_version,
        "sensitivity_basis": args.sensitivity_basis,
        "prepared_date": date.today().isoformat(),
        "modes": selected,
        "canonical_mode_file": str(args.mode_file),
        "generated_files": generated_files,
        "posture": "scaffold_only_requires_source_model_population",
    }
    pack_manifest_path = log_dir / "pack_manifest.json"
    pack_manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    generated_files.append(str(pack_manifest_path))

    workbook_path = args.output_dir / "sensitivity_pack.xlsx"
    write_cover_first_workbook(
        workbook_path,
        [
            ["Sensitivity Pack"],
            ["Entity", args.entity],
            ["Transaction version", args.transaction_version],
            ["Prepared date", date.today().isoformat()],
            ["Sensitivity basis", args.sensitivity_basis],
            [
                "Embedded corrections / adjustments",
                "[none identified / describe corrections incorporated in baseline]",
            ],
            [
                "Excluded unresolved items",
                "[material issues excluded from displayed sensitivity outputs]",
            ],
            [
                "First read",
                "Use this workbook first. CSV files are support scaffolds in the support folder.",
            ],
            ["Posture", "Scaffold only until populated from a controlled source model."],
        ],
        {
            "Scenario_Inputs": dict_rows_to_sheet(
                output_rows_by_file["scenario_overlay.csv"], OVERLAY_FIELDS
            ),
            "Sensitivity_Table": dict_rows_to_sheet(
                [
                    row
                    for name, rows in output_rows_by_file.items()
                    if name.startswith("sensitivity_")
                    for row in rows
                ],
                SENSITIVITY_FIELDS,
            ),
            "Breakpoints": dict_rows_to_sheet(
                output_rows_by_file["trigger_metrics.csv"], TRIGGER_FIELDS
            ),
            "What_Breaks_First": dict_rows_to_sheet(
                output_rows_by_file["case_summary.csv"], CASE_SUMMARY_FIELDS
            ),
            "Actions": dict_rows_to_sheet(
                output_rows_by_file["deal_action_register.csv"], ACTION_FIELDS
            ),
            "Sources": [
                ["source", "path"],
                ["mode_file", str(args.mode_file)],
                ["support_folder", str(csv_dir)],
            ],
        },
    )

    support_artifacts = [
        artifact_item(
            path,
            "support_artifact",
            "json" if str(path).endswith(".json") else "csv",
            "Scenario support file for audit/import workflows.",
            False,
            str(path).endswith("pack_manifest.json"),
            "Scaffold data and manifests support the workbook; they are not the banker-facing first read.",
        )
        for path in generated_files
        if str(path).endswith((".csv", ".json"))
    ]
    write_artifact_manifest(
        args.output_dir,
        "scenario-sensitivity-generator",
        "workbook",
        workbook_path,
        companion_deliverables=[],
        support_artifacts=support_artifacts,
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Pack is a deterministic scaffold until populated from a controlled source model.",
            "missing_inputs": ["Controlled source model outputs", "Source dates", "Model caveats"],
        },
    )

    summary = {
        "output_dir": str(args.output_dir),
        "modes": selected,
        "generated_files": generated_files,
        "primary_human_deliverable": str(workbook_path),
        "manifest": str(args.output_dir / "manifest.json"),
    }
    if args.json_run_log:
        print(json.dumps(summary, indent=2))
    elif not args.quiet_human_output:
        print("Scenario sensitivity pack complete")
        print(f"Open first: {workbook_path}")
        print(f"Modes: {', '.join(selected)}")
        print("Support CSV/JSON files are stored under support/ and logs/ for audit/import use.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
