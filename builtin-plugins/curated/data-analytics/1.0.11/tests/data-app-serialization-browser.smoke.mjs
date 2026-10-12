import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";

import { chromium } from "playwright-core";

import { assembleDataAppHtml, embeddedScript, embeddedStyle } from "../scripts/data-app-build.mjs";
import { resolveChromiumExecutable } from "./browser-helpers.mjs";

// This exercises Chromium's actual HTML tokenizer, not a second implementation
// of it. Set CHROMIUM_EXECUTABLE_PATH to an existing browser when necessary; the
// smoke never installs a browser or any customer app dependencies.
const executablePath = resolveChromiumExecutable();
const workspace = await mkdtemp(join(tmpdir(), "data-app-serialization-browser-"));
const javascriptUrl = "data:text/javascript;charset=utf-8;base64,";
const cssUrl = "data:text/css;charset=utf-8;base64,";
const runtimeHash = "a".repeat(64);
const passed = [];
let browser;

function sha256(value, encoding = "hex") {
  return createHash("sha256").update(value).digest(encoding);
}

function expectedJson(expression) {
  return new Script(`JSON.stringify(${expression})`).runInNewContext({}, { timeout: 1000 });
}

function scriptMarkup(source, encoded, label) {
  const markup = embeddedScript(source);
  assert.equal(
    markup,
    encoded
      ? `<script src="${javascriptUrl}${Buffer.from(source, "utf8").toString("base64")}"></script>`
      : `<script>${source}</script>`,
    `${label}: preserve the exact UTF-8 source in an ordered classic script`,
  );
  return markup;
}

function documentHtml({ head = "", body = "" }) {
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
}

async function withDocument(name, html, check) {
  const path = join(workspace, `${name}.html`);
  await writeFile(path, html, "utf8");
  const page = await browser.newPage({ bypassCSP: false });
  const pageErrors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (["file:", "data:"].includes(new URL(url).protocol)) return route.continue();
    externalRequests.push(url);
    return route.abort("blockedbyclient");
  });
  try {
    await page.goto(pathToFileURL(path).href, { waitUntil: "load" });
    await check(page);
    assert.deepEqual(pageErrors, [], `${name}: no JavaScript errors`);
    assert.deepEqual(externalRequests, [], `${name}: no external document requests`);
    passed.push(name);
  } finally {
    await page.close();
  }
}

async function executableScripts(page) {
  return page.locator("script:not([type])").evaluateAll((scripts) =>
    scripts.map((script) => ({
      src: script.getAttribute("src"),
      code: script.textContent,
      async: script.hasAttribute("async"),
      defer: script.hasAttribute("defer"),
    })),
  );
}

function assertClassicScripts(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const { source, encoded } = expected[index];
    assert.deepEqual(actual[index], {
      src: encoded ? `${javascriptUrl}${Buffer.from(source, "utf8").toString("base64")}` : null,
      code: encoded ? "" : source,
      async: false,
      defer: false,
    });
  }
}

const scriptCases = [
  { name: "ordinary-unicode", expression: '"π☕️🙂\u2028\u2029"', encoded: false },
  {
    name: "mixed-closing-tag",
    expression: JSON.stringify("</ScRiPt><sCrIpT>document.documentElement.dataset.scriptInjected='yes'</sCrIpT>"),
    encoded: true,
  },
  { name: "mixed-opening-tag", expression: JSON.stringify("<sCrIpT data-marker='inert'>"), encoded: true },
  { name: "html-comment", expression: JSON.stringify("<!--"), encoded: true },
  { name: "ordinary-middle", expression: '"still ordered λ"', encoded: false },
  {
    name: "tagged-raw-template",
    expression: "String.raw`</ScRiPt>\\n\\u{1f642}\\xGG`",
    encoded: true,
  },
  {
    name: "regexp-and-string",
    expression: '({source: /<sCrIpT[ >]/giu.source, matches: /<script[ >]/giu.test("<script>")})',
    encoded: true,
  },
  { name: "literal-nul", expression: '"before\0after"', encoded: true },
  { name: "literal-cr", expression: "`before\rafter`", encoded: true },
  { name: "literal-crlf", expression: "String.raw`before\r\nafter`", encoded: true },
  {
    name: "unicode-with-tokenizers",
    expression: JSON.stringify("☕️🙂\u2028\u2029<!--<ScRiPt></sCrIpT>"),
    encoded: true,
  },
  { name: "ordinary-last", expression: "({division: 12 / 3, text: 'last'})", encoded: false },
];

