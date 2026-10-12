import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Script } from "node:vm";

import { loadPrebuiltCompiler } from "../scripts/data-app-runtime.mjs";
import { chartTypes } from "../templates/data-app/base/src/charting/chart-theme.js";
import { inlineArtifactForChart } from "../templates/data-app/inline/chart-families.mjs";
import { resolveChartAnnotations } from "../templates/data-app/base/src/charting/chart-annotations.js";
import {
  chartDataShape,
  scatterTooltipIdentityField,
} from "../templates/data-app/base/src/charting/chart-data-shape.js";
import {
  boxPlots,
  heatmap,
  histogram,
  pivot,
  sankeyGraph,
  waterfall,
} from "../templates/data-app/base/src/charting/chart-transforms.js";
import {
  canonicalInlinePath,
  DATA_PLUGIN_ROOT,
  inlineSourceState,
  isInside,
  prepareInlineRuntime,
} from "../skills/visualize-data/scripts/inline-chart-build.mjs";
import {
  assertReplacementSafe,
  inlineJson,
  MAX_INLINE_FRAGMENT_BYTES,
  MAX_INLINE_INPUT_BYTES,
  MAX_INLINE_ROWS,
  normalizeInlineChartInput,
} from "../skills/visualize-data/scripts/inline-chart-input.mjs";
import { makeReplacementSafe } from "../skills/visualize-data/scripts/replacement-safe-javascript.mjs";
import { renderInlineChart } from "../skills/visualize-data/scripts/render-inline-chart.mjs";
import { validateInlineThemeCss } from "../skills/visualize-data/scripts/inline-chart-theme.mjs";

const execFileAsync = promisify(execFile);
const example = JSON.parse(
  readFileSync(new URL("../skills/visualize-data/assets/inline-chart-example.json", import.meta.url), "utf8"),
);
const reviewedSql = "SELECT inline_private_active_users FROM warehouse.private_inline_regression";
const reviewedUrls = [
  "https://warehouse.example.test/inline-private-table",
  "https://files.example.test/inline-private-export",
  "https://sources.example.test/inline-private-query",
  "https://evidence.example.test/inline-private-step",
];

function reviewedInput() {
  const input = structuredClone(example);
  input.source = {
    label: "Reviewed warehouse query",
    sql: reviewedSql,
    executedAt: "2026-08-14T12:34:56.000Z",
    tables: [{ name: "warehouse.private_inline_regression", href: reviewedUrls[0] }],
    files: [{ label: "Reviewed export.csv", href: reviewedUrls[1] }],
    links: [{ label: "Warehouse query", href: reviewedUrls[2] }],
    evidenceFlow: [
      {
        title: "Reviewed rows",
        detail: "Checked the reviewed aggregate",
        links: [{ label: "Reviewed evidence", href: reviewedUrls[3] }],
      },
      { title: "Raw SQL", detail: reviewedSql },
      { title: "Query inspection", detail: `The full query was ${reviewedSql}` },
    ],
    metricDefinitions: [
      { label: "Active users", field: "activeUsers", definition: "Reviewed weekly active users" },
      { label: "Unrelated metric", field: "privateMetric", definition: "Do not show", componentIds: ["another-chart"] },
    ],
    caveats: ["Only reviewed aggregate rows are included."],
  };
  return input;
}

function fragmentPayload(fragment) {
  const match = fragment.match(/<script\s+type="application\/json"\s+id="[^"]+">([\s\S]*?)<\/script>/u);
  assert.ok(match, "The standalone inline fragment must carry exactly one JSON data payload");
  return JSON.parse(match[1]);
}

function assertPrivateSourceOmitted(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  assert.ok(!serialized.includes(reviewedSql), "Excluded SQL must not enter the artifact");
  for (const url of reviewedUrls) {
    assert.ok(!serialized.includes(url), `Private source URLs must be excluded by default: ${url}`);
  }
}

test("inline input accepts every chart family supported by the canonical Data renderer", () => {
  assert.ok(chartTypes.length >= 20, "The shared chart family list should not silently shrink");
  for (const type of chartTypes) {
    const input = structuredClone(example);
    input.chart.type = type;
    assert.equal(normalizeInlineChartInput(input).component.chart.type, type, type);
  }

  const unsupported = structuredClone(example);
  unsupported.chart.type = "invented-inline-only-chart";
  assert.throws(() => normalizeInlineChartInput(unsupported), /chart\.type must be one of/iu);
});

test("inline input projects rows to actual chart fields and explicitly approved preview columns", () => {
  const input = reviewedInput();
  delete input.chart.series;
  input.chart.fields = ["activeUsers", "baseline"];
  input.chart.barFields = ["weeklyDelta"];
  input.columns = ["approvedPreview"];
  input.rows = input.rows.map((row, index) => ({
    ...row,
    baseline: row.activeUsers - 20,
    weeklyDelta: index,
    approvedPreview: `reviewed-${index}`,
    secretAccessToken: `never-embed-${index}`,
    unapprovedPersonalEmail: `private-${index}@example.test`,
  }));

  const normalized = normalizeInlineChartInput(input);
  assert.deepEqual(Object.keys(normalized.rows[0]), [
    "week",
    "activeUsers",
    "baseline",
    "weeklyDelta",
    "approvedPreview",
  ]);
  assert.deepEqual(normalized.query.rows, normalized.rows);
  assert.doesNotMatch(JSON.stringify(normalized), /secretAccessToken|never-embed|PersonalEmail|private-\d@/u);
});

test("annotations cannot disclose unapproved row fields or definitions even when no marks resolve", () => {
  for (const kind of ["event", "benchmark", "point"]) {
    for (const at of ["2026-07-13", "2099-01-01"]) {
      for (const type of ["line", "pie"]) {
        const input = reviewedInput();
        delete input.chart.series;
        input.chart.type = type;
        input.chart.annotations = [{ id: "unapproved-note", kind, at,
          field: "unreviewedNote", label: "UNAPPROVED_ANNOTATION_LABEL",
          ...(kind === "benchmark" ? { measure: "activeUsers" } : {}),
        }];
        input.rows = input.rows.map((row) => ({ ...row,
          unreviewedNote: kind === "event" ? "SYNTHETIC_UNREVIEWED_SENTINEL" : 987654321,
        }));
        input.source.metricDefinitions.push({ field: "unreviewedNote",
          label: "Unreviewed note", definition: "UNAPPROVED_ANNOTATION_DEFINITION" });
        const normalized = normalizeInlineChartInput(input);
        assert.deepEqual(normalized.component.chart.annotations, []);
        assert.equal(resolveChartAnnotations(normalized.component.chart, normalized.rows).length, 0);
        assert.doesNotMatch(inlineJson(normalized),
          /unreviewedNote|SYNTHETIC_UNREVIEWED_SENTINEL|987654321|UNAPPROVED_ANNOTATION/u);
      }
    }
  }
});

test("retained annotation text obeys URL disclosure even for off-domain, unsupported, or hidden marks", () => {
  const url = "https://warehouse.example.test/export?access_token=SYNTHETIC_PRIVATE_TOKEN";
  for (const [type, at, showAnnotations] of [
    ["line", "2099-01-01", true], ["pie", "2026-07-13", true], ["line", "2026-07-13", false],
  ]) {
    const input = structuredClone(example);
    input.chart = { type, x: "week", y: "activeUsers", showAnnotations,
      annotations: [{ id: "n", kind: "point", field: "activeUsers", at, label: `HIDDEN ${url}` }] };
    for (const includeSourceUrls of [false, true]) {
      assert.throws(() => normalizeInlineChartInput(input, { includeSourceUrls }), (error) => {
        assert.match(error.message, /source URL disclosure|credentials or access tokens/u);
        assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_TOKEN/u);
        return true;
      });
    }
  }
});

test("reviewed annotation text and visibility survive URL checks without widening row projection", () => {
  const input = structuredClone(example);
  input.rows = input.rows.filter((row) => row.plan === "Pro");
  input.chart = { type: "line", x: "week", y: "activeUsers",
    annotations: [{ id: "rollout", kind: "point", field: "activeUsers", at: "2026-07-13", label: "Reviewed rollout" }] };
  for (const showAnnotations of [true, false]) {
    input.chart.showAnnotations = showAnnotations;
    for (const includeSourceUrls of [false, true]) {
      const normalized = normalizeInlineChartInput(input, { includeSourceUrls });
      assert.deepEqual(normalized.component.chart, input.chart);
      assert.equal(resolveChartAnnotations(normalized.component.chart, normalized.rows).length, showAnnotations ? 1 : 0);
      assert.deepEqual(Object.keys(normalized.rows[0]), ["week", "activeUsers"]);
    }
  }
  input.chart.annotations[0].label = "Reviewed rollout https://warehouse.example.test/review";
  assert.throws(() => normalizeInlineChartInput(input), /source URL disclosure/u);
  assert.deepEqual(normalizeInlineChartInput(input, { includeSourceUrls: true }).component.chart, input.chart);
});

test("explicit preview approval retains event and benchmark evidence while plotted point and range annotations still resolve", () => {
  const input = structuredClone(example);
  delete input.chart.series;
  input.rows = [
    { week: "2026-07-13", activeUsers: 12, launchNote: "Reviewed rollout", target: 20 },
    { week: "2026-07-20", activeUsers: 15, launchNote: null, target: 20 },
  ];
  input.columns = ["launchNote", "target"];
  input.chart.annotations = [
    { id: "launch", kind: "event", at: "2026-07-13", field: "launchNote", label: "Rollout began" },
    { id: "target", kind: "benchmark", field: "target", measure: "activeUsers", label: "Reviewed capacity" },
    { id: "point", kind: "point", at: "2026-07-20", field: "activeUsers", label: "First complete week" },
    { id: "range", kind: "range", at: "2026-07-13", end: "2026-07-20", label: "Rollout window" },
  ];
  const normalized = normalizeInlineChartInput(input);
  assert.deepEqual(normalized.rows, input.rows);
  assert.deepEqual(resolveChartAnnotations(normalized.component.chart, normalized.rows)
    .map(({ id }) => id), ["launch", "target", "point", "range"]);
  input.chart.showAnnotations = false;
  assert.deepEqual(normalizeInlineChartInput(input).rows, input.rows,
    "Hiding annotations must not remove explicitly approved source-preview columns");
});

