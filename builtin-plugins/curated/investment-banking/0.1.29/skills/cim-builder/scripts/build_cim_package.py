#!/usr/bin/env python3
"""Build a standalone HTML CIM/storyboard package with optional presentation mode."""

from __future__ import annotations

import argparse
import html
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
    write_cover_first_workbook,
)
from shared.office_artifacts import write_minimal_pptx  # noqa: E402


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


def escape(value: Any, default: str = "Not provided") -> str:
    text = default if value in (None, "") else str(value)
    return html.escape(text)


def first_value(payload: Mapping[str, Any], keys: Sequence[str], default: str) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return default


def render_table(rows: Sequence[Mapping[str, Any]], columns: Sequence[tuple[str, str]]) -> str:
    head = "".join(f"<th>{escape(label)}</th>" for _, label in columns)
    body = []
    for row in rows:
        body.append(
            "<tr>" + "".join(f"<td>{escape(row.get(key, ''))}</td>" for key, _ in columns) + "</tr>"
        )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def write_standalone_html(
    target: Path,
    payload: Mapping[str, Any],
    company: str,
    pages: Sequence[Mapping[str, Any]],
    issues: Sequence[Mapping[str, Any]],
    source_log: Sequence[Mapping[str, Any]],
) -> Path:
    as_of = first_value(payload, ("as_of_date", "analysis_date"), "As of date not supplied")
    transaction = first_value(
        payload,
        ("transaction_context", "transaction_type"),
        "Transaction context to be confirmed before circulation.",
    )
    story = first_value(
        payload,
        ("executive_story", "equity_story", "investment_story"),
        "This working document defines the proposed buyer narrative, page flow, evidence needs, and diligence blockers for a first-draft CIM.",
    )
    posture = first_value(
        payload,
        ("circulation_posture",),
        "Working draft - not for external circulation until source support and review gates are complete.",
    )
    page_table = render_table(
        pages,
        (
            ("page", "Page"),
            ("section", "Proposed section"),
            ("purpose", "Buyer-facing purpose"),
            ("source_status", "Evidence status"),
        ),
    )
    issue_table = render_table(
        issues,
        (
            ("issue_id", "ID"),
            ("issue", "Management support / diligence item"),
            ("owner", "Owner"),
            ("blocks_external", "Blocks circulation"),
        ),
    )
    source_table = render_table(
        source_log,
        (
            ("source_id", "Source ID"),
            ("source_name", "Source"),
            ("as_of_date", "As of date"),
            ("status", "Use status"),
        ),
    )
    document = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(company)} | CIM Storyboard</title>
