from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_validator():
    path = ROOT / "scripts" / "validate_banker_runtime_readiness.py"
    spec = importlib.util.spec_from_file_location("validate_banker_runtime_readiness", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BankerRuntimeReadinessTests(unittest.TestCase):
    def test_standard_schema_validator_and_inventory_exist(self) -> None:
        self.assertTrue((ROOT / "references" / "banker-runtime-readiness-standard.md").exists())
        self.assertTrue((ROOT / "schemas" / "banker_runtime_readiness.schema.json").exists())
        self.assertTrue((ROOT / "scripts" / "validate_banker_runtime_readiness.py").exists())
        self.assertTrue(
            (ROOT / "tests" / "fixtures" / "remaining_banker_runtime_gap_inventory.json").exists()
        )

    def test_remaining_gap_inventory_validates(self) -> None:
        validator = load_validator()
        payload = json.loads(
            (ROOT / "tests" / "fixtures" / "remaining_banker_runtime_gap_inventory.json").read_text(
                encoding="utf-8"
            )
        )
        errors = validator.validate_inventory(payload, ROOT)
        self.assertEqual(errors, [])
        rows = payload["rows"]
        self.assertGreaterEqual(len(rows), 10)
        gap_types = {row["gap_type"] for row in rows}
        self.assertIn("stdout_machine_readable", gap_types)
        self.assertIn("model_citation_missing", gap_types)
        self.assertIn("runtime_missing", gap_types)
        self.assertIn("pdf_ocr_missing", gap_types)
        self.assertIn("visual_review_missing", gap_types)

    def test_fixed_rows_require_script_test_and_eval(self) -> None:
        validator = load_validator()
        bad = {
            "plugin": "investment-banking",
            "inventory_version": "unit-test",
            "rows": [
                {
                    "skill": "memo-builder",
                    "gap_type": "runtime_missing",
                    "current_runtime": "none",
                    "target_runtime": "artifact",
                    "hero_artifact": "investment_memo.html",
                    "companion_artifact": "",
                    "support_artifacts": [],
                    "validator_needed": [],
                    "eval_needed": [],
                    "priority": "P1",
                    "runtime_maturity": "deterministic_human_artifact",
                    "status": "fixed",
                    "runtime_script": "skills/memo-builder/scripts/missing.py",
                    "primary_test": "tests/missing.py",
                    "eval_prompt_ids": [],
                }
            ],
        }
        errors = validator.validate_inventory(bad, ROOT)
        self.assertTrue(any("runtime_script" in error for error in errors))
        self.assertTrue(any("primary_test" in error for error in errors))
        self.assertTrue(any("eval_prompt_ids" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