test("long-form point annotations retain the plotted series without disclosing a same-named row field", () => {
  const input = structuredClone(example);
  input.rows = input.rows.map((row) => ({ ...row, Pro: "UNAPPROVED_SAME_NAMED_COLUMN" }));
  input.chart.annotations = [{ id: "pro-point", kind: "point", at: "2026-07-13",
    field: "Pro", label: "Reviewed plan rollout" }];
  const normalized = normalizeInlineChartInput(input);
  const data = pivot(normalized.rows, "week", "plan", "activeUsers");
  assert.equal(resolveChartAnnotations(normalized.component.chart, normalized.rows, { data }).length, 1);
  assert.doesNotMatch(inlineJson(normalized), /UNAPPROVED_SAME_NAMED_COLUMN/u);
  assert.ok(normalized.rows.every((row) => !Object.hasOwn(row, "Pro")));
});

test("inline waterfall projection preserves canonical running totals and reviewed total markers", () => {
  const input = {
    ...structuredClone(example),
    chart: { type: "waterfall", x: "category", y: "amount" },
    rows: [
      { category: "Opening", amount: 100, isTotal: true, totalType: "beginning" },
      { category: "Expansion", amount: 35 },
      { category: "Subtotal", amount: 135, isTotal: true, totalType: "total" },
      { category: "Contraction", amount: -15 },
      { category: "Closing", amount: 120, isTotal: true, totalType: "ending" },
    ],
  };
  const options = { categoryField: input.chart.x, includeEnding: true };
  const expected = waterfall(input.rows, input.chart.y, options);
  const normalized = normalizeInlineChartInput(input);

  assert.deepEqual(waterfall(normalized.rows, normalized.component.chart.y, options), expected);
  assert.equal(normalized.rows[0].isTotal, true);
  assert.equal(normalized.rows[0].totalType, "beginning");
  assert.equal(normalized.rows.at(-1).totalType, "ending");
});

test("inline precomputed box plots preserve all quartiles without requiring an invented raw y field", () => {
  const input = {
    ...structuredClone(example),
    chart: { type: "boxPlot", x: "plan", y: "durationMs" },
    rows: [
      { plan: "Pro", minimum: 2, lowerQuartile: 4, median: 6, upperQuartile: 9, maximum: 15 },
      { plan: "Team", minimum: 3, lowerQuartile: 5, median: 8, upperQuartile: 12, maximum: 20 },
    ],
  };
  const expected = boxPlots(input.rows, input.chart.x, input.chart.y);
  const normalized = normalizeInlineChartInput(input);

  assert.equal(Object.hasOwn(normalized.rows[0], "durationMs"), false);
  assert.deepEqual(boxPlots(normalized.rows, "plan", "durationMs"), expected);
  assert.deepEqual(Object.keys(normalized.rows[0]), [
    "plan",
    "minimum",
    "lowerQuartile",
    "median",
    "upperQuartile",
    "maximum",
  ]);
});

test("inline heatmaps preserve the inferred group dimension and its canonical source order", () => {
  const input = {
    ...structuredClone(example),
    chart: { type: "heatmap", x: "week", y: "activeUsers" },
    rows: [
      { week: "2026-07-13", plan: "Pro", activeUsers: 12 },
      { week: "2026-07-13", plan: "Team", activeUsers: 8 },
      { week: "2026-07-20", plan: "Pro", activeUsers: 15 },
      { week: "2026-07-20", plan: "Team", activeUsers: 11 },
    ],
  };
  const originalShape = chartDataShape(input.chart, input.rows);
  const expected = heatmap(input.rows, input.chart.x, originalShape.heatmapGroup, input.chart.y);
  const normalized = normalizeInlineChartInput(input);
  const inlineShape = chartDataShape(normalized.component.chart, normalized.rows);

  assert.equal(originalShape.heatmapGroup, "plan");
  assert.equal(inlineShape.heatmapGroup, originalShape.heatmapGroup);
  assert.deepEqual(Object.keys(normalized.rows[0]), ["week", "plan", "activeUsers"]);
  assert.deepEqual(heatmap(normalized.rows, "week", inlineShape.heatmapGroup, "activeUsers"), expected);
});

test("inline heatmaps preserve explicitly requested tooltip evidence without unrelated columns", () => {
  const input = {
    ...structuredClone(example),
    chart: { type: "heatmap", x: "week", y: "retentionRate", series: "cohort",
      tooltipFields: [{ field: "retained", label: "Retained customers" }] },
    rows: [
      { week: "Week 1", cohort: "A", retentionRate: .5, retained: 17, privateNote: "Excluded" },
      { week: "Week 2", cohort: "A", retentionRate: null, retained: null, privateNote: "Excluded" },
    ],
  };
  const normalized = normalizeInlineChartInput(input);
  assert.deepEqual(normalized.component.chart.tooltipFields, input.chart.tooltipFields);
  assert.deepEqual(normalized.rows, [
    { week: "Week 1", cohort: "A", retentionRate: .5, retained: 17 },
    { week: "Week 2", cohort: "A", retentionRate: null, retained: null },
  ]);
  assert.equal(Object.hasOwn(input.rows[0], "privateNote"), true, "Projection must not mutate reviewed input");
});

test("inline histograms preserve canonical buckets without requiring an x-axis source column", () => {
  const input = {
    ...structuredClone(example),
    chart: { type: "histogram", y: "latencyMs" },
    rows: [{ latencyMs: 12 }, { latencyMs: 19 }, { latencyMs: 23 }, { latencyMs: 37 }],
  };
  const expected = histogram(input.rows, "latencyMs");
  const normalized = normalizeInlineChartInput(input);

  assert.equal(normalized.component.chart.x, undefined);
  assert.deepEqual(histogram(normalized.rows, "latencyMs"), expected);
});

test("inline Sankey source and target specs preserve canonical graph edges without an x field", () => {
  const input = {
    ...structuredClone(example),
    chart: { type: "sankey", y: "users", source: "origin", target: "destination" },
    rows: [
      { origin: "Signup", destination: "Activation", users: 8 },
      { origin: "Signup", destination: "Churn", users: 2 },
      { origin: "Activation", destination: "Upgrade", users: 5 },
    ],
  };
  const originalShape = chartDataShape(input.chart, input.rows);
  const expected = sankeyGraph(input.rows, originalShape.sankeyStages, input.chart.y);
  const normalized = normalizeInlineChartInput(input);
  const inlineShape = chartDataShape(normalized.component.chart, normalized.rows);

  assert.equal(normalized.component.chart.x, undefined);
  assert.deepEqual(inlineShape.sankeyStages, ["origin", "destination"]);
  assert.deepEqual(sankeyGraph(normalized.rows, inlineShape.sankeyStages, "users"), expected);
});

test("inline long-form line/bar combinations treat barFields as pivoted series values", () => {
  const input = {
    ...structuredClone(example),
    chart: {
      type: "line",
      x: "week",
      y: "value",
      series: "metric",
      barFields: ["Weekly change"],
    },
    rows: [
      { week: "2026-07-13", metric: "Active users", value: 120 },
      { week: "2026-07-13", metric: "Weekly change", value: 8 },
      { week: "2026-07-20", metric: "Active users", value: 131 },
      { week: "2026-07-20", metric: "Weekly change", value: 11 },
    ],
  };
  const originalShape = chartDataShape(input.chart, input.rows);
  const expected = pivot(input.rows, "week", "metric", "value");
  const normalized = normalizeInlineChartInput(input);
  const inlineShape = chartDataShape(normalized.component.chart, normalized.rows);

  assert.equal(inlineShape.longForm, true);
  assert.deepEqual(inlineShape.fields, originalShape.fields);
  assert.deepEqual(inlineShape.barFields, ["Weekly change"]);
  assert.equal(Object.hasOwn(normalized.rows[0], "Weekly change"), false);
  assert.deepEqual(pivot(normalized.rows, "week", "metric", "value"), expected);
});

test("inline scatter plots retain only their canonical reviewed tooltip identity field", () => {
  const input = {
    ...structuredClone(example),
    chart: { type: "scatter", x: "sessions", y: "revenue" },
    rows: [
      { sessions: 4, revenue: 20, account: "Acme", executiveSalary: 750_000 },
      { sessions: 9, revenue: 45, account: "Globex", executiveSalary: 900_000 },
    ],
  };
  const normalized = normalizeInlineChartInput(input);

  assert.equal(scatterTooltipIdentityField(input.rows[0]), "account");
  assert.deepEqual(Object.keys(normalized.rows[0]), ["sessions", "revenue", "account"]);
  assert.equal(scatterTooltipIdentityField(normalized.rows[0]), "account");
  assert.doesNotMatch(JSON.stringify(normalized), /executiveSalary|750000|900000/u);
});

test("inline input permits stage-driven sankey charts without an invented x-axis field", () => {
  const input = structuredClone(example);
  input.chart = { type: "sankey", y: "count", stages: ["firstStage", "secondStage"] };
  input.rows = [{ firstStage: "Signup", secondStage: "Activation", count: 12 }];

  const normalized = normalizeInlineChartInput(input);
  assert.equal(normalized.component.chart.x, undefined);
  assert.deepEqual(normalized.rows, input.rows);
});

test("inline input rejects unsupported schemas and missing or invalid chart fields", () => {
  const missingSchemaVersion = structuredClone(example);
  delete missingSchemaVersion.schemaVersion;
  assert.throws(() => normalizeInlineChartInput(missingSchemaVersion), /schemaVersion/iu);

  const cases = [
    [{ schemaVersion: null }, /schemaVersion/iu],
    [{ schemaVersion: 999 }, /schemaVersion/iu],
    [{ title: " " }, /title/iu],
    [{ chart: { ...example.chart, x: "missingReviewedField" } }, /missing from rows/iu],
    [{ chart: { ...example.chart, fields: [] } }, /field list/iu],
    [{ chart: { ...example.chart, fields: Array.from({ length: 41 }, () => "activeUsers") } }, /bounded field list/iu],
    [{ chart: { ...example.chart, y: "field".repeat(41) } }, /chart\.y.*200 characters/iu],
    [{ chart: { ...example.chart, fields: ["field".repeat(41)] } }, /chart\.fields.*200 characters/iu],
    [{ columns: Array.from({ length: 81 }, () => "week") }, /columns must be a bounded list/iu],
  ];

  for (const [overrides, expectedError] of cases) {
    const input = { ...structuredClone(example), ...overrides };
    assert.throws(() => normalizeInlineChartInput(input), expectedError);
  }
});

