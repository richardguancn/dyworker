import assert from "node:assert/strict";
import test from "node:test";

import { changeChartEditorSpec } from "../templates/data-app/base/src/charting/chart-editor-state.js";
import { chartTypes } from "../templates/data-app/base/src/charting/chart-theme.js";
import {
  inlineChartEditorCapabilities,
  originalInlineChartPresentation,
  validateInlineChartPresentation,
} from "../templates/data-app/inline/chart-presentation.js";
import { normalizeInlineChartInput } from "../skills/visualize-data/scripts/inline-chart-input.mjs";

function reviewedFixture() {
  return normalizeInlineChartInput({
    schemaVersion: 1,
    id: "reviewed-trend",
    title: "Reviewed activity",
    description: "Recorded observations, not a forecast.",
    chart: { type: "line", x: "week", y: "activeUsers", series: "plan", stackable: false },
    columns: ["baseline", "weekLabel"],
    rows: [
      { week: "2026-07-27", weekLabel: "Week one", plan: "Free", activeUsers: 120, baseline: 100, privateSalary: 9 },
      { week: "2026-07-27", weekLabel: "Week one", plan: "Team", activeUsers: 80, baseline: 70, privateSalary: 8 },
      { week: "2026-08-03", weekLabel: "Week two", plan: "Free", activeUsers: null, baseline: 110, privateSalary: 7 },
      { week: "2026-08-03", weekLabel: "Week two", plan: "Team", activeUsers: 95, baseline: 75, privateSalary: 6 },
    ],
    source: {
      label: "Reviewed fixture",
      metricDefinitions: [
        { field: "activeUsers", label: "Active users", definition: "Recorded active users." },
        { field: "baseline", label: "Baseline", definition: "Reviewed comparison." },
        { field: "privateSalary", label: "Private salary", definition: "Must not be exposed." },
      ],
      caveats: ["The missing observation is not zero."],
    },
  });
}

const presentation = (component, changes = {}) => ({
  ...originalInlineChartPresentation(component),
  ...changes,
  chart: { ...originalInlineChartPresentation(component).chart, ...changes.chart },
});

test("inline choices use only approved fields and compatible, nonaggregating chart types", () => {
  const { component, rows } = reviewedFixture();
  const choices = inlineChartEditorCapabilities(component, rows);
  assert.deepEqual(choices.types, ["line", "area", "bar", "horizontalBar", "sparkline"]);
  assert.equal(choices.fieldsEditable, true);
  assert.deepEqual(choices.yFields, ["activeUsers", "baseline"]);
  assert.ok(choices.xFields.includes("weekLabel"));
  assert.ok(!choices.xFields.includes("plan"));
  assert.ok(!choices.seriesFields.includes(""));
  assert.ok(!choices.seriesFields.includes("weekLabel"));
  assert.ok(!JSON.stringify(choices).includes("privateSalary"));
});

test("applying a compatible edit changes presentation and never the reviewed snapshot", () => {
  const payload = reviewedFixture();
  const before = JSON.stringify(payload);
  const next = validateInlineChartPresentation(
    payload.component,
    payload.rows,
    presentation(payload.component, {
      title: "  Comparison  ",
      description: "  Same reviewed rows.  ",
      chart: {
        type: "bar",
        y: "baseline",
        fields: ["baseline"],
        showLegend: false,
        xLabel: "Reporting week",
        colors: { Free: "#123456" },
      },
    }),
  );
  assert.equal(next.title, "Comparison");
  assert.equal(next.description, "Same reviewed rows.");
  assert.equal(next.chart.type, "bar");
  assert.equal(next.chart.y, "baseline");
  assert.deepEqual(next.chart.colors, { Free: "#123456" });
  assert.deepEqual(Object.keys(next), ["chart", "title", "description"]);
  assert.equal(JSON.stringify(payload), before);
  assert.equal(payload.rows[2].activeUsers, null);
  assert.ok(!JSON.stringify(next).includes("privateSalary"));
  assert.notEqual(next.chart, payload.component.chart);
});

test("new category or split choices cannot collapse reviewed observations", () => {
  const { component, rows } = reviewedFixture();
  assert.throws(
    () => validateInlineChartPresentation(component, rows, presentation(component, { chart: { series: "" } })),
    /collapse reviewed rows/u,
  );
  assert.throws(
    () =>
      validateInlineChartPresentation(component, rows, presentation(component, { chart: { x: "plan", series: "" } })),
    /collapse reviewed rows/u,
  );
  const remapped = validateInlineChartPresentation(
    component,
    rows,
    presentation(component, { chart: { x: "weekLabel" } }),
  );
  assert.equal(remapped.chart.x, "weekLabel");
  assert.equal(remapped.chart.series, "plan");
});

