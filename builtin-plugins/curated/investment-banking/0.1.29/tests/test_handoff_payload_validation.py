from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
VALIDATOR = ROOT / "scripts" / "validate_handoff_payload.py"
P0_CONTRACTS = {
    "cim_teardown_to_model_builder",
    "cim_builder_to_ib_deck_qc",
    "pitch_deck_builder_to_ib_deck_qc",
    "capital_markets_issuance_to_private_credit_underwriting",
    "capital_markets_issuance_to_covenant_package_analyzer",
    "private_credit_underwriting_to_distressed_recovery_waterfall",
    "distressed_recovery_waterfall_to_memo_builder",
    "distressed_recovery_waterfall_to_pitch_deck_builder",
    "distressed_recovery_waterfall_to_ib_deck_qc",
}


def run_validator(contract: str, path: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(VALIDATOR), contract, str(path), *extra],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def registered_contracts() -> set[str]:
    spec = importlib.util.spec_from_file_location("validate_handoff_payload", VALIDATOR)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return set(module.CONTRACT_SHAPES)


class HandoffPayloadValidationTests(unittest.TestCase):
    def test_all_valid_fixtures_pass(self) -> None:
        contracts = registered_contracts()
        for fixture in sorted(FIXTURES.glob("*_valid.json")):
            contract = fixture.name.removesuffix("_valid.json")
            if contract not in contracts:
                continue
            with self.subTest(contract=contract):
                result = run_validator(contract, fixture)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertIn("validation passed", result.stdout)

    def test_p0_invalid_fixtures_fail(self) -> None:
        for contract in sorted(P0_CONTRACTS):
            with self.subTest(contract=contract):
                result = run_validator(contract, FIXTURES / f"{contract}_invalid.json")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("ERROR:", result.stdout)

    def test_strict_mode_fails_on_placeholders(self) -> None:
        payload = json.loads(
            (FIXTURES / "company_tearsheet_to_memo_builder_valid.json").read_text(encoding="utf-8")
        )
        payload["memo_package"]["business_model"] = "unknown"
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "placeholder.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            loose = run_validator("company_tearsheet_to_memo_builder", path)
            strict = run_validator("company_tearsheet_to_memo_builder", path, "--strict")
        self.assertEqual(loose.returncode, 0, loose.stderr + loose.stdout)
        self.assertNotEqual(strict.returncode, 0)
        self.assertIn("placeholder/empty", strict.stdout)

    def test_extra_banker_notes_are_allowed(self) -> None:
        payload = json.loads(
            (
                FIXTURES / "capital_markets_issuance_to_private_credit_underwriting_valid.json"
            ).read_text(encoding="utf-8")
        )
        payload["banker_notes"] = {"md_override": "Call lender group before launch."}
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "extra_notes.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = run_validator("capital_markets_issuance_to_private_credit_underwriting", path)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_shared_helper_writes_validated_support_handoff(self) -> None:
        spec = importlib.util.spec_from_file_location(
            "shared_artifacts", ROOT / "shared" / "artifacts.py"
        )
        assert spec is not None
        assert spec.loader is not None
        artifacts = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(artifacts)

        contract = "distressed_recovery_waterfall_to_memo_builder"
        with tempfile.TemporaryDirectory() as tmpdir:
            payload = artifacts.build_minimal_handoff_payload(contract)
            result = artifacts.write_handoff_payload(tmpdir, contract, payload, "memo-builder")
            item = artifacts.handoff_artifact_item(result)

        self.assertEqual(result["validator_status"], "passed")
        self.assertIn("/handoffs/", result["path"])
        self.assertEqual(item["role"], "support_artifact")
        self.assertFalse(item["user_visible_default"])
        self.assertEqual(item["handoff_contract_name"], contract)
        self.assertEqual(item["consumer_skill"], "memo-builder")


if __name__ == "__main__":
    unittest.main()
