from __future__ import annotations

import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


class ProcessContractTests(unittest.TestCase):
    def run_python(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_buyer_scoring_preserves_original_columns(self) -> None:
        input_csv = FIXTURES / "buyer_universe.csv"
        with tempfile.TemporaryDirectory() as tmpdir:
            output_csv = Path(tmpdir) / "scored.csv"
            result = self.run_python(
                "skills/buyer-investor-list/scripts/score_buyer_universe.py",
                str(input_csv),
                str(output_csv),
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            with input_csv.open(newline="", encoding="utf-8") as f:
                input_rows = list(csv.reader(f))
            with output_csv.open(newline="", encoding="utf-8") as f:
                output_rows = list(csv.reader(f))

            original_header = input_rows[0]
            self.assertEqual(output_rows[0][: len(original_header)], original_header)
            self.assertEqual(output_rows[1][: len(original_header)], input_rows[1])
            self.assertIn("buyer_list_final_score", output_rows[0])
            self.assertIn("buyer_list_suggested_tier", output_rows[0])

    def test_buyer_scoring_uses_combined_strategic_or_mandate_fit_bucket(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_csv = Path(tmpdir) / "buyers.csv"
            output_csv = Path(tmpdir) / "scored.csv"
            with input_csv.open("w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(
                    [
                        "Buyer",
                        "Strategic Fit",
                        "Mandate Fit",
                        "Ability To Transact",
                        "Probability Of Interest",
                        "Execution Certainty",
                        "Process Value",
                        "Relationship Access",
                        "Source Quality",
                        "Source Confidence",
                        "Relationship Owner",
                        "Party Type",
                        "Rationale",
                        "Risk Flags",
                    ]
                )
                writer.writerow(
                    [
                        "Acme Corp",
                        "5",
                        "1",
                        "5",
                        "5",
                        "5",
                        "5",
                        "5",
                        "direct",
                        "high",
                        "MD1",
                        "Strategic",
                        "Owns adjacent product and has active M&A mandate",
                        "none",
                    ]
                )

            result = self.run_python(
                "skills/buyer-investor-list/scripts/score_buyer_universe.py",
                str(input_csv),
                str(output_csv),
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            with output_csv.open(newline="", encoding="utf-8") as f:
                row = next(csv.DictReader(f))
            self.assertEqual(row["buyer_list_raw_score"], "90.0")
            self.assertIn("strategic_or_mandate_fit=3.0", row["buyer_list_score_basis"])
            self.assertEqual(row["buyer_list_confidence_level"], "high")

    def test_buyer_scoring_tier_thresholds_match_framework(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_csv = Path(tmpdir) / "buyers.csv"
            output_csv = Path(tmpdir) / "scored.csv"
            with input_csv.open("w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(
                    [
                        "Buyer",
                        "Strategic Fit",
                        "Ability To Transact",
                        "Probability Of Interest",
                        "Execution Certainty",
                        "Process Value",
                        "Relationship Access",
                        "Source Quality",
                        "Source Confidence",
                        "Relationship Owner",
                        "Party Type",
                        "Rationale",
                        "Risk Flags",
                    ]
                )
                writer.writerow(
                    [
                        "Beta Sponsor",
                        "3.5",
                        "3.5",
                        "3.5",
                        "3.5",
                        "3.5",
                        "3.5",
                        "direct",
                        "high",
                        "VP1",
                        "Sponsor",
                        "Fund mandate and portfolio angle fit the asset",
                        "none",
                    ]
                )

            result = self.run_python(
                "skills/buyer-investor-list/scripts/score_buyer_universe.py",
                str(input_csv),
                str(output_csv),
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            with output_csv.open(newline="", encoding="utf-8") as f:
                row = next(csv.DictReader(f))
            self.assertEqual(row["buyer_list_final_score"], "70.0")
            self.assertEqual(row["buyer_list_suggested_tier"], "tier 2 / strong fit")
            self.assertEqual(row["buyer_list_suggested_wave"], "wave 2")

    def test_buyer_scoring_high_confidentiality_risk_controls_outreach(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_csv = Path(tmpdir) / "buyers.csv"
            output_csv = Path(tmpdir) / "scored.csv"
            with input_csv.open("w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(
                    [
                        "Buyer",
                        "Strategic Fit",
                        "Ability To Transact",
                        "Probability Of Interest",
                        "Execution Certainty",
                        "Process Value",
                        "Relationship Access",
                        "Confidentiality Risk",
                        "Source Quality",
                        "Source Confidence",
                        "Relationship Owner",
                        "Party Type",
                        "Rationale",
                        "Risk Flags",
                    ]
                )
                writer.writerow(
                    [
                        "Sensitive Strategic",
                        "5",
                        "5",
                        "5",
                        "5",
                        "5",
                        "5",
                        "4",
                        "direct",
                        "high",
                        "MD1",
                        "Strategic",
                        "Direct synergy buyer but competitor handling is sensitive",
                        "client approval required",
                    ]
                )

            result = self.run_python(
                "skills/buyer-investor-list/scripts/score_buyer_universe.py",
                str(input_csv),
                str(output_csv),
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            with output_csv.open(newline="", encoding="utf-8") as f:
                row = next(csv.DictReader(f))
            self.assertEqual(row["buyer_list_suggested_tier"], "tier 1 controlled outreach")
            self.assertEqual(row["buyer_list_suggested_wave"], "wave 0 / controlled validation")
            self.assertEqual(
                row["buyer_list_recommended_action"], "client approval then controlled outreach"
            )
            self.assertIn("confidentiality risk high", row["buyer_list_risk_summary"])

    def test_native_tearsheet_json_validator_accepts_fixture(self) -> None:
        result = self.run_python(
            "skills/company-tearsheet/scripts/validate_tearsheet_json.py",
            str(FIXTURES / "company_tearsheet_valid.json"),
            "--strict",
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_company_tearsheet_mapper_outputs_valid_memo_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_json = Path(tmpdir) / "memo_handoff.json"
            result = self.run_python(
                "skills/company-tearsheet/scripts/map_tearsheet_to_memo_handoff.py",
                str(FIXTURES / "company_tearsheet_memo_mapper_input.json"),
                str(output_json),
                "--strict",
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            validation = self.run_python(
                "scripts/validate_handoff_payload.py",
                "company_tearsheet_to_memo_builder",
                str(output_json),
                "--strict",
            )
            self.assertEqual(validation.returncode, 0, validation.stderr + validation.stdout)

            payload = json.loads(output_json.read_text(encoding="utf-8"))
            self.assertEqual(payload["contract_name"], "company_tearsheet_to_memo_builder")
            package = payload["memo_package"]
            self.assertEqual(package["business_model"], "Subscription workflow software")
            self.assertEqual(package["sector"], "Vertical software")
            self.assertEqual(package["ownership_status"], "Sponsor-backed private company")
            self.assertEqual(package["entity_profile"]["source_count"], 2)
            self.assertEqual(
                package["key_metrics"][0]["canonical_evidence_category"], "verified_fact"
            )
            self.assertEqual(
                package["key_metrics"][1]["canonical_evidence_category"], "management_statement"
            )
            self.assertIn("Not a recommendation.", package["circulation_caveats"])
            self.assertTrue(
                any(
                    "source-backed context only" in caveat
                    for caveat in package["circulation_caveats"]
                )
            )

    def test_company_tearsheet_mapper_preserves_missing_context_as_open_items(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_json = Path(tmpdir) / "memo_handoff.json"
            result = self.run_python(
                "skills/company-tearsheet/scripts/map_tearsheet_to_memo_handoff.py",
                str(FIXTURES / "company_tearsheet_valid.json"),
                str(output_json),
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

            validation = self.run_python(
                "scripts/validate_handoff_payload.py",
                "company_tearsheet_to_memo_builder",
                str(output_json),
                "--strict",
            )
            self.assertEqual(validation.returncode, 0, validation.stderr + validation.stdout)

            payload = json.loads(output_json.read_text(encoding="utf-8"))
            package = payload["memo_package"]
            self.assertIn("Business model not provided", package["business_model"])
            self.assertIn(
                "Native tearsheet did not provide business_model.", package["mapper_warnings"]
            )
            self.assertIn("Confirm business_model", " ".join(package["open_questions"]))
            self.assertEqual(package["key_metrics"][0]["source_id"], "S1")

    def test_shared_buyer_handoff_validator_accepts_fixture(self) -> None:
        result = self.run_python(
            "scripts/validate_handoff_payload.py",
            "buyer_investor_list_to_deal_process_tracker",
            str(FIXTURES / "buyer_handoff_valid.json"),
            "--strict",
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_shared_meeting_delta_validator_accepts_fixture(self) -> None:
        result = self.run_python(
            "scripts/validate_handoff_payload.py",
            "meeting_prep_to_deal_process_tracker",
            str(FIXTURES / "meeting_delta_valid.json"),
            "--strict",
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_shared_company_memo_handoff_validator_accepts_fixture(self) -> None:
        result = self.run_python(
            "scripts/validate_handoff_payload.py",
            "company_tearsheet_to_memo_builder",
            str(FIXTURES / "company_tearsheet_memo_handoff_valid.json"),
            "--strict",
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_shared_meeting_memo_handoff_validator_accepts_fixture(self) -> None:
        result = self.run_python(
            "scripts/validate_handoff_payload.py",
            "meeting_prep_to_memo_builder",
            str(FIXTURES / "meeting_memo_handoff_valid.json"),
            "--strict",
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_shared_handoff_validator_rejects_missing_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_payload = Path(tmpdir) / "bad.json"
            bad_payload.write_text(
                json.dumps({"records": [{"party_id": "BUYER-001"}]}), encoding="utf-8"
            )
            result = self.run_python(
                "scripts/validate_handoff_payload.py",
                "buyer_investor_list_to_deal_process_tracker",
                str(bad_payload),
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing field", result.stdout)


if __name__ == "__main__":
    unittest.main()
