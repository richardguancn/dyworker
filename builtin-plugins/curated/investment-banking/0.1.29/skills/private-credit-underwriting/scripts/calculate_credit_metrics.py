#!/usr/bin/env python3
"""
First-pass private credit metrics calculator.

Inputs:
  --financials borrower_financials.csv
  --terms debt_terms.json (optional)
  --outdir credit_out

The script is intentionally conservative. It computes ratios only from fields that
are present, emits N/M when denominators are missing or zero, and writes warnings
for missing data or covenant limitations. It does not replace credit judgment.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from html import escape
from pathlib import Path
from typing import Any, Iterable

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    build_minimal_handoff_payload,
    dict_rows_to_sheet,
    handoff_artifact_item,
    support_dir,
    write_artifact_manifest,
    write_cover_first_workbook,
    write_handoff_payload,
)


def _markdown_table_cell(value: Any) -> str:
    return (
        str(value).replace("\\", "\\\\").replace("|", r"\|").replace("\r", " ").replace("\n", " ")
    )


def _has_unescaped_trailing_pipe(value: str) -> bool:
    if not value.endswith("|"):
        return False
    preceding_backslashes = len(value[:-1]) - len(value[:-1].rstrip("\\"))
    return preceding_backslashes % 2 == 0


def _split_table_row(line: str) -> list[str]:
    content = line.strip()
    if content.startswith("|"):
        content = content[1:]
    if _has_unescaped_trailing_pipe(content):
        content = content[:-1]

    cells: list[str] = []
    cell: list[str] = []
    index = 0
    while index < len(content):
        char = content[index]
        if char == "\\" and index + 1 < len(content) and content[index + 1] in {"\\", "|"}:
            cell.append(content[index + 1])
            index += 2
            continue
        if char == "|":
            cells.append("".join(cell).strip())
            cell = []
        else:
            cell.append(char)
        index += 1
    cells.append("".join(cell).strip())
    return cells


def _table_cells(line: str) -> list[str]:
    return [escape(cell) for cell in _split_table_row(line)]


def _is_table_divider(line: str) -> bool:
    cells = _split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def _render_markdown_report(markdown_text: str) -> str:
    lines = markdown_text.splitlines()
    blocks: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line.startswith("## "):
            blocks.append(f"<h2>{escape(line[3:])}</h2>")
            index += 1
            continue
        if line.startswith("# "):
            blocks.append(f"<h1>{escape(line[2:])}</h1>")
            index += 1
            continue
        if line.startswith("- "):
            items: list[str] = []
            while index < len(lines) and lines[index].strip().startswith("- "):
                items.append(f"<li>{escape(lines[index].strip()[2:])}</li>")
                index += 1
            blocks.append(f"<ul>{''.join(items)}</ul>")
            continue
        if line.startswith("|"):
            rows: list[list[str]] = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                candidate = lines[index].strip()
                if not _is_table_divider(candidate):
                    rows.append(_table_cells(candidate))
                index += 1
            if rows:
                header, *body = rows
                head = "".join(f"<th>{cell}</th>" for cell in header)
                body_html = "".join(
                    f"<tr>{''.join(f'<td>{cell}</td>' for cell in row)}</tr>" for row in body
                )
                blocks.append(
                    f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead>'
                    f"<tbody>{body_html}</tbody></table></div>"
                )
            continue
        if line.startswith("_") and line.endswith("_"):
            blocks.append(f'<p class="footnote"><em>{escape(line[1:-1])}</em></p>')
            index += 1
            continue
        blocks.append(f"<p>{escape(line)}</p>")
        index += 1
    return "\n".join(blocks)


def _write_html_report(path: Path, title: str, markdown_text: str) -> None:
    report_html = _render_markdown_report(markdown_text)
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <style>
    body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f6f8; color: #111827; }}
    .topbar {{ position: sticky; top: 0; z-index: 10; background: #050505; color: #fff; padding: 18px 28px; }}
    .topbar h1 {{ margin: 0; font-size: clamp(1.2rem, 2vw, 1.8rem); }}
    .topbar p {{ margin: 6px 0 0; color: #d1d5db; }}
    main {{ max-width: 1120px; margin: 0 auto; padding: 28px; }}
    .report-card {{ background: #fff; border: 1px solid #d7dae0; border-radius: 10px; padding: 26px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08); }}
    h1, h2 {{ color: #111827; }}
    h1 {{ margin: 0 0 16px; font-size: 1.55rem; }}
    h2 {{ margin: 28px 0 10px; padding-bottom: 7px; border-bottom: 2px solid #e5e7eb; font-size: 1.16rem; }}
    p, li {{ color: #374151; line-height: 1.55; }}
    ul {{ margin: 0 0 14px; padding-left: 20px; }}
    .table-wrap {{ overflow-x: auto; margin: 10px 0 20px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.9rem; }}
    th {{ background: #111827; color: #fff; padding: 10px 12px; text-align: left; }}
    td {{ border-bottom: 1px solid #e5e7eb; padding: 10px 12px; vertical-align: top; }}
    tbody tr:nth-child(even) {{ background: #f9fafb; }}
    .footnote {{ margin-top: 24px; color: #4b5563; font-size: 0.88rem; }}
    @media (max-width: 720px) {{ main {{ padding: 16px; }} .report-card {{ padding: 18px; border-radius: 8px; }} }}
    @media print {{ .topbar {{ position: static; }} body {{ background: #fff; }} main {{ max-width: none; padding: 0; }} .report-card {{ box-shadow: none; border: 0; }} }}
  </style>
</head>
<body>
  <header class="topbar"><h1>{escape(title)}</h1><p>Reader-facing HTML report. Backing CSV/JSON files are support artifacts.</p></header>
  <main><section class="report-card">{report_html}</section></main>
</body>
</html>
"""
    path.write_text(html, encoding="utf-8")


