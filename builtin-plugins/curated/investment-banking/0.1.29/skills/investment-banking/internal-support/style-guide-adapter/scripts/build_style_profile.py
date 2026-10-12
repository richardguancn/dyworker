#!/usr/bin/env python3
"""Build a deterministic style profile package from extractor output or sparse intake."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

PLUGIN_ROOT = Path(__file__).resolve().parents[5]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    logs_dir,
    render_html_report,
    support_dir,
    write_artifact_manifest,
    write_dashboard_contract,
)


def load_payload(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def as_rows(value: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return value
    return fallback


def write_support_payload(
    outdir: Path, payload: Mapping[str, Any], name: str = "intake.json"
) -> Path:
    target = support_dir(outdir) / name
    target.write_text(json.dumps(dict(payload), indent=2) + "\n", encoding="utf-8")
    return target


def print_summary(
    json_run_log: bool, quiet: bool, summary: dict[str, Any], human_lines: Sequence[str]
) -> None:
    if json_run_log:
        print(json.dumps(summary, indent=2))
    elif not quiet:
        for line in human_lines:
            print(line)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--json-run-log", "--json", dest="json_run_log", action="store_true")
    parser.add_argument("--quiet-human-output", action="store_true")
    args = parser.parse_args()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    payload = load_payload(args.input)
    profile = {
        "contract_name": "style_guide_adapter_style_profile",
        "style_profile_id": payload.get("style_profile_id", "STYLE-001"),
        "target_style_scope": payload.get("target_style_scope", "presentation and memo materials"),
        "artifact_type": payload.get("artifact_type", "mixed"),
        "style_source_records": payload.get(
            "style_source_records",
            [
                {
                    "source_id": "STYLE-SRC-001",
                    "source_name": "style intake",
                    "source_type": "user_supplied",
                    "source_priority": "primary",
                    "source_scope": "style",
                    "source_date_or_period": payload.get("as_of_date", "not_provided"),
                    "freshness": "unknown",
                    "relevance": "medium",
                    "confidence": "medium",
                    "limitations": "deterministic style profile scaffold",
                }
            ],
        ),
        "source_basis_summary": "Style profile generated from supplied style/extractor payload; visual review still required.",
        "style_provenance_labels": ["user_supplied_style"],
        "visual_system": payload.get(
            "visual_system", "preserve source hierarchy, typography, and exhibit conventions"
        ),
        "layout_grammar": payload.get("layout_grammar", "preserve page density and section order"),
        "exhibit_conventions": payload.get(
            "exhibit_conventions", "preserve chart/table labeling and footnotes"
        ),
        "writing_voice": payload.get("writing_voice", "banker concise"),
        "citation_and_footnote_norms": payload.get(
            "citation_and_footnote_norms", "preserve existing source/citation treatment"
        ),
        "artifact_specific_rules": payload.get(
            "artifact_specific_rules", "do not alter model numbers or legal language"
        ),
        "do_not_change_rules": payload.get(
            "do_not_change_rules", "no substantive edits without explicit instruction"
        ),
        "style_assumptions": ["style source requires visual confirmation"],
        "style_conflicts": ["not reviewed against all target artifacts"],
        "open_style_questions": [{"item": "Confirm latest house style source", "status": "open"}],
        "style_confidence": "medium",
        "style_freshness_status": "unknown",
        "visual_review_status": "needs_review",
        "style_limitations": "No native restyling performed by this profile builder.",
        "circulation_caveats": [
            {
                "caveat": "Visual/style profile requires QC before client circulation",
                "impact": "not client-ready",
                "owner": "Associate",
            }
        ],
    }
    change_log = {
        "contract_name": "style_guide_adapter_change_log",
        "change_log_id": "STYLE-CHANGE-001",
        "style_profile_id": profile["style_profile_id"],
        "source_artifact": str(args.input or "not_provided"),
        "output_artifact": "style_profile_report.html",
        "artifact_type": profile["artifact_type"],
        "artifact_version": "draft",
        "mode": "profile_only",
        "style_sources_used": ["STYLE-SRC-001"],
        "changes_made": [
            {
                "location": "profile",
                "area": "style",
                "change": "generated deterministic style profile",
                "basis": "input payload",
                "provenance_label": "user_supplied_style",
                "confidence": "medium",
                "content_impact": "none",
            }
        ],
        "preserved_elements": ["content", "numbers", "formulas"],
        "substantive_edits": ["none"],
        "data_formula_source_integrity_status": "preserved",
        "visual_review_status": "needs_review",
        "visual_review_notes": "No before/after visual diff created by profile builder.",
        "open_items": [
            {
                "item_id": "STYLE-OI-001",
                "description": "Run visual QC",
                "why_it_matters": "style-only changes can still break circulation quality",
                "owner": "Associate",
                "status": "open",
                "due_date": "not_provided",
                "blocks_circulation": True,
                "suggested_remediation": "Run ib-deck-qc/style visual review",
            }
        ],
        "non_client_ready_reasons": ["visual review not complete"],
        "downstream_qc_required": True,
        "circulation_caveats": profile["circulation_caveats"],
    }
    support = support_dir(out)
    profile_path = support / "style_profile.json"
    change_path = support / "style_change_log.json"
    profile_path.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    change_path.write_text(json.dumps(change_log, indent=2) + "\n", encoding="utf-8")
    contract = logs_dir(out) / "style_profile_report_contract.json"
    write_dashboard_contract(
        contract,
        "style-guide-adapter",
        "Style Profile Report",
        "Style profile",
        "report_only",
        out / "style_profile_report.html",
        report_body=[
            {
                "heading": "Style Profile",
                "body": "Profile generated as a control layer. Native restyling and visual diff/QC remain required before circulation.",
            }
        ],
        sections=[
            {
                "title": "Style Controls",
                "modules": [
                    {
                        "type": "table",
                        "title": "Open Style Questions",
                        "rows": profile["open_style_questions"],
                    },
                    {"type": "table", "title": "Change Log", "rows": change_log["changes_made"]},
                ],
            }
        ],
    )
    html = render_html_report(contract, out, "style_profile_report.html")
    write_artifact_manifest(
        out,
        "style-guide-adapter",
        "html_report",
        html,
        support_artifacts=[
            artifact_item(
                profile_path,
                "support_artifact",
                "json",
                "Schema-backed style profile handoff.",
                False,
                True,
                "Style profile JSON is machine-readable handoff support.",
            ),
            artifact_item(
                change_path,
                "support_artifact",
                "json",
                "Schema-backed style change log.",
                False,
                True,
                "Change-log JSON is machine-readable handoff support.",
            ),
            artifact_item(
                contract,
                "support_artifact",
                "json",
                "Dashboard-builder render contract.",
                False,
                False,
                "Render contract is internal plumbing.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Native restyling and visual diff/QC are not complete.",
            "missing_inputs": ["visual diff", "native Office restyle", "deck QC"],
        },
    )
    summary = {
        "primary_human_deliverable": str(html),
        "style_profile": str(profile_path),
        "change_log": str(change_path),
        "manifest": str(out / "manifest.json"),
    }
    print_summary(
        args.json_run_log,
        args.quiet_human_output,
        summary,
        [
            "Style profile report complete",
            f"Open first: {html}",
            "Support style profile/change-log JSON written under support/.",
        ],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
