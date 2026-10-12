#!/usr/bin/env python3
"""Create a comparable company analysis workbook template.

Usage:
    python create_comps_template.py --output comps_template.xlsx --target "ExampleCo" --ticker EXM
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

PEER_ROWS = 20
REQUIREMENTS_FILE = Path(__file__).resolve().parent / "requirements.txt"
SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPT_DIR.parents[2]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.model_artifacts import write_model_manifest  # noqa: E402
from shared.model_citations import write_model_citations_for_workbook  # noqa: E402

MANIFEST_NAME = "manifest.json"


def require_xlsxwriter():
    try:
        import xlsxwriter
    except ImportError:
        raise SystemExit(
            "Missing optional workbook dependency: XlsxWriter.\n"
            f"Install local script dependencies with: python3 -m pip install -r {REQUIREMENTS_FILE}\n"
            "Manual fallback: build the workbook shell from SKILL.md and "
            "references/model-workbook-spec.md, then state that automated template "
            "generation was not run."
        )
    return xlsxwriter


def write_title(ws, title: str) -> None:
    ws.write("A1", title)


def add_table(ws, row: int, col: int, headers: list[str], rows: int, header_fmt, body_fmt) -> None:
    for idx, header in enumerate(headers):
        ws.write(row, col + idx, header, header_fmt)
    for r in range(row + 1, row + rows + 1):
        for c in range(col, col + len(headers)):
            ws.write_blank(r, c, None, body_fmt)
    ws.autofilter(row, col, row + rows, col + len(headers) - 1)
    ws.freeze_panes(row + 1, 0)


def create_workbook(
    output: Path, target: str, ticker: str, currency: str, valuation_date: str
) -> None:
    xlsxwriter = require_xlsxwriter()
    output.parent.mkdir(parents=True, exist_ok=True)
    wb = xlsxwriter.Workbook(str(output))
    title_fmt = wb.add_format({"bold": True, "font_size": 16})
    header_fmt = wb.add_format(
        {
            "bold": True,
            "font_color": "white",
            "bg_color": "#1F4E78",
            "border": 1,
            "text_wrap": True,
            "align": "center",
        }
    )
    subheader_fmt = wb.add_format({"bold": True, "bg_color": "#D9EAF7", "border": 1})
    body_fmt = wb.add_format({"border": 1, "text_wrap": True, "valign": "top"})
    input_fmt = wb.add_format(
        {"bg_color": "#FFF2CC", "border": 1, "text_wrap": True, "valign": "top"}
    )
    formula_fmt = wb.add_format(
        {"bg_color": "#DDEBF7", "border": 1, "text_wrap": True, "valign": "top"}
    )
    output_fmt = wb.add_format(
        {"bg_color": "#E2F0D9", "border": 1, "text_wrap": True, "valign": "top"}
    )

    # Executive Summary
    ws = wb.add_worksheet("Executive Summary")
    ws.hide_gridlines(2)
    ws.write("A1", "Comparable Company Analysis Model", title_fmt)
    summary_rows = [
        ("Transaction / company", target),
        ("Ticker", ticker),
        ("As-of / valuation date", valuation_date),
        (
            "Currency / units",
            f"{currency}; USD millions except per-share data unless changed in Control.",
        ),
        (
            "Decision question",
            "What valuation range is implied by the selected public peer set and multiples?",
        ),
        (
            "Recommendation / readiness",
            "Template-ready; populate source data, peer rationale, valuation inputs, and QA before decision use.",
        ),
        (
            "Source / caveat status",
            "No sourced data loaded. Replace placeholders with filing, market-data, provider, or user-provided sources.",
        ),
    ]
    for r, (label, value) in enumerate(summary_rows, 2):
        ws.write(r, 0, label, subheader_fmt)
        ws.write(r, 1, value, body_fmt)
    ws.write("A11", "Key valuation metrics", subheader_fmt)
    metric_headers = ["Metric", "Output", "Source / link", "Status"]
    for c, header in enumerate(metric_headers):
        ws.write(11, c, header, header_fmt)
    metric_rows = [
        ("Selected multiple", "=Valuation!B3", "Valuation!B3", "Needs input"),
        (
            "Low / mid / high multiple",
            '=TEXTJOIN(" / ",TRUE,Valuation!B4:Valuation!B6)',
            "Valuation!B4:B6",
            "Needs input",
        ),
        ("Target metric", "=Valuation!B7", "Valuation!B7", "Needs source"),
        ("Implied value per share", "=Valuation!H14", "Valuation!H13:H15", "Needs QA"),
    ]
    for r, row in enumerate(metric_rows, 12):
        for c, value in enumerate(row):
            if isinstance(value, str) and value.startswith("="):
                ws.write_formula(r, c, value, formula_fmt)
            else:
                ws.write(r, c, value, body_fmt if c != 3 else input_fmt)
    ws.write("A18", "Top sensitivities and breakpoints", subheader_fmt)
    ws.write(
        "A19",
        "Use Sensitivity to test selected multiple vs target metric; document the breakpoint that changes the recommendation.",
        body_fmt,
    )
    ws.write("A21", "Key risks and open diligence", subheader_fmt)
    risks = [
        "Peer set not yet sourced or tiered.",
        "Market data, financials, and estimates not yet loaded.",
        "Denominator distortions, outliers, and source confidence not yet reviewed.",
    ]
    for r, risk in enumerate(risks, 22):
        ws.write(r, 0, risk, body_fmt)
    ws.write("A27", "Next steps", subheader_fmt)
    next_steps = [
        "Populate Control, Universe, Market_Data, Financials, and Sources.",
        "Review Multiples, Benchmarking, Valuation, and Sensitivity.",
        "Run QA_Log checks and cite source tabs/ranges in any companion HTML report.",
    ]
    for r, step in enumerate(next_steps, 28):
        ws.write(r, 0, step, body_fmt)
    ws.write("D18", "Model map", subheader_fmt)
    model_map = [
        ("Control", "Inputs and model setup"),
        ("Universe", "Peer set, inclusion/exclusion rationale"),
        ("Market_Data / Financials", "Source data and denominators"),
        ("Multiples / Benchmarking", "Core trading comps and premium/discount rationale"),
        ("Valuation / Sensitivity", "Selected range, implied value, and sensitivities"),
        ("Sources / QA_Log", "Citation ledger and model checks"),
    ]
    for r, (tab, purpose) in enumerate(model_map, 19):
        ws.write(r, 3, tab, subheader_fmt)
        ws.write(r, 4, purpose, body_fmt)
    ws.set_column("A:A", 28)
    ws.set_column("B:B", 46)
    ws.set_column("C:C", 24)
    ws.set_column("D:D", 24)
    ws.set_column("E:E", 58)

    # Control
    ws = wb.add_worksheet("Control")
    ws.hide_gridlines(2)
    ws.write("A1", "Control Panel", title_fmt)
    controls = [
        ("Target company", target),
        ("Target ticker", ticker),
        ("Valuation date", valuation_date),
        ("Reporting currency", currency),
        ("Units", "USD millions except per-share data"),
        ("Fiscal basis", "Calendarized"),
        ("Primary use case", "Price target / valuation range"),
        ("Selected peer tier", "Core"),
        ("Model status", "Draft"),
    ]
    for r, (label, value) in enumerate(controls, 2):
        ws.write(r, 0, label, subheader_fmt)
        ws.write(r, 1, value, input_fmt)
        ws.write_comment(r, 1, "Input cell: update or link to a clearly sourced assumption.")
    ws.set_column("A:A", 28)
    ws.set_column("B:B", 44)

    # Universe
    ws = wb.add_worksheet("Universe")
    ws.hide_gridlines(2)
    headers = [
        "Ticker",
        "Company",
        "Peer Tier",
        "Country",
        "Business Description",
        "Revenue Mix / Segment Notes",
        "Geography / End Market",
        "Size Fit",
        "Growth Fit",
        "Margin Fit",
        "Inclusion Rationale",
        "Exclusion Rationale",
        "Data Confidence",
        "Analyst Notes",
    ]
    add_table(ws, 0, 0, headers, PEER_ROWS, header_fmt, body_fmt)
    ws.write_row(
        1,
        0,
        [ticker, target, "Target", "", "", "", "", "", "", "", "Subject company", "", "", ""],
        input_fmt,
    )
    ws.set_column("A:A", 12)
    ws.set_column("B:B", 26)
    ws.set_column("C:C", 16)
    ws.set_column("E:N", 28)

    # Market_Data
    ws = wb.add_worksheet("Market_Data")
    ws.hide_gridlines(2)
    headers = [
        "Ticker",
        "Company",
        "Peer Tier",
        "Price",
        "Basic Shares",
        "Dilution Adj.",
        "Diluted Shares",
        "Equity Value",
        "Debt",
        "Preferred",
        "Minority Interest",
        "Cash & Equiv.",
        "Other Non-op Assets",
        "Enterprise Value",
        "Market Data Date",
        "Source",
        "Confidence",
        "Notes",
    ]
    add_table(ws, 0, 0, headers, PEER_ROWS, header_fmt, body_fmt)
    for r in range(1, PEER_ROWS + 1):
        excel_row = r + 1
        ws.write_formula(r, 0, f"=Universe!A{excel_row}", formula_fmt)
        ws.write_formula(r, 1, f"=Universe!B{excel_row}", formula_fmt)
        ws.write_formula(r, 2, f"=Universe!C{excel_row}", formula_fmt)
        ws.write_formula(r, 6, f'=IFERROR(E{excel_row}+F{excel_row},"")', formula_fmt)
        ws.write_formula(r, 7, f'=IFERROR(D{excel_row}*G{excel_row},"")', formula_fmt)
        ws.write_formula(
            r,
            13,
            f'=IFERROR(H{excel_row}+I{excel_row}+J{excel_row}+K{excel_row}-L{excel_row}-M{excel_row},"")',
            formula_fmt,
        )
    ws.set_column("A:R", 16)
    ws.set_column("B:B", 26)
    ws.set_column("R:R", 34)

    # Financials
    ws = wb.add_worksheet("Financials")
    ws.hide_gridlines(2)
    headers = [
        "Ticker",
        "Company",
        "Peer Tier",
        "LTM Revenue",
        "CY1 Revenue",
        "CY2 Revenue",
        "LTM EBITDA",
        "CY1 EBITDA",
        "CY2 EBITDA",
        "LTM EBIT",
        "CY1 EBIT",
        "CY2 EBIT",
        "LTM Net Income",
        "CY1 EPS",
        "CY2 EPS",
        "LTM FCF",
        "CY1 FCF",
        "Revenue Growth CY1",
        "Revenue Growth CY2",
        "EBITDA Margin LTM",
        "EBITDA Margin CY1",
        "FCF Margin CY1",
        "Source",
        "Confidence",
        "Notes",
    ]
    add_table(ws, 0, 0, headers, PEER_ROWS, header_fmt, body_fmt)
    for r in range(1, PEER_ROWS + 1):
        excel_row = r + 1
        ws.write_formula(r, 0, f"=Universe!A{excel_row}", formula_fmt)
        ws.write_formula(r, 1, f"=Universe!B{excel_row}", formula_fmt)
        ws.write_formula(r, 2, f"=Universe!C{excel_row}", formula_fmt)
        ws.write_formula(r, 17, f'=IFERROR(E{excel_row}/D{excel_row}-1,"NM")', formula_fmt)
        ws.write_formula(r, 18, f'=IFERROR(F{excel_row}/E{excel_row}-1,"NM")', formula_fmt)
        ws.write_formula(r, 19, f'=IFERROR(G{excel_row}/D{excel_row},"NM")', formula_fmt)
        ws.write_formula(r, 20, f'=IFERROR(H{excel_row}/E{excel_row},"NM")', formula_fmt)
        ws.write_formula(r, 21, f'=IFERROR(Q{excel_row}/E{excel_row},"NM")', formula_fmt)
    ws.set_column("A:Y", 16)
    ws.set_column("B:B", 26)
    ws.set_column("Y:Y", 34)

    # Adjustments
    ws = wb.add_worksheet("Adjustments")
    ws.hide_gridlines(2)
    headers = [
        "Ticker",
        "Company",
        "Period",
        "Adjustment Type",
        "Reported Metric",
        "Reported Value",
        "Adjustment",
        "Normalized Value",
        "Rationale",
        "Source",
        "Confidence",
        "Notes",
    ]
    add_table(ws, 0, 0, headers, PEER_ROWS, header_fmt, body_fmt)
    ws.set_column("A:L", 18)
    ws.set_column("I:I", 40)
    ws.set_column("L:L", 34)

    # Multiples
    ws = wb.add_worksheet("Multiples")
    ws.hide_gridlines(2)
    headers = [
        "Ticker",
        "Company",
        "Peer Tier",
        "EV",
        "EV / LTM Rev",
        "EV / CY1 Rev",
        "EV / CY2 Rev",
        "EV / LTM EBITDA",
        "EV / CY1 EBITDA",
        "EV / CY2 EBITDA",
        "EV / LTM EBIT",
        "EV / CY1 EBIT",
        "P / CY1 EPS",
        "P / CY2 EPS",
        "FCF Yield CY1",
        "Rule of 40 / Sector KPI",
        "Outlier Flag",
        "Notes",
    ]
    add_table(ws, 0, 0, headers, PEER_ROWS, header_fmt, body_fmt)
    for r in range(1, PEER_ROWS + 1):
        excel_row = r + 1
        ws.write_formula(r, 0, f"=Universe!A{excel_row}", formula_fmt)
        ws.write_formula(r, 1, f"=Universe!B{excel_row}", formula_fmt)
        ws.write_formula(r, 2, f"=Universe!C{excel_row}", formula_fmt)
        ws.write_formula(r, 3, f"=Market_Data!N{excel_row}", formula_fmt)
        formulas = [
            f'=IFERROR(IF(Financials!D{excel_row}>0,D{excel_row}/Financials!D{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!E{excel_row}>0,D{excel_row}/Financials!E{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!F{excel_row}>0,D{excel_row}/Financials!F{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!G{excel_row}>0,D{excel_row}/Financials!G{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!H{excel_row}>0,D{excel_row}/Financials!H{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!I{excel_row}>0,D{excel_row}/Financials!I{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!J{excel_row}>0,D{excel_row}/Financials!J{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!K{excel_row}>0,D{excel_row}/Financials!K{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!N{excel_row}>0,Market_Data!D{excel_row}/Financials!N{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!O{excel_row}>0,Market_Data!D{excel_row}/Financials!O{excel_row},"NM"),"NM")',
            f'=IFERROR(IF(Financials!Q{excel_row}>0,Financials!Q{excel_row}/Market_Data!H{excel_row},"NM"),"NM")',
            f'=IFERROR(Financials!R{excel_row}+Financials!V{excel_row},"")',
        ]
        for c, formula in enumerate(formulas, 4):
            ws.write_formula(r, c, formula, formula_fmt)
    stats_row = PEER_ROWS + 3
    ws.write(stats_row, 0, "Peer Statistics", subheader_fmt)
    labels = ["All Peer Median", "Core Peer Median", "25th Percentile", "75th Percentile"]
    for idx, label in enumerate(labels, stats_row + 1):
        ws.write(idx, 0, label, subheader_fmt)
    ws.set_column("A:R", 16)
    ws.set_column("B:B", 26)
    ws.set_column("R:R", 34)

    # Benchmarking
    ws = wb.add_worksheet("Benchmarking")
    ws.hide_gridlines(2)
    headers = [
        "Ticker",
        "Company",
        "Peer Tier",
        "Revenue Growth",
        "EBITDA Margin",
        "FCF Margin",
        "Leverage",
        "ROIC / Quality KPI",
        "Business Quality Notes",
        "Premium / Discount Rationale",
    ]
    add_table(ws, 0, 0, headers, PEER_ROWS, header_fmt, body_fmt)
    for r in range(1, PEER_ROWS + 1):
        excel_row = r + 1
        ws.write_formula(r, 0, f"=Universe!A{excel_row}", formula_fmt)
        ws.write_formula(r, 1, f"=Universe!B{excel_row}", formula_fmt)
        ws.write_formula(r, 2, f"=Universe!C{excel_row}", formula_fmt)
        ws.write_formula(r, 3, f"=Financials!R{excel_row}", formula_fmt)
        ws.write_formula(r, 4, f"=Financials!U{excel_row}", formula_fmt)
        ws.write_formula(r, 5, f"=Financials!V{excel_row}", formula_fmt)
    ws.set_column("A:J", 18)
    ws.set_column("I:J", 42)

    # Valuation
    ws = wb.add_worksheet("Valuation")
    ws.hide_gridlines(2)
    ws.write("A1", "Valuation Conclusion", title_fmt)
    vals = [
        ("Selected multiple", "EV / CY1 Revenue"),
        ("Low multiple", ""),
        ("Mid multiple", ""),
        ("High multiple", ""),
        ("Target financial metric", ""),
        ("Net debt / (cash)", ""),
        ("Diluted shares", ""),
    ]
    for r, (label, value) in enumerate(vals, 2):
        ws.write(r, 0, label, subheader_fmt)
        ws.write(r, 1, value, input_fmt)
        ws.write_comment(
            r,
            1,
            "Valuation input: support with peer evidence, source data, or documented judgment.",
        )
    headers = [
        "Case",
        "Selected Multiple",
        "Target Metric",
        "Implied EV",
        "Net Debt",
        "Implied Equity Value",
        "Diluted Shares",
        "Implied Value / Share",
    ]
    for c, h in enumerate(headers):
        ws.write(11, c, h, header_fmt)
    cases = [("Low", "=B4"), ("Mid", "=B5"), ("High", "=B6")]
    for i, (case, mult_formula) in enumerate(cases, 12):
        excel_row = i + 1
        ws.write(i, 0, case, output_fmt)
        ws.write_formula(i, 1, mult_formula, formula_fmt)
        ws.write_formula(i, 2, "=B7", formula_fmt)
        ws.write_formula(i, 3, f'=IFERROR(B{excel_row}*C{excel_row},"")', formula_fmt)
        ws.write_formula(i, 4, "=B8", formula_fmt)
        ws.write_formula(i, 5, f'=IFERROR(D{excel_row}-E{excel_row},"")', formula_fmt)
        ws.write_formula(i, 6, "=B9", formula_fmt)
        ws.write_formula(i, 7, f'=IFERROR(F{excel_row}/G{excel_row},"")', formula_fmt)
    ws.write("A18", "Executive conclusion", subheader_fmt)
    ws.write(
        "A19", "State selected range, key rationale, confidence level, and major risks.", body_fmt
    )
    ws.set_column("A:H", 22)

    # Sensitivity
    ws = wb.add_worksheet("Sensitivity")
    ws.hide_gridlines(2)
    ws.write("A1", "Sensitivity Analysis", title_fmt)
    ws.write("A3", "Multiple vs Target Metric", subheader_fmt)
    metrics = ["Metric -10%", "Metric -5%", "Base Metric", "Metric +5%", "Metric +10%"]
    multiples = ["Low - 0.5x", "Low", "Mid", "High", "High + 0.5x"]
    for c, label in enumerate(metrics, 1):
        ws.write(3, c, label, header_fmt)
    for r, label in enumerate(multiples, 4):
        ws.write(r, 0, label, header_fmt)
        for c in range(1, 6):
            ws.write_formula(r, c, "=NA()", formula_fmt)
    ws.set_column("A:F", 18)

    # Sources
    ws = wb.add_worksheet("Sources")
    ws.hide_gridlines(2)
    headers = [
        "Company/Ticker",
        "Metric",
        "Period",
        "Source Name",
        "Connector Path / URL / Accession",
        "Retrieval Date",
        "Data Date",
        "Source Type",
        "Confidence",
        "Definition Notes",
    ]
    add_table(ws, 0, 0, headers, PEER_ROWS * 2, header_fmt, body_fmt)
    ws.set_column("A:J", 20)
    ws.set_column("E:E", 48)
    ws.set_column("J:J", 42)

    # QA_Log
    ws = wb.add_worksheet("QA_Log")
    ws.hide_gridlines(2)
    headers = ["Check", "Status", "Finding", "Fix / Action", "Owner", "Date", "Notes"]
    add_table(ws, 0, 0, headers, 30, header_fmt, body_fmt)
    checks = [
        "Workbook structure",
        "Source log complete",
        "Formula consistency",
        "Broken formula/errors",
        "External links",
        "Peer rationale",
        "Denominator treatment",
        "Market data freshness",
        "Normalization documented",
        "Valuation range rationale",
    ]
    for r, check in enumerate(checks, 1):
        ws.write(r, 0, check, body_fmt)
        ws.write(r, 1, "Not run", input_fmt)
    ws.set_column("A:G", 24)
    ws.set_column("C:D", 44)

    wb.close()


def write_output_manifest(
    output: Path, target: str, ticker: str, currency: str, valuation_date: str
) -> dict:
    support_paths = []
    if (output.parent / "model_citations.json").exists():
        support_paths.append(
            (
                output.parent / "model_citations.json",
                "workbook cell/range citation ledger for comps workbook template",
            )
        )
    return write_model_manifest(
        output.parent,
        "comps-valuation",
        "comps_template_workbook",
        output,
        "template-ready",
        support_paths,
        [],
        [],
        extra={
            "inputs": {
                "target": target,
                "ticker": ticker,
                "currency": currency,
                "valuation_date": valuation_date,
            }
        },
    )
    manifest_path = output.parent / MANIFEST_NAME
    manifest = {
        "manifest_version": "1.0",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "skill": "comps-valuation",
        "artifact_mode": "comps_template_workbook",
        "model_status": "template-ready",
        "output_dir": str(output.parent),
        "primary_human_deliverable": str(output),
        "human_deliverables": [
            {
                "path": str(output),
                "role": "human_deliverable",
                "description": "comparable company analysis workbook template",
                "exists": output.exists(),
            }
        ],
        "agent_artifacts": [
            {
                "path": str(manifest_path),
                "role": "agent_artifact",
                "description": "agent-facing output manifest",
                "exists": True,
            }
        ],
        "inputs": {
            "target": target,
            "ticker": ticker,
            "currency": currency,
            "valuation_date": valuation_date,
        },
        "hard_failure_count": 0,
        "warning_count": 0,
        "discipline_note": "Use the workbook as the main deliverable; manifest is an agent-facing support artifact.",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a comparable company analysis workbook template."
    )
    parser.add_argument(
        "--output", default="comps_analysis_template.xlsx", help="Output .xlsx path."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for workbook and manifest. If provided, --output is treated as a file name inside this directory.",
    )
    parser.add_argument("--target", default="TargetCo", help="Target company name.")
    parser.add_argument("--ticker", default="TGT", help="Target company ticker.")
    parser.add_argument("--currency", default="USD", help="Model currency.")
    parser.add_argument(
        "--valuation-date", default=date.today().isoformat(), help="Valuation date YYYY-MM-DD."
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_name = Path(args.output).name if args.output_dir else args.output
    output = ((args.output_dir / output_name) if args.output_dir else Path(output_name)).resolve()
    create_workbook(output, args.target, args.ticker, args.currency, args.valuation_date)
    write_model_citations_for_workbook(output.parent / "model_citations.json", output)
    write_output_manifest(output, args.target, args.ticker, args.currency, args.valuation_date)
    print(f"Created comps workbook template: {output}")
    print(f"Created manifest: {output.parent / MANIFEST_NAME}")


if __name__ == "__main__":
    main()
