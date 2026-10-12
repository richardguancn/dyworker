from __future__ import annotations

import importlib.util
import tempfile
import unittest
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


class DocumentIngestionAndSourceGateTests(unittest.TestCase):
    def test_pdf_without_extractable_text_requires_ocr(self) -> None:
        doc = load_module("shared/document_ingestion.py", "document_ingestion")
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf = Path(tmpdir) / "scan.pdf"
            pdf.write_bytes(b"%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF")
            result = doc.inspect_document(pdf)
            self.assertEqual(result["document_type"], "pdf")
            self.assertTrue(result["ocr_required"])
            self.assertIn(result["extraction_confidence"], {"none", "low"})

    def test_source_gate_blocks_senior_ready_missing_source_register(self) -> None:
        gate = load_module("shared/source_gate.py", "source_gate")
        result = gate.validate_source_gate([], "client-ready")
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["errors"])

    def test_source_gate_warns_on_assumptions(self) -> None:
        gate = load_module("shared/source_gate.py", "source_gate")
        result = gate.validate_source_gate(
            [
                {
                    "source_id": "SRC-1",
                    "evidence_label": "management_assumption",
                    "as_of_date": "2026-05-18",
                }
            ],
            "draft",
        )
        self.assertEqual(result["status"], "passed")
        self.assertTrue(result["warnings"])


if __name__ == "__main__":
    unittest.main()
