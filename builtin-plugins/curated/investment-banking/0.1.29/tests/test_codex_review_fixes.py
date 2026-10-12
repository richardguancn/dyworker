from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_python_module(rel: str, name: str):
    path = ROOT / rel
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_runtime_module(rel: str, name: str):
    path = ROOT / rel
    loader = SourceFileLoader(name, str(path))
    spec = spec_from_loader(loader.name, loader)
    assert spec is not None
    module = module_from_spec(spec)
    sys.modules[name] = module
    loader.exec_module(module)
    return module


class CodexReviewFixTests(unittest.TestCase):
    def test_private_credit_html_report_renders_sections_and_tables(self) -> None:
        metrics = load_python_module(
            "skills/private-credit-underwriting/scripts/calculate_credit_metrics.py",
            "private_credit_metrics_review_fix",
        )
        encoded_basis = metrics._markdown_table_cell("First lien | total net leverage")
        markdown = f"""# Credit metrics report

- period: FY2026

## Core metrics

| Metric | Value | Basis |
|---|---:|---|
| net leverage | 3.5x | first-pass proxy |
| covenant | {encoded_basis} | source term |
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "credit_memo.html"
            metrics._write_html_report(output, "Private Credit Underwriting Memo", markdown)
            html = output.read_text(encoding="utf-8")

        self.assertIn("<h2>Core metrics</h2>", html)
        self.assertIn("<table>", html)
        self.assertIn("<th>Metric</th>", html)
        self.assertIn("<td>net leverage</td>", html)
        self.assertIn("<td>First lien | total net leverage</td>", html)
        self.assertNotIn("<td>total net leverage</td>", html)
        self.assertNotIn("| Metric | Value | Basis |", html)
        self.assertNotIn("<pre", html)

    def test_three_statement_validated_debt_without_covenants_does_not_warn(self) -> None:
        core = load_runtime_module(
            "skills/three-statement-model-builder/scripts/skill_core_runtime",
            "three_statement_core_review_fix",
        )
        skill_root = ROOT / "skills" / "three-statement-model-builder"
        plan = json.loads((skill_root / "assets" / "plan_template.json").read_text())
        plan["source_basis"][1]["evidence_label"] = "source_reported"
        plan["source_basis"][1]["confidence"] = "medium"
        normalized = core.normalize_plan(plan, skill_root)
        scenarios = core.run_scenarios(normalized)
        hard_failures, warnings, _checks = core.evaluate_hard_failures_and_warnings(
            normalized, scenarios
        )

        warning_codes = {warning["code"] for warning in warnings}
        self.assertNotIn("LIQUIDITY_COVENANT_SUPPORT_UNVALIDATED", warning_codes)
        self.assertNotEqual(core.model_status(hard_failures, warnings, normalized), "screen-grade")

    def test_three_statement_unsupported_debt_without_covenants_still_warns(self) -> None:
        core = load_runtime_module(
            "skills/three-statement-model-builder/scripts/skill_core_runtime",
            "three_statement_core_unsupported_debt_review_fix",
        )
        skill_root = ROOT / "skills" / "three-statement-model-builder"
        plan = json.loads((skill_root / "assets" / "plan_template.json").read_text())
        normalized = core.normalize_plan(plan, skill_root)
        scenarios = core.run_scenarios(normalized)
        _hard_failures, warnings, _checks = core.evaluate_hard_failures_and_warnings(
            normalized, scenarios
        )

        warning_codes = {warning["code"] for warning in warnings}
        self.assertIn("LIQUIDITY_COVENANT_SUPPORT_UNVALIDATED", warning_codes)

    def test_three_statement_liquidity_only_source_does_not_validate_debt(self) -> None:
        core = load_runtime_module(
            "skills/three-statement-model-builder/scripts/skill_core_runtime",
            "three_statement_core_liquidity_only_review_fix",
        )
        skill_root = ROOT / "skills" / "three-statement-model-builder"
        plan = json.loads((skill_root / "assets" / "plan_template.json").read_text())
        plan["source_basis"][1]["evidence_label"] = "source_reported"
        plan["source_basis"][1]["confidence"] = "medium"
        plan["source_basis"][1]["covers"] = [
            cover for cover in plan["source_basis"][1]["covers"] if cover != "debt"
        ] + ["liquidity"]
        normalized = core.normalize_plan(plan, skill_root)
        scenarios = core.run_scenarios(normalized)
        _hard_failures, warnings, _checks = core.evaluate_hard_failures_and_warnings(
            normalized, scenarios
        )

        warning_codes = {warning["code"] for warning in warnings}
        self.assertIn("LIQUIDITY_COVENANT_SUPPORT_UNVALIDATED", warning_codes)

    def test_three_statement_debt_free_plan_does_not_require_debt_support(self) -> None:
        core = load_runtime_module(
            "skills/three-statement-model-builder/scripts/skill_core_runtime",
            "three_statement_core_debt_free_review_fix",
        )
        skill_root = ROOT / "skills" / "three-statement-model-builder"
        plan = json.loads((skill_root / "assets" / "plan_template.json").read_text())
        plan["source_basis"][1]["evidence_label"] = "source_reported"
        plan["source_basis"][1]["confidence"] = "medium"
        plan["source_basis"][1]["covers"] = [
            cover for cover in plan["source_basis"][1]["covers"] if cover != "debt"
        ]
        plan["historicals"]["income_statement"]["FY2025"]["interest"] = 0
        plan["historicals"]["balance_sheet"]["FY2025"]["debt"] = 0
        plan["historicals"]["balance_sheet"]["FY2025"]["retained_earnings"] = 75
        plan["historicals"]["debt_schedule"]["FY2025"].update(
            {"beginning_debt": 0, "draws": 0, "repayments": 0, "ending_debt": 0}
        )
        plan["debt"].update(
            {
                "beginning_debt": 0,
                "beginning_revolver_drawn": 0,
                "revolver_commitment": 0,
                "mandatory_amortization": {},
                "optional_draws": {},
                "interest_rate": {},
                "cash_sweep": {"min_cash": 0, "sweep_pct": 0},
                "covenants": {},
            }
        )
        normalized = core.normalize_plan(plan, skill_root)
        scenarios = core.run_scenarios(normalized)
        hard_failures, warnings, _checks = core.evaluate_hard_failures_and_warnings(
            normalized, scenarios
        )

        warning_codes = {warning["code"] for warning in warnings}
        self.assertNotIn("LIQUIDITY_COVENANT_SUPPORT_UNVALIDATED", warning_codes)
        self.assertNotEqual(core.model_status(hard_failures, warnings, normalized), "screen-grade")

    def test_three_statement_modeled_covenants_still_require_support(self) -> None:
        core = load_runtime_module(
            "skills/three-statement-model-builder/scripts/skill_core_runtime",
            "three_statement_core_modeled_covenant_review_fix",
        )
        skill_root = ROOT / "skills" / "three-statement-model-builder"
        plan = json.loads((skill_root / "assets" / "plan_template.json").read_text())
        plan["source_basis"][1]["evidence_label"] = "source_reported"
        plan["source_basis"][1]["confidence"] = "medium"
        plan["debt"]["covenants"] = {"min_liquidity": 5}
        normalized = core.normalize_plan(plan, skill_root)
        scenarios = core.run_scenarios(normalized)
        _hard_failures, warnings, _checks = core.evaluate_hard_failures_and_warnings(
            normalized, scenarios
        )

        warning_codes = {warning["code"] for warning in warnings}
        self.assertIn("LIQUIDITY_COVENANT_SUPPORT_UNVALIDATED", warning_codes)


if __name__ == "__main__":
    unittest.main()
