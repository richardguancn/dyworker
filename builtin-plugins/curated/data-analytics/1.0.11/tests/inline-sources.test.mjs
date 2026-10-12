import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { DATA_PLUGIN_ROOT, defaultInlineCacheDir } from "../skills/visualize-data/scripts/inline-chart-build.mjs";
import { normalizeInlineChartInput } from "../skills/visualize-data/scripts/inline-chart-input.mjs";
import { normalizeInlineSourcesInput } from "../skills/visualize-data/scripts/inline-sources-input.mjs";
import { renderInlineSources } from "../skills/visualize-data/scripts/render-inline-sources.mjs";

const exec = promisify(execFile);
const fixture = () => JSON.parse(readFileSync(new URL("../skills/visualize-data/assets/inline-sources-example.json", import.meta.url)));
const first = (input) => input.items[0].queries[0];
const sourceOnly = () => ({ schemaVersion: 1, items: [{ id: "context", title: "What does the release note say?", queries: [{
  id: "release-note", source: { label: "Supplied release note", links: [{ label: "Release note", href: "https://example.com/releases" }] },
}] }] });

test("finding assumptions retain their own scope without inventing defaults", () => {
  const input = sourceOnly();
  assert.equal(normalizeInlineSourcesInput(input).items[0].assumptions, undefined);
  input.items[0].assumptions = [" Release means the documented rollout. ", "Release means the documented rollout."];
  input.items[1] = { ...structuredClone(input.items[0]), id: "other", assumptions: [] };
  const actual = normalizeInlineSourcesInput(input);
  assert.deepEqual(actual.items[0].assumptions, ["Release means the documented rollout."]);
  assert.equal(actual.items[1].assumptions, undefined);
  assert.deepEqual(actual, normalizeInlineSourcesInput(actual));
});

test("receipts reject confidence fields and unsafe assumptions", () => {
  for (const confidence of [null, "high", { level: "med", reason: "A gap." }, { level: 96, reason: "A score." },
    { level: "high" }, { level: "low", reason: " " }, { level: "high", reason: "x".repeat(2001) },
    { level: "high", reason: "A score.", score: .96 },
    { level: "low", reason: "api_key = 'not-for-sharing'" },
    { level: "low", reason: "See https://example.com/path?token=private" }]) {
    const input = sourceOnly(); input.items[0].confidence = confidence;
    assert.throws(() => normalizeInlineSourcesInput(input), /confidence|credentials|unsafe source URL/u);
  }
  for (const assumptions of [null, "Not an array", [" "], ["x".repeat(2001)], Array(21).fill("A"),
    ["api_key = 'not-for-sharing'"], ["See https://example.com/path?token=private"]]) {
    const input = sourceOnly(); input.items[0].assumptions = assumptions;
    assert.throws(() => normalizeInlineSourcesInput(input), /assumptions|credentials|unsafe source URL/u);
  }
});

test("receipt source roles resolve only to their own projected source identities", () => {
  const input = sourceOnly();
  first(input).sourceRoles = [{ kind: "link", label: "Release note", role: "Records the release timing." }];
  const actual = first(normalizeInlineSourcesInput(input));
  assert.deepEqual(actual.sourceRoles, [{ kind: "link", label: "Release note",
    href: "https://example.com/releases", role: "Records the release timing." }]);
  for (const role of [
    { kind: "table", label: "Release note", role: "Wrong kind." },
    { kind: "link", label: "Other source", role: "Unrelated source." },
    { kind: "link", label: "Release note", href: "https://example.com/other", role: "Wrong URL." },
    { kind: "link", label: "Release note", role: "x".repeat(1_001) },
    { kind: "link", label: "Release note", role: "api_key = 'not-for-sharing'" },
    { kind: "link", label: "Release note", role: "See https://example.com/path?token=private" },
  ]) {
    first(input).sourceRoles = [role];
    assert.throws(() => normalizeInlineSourcesInput(input), /sourceRole|credentials|unsafe source URL/u);
  }
  first(input).sourceRoles = [actual.sourceRoles[0], actual.sourceRoles[0]];
  assert.throws(() => normalizeInlineSourcesInput(input), /repeat a source identity/u);
  first(input).sourceRoles = [{ kind: "link", label: "Release note", role: "Ambiguous identity." }];
  first(input).source.links.push({ label: "Release note", href: "https://example.com/another-release" });
  assert.throws(() => normalizeInlineSourcesInput(input), /exactly one source/u);
});

