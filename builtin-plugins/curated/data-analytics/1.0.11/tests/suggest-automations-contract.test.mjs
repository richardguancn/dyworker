import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const index = read("../skills/index/SKILL.md");
const primaryWorkflows = new Map([
  ["KPI reporting", read("../skills/kpi-reporting/SKILL.md")],
  ["metric diagnostics", read("../skills/metric-diagnostics/SKILL.md")],
  ["product and business analysis", read("../skills/product-business-analysis/SKILL.md")],
  ["data-quality analysis", read("../skills/analyze-data-quality/SKILL.md")],
]);
const dashboardSkill = read("../skills/build-dashboard/SKILL.md");
const deliveryPath = dashboardSkill.match(/\]\((\.\.\/\.\.\/shared\/data-app\.md)#publication-and-final-delivery\)/)?.[1];
assert.ok(deliveryPath, "Dashboard delivery must route to the shared delivery policy");
const deliveryUrl = new URL(deliveryPath, new URL("../skills/build-dashboard/SKILL.md", import.meta.url));
const delivery = readFileSync(deliveryUrl, "utf8");
const publicationPath = delivery.match(/\]\((\.\.\/skills\/publish-artifact-to-sites\/SKILL\.md)\)/)?.[1];
assert.ok(publicationPath, "Shared delivery must route to the publication skill");
const publicationUrl = new URL(publicationPath, deliveryUrl);
const publication = readFileSync(publicationUrl, "utf8");
const refreshPath = publication.match(/\]\((\.\.\/\.\.\/shared\/data-app\.md)#offer-automatic-refresh\)/)?.[1];
assert.ok(refreshPath, "Publication must route to the shared automatic refresh policy");
const refreshPolicy = readFileSync(new URL(refreshPath, publicationUrl), "utf8");

test("suggest-automation launcher stays generic and leaves setup to the click flow", () => {
  assert.match(index, /`suggest_automation` is a user-visible launcher/);
  assert.match(index, /click starts the separate hidden automation-creation flow/);
  assert.match(index, /Only the primary analytical skill may originate it/);
  assert.match(index, /after the answer and any required report or dashboard handoff are complete/);
  assert.match(index, /emit exactly one runtime-provided `suggest_automation` invocation/);
  assert.match(index, /visible label `Make this repeatable`/);
  assert.ok(index.includes('genui{"suggest_automation":{"label":"Make this repeatable"}}'));
  assert.match(index, /Keep the label generic/);
  assert.match(index, /Do not ask cadence or delivery questions, call automation-creation tools, or create the automation in the same turn/);
  assert.match(index, /If the runtime does not surface `suggest_automation`, omit the suggestion entirely instead of replacing it with a prose CTA/);

  const invocationLabels = [
    ...[index, ...primaryWorkflows.values()]
      .join("\n")
      .matchAll(/"suggest_automation":\{"label":"([^"]+)"\}/g),
  ].map((match) => match[1]);
  assert.deepEqual(invocationLabels, ["Make this repeatable"]);
});

test("generic primary workflows define completion-gated positive and negative boundaries", () => {
  for (const [name, guidance] of primaryWorkflows) {
    assert.match(guidance, /### Suggest Automations/, name);
    assert.match(guidance, /may originate `suggest_automation` under the plugin index's shared contract only after/, name);
    assert.match(guidance, /will likely recur/, name);
    assert.match(guidance, /- Eligible:/, name);
    assert.match(guidance, /- Ineligible:/, name);
    assert.match(guidance, /- Example: after completing/, name);
    assert.match(guidance, /shared generic `Make this repeatable` launcher/, name);
  }
});

test("refreshable Sites dashboard and report handoffs end with the plain-language cadence question", () => {
  const question = "Would you like me to create a cloud task to keep this updated automatically (hourly, daily, weekly, or monthly)?";
  assert.ok(refreshPolicy.includes(question));
  assert.match(refreshPolicy, /source that can be read again without a new upload or pasted data/);
  assert.match(refreshPolicy, /Make this the final sentence of the handoff/);
  assert.match(refreshPolicy, /Skip the offer during scheduled runs, when this app already has a refresh job, or for one-time inputs such as uploaded files or sample data/);
  assert.match(index, /Report\/dashboard refresh and Data Context source upkeep are narrow exceptions/);
  assert.match(index, /source that can be read again without another upload/);
  assert.match(index, /exact final-question rule/);
});

test("negative boundaries suppress premature suggestions", () => {
  assert.match(index, /Do not suggest it for one-off or exploratory work, bounded quick answers, templates or mockups, incomplete or blocked workflows/);
  assert.match(index, /unstable sources or definitions, an already-automated workflow, or a workflow that already received a suggestion/);

  const quality = primaryWorkflows.get("data-quality analysis");
  assert.match(quality, /Recommend an automated data test only when the rule is stable and worth maintaining/);
  assert.match(quality, /do not confuse it with the automated-test recommendation/);
});
