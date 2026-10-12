#!/usr/bin/env python3
"""Build a deterministic Investment Banking deal process tracker workbook."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    dict_rows_to_sheet,
    support_dir,
    write_artifact_manifest,
    write_simple_xlsx_from_tables,
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
    buyers = as_rows(
        payload.get("buyers") or payload.get("records"),
        [
            {
                "buyer": "Example Sponsor",
                "type": "Sponsor",
                "status": "Not contacted",
                "priority": "A",
                "owner": "Associate",
            }
        ],
    )
    outreach = as_rows(
        payload.get("outreach"),
        [
            {
                "buyer": buyers[0].get("buyer", "Example Sponsor"),
                "last_touch": "",
                "next_step": "Prepare outreach draft",
                "owner": "Associate",
            }
        ],
    )
    bids = as_rows(
        payload.get("bids"),
        [
            {
                "bidder": buyers[0].get("buyer", "Example Sponsor"),
                "round": "IOI",
                "status": "Not received",
                "value": "",
                "notes": "",
            }
        ],
    )
    diligence = as_rows(
        payload.get("diligence"),
        [
            {
                "workstream": "Financials",
                "status": "Open",
                "owner": "Associate",
                "blocker": "Source package not complete",
            }
        ],
    )
    open_items = as_rows(
        payload.get("open_items"),
        [
            {
                "item": "Confirm process dates",
                "owner": "VP",
                "priority": "High",
                "blocks_circulation": True,
            }
        ],
    )
    sources = as_rows(
        payload.get("sources"),
        [
            {
                "source": "User/input package",
                "status": "needs review",
                "as_of_date": payload.get("as_of_date", "not_provided"),
            }
        ],
    )
    workbook = out / "deal_process_tracker.xlsx"
    write_simple_xlsx_from_tables(
        workbook,
        {
            "Dashboard": [
                ["Deal Process Tracker Dashboard"],
                ["Company", payload.get("company", "Subject Company")],
                ["First read", "Use this dashboard first; intake JSON is support only."],
                ["Status", "Process tracker requires banker review before circulation."],
                [],
                ["Executive Command View"],
                ["Top priority", open_items[0].get("item", "Review open items")],
                ["Next action", outreach[0].get("next_step", "Update tracker")],
                [],
                ["Process Coverage", "Count"],
                ["Buyers tracked", len(buyers)],
                ["Bid records", len(bids)],
                ["Open items", len(open_items)],
            ],
            "Buyer_Master": dict_rows_to_sheet(buyers),
            "Outreach_Log": dict_rows_to_sheet(outreach),
            "Bid_Grid": dict_rows_to_sheet(bids),
            "Diligence_Tracker": dict_rows_to_sheet(diligence),
            "Open_Items": dict_rows_to_sheet(open_items),
            "Aging": [
                ["bucket", "count"],
                ["0-7 days", "review"],
                ["8-14 days", "review"],
                ["15+ days", "review"],
            ],
            "MD_Morning_Summary": [
                ["item", "readout"],
                ["Top priority", open_items[0].get("item", "Review open items")],
                ["Next action", outreach[0].get("next_step", "Update tracker")],
            ],
            "Sources": dict_rows_to_sheet(sources),
        },
    )
    intake = write_support_payload(out, payload)
    write_artifact_manifest(
        out,
        "deal-process-tracker",
        "workbook",
        workbook,
        support_artifacts=[
            artifact_item(
                intake,
                "support_artifact",
                "json",
                "Original tracker intake payload.",
                False,
                False,
                "Intake JSON is support/audit material.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Tracker is operational but needs banker-owned process updates before circulation.",
            "missing_inputs": [],
        },
    )
    summary = {
        "primary_human_deliverable": str(workbook),
        "manifest": str(out / "manifest.json"),
    }
    print_summary(
        args.json_run_log,
        args.quiet_human_output,
        summary,
        [
            "Deal process tracker complete",
            f"Open first: {workbook}",
        ],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
