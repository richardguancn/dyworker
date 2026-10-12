#!/usr/bin/env python3
"""Scaffold a CIM teardown workspace and output templates from plan.json.

This script does NOT parse the CIM. It creates the required output files
with correct headers so an analyst/agent can fill them reliably.

Usage:
  python scripts/run_plan.py plan.json

Creates (by default) in output.output_dir:
- claims_ledger.csv
- evidence_checklist.csv
- diligence_questions.csv
- red_flag_register.csv
- workplan.csv
- deal_package.json (optional skeleton)
- cim_teardown_report.html (standalone decision-grade reader report skeleton)
- manifest.json (run metadata)
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from shared.artifacts import (  # noqa: E402
    artifact_item,
    build_minimal_handoff_payload,
    handoff_artifact_item,
    handoffs_dir,
    support_dir,
    write_artifact_manifest,
    write_handoff_payload,
)

CLAIMS_HEADERS = [
    "Claim ID",
    "Claim Text (Verbatim)",
    "Category",
    "Subcategory",
    "Claim Type",
    "Metric(s)",
    "Period / As-of",
    "Scope (Segment/Geo/Cohort)",
    "Qualifiers",
    "CIM Citation",
    "Supporting Doc Citations",
    "Confidence (1-5)",
    "Materiality (H/M/L)",
    "Implied Assumptions",
    "Required Evidence (Minimum)",
    "Verification Method",
    "Linked Question IDs",
    "Linked Red-Flag IDs",
    "Status",
    "Notes",
]

EVIDENCE_HEADERS = [
    "Evidence ID",
    "Related Claim ID(s)",
    "Evidence Name",
    "Evidence Type (Export/Doc/Report)",
    "System of Record",
    "Owner (Seller)",
    "Granularity Required",
    "Period Covered",
    "Format Required",
    "Purpose (What it proves)",
    "Acceptance Criteria",
    "CIM Citation",
    "Received? (Y/N)",
    "Received Date",
    "Location (Data room path)",
    "Issues / Gaps",
    "Status",
]

QUESTIONS_HEADERS = [
    "Question ID",
    "Related Claim ID(s)",
    "Priority Score",
    "Impact (1-5)",
    "Uncertainty (1-5)",
    "Downside Risk (1-5)",
    "Time Urgency (1-5)",
    "Category",
    "Question (Falsification-first)",
    "Why it matters",
    "Evidence Request (Exact)",
    "Tie-out / Analysis Plan",
    "Owner (Your team)",
    "Owner (Seller)",
    "Meeting Type (Email/Call/Data room)",
    "Due Date",
    "Status",
    "CIM Citation",
    "Follow-ups / Branching",
    "Notes",
]

REDFLAG_HEADERS = [
    "Red-Flag ID",
    "Severity (1-5)",
    "Related Claim ID(s)",
    "Related Question ID(s)",
    "Red Flag Description",
    "Detection Method / Rule",
    "Evidence Needed",
    "What resolves it",
    "Potential Impact",
    "Status",
    "Owner",
    "CIM Citation",
    "Notes",
]

WORKPLAN_HEADERS = [
    "Workstream",
    "Task ID",
    "Task Description",
    "Related Claim ID(s)",
    "Evidence ID(s)",
    "Question ID(s)",
    "Owner (Your team)",
    "Seller Owner",
    "Dependencies",
    "Start Date",
    "Due Date",
    "Status",
    "CIM Citation",
    "Output Artifact",
    "Notes",
]

REQUIRED_FILES = {
    "claims_ledger.csv": CLAIMS_HEADERS,
    "evidence_checklist.csv": EVIDENCE_HEADERS,
    "diligence_questions.csv": QUESTIONS_HEADERS,
    "red_flag_register.csv": REDFLAG_HEADERS,
    "workplan.csv": WORKPLAN_HEADERS,
}


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _write_csv(path: Path, headers: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)


def _write_html_report(path: Path, title: str, plan: dict[str, object]) -> None:
    deal = escape(str(plan.get("deal_name", "Deal")))
    persona = escape(str(plan.get("persona", "TBD")))
    stage = escape(str(plan.get("deal_stage", "TBD")))
    as_of = escape(str(plan.get("as_of", "TBD")))
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <style>
    :root {{ --ink: #14202c; --sub: #586577; --teal: #1f625f; --teal-soft: #e9f3f1; --line: #d7dee5; --bg: #f5f6f4; --warn: #a65d18; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.45; }}
    header {{ background: #fff; border-bottom: 1px solid var(--line); padding: 34px 40px 30px; }}
    .eyebrow {{ color: var(--teal); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; }}
    h1 {{ margin: 10px 0 8px; font-size: clamp(1.8rem, 3.2vw, 2.55rem); letter-spacing: -0.04em; }}
    .meta {{ color: var(--sub); font-size: 0.93rem; }}
    main {{ max-width: 1140px; margin: 0 auto; padding: 26px 32px 44px; }}
    .posture {{ display: grid; grid-template-columns: 1fr 280px; gap: 18px; background: #fff; border: 1px solid var(--line); border-left: 5px solid var(--teal); border-radius: 8px; padding: 20px 22px; }}
    .posture h2 {{ margin: 4px 0 9px; font-size: 1.3rem; }}
    .posture p {{ margin: 0; color: var(--sub); }}
    .stamp {{ background: var(--teal-soft); border-radius: 6px; padding: 13px; font-size: 0.85rem; color: var(--teal); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }}
    .cards {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0 25px; }}
    .card {{ background: #fff; border: 1px solid var(--line); border-radius: 7px; padding: 14px; }}
    .card label {{ display: block; color: var(--sub); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }}
    .card strong {{ display: block; margin-top: 7px; font-size: 1.24rem; }}
    section {{ background: #fff; border: 1px solid var(--line); border-radius: 8px; margin-top: 15px; padding: 20px 22px; }}
    section h2 {{ margin: 0 0 13px; font-size: 1.18rem; }}
    .note {{ color: var(--sub); font-size: 0.92rem; }}
    table {{ border-collapse: collapse; width: 100%; margin-top: 9px; font-size: 0.9rem; }}
    th {{ color: var(--sub); font-size: 0.73rem; letter-spacing: 0.07em; text-transform: uppercase; background: #f7f9f9; }}
    th, td {{ border-bottom: 1px solid var(--line); padding: 10px 9px; text-align: left; vertical-align: top; }}
    td:first-child {{ font-weight: 700; color: var(--teal); white-space: nowrap; }}
    .placeholder {{ color: #788493; font-style: italic; }}
    .gate {{ color: var(--warn); font-weight: 700; }}
    @media (max-width: 800px) {{ header {{ padding: 24px 18px; }} main {{ padding: 18px; }} .posture, .cards {{ grid-template-columns: 1fr; }} table {{ display: block; overflow-x: auto; }} }}
    @media print {{ body {{ background: #fff; }} main {{ max-width: none; padding: 0; }} section, .posture, .card {{ break-inside: avoid; }} }}
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">Initial IC Discussion | CIM Teardown</div>
    <h1>{escape(title)}</h1>
    <div class="meta">{deal} | Persona: {persona} | Stage: {stage} | As of: {as_of}</div>
  </header>
  <main>
    <article class="posture">
      <div>
        <div class="eyebrow">Initial IC Recommendation</div>
        <h2>Populate proceed, pause, or pass posture from tested seller claims.</h2>
        <p>This standalone scaffold is incomplete until claims, evidence gaps, red flags, and first-wave seller requests are populated from the source materials.</p>
      </div>
      <div class="stamp">Draft Scaffold<br>Not Decision Ready</div>
    </article>
    <div class="cards">
      <div class="card"><label>Headline Price</label><strong class="placeholder">TBD</strong></div>
      <div class="card"><label>Reported Metric</label><strong class="placeholder">TBD</strong></div>
      <div class="card"><label>Preliminary Entry View</label><strong class="placeholder">TBD</strong></div>
      <div class="card"><label>Evidence Posture</label><strong class="placeholder">TBD</strong></div>
    </div>
    <section>
      <h2>Claims That Matter Most</h2>
      <table><thead><tr><th>Claim</th><th>Why It Matters</th><th>Proof Status</th><th>Required Validation</th></tr></thead>
      <tbody><tr><td>C-0001</td><td class="placeholder">Material seller claim</td><td class="placeholder">Needs proof</td><td>E-0001</td></tr></tbody></table>
    </section>
    <section>
      <h2>Red Flags And Kill Tests</h2>
      <table><thead><tr><th>Red Flag</th><th>Impact</th><th>What Resolves It</th><th>Pause / Reprice / Pass Test</th></tr></thead>
      <tbody><tr><td>RF-0001</td><td class="placeholder">Decision impact</td><td class="placeholder">Required evidence</td><td class="gate">TBD</td></tr></tbody></table>
    </section>
    <section>
      <h2>First-Wave Seller Data Request</h2>
      <p class="note">Limit this section to evidence needed before deciding whether to proceed.</p>
      <table><thead><tr><th>ID</th><th>Gate</th><th>Requested Evidence</th><th>Acceptance Criteria</th></tr></thead>
      <tbody><tr><td>E-0001</td><td class="placeholder">First-wave gate</td><td class="placeholder">Exact seller request</td><td class="placeholder">TBD</td></tr></tbody></table>
    </section>
    <section>
      <h2>Quick Underwriting Implications</h2>
      <p class="note">Show preliminary math only when price and relevant reported cash flow or earnings are available; distinguish seller-reported figures from normalized underwriting.</p>
    </section>
    <section>
      <h2>Evidence, Limitations And Appendices</h2>
      <p class="note">Retain full linked claims, evidence, questions, red flags, and workplan schedules as support exports when needed for downstream diligence or modeling.</p>
    </section>
  </main>
</body>
</html>
"""
    path.write_text(html, encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/run_plan.py plan.json")
        return 1

    plan_path = Path(sys.argv[1])
    if not plan_path.exists():
        print(f"ERROR: plan file not found: {plan_path}")
        return 1

    plan_text = plan_path.read_text(encoding="utf-8")
    try:
        plan = json.loads(plan_text)
    except Exception as e:
        print(f"ERROR: failed to parse JSON: {e}")
        return 1

    output = plan.get("output") or {}
    output_dir = Path(output.get("output_dir", "outputs")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_dir = support_dir(output_dir)
    handoff_dir = handoffs_dir(output_dir)

    # Create required CSV templates
    for fname, headers in REQUIRED_FILES.items():
        fpath = csv_dir / fname
        if fpath.exists():
            print(f"[SKIP] {fpath} already exists")
        else:
            _write_csv(fpath, headers)
            print(f"[OK] wrote {fpath}")

    # Skeleton deal package JSON
    deal_pkg_path = handoff_dir / "deal_package.json"
    if not deal_pkg_path.exists():
        deal_pkg = {
            "deal": {
                "name": plan.get("deal_name", ""),
                "stage": plan.get("deal_stage", ""),
                "persona": plan.get("persona", ""),
                "as_of": plan.get("as_of", ""),
            },
            "documents": plan.get("inputs", {}),
            "claims": [],
            "evidence": [],
            "questions": [],
            "red_flags": [],
            "workplan": [],
            "links": [],
        }
        deal_pkg_path.write_text(json.dumps(deal_pkg, indent=2), encoding="utf-8")
        print(f"[OK] wrote {deal_pkg_path}")

    # Standalone report scaffold; structured schedules remain available as support artifacts.
    summary_path = output_dir / "cim_teardown_report.html"
    _write_html_report(summary_path, "CIM Teardown Report", plan)
    print(f"[OK] wrote {summary_path}")

    handoff_results = []
    handoff_overrides = {
        "transaction_context": plan.get("deal_name", "CIM teardown"),
        "deal_name": plan.get("deal_name", ""),
        "asset_type": "not_provided",
        "as_of_date": plan.get("as_of", ""),
        "source_scope": "CIM teardown scaffold",
        "circulation_caveats": [
            {
                "caveat": "Scaffold only until populated from extracted CIM evidence.",
                "impact": "not client-ready",
                "owner": "VP",
            }
        ],
    }
    for contract_name, consumer in [
        ("cim_teardown_to_memo_builder", "memo-builder"),
        ("cim_teardown_to_model_builder", "model-builders"),
    ]:
        handoff_results.append(
            write_handoff_payload(
                output_dir,
                contract_name,
                build_minimal_handoff_payload(contract_name, handoff_overrides),
                consumer_skill=consumer,
            )
        )

    # Manifest
    support_artifacts = [
        artifact_item(
            csv_dir / fname,
            "support_artifact",
            "csv",
            f"{fname} diligence scaffold table.",
            False,
            False,
            "CSV scaffold supports extraction and diligence tracking; it is not the report the banker should open first.",
        )
        for fname in REQUIRED_FILES
    ]
    support_artifacts.extend(
        [
            artifact_item(
                deal_pkg_path,
                "support_artifact",
                "json",
                "Legacy deal package support JSON.",
                False,
                False,
                "Legacy package JSON is machine-readable support; validated cross-skill handoffs live under handoffs/ with explicit contract metadata.",
            ),
            *[handoff_artifact_item(result) for result in handoff_results],
        ]
    )
    write_artifact_manifest(
        output_dir,
        "cim-teardown",
        "html_report",
        summary_path,
        support_artifacts=support_artifacts,
        blocked_or_partial_status={
            "status": "partial",
            "reason": "This is a scaffold until claim extraction and evidence review are populated.",
            "missing_inputs": [
                "Claim ledger",
                "Evidence checklist",
                "Red flag register",
                "Diligence workplan",
            ],
        },
        extra={
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "plan_path": str(plan_path),
            "plan_sha256": _sha256_text(plan_text),
            "handoffs": [
                {
                    "handoff_contract_name": result["handoff_contract_name"],
                    "path": result["path"],
                    "schema_path": result["schema_path"],
                    "validator_status": result["validator_status"],
                    "validated_at": result["validated_at"],
                    "consumer_skill": result["consumer_skill"],
                }
                for result in handoff_results
            ],
        },
    )
    print(f"[OK] wrote {output_dir / 'manifest.json'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