<style>
:root {{
  --paper: #fbf8f2;
  --ink: #12201d;
  --forest: #194a3d;
  --sage: #738b7c;
  --rule: #d9d2c6;
  --accent: #aa503b;
  --muted: #55645f;
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--paper); color: var(--ink); font-family: Arial, sans-serif; }}
.masthead {{ background: var(--forest); color: #f7f3ea; padding: 24px max(36px, calc((100vw - 1120px) / 2)); font-size: 12px; letter-spacing: .16em; text-transform: uppercase; }}
.page {{ max-width: 1120px; margin: 0 auto; padding: 54px 36px 72px; }}
.hero {{ display: grid; grid-template-columns: 1fr 310px; gap: 48px; padding-bottom: 42px; border-bottom: 1px solid var(--rule); }}
.eyebrow {{ color: var(--forest); font-size: 12px; font-weight: bold; letter-spacing: .13em; text-transform: uppercase; }}
h1 {{ font-family: Georgia, serif; font-size: clamp(42px, 6vw, 68px); font-weight: normal; line-height: 1.06; margin: 16px 0 18px; }}
.dek {{ color: var(--forest); font-family: Georgia, serif; font-size: 24px; line-height: 1.35; max-width: 700px; }}
.summary {{ background: #12201d; color: #f7f3ea; padding: 30px 28px; }}
.summary strong {{ display: block; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #cfdbd2; margin-bottom: 9px; }}
.summary p {{ margin: 0 0 26px; line-height: 1.45; }}
.summary p:last-child {{ margin-bottom: 0; }}
.warning {{ margin: 30px 0 38px; border-left: 5px solid var(--accent); background: #f2e6dd; padding: 17px 20px; color: #71352b; font-weight: bold; }}
section {{ margin: 48px 0; }}
h2 {{ font-family: Georgia, serif; font-size: 32px; font-weight: normal; margin: 0 0 15px; }}
.intro {{ max-width: 850px; color: var(--muted); font-size: 17px; line-height: 1.65; }}
.label {{ color: var(--forest); font-size: 11px; font-weight: bold; letter-spacing: .14em; text-transform: uppercase; margin-bottom: 10px; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 21px; font-size: 14px; }}
th {{ background: var(--forest); color: #fff; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; text-align: left; padding: 13px 14px; }}
td {{ padding: 14px; border-bottom: 1px solid var(--rule); vertical-align: top; line-height: 1.45; }}
tbody tr:nth-child(even) {{ background: #f6f1e8; }}
.footer {{ margin-top: 58px; border-top: 1px solid var(--rule); padding-top: 18px; color: var(--muted); font-size: 12px; }}
@media (max-width: 800px) {{ .hero {{ grid-template-columns: 1fr; }} .page {{ padding: 34px 20px 50px; }} }}
</style>
</head>
<body>
<div class="masthead">Investment Banking | CIM Builder | First-Draft Storyboard</div>
<main class="page">
  <div class="hero">
    <div>
      <div class="eyebrow">Buyer-facing document architecture</div>
      <h1>{escape(company)}<br>CIM Storyboard</h1>
      <div class="dek">{escape(story)}</div>
    </div>
    <aside class="summary">
      <strong>Transaction context</strong><p>{escape(transaction)}</p>
      <strong>Analysis date</strong><p>{escape(as_of)}</p>
      <strong>Status</strong><p>First-draft working document</p>
    </aside>
  </div>
  <div class="warning">{escape(posture)}</div>
  <section>
    <div class="label">01 | Proposed document flow</div>
    <h2>Page plan and exhibit architecture</h2>
    <p class="intro">Each proposed section should advance a buyer underwriting question and remain traceable to available evidence or a clearly identified management ask.</p>
    {page_table}
  </section>
  <section>
    <div class="label">02 | Before circulation</div>
    <h2>Management support and diligence blockers</h2>
    <p class="intro">Items shown below should be resolved, supported, or explicitly caveated before this draft is treated as externally circulable marketing material.</p>
    {issue_table}
  </section>
  <section>
    <div class="label">03 | Evidence register</div>
    <h2>Source base and readiness</h2>
    <p class="intro">Material buyer-facing statements should cite complete figures, dates, and claims at the point of use in the completed CIM.</p>
    {source_table}
  </section>
  <div class="footer">Working document prepared by cim-builder. Support files and manifests are retained separately for drafting control and quality review.</div>
</main>
</body>
</html>
"""
    target.write_text(document, encoding="utf-8")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--presentation",
        action="store_true",
        help="Select presentation mode and make a native PPTX storyboard the hero artifact.",
    )
    parser.add_argument("--json-run-log", "--json", dest="json_run_log", action="store_true")
    parser.add_argument("--quiet-human-output", action="store_true")
    args = parser.parse_args()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    payload = load_payload(args.input)
    company = str(payload.get("company", "Subject Company"))
    pages = as_rows(
        payload.get("page_plan"),
        [
            {
                "page": 1,
                "section": "Executive Summary",
                "purpose": "Lead with buyer-facing thesis",
                "source_status": "needs source log",
            },
            {
                "page": 2,
                "section": "Company Overview",
                "purpose": "Frame business quality",
                "source_status": "needs source log",
            },
        ],
    )
    issues = as_rows(
        payload.get("diligence_issues"),
        [
            {
                "issue_id": "CIM-OI-001",
                "issue": "Complete source support and management review",
                "owner": "Deal team",
                "blocks_external": True,
            }
        ],
    )
    source_log = as_rows(
        payload.get("source_log"),
        [
            {
                "source_id": "SRC-001",
                "source_name": "CIM intake",
                "as_of_date": payload.get("as_of_date", "not provided"),
                "status": "needs review",
            }
        ],
    )
    intake = write_support_payload(out, payload)
    workbook = out / "cim_package_plan.xlsx"
    write_cover_first_workbook(
        workbook,
        [
            ["CIM Package Plan"],
            ["Company", company],
            [
                "First read",
                "Open the standalone HTML storyboard unless presentation mode was selected.",
            ],
            ["Readiness", "Not external-ready until source support and review gates pass."],
        ],
        {
            "Page_Plan": dict_rows_to_sheet(pages),
            "Source_Log": dict_rows_to_sheet(source_log),
            "Diligence_Issue_Log": dict_rows_to_sheet(issues),
        },
    )
    html_path = write_standalone_html(
        out / "cim_storyboard.html", payload, company, pages, issues, source_log
    )
    pptx: Path | None = None
    if args.presentation:
        pptx = write_minimal_pptx(
            out / "cim_storyboard.pptx",
            f"{company} CIM Storyboard",
            [row.get("section", "Section") for row in pages],
        )

    if args.presentation and pptx is not None:
        primary = pptx
        artifact_mode = "native_deck"
        companions = [
            artifact_item(
                html_path,
                "companion_deliverable",
                "html",
                "Standalone HTML storyboard document.",
                True,
                True,
            ),
            artifact_item(
                workbook,
                "companion_deliverable",
                "xlsx",
                "CIM page-plan/source-log workbook.",
                True,
                True,
            ),
        ]
    else:
        primary = html_path
        artifact_mode = "html_report"
        companions = [
            artifact_item(
                workbook,
                "companion_deliverable",
                "xlsx",
                "CIM page-plan/source-log workbook.",
                True,
                True,
            )
        ]

    process_metadata = {
        key: str(payload[key]).strip()
        for key in ("process_status", "marketing_posture")
        if isinstance(payload.get(key), str) and str(payload[key]).strip()
    }
    write_artifact_manifest(
        out,
        "cim-builder",
        artifact_mode,
        primary,
        companion_deliverables=companions,
        support_artifacts=[
            artifact_item(
                intake,
                "support_artifact",
                "json",
                "CIM package intake payload.",
                False,
                True,
                "Intake JSON is support material.",
            )
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "This is a working CIM/storyboard draft until source support, management review, and applicable QC are complete.",
            "missing_inputs": ["complete source support", "management review", "circulation QC"],
        },
        extra=process_metadata or None,
    )
    summary = {
        "primary_human_deliverable": str(primary),
        "standalone_html": str(html_path),
        "companion_workbook": str(workbook),
        "presentation_mode": bool(args.presentation),
        "native_deck": str(pptx) if pptx is not None else None,
        "manifest": str(out / "manifest.json"),
    }
    first_read_label = "native deck" if args.presentation else "standalone HTML storyboard"
    print_summary(
        args.json_run_log,
        args.quiet_human_output,
        summary,
        [
            "CIM storyboard package complete",
            f"Open first ({first_read_label}): {primary}",
            f"Page-plan workbook: {workbook}",
        ],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