test("new split choices cannot overwrite canonical pivot object properties", () => {
  const component = { title: "Reviewed values", chart: { type: "line", x: "week", y: "wau" } };
  for (const unsafe of ["__proto__", "prototype", "constructor", "week"]) {
    const rows = [
      { week: "one", wau: 10, group: unsafe },
      { week: "two", wau: 20, group: "Team" },
    ];
    assert.ok(!inlineChartEditorCapabilities(component, rows).seriesFields.includes("group"), unsafe);
    assert.throws(
      () => validateInlineChartPresentation(component, rows, presentation(component, { chart: { series: "group" } })),
      /collapse reviewed rows/u,
      unsafe,
    );
  }
});

test("a grain-safe split change replaces derived series labels with the reviewed measure", () => {
  const component = {
    title: "Reviewed split",
    chart: { type: "line", x: "week", y: "value", series: "plan", fields: ["Free", "Team"] },
  };
  const rows = [
    { week: "one", value: 10, plan: "Free" },
    { week: "two", value: 20, plan: "Team" },
  ];
  assert.ok(inlineChartEditorCapabilities(component, rows).seriesFields.includes(""));
  const cleared = validateInlineChartPresentation(
    component,
    rows,
    presentation(component, { chart: { series: "", fields: ["value"] } }),
  );
  assert.deepEqual(cleared.chart.fields, ["value"]);
  assert.equal(cleared.chart.series, "");
  assert.deepEqual(
    validateInlineChartPresentation(component, rows, originalInlineChartPresentation(component)),
    originalInlineChartPresentation(component),
  );
});

test("a reviewed wide chart keeps every measure through a safe split round-trip", () => {
  const { component, rows } = normalizeInlineChartInput({
    schemaVersion: 1,
    title: "Reviewed actual and target",
    chart: { type: "line", x: "week", y: "actual", fields: ["actual", "target"] },
    columns: ["plan"],
    rows: [
      { week: "one", actual: 10, target: 12, plan: "Free", privateValue: 999 },
      { week: "two", actual: 15, target: 18, plan: "Team", privateValue: 999 },
    ],
    source: { label: "Reviewed fixture" },
  });
  const fields = { columns: [...new Set(rows.flatMap(Object.keys))] };
  assert.ok(inlineChartEditorCapabilities(component, rows).seriesFields.includes("plan"));
  const split = changeChartEditorSpec(component.chart, "series", "plan", fields);
  assert.deepEqual(split.fields, ["actual", "target"]);
  validateInlineChartPresentation(component, rows, presentation(component, { chart: split }));
  assert.ok(inlineChartEditorCapabilities(component, rows, split).seriesFields.includes(""));
  const restored = changeChartEditorSpec(split, "series", "", fields);
  const accepted = validateInlineChartPresentation(component, rows, presentation(component, { chart: restored }));
  assert.deepEqual(accepted.chart.fields, ["actual", "target"]);
  assert.equal(accepted.chart.y, "actual");
  assert.ok(!JSON.stringify(accepted).includes("privateValue"));
});

test("unsupported data, source, schema, and aggregation edits fail closed", () => {
  const { component, rows } = reviewedFixture();
  const invalid = [
    [{ queryId: "another-query" }, /only chart presentation/u],
    [{ rows: [] }, /only chart presentation/u],
    [{ chart: { type: "histogram" } }, /not compatible/u],
    [{ chart: { type: "heatmap" } }, /not compatible/u],
    [{ chart: { type: "stackedBar" } }, /not compatible/u],
    [{ chart: { y: "privateSalary", fields: ["privateSalary"] } }, /unavailable|numeric reviewed/u],
    [{ chart: { source: "privateSalary" } }, /fixed by the reviewed/u],
    [{ chart: { stackable: true } }, /fixed by the reviewed/u],
    [{ chart: { sql: "SELECT secret" } }, /unsupported chart option/u],
    [{ chart: { showLegend: "yes" } }, /must be a boolean/u],
    [{ chart: { sortOrder: "random" } }, /supported sort order/u],
    [{ chart: { xLabel: "x".repeat(501) } }, /at most 500/u],
    [{ chart: { colors: { Free: "url(https://example.com/private)" } } }, /supported reviewed series color/u],
    [{ chart: { colors: { privateSalary: "#123456" } } }, /supported reviewed series color/u],
    [{ title: " " }, /nonempty text/u],
    [{ description: "x".repeat(2001) }, /at most 2000/u],
  ];
  const before = JSON.stringify({ component, rows });
  for (const [changes, expected] of invalid) {
    assert.throws(() => validateInlineChartPresentation(component, rows, presentation(component, changes)), expected);
  }
  assert.equal(JSON.stringify({ component, rows }), before);
});

