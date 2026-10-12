from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_model_citations_module():
    path = ROOT / "shared" / "model_citations.py"
    spec = importlib.util.spec_from_file_location("ib_model_citations", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ModelCitationPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mc = load_model_citations_module()

    def test_schema_helper_and_validator_exist(self) -> None:
        self.assertTrue((ROOT / "schemas" / "model_citations.schema.json").exists())
        self.assertTrue((ROOT / "scripts" / "validate_model_citations.py").exists())
        self.assertTrue((ROOT / "shared" / "model_citations.py").exists())

    def test_write_model_citations_from_sheets_creates_required_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir)
            workbook = out / "model.xlsx"
            workbook.write_bytes(b"placeholder")
            path = out / "model_citations.json"
            citations = self.mc.build_model_citations_from_sheets(
                workbook,
                {
                    "Executive Summary": [
                        {
                            "metric": "Base IRR",
                            "value": "20.2%",
                            "source_id": "SRC-MODEL",
                            "scenario": "base",
                        },
                        {
                            "metric": "Downside MOIC",
                            "value": "1.4x",
                            "source_id": "SRC-MODEL",
                            "scenario": "downside",
                        },
                    ]
                },
            )
            self.mc.write_model_citations(path, citations)
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(self.mc.validate_model_citations(payload), [])
            first = payload[0]
            for field in self.mc.REQUIRED_CITATION_FIELDS:
                self.assertIn(field, first)
            self.assertEqual(first["sheet"], "Executive Summary")
            self.assertIn("SRC-MODEL", first["source_ids"])
            self.assertIn("Model: Executive Summary!", first["short_label"])

    def test_strict_validation_catches_placeholders(self) -> None:
        citation = self.mc.citation_item("bad", "unknown", "Executive Summary", "A1", "Base IRR")
        errors = self.mc.validate_model_citations([citation], strict=True)
        self.assertTrue(any("workbook_path" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
