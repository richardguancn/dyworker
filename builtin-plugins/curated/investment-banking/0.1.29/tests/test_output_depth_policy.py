from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTERNAL_SUPPORT_ROOT = ROOT / "skills" / "investment-banking" / "internal-support"
INTERNAL_SUPPORT_PLAYBOOKS = {
    "dashboard-builder",
    "financial-source-of-truth",
    "excel-data-cleaner",
    "style-guide-adapter",
}

TARGET_SKILLS = [
    "buyer-investor-list",
    "company-tearsheet",
    "comps-valuation",
    "deal-process-tracker",
    "distressed-recovery-waterfall",
    "financial-source-of-truth",
    "financials-normalizer",
    "ib-deck-qc",
    "meeting-prep",
    "memo-builder",
    "model-audit-tieout",
    "private-credit-underwriting",
]

NARRATIVE_HTML_SKILLS = []

DELIVERABLE_FRAMEWORK_SKILLS = [
    *NARRATIVE_HTML_SKILLS,
    "private-credit-underwriting",
    "buyer-investor-list",
    "company-tearsheet",
    "capital-markets-issuance",
    "covenant-package-analyzer",
    "distressed-recovery-waterfall",
    "meeting-prep",
    "memo-builder",
    "model-audit-tieout",
    "pitch-deck-builder",
    "scenario-sensitivity-generator",
]

ARTIFACT_OWNING_SKILLS = {
    "buyer-investor-list",
    "capital-markets-issuance",
    "cim-builder",
    "cim-teardown",
    "company-tearsheet",
    "comps-valuation",
    "covenant-package-analyzer",
    "dcf-model-builder",
    "deal-process-tracker",
    "distressed-recovery-waterfall",
    "financials-normalizer",
    "ib-deck-qc",
    "lbo-model-build",
    "meeting-prep",
    "memo-builder",
    "merger-model-builder",
    "model-audit-tieout",
    "pitch-deck-builder",
    "private-credit-underwriting",
    "scenario-sensitivity-generator",
    "three-statement-model-builder",
}

POLICY_REFERENCED_REFS = [
    "skills/company-tearsheet/references/integration-guide.md",
    "skills/company-tearsheet/references/profile-templates.md",
    "skills/company-tearsheet/references/source-and-evidence.md",
    "skills/company-tearsheet/references/quality-checks.md",
    "skills/comps-valuation/references/workflow-and-qa.md",
    "skills/deal-process-tracker/references/tracker-schema.md",
    "skills/distressed-recovery-waterfall/references/output-templates.md",
    "skills/investment-banking/internal-support/financial-source-of-truth/references/citation-and-ledger-format.md",
    "skills/ib-deck-qc/references/output-templates.md",
    "skills/meeting-prep/references/output-templates.md",
    "skills/private-credit-underwriting/references/output-templates.md",
    "skills/private-credit-underwriting/references/underwriting-playbook.md",
    "skills/private-credit-underwriting/references/examples.md",
    "skills/buyer-investor-list/references/workflow.md",
    "skills/covenant-package-analyzer/references/output-templates.md",
]

PROHIBITED_DEFAULT_SHORTENING_PHRASES = [
    "Default one-page",
    "default one-page",
    "Use the smallest artifact",
    "smallest artifact",
    "fast, cited, and compact",
    "quick credit screen with go",
    "Keep the first answer concise",
    "For chat-only answers, collapse these into concise",
    "When returning in chat, keep the answer concise",
    "Render the markdown memo or lightweight table artifact",
    "Use when the user needs a fast answer.",
    "converted into a concise memo",
    "Default output: concise",
]

PROHIBITED_LEGACY_DELIVERABLE_PHRASES = [
    "markdown-first",
    "chat-first",
    "extended markdown",
    "markdown memo in chat",
    "readable markdown diligence report in chat",
    "markdown diligence report in chat",
    "extended markdown comps memo",
    "committee-ready markdown credit memo",
    "extended markdown tearsheet",
    "compose an extended markdown profile by default",
    "the memo must stand alone in chat",
    "keep the primary deliverable in chat",
    "return a markdown storyboard",
]


def skill_doc(skill: str) -> Path:
    return (
        INTERNAL_SUPPORT_ROOT / skill / "INTERNAL.md"
        if skill in INTERNAL_SUPPORT_PLAYBOOKS
        else ROOT / "skills" / skill / "SKILL.md"
    )