ALIASES = {
    "period": ["period", "date", "month", "quarter", "fiscal_period"],
    "revenue": ["revenue", "sales", "net_sales", "total_revenue"],
    "ebitda": ["ebitda", "reported_ebitda"],
    "adjusted_ebitda": ["adjusted_ebitda", "adj_ebitda", "company_adjusted_ebitda"],
    "normalized_ebitda": ["normalized_ebitda", "normalised_ebitda", "qoe_ebitda"],
    "lender_ebitda": ["lender_ebitda", "lender_after_haircut_ebitda", "credit_ebitda"],
    "cash": ["cash", "unrestricted_cash", "cash_balance"],
    "total_debt": ["total_debt", "debt", "gross_debt"],
    "senior_debt": ["senior_debt", "senior_secured_debt", "first_lien_debt"],
    "net_debt": ["net_debt"],
    "cash_interest": ["cash_interest", "interest_expense", "cash_interest_expense"],
    "capex": ["capex", "capital_expenditures", "maintenance_capex"],
    "cash_taxes": ["cash_taxes", "taxes", "cash_tax"],
    "change_nwc": ["change_nwc", "working_capital_change", "change_in_working_capital"],
    "free_cash_flow": ["free_cash_flow", "fcf", "levered_fcf"],
    "required_repayment": [
        "required_repayment",
        "amortization",
        "scheduled_amortization",
        "debt_service_principal",
    ],
    "revolver_availability": [
        "revolver_availability",
        "undrawn_revolver",
        "availability",
        "borrowing_base_availability",
    ],
    "minimum_liquidity": ["minimum_liquidity", "min_liquidity", "liquidity_covenant"],
}

FALSEY_SUPPORT_VALUES = {
    "",
    "0",
    "false",
    "f",
    "no",
    "n",
    "none",
    "null",
    "n/a",
    "na",
    "unsupported",
    "not supported",
}
UNSUPPORTED_TEXT_MARKERS = {
    "unsupported",
    "not supported",
    "no support",
    "not sourced",
    "unsourced",
}


