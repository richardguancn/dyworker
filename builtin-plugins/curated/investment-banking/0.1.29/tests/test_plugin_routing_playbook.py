from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTING_MAP = ROOT / "references" / "plugin-routing-map.json"
ROUTING_PLAYBOOK = ROOT / "references" / "plugin-routing-playbook.md"
ROUTING_SCHEMA = ROOT / "schemas" / "plugin_routing_map.schema.json"
VALIDATOR = ROOT / "scripts" / "validate_handoff_payload.py"
INTERNAL_SUPPORT_ROOT = ROOT / "skills" / "investment-banking" / "internal-support"

REQUIRED_WORKFLOWS = {
    "sell_side_auction",
    "sponsor_buy_side",
    "levfin_financing",
    "ecm",
    "dcm",
    "board_package",
    "fairness_committee_support",
    "restructuring_pitch",
    "model_update",
    "deal_committee",
}
SUPPORT_EXTENSIONS = {".json", ".csv", ".md", ".markdown", ".log", ".txt"}
INTERNAL_SUPPORT_PLAYBOOKS = {
    "daloopa-provider-guide",
    "dashboard-builder",
    "excel-data-cleaner",
    "financial-source-of-truth",
    "quartr-provider-guide",
    "style-guide-adapter",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_handoff_payload", VALIDATOR)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def playbook_path(skill: str) -> Path:
    return (
        INTERNAL_SUPPORT_ROOT / skill / "INTERNAL.md"
        if skill in INTERNAL_SUPPORT_PLAYBOOKS
        else ROOT / "skills" / skill / "SKILL.md"
    )


class PluginRoutingPlaybookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.routing_map = load_json(ROUTING_MAP)
        self.workflows = {
            workflow["workflow_id"]: workflow for workflow in self.routing_map["workflows"]
        }

    def test_playbook_map_and_schema_exist(self) -> None:
        self.assertTrue(ROUTING_PLAYBOOK.exists())
        self.assertTrue(ROUTING_MAP.exists())
        self.assertTrue(ROUTING_SCHEMA.exists())
        schema = load_json(ROUTING_SCHEMA)
        self.assertEqual(schema["properties"]["plugin"]["const"], "investment-banking")
        self.assertIn("workflows", schema["required"])
        self.assertIn("workflow", schema["$defs"])

    def test_required_workflows_are_present_once(self) -> None:
        workflow_ids = [workflow["workflow_id"] for workflow in self.routing_map["workflows"]]
        self.assertEqual(len(workflow_ids), len(set(workflow_ids)))
        self.assertEqual(set(workflow_ids), REQUIRED_WORKFLOWS)
        playbook = ROUTING_PLAYBOOK.read_text(encoding="utf-8")
        for workflow in self.routing_map["workflows"]:
            with self.subTest(workflow=workflow["workflow_id"]):
                self.assertIn(workflow["workflow_name"], playbook)
                self.assertIn(workflow["lead_skill"], playbook)

    def test_every_referenced_skill_exists(self) -> None:
        for workflow in self.routing_map["workflows"]:
            workflow_skills = [workflow["lead_skill"], *workflow["supporting_skills"]]
            for skill in workflow_skills:
                with self.subTest(workflow=workflow["workflow_id"], skill=skill):
                    self.assertTrue(playbook_path(skill).exists(), skill)
            for handoff in workflow["handoff_contracts"]:
                with self.subTest(
                    workflow=workflow["workflow_id"], contract=handoff["contract_name"]
                ):
                    producer = str(handoff["producer_skill"])
                    consumer = str(handoff["consumer_skill"])
                    if producer != "model builders":
                        self.assertIn(producer, workflow_skills)
                    if consumer != "model builders":
                        self.assertIn(consumer, workflow_skills)

    def test_referenced_handoff_contracts_are_schema_backed_and_registered(self) -> None:
        validator = load_validator()
        registered = set(validator.CONTRACT_SHAPES)
        for workflow in self.routing_map["workflows"]:
            self.assertIsInstance(workflow["handoff_contracts"], list)
            for handoff in workflow["handoff_contracts"]:
                contract = handoff["contract_name"]
                with self.subTest(workflow=workflow["workflow_id"], contract=contract):
                    self.assertIn(contract, registered)
                    schema_name = validator.CONTRACT_SHAPES[contract]["schema"]
                    self.assertTrue((ROOT / "schemas" / schema_name).exists())
                    self.assertTrue(handoff["required_when"])

    def test_workflows_have_banker_artifact_hierarchy_and_gates(self) -> None:
        for workflow in self.routing_map["workflows"]:
            with self.subTest(workflow=workflow["workflow_id"]):
                self.assertTrue(workflow["hero_deliverable"])
                hero_suffix = Path(workflow["hero_deliverable"]).suffix.lower()
                self.assertNotIn(hero_suffix, SUPPORT_EXTENSIONS)
                self.assertGreaterEqual(len(workflow["source_gates"]), 1)
                self.assertGreaterEqual(len(workflow["quality_gates"]), 1)
                self.assertGreaterEqual(len(workflow["routing_triggers"]), 1)
                self.assertGreaterEqual(len(workflow["do_not_route_when"]), 1)
                self.assertGreaterEqual(len(workflow["escalation_paths"]), 1)
                support_text = " ".join(workflow["support_artifacts"]).lower()
                self.assertTrue(
                    any(folder in support_text for folder in ["support/", "logs/", "handoffs/"])
                )
                self.assertIn(
                    workflow["default_artifact_mode"],
                    {
                        "workbook",
                        "html_report",
                        "html_dashboard",
                        "native_deck",
                        "native_document",
                        "generated_package",
                        "hybrid",
                        "chat_only",
                    },
                )

    def test_every_skill_doc_references_plugin_routing_playbook(self) -> None:
        for skill_md in sorted((ROOT / "skills").glob("*/SKILL.md")):
            if skill_md.parent.name == "user-context":
                continue
            with self.subTest(skill=skill_md.parent.name):
                text = skill_md.read_text(encoding="utf-8")
                self.assertIn("## Plugin Workflow Routing", text)
                expected_path = (
                    "references/plugin-routing-playbook.md"
                    if skill_md.parent.name == "investment-banking"
                    else "../../references/plugin-routing-playbook.md"
                )
                self.assertIn(expected_path, text)
                self.assertIn("artifact hierarchy", text.lower())

    def test_internal_support_playbooks_are_packaged_but_not_visible_skills(self) -> None:
        policy = (INTERNAL_SUPPORT_ROOT / "policy.md").read_text(encoding="utf-8")
        router = (ROOT / "skills" / "investment-banking" / "SKILL.md").read_text(encoding="utf-8")
        visible = {path.parent.name for path in (ROOT / "skills").glob("*/SKILL.md")}

        self.assertEqual(23, len(visible))
        self.assertIn("internal-support/policy.md", router)
        for skill in INTERNAL_SUPPORT_PLAYBOOKS:
            self.assertNotIn(skill, visible)
            self.assertIn(f"internal-support/{skill}/INTERNAL.md", policy)
            self.assertTrue(playbook_path(skill).exists())
            self.assertFalse((ROOT / "skills" / skill).exists())

    def test_router_resolves_bundled_paths_from_the_plugin_root(self) -> None:
        router_path = ROOT / "skills" / "investment-banking" / "SKILL.md"
        router = router_path.read_text(encoding="utf-8")

        self.assertIn("Derive the plugin root once", router)
        self.assertIn("Set the shell working directory to that plugin root", router)
        self.assertIn("Do not apply `../..` to an already resolved plugin root", router)
        for relative_path in [
            "references/invocation-policy.md",
            "references/plugin-routing-playbook.md",
            "references/deliverable-intake-policy.md",
            "skills/user-context/SKILL.md",
            "skills/investment-banking/internal-support/policy.md",
        ]:
            with self.subTest(relative_path=relative_path):
                self.assertIn(relative_path, router)
                self.assertTrue((ROOT / relative_path).resolve().exists())

    def test_router_selects_lead_skill_without_resolving_presentation(self) -> None:
        router = (ROOT / "skills" / "investment-banking" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        playbook = (ROOT / "references" / "plugin-routing-playbook.md").read_text(
            encoding="utf-8"
        )
        invocation_policy = (ROOT / "references" / "invocation-policy.md").read_text(
            encoding="utf-8"
        )

        for phrase in [
            "Pass relevant entries from `saved_context` to the selected lead skill as handoff context",
            "must not interpret saved output preferences",
            "do not use it to resolve the current request's output",
            "load `skills/<lead-skill>/SKILL.md` from the plugin root before source gathering",
            "must not continue substantive work as a substitute for the selected lead skill",
            "The router does not perform deliverable intake",
            "The lead owner, not the router",
        ]:
            self.assertIn(phrase, router)
        for phrase in [
            "use this playbook only to choose the lead skill",
            "do not authorize the router to resolve or announce",
            "selected lead skill owns deliverable intake",
            "Ask at the router stage only when the answer changes plugin admission or lead-skill selection",
        ]:
            self.assertIn(phrase, playbook)
        self.assertIn("The selected lead workflow, not the router", invocation_policy)
        self.assertNotIn("- first artifact:", playbook)

    def test_artifact_manifest_schema_documents_optional_routing_metadata(self) -> None:
        schema = load_json(ROOT / "schemas" / "artifact_manifest.schema.json")
        standard = (ROOT / "references" / "artifact-manifest-standard.md").read_text(
            encoding="utf-8"
        )
        for field in [
            "transaction_workflow",
            "lead_skill",
            "supporting_skills",
            "routing_confidence",
            "handoff_contracts_used",
            "routing_reason",
        ]:
            with self.subTest(field=field):
                self.assertIn(field, schema["properties"])
                self.assertIn(field, standard)

    def test_provider_guides_load_only_for_callable_selected_routes(self) -> None:
        text = (ROOT / "references" / "workflow-source-resolution.md").read_text(encoding="utf-8")
        self.assertIn("Do not load provider guides merely because `.app.json` declares", text)
        for provider in ["daloopa", "quartr"]:
            with self.subTest(provider=provider):
                self.assertIn(
                    f"skills/investment-banking/internal-support/{provider}-provider-guide/INTERNAL.md",
                    text,
                )
                self.assertNotIn(
                    f"../skills/investment-banking/internal-support/{provider}-provider-guide/INTERNAL.md",
                    text,
                )
                guide_root = INTERNAL_SUPPORT_ROOT / f"{provider}-provider-guide"
                internal = (guide_root / "INTERNAL.md").read_text(encoding="utf-8")
                self.assertIn("references/connector-playbook.md", internal)
                self.assertIn("references/workbook-mode.md", internal)
                self.assertTrue((guide_root / "references" / "connector-playbook.md").exists())
                self.assertTrue((guide_root / "references" / "workbook-mode.md").exists())


if __name__ == "__main__":
    unittest.main()
