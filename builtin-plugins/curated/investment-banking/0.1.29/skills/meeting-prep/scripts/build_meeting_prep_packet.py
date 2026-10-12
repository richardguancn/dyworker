#!/usr/bin/env python3
"""Build a deterministic IB meeting prep packet."""

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


from shared.office_artifacts import write_minimal_docx  # noqa: E402


def _string(value: Any, fallback: str = "Not provided") -> str:
    text = str(value).strip() if value is not None else ""
    return escape(text or fallback)


def _rows_html(rows: Sequence[Mapping[str, Any]], columns: Sequence[tuple[str, str]]) -> str:
    return "\n".join(
        "<tr>" + "".join(f"<td>{_string(row.get(key))}</td>" for key, _ in columns) + "</tr>"
        for row in rows
    )


def write_standalone_brief(
    path: Path,
    company: str,
    payload: Mapping[str, Any],
    attendees: list[dict[str, Any]],
    objections: list[dict[str, Any]],
    followups: list[dict[str, Any]],
) -> Path:
    as_of = _string(payload.get("as_of_date"), "Confirm before meeting")
    objective = _string(
        payload.get("meeting_objective"),
        "Prepare for a focused conversation, identify the issues that warrant follow-up work, and avoid presuming a mandate.",
    )
    stance = _string(
        payload.get("recommended_stance"),
        "Lead with informed questions; confirm priorities and required evidence before recommending a workstream.",
    )
    brief = _string(
        payload.get("md_brief"),
        "This is an internal working brief. Confirm attendees, relationship context, and source posture before using it live.",
    )
    do_not_say = _string(
        payload.get("do_not_say"),
        "Do not present unsupported claims, unverified commitments, or an inferred mandate as fact.",
    )
    questions = as_rows(
        payload.get("priority_questions"),
        [
            {
                "question": "Which strategic priority matters most over the next planning period, and what proof point would change your capital-allocation decision?",
                "why_it_matters": "Identifies the priority that merits follow-up work.",
                "follow_up": "Ask what evidence or analysis would be useful next.",
            },
            {
                "question": "What event would make external advice or capital-markets preparation genuinely useful?",
                "why_it_matters": "Tests for a real mandate trigger without presuming one.",
                "follow_up": "Seek permission for a targeted follow-up only if relevant.",
            },
        ],
    )
    angles = as_rows(
        payload.get("coverage_angles"),
        [
            {
                "angle": "Strategic priorities and capital allocation",
                "current_view": "Requires source-backed company context.",
                "trigger": "Management identifies a concrete priority where focused advisory work would help.",
            }
        ],
    )
    sources = as_rows(
        payload.get("sources"),
        [
            {
                "source": "No primary sources included in intake.",
                "use": "Confirm before live use.",
            }
        ],
    )
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(company)} | Meeting Prep</title>
  <style>
    :root {{ --navy:#153044; --ink:#15222e; --muted:#5b6875; --rule:#d9e1e7; --soft:#f4f7f8; --accent:#c76031; --green:#236454; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; color:var(--ink); font-family:Arial,Helvetica,sans-serif; background:#f7f8f8; line-height:1.45; }}
    main {{ max-width:1180px; margin:0 auto; padding:34px 30px 52px; }}
    header {{ border-radius:12px; background:var(--navy); color:#fff; padding:32px 36px; margin-bottom:20px; }}
    .eyebrow {{ margin:0 0 10px; text-transform:uppercase; letter-spacing:.14em; font-size:11px; font-weight:700; color:#bcd0da; }}
    h1 {{ margin:0 0 8px; font-size:38px; letter-spacing:-.035em; }}
    header p {{ margin:0; color:#e2ebef; }}
    .meta {{ margin-top:18px; font-size:12px; color:#e2ebef; text-transform:uppercase; font-weight:700; letter-spacing:.06em; }}
    .grid {{ display:grid; grid-template-columns:1.08fr .92fr; gap:16px; }}
    section {{ background:#fff; border:1px solid var(--rule); border-radius:10px; padding:22px 24px; margin-bottom:16px; }}
    section.accent {{ border-top:4px solid var(--accent); }}
    h2 {{ margin:0 0 13px; font-size:22px; letter-spacing:-.02em; }}
    p {{ margin:0 0 11px; }}
    .stance {{ padding:12px 14px; background:#fff3ed; border-left:3px solid var(--accent); margin-top:15px; }}
    table {{ width:100%; border-collapse:collapse; font-size:14px; }}
    th {{ background:var(--navy); color:#fff; padding:10px 11px; text-align:left; text-transform:uppercase; letter-spacing:.06em; font-size:11px; }}
    td {{ padding:11px; border-bottom:1px solid var(--rule); vertical-align:top; }}
    .brief {{ border-left:4px solid var(--green); background:var(--soft); padding:13px 15px; color:var(--muted); }}
    .guardrail {{ background:#fff4ef; border-left:4px solid var(--accent); padding:13px 15px; }}
    .small {{ font-size:13px; color:var(--muted); }}
    @media (max-width:800px) {{ main {{ padding:18px; }} header {{ padding:25px 21px; }} .grid {{ display:block; }} table {{ display:block; overflow-x:auto; }} }}
    @media print {{ body {{ background:#fff; }} main {{ max-width:none; padding:0; }} section, header {{ break-inside:avoid; }} }}
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">Investment Banking | Meeting Prep</div>
      <h1>{escape(company)}</h1>
      <p>Standalone HTML meeting brief for banker preparation and next-step planning.</p>
      <div class="meta">Internal Working Brief &nbsp;|&nbsp; As Of: {as_of}</div>
    </header>
    <div class="grid">
      <section class="accent">
        <h2>Meeting Objective</h2>
        <p>{objective}</p>
        <div class="stance"><strong>Recommended posture:</strong> {stance}</div>
      </section>
      <section>
        <h2>First-Read Brief</h2>
        <div class="brief">{brief}</div>
      </section>
    </div>
    <section>
      <h2>Coverage Angles And Mandate Triggers</h2>
      <table>
        <thead><tr><th>Angle To Test</th><th>Current View</th><th>Signal That Warrants Follow-Up</th></tr></thead>
        <tbody>{_rows_html(angles, [("angle", "Angle To Test"), ("current_view", "Current View"), ("trigger", "Signal That Warrants Follow-Up")])}</tbody>
      </table>
    </section>
    <section>
      <h2>Questions To Land</h2>
      <table>
        <thead><tr><th>Question</th><th>Why It Matters</th><th>Listening Signal / Follow-Up</th></tr></thead>
        <tbody>{_rows_html(questions, [("question", "Question"), ("why_it_matters", "Why It Matters"), ("follow_up", "Listening Signal / Follow-Up")])}</tbody>
      </table>
    </section>
    <div class="grid">
      <section>
        <h2>Attendee Context</h2>
        <table>
          <thead><tr><th>Attendee</th><th>Role</th><th>Likely Focus</th></tr></thead>
          <tbody>{_rows_html(attendees, [("name", "Attendee"), ("role", "Role"), ("likely_focus", "Likely Focus")])}</tbody>
        </table>
      </section>
      <section>
        <h2>Listening Signals / Pushbacks</h2>
        <table>
          <thead><tr><th>Signal Or Objection</th><th>Banker Response</th></tr></thead>
          <tbody>{_rows_html(objections, [("objection", "Signal Or Objection"), ("response", "Banker Response")])}</tbody>
        </table>
      </section>
    </div>
    <section>
      <h2>Internal Guardrails</h2>
      <div class="guardrail"><strong>Do not say or presume:</strong> {do_not_say}</div>
    </section>
    <section>
      <h2>Recommended Permissioned Next Step</h2>
      <table>
        <thead><tr><th>Action</th><th>Owner</th><th>Status</th></tr></thead>
        <tbody>{_rows_html(followups, [("action", "Action"), ("owner", "Owner"), ("status", "Status")])}</tbody>
      </table>
      <p class="small">Confirm any commitments, process implications, and source-supported facts before creating downstream memo or tracker handoffs.</p>
    </section>
    <section>
      <h2>Evidence And Limitations</h2>
      <table>
        <thead><tr><th>Source</th><th>Use / Limitation</th></tr></thead>
        <tbody>{_rows_html(sources, [("source", "Source"), ("use", "Use / Limitation")])}</tbody>
      </table>
    </section>
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
    parser.add_argument("--json-run-log", "--json", dest="json_run_log", action="store_true")
    parser.add_argument("--quiet-human-output", action="store_true")
    args = parser.parse_args()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    payload = load_payload(args.input)
    company = str(payload.get("company", "Subject Company"))
    attendees = as_rows(
        payload.get("attendees"),
        [{"name": "Unknown attendee", "role": "Confirm", "likely_focus": "Clarify agenda"}],
    )
    objections = as_rows(
        payload.get("likely_objections"),
        [
            {
                "objection": "Source package incomplete",
                "response": "Flag as open item; do not overstate.",
            }
        ],
    )
    followups = as_rows(
        payload.get("followups"),
        [
            {
                "action": "Request permission for a targeted follow-up only if management identifies a priority.",
                "owner": "Coverage banker",
                "status": "Trigger-dependent",
            }
        ],
    )
    intake = write_support_payload(out, payload)
    docx = write_minimal_docx(
        out / "meeting_prep_packet.docx",
        f"{company} Meeting Prep",
        ["MD brief", "Likely objections", "Follow-up tracker"],
    )
    html = write_standalone_brief(
        out / "meeting_prep_packet.html", company, payload, attendees, objections, followups
    )
    write_artifact_manifest(
        out,
        "meeting-prep",
        "html_report",
        html,
        companion_deliverables=[
            artifact_item(
                docx,
                "companion_deliverable",
                "native_document",
                "Native DOCX meeting prep packet.",
                True,
                True,
            )
        ],
        support_artifacts=[
            artifact_item(
                intake,
                "support_artifact",
                "json",
                "Original meeting prep intake payload.",
                False,
                False,
                "Intake JSON is support/audit material.",
            ),
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "Meeting packet requires banker confirmation of attendees, claims, and follow-up commitments.",
            "missing_inputs": [],
        },
    )
    summary = {
        "primary_human_deliverable": str(html),
        "companion_deliverable": str(docx),
        "manifest": str(out / "manifest.json"),
    }
    print_summary(
        args.json_run_log,
        args.quiet_human_output,
        summary,
        ["Meeting prep packet complete", f"Open first: {html}", f"Companion DOCX: {docx}"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