test("receipt source roles cannot refer to a different query or leak across cards", () => {
  const input = sourceOnly();
  const other = structuredClone(input.items[0]);
  other.id = "other";
  other.queries[0].source.links = [{ label: "Other note", href: "https://example.com/other" }];
  other.queries[0].sourceRoles = [{ kind: "link", label: "Other note", role: "A separate finding." }];
  input.items.push(other);
  const result = normalizeInlineSourcesInput(input);
  assert.equal(first(result).sourceRoles, undefined);
  assert.equal(result.items[1].queries[0].sourceRoles[0].role, "A separate finding.");
  first(input).sourceRoles = other.queries[0].sourceRoles;
  assert.throws(() => normalizeInlineSourcesInput(input), /own query/u);
});

test("receipt accepts source-only answers without fabricating rows, SQL, dates or evidence", () => {
  const input = sourceOnly();
  first(input).summary = "The supplied note records a required setup step, not its effect on activation.";
  const value = normalizeInlineSourcesInput(input);
  const query = first(value);
  assert.equal(query.summary, first(input).summary);
  assert.equal(query.rows, undefined);
  assert.equal(query.source.sql, undefined);
  assert.equal(query.source.executedAt, undefined);
  assert.equal(query.capturedAt, undefined);
  assert.equal(query.reportingPeriod, undefined);
  assert.deepEqual(query.source.evidenceFlow, []);
  assert.equal(query.source.links[0].href, "https://example.com/releases");
});

test("receipt carries table usage snapshots through disclosure without exposing private notes", () => {
  const input = sourceOnly();
  const trust = {
    provider: "BigQuery", queryCount: 0, uniqueUsers: 0, windowDays: 30,
    usageAsOf: "2026-09-04T00:00:00Z",
    lastQueriedAt: "2026-08-01T12:00:00Z",
    usageNote: "Non-cache-hit queries visible in this project and region.",
  };
  first(input).source.tables = [{ name: "analytics.reviewed.daily", trust }, "analytics.unknown.daily"];
  const normalized = normalizeInlineSourcesInput(input);
  assert.deepEqual(first(normalized).source.tables, [
    { name: "analytics.reviewed.daily", trust }, { name: "analytics.unknown.daily" },
  ]);
  assert.deepEqual(normalizeInlineSourcesInput(normalized), normalized);

  trust.usageNote = "api_key = 'not-for-sharing'";
  assert.throws(() => normalizeInlineSourcesInput(input), /credentials/u);
});

test("receipt retains exact SQL, Python, calculations and safe links automatically", () => {
  const input = fixture();
  first(input).source.sql = "\n  SELECT activated\nFROM weekly;\n";
  first(input).source.links = [{ label: "Recorded query", href: "https://example.com/query/123" }];
  first(input).methods.push({ language: "python", code: "\nrate = activated / eligible\n" });
  first(input).source.metricDefinitions[0].calculationSummary = "Divide activated by eligible in August 2026.";
  first(input).source.evidenceFlow[0].kind = "source";
  first(input).source.evidenceFlow[0].showInReceipt = false;
  const query = first(normalizeInlineSourcesInput(input));
  assert.equal(query.source.metricDefinitions[0].calculationSummary, "Divide activated by eligible in August 2026.");
  assert.equal(query.source.evidenceFlow[0].kind, "source");
  assert.equal(query.source.evidenceFlow[0].showInReceipt, false, "Disclosure does not delete the recorded audit event");
  const unsafeAudit = structuredClone(input);
  first(unsafeAudit).source.evidenceFlow[0].detail = "api_key = 'not-for-sharing'";
  assert.throws(() => normalizeInlineSourcesInput(unsafeAudit), /credentials/u,
    "Hidden audit metadata must still pass the same disclosure safety checks");
  const unsafeSummary = structuredClone(input);
  first(unsafeSummary).source.metricDefinitions[0].calculationSummary = "api_key = 'not-for-sharing'";
  assert.throws(() => normalizeInlineSourcesInput(unsafeSummary), /credentials/u);
  const unknownKind = structuredClone(input);
  first(unknownKind).source.evidenceFlow[0].kind = "toString";
  assert.equal(first(normalizeInlineSourcesInput(unknownKind)).source.evidenceFlow[0].kind, undefined);
  assert.equal(query.source.sql, first(input).source.sql);
  assert.deepEqual(query.methods, first(input).methods);
  assert.equal(query.source.links[0].href, "https://example.com/query/123");
  const chart = { schemaVersion: 1, title: "Activation", chart: { type: "bar", x: "week", y: "activated" },
    rows: first(input).rows, source: first(input).source };
  const normalizedChart = normalizeInlineChartInput(chart, { includeSql: true });
  assert.equal(normalizedChart.query.source.sql, first(input).source.sql);
  assert.deepEqual(normalizedChart.query.source.links, []);
});