test("inline input diagnoses raw array measures and malformed field lists before projection", () => {
  const input = { ...structuredClone(example), id: "throughput", chart: {
    type: "line", x: "week", y: ["siteA", "siteB"],
  }, rows: [{ week: "2026-08-03", siteA: 18, siteB: 12 }] };
  assert.throws(() => normalizeInlineChartInput(input),
    /Invalid chart "throughput": chart\.y.*y: "siteA", fields: \["siteA","siteB"\]/u);
  const corrected = { ...input, chart: { ...input.chart, y: "siteA", fields: ["siteA", "siteB"] } };
  assert.deepEqual(normalizeInlineChartInput(corrected).rows, input.rows);
  assert.throws(() => normalizeInlineChartInput({ ...corrected, chart: {
    ...corrected.chart, fields: ["siteA", ["siteB"]],
  } }), /chart\.fields.*string field names/u);
});

test("inline input enforces reviewed-row count and two-megabyte source limits", () => {
  for (const rows of [[], Array.from({ length: MAX_INLINE_ROWS + 1 }, () => example.rows[0])]) {
    assert.throws(() => normalizeInlineChartInput({ ...structuredClone(example), rows }), /aggregate or downsample/iu);
  }

  const largestValid = {
    ...structuredClone(example),
    rows: Array.from({ length: MAX_INLINE_ROWS }, () => example.rows[0]),
  };
  assert.equal(normalizeInlineChartInput(largestValid).rows.length, MAX_INLINE_ROWS);

  const tooLarge = {
    ...structuredClone(example),
    rows: Array.from({ length: 30 }, () => ({ ...example.rows[0], unusedBlob: "x".repeat(80_000) })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(tooLarge)) > MAX_INLINE_INPUT_BYTES);
  assert.throws(() => normalizeInlineChartInput(tooLarge), /input exceeds 2 MB/iu);
});

test("inline input rejects non-finite, nested, prototype-poisoning, and invalid reviewed rows", () => {
  for (const invalidRow of [
    null,
    [],
    { ...example.rows[0], activeUsers: Number.NaN },
    { ...example.rows[0], activeUsers: Number.POSITIVE_INFINITY },
    { ...example.rows[0], activeUsers: { hidden: true } },
  ]) {
    const input = { ...structuredClone(example), rows: [invalidRow] };
    assert.throws(() => normalizeInlineChartInput(input), /JSON values|rows must be records/iu);
  }

  const poisoned = structuredClone(example);
  Object.defineProperty(poisoned, "__proto__", {
    configurable: true,
    enumerable: true,
    value: { polluted: true },
  });
  assert.throws(() => normalizeInlineChartInput(poisoned), /forbidden property/iu);
});

test("inline input validates bounded dimensions, safe identifiers, and reviewed filters", () => {
  for (const [overrides, expectedError] of [
    [{ id: "Unsafe_ID" }, /lowercase hyphenated/iu],
    [{ queryId: " " }, /queryId/iu],
    [{ height: 159 }, /160 to 640/iu],
    [{ height: 641 }, /160 to 640/iu],
    [{ height: 200.5 }, /160 to 640/iu],
    [{ theme: "../private-theme" }, /bundled theme identifier/iu],
    [{ filters: { field: "plan", value: "Pro" } }, /bounded list/iu],
    [{ filters: Array.from({ length: 81 }, () => ({ field: "plan", value: "Pro" })) }, /bounded list/iu],
    [{ filters: [{ field: "plan", value: { hidden: true } }] }, /reviewed field\/value/iu],
  ]) {
    assert.throws(() => normalizeInlineChartInput({ ...structuredClone(example), ...overrides }), expectedError);
  }

  const reviewed = normalizeInlineChartInput({
    ...structuredClone(example),
    filters: [{ field: "plan", value: "Pro" }],
    height: 320,
  });
  assert.equal(reviewed.height, 320);
  assert.deepEqual(reviewed.filters, [{ field: "plan", value: "Pro", label: "Plan", queryIds: [example.queryId] }]);
});

test("derived inline chart and query identifiers are deterministic and content-based", () => {
  const input = structuredClone(example);
  delete input.id;
  delete input.queryId;

  const first = normalizeInlineChartInput(input);
  const second = normalizeInlineChartInput(structuredClone(input));
  const changed = normalizeInlineChartInput({ ...input, title: `${input.title} (updated)` });

  assert.match(first.component.id, /^chart-[a-f\d]{12}$/u);
  assert.equal(first.component.id, second.component.id);
  assert.equal(first.component.queryId, `${first.component.id}-query`);
  assert.notEqual(first.component.id, changed.component.id);
});

test("inline chart specifications discard private metadata and unapproved legend extensions", () => {
  const input = reviewedInput();
  input.chart.privateMetadata = {
    executiveSalary: 875_000,
    sourceUrl: "https://private.example.test/chart-metadata",
    accessToken: "chart-private-metadata-token",
  };
  input.chart.legend = {
    position: "right",
    internalUrl: "https://private.example.test/chart-legend",
    accessToken: "legend-private-metadata-token",
    privateMetadata: { owner: "hidden-reviewer" },
  };
  input.chart.colors = {
    Pro: "#0285ff",
    privateMetadata: { accessToken: "nested-color-secret" },
  };
  input.chart.colorDomain = [0, 100, 999];

  const normalized = normalizeInlineChartInput(input, { includeSourceUrls: true });
  const chart = normalized.component.chart;

  assert.equal(Object.hasOwn(chart, "privateMetadata"), false);
  assert.deepEqual(chart.legend, { position: "right" });
  assert.deepEqual(chart.colors, { Pro: "#0285ff" });
  assert.deepEqual(chart.colorDomain, [0, 100]);
  assert.doesNotMatch(
    JSON.stringify(normalized),
    /executiveSalary|875000|hidden-reviewer|private-metadata-token|nested-color-secret|chart-metadata|chart-legend/u,
  );
});

test("inline source metadata preserves explicitly reviewed SQL and excludes source URLs by default", () => {
  const input = reviewedInput();
  input.source.sql = `\n  ${reviewedSql}\n`;
  const normalized = normalizeInlineChartInput(input, { includeSql: true });

  assert.equal(normalized.query.source.sql, input.source.sql);
  assert.equal(normalized.query.source.label, "Reviewed warehouse query");
  assert.deepEqual(
    normalized.query.source.tables.map(({ name }) => name),
    ["warehouse.private_inline_regression"],
  );
  assert.deepEqual(
    normalized.query.source.files.map(({ label }) => label),
    ["Reviewed export.csv"],
  );
  assert.ok(normalized.query.source.evidenceFlow.some(({ title }) => title === "Raw SQL"));
  for (const url of reviewedUrls) assert.ok(!JSON.stringify(normalized).includes(url));
});

test("SQL omission removes query-derived evidence independently of source URL disclosure", () => {
  const omitted = normalizeInlineChartInput(reviewedInput());
  assert.equal(omitted.query.source.sql, undefined);
  assert.ok(!omitted.query.source.evidenceFlow.some(({ title }) => /sql|query inspection/iu.test(title)));
  assertPrivateSourceOmitted(omitted);
  const onlySql = normalizeInlineChartInput(reviewedInput(), { includeSql: true });
  assert.equal(onlySql.query.source.sql, reviewedSql);
  for (const url of reviewedUrls) assert.ok(!JSON.stringify(onlySql).includes(url));

  const onlyUrls = normalizeInlineChartInput(reviewedInput(), { includeSql: false, includeSourceUrls: true });
  assert.ok(!JSON.stringify(onlyUrls).includes(reviewedSql));
  for (const url of reviewedUrls) assert.ok(JSON.stringify(onlyUrls).includes(url));

  const both = normalizeInlineChartInput(reviewedInput(), {
    includeSql: true,
    includeSourceUrls: true,
  });
  assert.equal(both.query.source.sql, reviewedSql);
  assert.ok(both.query.source.evidenceFlow.some(({ title }) => title === "Raw SQL"));
  for (const url of reviewedUrls) assert.ok(JSON.stringify(both).includes(url));
});

test("SQL omission also removes evidence containing the statement without its surrounding whitespace", () => {
  const input = reviewedInput();
  input.source.sql = `\n  ${reviewedSql}\n`;
  input.source.evidenceFlow = [{ title: "Captured execution", detail: reviewedSql }];
  const normalized = normalizeInlineChartInput(input, { includeSql: false });
  assert.equal(normalized.query.source.sql, undefined);
  assert.deepEqual(normalized.query.source.evidenceFlow, []);
});

test("SQL disclosure rejects credentials and direct contact/payment literals without exposing them in errors", () => {
  for (const sql of [
    "SELECT value FROM sample WHERE api_key = 'SYNTHETIC_CREDENTIAL'",
    "SELECT 'Bearer SYNTHETIC_CREDENTIAL_VALUE' AS authorization",
    "SELECT count(*) FROM sample WHERE email = 'person@example.test'",
    "SELECT count(*) FROM sample -- contact person@example.test",
    "SELECT count(*) FROM sample WHERE contact = '+12025550100'",
    "SELECT count(*) FROM sample WHERE contact = '+1 (202) 555-0100'",
    "SELECT count(*) FROM sample WHERE contact = '202-555-0100'",
    "SELECT count(*) FROM sample WHERE customer_phone IN ('2025550100')",
    "SELECT count(*) FROM sample WHERE mobileNumber = 2025550100",
    "SELECT count(*) FROM sample WHERE ssn = '123-45-6789'",
    "SELECT count(*) FROM sample WHERE card_number = '4111111111111111'",
    "SELECT count(*) FROM sample WHERE account_number = 'SYNTHETIC_ACCOUNT'",
    "SELECT 'postgresql://reviewer:SYNTHETIC_CREDENTIAL@db.example.test/usage'",
    "SELECT 'customdb://reviewer:SYNTHETIC_CREDENTIAL@db.example.test/usage'",
    "SELECT 'jdbc:sqlserver://db.example.test;database=usage;user=reviewer'",
    "SELECT 'Driver={SQL Server};Server=sample;UID=reviewer;PWD=SYNTHETIC_CREDENTIAL'",
  ]) {
    const input = reviewedInput();
    input.source.sql = sql;
    input.source.evidenceFlow = [{ title: "Captured execution", detail: sql }];
    assert.throws(() => normalizeInlineChartInput(input, { includeSql: true }), (error) => {
      assert.match(error.message, /source.sql contains credentials or direct contact\/payment identifiers/u);
      assert.ok(!error.message.includes(sql));
      return true;
    });
    const omitted = normalizeInlineChartInput(input, { includeSql: false });
    assert.equal(omitted.query.source.sql, undefined);
    assert.deepEqual(omitted.query.source.evidenceFlow, []);
    assert.ok(!JSON.stringify(omitted).includes(sql));
  }
  const input = reviewedInput();
  input.source.sql = "SELECT count(email), count(phone), sum(revenue) FROM sample WHERE date >= '2026-07-01' AND revenue > 100000000";
  assert.equal(normalizeInlineChartInput(input, { includeSql: true }).query.source.sql, input.source.sql);
});