async function verifyScriptSemantics() {
  const prelude = `globalThis.serializationOrder = [];
globalThis.recordSerializationValue = (name, value) => {
  serializationOrder.push(name);
  const row = document.createElement("li");
  row.dataset.case = name;
  row.textContent = JSON.stringify(value);
  document.getElementById("results").append(row);
};
recordSerializationValue("start", "ready");`;
  const tail = `recordSerializationValue("tail", serializationOrder.slice());
document.body.dataset.complete = "true";`;
  const sources = [
    { source: prelude, encoded: false, name: "start" },
    ...scriptCases.map((fixture) => ({
      ...fixture,
      source: `recordSerializationValue(${JSON.stringify(fixture.name)}, ${fixture.expression});`,
    })),
    { source: tail, encoded: false, name: "tail" },
  ];
  const html = documentHtml({
    body: `<ol id="results"></ol>${sources
      .map(({ source, encoded, name }) => scriptMarkup(source, encoded, name))
      .join("\n")}`,
  });
  await withDocument("script-semantics", html, async (page) => {
    assert.equal(await page.locator("body").getAttribute("data-complete"), "true");
    assert.deepEqual(
      await page
        .locator("#results > li")
        .evaluateAll((rows) => rows.map((row) => ({ name: row.dataset.case, json: row.textContent }))),
      [
        { name: "start", json: JSON.stringify("ready") },
        ...scriptCases.map(({ name, expression }) => ({ name, json: expectedJson(expression) })),
        { name: "tail", json: JSON.stringify(["start", ...scriptCases.map(({ name }) => name)]) },
      ],
      "Mixed inline/data scripts must preserve source semantics and parser execution order",
    );
    assertClassicScripts(await executableScripts(page), sources);
    assert.equal(await page.locator("html").getAttribute("data-script-injected"), null);
  });
}

