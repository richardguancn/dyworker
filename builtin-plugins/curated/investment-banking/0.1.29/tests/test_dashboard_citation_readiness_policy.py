from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTERNAL_SUPPORT_ROOT = ROOT / "skills" / "investment-banking" / "internal-support"
SOURCE_SKILLS = {
    "excel-data-cleaner",
    "financial-source-of-truth",
    "style-guide-adapter",
}
INTERNAL_SUPPORT_PLAYBOOKS = {
    "dashboard-builder",
    "excel-data-cleaner",
    "financial-source-of-truth",
    "style-guide-adapter",
}


def skill_doc(skill: str) -> Path:
    return (
        INTERNAL_SUPPORT_ROOT / skill / "INTERNAL.md"
        if skill in INTERNAL_SUPPORT_PLAYBOOKS
        else ROOT / "skills" / skill / "SKILL.md"
    )


def load_artifacts_module():
    path = ROOT / "shared" / "artifacts.py"
    spec = importlib.util.spec_from_file_location("ib_artifacts", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DashboardCitationReadinessPolicyTests(unittest.TestCase):
    def test_policy_reference_defines_hard_fail_postures(self) -> None:
        policy = (ROOT / "references" / "dashboard-citation-readiness-policy.md").read_text(
            encoding="utf-8"
        )
        for phrase in [
            "senior-review-ready",
            "client-ready",
            "committee-ready",
            "board-ready",
            "external",
            "unresolved `citation_ids`",
            "material numeric text without inline citation support",
            "Draft With Citation Gaps",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, policy)

    def test_source_skills_reference_dashboard_citation_readiness_gate(self) -> None:
        for skill in sorted(SOURCE_SKILLS):
            with self.subTest(skill=skill):
                text = skill_doc(skill).read_text(encoding="utf-8")
                self.assertIn("## Dashboard Citation Readiness", text)
                self.assertIn("../../references/dashboard-citation-readiness-policy.md", text)
                self.assertIn("Unknown citation IDs", text)
                self.assertIn("blocking readiness gaps", text)

    def test_dashboard_builder_skill_documents_blocking_behavior(self) -> None:
        text = skill_doc("dashboard-builder").read_text(encoding="utf-8")
        self.assertIn("Citation Readiness Gate", text)
        self.assertIn("block_for_senior", text)
        self.assertIn("Draft With Citation Gaps", text)

    def test_company_tearsheet_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("company-tearsheet").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)

    def test_cim_builder_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("cim-builder").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("Polished HTML CIM / storyboard (Recommended)", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_cim_teardown_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("cim-teardown").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_buyer_investor_list_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("buyer-investor-list").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)

    def test_meeting_prep_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("meeting-prep").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("local headless-browser screenshots", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_memo_builder_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("memo-builder").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("local headless-browser screenshots", text)
        self.assertIn("disclosed projections and synergy cases", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_pitch_deck_builder_uses_native_deck_evidence_gate(self) -> None:
        text = skill_doc("pitch-deck-builder").read_text(encoding="utf-8")
        self.assertIn("## Native Deck Evidence Readiness", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("Presentations", text)
        self.assertIn("final exported `.pptx`", text)
        self.assertIn("polished standalone HTML storyboard", text)
        self.assertIn(
            "Do not route an ordinary deck or HTML storyboard through `dashboard-builder`",
            text,
        )
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_ib_deck_qc_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("ib-deck-qc").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("local headless-browser screenshots", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_capital_markets_issuance_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("capital-markets-issuance").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)

    def test_comps_valuation_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("comps-valuation").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("opening valuation conclusion", text)
        self.assertIn("decision-critical public source links", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)

    def test_deal_process_tracker_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("deal-process-tracker").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("source register", text.lower())
        self.assertIn("public-process reconstruction", text)
        self.assertIn("Do not route an ordinary process tracker through `dashboard-builder`", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_dcf_model_builder_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("dcf-model-builder").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("model_citations", text)
        self.assertIn("calculation integrity", text.lower())
        self.assertIn("decision readiness", text.lower())
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_lbo_model_build_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("lbo-model-build").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("model_citations", text)
        self.assertIn("illustrative financing case", text)
        self.assertIn("Calculation integrity", text)
        self.assertIn("Decision readiness", text)
        self.assertIn("Do not route an ordinary LBO HTML summary through `dashboard-builder`", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_merger_model_builder_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("merger-model-builder").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("model_citations", text)
        self.assertIn("adjusted_eps_screen", text)
        self.assertIn("Calculation integrity", text)
        self.assertIn("Decision readiness", text)
        self.assertIn(
            "Do not route an ordinary merger-model HTML summary through `dashboard-builder`",
            text,
        )
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_model_audit_tieout_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("model-audit-tieout").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("model_citations", text)
        self.assertIn("Calculation integrity", text)
        self.assertIn("Decision readiness", text)
        self.assertIn("audit-indicative", text)
        self.assertIn(
            "Do not route an ordinary model audit or HTML audit summary through `dashboard-builder`",
            text,
        )
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_scenario_sensitivity_generator_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("scenario-sensitivity-generator").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("sensitivity basis", text.lower())
        self.assertIn("corrected scenario-ready base", text)
        self.assertIn("Calculation integrity", text)
        self.assertIn("Decision readiness", text)
        self.assertIn("base sensitivity cell", text)
        self.assertIn(
            "Do not route an ordinary sensitivity pack or HTML sensitivity summary through `dashboard-builder`",
            text,
        )
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_three_statement_model_builder_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("three-statement-model-builder").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("model_citations", text)
        self.assertIn("Calculation integrity", text)
        self.assertIn("Decision readiness", text)
        self.assertIn(
            "Do not route an ordinary three-statement-model HTML summary through `dashboard-builder`",
            text,
        )
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_financials_normalizer_uses_workbook_evidence_gate(self) -> None:
        text = skill_doc("financials-normalizer").read_text(encoding="utf-8")
        self.assertIn("## Workbook Evidence Readiness", text)
        self.assertIn("normalized ledgers are its evidence layer", text)
        self.assertIn("EBITDA readiness", text)
        self.assertIn("Net debt readiness", text)
        self.assertIn(
            "Do not route an ordinary normalization package through `dashboard-builder`", text
        )
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_covenant_package_analyzer_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("covenant-package-analyzer").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("Polished HTML covenant review memo (Recommended)", text)
        self.assertIn("do not return the entire completed memo as inline Markdown", text)
        self.assertIn("reader-facing evidence language", text)
        self.assertIn("two to four decision-gating questions", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_distressed_recovery_waterfall_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("distressed-recovery-waterfall").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("local headless-browser screenshots", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_private_credit_underwriting_uses_standalone_html_evidence_gate(self) -> None:
        text = skill_doc("private-credit-underwriting").read_text(encoding="utf-8")
        self.assertIn("## HTML Evidence Readiness", text)
        self.assertIn("../../references/html-artifact-standard.md", text)
        self.assertIn("readable point-of-use citation support", text)
        self.assertIn("Polished HTML lender underwriting memo (Recommended)", text)
        self.assertIn("local headless-browser screenshots", text)
        self.assertIn("illustrative standalone cash-interest screening ceiling", text)
        self.assertIn("reader-facing evidence language", text)
        self.assertNotIn("## Dashboard Citation Readiness", text)
        self.assertNotIn("## Dashboard Handoff", text)

    def test_shared_dashboard_contract_helper_sets_readiness_policy(self) -> None:
        artifacts = load_artifacts_module()
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "contract.json"
            artifacts.write_dashboard_contract(
                path,
                "unit-test-skill",
                "Unit Test Report",
                "ExampleCo",
                "report_only",
                Path(tmpdir) / "report.html",
                report_body=[{"heading": "Summary", "body": "Draft body."}],
            )
            contract = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(contract["posture"], "draft")
        self.assertEqual(contract["citation_policy"], "block_for_senior")
        self.assertEqual(contract["metadata"]["readiness_posture"], "draft")
        self.assertEqual(contract["metadata"]["citation_policy"], "block_for_senior")


if __name__ == "__main__":
    unittest.main()
