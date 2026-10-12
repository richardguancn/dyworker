#!/usr/bin/env python3
"""Build a deterministic comps summary from a user-supplied CSV."""

from __future__ import annotations

import argparse
import csv
import html as html_lib
import json
import statistics
import sys
from pathlib import Path
from typing import Any

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


def num(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def multiple(numerator: float | None, denominator: float | None) -> str:
    if numerator is None or denominator is None or denominator <= 0:
        return "N/M"
    return f"{numerator / denominator:.1f}x"


def _escape(value: Any) -> str:
    return html_lib.escape(str(value if value not in (None, "") else "-"))


def _table(headers: list[str], rows: list[list[Any]]) -> str:
    header_html = "".join(f"<th>{_escape(header)}</th>" for header in headers)
    row_html = "".join(
        "<tr>" + "".join(f"<td>{_escape(value)}</td>" for value in row) + "</tr>" for row in rows
    )
    return f"<div class='table-wrap'><table><thead><tr>{header_html}</tr></thead><tbody>{row_html}</tbody></table></div>"


def write_standalone_report(
    path: Path,
    scored: list[dict[str, Any]],
    stats: list[dict[str, Any]],
    missing_as_of: list[str],
) -> Path:
    status = (
        "Screening only: one or more market-data as-of dates are missing."
        if missing_as_of
        else "Usable with caveats: supplied dates are present; peer rationale and normalization still require banker review."
    )
    peer_rows = [
        [
            row.get("company", ""),
            row.get("ticker", ""),
            row.get("as_of_date", "") or "missing as-of",
            row.get("EV_Revenue", ""),
            row.get("EV_EBITDA", ""),
            row.get("P_E", ""),
        ]
        for row in scored
    ]
    stat_rows = [[row.get("metric", ""), row.get("value", "")] for row in stats]
    date_flag = (
        f"Missing as-of dates: {', '.join(missing_as_of)}. Obtain dated pricing before using the affected rows in a selected range."
        if missing_as_of
        else "All supplied rows include market-data as-of dates."
    )
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Comparable Companies Valuation Report</title>
  <style>
    :root {{ --navy:#14283d; --teal:#0c615f; --muted:#586879; --line:#dce3e8; --soft:#f4f7f8; --warn:#f6efe0; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; color:#152334; font:14px/1.5 Arial, Helvetica, sans-serif; background:#fff; }}
    main {{ max-width:1120px; margin:0 auto; padding:44px 44px 56px; }}
    .eyebrow {{ color:var(--muted); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }}
    h1 {{ color:var(--navy); font-size:36px; line-height:1.14; margin:12px 0 10px; letter-spacing:-.035em; }}
    h2 {{ color:var(--navy); font-size:20px; margin:34px 0 12px; padding-bottom:8px; border-bottom:1px solid var(--line); }}
    p {{ margin:0 0 12px; max-width:820px; }}
    .status {{ margin:26px 0; border-left:4px solid var(--teal); background:var(--soft); padding:16px 19px; }}
    .status strong {{ display:block; text-transform:uppercase; font-size:11px; color:var(--teal); letter-spacing:.1em; margin-bottom:5px; }}
    .grid {{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }}
    .card {{ border:1px solid var(--line); border-radius:5px; padding:16px 18px; }}
    .card strong {{ display:block; color:var(--muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; margin-bottom:7px; }}
    table {{ width:100%; border-collapse:collapse; font-size:13px; }}
    th {{ text-align:left; background:var(--soft); color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-size:11px; }}
    th, td {{ padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:top; }}
    .table-wrap {{ overflow-x:auto; border:1px solid var(--line); border-radius:5px; }}
    .flag {{ background:var(--warn); border-left:4px solid #a87d29; padding:14px 16px; margin-top:15px; }}
    .sources {{ color:var(--muted); font-size:12px; }}
    @media (max-width:720px) {{ main {{ padding:28px 18px; }} h1 {{ font-size:28px; }} .grid {{ grid-template-columns:1fr; }} }}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Investment Banking | Trading Comps</div>
    <h1>Comparable Companies Valuation Report</h1>
    <p>Preliminary peer-screen output built from supplied comparable-company data. This report supports initial valuation framing and does not constitute a fairness opinion or client-ready valuation conclusion.</p>
    <div class="status"><strong>Output Posture</strong>{_escape(status)}</div>
    <h2>Valuation Framework</h2>
    <div class="grid">
      <div class="card"><strong>Selected External Anchors</strong>Classify true comparable companies before selecting a valuation range. A target's own trading level is a baseline, not external peer evidence.</div>
      <div class="card"><strong>Strategic Premium Treatment</strong>Keep control or strategic premium scenarios separate from observed public-trading support unless transaction evidence supports inclusion.</div>
    </div>
    <h2>Peer Screening Table</h2>
    {_table(["Company", "Ticker", "Market Data As Of", "EV / Revenue", "EV / EBITDA", "P / E"], peer_rows)}
    <div class="flag">{_escape(date_flag)}</div>
    <h2>Summary Statistics</h2>
    {_table(["Metric", "Value"], stat_rows)}
    <h2>Review Priorities</h2>
    <p>Confirm peer economic comparability, current pricing, enterprise-value bridge items, denominator periods, share basis, accounting normalization, outlier treatment, and the support for any selected range before senior or client use.</p>
    <h2>Source And Calculation Basis</h2>
    <p class="sources">Source: user-supplied comps CSV copied to <code>support/source_comps.csv</code>. Multiples shown above are derived calculations from the supplied inputs; missing or non-meaningful denominators are shown as <code>N/M</code>.</p>
  </main>
</body>
</html>
"""
    path.write_text(document, encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--json-run-log", "--json", dest="json_run_log", action="store_true")
    parser.add_argument("--quiet-human-output", action="store_true")
    args = parser.parse_args()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader(args.input.open(newline="", encoding="utf-8")))
    if not rows:
        raise SystemExit("input CSV must contain at least one company row")
    scored = []
    numeric_ev_ebitda = []
    missing_as_of = []
    for row in rows:
        ev = num(row.get("enterprise_value") or row.get("ev"))
        revenue = num(row.get("revenue"))
        ebitda = num(row.get("ebitda"))
        net_income = num(row.get("net_income"))
        equity_value = num(row.get("equity_value")) or ev
        ev_rev = multiple(ev, revenue)
        ev_ebitda = multiple(ev, ebitda)
        pe = multiple(equity_value, net_income)
        if ev is not None and ebitda is not None and ebitda > 0:
            numeric_ev_ebitda.append(ev / ebitda)
        if not row.get("as_of_date"):
            missing_as_of.append(row.get("company") or row.get("ticker") or "row")
        scored.append(
            {
                **row,
                "EV_Revenue": ev_rev,
                "EV_EBITDA": ev_ebitda,
                "P_E": pe,
                "source_status": "missing as-of" if not row.get("as_of_date") else "dated",
            }
        )
    stats = [
        {
            "metric": "EV/EBITDA median",
            "value": f"{statistics.median(numeric_ev_ebitda):.1f}x" if numeric_ev_ebitda else "N/M",
        },
        {"metric": "Companies", "value": len(scored)},
        {"metric": "Rows missing as-of date", "value": len(missing_as_of)},
    ]
    support_copy = support_dir(out) / "source_comps.csv"
    support_copy.write_text(args.input.read_text(encoding="utf-8"), encoding="utf-8")
    workbook = out / "comps_workbook.xlsx"
    write_cover_first_workbook(
        workbook,
        [
            ["Comps Analysis"],
            ["First read", "Open the HTML report first; workbook is the companion workpaper."],
            ["Source posture", f"{len(missing_as_of)} rows missing as-of dates."],
        ],
        {
            "Peer_Set": dict_rows_to_sheet(scored),
            "Summary_Stats": dict_rows_to_sheet(stats),
            "Source_Confidence": dict_rows_to_sheet(
                [{"company": item, "issue": "missing as-of date"} for item in missing_as_of]
            ),
        },
    )
    report = write_standalone_report(
        out / "comps_analysis_report.html", scored, stats, missing_as_of
    )
    write_artifact_manifest(
        out,
        "comps-valuation",
        "html_report",
        report,
        companion_deliverables=[
            artifact_item(
                workbook, "companion_deliverable", "xlsx", "Comps workbook workpaper.", True, True
            )
        ],
        support_artifacts=[
            artifact_item(
                support_copy,
                "support_artifact",
                "csv",
                "Original comps CSV copied for audit/import.",
                False,
                True,
                "Source CSV is support material.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Comps require banker peer-set rationale and source-date review before senior use.",
            "missing_inputs": ["peer rationale", "source-date validation"]
            if missing_as_of
            else ["peer rationale"],
        },
    )
    summary = {
        "primary_human_deliverable": str(report),
        "companion_deliverable": str(workbook),
        "manifest": str(out / "manifest.json"),
    }
    if args.json_run_log:
        print(json.dumps(summary, indent=2))
    elif not args.quiet_human_output:
        print("Comps analysis report complete")
        print(f"Open first: {report}")
        print(f"Companion workbook: {workbook}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
