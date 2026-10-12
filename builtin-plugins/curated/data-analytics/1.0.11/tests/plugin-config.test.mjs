import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("plugin release metadata remains synchronized", () => {
  const plugin = readJson("../.codex-plugin/plugin.json");
  const pluginPackage = readJson("../package.json");
  const packageLock = readJson("../package-lock.json");

  assert.equal(pluginPackage.version, plugin.version);
  assert.equal(packageLock.version, plugin.version);
  assert.equal(packageLock.packages[""].version, plugin.version);
});

test("the root test environment declares React for nested Data app tests", () => {
  const pluginPackage = readJson("../package.json");
  const packageLock = readJson("../package-lock.json");
  const reactVersion = pluginPackage.devDependencies.react;
  const lockedReact = packageLock.packages["node_modules/react"];

  assert.equal(reactVersion, "^19.2.3");
  assert.equal(packageLock.packages[""].devDependencies.react, reactVersion);
  assert.ok(lockedReact);
  assert.match(lockedReact.resolved, /^https:\/\/registry\.npmjs\.org\/react\/-\/react-[^/]+\.tgz$/u);
  assert.equal(pluginPackage.dependencies?.react, undefined);
});

test("plugin dependencies preserve optional installation and categorized provider identities", () => {
  const plugin = readJson("../.codex-plugin/plugin.json");
  const dependencies = plugin.extensions["com.openai"].dependencies;
  const identities = new Set();

  assert.equal(plugin.apps, undefined, "Dependency resolution must not rely on the legacy app mapping");
  assert.ok(Array.isArray(dependencies) && dependencies.length > 0);
  for (const dependency of dependencies) {
    assert.equal(dependency.isRequired, false, "Missing integrations must not prevent installing Data");
    assert.match(dependency.name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
    assert.match(dependency.marketplace, /^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
    const identity = `${dependency.name.toLowerCase()}@${dependency.marketplace}`;
    assert.equal(identities.has(identity), false, `Duplicate provider identity: ${identity}`);
    identities.add(identity);
    assert.ok(Array.isArray(dependency.categories) && dependency.categories.length > 0);
    assert.equal(new Set(dependency.categories).size, dependency.categories.length);
    for (const category of dependency.categories) {
      assert.equal(typeof category, "string");
      assert.ok(category.length > 0 && category === category.trim());
      assert.doesNotMatch(category, /[\u0000-\u001f\u007f-\u009f]/u);
    }
  }
});

test("the bundled demo is a well-formed seven-column CSV", () => {
  const rows = readFileSync(new URL("../assets/demo-product-growth.csv", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/u);

  assert.equal(
    rows[0],
    "week_start,acquisition_channel,signups,activated_users,paid_conversions,revenue_usd,support_tickets",
  );
  assert.ok(rows.length > 1);
  assert.ok(rows.every((row) => row.split(",").length === 7));
});

test("dashboard and report surfaces ship the shared Data app runtime", () => {
  const pluginPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(existsSync(new URL("../templates/data-app/base/src/App.jsx", import.meta.url)), true);
  assert.equal(existsSync(new URL("../templates/data-app/base/src/DataAppShell.jsx", import.meta.url)), true);
  assert.equal(
    existsSync(new URL("../templates/data-app/base/src/content/dashboard/DashboardContent.jsx", import.meta.url)),
    true,
  );
  assert.equal(
    existsSync(new URL("../templates/data-app/base/src/content/report/ReportContent.jsx", import.meta.url)),
    true,
  );
  assert.equal(existsSync(new URL("../templates/data-app/base/AGENTS.md", import.meta.url)), true);
  assert.equal(existsSync(new URL("../templates/data-app/base/src/data-app-public.jsx", import.meta.url)), true);
  assert.equal(existsSync(new URL("../templates/data-app/base/protected-runtime.json", import.meta.url)), true);
  assert.match(
    pluginPackage.scripts.test,
    /templates\/data-app\/base\/tests\/\*\.test\.mjs/u,
    "The ordinary plugin test command must include protected starter and integrity coverage",
  );
  assert.equal(existsSync(new URL("../skills/build-dashboard/templates/base/package.json", import.meta.url)), false);
  assert.equal(existsSync(new URL("../skills/build-report/templates/base/package.json", import.meta.url)), false);
});

test("report documents use a neutral fallback preset and preserve supplied templates", () => {
  const documentSkill = readFileSync(new URL("../skills/convert-to-doc/SKILL.md", import.meta.url), "utf8");

  assert.match(documentSkill, /If strong candidates exist in memory or user context, suggest them and include a link/u);
  assert.match(documentSkill, /If none exist, use the Documents plugin's built-in `google_docs_default` preset/u);
  assert.match(
    documentSkill,
    /Only create a cover page, title page, or introductory page if the selected template includes one/u,
  );
  assert.match(documentSkill, /preserve its layout and formatting/u);
  assert.match(documentSkill, /delete unused sections only when the document is complete/u);
});

test("document and slide exports reuse local or hosted Data apps and build a requested source when needed", () => {
  const documentSkill = readFileSync(new URL("../skills/convert-to-doc/SKILL.md", import.meta.url), "utf8");
  const slidesSkill = readFileSync(new URL("../skills/convert-to-slides/SKILL.md", import.meta.url), "utf8");
  const routingSkill = readFileSync(new URL("../skills/index/SKILL.md", import.meta.url), "utf8");
  const appActions = readFileSync(
    new URL("../templates/data-app/base/src/data-app-actions.js", import.meta.url),
    "utf8",
  );

  for (const skill of [documentSkill, slidesSkill]) {
    assert.match(skill, /For a local app, use its `dist\/index\.html` and `src\/data\.json` directly/u);
    assert.match(skill, /reviewed snapshot from `\/api\/snapshot`/u);
    assert.match(skill, /saved presentation state from `\/api\/presentation`/u);
    assert.match(skill, /Reject other remote sources/u);
    assert.match(skill, /Do not create an intermediate report or rebuild the app/u);
    assert.doesNotMatch(skill, /\$build-report/u);
  }

  for (const name of ["convert-to-doc", "convert-to-slides"]) {
    const qualifiedName = `data-analytics:${name}`;
    const route = routingSkill.split(`### ${name}\n`)[1]?.split("\n### ")[0];
    assert.ok(route, `Missing ${name} route`);
    assert.match(route, /when an existing Data app is identified/u);
    assert.match(route, /If no Data app exists, ask the user to choose whether to build a dashboard or a report/u);
    assert.match(route, /invoke \$build-dashboard or \$build-report for that choice/u);
    assert.match(route, new RegExp(`invoke \\$${qualifiedName} once the chosen app is built and verified`, "u"));
    assert.match(appActions, new RegExp(`\\$${qualifiedName}`, "u"));
  }

  assert.doesNotMatch([routingSkill, appActions].join("\n"), /report-to-(?:doc|slides)/u);
});

test("the Data app uses reviewed data for its document title", () => {
  const html = readFileSync(new URL("../templates/data-app/base/index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../templates/data-app/base/src/main.jsx", import.meta.url), "utf8");

  assert.match(html, /<title>Data app<\/title>/u);
  assert.match(main, /document\.title = reviewedSnapshot\.title/u);
});