test("provider query links survive receipt projection and honor chart disclosure options", () => {
  const input = fixture();
  const href = "https://acme.cloud.databricks.com/sql/editor/123?o=456";
  first(input).source.queryUrl = href;
  const normalized = normalizeInlineSourcesInput(input);
  assert.equal(first(normalized).source.queryUrl, href);
  assert.equal(first(normalizeInlineSourcesInput(normalized)).source.queryUrl, href,
    "The recorded destination survives repeated receipt normalization");
  const chart = { schemaVersion: 1, title: "Activation", chart: { type: "bar", x: "week", y: "activated" },
    rows: first(input).rows, source: first(input).source };
  for (const options of [{}, { includeSql: true }, { includeSourceUrls: true }]) {
    assert.equal(normalizeInlineChartInput(chart, options).query.source.queryUrl, undefined,
      "A query link requires disclosure of both SQL and source URLs");
  }
  assert.equal(normalizeInlineChartInput(chart, { includeSql: true, includeSourceUrls: true }).query.source.queryUrl, href);
  first(input).source.queryUrl = `${href}&token=private`;
  assert.throws(() => normalizeInlineSourcesInput(input), /credentials|access tokens/u);
  first(input).source.queryUrl = `${href}&unapproved=state`;
  assert.equal(first(normalizeInlineSourcesInput(input)).source.queryUrl, undefined);
});

test("receipt scopes each card's definitions and projects only approved row fields", () => {
  const input = fixture();
  first(input).rows[0].email = "excluded@example.test";
  first(input).source.privateToolOutput = "not part of the receipt";
  first(input).source.metricDefinitions.push({ label: "Private measure", definition: "Other card only.", componentIds: ["other"] });
  const second = structuredClone(input.items[0]);
  second.id = "other"; second.title = "A second finding";
  second.queries[0].rows = [{ week: "2026-08-17", activated: 3, eligible: 7 }];
  input.items.push(second);
  const value = normalizeInlineSourcesInput(input);
  assert.equal(value.items.length, 2);
  assert.equal(first(value).source.metricDefinitions.length, 1);
  assert.deepEqual(value.items[1].queries[0].source.metricDefinitions.map(({ label }) => label), ["Private measure"]);
  assert.equal(first(value).rows[0].activated, 240);
  assert.equal(value.items[1].queries[0].rows[0].activated, 3);
  assert.doesNotMatch(JSON.stringify(value), /excluded@example|privateToolOutput/u);
  assert.deepEqual(first(value).source.filters, ["Plan: all plans"]);
});

test("one finding retains distinct source summaries, methods, SQL, rows and qualifications", () => {
  const input = fixture();
  first(input).summary = "Weekly activation counts.";
  const other = structuredClone(first(input));
  other.id = "other-snapshot";
  other.summary = "A different cohort; do not combine its denominator with the first source.";
  other.source.label = "Other cohort";
  other.source.sql = "SELECT activated, eligible FROM other_cohort";
  other.source.caveats = ["Different cohort."];
  other.reportingPeriod = "September 2026";
  other.rows = [{ week: "2026-09-01", activated: 3, eligible: 10 }];
  other.methods = [{ language: "python", code: "\nrate = 3 / 10\n" }];
  input.items[0].queries.push(other);
  const value = normalizeInlineSourcesInput(input);
  assert.equal(value.items.length, 1);
  const [a, b] = value.items[0].queries;
  assert.equal(a.rows[0].activated, 240);
  assert.deepEqual(b.rows, other.rows);
  assert.equal(b.source.sql, other.source.sql);
  assert.equal(b.reportingPeriod, other.reportingPeriod);
  assert.deepEqual(b.source.caveats, other.source.caveats);
  assert.deepEqual(b.methods, other.methods);
  assert.equal(b.summary, other.summary);
  assert.notEqual(a.summary, b.summary);
});

test("Python floor division is not a source URL and recorded literals retain URL checks", () => {
  const input = fixture();
  for (const code of ["half = total//2", "buckets = total // width", "total //= 2", "half = (a + b)//2",
    "rows = values[1:]//2\nsource = 'https://example.com/data'", "url = r'''https://example.com/data'''\ncount = total//2"]) {
    first(input).methods = [{ language: "python", code }];
    assert.equal(first(normalizeInlineSourcesInput(input)).methods[0].code, code);
  }
  for (const code of ["url = '//example.com/data'", 'url = "//example.com/data"',
    "url = '''//example.com/data'''", 'url = """//example.com/data"""',
    "# //example.com/data\nhalf = total//2", "url = 'https://example.com/data?token=private'",
    "https://example.com/data?token=private\nhalf = total//2"]) {
    first(input).methods = [{ language: "python", code }];
    assert.throws(() => normalizeInlineSourcesInput(input), /unsafe source URL|credentials/u);
  }
});

