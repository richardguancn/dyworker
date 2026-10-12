from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(rel: str, name: str):
    path = ROOT / rel
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ModelBuilderManifestTests(unittest.TestCase):
    FIRST_TAB_NAMES = {"Cover", "Executive Summary", "Dashboard"}

    def test_merger_model_reference_preserves_debt_like_ev_addition(self) -> None:
        model_math = (
            ROOT / "skills" / "merger-model-builder" / "references" / "model-math.md"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "EV = equity value + debt + debt-like items - cash.",
            model_math,
        )
        self.assertNotIn("\n- debt-like items", model_math)

    def run_python(self, *args: str | Path) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        return subprocess.run(
            [sys.executable, *(str(arg) for arg in args)],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_manifest_shape(self, output_dir: Path, skill: str, mode: str) -> dict:
        manifest_path = output_dir / "manifest.json"
        self.assertTrue(manifest_path.exists(), f"missing manifest for {skill}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["manifest_version"], "1.0")
        self.assertEqual(manifest["skill"], skill)
        self.assertEqual(manifest["artifact_mode"], mode)
        self.assertEqual(manifest["output_dir"], str(output_dir))
        self.assertTrue(manifest["primary_human_deliverable"])
        self.assertTrue(manifest["human_deliverables"])
        self.assertTrue(manifest["agent_artifacts"])
        self.assertTrue(
            any(item["path"].endswith("manifest.json") for item in manifest["agent_artifacts"])
        )
        self.assertTrue(
            all(item["role"] == "human_deliverable" for item in manifest["human_deliverables"])
        )
        self.assertTrue(
            all(item["role"] == "agent_artifact" for item in manifest["agent_artifacts"])
        )
        self.assertIn("first_read", manifest)
        self.assertIn("companion_deliverables", manifest)
        self.assertIn("support_artifacts", manifest)
        self.assertFalse(manifest["support_artifacts_user_visible_default"])
        self.assertIn("blocked_or_partial_status", manifest)
        self.assertEqual(
            manifest["final_response_guidance"]["lead_with"], "primary_human_deliverable"
        )
        self.assertIn("deliverable", manifest["discipline_note"])
        artifacts = load_module("shared/artifacts.py", "ib_artifacts_for_model_tests")
        artifacts.validate_artifact_manifest(manifest)
        return manifest

    def assert_model_citations_valid(
        self, path: Path, skill: str, expected_workbook: Path | None = None
    ) -> None:
        self.assertTrue(path.exists(), f"missing model citation ledger for {skill}: {path}")
        model_citations = load_module(
            "shared/model_citations.py", f"ib_model_citations_{skill.replace('-', '_')}"
        )
        payload = json.loads(path.read_text(encoding="utf-8"))
        errors = model_citations.validate_model_citations(payload)
        self.assertEqual(errors, [], f"invalid model citations for {skill}: {errors}")
        self.assertGreater(len(payload), 0)
        first = payload[0]
        self.assertIn("workbook_path", first)
        self.assertIn("sheet", first)
        self.assertIn("cell_or_range", first)
        if expected_workbook is not None:
            cited_paths = {Path(item["workbook_path"]).resolve() for item in payload}
            self.assertEqual(
                cited_paths,
                {expected_workbook.resolve()},
                f"{skill} model citations must map to its delivered hero workbook",
            )

    def assert_workbook_first_tab_is_insight_dashboard(self, workbook: Path, skill: str) -> None:
        self.assertTrue(workbook.exists(), f"missing workbook for {skill}: {workbook}")
        with zipfile.ZipFile(workbook) as archive:
            workbook_xml = archive.read("xl/workbook.xml")
        root = ET.fromstring(workbook_xml)
        ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        sheets = root.find("main:sheets", ns)
        self.assertIsNotNone(sheets, f"missing sheets XML for {skill}")
        visible_names = [
            sheet.attrib["name"]
            for sheet in sheets.findall("main:sheet", ns)
            if sheet.attrib.get("state", "visible") == "visible"
        ]
        self.assertTrue(visible_names, f"no visible sheets for {skill}")
        self.assertIn(
            visible_names[0],
            self.FIRST_TAB_NAMES,
            f"{skill} first visible tab should be Cover, Executive Summary, or Dashboard; got {visible_names[0]}",
        )

    def test_deterministic_model_pipelines_emit_manifest(self) -> None:
        cases = [
            (
                "dcf-model-builder",
                "skills/dcf-model-builder/scripts/run_pipeline.py",
                "skills/dcf-model-builder/assets/plan_template.json",
            ),
            (
                "three-statement-model-builder",
                "skills/three-statement-model-builder/scripts/run_pipeline.py",
                "skills/three-statement-model-builder/assets/plan_template.json",
            ),
            (
                "lbo-model-build",
                "skills/lbo-model-build/scripts/run_pipeline.py",
                "skills/lbo-model-build/assets/plan_template.json",
            ),
            (
                "merger-model-builder",
                "skills/merger-model-builder/scripts/run_pipeline.py",
                "skills/merger-model-builder/assets/plan_template.json",
            ),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            for skill, script, plan in cases:
                output_dir = Path(tmpdir) / skill
                result = self.run_python(script, plan, "--output-dir", output_dir)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertTrue((output_dir / "model.xlsx").exists(), skill)
                self.assert_workbook_first_tab_is_insight_dashboard(
                    output_dir / "model.xlsx", skill
                )
                self.assertTrue((output_dir / "run_log.json").exists(), skill)
                self.assert_model_citations_valid(
                    output_dir / "model_citations.json", skill, output_dir / "model.xlsx"
                )
                self.assertFalse(
                    (output_dir / "report.md").exists(),
                    f"{skill} should not write legacy report.md by default",
                )
                manifest = self.assert_manifest_shape(output_dir, skill, "deterministic_export")
                self.assertTrue(manifest["primary_human_deliverable"].endswith("model.xlsx"))

                run_log = json.loads((output_dir / "run_log.json").read_text(encoding="utf-8"))
                self.assertEqual(run_log.get("output_manifest"), str(output_dir / "manifest.json"))
                self.assertEqual(
                    run_log.get("model_citations_path"), str(output_dir / "model_citations.json")
                )
                self.assertGreater(run_log.get("model_citation_count", 0), 0)
                self.assertNotIn("report_md", run_log.get("output_paths", {}))

    def test_lbo_quarterly_exit_and_leverage_use_annualized_ebitda(self) -> None:
        core = load_module("skills/lbo-model-build/scripts/lbo_core.py", "ib_lbo_quarterly_core")
        skill_root = ROOT / "skills" / "lbo-model-build"
        plan = json.loads(
            (skill_root / "assets" / "plan_template_full").read_text(encoding="utf-8")
        )
        plan["timeline"]["periodicity"] = "quarterly"
        normalized, run_log = core.normalize_plan(plan, skill_root)
        periods = core.build_timeline(2026, 5, "quarterly")
        entry = core.compute_entry_values(normalized)
        operating = core.compute_operating_series(normalized, periods)
        debt = core.run_debt_and_cash(normalized, periods, operating, entry, run_log)
        covenants = core.compute_covenants(normalized, periods, operating, debt)
        returns = core.compute_exit_and_returns(normalized, periods, operating, debt, entry)

        expected_exit_ebitda = sum(operating["ebitda"][-4:])
        self.assertAlmostEqual(returns["exit_ebitda"], expected_exit_ebitda)
        self.assertAlmostEqual(
            returns["exit_ev"], normalized["exit"]["exit_multiple"] * expected_exit_ebitda
        )
        self.assertAlmostEqual(covenants["annualized_ebitda"][-1], expected_exit_ebitda)
        self.assertNotAlmostEqual(returns["exit_ebitda"], operating["ebitda"][-1])
        self.assertAlmostEqual(returns["irr"], returns["moic"] ** (1 / 5) - 1)
        self.assertTrue(
            any(info.get("code") == "QUARTERLY_ANNUALIZATION_BASIS" for info in run_log["info"])
        )

        prior_core = sys.modules.get("lbo_core")
        sys.modules["lbo_core"] = core
        try:
            runtime_path = skill_root / "scripts" / "runtime" / "run_pipeline"
            loader = SourceFileLoader("ib_lbo_runtime_pipeline", str(runtime_path))
            spec = spec_from_loader(loader.name, loader)
            self.assertIsNotNone(spec)
            pipeline = module_from_spec(spec)
            loader.exec_module(pipeline)
        finally:
            if prior_core is None:
                sys.modules.pop("lbo_core", None)
            else:
                sys.modules["lbo_core"] = prior_core
        _rows, base_out = pipeline.run_one(normalized, skill_root, "base", run_log)
        sensitivities = pipeline.run_sensitivities(normalized, skill_root, base_out)
        exit_idx = base_out["returns"]["exit_period_index"]
        exit_debt = sum(
            schedule["end"][exit_idx] for schedule in base_out["debt"]["sched"].values()
        )
        expected_return_capital_multiple = (
            base_out["entry"]["sponsor_equity"] + exit_debt - base_out["debt"]["cash"][exit_idx]
        ) / base_out["returns"]["exit_ebitda"]
        self.assertAlmostEqual(
            sensitivities["min_exit_multiple_to_return_capital"],
            expected_return_capital_multiple,
        )
        self.assertNotAlmostEqual(
            sensitivities["min_exit_multiple_to_return_capital"],
            (base_out["entry"]["sponsor_equity"] + exit_debt - base_out["debt"]["cash"][exit_idx])
            / base_out["op"]["ebitda"][exit_idx],
        )

    def test_formula_workbook_builders_emit_manifest(self) -> None:
        cases = [
            (
                "dcf-model-builder",
                "skills/dcf-model-builder/scripts/build_banker_formula_workbook.py",
                "skills/dcf-model-builder/assets/plan_template.json",
            ),
            (
                "three-statement-model-builder",
                "skills/three-statement-model-builder/scripts/build_banker_formula_workbook.py",
                "skills/three-statement-model-builder/assets/plan_template.json",
            ),
            (
                "merger-model-builder",
                "skills/merger-model-builder/scripts/build_banker_formula_workbook.py",
                "skills/merger-model-builder/assets/plan_template.json",
            ),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            for skill, script, plan in cases:
                output_dir = Path(tmpdir) / f"{skill}-formula"
                result = self.run_python(script, plan, "--output-dir", output_dir)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertTrue((output_dir / "banker_formula_workbook.xlsx").exists(), skill)
                self.assert_workbook_first_tab_is_insight_dashboard(
                    output_dir / "banker_formula_workbook.xlsx", skill
                )
                self.assert_model_citations_valid(
                    output_dir / "model_citations.json",
                    skill,
                    output_dir / "banker_formula_workbook.xlsx",
                )
                self.assert_manifest_shape(output_dir, skill, "banker_formula_workbook")
                if skill == "three-statement-model-builder":
                    with zipfile.ZipFile(output_dir / "banker_formula_workbook.xlsx") as archive:
                        checks_xml = archive.read("xl/worksheets/sheet15.xml").decode("utf-8")
                    self.assertIn("Decision readiness", checks_xml)
                    self.assertIn("screen-grade", checks_xml)
                    self.assertIn("Calculation integrity", checks_xml)
                    self.assertNotIn("Overall model status", checks_xml)

    def test_comps_template_builder_help_declares_output_dir_manifest(self) -> None:
        result = self.run_python(
            "skills/comps-valuation/scripts/create_comps_template.py", "--help"
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("--output-dir", result.stdout)
        self.assertIn("manifest", result.stdout)

    def test_comps_template_manifest_writer_marks_workbook_as_deliverable(self) -> None:
        script_path = ROOT / "skills/comps-valuation/scripts/create_comps_template.py"
        spec = importlib.util.spec_from_file_location("create_comps_template", script_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            workbook = output_dir / "comps_analysis_template.xlsx"
            workbook.write_bytes(b"placeholder workbook")
            module.write_output_manifest(workbook, "TargetCo", "TGT", "USD", "2026-05-14")
            manifest = self.assert_manifest_shape(
                output_dir, "comps-valuation", "comps_template_workbook"
            )
            self.assertEqual(manifest["primary_human_deliverable"], str(workbook))
            self.assertEqual(manifest["inputs"]["ticker"], "TGT")

    def test_comps_template_source_uses_executive_summary_first(self) -> None:
        script = (ROOT / "skills/comps-valuation/scripts/create_comps_template.py").read_text(
            encoding="utf-8"
        )
        first_add = script.index("wb.add_worksheet")
        self.assertIn('wb.add_worksheet("Executive Summary")', script[first_add : first_add + 120])
        self.assertNotIn('wb.add_worksheet("README")', script)

    def test_comps_template_opens_on_executive_summary(self) -> None:
        if importlib.util.find_spec("xlsxwriter") is None:
            self.skipTest("XlsxWriter is optional and is not installed in this environment")
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            result = self.run_python(
                "skills/comps-valuation/scripts/create_comps_template.py",
                "--output-dir",
                output_dir,
                "--target",
                "TargetCo",
                "--ticker",
                "TGT",
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            workbook = output_dir / "comps_analysis_template.xlsx"
            self.assert_workbook_first_tab_is_insight_dashboard(workbook, "comps-valuation")
            self.assert_model_citations_valid(
                output_dir / "model_citations.json", "comps-valuation"
            )

    def test_distressed_waterfall_emits_workbook_manifest_and_model_citations(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_md = Path(tmpdir) / "waterfall.md"
            result = self.run_python(
                "skills/distressed-recovery-waterfall/scripts/waterfall_engine.py",
                "tests/fixtures/distressed_waterfall_input.json",
                output_md,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assert_workbook_first_tab_is_insight_dashboard(
                output_md.parent / "recovery_waterfall.xlsx", "distressed-recovery-waterfall"
            )
            self.assert_model_citations_valid(
                output_md.parent / "model_citations.json", "distressed-recovery-waterfall"
            )
            manifest = self.assert_manifest_shape(
                output_md.parent, "distressed-recovery-waterfall", "workbook"
            )
            self.assertTrue(
                manifest["primary_human_deliverable"].endswith("recovery_waterfall.xlsx")
            )


if __name__ == "__main__":
    unittest.main()
