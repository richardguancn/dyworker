#!/usr/bin/env python3
"""Calculate covenant headroom from a CSV of covenant tests.

Input CSV required columns:
  covenant, period, test_type, actual, threshold

Optional columns:
  units, source, definition_basis, notes

`test_type` values:
  max_ratio     headroom = threshold - actual
  min_ratio     headroom = actual - threshold
  min_amount    headroom = actual - threshold
  max_amount    headroom = threshold - actual

Usage:
  python scripts/calculate_covenant_headroom.py covenant_tests.csv --outdir output/headroom
"""

from __future__ import annotations

import argparse
import csv
import sys
from html import escape
from pathlib import Path

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


def _write_headroom_summary(
    path: Path,
    rows: list[dict[str, str]],
    breach_count: int,
    tight_count: int,
    source_path: Path,
) -> None:
    table_rows = "".join(
        f"""<tr><td>{escape(row["covenant"])}</td><td>{escape(row["period"])}</td>
        <td>{escape(row["actual"])}</td><td>{escape(row["threshold"])}</td>
        <td>{escape(row["headroom"])}</td><td>{escape(row["cushion_pct"])}</td>
        <td class="status-{escape(row["status"])}">{escape(row["status"].replace("_", " ").title())}</td></tr>"""
        for row in rows
    )
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Covenant Headroom Summary</title>
  <style>
    :root {{ --paper:#faf8f3; --ink:#14221f; --forest:#18473c; --muted:#53635e; --rule:#dbd5ca; --red:#aa4936; --amber:#9b681c; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:var(--paper); color:var(--ink); font:15px/1.5 Arial, sans-serif; }}
    header, main, footer {{ max-width:1080px; margin:0 auto; padding-left:38px; padding-right:38px; }}
    header {{ padding-top:48px; padding-bottom:34px; border-bottom:1px solid var(--rule); }}
    .eyebrow {{ color:var(--forest); font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; }}
    h1 {{ margin:14px 0; font:normal 52px/1.1 Georgia, serif; }}
    .dek {{ max-width:780px; font-size:18px; color:var(--muted); }}
    main {{ padding-top:34px; padding-bottom:48px; }}
    .metrics {{ display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; margin-bottom:39px; }}
    .metric {{ border:1px solid var(--rule); background:#fffdf9; padding:18px; }}
    .metric span {{ display:block; color:var(--muted); font-size:10px; letter-spacing:.12em; text-transform:uppercase; font-weight:700; }}
    .metric strong {{ display:block; color:var(--forest); margin-top:7px; font:normal 32px Georgia, serif; }}
    h2 {{ margin:0 0 12px; font:normal 31px Georgia, serif; }}
    .caveat {{ margin:0 0 30px; padding:15px 18px; border-left:4px solid var(--amber); background:#f2eadb; color:#624817; }}
    table {{ width:100%; border-collapse:collapse; font-size:14px; }}
    th {{ background:var(--forest); color:white; padding:12px; text-align:left; text-transform:uppercase; letter-spacing:.07em; font-size:10.5px; }}
    td {{ border-bottom:1px solid var(--rule); padding:13px 12px; }}
    tbody tr:nth-child(even) {{ background:#f4f0e8; }}
    .status-breach {{ color:var(--red); font-weight:700; }}
    .status-at_threshold {{ color:var(--amber); font-weight:700; }}
    .status-pass {{ color:var(--forest); font-weight:700; }}
    .source {{ margin-top:23px; color:var(--muted); font-size:13px; }}
    footer {{ border-top:1px solid var(--rule); padding-top:20px; padding-bottom:32px; color:var(--muted); font-size:12px; }}
    @media (max-width:760px) {{ header, main, footer {{ padding-left:20px; padding-right:20px; }} .metrics {{ grid-template-columns:1fr; }} h1 {{ font-size:40px; }} table {{ display:block; overflow-x:auto; }} }}
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">Finance-Side Covenant Analysis | Supported Calculation Summary</div>
    <h1>Covenant Headroom Summary</h1>
    <p class="dek">A concise companion to the calculation workbook. Use the workbook as the first read for input, formula, and source review.</p>
  </header>
  <main>
    <div class="metrics">
      <div class="metric"><span>Tests calculated</span><strong>{len(rows)}</strong></div>
      <div class="metric"><span>Breaches</span><strong>{breach_count}</strong></div>
      <div class="metric"><span>Tight passes</span><strong>{tight_count}</strong></div>
    </div>
    <p class="caveat"><strong>Reliance gate:</strong> Calculated headroom must be reconciled to operative definitions, amendments or waivers, and applicable covenant certificates before decision use.</p>
    <section>
      <h2>Calculated tests</h2>
      <table>
        <thead><tr><th>Covenant</th><th>Period</th><th>Actual</th><th>Threshold</th><th>Headroom</th><th>Cushion</th><th>Status</th></tr></thead>
        <tbody>{table_rows}</tbody>
      </table>
      <p class="source">Calculation source: {escape(str(source_path))}. Backing calculation rows are retained as support data.</p>
    </section>
  </main>
  <footer>Prepared by covenant-package-analyzer. Finance-side analysis only; verify operative documentation and certificate support before reliance.</footer>
</body>
</html>
"""
    path.write_text(document, encoding="utf-8")


REQUIRED = {"covenant", "period", "test_type", "actual", "threshold"}
MAX_TYPES = {"max_ratio", "max_amount"}
MIN_TYPES = {"min_ratio", "min_amount"}


def to_float(value: str) -> float:
    text = str(value).strip().replace(",", "").replace("x", "").replace("%", "")
    if text == "":
        raise ValueError("blank numeric field")
    return float(text)


def status_from(headroom: float) -> str:
    if headroom < 0:
        return "breach"
    if headroom == 0:
        return "at_threshold"
    return "pass"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Calculate covenant headroom from covenant test CSV."
    )
    parser.add_argument("csv_path", help="Input covenant test CSV")
    parser.add_argument("--outdir", default="output/headroom", help="Output directory")
    args = parser.parse_args()

    path = Path(args.csv_path)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = set(reader.fieldnames or [])
        missing = REQUIRED - headers
        if missing:
            raise SystemExit(f"Missing required columns: {', '.join(sorted(missing))}")
        rows = list(reader)

    out_rows: list[dict[str, str]] = []
    for idx, row in enumerate(rows, start=1):
        test_type = row["test_type"].strip().lower()
        actual = to_float(row["actual"])
        threshold = to_float(row["threshold"])
        if test_type in MAX_TYPES:
            headroom = threshold - actual
        elif test_type in MIN_TYPES:
            headroom = actual - threshold
        else:
            raise SystemExit(f"Row {idx}: unsupported test_type '{row['test_type']}'")
        cushion_pct = (headroom / abs(threshold)) if threshold else 0.0
        status = status_from(headroom)
        out_rows.append(
            {
                "covenant": row["covenant"],
                "period": row["period"],
                "test_type": test_type,
                "actual": f"{actual:.6g}",
                "threshold": f"{threshold:.6g}",
                "headroom": f"{headroom:.6g}",
                "cushion_pct": f"{cushion_pct:.2%}",
                "status": status,
                "units": row.get("units", ""),
                "definition_basis": row.get("definition_basis", ""),
                "source": row.get("source", ""),
                "notes": row.get("notes", ""),
            }
        )

    csv_dir = support_dir(outdir)
    out_path = csv_dir / "covenant_headroom.csv"
    headers = [
        "covenant",
        "period",
        "test_type",
        "actual",
        "threshold",
        "headroom",
        "cushion_pct",
        "status",
        "units",
        "definition_basis",
        "source",
        "notes",
    ]
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(out_rows)

    breach_count = sum(1 for r in out_rows if r["status"] == "breach")
    tight_count = sum(
        1
        for r in out_rows
        if r["status"] != "breach"
        and abs(float(r["headroom"])) <= 0.1 * max(abs(float(r["threshold"])), 1.0)
    )
    workbook_path = outdir / "covenant_headroom.xlsx"
    write_cover_first_workbook(
        workbook_path,
        [
            ["Covenant Headroom"],
            ["Tests calculated", len(out_rows)],
            ["Breaches", breach_count],
            ["Tight passes", tight_count],
            ["First read", "Use this workbook first. CSV output is support/import material."],
        ],
        {
            "Headroom": dict_rows_to_sheet(out_rows, headers),
            "Sources": [
                ["source", "path"],
                ["input_csv", str(path)],
                ["support_csv", str(out_path)],
            ],
        },
    )
    report_path = outdir / "covenant_headroom_report.html"
    _write_headroom_summary(report_path, out_rows, breach_count, tight_count, path)
    write_artifact_manifest(
        outdir,
        "covenant-package-analyzer",
        "workbook",
        workbook_path,
        companion_deliverables=[
            artifact_item(
                report_path,
                "companion_deliverable",
                "html",
                "Standalone HTML covenant headroom summary.",
                True,
                True,
            )
        ],
        support_artifacts=[
            artifact_item(
                out_path,
                "support_artifact",
                "csv",
                "Raw covenant headroom rows.",
                False,
                True,
                "CSV is import/audit support; workbook is first read.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Headroom uses provided covenant definitions and must be reconciled to governing documents.",
            "missing_inputs": [
                "Operative covenant definitions",
                "Amendments/waivers",
                "Source covenant certificates",
            ],
        },
    )
    print(f"[OK] Wrote {workbook_path}, {report_path}, and support CSV {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