test("original omissions survive copy-only edits and exact reset", () => {
  const component = { id: "plain", title: "Original", chart: { type: "line", x: "week", y: "wau" } };
  const rows = [
    { week: "one", wau: 120 },
    { week: "two", wau: null },
    { week: "three", wau: 145 },
  ];
  const original = originalInlineChartPresentation(component);
  const copyOnly = validateInlineChartPresentation(component, rows, {
    ...original,
    title: "Renamed",
    chart: { ...original.chart, fields: ["wau"], series: "" },
  });
  assert.deepEqual(copyOnly.chart, component.chart);
  assert.deepEqual(validateInlineChartPresentation(component, rows, original), original);
  original.chart.type = "bar";
  assert.equal(component.chart.type, "line");
  assert.deepEqual(
    rows.map((row) => row.wau),
    [120, null, 145],
  );
});

test("all-null original measures remain editable without inventing zeroes", () => {
  const component = { title: "Missing series", chart: { type: "line", x: "week", y: "wau" } };
  const rows = [
    { week: "one", wau: null },
    { week: "two", wau: null },
  ];
  assert.deepEqual(inlineChartEditorCapabilities(component, rows).yFields, ["wau"]);
  assert.equal(
    validateInlineChartPresentation(component, rows, presentation(component, { chart: { type: "bar" } })).chart.type,
    "bar",
  );
  assert.deepEqual(
    rows.map((row) => row.wau),
    [null, null],
  );
});

test("an authored numeric grouping role remains valid for copy edits and reset", () => {
  const component = { title: "Cohorts", chart: { type: "line", x: "week", y: "wau", series: "cohortYear" } };
  const rows = [
    { week: "one", wau: 10, cohortYear: 2025 },
    { week: "one", wau: 20, cohortYear: 2026 },
  ];
  const choices = inlineChartEditorCapabilities(component, rows);
  assert.ok(choices.types.includes("line"));
  assert.ok(choices.seriesFields.includes("cohortYear"));
  const original = originalInlineChartPresentation(component);
  assert.deepEqual(validateInlineChartPresentation(component, rows, original), original);
  assert.equal(
    validateInlineChartPresentation(component, rows, { ...original, title: "Cohort activity" }).title,
    "Cohort activity",
  );
});

test("legacy numeric-string measures retain their original presentation without new coercion", () => {
  const { component, rows } = normalizeInlineChartInput({
    schemaVersion: 1,
    title: "Reviewed decimal strings",
    chart: { type: "bar", x: "category", y: "amount" },
    rows: [
      { category: "A", amount: "1.25" },
      { category: "B", amount: "2.5" },
    ],
    source: { label: "Reviewed decimal export" },
  });
  const original = originalInlineChartPresentation(component);
  const choices = inlineChartEditorCapabilities(component, rows);
  assert.deepEqual(choices.types, ["bar"]);
  assert.equal(choices.fieldsEditable, false);
  assert.deepEqual(validateInlineChartPresentation(component, rows, original), original);
  assert.equal(
    validateInlineChartPresentation(component, rows, { ...original, title: "Renamed decimals" }).title,
    "Renamed decimals",
  );
  assert.deepEqual(
    rows.map((row) => row.amount),
    ["1.25", "2.5"],
  );
});

