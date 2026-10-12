from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def is_json(text: str) -> bool:
    try:
        json.loads(text)
    except json.JSONDecodeError:
        return False
    return True


class CliStdoutDefaultTests(unittest.TestCase):
    def run_cmd(self, args: list[str | Path]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, *(str(arg) for arg in args)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_dashboard_stdout_is_human_by_default_and_json_on_request(self) -> None:
        script = (
            ROOT
            / "skills/investment-banking/internal-support/dashboard-builder/scripts/render_dashboard.py"
        )
        contract = (
            ROOT
            / "skills/investment-banking/internal-support/dashboard-builder/tests/fixtures/sample_report_only_contract.json"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            outdir = Path(tmpdir) / "human"
            result = self.run_cmd([script, "--contract", contract, "--outdir", outdir])
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertFalse(is_json(result.stdout), result.stdout)
            self.assertIn("report.html", result.stdout)
            json_out = Path(tmpdir) / "json"
            result_json = self.run_cmd(
                [script, "--contract", contract, "--outdir", json_out, "--json-run-log"]
            )
            self.assertEqual(result_json.returncode, 0, result_json.stderr + result_json.stdout)
            payload = json.loads(result_json.stdout)
            self.assertIn(payload["status"], {"ok", "ok_with_warnings"})
            self.assertEqual(payload["output_file"], "report.html")

    def test_issuance_math_stdout_is_human_by_default_and_json_on_request(self) -> None:
        script = ROOT / "skills/capital-markets-issuance/scripts/issuance_math.py"
        fixture = ROOT / "tests/fixtures/issuance_equity_input.json"
        with tempfile.TemporaryDirectory() as tmpdir:
            outdir = Path(tmpdir) / "issuance"
            result = self.run_cmd(
                [script, "--mode", "equity", "--input", fixture, "--outdir", outdir]
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertFalse(is_json(result.stdout), result.stdout)
            self.assertIn("financing_alternatives.xlsx", result.stdout)
            self.assertTrue((outdir / "financing_alternatives.xlsx").exists())
            result_json = self.run_cmd(
                [
                    script,
                    "--mode",
                    "equity",
                    "--input",
                    fixture,
                    "--outdir",
                    Path(tmpdir) / "issuance-json",
                    "--json-run-log",
                ]
            )
            self.assertEqual(result_json.returncode, 0, result_json.stderr + result_json.stdout)
            payload = json.loads(result_json.stdout)
            self.assertEqual(payload["mode"], "equity")

    def test_sensitivity_pack_stdout_is_human_by_default_and_json_on_request(self) -> None:
        script = (
            ROOT / "skills/scenario-sensitivity-generator/scripts/materialize_sensitivity_pack.py"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            outdir = Path(tmpdir) / "sensitivity"
            result = self.run_cmd(
                [script, "--mode", "valuation", "--entity", "ExampleCo", "--output-dir", outdir]
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertFalse(is_json(result.stdout), result.stdout)
            self.assertIn("sensitivity_pack.xlsx", result.stdout)
            self.assertTrue((outdir / "sensitivity_pack.xlsx").exists())
            self.assertFalse((outdir / "sensitivity_dashboard.html").exists())
            self.assertFalse((outdir / "logs" / "sensitivity_dashboard_contract.json").exists())
            result_json = self.run_cmd(
                [
                    script,
                    "--mode",
                    "valuation",
                    "--entity",
                    "ExampleCo",
                    "--output-dir",
                    Path(tmpdir) / "sensitivity-json",
                    "--json-run-log",
                ]
            )
            self.assertEqual(result_json.returncode, 0, result_json.stderr + result_json.stdout)
            payload = json.loads(result_json.stdout)
            self.assertIn("primary_human_deliverable", payload)
            self.assertIn("manifest", payload)

    def test_formula_workbook_stdout_is_human_by_default_and_json_on_request(self) -> None:
        cases = [
            (
                "skills/dcf-model-builder/scripts/build_banker_formula_workbook.py",
                "skills/dcf-model-builder/assets/plan_template.json",
                "DCF formula workbook complete",
            ),
            (
                "skills/three-statement-model-builder/scripts/build_banker_formula_workbook.py",
                "skills/three-statement-model-builder/assets/plan_template.json",
                "Three-statement formula workbook complete",
            ),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            for index, (script, plan, marker) in enumerate(cases):
                outdir = Path(tmpdir) / f"formula-{index}"
                result = self.run_cmd([ROOT / script, ROOT / plan, "--output-dir", outdir])
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertFalse(is_json(result.stdout), result.stdout)
                self.assertIn(marker, result.stdout)
                self.assertTrue((outdir / "banker_formula_workbook.xlsx").exists())
                json_dir = Path(tmpdir) / f"formula-json-{index}"
                result_json = self.run_cmd(
                    [ROOT / script, ROOT / plan, "--output-dir", json_dir, "--json-run-log"]
                )
                self.assertEqual(result_json.returncode, 0, result_json.stderr + result_json.stdout)
                payload = json.loads(result_json.stdout)
                self.assertEqual(payload["workbook_mode"], "banker_formula_workbook")
                self.assertIn("model_citation_count", payload)


if __name__ == "__main__":
    unittest.main()
