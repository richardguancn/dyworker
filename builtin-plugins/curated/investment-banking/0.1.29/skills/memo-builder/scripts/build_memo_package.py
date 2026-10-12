#!/usr/bin/env python3
"""Build a deterministic standalone Investment Banking memo package."""

from __future__ import annotations

import argparse
import json
import sys
from html import escape
from pathlib import Path
from typing import Any, Mapping, Sequence

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    support_dir,
    write_artifact_manifest,
)
from shared.office_artifacts import write_minimal_docx  # noqa: E402


def load_payload(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def as_rows(value: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return value
    return fallback


def write_support_payload(
    outdir: Path, payload: Mapping[str, Any], name: str = "memo_plan.json"
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


def _string(value: Any, fallback: str = "Not provided") -> str:
    text = str(value).strip() if value is not None else ""
    return escape(text or fallback)


def _plain(value: Any, fallback: str = "Not provided") -> str:
    text = str(value).strip() if value is not None else ""
    return text or fallback


def _rows_html(rows: Sequence[Mapping[str, Any]], columns: Sequence[tuple[str, str]]) -> str:
    return "\n".join(
        "<tr>" + "".join(f"<td>{_string(row.get(key))}</td>" for key, _ in columns) + "</tr>"
        for row in rows
    )


def memo_docx_paragraphs(
    payload: Mapping[str, Any],
    thesis: Sequence[Mapping[str, Any]],
    risks: Sequence[Mapping[str, Any]],
    open_items: Sequence[Mapping[str, Any]],
) -> list[str]:
    paragraphs = [
        "Recommendation And Reliance Posture",
        _plain(
            payload.get("recommendation"),
            "Use the presented case for internal screening only until source support, downside analysis, and the key diligence workstreams are complete.",
        ),
        "Decision Hinge",
        _plain(
            payload.get("decision_hinge"),
            "Reliance depends on whether the load-bearing claims can be substantiated and translated into a supportable underwriting case.",
        ),
        "Executive Summary",
        _plain(payload.get("executive_summary")),
        "Decision Question",
        _plain(
            payload.get("decision_or_question"),
            "What must be validated before relying on the presented case?",
        ),
        "Transaction Snapshot",
        _plain(
            payload.get("transaction_snapshot"),
            "Transaction terms, financing, status, and timing should be confirmed from the controlling source packet before broader circulation.",
        ),
        "Projections / Model Reliance",
        _plain(
            payload.get("projection_view"),
            "Treat disclosed projections, management cases, and synergy estimates as inputs for validation rather than an underwritten base case until supporting work is complete.",
        ),
        "Load-Bearing Claims",
    ]
    paragraphs.extend(
        f"- {_plain(row.get('point'))}: {_plain(row.get('evidence_status'), 'Evidence status not provided')}"
        for row in thesis
    )
    paragraphs.append("Key Risks And Downside Transmission")
    paragraphs.extend(
        f"- {_plain(row.get('risk'))}: {_plain(row.get('mitigant'), 'Mitigant or required proof not provided')}"
        for row in risks
    )
    paragraphs.append("Diligence Required Before Reliance")
    paragraphs.extend(
        f"- {_plain(row.get('item'))} | Owner: {_plain(row.get('owner'), 'Not assigned')} | Impact: {_plain(row.get('decision_impact'), 'Decision impact not provided')}"
        for row in open_items
    )
    paragraphs.extend(
        [
            "Recommended Next Step",
            _plain(
                payload.get("recommended_next_step"),
                "Resolve the priority diligence items, update the reliance posture, and run IB deck QC before any broader circulation.",
            ),
        ]
    )
    return paragraphs


def write_standalone_memo(
    path: Path,
    company: str,
    payload: Mapping[str, Any],
    thesis: list[dict[str, Any]],
    risks: list[dict[str, Any]],
    open_items: list[dict[str, Any]],
) -> Path:
    as_of = _string(payload.get("as_of_date"), "Confirm source date")
    memo_type = _string(payload.get("memo_type"), "Diligence synthesis")
    audience = _string(payload.get("audience"), "Internal deal team")
    posture = _string(payload.get("circulation"), "Screen-grade internal draft")
    decision = _string(
        payload.get("decision_or_question"),
        "What must be validated before relying on the presented case?",
    )
    executive_summary = (
        f"""<h2>Executive Summary</h2>
    <p>{_string(payload.get("executive_summary"))}</p>"""
        if payload.get("executive_summary")
        else ""
    )
    recommendation = _string(
        payload.get("recommendation"),
        "Use the presented case for internal screening only until source support, downside analysis, and the key diligence workstreams are complete.",
    )
    decision_hinge = _string(
        payload.get("decision_hinge"),
        "Reliance depends on whether the load-bearing claims can be substantiated and translated into a supportable underwriting case.",
    )
    transaction_snapshot = _string(
        payload.get("transaction_snapshot"),
        "Transaction terms, financing, status, and timing should be confirmed from the controlling source packet before broader circulation.",
    )
    projection_view = _string(
        payload.get("projection_view"),
        "Treat disclosed projections, management cases, and synergy estimates as inputs for validation rather than an underwritten base case until supporting work is complete.",
    )
    next_step = _string(
        payload.get("recommended_next_step"),
        "Resolve the priority diligence items below, update the reliance posture, and run IB deck QC before any broader circulation.",
    )
    sources = as_rows(
        payload.get("sources"),
        [
            {
                "source": "Source packet not included in builder input.",
                "use": "Confirm material facts and figures before relying on this memo.",
            }
        ],
    )
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(company)} | Internal Deal-Team Memo</title>
  <style>
    :root {{ --navy:#14283d; --ink:#172436; --muted:#5b6878; --teal:#21635e; --rule:#dbe3e8; --soft:#f4f7f8; --warn:#fff6e7; --warn-border:#c78c28; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:#fff; color:var(--ink); font-family:Arial,Helvetica,sans-serif; line-height:1.48; }}
    main {{ max-width:1120px; margin:0 auto; padding:44px 45px 58px; }}
    .eyebrow {{ color:var(--teal); font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; margin:0 0 10px; }}
    h1 {{ margin:0; max-width:850px; color:var(--navy); font-size:42px; line-height:1.1; letter-spacing:-.04em; }}
    .subtitle {{ max-width:850px; margin:13px 0 0; color:var(--muted); font-size:16px; }}
    .meta {{ display:flex; flex-wrap:wrap; gap:20px; margin:25px 0 29px; padding:14px 0; border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); }}
    .meta div {{ min-width:155px; }}
    .label {{ display:block; color:var(--muted); font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; margin-bottom:4px; }}
    .meta strong {{ font-size:14px; color:var(--navy); }}
    .recommendation {{ display:grid; grid-template-columns:1.4fr .85fr; gap:24px; background:var(--soft); border-left:5px solid var(--teal); padding:24px 25px; margin-bottom:30px; }}
    .recommendation h2 {{ border:0; padding:0; margin:0 0 8px; font-size:22px; }}
    .recommendation p {{ margin:0; }}
    .hinge {{ border-left:3px solid var(--warn-border); background:var(--warn); padding:14px 15px; font-size:14px; }}
    h2 {{ color:var(--navy); font-size:21px; letter-spacing:-.02em; margin:32px 0 13px; padding-bottom:8px; border-bottom:1px solid var(--rule); }}
    p {{ margin:0 0 12px; }}
    .grid {{ display:grid; grid-template-columns:1fr 1fr; gap:17px; }}
    .card {{ border:1px solid var(--rule); border-radius:5px; padding:17px 18px; }}
    .card .label {{ color:var(--teal); }}
    table {{ width:100%; border-collapse:collapse; font-size:14px; }}
    th {{ color:var(--muted); background:var(--soft); font-size:11px; text-transform:uppercase; letter-spacing:.07em; text-align:left; }}
    th, td {{ border-bottom:1px solid var(--rule); padding:11px 12px; vertical-align:top; }}
    .table-wrap {{ border:1px solid var(--rule); border-radius:5px; overflow-x:auto; }}
    .next {{ border-top:3px solid var(--navy); margin-top:31px; padding-top:16px; }}
    .sources {{ color:var(--muted); font-size:13px; }}
    @media (max-width:760px) {{ main {{ padding:27px 18px 42px; }} h1 {{ font-size:31px; }} .grid, .recommendation {{ display:block; }} .hinge {{ margin-top:16px; }} }}
    @media print {{ main {{ max-width:none; padding:0; }} .recommendation, .card, table {{ break-inside:avoid; }} }}
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Investment Banking | Internal Deal-Team Memo</p>
    <h1>{escape(company)}</h1>
    <p class="subtitle">Decision-ready synthesis of transaction rationale, reliance limits, key risks, and diligence required before broader use.</p>
    <div class="meta">
      <div><span class="label">Memo Type</span><strong>{memo_type}</strong></div>
      <div><span class="label">Audience</span><strong>{audience}</strong></div>
      <div><span class="label">Posture</span><strong>{posture}</strong></div>
      <div><span class="label">Source As Of</span><strong>{as_of}</strong></div>
    </div>
    <section class="recommendation">
      <div>
        <p class="eyebrow">Recommendation And Reliance Posture</p>
        <h2>Internal use pending validation</h2>
        <p>{recommendation}</p>
      </div>
      <div class="hinge"><span class="label">Decision Hinge</span>{decision_hinge}</div>
    </section>
    {executive_summary}
    <h2>Decision Question</h2>
    <p>{decision}</p>
    <div class="grid">
      <section class="card">
        <span class="label">Transaction Snapshot</span>
        <p>{transaction_snapshot}</p>
      </section>
      <section class="card">
        <span class="label">Projections / Model Reliance</span>
        <p>{projection_view}</p>
      </section>
    </div>
    <h2>Load-Bearing Claims</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Claim</th><th>Evidence Status</th></tr></thead>
        <tbody>{_rows_html(thesis, [("point", "Claim"), ("evidence_status", "Evidence Status")])}</tbody>
      </table>
    </div>
    <h2>Key Risks And Downside Transmission</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Risk</th><th>Mitigant / Required Proof</th></tr></thead>
        <tbody>{_rows_html(risks, [("risk", "Risk"), ("mitigant", "Mitigant / Required Proof")])}</tbody>
      </table>
    </div>
    <h2>Diligence Required Before Reliance</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Priority Item</th><th>Owner</th><th>Decision Impact</th></tr></thead>
        <tbody>{_rows_html(open_items, [("item", "Priority Item"), ("owner", "Owner"), ("decision_impact", "Decision Impact")])}</tbody>
      </table>
    </div>
    <section class="next">
      <p class="eyebrow">Recommended Next Step</p>
      <p>{next_step}</p>
    </section>
    <h2>Sources And Calculation Notes</h2>
    <div class="table-wrap">
      <table class="sources">
        <thead><tr><th>Source</th><th>Use / Limitation</th></tr></thead>
        <tbody>{_rows_html(sources, [("source", "Source"), ("use", "Use / Limitation")])}</tbody>
      </table>
    </div>
  </main>
</body>
</html>
"""
    path.write_text(document, encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--primary-format",
        choices=("html", "docx"),
        default="html",
        help="Select which human artifact is primary after format intake.",
    )
    parser.add_argument("--json-run-log", "--json", dest="json_run_log", action="store_true")
    parser.add_argument("--quiet-human-output", action="store_true")
    args = parser.parse_args()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    payload = load_payload(args.input)
    company = str(payload.get("company", "Subject Company"))
    thesis = as_rows(
        payload.get("thesis_points"),
        [
            {
                "point": "Draft recommendation requires source-backed support",
                "evidence_status": "Needs review",
            }
        ],
    )
    risks = as_rows(
        payload.get("risks"),
        [
            {
                "risk": "Source/model support incomplete",
                "mitigant": "Run source and model gates before committee use",
            }
        ],
    )
    open_items = as_rows(
        payload.get("open_items"),
        [
            {
                "item": "Complete source/model tie-out",
                "owner": "Associate",
                "decision_impact": "Blocks reliance beyond screen-grade use",
            }
        ],
    )
    intake = write_support_payload(out, payload)
    docx = write_minimal_docx(
        out / "investment_memo.docx",
        f"{company} Investment Memo",
        memo_docx_paragraphs(payload, thesis, risks, open_items),
    )
    html = write_standalone_memo(
        out / "investment_memo.html", company, payload, thesis, risks, open_items
    )
    primary = docx if args.primary_format == "docx" else html
    companion = html if args.primary_format == "docx" else docx
    artifact_mode = "native_document" if args.primary_format == "docx" else "html_report"
    write_artifact_manifest(
        out,
        "memo-builder",
        artifact_mode,
        primary,
        companion_deliverables=[
            artifact_item(
                companion,
                "companion_deliverable",
                "html" if args.primary_format == "docx" else "native_document",
                "HTML memo companion." if args.primary_format == "docx" else "Native DOCX memo companion.",
                True,
                True,
            )
        ],
        support_artifacts=[
            artifact_item(
                intake,
                "support_artifact",
                "json",
                "Memo plan and structured input payload.",
                False,
                True,
                "Memo-plan JSON is internal support material.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Requires source, model, and circulation gates before committee-ready use.",
            "missing_inputs": ["source support", "model tie-out", "IB deck QC as applicable"],
        },
    )
    summary = {
        "primary_human_deliverable": str(primary),
        "companion_deliverable": str(companion),
        "manifest": str(out / "manifest.json"),
    }
    print_summary(
        args.json_run_log,
        args.quiet_human_output,
        summary,
        [
            "Investment memo package complete",
            f"Open first: {primary}",
            f"Companion deliverable: {companion}",
        ],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