test("stacking requires the original reviewed semantics and never introduces percentage normalization", () => {
  const rows = [{ category: "A", a: 2, b: 3, conversionRate: 0.4 }];
  const component = {
    title: "Additive measures",
    chart: { type: "bar", x: "category", y: "a", fields: ["a", "b"], stackable: true },
  };
  const choices = inlineChartEditorCapabilities(component, rows);
  assert.ok(choices.types.includes("stackedArea"));
  assert.ok(choices.types.includes("stackedBar"));
  assert.ok(!choices.types.includes("stackedBar100"));
  const percentage = { ...component, chart: { ...component.chart, type: "stackedBar100" } };
  assert.deepEqual(inlineChartEditorCapabilities(percentage, rows).types, ["stackedBar100", "horizontalStackedBar100"]);
  assert.throws(
    () => validateInlineChartPresentation(percentage, rows, presentation(percentage, { chart: { type: "bar" } })),
    /not compatible/u,
  );
  assert.equal(inlineChartEditorCapabilities(percentage, rows).fieldsEditable, false);
  assert.ok(!inlineChartEditorCapabilities(percentage, rows).yFields.includes("conversionRate"));
  assert.throws(
    () =>
      validateInlineChartPresentation(
        percentage,
        rows,
        presentation(percentage, { chart: { y: "conversionRate", fields: ["conversionRate"] } }),
      ),
    /original reviewed data mapping/u,
  );

  const stacked = { ...component, chart: { ...component.chart, type: "stackedBar" } };
  const rateChart = { ...stacked.chart, type: "bar", y: "conversionRate", fields: ["conversionRate"] };
  assert.equal(
    validateInlineChartPresentation(stacked, rows, presentation(stacked, { chart: rateChart })).chart.y,
    "conversionRate",
  );
  assert.ok(!inlineChartEditorCapabilities(stacked, rows, rateChart).types.includes("stackedBar"));
  assert.throws(
    () =>
      validateInlineChartPresentation(
        stacked,
        rows,
        presentation(stacked, { chart: { ...rateChart, type: "stackedBar" } }),
      ),
    /original reviewed data mapping/u,
  );
});

test("new color tokens are bounded and refer only to the shared palette", () => {
  const component = { title: "Heatmap", chart: { type: "heatmap", x: "day", y: "value", series: "team" } };
  const rows = [{ day: "one", team: "A", value: 2 }];
  for (const baseColor of ["var(--chart-9)", `var(--chart-${"1".repeat(10000)})`, "url(https://example.com)"]) {
    assert.throws(
      () => validateInlineChartPresentation(component, rows, presentation(component, { chart: { baseColor } })),
      /supported chart color/u,
    );
  }
  assert.equal(
    validateInlineChartPresentation(
      component,
      rows,
      presentation(component, { chart: { baseColor: "var(--chart-8)" } }),
    ).chart.baseColor,
    "var(--chart-8)",
  );
});

test("specialized and composed charts retain their reviewed type and mapping", () => {
  const histogram = { title: "Latency", chart: { type: "histogram", y: "latencyMs" } };
  const rows = [
    { latencyMs: 12, other: 3 },
    { latencyMs: null, other: 4 },
  ];
  const choices = inlineChartEditorCapabilities(histogram, rows);
  const beforeHistogramEdit = JSON.stringify({ histogram, rows });
  assert.deepEqual(choices.types, ["histogram"]);
  assert.equal(choices.fieldsEditable, false);
  assert.throws(
    () =>
      validateInlineChartPresentation(
        histogram,
        rows,
        presentation(histogram, { chart: { y: "other", fields: ["other"] } }),
      ),
    /mapping is fixed/u,
  );
  const histogramLabels = {
    xLabel: "Latency (ms)",
    yLabel: "Requests",
    showXAxisLabel: true,
    showYAxisLabel: false,
    showValues: true,
  };
  assert.deepEqual(
    validateInlineChartPresentation(histogram, rows, presentation(histogram, { chart: histogramLabels })).chart,
    { ...histogram.chart, ...histogramLabels },
  );
  assert.throws(
    () => validateInlineChartPresentation(histogram, rows, presentation(histogram, { chart: { type: "bar" } })),
    /not compatible/u,
  );
  assert.deepEqual(
    validateInlineChartPresentation(histogram, rows, originalInlineChartPresentation(histogram)),
    originalInlineChartPresentation(histogram),
  );
  assert.equal(JSON.stringify({ histogram, rows }), beforeHistogramEdit);

  const composed = {
    title: "Actual and plan",
    chart: { type: "line", x: "week", y: "actual", fields: ["actual"], barFields: ["plan"] },
  };
  const composedRows = [{ week: "one", actual: 2, plan: 3 }];
  assert.deepEqual(inlineChartEditorCapabilities(composed, composedRows).types, ["line"]);
  assert.equal(inlineChartEditorCapabilities(composed, composedRows).fieldsEditable, false);
});