test("evidence prose URLs require explicit disclosure across supported text aliases", () => {
  const href = "https://warehouse.example.test/reviewed-prose-export";
  const prose = `Downloaded from ${href}`;
  for (const step of [
    prose,
    { title: prose },
    { label: prose },
    ...["detail", "description", "summary", "text"].map((key) => ({ title: "Reviewed export", [key]: prose })),
  ]) {
    const input = structuredClone(example);
    input.source.evidenceFlow = [{ title: "Reviewed aggregate", detail: "Counts reconciled." }, step];

    const privatePayload = normalizeInlineChartInput(input, { includeSourceUrls: false });
    assert.deepEqual(privatePayload.query.source.evidenceFlow, [
      { title: "Reviewed aggregate", detail: "Counts reconciled." },
    ]);
    assert.doesNotMatch(inlineJson(privatePayload), /warehouse\.example\.test|reviewed-prose-export/u);

    const approvedPayload = normalizeInlineChartInput(input, { includeSourceUrls: true });
    assert.equal(approvedPayload.query.source.evidenceFlow.length, 2);
    assert.ok(inlineJson(approvedPayload).includes(href));
  }
});

test("evidence prose never serializes credential URLs even when source URLs are approved", () => {
  for (const href of [
    "https://warehouse.example.test/export?access_token=SYNTHETIC_TOKEN",
    "https://warehouse.example.test/export#/callback?accessToken=SYNTHETIC_TOKEN",
    "https://reviewer:SYNTHETIC_TOKEN@warehouse.example.test/export",
  ]) {
    for (const step of [
      { title: "Reviewed export", detail: `Downloaded from ${href}` },
      { title: `Reviewed export ${href}` },
      { label: "Reviewed export", summary: `Downloaded from ${href}` },
      { title: "Reviewed export", links: [{ href: reviewedUrls[3], label: `Downloaded from ${href}` }] },
    ]) {
      const input = structuredClone(example);
      input.source.evidenceFlow = [step];
      const privatePayload = normalizeInlineChartInput(input, { includeSourceUrls: false });
      assert.doesNotMatch(inlineJson(privatePayload), /SYNTHETIC_TOKEN|warehouse\.example\.test/u);
      assert.throws(() => normalizeInlineChartInput(input, { includeSourceUrls: true }), (error) => {
        assert.match(error.message, /credentials or access tokens/iu);
        assert.doesNotMatch(error.message, /SYNTHETIC_TOKEN/u);
        return true;
      });
    }
  }
});

test("evidence prose applies canonical unsafe URL filtering after disclosure approval", () => {
  for (const href of [
    "https://warehouse.example.test/export?page=2",
    "https://warehouse.example.test/export#summary",
    "https://warehouse.example.test/access-token/SYNTHETIC_TOKEN",
    "https://warehouse.example.test/access%255ftoken/SYNTHETIC_TOKEN",
  ]) {
    const input = structuredClone(example);
    input.source.evidenceFlow = [{ title: "Reviewed export", detail: `Downloaded from ${href}` }];
    for (const includeSourceUrls of [false, true]) {
      const normalized = normalizeInlineChartInput(input, { includeSourceUrls });
      assert.deepEqual(normalized.query.source.evidenceFlow, []);
      assert.doesNotMatch(inlineJson(normalized), /warehouse\.example\.test|SYNTHETIC_TOKEN/u);
    }
  }
});

test("all projected source prose and inventory identities require URL disclosure", () => {
  const href = "https://warehouse.example.test/PRIVATE_PROSE_SENTINEL";
  const places = [
    (input) => { input.source.label = `Reviewed ${href}`; },
    (input) => { input.description = `Reviewed ${href}`; },
    (input) => { input.source.caveats = [`Reviewed ${href}`]; },
    (input) => { input.source.filters = [`Reviewed ${href}`]; },
    (input) => { input.source.files = [href]; },
    (input) => { input.source.tables = [href]; },
    (input) => { input.source.metricDefinitions[0].label = `Reviewed ${href}`; },
    (input) => { input.source.metricDefinitions[0].definition = `Reviewed ${href}`; },
    (input) => { input.source.metricDefinitions[0].formula = `reviewed(${href})`; },
    (input) => { input.source.metricDefinitions[0].numerator = { field: "activeUsers", label: `Reviewed ${href}` }; },
    (input) => { input.source.sql = `SELECT '${href}' AS reviewed_source`; },
  ];
  for (const place of places) {
    const input = reviewedInput();
    place(input);
    assert.throws(() => normalizeInlineChartInput(input, { includeSql: true }), /explicit source URL disclosure/u);
    const normalized = normalizeInlineChartInput(input, { includeSql: true, includeSourceUrls: true });
    assert.ok(inlineJson(normalized).includes(href));
  }
});

test("projected source text rejects normalized credential URLs without scanning excluded metadata", () => {
  for (const href of [
    "https://warehouse.example.test/export?access_token=SYNTHETIC_LABEL_SECRET",
    "https:/warehouse.example.test/export?access_token=SYNTHETIC_LABEL_SECRET",
    "https:\\warehouse.example.test/export?access_token=SYNTHETIC_LABEL_SECRET",
  ]) {
    const input = reviewedInput();
    input.source.links = [{ href: reviewedUrls[2], label: `Export ${href}` }];
    assert.doesNotMatch(inlineJson(normalizeInlineChartInput(input)), /SYNTHETIC_LABEL_SECRET/u);
    assert.throws(() => normalizeInlineChartInput(input, { includeSourceUrls: true }), /credentials or access tokens/u);
    input.source.links = [];
    input.source.metricDefinitions[0].definition = `Reviewed at ${href}`;
    assert.throws(() => normalizeInlineChartInput(input), /explicit source URL disclosure/u);
    assert.throws(() => normalizeInlineChartInput(input, { includeSourceUrls: true }), /credentials or access tokens/u);
    input.source.metricDefinitions[0].definition = "Token counts use the reviewed tokenizer; no access token is included.";
    input.source.privateMetadata = { label: href };
    input.source.metricDefinitions[1].definition = href;
    for (const includeSourceUrls of [false, true]) {
      const normalized = normalizeInlineChartInput(input, { includeSourceUrls });
      assert.doesNotMatch(inlineJson(normalized), /SYNTHETIC_LABEL_SECRET/u);
      assert.match(inlineJson(normalized), /Token counts use the reviewed tokenizer/u);
    }
  }
});

test("inline disclosure options reject truthy strings and require explicit booleans", () => {
  for (const invalid of ["true", 1, null]) {
    assert.throws(() => normalizeInlineChartInput(reviewedInput(), { includeSql: invalid }), /explicit booleans/iu);
    assert.throws(
      () => normalizeInlineChartInput(reviewedInput(), { includeSourceUrls: invalid }),
      /explicit booleans/iu,
    );
  }
});

test("inline metric definitions project away private extension fields even when links are approved", () => {
  const input = reviewedInput();
  input.source.metricDefinitions[0] = {
    ...input.source.metricDefinitions[0],
    internalSourceUrl: "https://definitions.example.test/private-definition",
    rawSql: "SELECT secret_definition FROM private_definitions",
    accessToken: "private-definition-token",
    numerator: {
      field: "activeUsers",
      label: "Reviewed active users",
      internalUrl: "https://definitions.example.test/private-numerator",
    },
    sourceLineage: [
      {
        tables: ["warehouse.private_inline_regression"],
        files: ["Reviewed export.csv"],
        internalUrl: "https://definitions.example.test/private-lineage",
      },
    ],
  };

  const normalized = normalizeInlineChartInput(input, { includeSourceUrls: true });
  const definition = normalized.query.source.metricDefinitions[0];
  const serialized = JSON.stringify(definition);

  assert.equal(definition.label, "Active users");
  assert.deepEqual(definition.numerator, {
    field: "activeUsers",
    label: "Reviewed active users",
  });
  assert.deepEqual(definition.sourceLineage, [
    {
      tables: ["warehouse.private_inline_regression"],
      files: ["Reviewed export.csv"],
    },
  ]);
  assert.doesNotMatch(serialized, /private-definition|private-numerator|private-lineage|secret_definition/u);
});

test("inline definition lineage serializes only the reviewed table and file inventory", () => {
  const input = reviewedInput();
  input.source.sourceFiles = ["Reviewed companion.csv"];
  input.source.metricDefinitions[0].sourceLineage = [
    {
      tables: ["warehouse.private_inline_regression", "warehouse.UNREVIEWED_TABLE_SENTINEL", "Reviewed export.csv"],
      files: ["Reviewed export.csv", "UNREVIEWED_FILE_SENTINEL.csv", "warehouse.private_inline_regression"],
    },
    { tables: ["warehouse.UNREVIEWED_SECOND_TABLE"], files: ["UNREVIEWED_SECOND_FILE.csv"] },
    { files: ["Reviewed companion.csv"] },
  ];

  for (const includeSourceUrls of [false, true]) {
    const normalized = normalizeInlineChartInput(input, { includeSourceUrls });
    assert.deepEqual(normalized.query.source.metricDefinitions[0].sourceLineage, [
      { tables: ["warehouse.private_inline_regression"], files: ["Reviewed export.csv"] },
      { files: ["Reviewed companion.csv"] },
    ]);
    assert.doesNotMatch(inlineJson(normalized), /UNREVIEWED_(?:TABLE|FILE)_SENTINEL|UNREVIEWED_SECOND/u);
  }

  input.source.tables = [];
  input.source.files = [];
  input.source.sourceFiles = [];
  for (const includeSourceUrls of [false, true]) {
    const normalized = normalizeInlineChartInput(input, { includeSourceUrls });
    assert.deepEqual(normalized.query.source.metricDefinitions[0].sourceLineage, []);
    assert.doesNotMatch(inlineJson(normalized), /UNREVIEWED_|Reviewed (?:export|companion)\.csv/u);
  }
});

