import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dataAppActionRequest } from "../templates/data-app/base/src/data-app-actions.js";

test("dashboard skill discovery treats uploaded spreadsheets as sources, not deliverables", () => {
  const index = readFileSync(new URL("../skills/index/SKILL.md", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../skills/build-dashboard/SKILL.md", import.meta.url), "utf8");
  const indexDescription = index.match(/^description: (.+)$/mu)?.[1];
  const dashboardDescription = dashboard.match(/^description: (.+)$/mu)?.[1];

  assert.ok(indexDescription, "The Data index must expose a skill description");
  assert.ok(dashboardDescription, "The dashboard skill must expose a skill description");

  for (const [name, description] of Object.entries({ index: indexDescription, dashboard: dashboardDescription })) {
    assert.match(description, /\bdashboards?\b/iu, `${name} must recognize dashboard requests`);
    assert.match(
      description,
      /\buploaded spreadsheets?\b/iu,
      `${name} must recognize uploaded spreadsheets as dashboard sources`,
    );
    assert.match(description, /\bCSVs?\b/u, `${name} must recognize CSV dashboard sources`);
  }

  assert.match(indexDescription, /\bTSVs?\b/u, "The Data index must recognize TSV dashboard sources");
  assert.match(indexDescription, /\bsource data\b/u);
  assert.match(indexDescription, /without making the deliverable a spreadsheet/u);
});

test("dashboard routing locks the requested deliverable before spreadsheet companion selection", () => {
  const index = readFileSync(new URL("../skills/index/SKILL.md", import.meta.url), "utf8");
  const responseMode = index.match(/^## Response Mode\n([\s\S]*?)(?=^## )/mu)?.[1];
  const runOrder = index.match(/^#### Run Order\n([\s\S]*?)(?=^#### Skill Selection)/mu)?.[1];
  const skillSelection = index.match(/^#### Skill Selection\n([\s\S]*?)(?=^### )/mu)?.[1];

  assert.ok(responseMode, "The Data index must define its response-mode policy");
  assert.ok(runOrder, "The Data index must define its workflow run order");
  assert.ok(skillSelection, "The Data index must define its skill-selection policy");
  assert.match(responseMode, /Choose the output from the user's requested deliverable, not the source format/u);

  for (const extension of [".xlsx", ".csv", ".tsv"]) {
    assert.ok(
      responseMode.includes(`\`${extension}\``),
      `Response-mode selection must distinguish ${extension} source data from the requested output`,
    );
    assert.ok(
      skillSelection.includes(`\`${extension}\``),
      `Skill selection must keep ${extension} dashboard sources on the Data dashboard workflow`,
    );
  }

  const lockedResponseMode = runOrder.indexOf("Choose and lock the response mode");
  const dashboardPrimary = runOrder.indexOf("keeping `$build-dashboard` primary");
  const companionSkillPass = runOrder.indexOf("then do one companion-skill pass");

  assert.ok(lockedResponseMode >= 0, "The requested response mode must be locked");
  assert.ok(
    dashboardPrimary > lockedResponseMode,
    "Dashboard ownership must be selected after the response mode is locked",
  );
  assert.ok(
    companionSkillPass > dashboardPrimary,
    "Spreadsheet companion skills must not be selected before dashboard ownership is locked",
  );
  assert.match(
    skillSelection,
    /load `\$build-dashboard` as the primary workflow even when its source is an uploaded spreadsheet/u,
  );
  assert.match(skillSelection, /Spreadsheet skills may support read-only source ingestion/u);
  assert.match(
    skillSelection,
    /must not create or edit a workbook, own the deliverable, or redirect the output to Excel or Google Sheets unless the user explicitly requests that destination/u,
  );
});

test("ordinary Publish hands the exact app and selected audience to Sites", () => {
  for (const surface of ["dashboard", "report"]) {
    const request = dataAppActionRequest("sites", {
      surface,
      accessMode: "custom",
      dataAppReference: {
        root: "/tmp/publish-contract",
        htmlPath: "/tmp/publish-contract/dist/index.html",
      },
    });
    assert.equal(request.title, `Publish ${surface} to Sites`);
    assert.ok(request.prompt.includes("[@Sites](plugin://sites@openai-curated-remote)"));
    assert.ok(request.prompt.includes("access limited to me until I invite others"));
    assert.ok(request.prompt.includes("project directory: /tmp/publish-contract"));
    assert.ok(request.prompt.includes("HTML file: /tmp/publish-contract/dist/index.html"));
  }
});

test("Data artifact summaries choose connectors first and bound target discovery", () => {
  const dashboard = readFileSync(new URL("../skills/build-dashboard/SKILL.md", import.meta.url), "utf8");
  const report = readFileSync(new URL("../skills/build-report/SKILL.md", import.meta.url), "utf8");
  const index = readFileSync(new URL("../skills/index/SKILL.md", import.meta.url), "utf8");
  const sharing = readFileSync(new URL("../skills/share-artifact-summary/SKILL.md", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../skills/share-artifact-summary/agents/openai.yaml", import.meta.url), "utf8");

  for (const [name, skill] of Object.entries({ dashboard, report, index })) {
    const reference = skill.match(/\[\$?share-artifact-summary\]\((\.\.\/share-artifact-summary\/SKILL\.md)\)/u);
    assert.ok(reference, `${name} must reference its bundled explicit-only sharing skill`);
    const source = new URL(`../skills/${name === "index" ? "index" : `build-${name}`}/SKILL.md`, import.meta.url);
    assert.equal(
      readFileSync(new URL(reference[1], source), "utf8"),
      sharing,
      `${name}'s relative sharing-skill reference must resolve to the bundled workflow`,
    );
  }

  assert.match(sharing, /up to three[^\n]*available connectors/u);
  assert.match(sharing, /at most one bounded target-discovery call[^\n]*limit of 5/u);
  assert.match(sharing, /published Data app's selected-view link/u);
  assert.match(sharing, /keep the supported view parameters/u);
  assert.match(sharing, /For other source links, remove query parameters/u);
  assert.match(sharing, /Remove fragments and task IDs/u);
  assert.match(sharing, /Reject URLs containing credentials[^\n]*private network addresses/u);
  assert.match(sharing, /slack_complete_file_upload/u);
  assert.match(agent, /allow_implicit_invocation:\s*false/u, "Artifact sharing must run only when directly invoked");
  for (const surface of ["dashboard", "report"]) {
    assert.match(
      dataAppActionRequest("share-summary", { surface }).prompt,
      /\$share-artifact-summary\b/u,
      `${surface} sharing must explicitly invoke the protected sharing skill`,
    );
  }
});