class OutputDepthPolicyTests(unittest.TestCase):
    def test_shared_policy_exists_and_names_shortening_exceptions(self) -> None:
        policy = (ROOT / "references" / "output-depth-policy.md").read_text(encoding="utf-8")
        self.assertIn("Default to `extended_analysis`", policy)
        self.assertIn("Use a shorter format only when", policy)
        self.assertIn("explicit", policy.lower())
        self.assertIn("If in doubt, choose `extended_analysis`", policy)

    def test_lead_policies_own_output_defaults_while_manifest_prompt_stays_concise(
        self,
    ) -> None:
        manifest = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        default_prompts = manifest["interface"]["defaultPrompt"]
        router = (ROOT / "skills" / "investment-banking" / "SKILL.md").read_text(encoding="utf-8")
        format_policy = (ROOT / "references" / "deliverable-format-policy.md").read_text(
            encoding="utf-8"
        )

        self.assertTrue(all(len(prompt) <= 128 for prompt in default_prompts))
        self.assertEqual(
            default_prompts,
            [
                "Help me get started",
                "Prepare a coverage meeting brief for Apple using public sources, with strategic questions and likely discussion topics",
                "Build a trading comps valuation for CrowdStrike using public sources and explain the peer set",
            ],
        )
        self.assertIn("The router does not perform deliverable intake", router)
        self.assertIn("The lead owner, not the router", router)
        self.assertIn("they are not router-stage decision rules", router)
        self.assertIn("references/html-artifact-standard.md", router)
        self.assertIn("let that skill own its polished standalone HTML structure directly", router)
        self.assertIn("polished standalone HTML report", format_policy)
        self.assertNotIn("Default to full-depth analysis", router)

    def test_target_skills_reference_policy_and_default_extended(self) -> None:
        for skill in TARGET_SKILLS:
            with self.subTest(skill=skill):
                text = skill_doc(skill).read_text(encoding="utf-8")
                self.assertIn("extended_analysis", text)
                self.assertIn("../../references/output-depth-policy.md", text)
                self.assertIn("explicit", text.lower())

    def test_reference_files_no_longer_teach_short_as_default(self) -> None:
        for rel_path in POLICY_REFERENCED_REFS:
            with self.subTest(reference=rel_path):
                text = (ROOT / rel_path).read_text(encoding="utf-8")
                for phrase in PROHIBITED_DEFAULT_SHORTENING_PHRASES:
                    self.assertNotIn(phrase, text)

    def test_deliverable_framework_rejects_legacy_markdown_first_defaults(self) -> None:
        paths = []
        for skill in DELIVERABLE_FRAMEWORK_SKILLS:
            paths.append(ROOT / "skills" / skill / "SKILL.md")
            paths.extend((ROOT / "skills" / skill / "references").glob("*.md"))
            paths.extend((ROOT / "skills" / skill / "agents").glob("*.yaml"))
        for path in paths:
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8").lower()
            with self.subTest(path=str(path.relative_to(ROOT))):
                for phrase in PROHIBITED_LEGACY_DELIVERABLE_PHRASES:
                    self.assertNotIn(phrase, text)

    def test_substantial_narrative_skills_route_to_dashboard_builder(self) -> None:
        for skill in NARRATIVE_HTML_SKILLS:
            with self.subTest(skill=skill):
                text = (ROOT / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
                self.assertIn("dashboard-builder", text)
                self.assertIn("report_only", text)
                self.assertIn("HTML", text)
                self.assertIn("extended_analysis", text)

    def test_company_tearsheet_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "company-tearsheet" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "company-tearsheet" / "references" / "profile-templates.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "company-tearsheet" / "references" / "quality-checks.md"
        ).read_text(encoding="utf-8")
        markdown_helper = (
            ROOT / "skills" / "company-tearsheet" / "scripts" / "build_tearsheet_markdown.py"
        ).read_text(encoding="utf-8")
        standard = (ROOT / "references" / "html-artifact-standard.md").read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML banker tearsheet", skill)
        self.assertIn("Do not route an ordinary tearsheet through `dashboard-builder`", skill)
        self.assertIn("baseline_tearsheet", skill)
        self.assertIn("coverage_screen", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("Standalone HTML Coverage Screen", templates)
        self.assertIn("One consolidated `Questions To Resolve Before A Pitch`", templates)
        self.assertIn("fixed dashboard contract", quality)
        self.assertIn("Producer skills own their standalone HTML structure", standard)
        self.assertIn(
            "Skills migrated to `../../../../../references/html-artifact-standard.md`",
            dashboard_playbook,
        )
        self.assertNotIn("`company-tearsheet`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", markdown_helper)
        self.assertNotIn("render_html_report", markdown_helper)

    def test_buyer_investor_list_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "buyer-investor-list" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "buyer-investor-list" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        scoring = (
            ROOT / "skills" / "buyer-investor-list" / "references" / "scoring-framework.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "buyer-investor-list" / "references" / "qa-checklist.md"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML buyer-universe report", skill)
        self.assertIn(
            "Do not route an ordinary buyer-universe HTML report through `dashboard-builder`",
            skill,
        )
        self.assertIn("Conditional Wave 1", skill)
        self.assertIn("focused on actionable and conditionally actionable parties", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("Standalone HTML buyer-universe report", templates)
        self.assertIn("only in the dedicated hold register", templates)
        self.assertIn("Use one consolidated table", templates)
        self.assertIn("Scoring is a working analytical tool", scoring)
        self.assertIn("generic dashboard navigation", quality)
        self.assertIn("dedicated hold register", quality)
        self.assertNotIn("`buyer-investor-list`", dashboard_playbook)

    def test_meeting_prep_uses_standalone_html_coverage_architecture(self) -> None:
        skill = (ROOT / "skills" / "meeting-prep" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "meeting-prep" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        questions = (
            ROOT / "skills" / "meeting-prep" / "references" / "question-and-diligence-bank.md"
        ).read_text(encoding="utf-8")
        helper = (
            ROOT / "skills" / "meeting-prep" / "scripts" / "build_meeting_prep_packet.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML meeting brief", skill)
        self.assertIn(
            "treat the presentation surface as resolved to a polished standalone HTML meeting brief",
            skill,
        )
        self.assertIn("When HTML is requested, selected, or defaulted", skill)
        self.assertIn(
            "Do not route an ordinary meeting-prep HTML brief through `dashboard-builder`",
            skill,
        )
        self.assertIn("`coverage_meeting`", skill)
        self.assertIn("three to five core questions", skill)
        self.assertIn("no more than two or three conditional follow-up prompts", skill)
        self.assertIn("one preferred permissioned next step", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("Standalone HTML Coverage Meeting Brief", templates)
        self.assertIn("one consolidated prioritized table", templates)
        self.assertIn("Recommended Permissioned Next Step", templates)
        self.assertIn("three to five questions", questions)
        self.assertFalse(
            (ROOT / "skills" / "meeting-prep" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`meeting-prep`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)

    def test_memo_builder_uses_standalone_html_memo_architecture(self) -> None:
        skill = (ROOT / "skills" / "memo-builder" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "memo-builder" / "references" / "memo-modes-and-templates.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "memo-builder" / "references" / "quality-checks-and-examples.md"
        ).read_text(encoding="utf-8")
        helper = (ROOT / "skills" / "memo-builder" / "scripts" / "build_memo_package.py").read_text(
            encoding="utf-8"
        )
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML internal memo", skill)
        self.assertIn("Do not route an ordinary HTML memo through `dashboard-builder`", skill)
        self.assertIn("disclosed transaction projections", skill)
        self.assertIn("strategic rationale as `disclosed`, `stated`, or `board-considered`", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("Standalone HTML Internal Deal-Team Memo", templates)
        self.assertIn("A filing establishes disclosure and process context", templates)
        self.assertIn("memo plan and control records as support artifacts", templates)
        self.assertIn("generic dashboard shell", templates)
        self.assertIn("internal render/control mechanics", quality)
        self.assertIn("Filing-only rationale", quality)
        self.assertFalse(
            (ROOT / "skills" / "memo-builder" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`memo-builder`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)

    def test_ib_deck_qc_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "ib-deck-qc" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "ib-deck-qc" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        extraction = (
            ROOT / "skills" / "ib-deck-qc" / "references" / "extraction-and-tieout.md"
        ).read_text(encoding="utf-8")
        playbook = (ROOT / "skills" / "ib-deck-qc" / "references" / "qc-playbook.md").read_text(
            encoding="utf-8"
        )
        helper = (ROOT / "skills" / "ib-deck-qc" / "scripts" / "inspect_deck_report.py").read_text(
            encoding="utf-8"
        )
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML QC report", skill)
        self.assertIn(
            "Do not route an ordinary circulation QC HTML report through `dashboard-builder`",
            skill,
        )
        self.assertIn("compact banker redline memo", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("Standalone HTML QC report", templates)
        self.assertIn("Visual evidence for confirmed blockers", templates)
        self.assertIn("small excerpt or thumbnail", extraction)
        self.assertIn("Standalone HTML report review", playbook)
        self.assertFalse(
            (ROOT / "skills" / "ib-deck-qc" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`ib-deck-qc`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)
        self.assertIn("<th>ID</th>", helper)
        self.assertIn('escape(issue["issue_id"])', helper)

    def test_cim_teardown_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "cim-teardown" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "cim-teardown" / "references" / "report-template.md"
        ).read_text(encoding="utf-8")
        schema = (ROOT / "skills" / "cim-teardown" / "references" / "output-schemas.md").read_text(
            encoding="utf-8"
        )
        helper = (ROOT / "skills" / "cim-teardown" / "scripts" / "run_plan.py").read_text(
            encoding="utf-8"
        )
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML diligence report", skill)
        self.assertIn(
            "Do not route an ordinary CIM teardown HTML report through `dashboard-builder`",
            skill,
        )
        self.assertIn("Claims That Matter Most", skill)
        self.assertIn("Red Flags And Kill Tests", skill)
        self.assertIn("First-Wave Seller Data Request", skill)
        self.assertIn("one primary first-read gating/red-flag table", skill)
        self.assertIn("Do not add a navigation bar or table-of-contents strip", skill)
        self.assertIn("`blocked_or_partial_status.status` to `partial`", skill)
        self.assertIn("Stable `C-`, `E-`, `Q-`, `RF-`, and `T-` IDs", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("Standalone HTML Report", templates)
        self.assertIn("no separate open-diligence section", templates)
        self.assertIn("one primary first-read gating/red-flag table", templates)
        self.assertIn("mark manifest posture as `partial`", templates)
        self.assertIn("navigation bar or contents strip", templates)
        self.assertIn("standalone decision-grade HTML report", schema)
        self.assertIn("blocked_or_partial_status.status` is `partial`", schema)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)
        self.assertNotIn("`cim-teardown`", dashboard_playbook)

    def test_comps_valuation_report_mode_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "comps-valuation" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "comps-valuation" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "comps-valuation" / "references" / "workflow-and-qa.md"
        ).read_text(encoding="utf-8")
        helper = (
            ROOT / "skills" / "comps-valuation" / "scripts" / "build_comps_report.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML comps valuation report", skill)
        self.assertIn(
            "Do not route an ordinary trading-comps HTML report through `dashboard-builder`",
            skill,
        )
        self.assertIn("target company's current trading multiple is a market baseline", skill)
        self.assertIn("one true external comparable", skill)
        self.assertIn("Illustrative Midpoint", skill)
        self.assertIn("Public Comps Uplift", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("Standalone HTML Valuation Report", templates)
        self.assertIn("Target Trading Baseline", templates)
        self.assertIn("one true external anchor", templates)
        self.assertIn("Illustrative Midpoint", templates)
        self.assertIn("Premium Range", templates)
        self.assertIn("target current trading is labeled as a baseline", quality)
        self.assertIn("decision-critical public URLs", quality)
        self.assertIn("control-premium scenarios are separated", quality)
        self.assertNotIn("`comps-valuation`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)

    def test_deal_process_tracker_uses_workbook_only_architecture(self) -> None:
        skill = (ROOT / "skills" / "deal-process-tracker" / "SKILL.md").read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "deal-process-tracker" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "deal-process-tracker" / "references" / "quality-checks.md"
        ).read_text(encoding="utf-8")
        builder = (
            ROOT / "skills" / "deal-process-tracker" / "scripts" / "build_process_tracker.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("polished XLSX tracker", skill)
        self.assertIn("## Workbook Evidence Readiness", skill)
        self.assertIn("### Public-Process Reconstruction", skill)
        self.assertIn("This skill does not own a narrative HTML report mode", skill)
        self.assertIn(
            "Do not route an ordinary process tracker through `dashboard-builder`",
            skill,
        )
        self.assertIn("Public-process reconstruction workbook", templates)
        self.assertIn("first visible tab is an executive `Dashboard`", quality)
        self.assertFalse(
            (ROOT / "skills" / "deal-process-tracker" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`deal-process-tracker`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", builder)
        self.assertNotIn("render_html_dashboard", builder)

    def test_dcf_model_builder_uses_workbook_first_architecture(self) -> None:
        skill = (ROOT / "skills" / "dcf-model-builder" / "SKILL.md").read_text(encoding="utf-8")
        output_spec = (
            ROOT / "skills" / "dcf-model-builder" / "references" / "output-spec.md"
        ).read_text(encoding="utf-8")
        formula_contract = (
            ROOT
            / "skills"
            / "dcf-model-builder"
            / "references"
            / "banker-formula-workbook-contract.md"
        ).read_text(encoding="utf-8")
        review = (
            ROOT / "skills" / "dcf-model-builder" / "references" / "output-and-review.md"
        ).read_text(encoding="utf-8")
        judgment = (
            ROOT / "skills" / "dcf-model-builder" / "references" / "valuation-judgment.md"
        ).read_text(encoding="utf-8")
        sensitivities = (
            ROOT / "skills" / "dcf-model-builder" / "references" / "sensitivity-and-scenarios.md"
        ).read_text(encoding="utf-8")
        qa = (ROOT / "skills" / "dcf-model-builder" / "references" / "qa-checks.md").read_text(
            encoding="utf-8"
        )
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("normal hero deliverable is a polished banker-readable workbook", skill)
        self.assertIn("## Workbook Evidence Readiness", skill)
        self.assertIn("## Optional HTML Companion", skill)
        self.assertIn(
            "Do not route an ordinary DCF HTML summary through `dashboard-builder`",
            skill,
        )
        self.assertIn("Calculation integrity", output_spec)
        self.assertIn("Decision readiness", output_spec)
        self.assertIn("two explicitly labeled status fields", skill)
        self.assertIn("Market-Implied Expectations", output_spec)
        self.assertIn("controlled numeric reverse-DCF", output_spec)
        self.assertIn("composite scenario alone does not satisfy", output_spec)
        self.assertIn("full displayed sensitivity spread", output_spec)
        self.assertIn("different installed plugin version", formula_contract)
        self.assertIn("explicit result or match count", formula_contract)
        self.assertIn("unqualified `Model checks: OK`", review)
        self.assertIn("material premium or discount", judgment)
        self.assertIn("Composite scenario proximity", judgment)
        self.assertIn("composite scenario range", sensitivities)
        self.assertIn("`Downside`, `Base`, `Upside`", sensitivities)
        self.assertIn("full displayed sensitivity spread", sensitivities)
        self.assertIn("controlled numeric solution", sensitivities)
        self.assertIn("high terminal-value concentration", qa)
        self.assertIn("complete material dependency set", qa)
        self.assertIn("controlled numeric reverse-DCF solution", qa)
        self.assertIn("formula-error scan results", qa)
        self.assertIn("material upstream operating", skill)
        self.assertIn("controlled numeric reverse-DCF output", skill)
        self.assertIn("transient console output", skill)
        self.assertFalse(
            (ROOT / "skills" / "dcf-model-builder" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("dcf-model-builder", dashboard_playbook)

    def test_three_statement_model_builder_uses_workbook_first_architecture(self) -> None:
        skill = (ROOT / "skills" / "three-statement-model-builder" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        output_spec = (
            ROOT / "skills" / "three-statement-model-builder" / "references" / "output-spec.md"
        ).read_text(encoding="utf-8")
        formula_contract = (
            ROOT
            / "skills"
            / "three-statement-model-builder"
            / "references"
            / "banker-formula-workbook-contract.md"
        ).read_text(encoding="utf-8")
        review = (
            ROOT
            / "skills"
            / "three-statement-model-builder"
            / "references"
            / "output-and-review.md"
        ).read_text(encoding="utf-8")
        qa = (
            ROOT / "skills" / "three-statement-model-builder" / "references" / "qa-checks.md"
        ).read_text(encoding="utf-8")
        runtime = (
            ROOT
            / "skills"
            / "three-statement-model-builder"
            / "scripts"
            / "build_banker_formula_workbook_runtime"
        ).read_text(encoding="utf-8")
        deterministic_runtime = (
            ROOT / "skills" / "three-statement-model-builder" / "scripts" / "run_pipeline_runtime"
        ).read_text(encoding="utf-8")
        deterministic_core = (
            ROOT / "skills" / "three-statement-model-builder" / "scripts" / "skill_core_runtime"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("normal hero deliverable is a polished banker-readable workbook", skill)
        self.assertIn("## Workbook Evidence Readiness", skill)
        self.assertIn("## Optional HTML Companion", skill)
        self.assertIn(
            "Do not route an ordinary three-statement-model HTML summary through `dashboard-builder`",
            skill,
        )
        self.assertIn("Calculation integrity", output_spec)
        self.assertIn("Decision readiness", output_spec)
        self.assertIn("exact workbook returned as the hero deliverable", output_spec)
        self.assertIn("model_citations.json", formula_contract)
        self.assertIn("exact workbook delivered to the user", qa)
        self.assertIn("debt draws and cash sweeps", review)
        self.assertIn("Model status: OK", review)
        self.assertIn("every visible status block", qa)
        self.assertIn('"A8": "Decision readiness"', runtime)
        self.assertIn('"A9": "Calculation integrity"', runtime)
        self.assertIn('"A22": "Calculation integrity"', runtime)
        self.assertIn('"A21": "Decision readiness"', runtime)
        self.assertIn("requires_recalculation", runtime)
        self.assertIn("workbook-section outline", runtime)
        self.assertIn('"metric": "Calculation integrity"', deterministic_runtime)
        self.assertIn('"metric": "Decision readiness"', deterministic_runtime)
        self.assertIn('"check": "Calculation integrity"', deterministic_runtime)
        self.assertIn('"check": "Decision readiness"', deterministic_runtime)
        self.assertIn('"formula_error_scan"', deterministic_runtime)
        self.assertIn("LIQUIDITY_COVENANT_SUPPORT_UNVALIDATED", deterministic_core)
        self.assertFalse(
            (
                ROOT
                / "skills"
                / "three-statement-model-builder"
                / "references"
                / "dashboard-map.md"
            ).exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`three-statement-model-builder`", dashboard_playbook)

    def test_financials_normalizer_uses_workbook_first_financing_architecture(self) -> None:
        skill = (ROOT / "skills" / "financials-normalizer" / "SKILL.md").read_text(encoding="utf-8")
        schema = (
            ROOT / "skills" / "financials-normalizer" / "references" / "normalization-schema.md"
        ).read_text(encoding="utf-8")
        qa = (ROOT / "skills" / "financials-normalizer" / "references" / "qa-rules.md").read_text(
            encoding="utf-8"
        )
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("normal hero deliverable is a polished banker-readable workbook", skill)
        self.assertIn("## Workbook Evidence Readiness", skill)
        self.assertIn("## Optional HTML Companion", skill)
        self.assertIn("EBITDA_Treatment_Matrix", skill)
        self.assertIn("Net_Debt_Treatment_Matrix", skill)
        self.assertIn("Management-Projected EBITDA", skill)
        self.assertIn("Management-Projected FY2025E Adj. EBITDA", skill)
        self.assertIn("Committed Buyer Debt (Context Only)", skill)
        self.assertIn("Reported statement integrity", skill)
        self.assertIn(
            "Do not route an ordinary normalization package through `dashboard-builder`",
            skill,
        )
        self.assertIn("### EBITDA_Treatment_Matrix", schema)
        self.assertIn("### Net_Debt_Treatment_Matrix", schema)
        self.assertIn("lender-approved LTM EBITDA", schema)
        self.assertIn("Financing model handoff", schema)
        self.assertIn("audit ledgers", schema)
        self.assertIn("Financing and Take-Private Treatment Checks", qa)
        self.assertIn("management-projected or forecast", qa)
        self.assertIn("Workbook Readability and First-Read QA", qa)
        self.assertFalse(
            (ROOT / "skills" / "financials-normalizer" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`financials-normalizer`", dashboard_playbook)

    def test_model_audit_tieout_uses_workbook_first_audit_architecture(self) -> None:
        skill = (ROOT / "skills" / "model-audit-tieout" / "SKILL.md").read_text(encoding="utf-8")
        playbook = (
            ROOT / "skills" / "model-audit-tieout" / "references" / "audit-playbook.md"
        ).read_text(encoding="utf-8")
        templates = (
            ROOT / "skills" / "model-audit-tieout" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        tieout = (
            ROOT / "skills" / "model-audit-tieout" / "references" / "tieout-and-source-checks.md"
        ).read_text(encoding="utf-8")
        helper = (
            ROOT / "skills" / "model-audit-tieout" / "scripts" / "audit_workbook.py"
        ).read_text(encoding="utf-8")
        routing_map = (ROOT / "references" / "plugin-routing-map.json").read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "normal hero deliverable is a polished banker-readable workbook audit pack", skill
        )
        self.assertIn("## Workbook Evidence Readiness", skill)
        self.assertIn("## Optional HTML Companion", skill)
        self.assertIn("audit-indicative", skill)
        self.assertIn("Calculation integrity", skill)
        self.assertIn("Decision readiness", skill)
        self.assertIn(
            "Do not route an ordinary model audit or HTML audit summary through `dashboard-builder`",
            skill,
        )
        self.assertIn("### Merger / accretion-dilution", playbook)
        self.assertIn("## Audit-indicative diagnostic bridges", playbook)
        self.assertIn("Full workbook audit-pack layout", templates)
        self.assertIn("Audit pack status", templates)
        self.assertIn("Audited model readiness", templates)
        self.assertIn("adjustment incorporated", skill)
        self.assertIn("residual unresolved gap", playbook)
        self.assertIn(
            "do not collapse both concepts into a single `Change / gap` column", templates
        )
        self.assertIn("audit_diagnostic", tieout)
        self.assertFalse(
            (ROOT / "skills" / "model-audit-tieout" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`model-audit-tieout`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)
        self.assertNotIn("model_audit_report.html", routing_map)
        self.assertIn("model_audit_pack.xlsx", routing_map)

    def test_lbo_model_build_uses_workbook_first_underwriting_architecture(self) -> None:
        skill = (ROOT / "skills" / "lbo-model-build" / "SKILL.md").read_text(encoding="utf-8")
        output_spec = (
            ROOT / "skills" / "lbo-model-build" / "references" / "deep" / "output-spec"
        ).read_text(encoding="utf-8")
        workflow = (
            ROOT
            / "skills"
            / "lbo-model-build"
            / "references"
            / "deep"
            / "workflow-and-mode-selection"
        ).read_text(encoding="utf-8")
        qa = (ROOT / "skills" / "lbo-model-build" / "references" / "deep" / "qa-checks").read_text(
            encoding="utf-8"
        )
        source_contract = (
            ROOT
            / "skills"
            / "lbo-model-build"
            / "references"
            / "deep"
            / "source-and-assumption-contract"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("normal hero deliverable is a polished banker-readable workbook", skill)
        self.assertIn("## Workbook Evidence Readiness", skill)
        self.assertIn("## Optional HTML Companion", skill)
        self.assertIn("Excel sponsor LBO workbook (Recommended)", skill)
        self.assertIn("illustrative financing case", skill)
        self.assertIn("public-source screening case", skill)
        self.assertIn("periodicity/annualization", skill)
        self.assertIn(
            "Do not route an ordinary LBO HTML summary through `dashboard-builder`",
            skill,
        )
        self.assertIn("Calculation integrity", output_spec)
        self.assertIn("Decision readiness", output_spec)
        self.assertIn("financing sensitivity", output_spec)
        self.assertIn("integrated downside case does not substitute", output_spec)
        self.assertIn("screening_model", workflow)
        self.assertIn("When financing terms are assumed", workflow)
        self.assertIn("integrated downside case alone is insufficient", workflow)
        self.assertIn("operating/exit-value returns sensitivity", skill)
        self.assertIn("revolver-capacity or incremental-equity-cure view", skill)
        self.assertIn("do not leave that distinction only on a later checks sheet", skill)
        self.assertIn("Hold period displays in years", qa)
        self.assertIn("5.0x", qa)
        self.assertIn("integrated downside case alone does not satisfy", qa)
        self.assertIn("Quarterly models annualize", qa)
        self.assertIn("Returns place exit proceeds at the end of the stated hold period", qa)
        self.assertIn("substitute workbook", qa)
        self.assertIn("final debt or closing sources and uses", source_contract)
        self.assertFalse(
            (ROOT / "skills" / "lbo-model-build" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`lbo-model-build`", dashboard_playbook)

    def test_merger_model_builder_uses_workbook_first_accretion_architecture(self) -> None:
        skill = (ROOT / "skills" / "merger-model-builder" / "SKILL.md").read_text(encoding="utf-8")
        output_spec = (
            ROOT / "skills" / "merger-model-builder" / "references" / "deep" / "output-spec"
        ).read_text(encoding="utf-8")
        workflow = (
            ROOT
            / "skills"
            / "merger-model-builder"
            / "references"
            / "deep"
            / "workflow-and-mode-selection"
        ).read_text(encoding="utf-8")
        qa = (
            ROOT / "skills" / "merger-model-builder" / "references" / "deep" / "qa-checks"
        ).read_text(encoding="utf-8")
        plan_schema = (
            ROOT / "skills" / "merger-model-builder" / "references" / "deep" / "plan-schema"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("normal hero deliverable is a polished banker-readable workbook", skill)
        self.assertIn("## Workbook Evidence Readiness", skill)
        self.assertIn("## Optional HTML Companion", skill)
        self.assertIn("Excel merger / accretion workbook (Recommended)", skill)
        self.assertIn("`adjusted_eps_screen`", skill)
        self.assertIn("`gaap_accretion_model`", skill)
        self.assertIn("`implied cost-to-achieve`", skill)
        self.assertIn("Do not call a disclosed pretax net synergy figure model-derived", skill)
        self.assertIn("cost-to-achieve overrun or delayed capture", skill)
        self.assertIn(
            "Do not route an ordinary merger-model HTML summary through `dashboard-builder`",
            skill,
        )
        self.assertIn("Calculation integrity", output_spec)
        self.assertIn("Decision readiness", output_spec)
        self.assertIn("clearly labeled `implied cost-to-achieve`", output_spec)
        self.assertIn("100% synergy-realization sensitivity reconciles", output_spec)
        self.assertIn(
            "GAAP accretion/dilution only in `gaap_accretion_model`",
            output_spec,
        )
        self.assertIn("adjusted_eps_screen", workflow)
        self.assertIn("readiness gates, not as placeholder assumptions", workflow)
        self.assertIn("an implied cost-to-achieve amount `disclosed`", qa)
        self.assertIn("reconcile the 100% synergy-realization sensitivity", qa)
        self.assertIn(
            'Do not rely on an "EPS with synergies is no worse than without synergies"',
            qa,
        )
        self.assertIn("fixed-ratio all-stock deals", qa)
        self.assertIn("Missing GAAP inputs are readiness gates", plan_schema)
        self.assertFalse(
            (ROOT / "skills" / "merger-model-builder" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`merger-model-builder`", dashboard_playbook)

    def test_capital_markets_issuance_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "capital-markets-issuance" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        templates = (
            ROOT / "skills" / "capital-markets-issuance" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "capital-markets-issuance" / "references" / "quality-review.md"
        ).read_text(encoding="utf-8")
        helper = (
            ROOT / "skills" / "capital-markets-issuance" / "scripts" / "issuance_math.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML financing report", skill)
        self.assertIn(
            "Do not route an ordinary issuance recommendation through `dashboard-builder`",
            skill,
        )
        self.assertIn("issuance_recommendation", skill)
        self.assertIn("market_window_update", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("preferred contingent financing path", skill)
        self.assertIn("illustrative planning case or readiness range", skill)
        self.assertIn("retain the calculation inputs and the calculation results", skill)
        self.assertIn("Standalone HTML issuance recommendation", templates)
        self.assertIn("Do not add dashboard navigation", templates)
        self.assertIn("preferred contingent financing path", templates)
        self.assertIn("simplified runway or coverage proxies", templates)
        self.assertIn("retain both the calculation inputs and results", templates)
        self.assertIn("contingent path rather than imply certain future issuance", quality)
        self.assertIn("planning cases or readiness ranges", quality)
        self.assertIn("calculation results listed as support artifacts", quality)
        self.assertNotIn("`capital-markets-issuance`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)

    def test_covenant_package_analyzer_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "covenant-package-analyzer" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        templates = (
            ROOT / "skills" / "covenant-package-analyzer" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        scanner = (
            ROOT / "skills" / "covenant-package-analyzer" / "scripts" / "scan_covenant_package.py"
        ).read_text(encoding="utf-8")
        headroom = (
            ROOT
            / "skills"
            / "covenant-package-analyzer"
            / "scripts"
            / "calculate_covenant_headroom.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML finance-side credit memo", skill)
        self.assertIn(
            "Do not route an ordinary covenant review HTML memo through `dashboard-builder`",
            skill,
        )
        self.assertIn("Polished HTML covenant review memo (Recommended)", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("a full inline Markdown review is not a completed deliverable", skill)
        self.assertIn("create the `.html` artifact", skill)
        self.assertIn("two to four decision-gating questions", skill)
        self.assertIn("do not display raw internal evidence codes", skill)
        self.assertIn("Standalone HTML covenant review memo", templates)
        self.assertIn("What is not established", templates)
        self.assertIn("Not computed", templates)
        self.assertIn("do not substitute a complete inline Markdown memo", templates)
        self.assertIn("Reliance gates", templates)
        self.assertIn("translate internal evidence codes into reader language", templates)
        self.assertNotIn("`covenant-package-analyzer`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", scanner)
        self.assertNotIn("render_html_report", scanner)
        self.assertNotIn("write_dashboard_contract", headroom)
        self.assertNotIn("render_html_report", headroom)

    def test_distressed_recovery_waterfall_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "distressed-recovery-waterfall" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        templates = (
            ROOT / "skills" / "distressed-recovery-waterfall" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "distressed-recovery-waterfall" / "references" / "qa-checklist.md"
        ).read_text(encoding="utf-8")
        engine = (
            ROOT / "skills" / "distressed-recovery-waterfall" / "scripts" / "waterfall_engine.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML restructuring memo", skill)
        self.assertIn(
            "Do not route ordinary debtor-side recovery or sale-path HTML analysis through `dashboard-builder`",
            skill,
        )
        self.assertIn("Polished HTML restructuring memo (Recommended)", skill)
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("upper-bound sensitivity", skill)
        self.assertIn("Standalone HTML restructuring memo", templates)
        self.assertIn("Decision gates", templates)
        self.assertIn("known-funded-GUC-only", templates)
        self.assertIn("local headless-browser screenshots", quality)
        self.assertFalse(
            (
                ROOT
                / "skills"
                / "distressed-recovery-waterfall"
                / "references"
                / "dashboard-map.md"
            ).exists()
        )
        self.assertNotIn("`distressed-recovery-waterfall`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", engine)
        self.assertNotIn("render_html_dashboard", engine)

    def test_private_credit_underwriting_uses_standalone_html_architecture(self) -> None:
        skill = (ROOT / "skills" / "private-credit-underwriting" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        templates = (
            ROOT / "skills" / "private-credit-underwriting" / "references" / "output-templates.md"
        ).read_text(encoding="utf-8")
        playbook = (
            ROOT
            / "skills"
            / "private-credit-underwriting"
            / "references"
            / "underwriting-playbook.md"
        ).read_text(encoding="utf-8")
        metrics = (
            ROOT / "skills" / "private-credit-underwriting" / "references" / "credit-metrics.md"
        ).read_text(encoding="utf-8")
        evidence = (
            ROOT
            / "skills"
            / "private-credit-underwriting"
            / "references"
            / "source-and-evidence.md"
        ).read_text(encoding="utf-8")
        asset_template = (
            ROOT / "skills" / "private-credit-underwriting" / "assets" / "credit_memo_template.md"
        ).read_text(encoding="utf-8")
        helper = (
            ROOT
            / "skills"
            / "private-credit-underwriting"
            / "scripts"
            / "calculate_credit_metrics.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("../../references/html-artifact-standard.md", skill)
        self.assertIn("polished standalone HTML lender underwriting memo", skill)
        self.assertIn(
            "Do not route an ordinary lender underwriting HTML memo through `dashboard-builder`",
            skill,
        )
        self.assertIn("Polished HTML lender underwriting memo (Recommended)", skill)
        self.assertIn("`initial_credit_screen`", skill)
        self.assertIn("`debt_capacity_workbook`", skill)
        self.assertIn("illustrative standalone cash-interest screening ceiling", skill)
        self.assertIn(
            "No combined-borrower underwriting or hold-size conclusion is supportable", skill
        )
        self.assertIn("local headless-browser screenshots", skill)
        self.assertIn("one prioritized `Required Before Credit Committee` table", templates)
        self.assertIn("illustrative standalone cash-interest screening ceiling", templates)
        self.assertIn("proceed-to-diligence-only", templates)
        self.assertIn("reader-facing HTML", templates)
        self.assertIn("transaction-execution context only", templates)
        self.assertIn("acquirer/parent financials", playbook)
        self.assertIn("Reserve `proceed-with-conditions`", playbook)
        self.assertIn("transaction-execution context only", playbook)
        self.assertIn("cash-flow downside dimension", metrics)
        self.assertIn("Reader-Facing Presentation", evidence)
        self.assertIn("do not scatter raw labels", evidence)
        self.assertIn("proceed-to-diligence-only", asset_template)
        self.assertIn("transaction-execution context only", asset_template)
        self.assertFalse(
            (
                ROOT / "skills" / "private-credit-underwriting" / "references" / "dashboard-map.md"
            ).exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", skill)
        self.assertNotIn("## Dashboard Handoff", skill)
        self.assertNotIn("`private-credit-underwriting`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)

    def test_pitch_deck_builder_uses_native_deck_first_architecture(self) -> None:
        pitch = (ROOT / "skills" / "pitch-deck-builder" / "SKILL.md").read_text(encoding="utf-8")
        archetypes = (
            ROOT / "skills" / "pitch-deck-builder" / "references" / "deck-archetypes.md"
        ).read_text(encoding="utf-8")
        quality = (
            ROOT / "skills" / "pitch-deck-builder" / "references" / "quality-checklist.md"
        ).read_text(encoding="utf-8")
        slide_quality = (
            ROOT / "skills" / "pitch-deck-builder" / "references" / "slide-quality-qc.md"
        ).read_text(encoding="utf-8")
        output_schema = (
            ROOT / "skills" / "pitch-deck-builder" / "references" / "output-schema.md"
        ).read_text(encoding="utf-8")
        helper = (
            ROOT / "skills" / "pitch-deck-builder" / "scripts" / "build_deck_storyboard_html.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("polished native editable `.pptx`", pitch)
        self.assertIn("polished standalone HTML storyboard/report", pitch)
        self.assertIn("`Presentations`", pitch)
        self.assertIn("final exported `.pptx`", pitch)
        self.assertIn("local headless-browser screenshots", pitch)
        self.assertIn(
            "Do not route an ordinary deck or HTML storyboard through `dashboard-builder`", pitch
        )
        self.assertIn("JSON", pitch)
        self.assertIn("support artifact", pitch)
        self.assertIn("do not repeat the same value, structure, or protection thesis", archetypes)
        self.assertIn("visually adjudicated non-blocking warnings", quality)
        self.assertIn("renders of the final exported `.pptx`", slide_quality)
        self.assertIn("Standalone HTML Storyboard Pattern", output_schema)
        self.assertIn("../../../references/html-artifact-standard.md", output_schema)
        self.assertFalse(
            (ROOT / "skills" / "pitch-deck-builder" / "references" / "dashboard-map.md").exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", pitch)
        self.assertNotIn("## Dashboard Handoff", pitch)
        self.assertNotIn("`pitch-deck-builder`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_report", helper)

    def test_sensitivity_skill_uses_workbook_first_architecture(self) -> None:
        scenario = (ROOT / "skills" / "scenario-sensitivity-generator" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        templates = (
            ROOT
            / "skills"
            / "scenario-sensitivity-generator"
            / "references"
            / "output-templates.md"
        ).read_text(encoding="utf-8")
        overlay = (
            ROOT
            / "skills"
            / "scenario-sensitivity-generator"
            / "references"
            / "scenario-overlay-contract.md"
        ).read_text(encoding="utf-8")
        overlay_template = (
            ROOT
            / "skills"
            / "scenario-sensitivity-generator"
            / "assets"
            / "scenario_overlay_template.csv"
        ).read_text(encoding="utf-8")
        helper = (
            ROOT
            / "skills"
            / "scenario-sensitivity-generator"
            / "scripts"
            / "materialize_sensitivity_pack.py"
        ).read_text(encoding="utf-8")
        dashboard_playbook = (
            INTERNAL_SUPPORT_ROOT / "dashboard-builder" / "references" / "integration-playbook.md"
        ).read_text(encoding="utf-8")

        self.assertIn("normal hero deliverable is a polished banker-readable workbook", scenario)
        self.assertIn("## Workbook Evidence Readiness", scenario)
        self.assertIn("## Optional HTML Companion", scenario)
        self.assertIn("Excel sensitivity workbook (Recommended)", scenario)
        self.assertIn("corrected scenario-ready base", scenario)
        self.assertIn("audit-indicative diagnostic overlay", scenario)
        self.assertIn("Calculation integrity", scenario)
        self.assertIn("Decision readiness", scenario)
        self.assertIn(
            "Do not route an ordinary sensitivity pack or HTML sensitivity summary through `dashboard-builder`",
            scenario,
        )
        self.assertIn("Sensitivity basis and readiness", templates)
        self.assertIn("embedded corrections or adjustments", templates)
        self.assertIn("excluded unresolved items", templates)
        self.assertIn("sensitivity_basis", overlay)
        self.assertIn("sensitivity_basis", overlay_template)
        self.assertFalse(
            (
                ROOT
                / "skills"
                / "scenario-sensitivity-generator"
                / "references"
                / "dashboard-map.md"
            ).exists()
        )
        self.assertNotIn("## Dashboard Citation Readiness", scenario)
        self.assertNotIn("## Dashboard Handoff", scenario)
        self.assertNotIn("`scenario-sensitivity-generator`", dashboard_playbook)
        self.assertNotIn("write_dashboard_contract", helper)
        self.assertNotIn("render_html_dashboard", helper)

    def test_deliverable_policy_requires_workbook_first_tab_and_final_response_order(self) -> None:
        policy = (ROOT / "references" / "deliverable-format-policy.md").read_text(encoding="utf-8")
        self.assertIn("references/workbook-first-tab-standard.md", policy)
        self.assertIn("Hero deliverable", policy)
        self.assertIn("Companion deliverables", policy)
        self.assertIn("Supporting artifacts", policy)
        self.assertIn("Blocked or partial status", policy)

        workbook_policy = (ROOT / "references" / "workbook-first-tab-standard.md").read_text(
            encoding="utf-8"
        )
        for phrase in [
            "first visible worksheet",
            "decision question",
            "recommendation",
            "key valuation",
            "top sensitivities",
            "source and caveat status",
            "key risks",
            "next steps",
            "model map",
            "model_citations",
        ]:
            self.assertIn(phrase, workbook_policy.lower())

    def test_adaptive_deliverable_intake_policy_defines_tool_and_fallback_rules(self) -> None:
        policy = (ROOT / "references" / "deliverable-intake-policy.md").read_text(encoding="utf-8")
        for phrase in [
            "request_user_input",
            "no more than three questions",
            "free-form `Other` response automatically",
            "never include an",
            "normal chat and wait for the answer",
            "non-interactive run",
            "preserve",
            "do not ask again",
            "PowerPoint deck (.pptx) (Recommended)",
            "Full working analysis (Recommended)",
            "Depth is not readiness",
            "concise plain-text",
            "do not silently select depth or audience",
            "ask the grouped questions directly",
            "Do not suggest switching products or modes",
            "Presentation-Surface Precedence",
            "Apply a saved reader-facing output preference as the default",
            "Otherwise, resolve any new standalone reader-facing output to polished standalone HTML",
            "Use chat-only output only when the user explicitly requests",
            "A direct analytical question, a detail-page hero prompt",
            "Do not choose chat-only output because a concise answer seems sufficient or more useful",
            "Once the presentation surface resolves to HTML, treat that as a committed deliverable decision",
            "do not later reconsider whether the analysis belongs in chat",
        ]:
            self.assertIn(phrase, policy)
        self.assertNotIn("as a bias only", policy)

    def test_artifact_owning_skills_declare_natural_artifact_and_shared_precedence(self) -> None:
        visible_skills = {path.parent.name for path in (ROOT / "skills").glob("*/SKILL.md")}
        self.assertEqual(
            ARTIFACT_OWNING_SKILLS,
            visible_skills - {"investment-banking", "user-context"},
        )

        for skill in ARTIFACT_OWNING_SKILLS:
            with self.subTest(skill=skill):
                text = (ROOT / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
                self.assertIn("Apply the presentation-surface precedence", text)
                self.assertIn("../../references/deliverable-intake-policy.md", text)
                self.assertIn("This workflow's natural artifact is", text)
                self.assertIn(
                    "Do not choose chat-only output unless the user explicitly requests a lightweight response.",
                    text,
                )

    def test_intake_policy_is_wired_into_routing_depth_and_rendering(self) -> None:
        format_policy = (ROOT / "references" / "deliverable-format-policy.md").read_text(
            encoding="utf-8"
        )
        depth_policy = (ROOT / "references" / "output-depth-policy.md").read_text(encoding="utf-8")
        routing = (ROOT / "references" / "plugin-routing-playbook.md").read_text(encoding="utf-8")
        router = (ROOT / "skills" / "investment-banking" / "SKILL.md").read_text(encoding="utf-8")
        renderer = skill_doc("dashboard-builder").read_text(encoding="utf-8")

        self.assertIn("deliverable-intake-policy.md", format_policy)
        self.assertIn("deliverable-intake-policy.md", depth_policy)
        self.assertIn("deliverable-intake-policy.md", routing)
        self.assertIn("deliverable-intake-policy.md", router)
        self.assertIn(
            "request_user_input",
            (ROOT / "references" / "deliverable-intake-policy.md").read_text(encoding="utf-8"),
        )
        self.assertIn("do not re-prompt", renderer)

    def test_pitch_existing_file_and_explicit_format_scenarios_are_covered(self) -> None:
        policy = (ROOT / "references" / "deliverable-intake-policy.md").read_text(encoding="utf-8")
        pitch = (ROOT / "skills" / "pitch-deck-builder" / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("generic pitch-materials request", policy)
        self.assertIn("PowerPoint deck (.pptx)", policy)
        self.assertIn("explicit request for an HTML memo skips format intake", policy)
        self.assertIn('"make a doc" resolves Word format only', policy)
        self.assertIn("unresolved depth and audience before research begins", policy)
        self.assertIn("review of an existing workbook preserves `.xlsx`", policy)
        self.assertIn("plugin-routing-playbook.md", pitch)
        self.assertIn("deliverable-format-policy.md", pitch)

    def test_skill_entrypoints_preflight_before_source_gathering(self) -> None:
        for path in (ROOT / "skills").glob("*/SKILL.md"):
            if path.parent.name == "user-context":
                continue
            with self.subTest(skill=path.parent.name):
                text = path.read_text(encoding="utf-8")
                self.assertIn("deliverable-intake-policy.md", text)
                self.assertIn("before source gathering", text)
                self.assertIn("do not re-prompt", text)

        router = (ROOT / "skills" / "investment-banking" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("before source gathering", router)
        routing = (ROOT / "references" / "plugin-routing-playbook.md").read_text(encoding="utf-8")
        self.assertIn("begins source gathering or analysis", routing)

    def test_implicit_invocation_is_limited_to_the_guarded_router(self) -> None:
        policy = (ROOT / "references" / "invocation-policy.md").read_text(encoding="utf-8")
        routing = (ROOT / "references" / "plugin-routing-playbook.md").read_text(encoding="utf-8")
        router = (ROOT / "skills" / "investment-banking" / "SKILL.md").read_text(encoding="utf-8")

        for phrase in [
            "Explicit invocation",
            "Perfect-fit mandate",
            "When the fit is merely plausible, do not activate this plugin",
            "generic requests to create",
        ]:
            self.assertIn(phrase, policy)
        self.assertIn("references/invocation-policy.md", routing)
        self.assertIn("references/invocation-policy.md", router)

        skill_names = {path.parent.name for path in (ROOT / "skills").glob("*/SKILL.md")}
        yaml_paths = sorted((ROOT / "skills").glob("*/agents/openai.yaml"))
        self.assertEqual(skill_names, {path.parents[1].name for path in yaml_paths})
        for path in yaml_paths:
            text = path.read_text(encoding="utf-8")
            skill = path.parents[1].name
            with self.subTest(skill=skill):
                expected = skill == "investment-banking"
                self.assertIn(
                    f"allow_implicit_invocation: {str(expected).lower()}",
                    text,
                )

    def test_company_tearsheet_prompt_no_longer_defaults_to_concise(self) -> None:
        yaml_text = (ROOT / "skills" / "company-tearsheet" / "agents" / "openai.yaml").read_text(
            encoding="utf-8"
        )
        self.assertIn("$company-tearsheet", yaml_text)
        self.assertIn("full source-backed", yaml_text)
        self.assertNotIn("concise source-backed", yaml_text)


if __name__ == "__main__":
    unittest.main()
