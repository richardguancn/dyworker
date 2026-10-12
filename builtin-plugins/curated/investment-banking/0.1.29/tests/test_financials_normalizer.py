from __future__ import annotations

import csv
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
NORMALIZER = (
    ROOT / "skills" / "financials-normalizer" / "scripts" / "normalize_extracted_financials.py"
)
VALIDATOR = (
    ROOT / "skills" / "financials-normalizer" / "scripts" / "validate_normalized_financials.py"
)


class FinancialsNormalizerTests(unittest.TestCase):
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

    def read_csv(self, path: Path) -> list[dict[str, str]]:
        with path.open(newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle))

    def test_normalizer_preserves_source_values_and_emits_canonical_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            result = self.run_python(
                NORMALIZER, FIXTURES / "financials_normalizer_extracted.csv", output_dir
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            self.assertTrue((output_dir / "normalized_financials.xlsx").exists())
            self.assertTrue((output_dir / "manifest.json").exists())
            normalized_path = output_dir / "support" / "Normalized_Financials_Long.csv"
            rows = self.read_csv(normalized_path)
            self.assertEqual(len(rows), 5)
            by_item = {row["line_item_original"]: row for row in rows}

            revenue = by_item["Revenue"]
            self.assertEqual(revenue["source_value"], "$1.2m")
            self.assertEqual(revenue["normalized_value"], "1.2")
            self.assertEqual(revenue["units"], "$mm")
            self.assertEqual(revenue["normalization_method"], "scaled_to_mm")
            self.assertEqual(revenue["canonical_evidence_category"], "verified_fact")

            nrr = by_item["NRR"]
            self.assertEqual(nrr["source_value"], "110%")
            self.assertEqual(nrr["normalized_value"], "1.1")
            self.assertEqual(nrr["units"], "decimal")
            self.assertEqual(nrr["normalization_method"], "percent_to_decimal")
            self.assertEqual(nrr["canonical_evidence_category"], "estimate")

            spread = by_item["Interest spread"]
            self.assertEqual(spread["normalized_value"], "0.05")
            self.assertEqual(spread["units"], "decimal")
            self.assertEqual(spread["normalization_method"], "bps_to_decimal")
            self.assertEqual(spread["canonical_evidence_category"], "pro_forma_adjustment")

            ebitda = by_item["EBITDA"]
            self.assertEqual(ebitda["source_value"], "1200")
            self.assertEqual(ebitda["normalized_value"], "1.2")
            self.assertEqual(ebitda["units"], "$mm")
            self.assertEqual(ebitda["canonical_evidence_category"], "pro_forma_adjustment")

            capex = by_item["Capital expenditures"]
            self.assertEqual(capex["canonical_evidence_category"], "assumption")
            self.assertEqual(capex["confidence"], "medium")

            for filename in [
                "Source_Index.csv",
                "Mapping_Dictionary.csv",
                "Adjustments_Log.csv",
                "Conflict_Log.csv",
                "Assumptions_Register.csv",
                "QA_Flags.csv",
            ]:
                self.assertTrue((output_dir / "support" / filename).exists(), filename)

            adjustments = self.read_csv(output_dir / "support" / "Adjustments_Log.csv")
            self.assertEqual({row["metric"] for row in adjustments}, {"Interest spread", "EBITDA"})
            self.assertTrue(
                all(row["preliminary_model_treatment"] for row in adjustments),
                adjustments,
            )
            assumptions = self.read_csv(output_dir / "support" / "Assumptions_Register.csv")
            self.assertEqual(len(assumptions), 1)
            self.assertEqual(assumptions[0]["canonical_evidence_category"], "assumption")

            validation = self.run_python(VALIDATOR, normalized_path, "--require-package", "--json")
            self.assertEqual(validation.returncode, 0, validation.stderr + validation.stdout)

            adjustment_path = output_dir / "support" / "Adjustments_Log.csv"
            with adjustment_path.open(newline="", encoding="utf-8") as handle:
                original_reader = csv.DictReader(handle)
                missing_treatment_fields = [
                    name
                    for name in (original_reader.fieldnames or [])
                    if name != "preliminary_model_treatment"
                ]
                missing_treatment_rows = list(original_reader)
            with adjustment_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(
                    handle, fieldnames=missing_treatment_fields, extrasaction="ignore"
                )
                writer.writeheader()
                writer.writerows(missing_treatment_rows)
            invalid_package = self.run_python(
                VALIDATOR, normalized_path, "--require-package", "--json"
            )
            self.assertNotEqual(invalid_package.returncode, 0)
            self.assertIn("preliminary_model_treatment", invalid_package.stdout)

    def test_ambiguous_values_are_flagged_instead_of_guessed(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            result = self.run_python(
                NORMALIZER, FIXTURES / "financials_normalizer_ambiguous.csv", output_dir
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            rows = self.read_csv(output_dir / "support" / "Normalized_Financials_Long.csv")
            self.assertEqual(rows[0]["source_value"], "Revenue 2025: 100")
            self.assertEqual(rows[0]["normalized_value"], "")
            self.assertEqual(rows[0]["normalization_method"], "unparsed_text_value")
            self.assertEqual(rows[0]["confidence"], "low")

            qa_flags = self.read_csv(output_dir / "support" / "QA_Flags.csv")
            self.assertEqual(len(qa_flags), 1)
            self.assertIn("multiple numeric tokens", qa_flags[0]["issue"])

            validation = self.run_python(
                VALIDATOR, output_dir / "support" / "Normalized_Financials_Long.csv"
            )
            self.assertNotEqual(validation.returncode, 0)
            self.assertIn("still needs analyst review", validation.stdout)

    def test_validator_rejects_missing_canonical_evidence_category(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_csv = Path(tmpdir) / "bad.csv"
            fieldnames = [
                "entity",
                "source_id",
                "statement",
                "line_item_original",
                "line_item_standard",
                "line_item_id",
                "period_end",
                "period_label",
                "period_type",
                "currency",
                "units",
                "source_value",
                "normalized_value",
                "normalization_method",
                "source_location",
                "evidence_label",
                "canonical_evidence_category",
                "confidence",
            ]
            with bad_csv.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerow(
                    {
                        "entity": "Acme Co",
                        "source_id": "SRC-001",
                        "statement": "income_statement",
                        "line_item_original": "Revenue",
                        "line_item_standard": "Revenue",
                        "line_item_id": "revenue",
                        "period_end": "2025-12-31",
                        "period_label": "FY2025",
                        "period_type": "annual",
                        "currency": "USD",
                        "units": "$mm",
                        "source_value": "$1.2m",
                        "normalized_value": "1.2",
                        "normalization_method": "scaled_to_mm",
                        "source_location": "Model!B12",
                        "evidence_label": "fact_source_reported",
                        "canonical_evidence_category": "",
                        "confidence": "high",
                    }
                )

            result = self.run_python(VALIDATOR, bad_csv)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("invalid canonical_evidence_category", result.stdout)


if __name__ == "__main__":
    unittest.main()
