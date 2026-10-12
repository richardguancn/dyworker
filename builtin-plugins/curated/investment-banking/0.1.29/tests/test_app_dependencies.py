import json
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
DATASITE_APP_ID = "asdk_app_69eba17551ac81918231c83822b703b6"


def test_investment_banking_declares_datasite_app_dependency() -> None:
    manifest = json.loads((PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text())
    app_config = json.loads((PLUGIN_ROOT / ".app.json").read_text())

    assert manifest["apps"] == "./.app.json"
    assert app_config["apps"]["datasite"]["id"] == DATASITE_APP_ID


def test_datasite_app_and_plugin_are_preferred_for_deal_materials() -> None:
    source_config = json.loads(
        (
            PLUGIN_ROOT
            / "skills"
            / "user-context"
            / "plugin-author-config"
            / "source-category-config.json"
        ).read_text()
    )
    readme = (PLUGIN_ROOT / "README.md").read_text()

    deal_materials = source_config["categories"]["deal_materials"]

    assert "Datasite" in deal_materials["preferred_plugins"]
    assert "Datasite" in deal_materials["preferred_apps"]
    assert "Virtual data rooms and deal materials" in readme
    assert "Datasite connector or Datasite plugin" in readme
    assert "prefers the Datasite-owned plugin" in readme
    assert "retains the connector as a lightweight fallback" in readme
