from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "tests/fixtures/runtime_builder_input.json"
COMPS_INPUT = ROOT / "tests/fixtures/comps_analysis_input.csv"
CIM_PLAN = ROOT / "skills/cim-teardown/assets/templates/plan.example.json"
COVENANT_SCAN_INPUT = ROOT / "tests/fixtures/covenant_scan_text.txt"
COVENANT_HEADROOM_INPUT = ROOT / "tests/fixtures/covenant_tests.csv"
DISTRESSED_WATERFALL_INPUT = ROOT / "tests/fixtures/distressed_waterfall_input.json"


def is_json(text: str) -> bool:
    try:
        json.loads(text)
    except json.JSONDecodeError:
        return False
    return True


class RuntimeLightBuilderTests(unittest.TestCase):
    def run_builder(self, script: str, *args: str | Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(ROOT / script), *(str(arg) for arg in args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_manifest_primary(self, outdir: Path, suffix: str) -> dict:
        manifest = json.loads((outdir / "manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["primary_human_deliverable"].endswith(suffix), manifest)
        self.assertFalse(manifest["support_artifacts_user_visible_default"])
        self.assertTrue(manifest["support_artifacts"])
        return manifest

    def test_deal_process_tracker_builder(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/deal-process-tracker/scripts/build_process_tracker.py",
                "--input",
                INPUT,
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertFalse(is_json(result.stdout))
            self.assertTrue((out / "deal_process_tracker.xlsx").exists())
            self.assertFalse((out / "deal_process_dashboard.html").exists())
            self.assertFalse((out / "logs" / "deal_process_dashboard_contract.json").exists())
            with zipfile.ZipFile(out / "deal_process_tracker.xlsx") as archive:
                workbook_xml = archive.read("xl/workbook.xml").decode("utf-8")
            self.assertIn('name="Dashboard" sheetId="1"', workbook_xml)
            manifest = self.assert_manifest_primary(out, "deal_process_tracker.xlsx")
            self.assertEqual(manifest["companion_deliverables"], [])

    def test_model_audit_static_screen_keeps_workbook_primary_without_dashboard(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir = Path(tmpdir) / "source"
            out = Path(tmpdir) / "audit"
            source_result = self.run_builder(
                "skills/deal-process-tracker/scripts/build_process_tracker.py",
                "--input",
                INPUT,
                "--output-dir",
                source_dir,
            )
            self.assertEqual(
                source_result.returncode, 0, source_result.stderr + source_result.stdout
            )
            result = self.run_builder(
                "skills/model-audit-tieout/scripts/audit_workbook.py",
                source_dir / "deal_process_tracker.xlsx",
                "--out-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertNotIn("Warning", result.stderr)
            self.assertTrue(zipfile.is_zipfile(out / "model_audit_screen.xlsx"))
            self.assertFalse((out / "model_audit_report.html").exists())
            self.assertFalse((out / "logs" / "model_audit_dashboard_contract.json").exists())
            manifest = self.assert_manifest_primary(out, "model_audit_screen.xlsx")
            self.assertEqual(manifest["blocked_or_partial_status"]["status"], "partial")

    def test_scenario_sensitivity_scaffold_keeps_workbook_primary_without_dashboard(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "sensitivity"
            result = self.run_builder(
                "skills/scenario-sensitivity-generator/scripts/materialize_sensitivity_pack.py",
                "--mode",
                "merger_model",
                "--entity",
                "ExampleCo",
                "--transaction-version",
                "Corrected scenario-ready base",
                "--sensitivity-basis",
                "corrected_scenario_ready_base",
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(zipfile.is_zipfile(out / "sensitivity_pack.xlsx"))
            self.assertFalse((out / "sensitivity_dashboard.html").exists())
            self.assertFalse((out / "logs" / "sensitivity_dashboard_contract.json").exists())
            manifest = self.assert_manifest_primary(out, "sensitivity_pack.xlsx")
            self.assertEqual(manifest["companion_deliverables"], [])
            overlay = (out / "support" / "scenario_overlay.csv").read_text(encoding="utf-8")
            self.assertIn("sensitivity_basis", overlay)
            self.assertIn("corrected_scenario_ready_base", overlay)

    def test_meeting_prep_builder_outputs_html_and_docx(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/meeting-prep/scripts/build_meeting_prep_packet.py",
                "--input",
                INPUT,
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue((out / "meeting_prep_packet.html").exists())
            self.assertTrue(zipfile.is_zipfile(out / "meeting_prep_packet.docx"))
            html = (out / "meeting_prep_packet.html").read_text(encoding="utf-8")
            self.assertIn("Coverage Angles And Mandate Triggers", html)
            self.assertIn("Questions To Land", html)
            self.assertIn("Internal Guardrails", html)
            self.assertIn("Recommended Permissioned Next Step", html)
            self.assertIn("Evidence And Limitations", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertFalse((out / "logs" / "meeting_prep_dashboard_contract.json").exists())
            self.assert_manifest_primary(out, "meeting_prep_packet.html")

    def test_memo_builder_outputs_html_and_docx(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            payload = json.loads(INPUT.read_text(encoding="utf-8"))
            payload["executive_summary"] = (
                "Preserve this authored first-read summary in the standalone memo."
            )
            input_path = out / "memo_input.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            result = self.run_builder(
                "skills/memo-builder/scripts/build_memo_package.py",
                "--input",
                input_path,
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue((out / "investment_memo.html").exists())
            self.assertTrue(zipfile.is_zipfile(out / "investment_memo.docx"))
            html = (out / "investment_memo.html").read_text(encoding="utf-8")
            self.assertIn("Recommendation And Reliance Posture", html)
            self.assertIn("Executive Summary", html)
            self.assertIn("Preserve this authored first-read summary", html)
            self.assertIn("Load-Bearing Claims", html)
            self.assertIn("Diligence Required Before Reliance", html)
            self.assertIn("Sources And Calculation Notes", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertFalse((out / "logs" / "investment_memo_dashboard_contract.json").exists())
            self.assert_manifest_primary(out, "investment_memo.html")

    def test_comps_analysis_builder_flags_nm_and_source_dates(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/comps-valuation/scripts/build_comps_report.py",
                "--input",
                COMPS_INPUT,
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue((out / "comps_analysis_report.html").exists())
            self.assertTrue((out / "comps_workbook.xlsx").exists())
            html = (out / "comps_analysis_report.html").read_text(encoding="utf-8")
            self.assertIn("N/M", html)
            self.assertIn("missing as-of", html)
            self.assertIn("target's own trading level is a baseline", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertFalse((out / "logs" / "comps_report_dashboard_contract.json").exists())
            self.assert_manifest_primary(out, "comps_analysis_report.html")

    def test_style_profile_builder_keeps_json_support_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/investment-banking/internal-support/style-guide-adapter/scripts/build_style_profile.py",
                "--input",
                INPUT,
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue((out / "style_profile_report.html").exists())
            manifest = self.assert_manifest_primary(out, "style_profile_report.html")
            self.assertTrue(
                any(
                    item["path"].endswith("style_profile.json")
                    for item in manifest["support_artifacts"]
                )
            )
            self.assertFalse(manifest["primary_human_deliverable"].endswith(".json"))

    def test_cim_builder_defaults_to_standalone_html_document(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            payload = json.loads(INPUT.read_text(encoding="utf-8"))
            payload.update(
                {
                    "process_status": "signed_transaction_pending_approval",
                    "marketing_posture": "controlled_use_subject_to_counsel_clearance",
                }
            )
            input_path = out / "cim_input.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            result = self.run_builder(
                "skills/cim-builder/scripts/build_cim_package.py",
                "--input",
                input_path,
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            html = (out / "cim_storyboard.html").read_text(encoding="utf-8")
            self.assertIn("CIM Storyboard", html)
            self.assertIn("Page plan and exhibit architecture", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertFalse((out / "cim_storyboard.pptx").exists())
            self.assertFalse((out / "logs" / "cim_storyboard_contract.json").exists())
            self.assertTrue((out / "cim_package_plan.xlsx").exists())
            manifest = self.assert_manifest_primary(out, "cim_storyboard.html")
            self.assertEqual(manifest["process_status"], "signed_transaction_pending_approval")
            self.assertEqual(
                manifest["marketing_posture"],
                "controlled_use_subject_to_counsel_clearance",
            )

    def test_cim_builder_presentation_mode_makes_native_deck_primary(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/cim-builder/scripts/build_cim_package.py",
                "--input",
                INPUT,
                "--output-dir",
                out,
                "--presentation",
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(zipfile.is_zipfile(out / "cim_storyboard.pptx"))
            self.assertTrue((out / "cim_storyboard.html").exists())
            self.assert_manifest_primary(out, "cim_storyboard.pptx")

    def test_cim_teardown_scaffold_is_standalone_html_with_structured_support(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "outputs"
            plan_path = Path(tmpdir) / "plan.json"
            plan = json.loads(CIM_PLAN.read_text(encoding="utf-8"))
            plan["output"]["output_dir"] = str(out)
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_builder("skills/cim-teardown/scripts/run_plan.py", plan_path)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            html = (out / "cim_teardown_report.html").read_text(encoding="utf-8")
            self.assertIn("Initial IC Recommendation", html)
            self.assertIn("Claims That Matter Most", html)
            self.assertIn("Red Flags And Kill Tests", html)
            self.assertIn("First-Wave Seller Data Request", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertNotIn("<nav", html)
            self.assertFalse((out / "logs" / "cim_teardown_dashboard_contract.json").exists())
            self.assertTrue((out / "support" / "claims_ledger.csv").exists())
            self.assertTrue((out / "handoffs" / "deal_package.json").exists())
            manifest = self.assert_manifest_primary(out, "cim_teardown_report.html")
            self.assertEqual(manifest["blocked_or_partial_status"]["status"], "partial")

    def test_covenant_scanner_creates_standalone_html_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/covenant-package-analyzer/scripts/scan_covenant_package.py",
                COVENANT_SCAN_INPUT,
                "--outdir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            html = (out / "covenant_analysis_report.html").read_text(encoding="utf-8")
            self.assertIn("Covenant Package Scan Review", html)
            self.assertIn("Screening-only", html)
            self.assertIn("Required next steps", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertFalse((out / "logs" / "covenant_analysis_dashboard_contract.json").exists())
            self.assertTrue((out / "support" / "extracted_terms.csv").exists())
            self.assert_manifest_primary(out, "covenant_analysis_report.html")

    def test_covenant_headroom_keeps_workbook_primary_with_standalone_html_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/covenant-package-analyzer/scripts/calculate_covenant_headroom.py",
                COVENANT_HEADROOM_INPUT,
                "--outdir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            html = (out / "covenant_headroom_report.html").read_text(encoding="utf-8")
            self.assertIn("Covenant Headroom Summary", html)
            self.assertIn("Reliance gate", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertFalse((out / "logs" / "covenant_headroom_dashboard_contract.json").exists())
            self.assertTrue(zipfile.is_zipfile(out / "covenant_headroom.xlsx"))
            self.assert_manifest_primary(out, "covenant_headroom.xlsx")

    def test_distressed_waterfall_engine_keeps_workbook_primary_without_dashboard(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/distressed-recovery-waterfall/scripts/waterfall_engine.py",
                DISTRESSED_WATERFALL_INPUT,
                out / "waterfall.md",
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(zipfile.is_zipfile(out / "recovery_waterfall.xlsx"))
            self.assertTrue((out / "model_citations.json").exists())
            self.assertTrue((out / "waterfall.md").exists())
            self.assertFalse((out / "recovery_waterfall_dashboard.html").exists())
            self.assertFalse((out / "logs" / "recovery_waterfall_dashboard_contract.json").exists())
            manifest = self.assert_manifest_primary(out, "recovery_waterfall.xlsx")
            self.assertEqual(manifest["companion_deliverables"], [])

    def test_ib_deck_qc_extractor_creates_standalone_html_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "qc_out"
            text_input = Path(tmpdir) / "circulation_notes.txt"
            text_input.write_text(
                "Page 3: Adjusted EBITDA $12.0m. Page 5: Adjusted EBITDA $14.0m.",
                encoding="utf-8",
            )
            result = self.run_builder(
                "skills/ib-deck-qc/scripts/inspect_deck_report.py",
                text_input,
                "--outdir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            html = (out / "ib_deck_qc_report.html").read_text(encoding="utf-8")
            self.assertIn("First-pass review of circulation materials", html)
            self.assertIn("Required before circulation", html)
            self.assertNotIn("dashboard-shell", html)
            self.assertFalse((out / "logs" / "ib_deck_qc_dashboard_contract.json").exists())
            manifest = self.assert_manifest_primary(out, "ib_deck_qc_report.html")
            self.assertEqual(manifest["blocked_or_partial_status"]["status"], "partial")

    def test_pitch_builder_creates_standalone_html_fallback_without_dashboard_shell(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            result = self.run_builder(
                "skills/pitch-deck-builder/scripts/build_deck_storyboard_html.py",
                "--input",
                INPUT,
                "--output-dir",
                out,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue((out / "pitch_deck_storyboard.html").exists())
            self.assertFalse((out / "pitch_deck_storyboard.pptx").exists())
            self.assertFalse((out / "logs" / "pitch_storyboard_contract.json").exists())
            html = (out / "pitch_deck_storyboard.html").read_text(encoding="utf-8")
            self.assertIn("Standalone HTML Storyboard", html)
            self.assertIn("Proposed Deck Architecture", html)
            self.assertNotIn("dashboard-shell", html)
            manifest = self.assert_manifest_primary(out, "pitch_deck_storyboard.html")
            self.assertEqual(manifest["companion_deliverables"], [])


if __name__ == "__main__":
    unittest.main()