test("receipt timestamps reject impossible calendar dates without normalizing recorded values", () => {
  for (const field of ["capturedAt", "executedAt"]) {
    const input = fixture();
    const set = (value) => {
      if (field === "capturedAt") first(input).capturedAt = value;
      else first(input).source.executedAt = value;
    };
    for (const value of ["2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "1900-02-29T00:00:00Z",
      "2026-04-31T00:00:00+03:00", "2026-00-01T00:00:00Z", "2026-01-00T00:00:00Z", "2026-13-01T00:00:00Z"]) {
      set(value);
      assert.throws(() => normalizeInlineSourcesInput(input), /calendar date|timezone|recorded timestamp/u);
    }
    for (const value of ["2024-02-29T00:00:00Z", "2000-02-29T23:59:59.123456-08:00", "2026-01-01T00:00:00+14:00"]) {
      set(value);
      const actual = first(normalizeInlineSourcesInput(input));
      assert.equal(field === "capturedAt" ? actual.capturedAt : actual.source.executedAt, value);
    }
  }
});

test("receipt distinguishes reporting window, execution, capture, empty results, and partial previews", () => {
  const input = fixture();
  const query = first(input);
  query.source.executedAt = "2026-08-18T10:00:00-07:00";
  query.capturedAt = "2026-08-18T17:02:00Z";
  query.preview = { kind: "partial", note: "First two recorded rows.", totalRows: 20 };
  const actual = first(normalizeInlineSourcesInput(input));
  assert.equal(actual.reportingPeriod, query.reportingPeriod);
  assert.equal(actual.source.executedAt, query.source.executedAt);
  assert.equal(actual.capturedAt, query.capturedAt);
  assert.deepEqual(actual.preview, query.preview);
  query.rows = [];
  delete query.preview;
  assert.deepEqual(first(normalizeInlineSourcesInput(input)).rows, []);
});

test("receipt projects approved labeled columns without changing recorded fields or values", () => {
  const input = fixture();
  const query = first(input);
  query.columns = ["year", { field: "anomaly", label: "Annual anomaly (°C)", ignored: "not projected" }];
  query.rows = [{ year: 2025, anomaly: 1.19, excluded: "not approved" }];
  const actual = first(normalizeInlineSourcesInput(input));
  assert.deepEqual(actual.columns, [{ field: "year" }, { field: "anomaly", label: "Annual anomaly (°C)" }]);
  assert.deepEqual(actual.rows, [{ year: 2025, anomaly: 1.19 }]);
  assert.deepEqual(normalizeInlineSourcesInput(normalizeInlineSourcesInput(input)), normalizeInlineSourcesInput(input));
  for (const columns of [
    ["year", { field: "year", label: "Duplicate" }],
    [{ field: "anomaly", label: " " }],
    [{ field: "anomaly", label: "x".repeat(201) }],
    [{ field: "missing", label: "Unknown" }],
    [{ field: "email", label: "Innocuous label" }],
    [{ field: "anomaly", label: "api_key = 'not-for-sharing'" }],
  ]) {
    query.columns = columns;
    assert.throws(() => normalizeInlineSourcesInput(input), /column|credentials/u);
  }
});

test("receipt rejects ambiguous IDs, unknown fields, malformed preview claims and oversize evidence", () => {
  const cases = [
    [(input) => input.items.push(structuredClone(input.items[0])), /item IDs/u],
    [(input) => input.items[0].queries.push(structuredClone(first(input))), /query IDs/u],
    [(input) => first(input).columns.push("missing"), /missing/u],
    [(input) => delete first(input).columns, /approved preview columns/u],
    [(input) => first(input).preview = { kind: "partial", note: "Some rows", totalRows: 1 }, /totalRows/u],
    [(input) => first(input).capturedAt = "2026-08-18", /timezone/u],
    [(input) => first(input).source.executedAt = "2026-08-18", /timezone/u],
    [(input) => first(input).methods = [{ language: "bash", code: "echo no" }], /language/u],
    [(input) => first(input).summary = " ", /summary/u],
    [(input) => first(input).summary = "x".repeat(2_001), /summary/u],
    [(input) => first(input).rows = Array.from({ length: 2_001 }, () => first(input).rows[0]), /2|2000/u],
    [(input) => { input.items.push({ ...structuredClone(input.items[0]), id: "other" });
      input.items.forEach((item) => item.queries[0].rows = Array.from({ length: 1_100 }, () => ({ week: "2026-08-03", activated: 1, eligible: 2 }))); }, /complete receipt/u],
  ];
  for (const [mutate, pattern] of cases) {
    const input = fixture(); mutate(input);
    assert.throws(() => normalizeInlineSourcesInput(input), pattern);
  }
});

