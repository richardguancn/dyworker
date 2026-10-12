from __future__ import annotations

import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTERNAL_SUPPORT_ROOT = ROOT / "skills" / "investment-banking" / "internal-support"
FIXTURES = ROOT / "tests" / "fixtures"
SCHEMAS = ROOT / "schemas"
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
CONTRACT_SKILL_REFERENCES = {
    "buyer_investor_list_to_deal_process_tracker": {"buyer-investor-list", "deal-process-tracker"},
    "meeting_prep_to_deal_process_tracker": {"meeting-prep", "deal-process-tracker"},
    "meeting_prep_to_memo_builder": {"meeting-prep", "memo-builder"},
    "company_tearsheet_to_memo_builder": {"company-tearsheet", "memo-builder"},
    "cim_teardown_to_memo_builder": {"cim-teardown", "memo-builder"},
    "cim_teardown_to_model_builder": {
        "cim-teardown",
        "dcf-model-builder",
        "three-statement-model-builder",
        "lbo-model-build",
        "merger-model-builder",
        "comps-valuation",
    },
    "cim_builder_to_ib_deck_qc": {"cim-builder", "ib-deck-qc"},
    "pitch_deck_builder_to_ib_deck_qc": {"pitch-deck-builder", "ib-deck-qc"},
    "style_guide_adapter_style_profile": {
        "style-guide-adapter",
        "cim-builder",
        "pitch-deck-builder",
        "memo-builder",
        "ib-deck-qc",
    },
    "style_guide_adapter_change_log": {
        "style-guide-adapter",
        "cim-builder",
        "pitch-deck-builder",
        "memo-builder",
        "ib-deck-qc",
    },
    "capital_markets_issuance_to_private_credit_underwriting": {
        "capital-markets-issuance",
        "private-credit-underwriting",
    },
    "capital_markets_issuance_to_covenant_package_analyzer": {
        "capital-markets-issuance",
        "covenant-package-analyzer",
    },
    "private_credit_underwriting_to_covenant_package_analyzer": {
        "private-credit-underwriting",
        "covenant-package-analyzer",
    },
    "private_credit_underwriting_to_distressed_recovery_waterfall": {
        "private-credit-underwriting",
        "distressed-recovery-waterfall",
    },
    "distressed_recovery_waterfall_to_memo_builder": {
        "distressed-recovery-waterfall",
        "memo-builder",
    },
    "distressed_recovery_waterfall_to_pitch_deck_builder": {
        "distressed-recovery-waterfall",
        "pitch-deck-builder",
    },
    "distressed_recovery_waterfall_to_ib_deck_qc": {"distressed-recovery-waterfall", "ib-deck-qc"},
}
INTERNAL_SUPPORT_PLAYBOOKS = {"style-guide-adapter"}


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_handoff_payload", VALIDATOR)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def documented_contracts() -> set[str]:
    text = (ROOT / "references" / "handoff-contracts.md").read_text(encoding="utf-8")
    return set(re.findall(r"^## `([^`]+)`", text, flags=re.MULTILINE))


class HandoffContractSchemaCoverageTests(unittest.TestCase):
    def test_every_documented_contract_has_schema_registration_and_fixture(self) -> None:
        validator = load_validator()
        docs = documented_contracts()
        registered = set(validator.CONTRACT_SHAPES)
        self.assertEqual(len(docs), 17)
        self.assertEqual(docs, registered)
        for contract in sorted(docs):
            with self.subTest(contract=contract):
                schema_name = validator.CONTRACT_SHAPES[contract]["schema"]
                self.assertTrue((SCHEMAS / schema_name).exists(), schema_name)
                self.assertTrue((FIXTURES / f"{contract}_valid.json").exists())
                schema = json.loads((SCHEMAS / schema_name).read_text(encoding="utf-8"))
                self.assertIn("$defs", schema)
                self.assertIn("record", schema["$defs"])

    def test_p0_contracts_have_invalid_fixtures(self) -> None:
        for contract in sorted(P0_CONTRACTS):
            with self.subTest(contract=contract):
                self.assertTrue((FIXTURES / f"{contract}_invalid.json").exists())

    def test_inventory_matches_validator_registration(self) -> None:
        validator = load_validator()
        inventory = json.loads(
            (FIXTURES / "handoff_contract_inventory.json").read_text(encoding="utf-8")
        )
        rows = {row["contract_name"]: row for row in inventory["contracts"]}
        self.assertEqual(set(rows), set(validator.CONTRACT_SHAPES))
        for contract, row in rows.items():
            with self.subTest(contract=contract):
                self.assertTrue(row["schema_exists"])
                self.assertTrue(row["validator_registered"])
                self.assertTrue(row["fixture_exists"])
                self.assertIn(row["business_criticality"], {"existing", "P0", "P1"})

    def test_producer_and_consumer_skill_docs_reference_validator(self) -> None:
        docs = documented_contracts()
        self.assertEqual(docs, set(CONTRACT_SKILL_REFERENCES))
        for contract, skills in sorted(CONTRACT_SKILL_REFERENCES.items()):
            for skill in sorted(skills):
                with self.subTest(contract=contract, skill=skill):
                    path = (
                        INTERNAL_SUPPORT_ROOT / skill / "INTERNAL.md"
                        if skill in INTERNAL_SUPPORT_PLAYBOOKS
                        else ROOT / "skills" / skill / "SKILL.md"
                    )
                    text = path.read_text(encoding="utf-8")
                    self.assertIn(contract, text)
                    self.assertIn(f"validate_handoff_payload.py {contract}", text)
                    self.assertIn("Handoff payloads belong under `handoffs/`", text)
                    self.assertIn("support or agent artifacts", text)


if __name__ == "__main__":
    unittest.main()
