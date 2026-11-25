import { readFileSync } from "node:fs";
const template = readFileSync(new URL("./ReportContent.jsx", import.meta.url), "utf8");
const options = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };

export function dateLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("--prepared-on needs a real YYYY-MM-DD date.");
  const day = new Date(iso + "T00:00:00Z");
  if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== iso)
    throw new Error("--prepared-on needs a real YYYY-MM-DD date.");
  return new Intl.DateTimeFormat("en-US", options).format(day);
}

/** Validate explicit source choices for both typed and legacy report starters. */
export function validateReportInputs(data, { sources = [], chart = null }) {
  const known = id => typeof id === "string" && Object.hasOwn(data.queries, id);
  if (new Set(sources).size !== sources.length || sources.some(id => !known(id)))
    throw new Error("--source must name distinct reviewed query IDs in first-citation order.");
  if (chart !== null) {
    const c = chart?.config;
    if (!known(chart?.queryId) || !c || c.schemaVersion !== 1 || typeof c.id !== "string" ||
        !c.id || typeof c.title !== "string" || !c.title || !c.spec || typeof c.spec !== "object" ||
        "rows" in c || "columns" in c || "charts" in c)
      throw new Error("--chart requires {queryId, config: {schemaVersion: 1, id, title, spec}}; rows come from that reviewed query.");
  }
}

/** Build from explicit source choices. The snapshot supplies evidence, never invented rows. */
export function reportScaffold(data, { preparedOn, author = "", sources = [], chart = null }) {
  validateReportInputs(data, { sources, chart });
  const values = { '"__PREPARED_ON__"': JSON.stringify(dateLabel(preparedOn)), '"__AUTHOR__"': JSON.stringify(author),
    "/* @report-sources */ []": JSON.stringify(sources, null, 2),
    "/* @report-chart */ null": chart ? `chartFor(${JSON.stringify(chart.queryId)}, ${JSON.stringify(chart.config, null, 2)})` : "null" };
  // Single pass: a source ID or author can contain another placeholder, quotes, or replacement metacharacters.
  return template.replace(/"__PREPARED_ON__"|"__AUTHOR__"|\/\* @report-sources \*\/ \[\]|\/\* @report-chart \*\/ null/g,
    key => values[key]);
}
