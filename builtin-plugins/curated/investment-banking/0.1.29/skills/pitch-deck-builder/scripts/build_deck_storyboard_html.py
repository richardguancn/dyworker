#!/usr/bin/env python3
"""Build a standalone HTML pitch-deck storyboard from a page plan."""

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

from shared.artifacts import artifact_item, support_dir, write_artifact_manifest  # noqa: E402


def load_payload(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def as_rows(value: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return value
    return fallback


def write_support_payload(outdir: Path, payload: Mapping[str, Any]) -> Path:
    target = support_dir(outdir) / "deck_plan.json"
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


def cell(value: Any) -> str:
    return escape(str(value if value not in (None, "") else "-"))


def write_storyboard_html(
    out: Path,
    company: str,
    as_of_date: str,
    slides: list[dict[str, Any]],
    qc: list[dict[str, Any]],
) -> Path:
    slide_rows = "\n".join(
        "<tr>"
        f"<td>{cell(row.get('slide', row.get('page', index)))}</td>"
        f"<td><strong>{cell(row.get('title', row.get('section', 'Planned slide')))}</strong></td>"
        f"<td>{cell(row.get('purpose', 'Advance the decision'))}</td>"
        f"<td><span class='status'>{cell(row.get('source_status', row.get('evidence_status', 'needs review')))}</span></td>"
        "</tr>"
        for index, row in enumerate(slides, start=1)
    )
    qc_rows = "\n".join(
        "<tr>"
        f"<td>{cell(row.get('item', 'Open review item'))}</td>"
        f"<td><span class='status'>{cell(row.get('status', 'open'))}</span></td>"
        f"<td>{cell('Yes' if row.get('blocks_circulation') else 'No')}</td>"
        "</tr>"
        for row in qc
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{cell(company)} | Pitch Deck Storyboard</title>
  <style>
    :root {{ --ink:#101d2c; --muted:#566476; --navy:#112437; --gold:#b88a3c; --line:#d7dce0; --paper:#f7f4ee; --white:#ffffff; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:var(--paper); color:var(--ink); font:15px/1.5 Arial, sans-serif; }}
    .hero {{ background:var(--navy); color:var(--white); padding:52px max(6vw,48px) 48px; }}
    .eyebrow {{ color:#ddba72; font-size:12px; font-weight:700; letter-spacing:.11em; text-transform:uppercase; }}
    h1 {{ font:700 clamp(36px,4vw,50px)/1.08 Georgia, serif; margin:18px 0 14px; max-width:950px; }}
    .subtitle {{ max-width:820px; color:#dbe2e8; font-size:17px; }}
    .meta {{ display:flex; gap:32px; margin-top:35px; font-size:13px; color:#dbe2e8; }}
    main {{ max-width:1160px; margin:0 auto; padding:38px 38px 60px; }}
    .decision {{ background:var(--white); border-left:5px solid var(--gold); padding:23px 26px; margin-bottom:34px; }}
    .decision h2 {{ margin:0 0 8px; font:700 24px Georgia, serif; }}
    h2 {{ margin:38px 0 14px; font:700 28px Georgia, serif; }}
    table {{ width:100%; border-collapse:collapse; background:var(--white); }}
    th {{ background:#e9e2d5; color:#32485c; font-size:12px; letter-spacing:.05em; text-transform:uppercase; text-align:left; }}
    td, th {{ border-bottom:1px solid var(--line); padding:14px 15px; vertical-align:top; }}
    .status {{ color:#7c5b23; font-weight:700; }}
    .note {{ margin-top:30px; color:var(--muted); font-size:13px; }}
  </style>
</head>
<body>
  <header class="hero">
    <div class="eyebrow">Standalone HTML Storyboard | Working Draft</div>
    <h1>{cell(company)} Pitch Deck Storyboard</h1>
    <p class="subtitle">A banker-readable page plan for native deck development. This fallback is not a completed PowerPoint deck or circulation-ready client material.</p>
    <div class="meta"><span>Prepared: {cell(as_of_date)}</span><span>Format: HTML fallback</span><span>Posture: Working draft</span></div>
  </header>
  <main>
    <section class="decision">
      <h2>Decision Framing</h2>
      <p>Use the page architecture below to refine the storyline, close source gaps, and determine which exhibits should be built into a native editable deck.</p>
    </section>
    <h2>Proposed Deck Architecture</h2>
    <table>
      <thead><tr><th style="width:8%">#</th><th style="width:36%">Slide</th><th>Purpose</th><th style="width:18%">Evidence status</th></tr></thead>
      <tbody>{slide_rows}</tbody>
    </table>
    <h2>QC And Open Items</h2>
    <table>
      <thead><tr><th>Review item</th><th style="width:18%">Status</th><th style="width:18%">Blocks circulation</th></tr></thead>
      <tbody>{qc_rows}</tbody>
    </table>
    <p class="note">Deck-plan JSON is retained as support material. Complete native deck construction, source and model tie-out, rendered-artifact QA, and `ib-deck-qc` review before circulation.</p>
  </main>
</body>
</html>
"""
    target = out / "pitch_deck_storyboard.html"
    target.write_text(html, encoding="utf-8")
    return target


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
    as_of_date = str(payload.get("as_of_date", "Date not provided"))
    slides = as_rows(
        payload.get("slides") or payload.get("page_plan"),
        [
            {
                "slide": 1,
                "title": "Situation Update",
                "purpose": "Frame decision",
                "source_status": "needs review",
            },
            {
                "slide": 2,
                "title": "Recommendation",
                "purpose": "Lead to action",
                "source_status": "needs review",
            },
        ],
    )
    qc = as_rows(
        payload.get("qc_items"),
        [{"item": "Source/model citations", "status": "open", "blocks_circulation": True}],
    )
    intake = write_support_payload(out, payload)
    html = write_storyboard_html(out, company, as_of_date, slides, qc)
    write_artifact_manifest(
        out,
        "pitch-deck-builder",
        "html_report",
        html,
        companion_deliverables=[],
        support_artifacts=[
            artifact_item(
                intake,
                "support_artifact",
                "json",
                "Deck plan/control JSON.",
                False,
                True,
                "Deck-plan JSON is support/control material.",
            )
        ],
        blocked_or_partial_status={
            "status": "partial",
            "reason": "HTML storyboard requires native deck construction, source/model tie-out, and deck QC before circulation.",
            "missing_inputs": ["native deck build", "source/model tie-out", "deck QC"],
        },
    )
    summary = {
        "primary_human_deliverable": str(html),
        "manifest": str(out / "manifest.json"),
    }
    print_summary(
        args.json_run_log,
        args.quiet_human_output,
        summary,
        ["Pitch deck standalone HTML storyboard complete", f"Open first: {html}"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