test("inline source inspectors exclude unrelated unscoped executive salary definitions", () => {
  const input = reviewedInput();
  input.source.metricDefinitions = [
    {
      label: "Weekly active users",
      field: "activeUsers",
      definition: "Reviewed users active during the week",
    },
    {
      label: "Executive salary",
      field: "executiveSalary",
      definition: "Confidential executive base salary is $875,000",
    },
    {
      label: "Private employee count",
      field: "privateHeadcount",
      definition: "Confidential personnel plan",
    },
  ];

  const normalized = normalizeInlineChartInput(input, { includeSourceUrls: true });
  assert.deepEqual(
    normalized.query.source.metricDefinitions.map(({ field }) => field),
    ["activeUsers"],
  );
  assert.doesNotMatch(JSON.stringify(normalized), /executiveSalary|875,000|privateHeadcount|personnel plan/u);
});

test("long-form chart provenance retains visible dimensions, approved previews, and real metric dependencies", () => {
  const input = reviewedInput();
  input.chart = { type: "line", x: "week", y: "wau", series: "country" };
  input.columns = ["attributionRegion"];
  input.rows = [
    { week: "2026-08-03", country: "US", wau: 120, attributionRegion: "North America", executiveSalary: 875_000 },
    { week: "2026-08-03", country: "DE", wau: 95, attributionRegion: "Europe", executiveSalary: 920_000 },
    { week: "2026-08-10", country: "US", wau: 131, attributionRegion: "North America", executiveSalary: 875_000 },
    { week: "2026-08-10", country: "DE", wau: 104, attributionRegion: "Europe", executiveSalary: 920_000 },
  ];
  input.source.metricDefinitions = [
    { label: "Reporting week", field: "week", definition: "UTC week when activity occurred" },
    { label: "User country", field: "country", definition: "Reviewed country of user attribution" },
    {
      label: "Weekly active users",
      field: "wau",
      definition: "Weekly active users eligible for inclusion",
      formula: "activeUsers / eligiblePopulation",
      dependencies: ["eligiblePopulation"],
    },
    {
      label: "Attribution region",
      field: "attributionRegion",
      definition: "Reviewed region exposed as an approved preview column",
    },
    {
      label: "Eligible population",
      field: "eligiblePopulation",
      definition: "Users eligible for the reviewed active-user calculation",
    },
    {
      label: "Executive salary",
      field: "executiveSalary",
      definition: "Confidential executive base salary is $875,000",
    },
    {
      label: "Private employee count",
      field: "privateHeadcount",
      definition: "Confidential personnel plan",
    },
  ];

  const normalized = normalizeInlineChartInput(input);

  assert.deepEqual(Object.keys(normalized.rows[0]), ["week", "country", "wau", "attributionRegion"]);
  assert.deepEqual(
    normalized.query.source.metricDefinitions.map(({ field }) => field),
    ["week", "country", "wau", "attributionRegion", "eligiblePopulation"],
  );
  assert.equal(
    normalized.query.source.metricDefinitions.find(({ field }) => field === "country")?.definition,
    "Reviewed country of user attribution",
  );
  assert.doesNotMatch(JSON.stringify(normalized), /executiveSalary|875,000|privateHeadcount|personnel plan/u);
});

test("evidence links never retain raw trust secrets even after source URLs are approved", () => {
  const input = reviewedInput();
  input.source.links[0].trust = {
    provider: "Reviewed warehouse",
    uniqueUsers: 17,
    accessToken: "top-level-trust-secret",
  };
  input.source.evidenceFlow[0].links[0].trust = {
    provider: "Unreviewed evidence trust",
    uniqueUsers: 99,
    accessToken: "evidence-link-trust-secret",
    authorization: "Bearer hidden-evidence-token",
  };

  const normalized = normalizeInlineChartInput(input, { includeSourceUrls: true });
  const sourceLink = normalized.query.source.links[0];
  const evidenceLink = normalized.query.source.evidenceFlow[0].links[0];

  assert.deepEqual(sourceLink.trust, { provider: "Reviewed warehouse", uniqueUsers: 17 });
  assert.deepEqual(evidenceLink, {
    href: reviewedUrls[3],
    label: "Reviewed evidence",
  });
  assert.doesNotMatch(JSON.stringify(normalized), /trust-secret|hidden-evidence-token|Unreviewed evidence trust/u);
});

test("explicitly disclosed source URLs still reject embedded credentials and tokens", () => {
  for (const href of [
    "https://reviewer:password@warehouse.example.test/report",
    "https://warehouse.example.test/report?access_token=private-secret",
    "https://warehouse.example.test/report?signature=private-secret",
    "https://warehouse.example.test/report?X-Amz-Signature=private-secret",
    "https://warehouse.example.test/report?X-Amz-Credential=private-secret",
    "https://warehouse.example.test/report?X-Amz-Security-Token=private-secret",
    "https://warehouse.example.test/report?X-Goog-Signature=private-secret",
    "https://warehouse.example.test/report?X-Goog-Credential=private-secret",
    "https://warehouse.example.test/report?AWSAccessKeyId=private-secret",
    "https://warehouse.example.test/report?GoogleAccessId=private-secret",
    "https://warehouse.example.test/report#access_token=private-secret",
    "https://warehouse.example.test/report#/callback?accessToken=private-secret",
    "https://warehouse.example.test/report#X-Amz-Signature=private-secret",
  ]) {
    const input = structuredClone(example);
    input.source.links = [{ label: "Unsafe source", href }];
    assert.throws(
      () => normalizeInlineChartInput(input, { includeSourceUrls: true }),
      /credentials or access tokens/iu,
      href,
    );
  }
});

test("credential rejection covers canonical source URL aliases only when disclosure is requested", () => {
  const href = "https://warehouse.example.test/report?access_token=private-secret";
  const table = { name: "warehouse.reviewed", href };
  const file = { label: "Reviewed export.csv", href };
  const evidence = [{ title: "Reviewed rows", links: [{ href }] }];
  const sources = [
    ["url", { url: href }],
    ["href", { href }],
    ["links string", { links: [href] }],
    ["links url", { links: [{ url: href }] }],
    ["query.url", { query: { url: href } }],
    ["query.links", { query: { links: [{ href }] } }],
    ["tables", { tables: [table] }],
    ["tablesUsed", { tablesUsed: [table] }],
    ["tableLinks", { tableLinks: [table] }],
    ["table_links", { table_links: [table] }],
    ["query.tables_used", { query: { tables_used: [table] } }],
    ["query.table_links", { query: { table_links: [table] } }],
    ["files", { files: [file] }],
    ["sourceFiles", { sourceFiles: [file] }],
    ["query.files", { query: { files: [file] } }],
    ["query.sourceFiles", { query: { sourceFiles: [file] } }],
    ["evidenceFlow", { evidenceFlow: evidence }],
    ["evidence_flow", { evidence_flow: evidence }],
    ["query.evidence_flow", { query: { evidence_flow: evidence } }],
  ];

  for (const [name, source] of sources) {
    const input = structuredClone(example);
    input.source = { label: "Reviewed source", sql: reviewedSql, ...source };
    assert.throws(
      () => normalizeInlineChartInput(input, { includeSourceUrls: true }),
      /credentials or access tokens/iu,
      name,
    );
    assert.doesNotMatch(JSON.stringify(normalizeInlineChartInput(input)), /private-secret/u, name);
    const onlySql = normalizeInlineChartInput(input, { includeSql: true });
    assert.equal(onlySql.query.source.sql, reviewedSql, name);
    assert.doesNotMatch(JSON.stringify(onlySql), /private-secret/u, name);
  }
});

