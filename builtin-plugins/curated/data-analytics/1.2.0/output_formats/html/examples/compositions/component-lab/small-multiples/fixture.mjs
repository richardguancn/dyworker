// Fictional index values; no warehouse query was executed for this fixture.
export const reviewedPeriods = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"];
export const regionDefinitions = [
  { id: "north-america", title: "North America", queryId: "regional_north_america", values: [100, 103, 107, 109, 114, 118] },
  { id: "europe", title: "Europe", queryId: "regional_europe", values: [100, 101, 100, 98, 96, 97] },
  { id: "asia-pacific", title: "Asia Pacific", queryId: "regional_asia_pacific", values: [100, 105, 109, 116, 121, 126] },
  { id: "latin-america", title: "Latin America", queryId: "regional_latin_america", values: [100, 102, 105, 109, 112, 114] },
  { id: "middle-east", title: "Middle East", queryId: "regional_middle_east", values: [100, 104, 109, 113, 118, 121] },
  { id: "africa", title: "Africa", queryId: "regional_africa", values: [100, 101, 104, 106, 108, 110] },
];

/** @type {import("../../../data-app-public.jsx").ChartSpec} */
export const chartSpec = {
  type: "line", x: "month", y: "revenueIndex",
  valueDomain: [90, 130], startAtZero: false,
  valueFormat: { style: "decimal", maximumFractionDigits: 0 },
  colors: { revenueIndex: "var(--chart-1)" },
  showXAxisLabel: false, yLabel: "Index (Jan = 100)",
};

// Only this fixture's single monthly measure is aligned. Missing observations
// become display gaps; callers retain the original rows as source evidence.
export function alignRowsToPeriods(rows, periods = reviewedPeriods) {
  if (!Array.isArray(periods) || !periods.length || periods.some((period, index) =>
    typeof period !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(period)
    || !Number.isFinite(Date.parse(period)) || new Date(period).toISOString().slice(0, 10) !== period
    || (index > 0 && period <= periods[index - 1]))) {
    throw new Error("Periods must be valid, sorted, unique ISO dates.");
  }
  if (!Array.isArray(rows)) throw new Error("Reviewed rows must be an array.");
  const allowed = new Set(periods);
  const byPeriod = new Map();
  for (const row of rows) {
    if (!row || !allowed.has(row.month)) throw new Error("Every reviewed row must belong to an explicit period.");
    if (byPeriod.has(row.month)) throw new Error("Only one reviewed row per period is supported.");
    if (row.revenueIndex !== null && !Number.isFinite(row.revenueIndex))
      throw new Error("Revenue index must be a finite number or null.");
    byPeriod.set(row.month, row);
  }
  return periods.map((month) => byPeriod.get(month) ?? { month, revenueIndex: null });
}

export function buildPanels(rowsByQuery, periods = reviewedPeriods) {
  return regionDefinitions.map(({ id, title, queryId }) => {
    const sourceRows = rowsByQuery[queryId] ?? [];
    const alignedRows = alignRowsToPeriods(sourceRows, periods);
    return { id: `region-${id}`, title, queryId, sourceRows, rows: sourceRows.length ? alignedRows : [] };
  });
}

export function smallMultiplesSnapshot(surface = "report") {
  if (!["report", "dashboard"].includes(surface)) throw new Error("Unknown small-multiples example surface.");
  return {
    id: `synthetic-regional-small-multiples-${surface}`, surface,
    title: "Regional revenue index", status: "fixture", buildStatus: "complete",
    generatedAt: "2026-07-01T12:00:00Z", report: { asOf: "2026-06-30" },
    filters: [],
    queries: Object.fromEntries(regionDefinitions.map(({ title, queryId, values }) => [queryId, {
      rows: reviewedPeriods.map((month, index) => ({ month, region: title, revenueIndex: values[index] })),
      source: {
        label: `Synthetic monthly index — ${title}`,
        sql: "-- Synthetic fixture; no warehouse query was executed.",
        tables: [],
        caveats: ["Fictional illustrative values. This index is not an observed revenue amount or a forecast."],
        metricDefinitions: [{ field: "revenueIndex", label: "Revenue index", definition:
          "Fictional monthly revenue index, January 2026 = 100 in each region. Values are index points, not percentages or currency." }],
      },
    }])),
  };
}