function assemblyInput({ runtimeEncoded, factoryEncoded }) {
  const runtimeExpression = runtimeEncoded ? "String.raw`runtime:</ScRiPt>\\n☕️`" : JSON.stringify("runtime π🙂");
  const factoryExpression = factoryEncoded ? "String.raw`factory:<!--<ScRiPt>\\u{1f642}`" : JSON.stringify("factory λ");
  const snapshot = JSON.parse('{"queries":{},"__proto__":{"polluted":true}}');
  snapshot.title = "Reviewed </title><ScRiPt>document.documentElement.dataset.snapshotInjected='yes'</ScRiPt>";
  snapshot.queries.reviewed = { rows: [{ value: "\0π🙂</script><!--\u2028\u2029" }] };
  const appCode = `globalThis.assemblyOrder = ["runtime"];
globalThis.assemblyRuntimeValue = ${runtimeExpression};
globalThis.CodexDataAppRuntime = {
  apiVersion: 1,
  mount({reviewedSnapshot, createContent}) {
    const {DashboardContent, ReportContent} = createContent(reviewedSnapshot);
    assemblyOrder.push("mount");
    const output = document.createElement("output");
    output.id = "assembled-result";
    output.textContent = JSON.stringify({
      order: assemblyOrder,
      runtimeValue: assemblyRuntimeValue,
      dashboard: DashboardContent(),
      report: ReportContent(),
      sameSnapshot: reviewedSnapshot === globalThis.factorySnapshot,
      ownProto: Object.hasOwn(reviewedSnapshot, "__proto__"),
      prototypeClean: Object.getPrototypeOf(reviewedSnapshot) === Object.prototype,
      pollution: Object.prototype.polluted ?? null
    });
    document.getElementById("root").append(output);
  }
};`;
  return {
    input: {
      appCode,
      protectedStyles: "#root { --serialization-order: protected; }",
      printStyles: "@media print { #root { --serialization-order: print; } }",
      authored: {
        themeCss: "#root { --serialization-order: theme; }",
        conventionalCss: "#root { --serialization-order: authored; }",
        importedCss: "",
        factorySource: `(function(runtime, snapshot) {
          assemblyOrder.push("factory");
          globalThis.factorySnapshot = snapshot;
          const value = ${factoryExpression};
          return {
            DashboardContent() { return {title: snapshot.title, value}; },
            ReportContent() { return snapshot.queries.reviewed.rows[0].value; }
          };
        })`,
      },
      snapshotBytes: Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`),
      runtimeSha256: runtimeHash,
    },
    expected: {
      order: ["runtime", "factory", "mount"],
      runtimeValue: JSON.parse(expectedJson(runtimeExpression)),
      dashboard: { title: snapshot.title, value: JSON.parse(expectedJson(factoryExpression)) },
      report: snapshot.queries.reviewed.rows[0].value,
      sameSnapshot: true,
      ownProto: true,
      prototypeClean: true,
      pollution: null,
    },
  };
}

async function verifyAssembly() {
  for (const runtimeEncoded of [false, true]) {
    for (const factoryEncoded of [false, true]) {
      const { input, expected } = assemblyInput({ runtimeEncoded, factoryEncoded });
      const { html, snapshotSha256 } = assembleDataAppHtml(input);
      assert.equal(snapshotSha256, sha256(input.snapshotBytes));
      const name = `assembly-${runtimeEncoded ? "data" : "inline"}-${factoryEncoded ? "data" : "inline"}`;
      await withDocument(name, html, async (page) => {
        assert.deepEqual(JSON.parse(await page.locator("#assembled-result").textContent()), expected);
        assert.equal(await page.title(), expected.dashboard.title);
        assert.equal(
          await page.locator('meta[name="data-app-snapshot-sha256"]').getAttribute("content"),
          snapshotSha256,
        );
        assert.equal(await page.locator('meta[name="data-app-runtime-sha256"]').getAttribute("content"), runtimeHash);
        const scripts = await executableScripts(page);
        assert.equal(scripts.length, 2);
        assert.deepEqual(
          scripts.map(({ src }) => src !== null),
          [runtimeEncoded, factoryEncoded],
        );
        assert.ok(scripts.every(({ async, defer }) => !async && !defer));
        assert.equal(
          await page
            .locator("#root")
            .evaluate((root) => getComputedStyle(root).getPropertyValue("--serialization-order").trim()),
          "authored",
        );
        assert.equal(await page.locator("html").getAttribute("data-snapshot-injected"), null);
      });
    }
  }
}

async function verifyStyleEmbedding() {
  const hazard =
    "</StYlE><sCrIpT>document.documentElement.dataset.styleInjected='yes'</sCrIpT><div id='style-injected'>";
  const ordinary = ".ordinary { color: rgb(70, 80, 90); }";
  const unusual = `#css-probe { color: rgb(17, 34, 51); --literal: ${JSON.stringify(hazard)}; }`;
  assert.equal(embeddedStyle(ordinary), `<style>${ordinary}</style>`);
  assert.equal(
    embeddedStyle(unusual),
    `<link rel="stylesheet" href="${cssUrl}${Buffer.from(unusual, "utf8").toString("base64")}">`,
  );
  await withDocument(
    "style-tokenizer",
    documentHtml({
      head: `${embeddedStyle(ordinary)}${embeddedStyle(unusual)}`,
      body: '<div class="ordinary">ordinary</div><div id="css-probe">encoded stylesheet</div>',
    }),
    async (page) => {
      assert.equal(
        await page.locator(".ordinary").evaluate((element) => getComputedStyle(element).color),
        "rgb(70, 80, 90)",
      );
      assert.equal(
        await page.locator("#css-probe").evaluate((element) => getComputedStyle(element).color),
        "rgb(17, 34, 51)",
      );
      assert.ok(
        (
          await page
            .locator("#css-probe")
            .evaluate((element) => getComputedStyle(element).getPropertyValue("--literal"))
        ).includes(hazard),
      );
      assert.equal(await page.locator("style").count(), 1);
      assert.equal(
        await page.locator('link[rel="stylesheet"]').getAttribute("href"),
        `${cssUrl}${Buffer.from(unusual).toString("base64")}`,
      );
      assert.equal(await page.locator("#style-injected").count(), 0);
      assert.equal(await page.locator("script").count(), 0);
      assert.equal(await page.locator("html").getAttribute("data-style-injected"), null);
    },
  );
}

async function verifyRestrictiveCsp() {
  const appCode = `document.documentElement.dataset.cspRuntime = "ran";
document.addEventListener("securitypolicyviolation", (event) => {
  if (!event.effectiveDirective.startsWith("script-src")) return;
  const output = document.createElement("output");
  output.id = "csp-script-violation";
  output.textContent = JSON.stringify({
    blockedURI: event.blockedURI,
    effectiveDirective: event.effectiveDirective,
    disposition: event.disposition
  });
  document.body.append(output);
});
globalThis.CodexDataAppRuntime = {
  apiVersion: 1,
  mount() { document.documentElement.dataset.cspMount = "ran"; }
};`;
  const tail = 'document.documentElement.dataset.cspTail = "ran";';
  const styleSource = "\n\n\n\n";
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${sha256(appCode, "base64")}' 'sha256-${sha256(tail, "base64")}'`,
    `style-src 'sha256-${sha256(styleSource, "base64")}'`,
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
  assert.doesNotMatch(policy, /data:|unsafe-inline|unsafe-eval/u);
  const { html } = assembleDataAppHtml({
    appCode,
    protectedStyles: "",
    printStyles: "",
    authored: {
      themeCss: "",
      conventionalCss: "",
      importedCss: "",
      factorySource: `(function() {
        document.documentElement.dataset.cspFactory = "ran";
        const literal = String.raw\`</ScRiPt>\`;
        return {DashboardContent() {return literal;}, ReportContent() {return null;}};
      })`,
    },
    snapshotBytes: Buffer.from('{"title":"CSP fixture","queries":{}}'),
    runtimeSha256: runtimeHash,
  });
  const restrictedHtml = html
    .replace(
      '<meta charset="utf-8">',
      () => `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`,
    )
    .replace("</body>", () => `${scriptMarkup(tail, false, "CSP tail")}\n</body>`);
  await withDocument("restrictive-csp", restrictedHtml, async (page) => {
    await page.locator("#csp-script-violation").waitFor({ state: "attached" });
    const violation = JSON.parse(await page.locator("#csp-script-violation").first().textContent());
    assert.match(violation.blockedURI, /^data(?::|$)/u);
    assert.match(violation.effectiveDirective, /^script-src(?:-elem)?$/u);
    assert.equal(violation.disposition, "enforce");
    assert.equal(await page.locator("html").getAttribute("data-csp-runtime"), "ran");
    assert.equal(await page.locator("html").getAttribute("data-csp-tail"), "ran");
    assert.equal(await page.locator("html").getAttribute("data-csp-factory"), null);
    assert.equal(await page.locator("html").getAttribute("data-csp-mount"), null);
    assert.equal(await page.locator("#root").textContent(), "");
    const policies = page.locator('meta[http-equiv="Content-Security-Policy"]');
    assert.equal(await policies.count(), 1);
    assert.equal(await policies.getAttribute("content"), policy);
    assert.deepEqual(
      (await executableScripts(page)).map(({ src }) => src !== null),
      [false, true, false],
    );
  });
}

try {
  browser = await chromium.launch({ executablePath, headless: true });
  await verifyScriptSemantics();
  await verifyAssembly();
  await verifyStyleEmbedding();
  await verifyRestrictiveCsp();
  console.log(
    JSON.stringify({ ok: true, chromium: browser.version(), scriptCases: scriptCases.length, passed }, null, 2),
  );
} finally {
  await browser?.close();
  await rm(workspace, { recursive: true, force: true });
}