test("inline source URL disclosure preserves canonical URL filtering and ignores hidden extension URLs", () => {
  const input = reviewedInput();
  const hidden = "https://warehouse.example.test/report?access_token=private-secret";
  input.source.privateMetadata = { href: hidden };
  input.source.metricDefinitions[0].internalSourceUrl = hidden;
  input.source.links.push(
    { href: "https://warehouse.example.test/report?page=2" },
    { href: "https://warehouse.example.test/report#summary" },
    { href: "https://warehouse.example.test/access-token/private-secret" },
    { href: "javascript:alert(1)" },
  );
  input.source.evidenceFlow.push({ title: "Raw SQL", links: [{ href: hidden }] });

  const normalized = normalizeInlineChartInput(input, { includeSql: false, includeSourceUrls: true });
  assert.deepEqual(normalized.query.source.links, [{ href: reviewedUrls[2], label: "Warehouse query" }]);
  assert.doesNotMatch(JSON.stringify(normalized), /private-secret|page=2|#summary|javascript:/u);
  assert.throws(
    () => normalizeInlineChartInput(input, { includeSql: true, includeSourceUrls: true }),
    /credentials or access tokens/iu,
  );
});

test("inline timestamps remain recorded values and are never invented", () => {
  const missing = normalizeInlineChartInput(structuredClone(example));
  assert.equal(Object.hasOwn(missing, "generatedAt"), false);
  assert.equal(Object.hasOwn(missing.query.source, "executedAt"), false);

  const input = reviewedInput();
  input.generatedAt = "2026-08-14T13:00:00.000Z";
  const recorded = normalizeInlineChartInput(input);
  assert.equal(recorded.generatedAt, input.generatedAt);
  assert.equal(recorded.query.source.executedAt, input.source.executedAt);

  assert.throws(
    () => normalizeInlineChartInput({ ...input, generatedAt: "not-a-real-timestamp" }),
    /generatedAt must be a real recorded timestamp/iu,
  );
  assert.throws(
    () =>
      normalizeInlineChartInput({
        ...input,
        source: { ...input.source, executedAt: "not-a-real-timestamp" },
      }),
    /source\.executedAt must be a real recorded timestamp/iu,
  );
});

test("materialized refresh timestamps never masquerade as query execution or generation times", () => {
  const refreshedAt = "2026-08-14T10:15:00.000Z";
  const executedAt = "2026-08-14T12:34:56.000Z";
  const generatedAt = "2026-08-14T13:00:00.000Z";
  const refreshCaveat = `Materialized source data last refreshed at ${refreshedAt}; query execution time was not recorded.`;
  const input = structuredClone(example);
  input.columns = ["materialized_refresh_ts"];
  input.rows = input.rows.map((row) => ({ ...row, materialized_refresh_ts: refreshedAt }));
  input.source = {
    label: "Reviewed materialized growth view",
    materialized_refresh_ts: refreshedAt,
    query: { materialized_refresh_ts: refreshedAt },
    caveats: [refreshCaveat],
  };

  const refreshOnly = normalizeInlineChartInput(input);
  assert.equal(Object.hasOwn(refreshOnly, "generatedAt"), false);
  assert.equal(Object.hasOwn(refreshOnly.query.source, "executedAt"), false);
  assert.ok(refreshOnly.rows.every(({ materialized_refresh_ts: value }) => value === refreshedAt));
  assert.deepEqual(refreshOnly.query.source.caveats, [refreshCaveat]);

  const independentlyRecorded = structuredClone(input);
  independentlyRecorded.source.query.executed_at = executedAt;
  independentlyRecorded.generatedAt = generatedAt;
  const truthful = normalizeInlineChartInput(independentlyRecorded);

  assert.equal(truthful.query.source.executedAt, executedAt);
  assert.equal(truthful.generatedAt, generatedAt);
  assert.notEqual(truthful.query.source.executedAt, refreshedAt);
  assert.notEqual(truthful.generatedAt, refreshedAt);
  assert.ok(truthful.rows.every(({ materialized_refresh_ts: value }) => value === refreshedAt));
  assert.deepEqual(truthful.query.source.caveats, [refreshCaveat]);
});

test("inline JSON escapes HTML, script terminators, replacement dollars, and line separators", () => {
  const dangerous = {
    title: "</script><img src=x onerror=alert(1)> & $& $$ $' $`",
    lineSeparators: "first\u2028second\u2029third",
  };
  const serialized = inlineJson(dangerous);

  assert.deepEqual(JSON.parse(serialized), dangerous);
  assert.doesNotMatch(serialized, /[<>&$\u2028\u2029]/u);
  assert.match(serialized, /\\u003c\/script/u);
  assert.match(serialized, /\\u0024/u);
  assert.doesNotThrow(() => assertReplacementSafe(serialized));
});

test("legacy whole-fragment replacement safety rejects every destructive dollar sequence", () => {
  for (const unsafe of ["$&", "$$", "$'", "$`"]) {
    assert.throws(() => assertReplacementSafe(`prefix ${unsafe} suffix`), /unsafe JavaScript replacement/iu);
  }

  assert.doesNotThrow(() => assertReplacementSafe("prefix \\u0024& suffix"));
  let parserCalled = false;
  const unchanged = makeReplacementSafe("const value = 42;", () => {
    parserCalled = true;
  });
  assert.deepEqual(unchanged, { code: "const value = 42;", encodedTokens: 0 });
  assert.equal(parserCalled, false, "Already safe JavaScript should not require the locked parser");
});

test("inline cache path boundaries reject installed plugin descendants", () => {
  assert.equal(isInside(DATA_PLUGIN_ROOT, DATA_PLUGIN_ROOT), true);
  assert.equal(isInside(DATA_PLUGIN_ROOT, join(DATA_PLUGIN_ROOT, "private-cache")), true);
  assert.equal(isInside(DATA_PLUGIN_ROOT, `${DATA_PLUGIN_ROOT}-sibling`), false);
});

test("canonical plugin aliases reject hidden in-plugin cache and output destinations", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "data-inline-path-alias-tests-"));
  const alias = join(scratch, "plugin-alias");

  try {
    await symlink(DATA_PLUGIN_ROOT, alias, process.platform === "win32" ? "junction" : "dir");
    const nonexistentDescendant = join(alias, "nested-alias-cache", "not-created-yet");

    assert.equal(
      await canonicalInlinePath(nonexistentDescendant),
      join(await realpath(DATA_PLUGIN_ROOT), "nested-alias-cache", "not-created-yet"),
    );
    await assert.rejects(
      () =>
        prepareInlineRuntime({
          pluginRoot: DATA_PLUGIN_ROOT,
          cacheDir: nonexistentDescendant,
          offline: true,
        }),
      /cache outside the installed Data plugin/iu,
    );
    await assert.rejects(
      () =>
        renderInlineChart({
          input: structuredClone(example),
          output: join(alias, "blocked-inline-chart.html"),
          pluginRoot: DATA_PLUGIN_ROOT,
          offline: true,
        }),
      /outside the installed Data plugin/iu,
    );
    await assert.rejects(
      () =>
        renderInlineChart({
          input: structuredClone(example),
          output: "relative-inline-chart.html",
          pluginRoot: DATA_PLUGIN_ROOT,
          offline: true,
        }),
      /explicit output path/iu,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("the renderer CLI publishes its canonical example and complete shared chart-family list", async () => {
  const script = join(DATA_PLUGIN_ROOT, "skills/visualize-data/scripts/render-inline-chart.mjs");
  const [exampleResult, chartTypeResult, helpResult] = await Promise.all([
    execFileAsync(process.execPath, [script, "--example"]),
    execFileAsync(process.execPath, [script, "--list-chart-types"]),
    execFileAsync(process.execPath, [script, "--help"]),
  ]);

  assert.deepEqual(JSON.parse(exampleResult.stdout), example);
  assert.deepEqual(JSON.parse(chartTypeResult.stdout), chartTypes);
  assert.match(helpResult.stdout, /--include-sql/iu);
  assert.match(helpResult.stdout, /--omit-sql/iu);
  assert.match(helpResult.stdout, /--include-source-urls/iu);
  await assert.rejects(execFileAsync(process.execPath, [script, "--include-sql", "--omit-sql"]), /not both/u);
});

test("the renderer CLI requires a SQL choice and preserves inclusion, omission, and unavailable states", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "inline-sql-disclosure-"));
  const script = join(DATA_PLUGIN_ROOT, "skills/visualize-data/scripts/render-inline-chart.mjs");
  const inputPath = join(scratch, "reviewed.json");
  const output = join(scratch, "reviewed-chart.html");
  const args = [script, "--input", inputPath, "--output", output];
  const input = reviewedInput();
  input.source.sql = `\n  ${reviewedSql}\n`;
  try {
    for (const source of [input.source, { ...input.source, sql: undefined, query: { sql: input.source.sql } }]) {
      await writeFile(inputPath, JSON.stringify({ ...input, source }));
      await assert.rejects(execFileAsync(process.execPath, args), (error) => {
        assert.match(error.stderr, /Supplied SQL requires an explicit choice/u);
        assert.match(error.stderr, /--include-sql.*--omit-sql/u);
        assert.ok(!error.stderr.includes(reviewedSql));
        return true;
      });
      await assert.rejects(stat(output), { code: "ENOENT" });
    }
    await execFileAsync(process.execPath, [...args, "--include-sql"]);
    assert.equal(fragmentPayload(await readFile(output, "utf8")).query.source.sql, input.source.sql);
    await execFileAsync(process.execPath, [...args, "--omit-sql"]);
    assertPrivateSourceOmitted(await readFile(output, "utf8"));
    delete input.source.sql;
    input.source.evidenceFlow = [];
    await writeFile(inputPath, JSON.stringify(input));
    const unavailable = await execFileAsync(process.execPath, args);
    assert.equal(JSON.parse(unavailable.stdout).includedSql, false);
    const existingFragment = await readFile(output, "utf8");
    assert.equal(fragmentPayload(existingFragment).query.source.sql, undefined);
    input.source.sql = "SELECT count(*) FROM sample WHERE email = 'person@example.test'";
    await writeFile(inputPath, JSON.stringify(input));
    await assert.rejects(execFileAsync(process.execPath, [...args, "--include-sql"]), /direct contact\/payment identifiers/u);
    assert.equal(await readFile(output, "utf8"), existingFragment, "Rejected SQL must not replace a delivered chart");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

const INTEGRATION_TEST_NAME =
  "prebuilt React/Recharts integration survives relocation, privacy, escaping, and integrity checks";

async function temporarilyChange(path, changed, action) {
  const original = await readFile(path);
  try {
    await writeFile(path, typeof changed === "function" ? changed(original) : changed);
    return await action();
  } finally {
    await writeFile(path, original);
  }
}

test(INTEGRATION_TEST_NAME, async (t) => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "data-inline-prebuilt-tests-")));
  const isolatedCache = join(scratch, "unused-legacy-cache");
  const relocatedPlugin = join(scratch, "clean-installed-plugin");
  const assetDirectory = join(relocatedPlugin, "assets/data-app-runtime");

  try {
    await cp(DATA_PLUGIN_ROOT, relocatedPlugin, {
      recursive: true,
      filter(source) {
        const path = relative(DATA_PLUGIN_ROOT, source).replaceAll("\\", "/");
        const parts = path.split("/");
        return (
          !parts.some((part) => ["node_modules", "dist", ".git"].includes(part)) &&
          path !== "assets/data-app-toolchain" &&
          !path.startsWith("assets/data-app-toolchain/") &&
          path !== "scripts/toolchain" &&
          !path.startsWith("scripts/toolchain/")
        );
      },
    });

    let originalRuntime;
    await t.test("concurrent preparation reads the same shipped runtime without creating a cache", async () => {
      for (const path of [
        "node_modules",
        "templates/data-app/base/node_modules",
        "scripts/prebuilt/node_modules",
        "assets/data-app-toolchain",
      ]) {
        await assert.rejects(stat(join(relocatedPlugin, path)), { code: "ENOENT" });
      }
      const sourceState = await inlineSourceState(relocatedPlugin);
      const progress = [];
      const attempts = await Promise.all([
        prepareInlineRuntime({
          pluginRoot: relocatedPlugin,
          cacheDir: isolatedCache,
          offline: true,
          onProgress: (message) => progress.push(message),
        }),
        prepareInlineRuntime({
          pluginRoot: relocatedPlugin,
          cacheDir: isolatedCache,
          requireDependencies: true,
        }),
      ]);
      originalRuntime = attempts[0];
      for (const prepared of attempts) {
        assert.equal(prepared.prebuilt, true);
        assert.equal(prepared.cacheHit, false);
        assert.equal(prepared.cacheDir, null);
        assert.equal(prepared.legacyCacheDir, isolatedCache);
        assert.equal(Object.hasOwn(prepared, "dependencyDirectory"), false);
        assert.equal(prepared.metadata.key, sourceState.runtimeKey);
        assert.equal(prepared.metadata.source, "prebuilt");
        assert.equal(prepared.metadata.sha256, createHash("sha256").update(prepared.code).digest("hex"));
        assert.equal(prepared.metadata.bytes, Buffer.byteLength(prepared.code));
        assert.ok(prepared.metadata.bytes < MAX_INLINE_FRAGMENT_BYTES);
        assert.deepEqual(prepared.metadata.externalImports, []);
        assert.deepEqual(prepared.metadata.dynamicImports, []);
        for (const path of ["src/charting/ChartRenderer.jsx", "src/components/ChartEditor.jsx", "src/components/ChartExplorer.jsx"]) {
          assert.ok(prepared.metadata.canonicalModules.includes(path), path);
        }
        assert.match(prepared.code, /mountInlineChart/u);
        assert.doesNotThrow(() => new Script(prepared.code));
        assert.doesNotThrow(() => assertReplacementSafe(prepared.code));
        assertPrivateSourceOmitted(prepared.code);
      }
      assert.equal(attempts[0].code, attempts[1].code);
      assert.ok(progress.some((message) => /prebuilt[^.]*no dependency installation or build/iu.test(message)));
      await assert.rejects(stat(isolatedCache), { code: "ENOENT" });
    });

    await t.test("the release-only JavaScript rewrite preserves AST and execution semantics", async () => {
      const compiler = await loadPrebuiltCompiler({ pluginRoot: relocatedPlugin });
      const parse = (code) => compiler.parseJavaScript(code, { sourceType: "script" });
      const source = [
        'const $$value = "$& $$ $\'";',
        "const message = `plain $& and escaped \\$& ${$$value}`;",
        "const untouchedTag = String.raw`untouched raw ${$$value}`;",
        'globalThis.inlineEncodingResult = [$$value, message, untouchedTag].join(" | " );',
      ].join("\n");
      const originalContext = {};
      const encodedContext = {};
      new Script(source).runInNewContext(originalContext);
      const encoded = makeReplacementSafe(source, parse);
      new Script(encoded.code).runInNewContext(encodedContext);

      assert.ok(encoded.encodedTokens >= 3);
      assert.equal(encodedContext.inlineEncodingResult, originalContext.inlineEncodingResult);
      assert.doesNotThrow(() => assertReplacementSafe(encoded.code));
      assert.throws(() => makeReplacementSafe("String.raw`$&`", parse), /tagged-template raw values/iu);
      assert.throws(
        () => makeReplacementSafe("const unsafe = /$&/u;", parse),
        /Unsupported replacement-sensitive JavaScript/iu,
      );
    });

    await t.test("the pure-JavaScript CSS parser accepts local tokens and blocks escaped resources", async () => {
      const compiler = await loadPrebuiltCompiler({ pluginRoot: relocatedPlugin });
      for (const css of [
        ":root { --chart-1: light-dark(#0285ff, #66b5ff); --fixed-theme-scheme: dark; }",
        ":root, :root { --chart-1: color-mix(in srgb, red, blue); --font-sans: 'Local font', sans-serif; }",
        String.raw`:\72 oot { \2d\2d chart-1: var(--approved, #0285ff); }`,
        ":root { --chart-1: rgb(0 128 255 / 50%) !important; } /* complete comment */",
      ]) {
        const safe = validateInlineThemeCss(css, compiler);
        assert.ok(safe.length > 0, css);
        assert.doesNotThrow(() => compiler.parseCss(safe), css);
      }

      const forbiddenThemes = [
        String.raw`:root { --chart-1: u\72l("https://tracker.example.test/pixel"); }`,
        String.raw`:root { --chart-1: \75 rl("https://tracker.example.test/pixel"); }`,
        String.raw`:root { --chart-1: \000075\000072\00006c("https://tracker.example.test/pixel"); }`,
        String.raw`:root { --chart-1: u\72/**/l("https://tracker.example.test/pixel"); }`,
        String.raw`:root { --chart-1: \000075\000072\00006c/**/("https://tracker.example.test/pixel"); }`,
        String.raw`:root { --chart-1: var(--safe, u\72/**/l("https://tracker.example.test/pixel")); }`,
        String.raw`:root { --chart-1: \69mage-set("https://tracker.example.test/pixel" 1x); }`,
        String.raw`:root { --chart-1: var(--approved, var(--second, \75 rl("https://tracker.example.test/pixel"))); }`,
        ':root { --chart-1: IMAGE-SET("https://tracker.example.test/pixel" 1x); }',
        ':root { --chart-1: -webkit-image-set("https://tracker.example.test/pixel" 1x); }',
        ':root { --chart-1: image("https://tracker.example.test/pixel"); }',
        ':root { --chart-1: src("https://tracker.example.test/font"); }',
        ":root { --chart-1: paint(private-worklet); }",
        ":root { --chart-1: expression(privateValue); }",
        ':root { --chart-1: var(--safe, url("https://tracker.example.test/pixel")); }',
        ":root { color: red; }",
        "body { --chart-1: #0285ff; }",
        ":root, body { --chart-1: #0285ff; }",
        ":root:hover { --chart-1: #0285ff; }",
        ":root { --chart-1: red; & { --chart-2: blue; } }",
        '@import "https://tracker.example.test/theme.css";',
        "@media (prefers-color-scheme: dark) { :root { --chart-1: #0285ff; } }",
        ":root { --chart-1: red;",
        ":root { --chart-1: calc(1 + 2",
        ':root { --chart-1: "unterminated',
        String.raw`:root { --chart-1: red\}`,
        ":root { --chart-1: red; } /* unterminated",
        ":root { --chart-1: red; } /*/",
        ":root { --chart-1: rgb(1, 2; }",
        ":root { --chart-1: [unclosed; }",
        ":root { --chart-1 red; }",
        "/* no approved token declarations */",
      ];
      for (const css of forbiddenThemes) {
        assert.throws(
          () => validateInlineThemeCss(css, compiler),
          /Custom inline themes|expected|Unexpected|Invalid|Unsupported/iu,
          css,
        );
      }
    });

    await t.test("a changed prebuilt artifact is rejected instead of rebuilt or repaired", async () => {
      const sourceState = await inlineSourceState(relocatedPlugin);
      const artifactPath = join(assetDirectory, sourceState.manifest.artifacts.inline.path);
      await temporarilyChange(
        artifactPath,
        (bytes) => Buffer.concat([bytes, Buffer.from("\n/* unreviewed change */\n")]),
        async () => {
          await assert.rejects(
            prepareInlineRuntime({ pluginRoot: relocatedPlugin, cacheDir: isolatedCache, offline: true }),
            /prebuilt|integrity|hash|mismatch/iu,
          );
          assert.match(await readFile(artifactPath, "utf8"), /unreviewed change/u);
          await assert.rejects(stat(isolatedCache), { code: "ENOENT" });
        },
      );
      const restored = await prepareInlineRuntime({ pluginRoot: relocatedPlugin, cacheDir: isolatedCache });
      assert.equal(restored.metadata.key, originalRuntime.metadata.key);
    });

    await t.test("stale inline and protected source fail closed until the release is rebuilt", async () => {
      for (const path of [
        "templates/data-app/inline/inline.css",
        "templates/data-app/base/src/charting/ChartRenderer.jsx",
        "templates/data-app/base/src/components/ChartEditor.jsx",
        "templates/data-app/base/src/components/ChartExplorer.jsx",
        "templates/data-app/base/src/charting/chart-editor-state.js",
        "templates/data-app/base/src/components/contained-ui.jsx",
        "templates/data-app/inline/chart-presentation.js",
      ]) {
        await temporarilyChange(
          join(relocatedPlugin, path),
          (bytes) => Buffer.concat([bytes, Buffer.from("\n/* source mismatch */\n")]),
          () =>
            assert.rejects(
              prepareInlineRuntime({ pluginRoot: relocatedPlugin, cacheDir: isolatedCache, offline: true }),
              /prebuilt|protected|source|stale|mismatch|integrity/iu,
            ),
        );
      }
      assert.equal(
        (await prepareInlineRuntime({ pluginRoot: relocatedPlugin, cacheDir: isolatedCache })).metadata.key,
        originalRuntime.metadata.key,
      );
    });

    await t.test("canonical legacy cache aliases cannot receive reviewed chart payloads", async () => {
      await mkdir(isolatedCache);
      const cacheAlias = join(scratch, "cache-output-alias");
      await symlink(isolatedCache, cacheAlias, process.platform === "win32" ? "junction" : "dir");
      const blocked = join(cacheAlias, "blocked-private-chart.html");
      await assert.rejects(
        renderInlineChart({
          input: reviewedInput(),
          output: blocked,
          pluginRoot: relocatedPlugin,
          cacheDir: isolatedCache,
          offline: true,
        }),
        /shared renderer cache/iu,
      );
      await assert.rejects(stat(join(isolatedCache, "blocked-private-chart.html")), { code: "ENOENT" });
    });

    await t.test("custom themes use the shipped CSS parser and reject encoded external resources", async () => {
      const approvedTheme = join(scratch, "safe-inline-theme.css");
      const rejectedTheme = join(scratch, "unsafe-inline-theme.css");
      const approvedOutput = join(scratch, "custom-theme-chart.html");
      const rejectedOutput = join(scratch, "unsafe-theme-chart.html");
      await writeFile(
        approvedTheme,
        ":root { --chart-1: #123456; --fixed-theme-scheme: dark; --font-sans: ui-sans-serif; }\n",
      );
      await writeFile(rejectedTheme, String.raw`:root { --chart-1: u\72l("https://tracker.example.test/pixel"); }`);
      await renderInlineChart({
        input: structuredClone(example),
        output: approvedOutput,
        themeCssPath: approvedTheme,
        pluginRoot: relocatedPlugin,
        cacheDir: isolatedCache,
        offline: true,
      });
      const payload = fragmentPayload(await readFile(approvedOutput, "utf8"));
      assert.equal(payload.theme.id, "original");
      assert.equal(payload.theme.fixedScheme, "dark");
      assert.match(payload.theme.css, /--chart-1:\s*#123456/iu);
      await assert.rejects(
        renderInlineChart({
          input: structuredClone(example),
          output: rejectedOutput,
          themeCssPath: rejectedTheme,
          pluginRoot: relocatedPlugin,
          cacheDir: isolatedCache,
          offline: true,
        }),
        /Custom inline themes|external resources/iu,
      );
      await assert.rejects(stat(rejectedOutput), { code: "ENOENT" });
    });

    await t.test("rendered fragments are deterministic, private by default, and replacement-safe", async () => {
      const input = reviewedInput();
      input.chart.annotations = [{ id: "unresolved-private-event", kind: "event", at: "2099-01-01",
        field: "unreviewedNote", label: "UNAPPROVED_ANNOTATION_LABEL" }];
      input.rows = input.rows.map((row) => ({ ...row, unreviewedNote: "UNAPPROVED_ANNOTATION_VALUE" }));
      input.title = "Reviewed </script><img src=x onerror=alert(1)> $& $$ $' $` & chart";
      const firstPath = join(scratch, "first-inline-chart.html");
      const secondPath = join(scratch, "second-inline-chart.html");
      const [first, second] = await Promise.all([
        renderInlineChart({
          input,
          output: firstPath,
          pluginRoot: relocatedPlugin,
          cacheDir: isolatedCache,
          offline: true,
        }),
        renderInlineChart({
          input,
          output: secondPath,
          pluginRoot: relocatedPlugin,
          cacheDir: isolatedCache,
          offline: true,
        }),
      ]);
      const firstFragment = await readFile(firstPath, "utf8");
      const secondFragment = await readFile(secondPath, "utf8");
      const payload = fragmentPayload(firstFragment);
      assert.equal(firstFragment, secondFragment);
      assert.equal(first.rootId, second.rootId);
      const selectedRuntime = await prepareInlineRuntime({ pluginRoot: relocatedPlugin,
        artifactName: inlineArtifactForChart(input.chart.type) });
      assert.equal(first.runtimeKey, selectedRuntime.metadata.key);
      assert.ok(first.runtimeBytes < originalRuntime.metadata.bytes);
      assert.equal(first.prebuilt, true);
      assert.equal(first.rowCount, input.rows.length);
      assert.equal(first.includedSql, false);
      assert.ok(first.bytes <= MAX_INLINE_FRAGMENT_BYTES);
      assert.equal(payload.component.title, input.title);
      assert.equal(payload.theme.id, "codex-classic");
      assert.equal(Object.hasOwn(payload, "generatedAt"), false);
      assert.equal(payload.query.source.executedAt, input.source.executedAt);
      assert.doesNotMatch(firstFragment, /<\/script><img/u);
      assert.match(firstFragment, /aria-label="Reviewed &lt;\/script&gt;&lt;img/u);
      assert.match(firstFragment, /&#36;/u);
      assert.doesNotThrow(() => assertReplacementSafe(firstFragment));
      assertPrivateSourceOmitted(firstFragment);
      assert.doesNotMatch(firstFragment, /unreviewedNote|UNAPPROVED_ANNOTATION/u);

      const marker = "<!--insert-inline-chart-->";
      const host = "before" + marker + "after";
      assert.equal(
        host.replace(marker, firstFragment),
        host.replace(marker, () => firstFragment),
      );
    });

    await t.test("the real fragment renderer rejects credential URLs in retained annotation text before writing output", async () => {
      for (const [index, chart] of [
        { type: "line", at: "2099-01-01" },
        { type: "pie", at: "2026-07-13" },
        { type: "line", at: "2026-07-13", showAnnotations: false },
      ].entries()) {
        const input = structuredClone(example);
        input.chart = { type: chart.type, x: "week", y: "activeUsers", showAnnotations: chart.showAnnotations,
          annotations: [{ id: "n", kind: "point", field: "activeUsers", at: chart.at,
            label: "HIDDEN https://warehouse.example.test/export?access_token=SYNTHETIC_PRIVATE_TOKEN" }] };
        if (chart.showAnnotations === undefined) delete input.chart.showAnnotations;
        for (const includeSourceUrls of [false, true]) {
          const output = join(scratch, `credential-annotation-${index}-${includeSourceUrls}.html`);
          await assert.rejects(renderInlineChart({ input, output, includeSourceUrls,
            pluginRoot: relocatedPlugin, cacheDir: isolatedCache, offline: true }), (error) => {
            assert.match(error.message, /source URL disclosure|credentials or access tokens/u);
            assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE_TOKEN/u);
            return true;
          });
          await assert.rejects(stat(output), { code: "ENOENT" });
        }
        input.chart.annotations[0].label = "Reviewed rollout";
        const output = join(scratch, `reviewed-annotation-${index}.html`);
        await renderInlineChart({ input, output, pluginRoot: relocatedPlugin, cacheDir: isolatedCache, offline: true });
        const fragment = await readFile(output, "utf8");
        assert.deepEqual(fragmentPayload(fragment).component.chart, input.chart,
          "Legitimate retained annotations and visibility flags survive the full renderer");
        assert.doesNotMatch(fragment, /SYNTHETIC_PRIVATE_TOKEN/u);
      }
    });

    await t.test("the final fragment size limit still rejects an oversized reviewed payload", async () => {
      const input = structuredClone(example);
      input.rows = Array.from({ length: 10 }, (_, index) => ({
        week: "reviewed-" + index + "-".repeat(90_000),
        activeUsers: index,
      }));
      const output = join(scratch, "oversized-inline-chart.html");
      await assert.rejects(
        renderInlineChart({ input, output, pluginRoot: relocatedPlugin, cacheDir: isolatedCache, offline: true }),
        /Inline chart is \d+ bytes \(limit 1000000\)/iu,
      );
      await assert.rejects(stat(output), { code: "ENOENT" });
    });

    await t.test("cold relocated CLI needs no npm, native compiler, child process, or network", async () => {
      const coldCache = join(scratch, "absent-offline-cache");
      const emptyPath = join(scratch, "no-system-tools");
      const forbiddenCalls = join(scratch, "unexpected-runtime-calls.log");
      const guardPath = join(scratch, "offline-guard.cjs");
      const inputPath = join(scratch, "reviewed-inline-input.json");
      const outputPath = join(scratch, "explicit-inline-chart.html");
      const themePath = join(scratch, "offline-custom-theme.css");
      const script = join(relocatedPlugin, "skills/visualize-data/scripts/render-inline-chart.mjs");
      await mkdir(emptyPath);
      await writeFile(inputPath, JSON.stringify(reviewedInput()));
      await writeFile(themePath, ":root { --chart-1: #123456; }\n");
      await writeFile(
        guardPath,
        [
          'const fs = require("node:fs");',
          'const blocked = (name) => () => { fs.appendFileSync(process.env.DATA_INLINE_FORBIDDEN_CALLS, name + "\\n"); throw new Error("Forbidden offline runtime call: " + name); };',
          'for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) require("node:child_process")[name] = blocked("child_process." + name);',
          'for (const name of ["http", "https"]) for (const method of ["request", "get"]) require("node:" + name)[method] = blocked(name + "." + method);',
          'for (const method of ["connect", "createConnection"]) require("node:net")[method] = blocked("net." + method);',
          'globalThis.fetch = blocked("fetch");',
          'require("node:module").syncBuiltinESMExports();',
        ].join("\n"),
      );
      const sentinelSource =
        'require("node:fs").appendFileSync(process.env.DATA_INLINE_FORBIDDEN_CALLS, "ancestor dependency\\n");' +
        'throw new Error("Untrusted ancestor dependency executed");';
      for (const name of ["react", "vite", "rolldown", "lightningcss", "acorn", "css-tree"]) {
        const directory = join(scratch, "node_modules", name);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.cjs" }));
        await writeFile(join(directory, "index.cjs"), sentinelSource);
      }
      const env = {
        ...process.env,
        PATH: emptyPath,
        DATA_INLINE_FORBIDDEN_CALLS: forbiddenCalls,
        NAPI_RS_FORCE_WASI: "error",
        NAPI_RS_NATIVE_LIBRARY_PATH: join(emptyPath, "untrusted-native-library.node"),
        npm_config_offline: "true",
        npm_config_registry: "http://127.0.0.1:9/",
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9",
      };
      const prepared = await execFileAsync(
        process.execPath,
        ["--require", guardPath, script, "--prepare", "--cache-dir", coldCache, "--offline"],
        { cwd: relocatedPlugin, env },
      );
      const preparedResult = JSON.parse(prepared.stdout);
      assert.equal(preparedResult.prebuilt, true);
      assert.equal(preparedResult.cacheHit, false);
      assert.equal(preparedResult.cacheDir, null);
      assert.equal(preparedResult.key, originalRuntime.metadata.key);
      assert.doesNotMatch(
        prepared.stderr,
        /WASI is an experimental feature|WASI binding not found|binding-wasm32-wasi/iu,
      );
      await assert.rejects(stat(coldCache), { code: "ENOENT" });

      const rendered = await execFileAsync(
        process.execPath,
        [
          "--require",
          guardPath,
          script,
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--theme-css",
          themePath,
          "--cache-dir",
          coldCache,
          "--offline",
          "--include-sql",
          "--include-source-urls",
        ],
        { cwd: relocatedPlugin, env },
      );
      const result = JSON.parse(rendered.stdout);
      const payload = fragmentPayload(await readFile(outputPath, "utf8"));
      assert.equal(result.prebuilt, true);
      assert.equal(result.cacheHit, false);
      assert.equal(result.includedSql, true);
      assert.equal(payload.query.source.sql, reviewedSql);
      for (const url of reviewedUrls) assert.ok(JSON.stringify(payload).includes(url), url);
      assert.match(payload.theme.css, /--chart-1:\s*#123456/iu);
      await assert.rejects(stat(coldCache), { code: "ENOENT" });
      await assert.rejects(stat(forbiddenCalls), { code: "ENOENT" });
      for (const path of ["node_modules", "templates/data-app/base/node_modules", "scripts/prebuilt/node_modules"]) {
        await assert.rejects(stat(join(relocatedPlugin, path)), { code: "ENOENT" });
      }
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