test("axis and annotation controls retain the reviewed data and annotation definitions", () => {
  const component = { title: "Actual and target", chart: {
    type: "line", x: "week", y: "actual", fields: ["actual", "target"],
    annotations: [{ id: "launch", kind: "event", at: "2026-08-01", field: "actual", label: "Launch" }],
  } };
  const rows = [{ week: "2026-08-01", actual: 10, target: 20 }];
  const before = JSON.stringify({ component, rows });
  const accepted = validateInlineChartPresentation(component, rows, presentation(component, {
    chart: { yAxisPosition: "right", rightAxisFields: ["target"], showAnnotations: false },
  }));
  assert.equal(accepted.chart.yAxisPosition, "right");
  assert.deepEqual(accepted.chart.rightAxisFields, ["target"]);
  assert.equal(accepted.chart.showAnnotations, false);
  assert.deepEqual(accepted.chart.annotations, component.chart.annotations);
  for (const chart of [
    { yAxisPosition: "outside" },
    { rightAxisFields: ["privateValue"] },
    { rightAxisFields: ["target", "target"] },
    { showAnnotations: "yes" },
    { annotations: [] },
  ]) {
    assert.throws(() => validateInlineChartPresentation(component, rows, presentation(component, { chart })),
      /axis|boolean|fixed by the reviewed/u);
  }
  assert.equal(JSON.stringify({ component, rows }), before);
});

test("specialized bar presentations preserve their reviewed nested mapping", () => {
  const component = { title: "Progress", chart: {
    type: "horizontalBar", presentation: "progress", x: "category", y: "value",
    barOptions: { track: { max: "goal" } },
  } };
  const rows = [{ category: "A", value: 10, goal: 20, other: 30 }];
  const choices = inlineChartEditorCapabilities(component, rows);
  assert.equal(choices.fieldsEditable, false);
  assert.deepEqual(choices.types, ["horizontalBar"]);
  assert.match(choices.notice, /title and description/u);
  assert.equal(validateInlineChartPresentation(component, rows, presentation(component, {
    title: "Reviewed progress",
  })).title, "Reviewed progress");
  assert.throws(() => validateInlineChartPresentation(component, rows, presentation(component, {
    chart: { barOptions: { track: { max: "other" } } },
  })), /barOptions is fixed/u);
  assert.throws(() => validateInlineChartPresentation(component, rows, presentation(component, {
    chart: { y: "other" },
  })), /mapping is fixed/u);
});

test("legacy chart aliases use canonical editor choices without mutating authored input", () => {
  const rows = [{ category: "A", value: 10 }];
  for (const [type, canonical] of [["leaderboard", "rankedList"], ["horizontal-bar", "horizontalBar"]]) {
    const component = { title: "Reviewed values", chart: { type, x: "category", y: "value" } };
    const original = originalInlineChartPresentation(component);
    assert.equal(original.chart.type, canonical);
    assert.ok(inlineChartEditorCapabilities(component, rows).types.includes(canonical));
    assert.deepEqual(validateInlineChartPresentation(component, rows, original), original);
    assert.equal(component.chart.type, type);
  }
});

test("every canonical original chart family can keep its reviewed presentation", () => {
  for (const type of chartTypes) {
    const chart =
      type === "histogram"
        ? { type, y: "value" }
        : type === "sankey"
          ? { type, y: "value", stages: ["from", "to"] }
          : { type, x: "category", y: "value", ...(type === "heatmap" ? { series: "group" } : {}) };
    const component = { title: type, chart };
    const rows = [{ category: "A", value: 2, group: "G", from: "A", to: "B" }];
    const original = originalInlineChartPresentation(component);
    assert.ok(inlineChartEditorCapabilities(component, rows).types.includes(original.chart.type), type);
    assert.deepEqual(validateInlineChartPresentation(component, rows, original), original, type);
  }
  const summary = { title: "Reviewed quartiles", chart: { type: "boxPlot", x: "group", y: "latency" } };
  const rows = [{ group: "A", minimum: 1, lowerQuartile: 2, median: 3, upperQuartile: 4, maximum: 5 }];
  assert.deepEqual(
    validateInlineChartPresentation(summary, rows, originalInlineChartPresentation(summary)),
    originalInlineChartPresentation(summary),
  );
});