def normalize_header(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.strip().lower()).strip("_")


def parse_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)
    s = str(value).strip()
    if s == "" or s.lower() in {"n/a", "na", "nm", "n/m", "none", "null", "-"}:
        return None
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1]
    multiplier = 1.0
    if re.search(r"[kmb]$", s.lower()):
        suffix = s[-1].lower()
        s = s[:-1]
        multiplier = {"k": 1_000.0, "m": 1_000_000.0, "b": 1_000_000_000.0}[suffix]
    s = s.replace("$", "").replace(",", "").replace("%", "")
    try:
        out = float(s) * multiplier
        return -out if neg else out
    except ValueError:
        return None


def fmt(value: float | None, decimals: int = 1, suffix: str = "") -> str:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "N/M"
    return f"{value:,.{decimals}f}{suffix}"


def safe_div(num: float | None, den: float | None) -> float | None:
    if num is None or den is None or abs(den) < 1e-12:
        return None
    return num / den


def load_csv(path: Path) -> tuple[list[dict[str, str]], dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("financials csv has no header row")
        header_map = {normalize_header(h): h for h in reader.fieldnames}
        rows = list(reader)
    return rows, header_map


def get_field(row: dict[str, str], header_map: dict[str, str], canonical: str) -> float | None:
    for alias in ALIASES.get(canonical, [canonical]):
        key = normalize_header(alias)
        if key in header_map:
            return parse_number(row.get(header_map[key]))
    return None


def get_text(row: dict[str, str], header_map: dict[str, str], canonical: str) -> str:
    for alias in ALIASES.get(canonical, [canonical]):
        key = normalize_header(alias)
        if key in header_map:
            return str(row.get(header_map[key], "")).strip()
    return ""


def last_nonempty(rows: list[dict[str, str]], header_map: dict[str, str]) -> dict[str, str]:
    if not rows:
        raise ValueError("financials csv has no data rows")
    return rows[-1]


def load_terms(path: Path | None) -> dict[str, Any]:
    if not path:
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def number_from_terms(terms: dict[str, Any], keys: Iterable[str]) -> float | None:
    for key in keys:
        if key in terms:
            return parse_number(terms.get(key))
    return None


def value_or_terms(value: float | None, terms: dict[str, Any], keys: Iterable[str]) -> float | None:
    if value is not None:
        return value
    return number_from_terms(terms, keys)


def row_text(row: dict[str, str], header_map: dict[str, str], normalized_header: str) -> str:
    if normalized_header not in header_map:
        return ""
    return str(row.get(header_map[normalized_header], "")).strip()


def has_supporting_text(value: str) -> bool:
    text = value.strip().lower()
    if text in FALSEY_SUPPORT_VALUES:
        return False
    return not any(marker in text for marker in UNSUPPORTED_TEXT_MARKERS)


def lender_ebitda_supported(row: dict[str, str], header_map: dict[str, str]) -> bool:
    support_tokens = ("support", "source", "evidence", "flag", "basis", "definition")
    lender_tokens = ("lender_ebitda", "credit_ebitda", "lender_after_haircut_ebitda")
    lender_support_headers = {
        "lender_source",
        "lender_support",
        "lender_supported",
        "lender_evidence",
        "lender_flag",
        "credit_source",
        "credit_support",
        "credit_supported",
        "credit_evidence",
        "credit_flag",
    }
    for normalized_header in header_map:
        has_lender_context = (
            any(token in normalized_header for token in lender_tokens)
            or (
                ("lender" in normalized_header or "credit" in normalized_header)
                and "ebitda" in normalized_header
            )
            or normalized_header in lender_support_headers
        )
        has_support_context = any(token in normalized_header for token in support_tokens)
        if not has_support_context:
            continue
        if not has_lender_context:
            continue
        if has_supporting_text(row_text(row, header_map, normalized_header)):
            return True
    return False


def choose_ebitda(row: dict[str, str], header_map: dict[str, str]) -> tuple[float | None, str, str]:
    unsupported_lender = False
    lender_value = get_field(row, header_map, "lender_ebitda")
    if lender_value is not None:
        if lender_ebitda_supported(row, header_map):
            return lender_value, "lender EBITDA", ""
        unsupported_lender = True

    for field, label in [
        ("normalized_ebitda", "normalized EBITDA"),
        ("adjusted_ebitda", "adjusted EBITDA"),
        ("ebitda", "reported EBITDA"),
    ]:
        val = get_field(row, header_map, field)
        if val is not None:
            note = (
                "Lender EBITDA present but unsupported; selected next available EBITDA basis."
                if unsupported_lender
                else ""
            )
            return val, label, note
    note = (
        "Lender EBITDA present but unsupported; no supported fallback EBITDA basis found."
        if unsupported_lender
        else ""
    )
    return None, "missing EBITDA", note


def covenant_actual(cov: dict[str, Any], metrics: dict[str, float | None]) -> float | None:
    ctype = str(cov.get("type", "")).lower()
    name = str(cov.get("name", "")).lower()
    if "leverage" in ctype or "leverage" in name:
        if "senior" in ctype or "senior" in name:
            return metrics.get("senior_leverage")
        if "net" in ctype or "net" in name:
            return metrics.get("net_leverage")
        return metrics.get("gross_leverage")
    if "interest" in ctype or "interest" in name:
        return metrics.get("interest_coverage")
    if "fixed" in ctype or "fccr" in ctype or "fixed" in name or "fccr" in name:
        return metrics.get("fixed_charge_coverage")
    if "liquidity" in ctype or "liquidity" in name:
        return metrics.get("liquidity")
    return None


def covenant_headroom(
    cov: dict[str, Any], actual: float | None
) -> tuple[str, float | None, float | None]:
    threshold = parse_number(cov.get("threshold"))
    if actual is None or threshold is None:
        return "N/M", None, None
    operator = str(cov.get("operator", "")).strip() or (
        "max" if "max" in str(cov.get("type", "")).lower() else "min"
    )
    if operator in {"<=", "<", "max", "maximum"}:
        headroom = threshold - actual
    else:
        headroom = actual - threshold
    headroom_pct = safe_div(headroom, abs(threshold))
    status = "pass" if headroom >= -1e-9 else "fail"
    return status, headroom, headroom_pct


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def main() -> None:
    parser = argparse.ArgumentParser(description="Calculate first-pass private credit metrics.")
    parser.add_argument("--financials", required=True, help="Borrower financials CSV")
    parser.add_argument("--terms", help="Debt terms JSON with optional covenants")
    parser.add_argument("--outdir", default="credit_out", help="Output directory")
    args = parser.parse_args()

    financials_path = Path(args.financials)
    terms_path = Path(args.terms) if args.terms else None
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    rows, header_map = load_csv(financials_path)
    latest = last_nonempty(rows, header_map)
    terms = load_terms(terms_path)

    period = get_text(latest, header_map, "period") or str(terms.get("as_of_date", "latest"))
    ebitda, ebitda_basis, ebitda_warning = choose_ebitda(latest, header_map)

    cash = get_field(latest, header_map, "cash")
    total_debt = value_or_terms(
        get_field(latest, header_map, "total_debt"),
        terms,
        ["total_debt", "proposed_total_debt", "debt"],
    )
    senior_debt = value_or_terms(
        get_field(latest, header_map, "senior_debt"),
        terms,
        ["senior_debt", "senior_secured_debt", "first_lien_debt"],
    )
    net_debt = get_field(latest, header_map, "net_debt")
    if net_debt is None and total_debt is not None and cash is not None:
        net_debt = total_debt - cash
    cash_interest = value_or_terms(
        get_field(latest, header_map, "cash_interest"),
        terms,
        ["cash_interest", "interest_expense", "annual_cash_interest"],
    )
    capex = value_or_terms(
        get_field(latest, header_map, "capex"), terms, ["capex", "maintenance_capex"]
    )
    cash_taxes = value_or_terms(get_field(latest, header_map, "cash_taxes"), terms, ["cash_taxes"])
    change_nwc = get_field(latest, header_map, "change_nwc")
    fcf = get_field(latest, header_map, "free_cash_flow")
    required_repayment = value_or_terms(
        get_field(latest, header_map, "required_repayment"),
        terms,
        ["required_repayment", "annual_amortization", "scheduled_amortization"],
    )
    revolver_availability = value_or_terms(
        get_field(latest, header_map, "revolver_availability"),
        terms,
        ["revolver_availability", "undrawn_revolver", "availability"],
    )
    minimum_liquidity = value_or_terms(
        get_field(latest, header_map, "minimum_liquidity"),
        terms,
        ["minimum_liquidity", "min_liquidity"],
    )

    cfads = None
    if ebitda is not None:
        cfads = ebitda
        for item in [capex, cash_taxes, change_nwc]:
            if item is not None:
                cfads -= item

    fixed_charge_den = None
    if cash_interest is not None or required_repayment is not None:
        fixed_charge_den = (cash_interest if cash_interest is not None else 0.0) + (
            required_repayment if required_repayment is not None else 0.0
        )

    liquidity = None
    if cash is not None or revolver_availability is not None:
        liquidity = (cash if cash is not None else 0.0) + (
            revolver_availability if revolver_availability is not None else 0.0
        )

    metrics = {
        "gross_leverage": safe_div(total_debt, ebitda),
        "net_leverage": safe_div(net_debt, ebitda),
        "senior_leverage": safe_div(senior_debt, ebitda),
        "interest_coverage": safe_div(ebitda, cash_interest),
        "fixed_charge_coverage": safe_div(
            (ebitda if ebitda is not None else 0.0)
            - (capex if capex is not None else 0.0)
            - (cash_taxes if cash_taxes is not None else 0.0)
            if ebitda is not None
            else None,
            fixed_charge_den,
        ),
        "debt_service_coverage": safe_div(cfads, fixed_charge_den),
        "fcf_conversion": safe_div(fcf, ebitda),
        "liquidity": liquidity,
        "liquidity_cushion": liquidity - minimum_liquidity
        if liquidity is not None and minimum_liquidity is not None
        else None,
    }

    metric_rows = [
        {"metric": "period", "value": period, "basis": "latest row", "warning": ""},
        {
            "metric": "ebitda_basis",
            "value": ebitda_basis,
            "basis": "selected strongest available EBITDA column",
            "warning": "",
        },
        {
            "metric": "selected_ebitda",
            "value": fmt(ebitda, 0),
            "basis": ebitda_basis,
            "warning": "missing" if ebitda is None else "",
        },
        {
            "metric": "gross_leverage",
            "value": fmt(metrics["gross_leverage"], 2) + "x"
            if metrics["gross_leverage"] is not None
            else "N/M",
            "basis": "total debt / selected EBITDA",
            "warning": "",
        },
        {
            "metric": "net_leverage",
            "value": fmt(metrics["net_leverage"], 2) + "x"
            if metrics["net_leverage"] is not None
            else "N/M",
            "basis": "net debt / selected EBITDA",
            "warning": "",
        },
        {
            "metric": "senior_leverage",
            "value": fmt(metrics["senior_leverage"], 2) + "x"
            if metrics["senior_leverage"] is not None
            else "N/M",
            "basis": "senior debt / selected EBITDA",
            "warning": "",
        },
        {
            "metric": "interest_coverage",
            "value": fmt(metrics["interest_coverage"], 2) + "x"
            if metrics["interest_coverage"] is not None
            else "N/M",
            "basis": "selected EBITDA / cash interest",
            "warning": "",
        },
        {
            "metric": "fixed_charge_coverage",
            "value": fmt(metrics["fixed_charge_coverage"], 2) + "x"
            if metrics["fixed_charge_coverage"] is not None
            else "N/M",
            "basis": "(EBITDA - capex - cash taxes) / (cash interest + required repayment)",
            "warning": "",
        },
        {
            "metric": "debt_service_coverage",
            "value": fmt(metrics["debt_service_coverage"], 2) + "x"
            if metrics["debt_service_coverage"] is not None
            else "N/M",
            "basis": "cash flow available for debt service / required debt service",
            "warning": "",
        },
        {
            "metric": "fcf_conversion",
            "value": fmt(metrics["fcf_conversion"] * 100, 1, "%")
            if metrics["fcf_conversion"] is not None
            else "N/M",
            "basis": "free cash flow / selected EBITDA",
            "warning": "",
        },
        {
            "metric": "liquidity",
            "value": fmt(metrics["liquidity"], 0),
            "basis": "cash + revolver availability",
            "warning": "",
        },
        {
            "metric": "liquidity_cushion",
            "value": fmt(metrics["liquidity_cushion"], 0),
            "basis": "liquidity - minimum liquidity",
            "warning": "",
        },
    ]

    warnings: list[dict[str, Any]] = []

    def warn(severity: str, issue: str, impact: str) -> None:
        warnings.append({"severity": severity, "issue": issue, "impact": impact})

    if ebitda is None:
        warn("high", "Missing EBITDA basis", "Leverage and coverage cannot be computed reliably.")
    if ebitda_warning:
        warn("medium", ebitda_warning, "Confirm lender EBITDA source/support before credit use.")
    if total_debt is None:
        warn("medium", "Missing total debt", "Gross leverage and debt sizing cannot be computed.")
    if cash_interest is None:
        warn("medium", "Missing cash interest", "Interest coverage cannot be computed.")
    if metrics["gross_leverage"] is not None and metrics["gross_leverage"] > float(
        terms.get("gross_leverage_warning", 5.0)
    ):
        warn(
            "high",
            f"Gross leverage is {metrics['gross_leverage']:.2f}x",
            "Confirm lender EBITDA support, structure, and downside headroom.",
        )
    if metrics["interest_coverage"] is not None and metrics["interest_coverage"] < float(
        terms.get("interest_coverage_warning", 2.0)
    ):
        warn(
            "high",
            f"Interest coverage is {metrics['interest_coverage']:.2f}x",
            "Debt service may be tight under rate or EBITDA stress.",
        )
    if metrics["fixed_charge_coverage"] is not None and metrics["fixed_charge_coverage"] < float(
        terms.get("fixed_charge_warning", 1.2)
    ):
        warn(
            "high",
            f"Fixed-charge coverage is {metrics['fixed_charge_coverage']:.2f}x",
            "Cash flow may not support fixed charges with adequate cushion.",
        )
    if metrics["liquidity_cushion"] is not None and metrics["liquidity_cushion"] < 0:
        warn(
            "blocker",
            "Liquidity is below stated minimum",
            "Borrower may fail minimum liquidity or operating runway requirements.",
        )
    if metrics["fcf_conversion"] is not None and metrics["fcf_conversion"] < 0:
        warn(
            "high",
            "Negative free cash flow conversion",
            "EBITDA is not converting to cash in the selected period.",
        )

    covenant_rows: list[dict[str, Any]] = []
    for cov in terms.get("covenants", []) if isinstance(terms.get("covenants", []), list) else []:
        actual = covenant_actual(cov, metrics)
        status, headroom, headroom_pct = covenant_headroom(cov, actual)
        covenant_rows.append(
            {
                "name": cov.get("name", ""),
                "type": cov.get("type", ""),
                "threshold": cov.get("threshold", ""),
                "operator": cov.get("operator", ""),
                "actual": fmt(actual, 2),
                "status": status,
                "headroom": fmt(headroom, 2),
                "headroom_pct": fmt(headroom_pct * 100, 1, "%")
                if headroom_pct is not None
                else "N/M",
                "basis": "first-pass proxy; verify against governing definition",
            }
        )
        if status == "fail":
            warn(
                "blocker",
                f"Covenant fail: {cov.get('name', '')}",
                "Headroom is negative using first-pass proxy metrics.",
            )

    csv_dir = support_dir(outdir)
    write_csv(csv_dir / "credit_metrics.csv", metric_rows, ["metric", "value", "basis", "warning"])
    write_csv(
        csv_dir / "covenant_headroom.csv",
        covenant_rows,
        [
            "name",
            "type",
            "threshold",
            "operator",
            "actual",
            "status",
            "headroom",
            "headroom_pct",
            "basis",
        ],
    )
    write_csv(csv_dir / "warnings.csv", warnings, ["severity", "issue", "impact"])

    report_lines = [
        "# Credit metrics report",
        "",
        f"- period: {period}",
        f"- EBITDA basis: {ebitda_basis}",
        "",
        "## Core metrics",
        "",
        "| Metric | Value | Basis |",
        "|---|---:|---|",
    ]
    for row in metric_rows[2:]:
        report_lines.append(
            f"| {_markdown_table_cell(row['metric'])} | {_markdown_table_cell(row['value'])} | {_markdown_table_cell(row['basis'])} |"
        )
    report_lines += [
        "",
        "## Covenant headroom",
        "",
        "| Covenant | Actual | Threshold | Status | Headroom |",
        "|---|---:|---:|---|---:|",
    ]
    if covenant_rows:
        for row in covenant_rows:
            report_lines.append(
                f"| {_markdown_table_cell(row['name'])} | {_markdown_table_cell(row['actual'])} | {_markdown_table_cell(row['threshold'])} | {_markdown_table_cell(row['status'])} | {_markdown_table_cell(row['headroom'])} |"
            )
    else:
        report_lines.append("| N/A | N/A | N/A | N/A | N/A |")
    report_lines += ["", "## Warnings", "", "| Severity | Issue | Impact |", "|---|---|---|"]
    if warnings:
        for row in warnings:
            report_lines.append(
                f"| {_markdown_table_cell(row['severity'])} | {_markdown_table_cell(row['issue'])} | {_markdown_table_cell(row['impact'])} |"
            )
    else:
        report_lines.append(
            "| low | no first-pass warnings generated | review source quality and definitions before relying on this output |"
        )
    report_lines += [
        "",
        "_This is a first-pass calculation aid. Verify source dates, definitions, lender EBITDA support, and covenant language before committee use._",
        "",
    ]
    workbook_path = outdir / "private_credit_underwriting.xlsx"
    write_cover_first_workbook(
        workbook_path,
        [
            ["Private Credit Underwriting"],
            ["Period", period],
            ["EBITDA basis", ebitda_basis],
            [
                "First read",
                "Use this lender-case workbook first. CSV files are support/import files.",
            ],
            [
                "Credit posture",
                "First-pass metrics only; confirm lender EBITDA, definitions, liquidity, collateral, and covenant language.",
            ],
        ],
        {
            "Borrower_Profile": dict_rows_to_sheet(
                metric_rows[:2], ["metric", "value", "basis", "warning"]
            ),
            "Debt_Sizing": dict_rows_to_sheet(metric_rows, ["metric", "value", "basis", "warning"]),
            "Base_Case": dict_rows_to_sheet(metric_rows, ["metric", "value", "basis", "warning"]),
            "Lender_Case": dict_rows_to_sheet(metric_rows, ["metric", "value", "basis", "warning"]),
            "Downside": dict_rows_to_sheet(metric_rows, ["metric", "value", "basis", "warning"]),
            "Severe_Downside": dict_rows_to_sheet(
                metric_rows, ["metric", "value", "basis", "warning"]
            ),
            "Covenants": dict_rows_to_sheet(
                covenant_rows,
                [
                    "name",
                    "type",
                    "threshold",
                    "operator",
                    "actual",
                    "status",
                    "headroom",
                    "headroom_pct",
                    "basis",
                ],
            ),
            "Liquidity": dict_rows_to_sheet(metric_rows, ["metric", "value", "basis", "warning"]),
            "Collateral": [
                ["item", "status"],
                ["Collateral schedule", "Not provided by first-pass calculator"],
            ],
            "Open_Items": dict_rows_to_sheet(warnings, ["severity", "issue", "impact"]),
        },
    )
    report_path = outdir / "credit_memo.html"
    _write_html_report(report_path, "Private Credit Underwriting Memo", "\n".join(report_lines))
    handoff_results = []
    selected_ebitda = next(
        (row["value"] for row in metric_rows if row["metric"] == "selected_ebitda"), "not_provided"
    )
    handoff_overrides = {
        "borrower_context": "Private credit first-pass metrics package",
        "selected_ebitda_basis": ebitda_basis,
        "lender_after_haircut_ebitda": selected_ebitda,
        "covenant_ebitda_proxy": selected_ebitda,
        "credit_status": "watchlist review required" if warnings else "perform credit review",
        "lender_case": [
            {
                "label": "Lender case",
                "description": f"Selected EBITDA basis: {ebitda_basis}",
                "status": "needs_review",
            }
        ],
        "downside_case": [
            {
                "label": "Downside",
                "description": "Not calculated by first-pass metric helper.",
                "status": "needs_review",
            }
        ],
        "severe_downside_case": [
            {
                "label": "Severe downside",
                "description": "Not calculated by first-pass metric helper.",
                "status": "needs_review",
            }
        ],
        "circulation_caveats": [
            {
                "caveat": "First-pass credit metrics only; verify definitions and collateral.",
                "impact": "not committee-ready",
                "owner": "VP",
            }
        ],
    }
    for contract_name, consumer in [
        ("private_credit_underwriting_to_covenant_package_analyzer", "covenant-package-analyzer"),
        (
            "private_credit_underwriting_to_distressed_recovery_waterfall",
            "distressed-recovery-waterfall",
        ),
    ]:
        handoff_results.append(
            write_handoff_payload(
                outdir,
                contract_name,
                build_minimal_handoff_payload(contract_name, handoff_overrides),
                consumer_skill=consumer,
            )
        )
    write_artifact_manifest(
        outdir,
        "private-credit-underwriting",
        "workbook",
        workbook_path,
        companion_deliverables=[
            artifact_item(
                report_path,
                "companion_deliverable",
                "html",
                "Standalone HTML private credit memo companion to the lender-case workbook.",
                True,
                True,
            )
        ],
        support_artifacts=[
            artifact_item(
                csv_dir / "credit_metrics.csv",
                "support_artifact",
                "csv",
                "Raw metric rows.",
                False,
                True,
                "CSV is support/import data for the workbook and memo.",
            ),
            artifact_item(
                csv_dir / "covenant_headroom.csv",
                "support_artifact",
                "csv",
                "Raw covenant headroom rows.",
                False,
                True,
                "CSV is support/import data for the workbook and memo.",
            ),
            artifact_item(
                csv_dir / "warnings.csv",
                "support_artifact",
                "csv",
                "Raw warnings table.",
                False,
                True,
                "CSV backs the open-items view.",
            ),
            *[handoff_artifact_item(result) for result in handoff_results],
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "First-pass metrics must be confirmed against lender EBITDA definitions, liquidity, collateral, and covenant language.",
            "missing_inputs": [
                "Lender EBITDA support",
                "Debt agreement definitions",
                "Liquidity forecast",
                "Collateral support",
            ],
        },
        extra={
            "handoffs": [
                {
                    "handoff_contract_name": item["handoff_contract_name"],
                    "path": item["path"],
                    "schema_path": item["schema_path"],
                    "validator_status": item["validator_status"],
                    "validated_at": item["validated_at"],
                    "consumer_skill": item["consumer_skill"],
                }
                for item in handoff_results
            ]
        },
    )

    print(f"wrote primary workbook to {workbook_path}")
    print(f"wrote companion memo to {report_path}")


if __name__ == "__main__":
    main()
