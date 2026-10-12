import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path


class VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip_depth += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)


def visible_text(html):
    parser = VisibleTextParser()
    parser.feed(html)
    return " ".join(" ".join(parser.parts).split())


def run_renderer(script, contract, outdir, *extra, check=True, json_run_log=True):
    args = ["python3", str(script), "--contract", str(contract), "--outdir", str(outdir)]
    if json_run_log:
        args.append("--json-run-log")
    args.extend(extra)
    return subprocess.run(
        args,
        check=check,
        text=True,
        capture_output=True,
    )


def write_readiness_case(tmp_path, name):
    skill_dir = Path(__file__).resolve().parents[1]
    cases = json.loads(
        (skill_dir / "tests" / "fixtures" / "sample_citation_readiness_cases.json").read_text()
    )
    path = tmp_path / f"{name}.json"
    path.write_text(json.dumps(cases[name], indent=2), encoding="utf-8")
    return path


def test_renderer_stdout_is_human_by_default(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = skill_dir / "tests" / "fixtures" / "sample_report_only_contract.json"
    outdir = tmp_path / "human-default"

    result = run_renderer(script, contract, outdir, json_run_log=False)
    assert result.returncode == 0
    assert "Dashboard render complete" in result.stdout
    assert "report.html" in result.stdout
    try:
        json.loads(result.stdout)
    except json.JSONDecodeError:
        pass
    else:
        raise AssertionError("default renderer stdout should be human-readable, not JSON")


def test_render_dashboard_smoke(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = skill_dir / "tests" / "fixtures" / "sample_private_credit_dashboard_contract.json"
    outdir = tmp_path / "dashboard"

    result = run_renderer(script, contract, outdir)
    payload = json.loads(result.stdout)
    assert payload["status"] == "ok"
    assert payload["output_file"] == "dashboard.html"
    assert payload["generated_files"] == ["dashboard.html"]

    html = (outdir / "dashboard.html").read_text()
    text = visible_text(html)
    assert "Private Credit Underwriting Dashboard" in html
    assert "identity-lockup" in html
    assert "EXCO" in text
    assert "toc-list" in html
    assert "copy-button" in html
    assert "dashboard-utility-bar" in html
    assert "Reader actions" in html
    assert "Copy Full Report" in html
    assert "data-copy-full-report" in html
    assert "data-print-dashboard" in html
    assert "Print / Save PDF" in html
    assert "table-action-bar" in html
    assert "data-copy-table-tsv" in html
    assert "data-download-table-csv" in html
    assert 'data-table-export="true"' in html
    assert "citation-badge" in html
    assert "citation-link" in html
    assert "window.DASHBOARD_SOURCE_DATA" in html
    assert "citation-popover" in html
    assert 'href="#source-src-model"' in html
    assert 'id="source-src-model"' in html
    assert 'data-workbook-ref="Model!J42"' in html
    assert "ExampleCo_LBO_Model.xlsx#sheet=Model&amp;range=J42" in html
    assert "Base net leverage at close" in html
    assert 'id="source-model-output-base-returns-irr-fy2030"' in html
    assert "Needs source" in html
    assert 'href="https://example.com/lender-model"' in html
    assert "Hero Deliverable" not in text
    assert "Skill:" not in text
    assert "Mode:" not in text
    assert "Covenant Headroom" in html
    assert "dashboard_data.json" not in html
    assert not (outdir / "dashboard_data.json").exists()


def test_render_report_only_mode_with_blocked_context(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = skill_dir / "tests" / "fixtures" / "sample_report_only_contract.json"
    outdir = tmp_path / "report"

    result = run_renderer(script, contract, outdir)
    payload = json.loads(result.stdout)
    assert payload["status"] == "ok"
    assert payload["render_mode"] == "report_only"
    assert payload["output_file"] == "report.html"

    html = (outdir / "report.html").read_text()
    text = visible_text(html)
    assert "ExampleCo IC Memo" in html
    assert "Open Diligence Items" in html
    assert "Related Files" in html
    assert "Open table" in text
    assert "cohort_bridge.csv" not in text
    assert "copy-friendly" not in text
    assert "citation-badge" in html
    assert "citation-link" in html
    assert "window.DASHBOARD_SOURCE_DATA" in html
    assert 'href="#source-src1"' in html
    assert 'id="source-src1"' in html
    assert "Needs source" in html
    assert html.count('class="module-flow report-flow wide"') == 1
    assert html.count('class="report-subsection"') == 2
    assert '<span class="tile-label">Decision Read</span>' not in html
    assert "Grouped narrative sections for clean copy and paste." not in text
    assert "Inline source badges jump to these rows; hover a badge for source preview." not in text
    assert "Copy full analysis" in html
    assert "Copy Full Report" in html
    assert "data-copy-full-report" in html
    assert "data-print-dashboard" in html
    assert "data-copy-table-tsv" in html
    assert "data-download-table-csv" in html
    assert "data-open-primary-artifact" not in html
    assert not (outdir / "run_log.json").exists()


def test_citation_ux_smoke_payload(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = skill_dir / "tests" / "fixtures" / "sample_citation_ux_contract.json"
    outdir = tmp_path / "citation-ux"

    result = run_renderer(script, contract, outdir)
    payload = json.loads(result.stdout)
    assert payload["status"] == "ok"

    html = (outdir / "dashboard.html").read_text()
    assert 'class="citation-link" href="#source-s1"' in html
    assert "$15.0B</a>" in html
    assert "citation-chip citation-badge" in html
    assert "Section sources" in html
    assert 'id="source-s1"' in html
    assert 'id="source-s2"' in html
    assert 'href="https://example.com/external-closing-calendar" target="_blank"' in html
    assert 'data-citation-title="External closing calendar"' in html
    assert 'data-citation-detail="Example external-only citation preview."' in html
    assert "window.DASHBOARD_SOURCE_DATA" in html
    assert "Board package estimate" in html


def test_citation_validation_warns_on_unknown_ids_and_numeric_gaps(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = tmp_path / "bad_citations.json"
    contract.write_text(
        json.dumps(
            {
                "dashboard_title": "Citation Warning Fixture",
                "entity": "ExampleCo",
                "skill": "dashboard-builder",
                "hero": {
                    "headline": "Citation Warning Fixture",
                    "callout": "Revenue was $99.0M [NOPE].",
                },
                "deliverable": {"render_mode": "report_only"},
                "report_body": [
                    {
                        "id": "summary",
                        "title": "Summary",
                        "body": "Uncited EBITDA was $12.0M in 2026.",
                    }
                ],
                "sources": [{"id": "S1", "title": "Known source"}],
            }
        ),
        encoding="utf-8",
    )

    result = run_renderer(script, contract, tmp_path / "out")
    payload = json.loads(result.stdout)
    assert payload["status"] == "ok_with_warnings"
    warnings = "\n".join(payload["warnings"])
    assert "unknown source id 'NOPE'" in warnings
    assert "material numeric text without inline citation support" in warnings


def test_draft_posture_warns_on_citation_gaps_but_renders(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = write_readiness_case(tmp_path, "draft_warns")
    outdir = tmp_path / "draft-warns"

    result = run_renderer(script, contract, outdir)
    payload = json.loads(result.stdout)
    assert payload["status"] == "ok_with_warnings"
    assert payload["citation_policy"] == "block_for_senior"
    assert payload["readiness_posture"] == "draft"
    assert payload["blocking_errors"] == []
    assert payload["citation_warnings"]
    assert (outdir / "report.html").exists()


def test_committee_ready_citation_gap_blocks_without_html(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = write_readiness_case(tmp_path, "committee_blocks_unknown_id")
    outdir = tmp_path / "committee-block"

    result = run_renderer(script, contract, outdir, check=False)
    payload = json.loads(result.stdout)
    assert result.returncode != 0
    assert payload["status"] == "blocked_citation_validation"
    assert payload["readiness_posture"] == "committee-ready"
    assert payload["draft_override_available"] is True
    assert "unknown source id 'NOPE'" in "\n".join(payload["blocking_errors"])
    assert not (outdir / "report.html").exists()


def test_blocked_citation_validation_writes_support_json_only_when_requested(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = write_readiness_case(tmp_path, "committee_blocks_unknown_id")
    outdir = tmp_path / "committee-block-audit"

    result = run_renderer(script, contract, outdir, "--write-support-json", check=False)
    payload = json.loads(result.stdout)
    assert result.returncode != 0
    assert payload["status"] == "blocked_citation_validation"
    assert payload["support_json_written"] is True
    assert not (outdir / "report.html").exists()
    assert (outdir / "render_contract.audit.json").exists()
    assert (outdir / "citation_validation.audit.json").exists()
    assert (outdir / "run_log.json").exists()


def test_client_ready_numeric_gap_blocks_without_html(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = write_readiness_case(tmp_path, "client_blocks_numeric_gap")
    outdir = tmp_path / "client-block"

    result = run_renderer(script, contract, outdir, check=False)
    payload = json.loads(result.stdout)
    assert result.returncode != 0
    assert payload["status"] == "blocked_citation_validation"
    assert "material numeric text without inline citation support" in "\n".join(
        payload["blocking_errors"]
    )
    assert not (outdir / "report.html").exists()


def test_board_ready_missing_source_register_blocks(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = write_readiness_case(tmp_path, "board_blocks_missing_source_register")
    outdir = tmp_path / "board-block"

    result = run_renderer(script, contract, outdir, check=False)
    payload = json.loads(result.stdout)
    assert result.returncode != 0
    assert payload["status"] == "blocked_citation_validation"
    assert "no source register supplied" in "\n".join(payload["blocking_errors"])
    assert not (outdir / "report.html").exists()


def test_strict_policy_blocks_draft_citation_gaps(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = write_readiness_case(tmp_path, "strict_blocks_draft")
    outdir = tmp_path / "strict-block"

    result = run_renderer(script, contract, outdir, check=False)
    payload = json.loads(result.stdout)
    assert result.returncode != 0
    assert payload["status"] == "blocked_citation_validation"
    assert payload["citation_policy"] == "strict"
    assert payload["draft_override_available"] is False
    assert not (outdir / "report.html").exists()


def test_accept_draft_citation_gaps_downgrades_visible_posture(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = write_readiness_case(tmp_path, "committee_blocks_unknown_id")
    outdir = tmp_path / "accepted-draft"

    result = run_renderer(
        script,
        contract,
        outdir,
        "--accept-draft-citation-gaps",
        "--citation-gap-acceptance-reason",
        "User requested a draft review copy before source IDs are repaired.",
    )
    payload = json.loads(result.stdout)
    assert payload["status"] == "draft_with_citation_gaps"
    assert payload["accepted_draft_citation_gaps"] is True
    assert payload["effective_readiness_posture"] == "draft-with-citation-gaps"
    html = (outdir / "report.html").read_text()
    text = visible_text(html)
    assert "Draft With Citation Gaps" in text
    assert "Not for external circulation" in text


def test_gamestop_hybrid_fixture_uses_refreshed_shell(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = skill_dir / "tests" / "fixtures" / "sample_gamestop_ebay_hybrid_contract.json"
    outdir = tmp_path / "gme-ebay"

    result = run_renderer(script, contract, outdir)
    payload = json.loads(result.stdout)
    assert payload["status"] == "ok"
    assert payload["render_mode"] == "hybrid"
    assert payload["output_file"] == "GME_eBay_LBO_Analysis.html"

    html = (outdir / "GME_eBay_LBO_Analysis.html").read_text()
    text = visible_text(html)
    assert "identity-lockup" in html
    assert "GME" in text
    assert "<span>01</span>Summary" in html
    assert "<span>02</span>Analysis" in html
    assert "<span>03</span>Model Output" in html
    assert "<span>04</span>Risks" in html
    assert "<span>05</span>Diligence Gaps" in html
    assert "<span>06</span>Sources" in html
    assert "citation-badge" in html
    assert "citation-link" in html
    assert "window.DASHBOARD_SOURCE_DATA" in html
    assert 'data-citation-id="AP-2026-05-04"' in html
    assert 'href="#source-ap-2026-05-04"' in html
    assert 'id="source-ap-2026-05-04"' in html
    assert "copy-button" in html
    assert "dashboard-utility-bar" in html
    assert "Copy Full Report" in html
    assert "Print / Save PDF" in html
    assert "data-copy-table-tsv" in html
    assert "data-download-table-csv" in html
    assert "data-open-primary-artifact" in html
    assert "Open workbook" in html
    assert (
        "file:///Users/jcurran/Documents/Codex/2026-05-16/gamestop-is-preparing-for-a-leveraged/outputs/gme_ebay_lbo/GME_eBay_LBO_Model.xlsx"
        in html
    )
    assert html.count('class="module-flow report-flow wide"') == 1
    assert "Copy full analysis" in html
    assert "<h3>Full Analysis</h3>" not in html
    assert '<th class="is-numeric">IRR</th>' in html
    assert '<td class="is-numeric" data-label="IRR">' in html
    assert 'class="module-card" id="diligence-readiness"' in html
    assert 'class="module-card wide" id="diligence-readiness"' not in html
    assert "Open workbook" in text
    assert "GME_eBay_LBO_Model.xlsx" not in text

    forbidden = [
        "Skill:",
        "Mode:",
        "screen-grade-with-source-caveats",
        "screen-grade",
        "hero deliverable",
        "copy-friendly",
        "/Users/jcurran/Documents/Codex",
    ]
    for phrase in forbidden:
        assert phrase not in text


def test_support_json_is_explicit_opt_in(tmp_path):
    skill_dir = Path(__file__).resolve().parents[1]
    script = skill_dir / "scripts" / "render_dashboard.py"
    contract = skill_dir / "tests" / "fixtures" / "sample_report_only_contract.json"
    outdir = tmp_path / "report-json"

    result = run_renderer(script, contract, outdir, "--write-support-json")
    payload = json.loads(result.stdout)
    assert payload["support_json_written"] is True
    assert (outdir / "report.html").exists()
    assert (outdir / "render_contract.audit.json").exists()
    assert (outdir / "artifact_audit.json").exists()
    assert (outdir / "run_log.json").exists()

    audit = json.loads((outdir / "artifact_audit.json").read_text())
    assert audit["render_mode"] == "report_only"
    assert audit["blocked"] is True


def test_operational_control_assets_are_present():
    skill_dir = Path(__file__).resolve().parents[1]
    css = (skill_dir.parents[3] / "shared" / "dashboard" / "dashboard.css").read_text()
    js = (skill_dir.parents[3] / "shared" / "dashboard" / "dashboard.js").read_text()

    assert ".dashboard-utility-bar" in css
    assert ".table-action-bar" in css
    assert "@media print" in css
    assert ".table-action-bar" in css.split("@media print", 1)[1]
    assert "tableToTSV" in js
    assert "tableToCSV" in js
    assert "downloadBlob" in js
    assert "data-copy-full-report" in js
    assert "data-print-dashboard" in js


def test_dashboard_css_uses_flat_light_surface():
    skill_dir = Path(__file__).resolve().parents[1]
    css = (skill_dir.parents[3] / "shared" / "dashboard" / "dashboard.css").read_text()

    assert "--page: #ffffff;" in css
    assert "--surface-muted: #f8fafc;" in css
    assert "--surface-2: var(--surface-muted);" in css
    assert "--data-accent:" in css
    assert "--status-positive:" in css
    assert "--narrative-width: 72ch;" in css
    assert "font-variant-numeric: tabular-nums lining-nums;" in css
    assert ".sticky-first thead th" in css
    assert "min-height: 18px;" in css
    for elevated_effect in (
        "box-shadow",
        "linear-gradient",
        "radial-gradient",
        "backdrop-filter",
    ):
        assert elevated_effect not in css
