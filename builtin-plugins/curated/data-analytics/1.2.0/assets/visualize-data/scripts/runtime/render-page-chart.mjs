import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { assertJson, inlineJson } from "./sources-common.mjs";

// Compatibility entrypoint for existing Page authoring scripts. New charts use
// render-chart.mjs; both paths default to Data's retained immutable release.
const maxFragmentBytes = 256 * 1024;
const rendererRoot = "https://persistent.oaistatic.com/plugins/visualize/charts/";
const retainedRelease = JSON.parse(readFileSync(new URL("../../assets/cdn.json", import.meta.url)));

export function renderPageChart(input, { release, buildId, version, baseUrl, entry, element } = retainedRelease) {
  const versioned = typeof version === "string" && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(version);
  const expectedBase = versioned ? `${rendererRoot}data-analytics-plugin/${version}/charts/` : rendererRoot + release + "/";
  if (!/^[a-f0-9]{64}$/u.test(release) || (version != null && (!versioned || !/^[a-f0-9]{64}$/u.test(buildId))) || baseUrl !== expectedBase ||
      entry !== "runtime.js" || element !== "element.js") {
    throw new Error("Use an immutable portable element release with its matching runtime.");
  }
  const { id, title, description, summary, height = 280, spec, columns, rows } = input;
  if (!spec?.type || !title || !id) throw new Error("Supply the reviewed chart id, title and spec.");
  if (!Number.isInteger(height) || height < 120 || height > 800) throw new Error("Chart height must be 120–800.");
  if (!Array.isArray(columns) || !columns.length || new Set(columns).size !== columns.length ||
      columns.some((c) => typeof c !== "string" || !c.trim() || ["__proto__", "prototype", "constructor"].includes(c))) {
    throw new Error("List unique, reviewed plotted columns, not the complete source schema.");
  }
  // The same input can build the report and source Page fragments. Send only
  // explicitly reviewed columns; do not coerce, round, aggregate, or drop rows.
  const tuples = rows.map((row, i) => {
    const cells = Array.isArray(row) ? row : columns.map((c) => Object.hasOwn(row, c) ? row[c] : undefined);
    if (cells.length !== columns.length || cells.some((v) => v !== null && typeof v !== "string" &&
        typeof v !== "boolean" && !Number.isFinite(v))) {
      throw new Error("Missing or non-scalar chart value in row " + (i + 1) + "; use explicit null for a gap.");
    }
    return cells;
  });
  const config = { id, title, ...(description && { description }), ...(summary && { summary }),
    height, spec, columns, rows: tuples };
  assertJson(config);
  const url = baseUrl + element;
  // The standard element owns loading, readiness and rendering errors.
  // Reserve space before it loads; inlineJson also handles older hosts.
  const fragment = [
    '<link rel="modulepreload" crossorigin="anonymous" href="' + baseUrl + entry + '">',
    '<div id="page-chart" style="min-height:' + (height + 100) + 'px"></div>',
    '<script type="module">',
    'const { mountChart } = await import("' + url + '");',
    'const config = ' + inlineJson(config) + ';',
    'mountChart(document.getElementById("page-chart"), config);',
    '</script>',
  ].join("\n");
  if (Buffer.byteLength(fragment, "utf8") > maxFragmentBytes) {
    throw new Error("Chart exceeds the Pages 256 KiB UTF-8 limit; request a reviewed reduction, never truncate.");
  }
  return fragment;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values: { input, manifest, output } } = parseArgs({ options: {
    input: { type: "string" }, manifest: { type: "string" }, output: { type: "string" },
  } });
  if (!input) throw new Error("Supply --input reviewed-chart.json. For direct HTML authoring, use the starter in skills/visualize-data/SKILL.md.");
  const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
  const fragment = renderPageChart(await readJson(input), manifest ? await readJson(manifest) : retainedRelease);
  if (output) await writeFile(output, fragment); else process.stdout.write(fragment);
}