test("receipt rejects credential-bearing evidence and direct contact/payment preview fields", () => {
  for (const mutate of [
    (input) => first(input).source.links = [{ href: "https://example.com/query?access_token=secret" }],
    (input) => first(input).source.sql = "SELECT 'x'; -- api_key = 'not-for-sharing'",
    (input) => first(input).methods = [{ language: "python", code: "password = 'not-for-sharing'" }],
    (input) => first(input).source.caveats = ["postgres://user:password@host/db"],
    (input) => first(input).summary = "api_key = 'not-for-sharing'",
    (input) => { first(input).columns.push("email"); first(input).rows[0].email = "contact@example.test"; },
    (input) => { first(input).columns.push("creditCard"); first(input).rows[0].creditCard = "4111111111111111"; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => normalizeInlineSourcesInput(input), /credentials|identifiers/u);
  }
  for (const field of ["e-mail", "e_mail", "eMail", "contact e--mail"]) {
    for (const column of [field, { field, label: "Reviewed value" }]) {
      const input = sourceOnly();
      Object.assign(first(input), { columns: [column], rows: [{ [field]: "contact@example.test" }] });
      assert.throws(() => normalizeInlineSourcesInput(input), /identifiers/u, `Reject contact field ${field}`);
    }
  }
  const input = sourceOnly();
  first(input).source.links.push({ label: "Unsafe", href: "javascript:alert(1)" });
  assert.equal(first(normalizeInlineSourcesInput(input)).source.links.length, 1);
});

test("receipt renderer delivers a bounded, escaped, private fragment without a chart or extra answer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "data-sources-test-"));
  try {
    const input = fixture();
    input.items[0].title = "</script><img src=x onerror=alert(1)> $&";
    const output = join(directory, "answer-sources.html");
    const result = await renderInlineSources({ input, output });
    const html = await readFile(result.path, "utf8");
    assert.equal(result.prebuilt, true);
    assert.equal(result.itemCount, 1);
    assert.ok(result.bytes < 1_000_000);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const payloads = [...html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/gu)];
    assert.equal(payloads.length, 1);
    const payload = JSON.parse(payloads[0][1]);
    assert.equal(payload.items[0].title, input.items[0].title);
    assert.equal(payload.kind, "sources");
    assert.equal(payload.component, undefined);
    assert.doesNotMatch(html, /<img src=x|__INLINE_|mountInlineChart\(/u);
    assert.match(html, /CodexDataSourcesReceipt\.mountSourcesReceipt/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("receipt shares the existing plugin/cache/symlink output protection", async () => {
  const input = sourceOnly();
  await assert.rejects(renderInlineSources({ input, output: join(DATA_PLUGIN_ROOT, "private-sources.html") }), /outside the installed/u);
  // CI overrides the legacy cache path; check the same active cache as the renderer.
  const cacheDir = process.env.DATA_INLINE_CACHE_DIR || defaultInlineCacheDir();
  await assert.rejects(renderInlineSources({ input, output: join(cacheDir, "private-sources.html") }), /shared renderer cache/u);
  const directory = await mkdtemp(join(tmpdir(), "data-sources-path-"));
  try {
    const original = join(directory, "original.html");
    await writeFile(original, "preserve");
    const output = join(directory, "linked-sources.html");
    await symlink(original, output);
    await assert.rejects(renderInlineSources({ input, output }), /symlinked/u);
    assert.equal(await readFile(original, "utf8"), "preserve");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("fresh-process receipt generation needs no npm, dependency cache or network", async () => {
  const directory = await mkdtemp(join(tmpdir(), "data-sources-offline-"));
  try {
    const input = join(directory, "input.json");
    await writeFile(input, JSON.stringify(sourceOnly()));
    const { stdout } = await exec(process.execPath, [join(DATA_PLUGIN_ROOT, "skills/visualize-data/scripts/render-inline-sources.mjs"),
      "--input", input, "--output", join(directory, "offline-sources.html")], {
      cwd: directory, env: { PATH: directory, NODE_PATH: "", NODE_OPTIONS: "", npm_config_offline: "true" },
    });
    assert.equal(JSON.parse(stdout).prebuilt, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
