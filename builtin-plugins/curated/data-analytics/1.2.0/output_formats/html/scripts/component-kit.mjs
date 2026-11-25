import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { validateReportInputs } from '../report/scaffold.mjs';

/** Seed field shape from all supplied rows, never infer units or aggregation. */
export function dataViewSchema(queries, filters = []) {
  return Object.fromEntries(Object.entries(queries).map(([id, query]) => {
    const rows = Array.isArray(query.rows) ? query.rows : [];
    const fields = [...new Set(rows.length ? rows.flatMap(row => Object.keys(row))
      : filters.filter(filter => !filter.queryIds || filter.queryIds.includes(id)).map(filter => filter.field).filter(field => typeof field === 'string'))];
    const columns = Object.fromEntries(fields.map(field => {
      const values = rows.map(row => row[field]);
      const kinds = new Set(values.filter(value => value != null).map(value => typeof value));
      let type = kinds.size === 1 && ['number', 'string', 'boolean'].includes([...kinds][0]) ? [...kinds][0] : 'unknown';
      if (type === 'string' && values.filter(value => value != null).every(value => /^\d{4}-\d{2}-\d{2}$/.test(value))) type = 'date';
      const nullable = values.includes(null), optional = values.includes(undefined);
      return [field, nullable || optional ? { type, ...(nullable && { nullable }), ...(optional && { optional }) } : type];
    }));
    return [id, { columns, breakdown: fields }];
  }));
}

export function writeComponentKit(project, snapshot, byline = {}, tsx = true) {
  const schema = dataViewSchema(snapshot.queries, snapshot.filters);
  if (Object.values(snapshot.queries).some(query => !Array.isArray(query.rows)))
    throw new Error('The component-kit starter needs reviewed rows for every declared query; an empty array is valid. Keep unavailable/deferred data distinct from a reviewed empty result.');
  const root = join(project, 'src/content');
  writeFileSync(join(root, 'view.ts'), 'import { createDataView } from "./shared/DataView";\n\n'
    + '// Shape inferred from the supplied rows. Review changes when adding queries/columns.\n'
    + '// This declares fields, not metric meaning or an aggregation rule.\n'
    + '// Empty datasets cannot infer measure types: declare their reviewed fields before adding components.\n'
    + `export const View = createDataView(${JSON.stringify(schema, null, 2)});\n`
    + 'export type RowsOf<K extends Parameters<typeof View.useQuery>[0]> = ReturnType<typeof View.useQuery<K>>["rows"];\n');
  const surface = snapshot.surface, name = surface === 'report' ? 'ReportContent' : 'DashboardContent';
  const report = surface === 'report';
  const imports = report ? 'import { ReportFrame } from "../shared/ReportParts.jsx";\nimport { ReportCitation } from "../shared/ReportSources.jsx";\nimport "./report.css";\n' : 'import { Section } from "../../data-app-public.jsx";\n';
  const sourceIds = byline.sources ?? Object.keys(schema);
  if (report) validateReportInputs(snapshot, { sources: sourceIds, chart: byline.chart });
  const sources = report ? `\nconst sources = ${JSON.stringify(sourceIds)};\n` : '';
  const open = report ? `<ReportFrame sources={sources} preparedOn={${JSON.stringify(byline.preparedOn ?? '')}} author={${JSON.stringify(byline.author ?? '')}}>` : '<>';
  const close = report ? '</ReportFrame>' : '</>';
  const components = (report ? sourceIds : Object.keys(schema)).map((query, index) =>
    (report ? `    <p>Reviewed records for the selected scope. <ReportCitation queryIds={sources} queryId={${JSON.stringify(query)}} /></p>\n` : '    <Section>\n')
    + `    <View.Table id="reviewed-${index + 1}" query={${JSON.stringify(query)}} title={${JSON.stringify(snapshot.queries[query].source?.name ?? query)}} />`
    + (report ? '' : '\n    </Section>')).join('\n');
  const chart = report && byline.chart ? `\n    <View.Chart query={${JSON.stringify(byline.chart.queryId)}} {...${JSON.stringify(byline.chart.config)}} />` : '';
  const entry = join(root, surface, name + '.jsx');
  const body = report ? 'ReportBody.tsx' : 'DashboardBody.tsx';
  const editable = tsx ? join(root, surface, body) : entry;
  if (tsx) writeFileSync(entry, `export { ${name} } from "./${body}";\n`);
  writeFileSync(editable, `import React from "react";\nimport { View } from "../view";\n${imports}${sources}\n// Replace these evidence tables with the charts, metrics and narrative needed for the task.\n// The View owns scope and evidence; retain report claim citations, frame and CSS when customizing.\nexport function ${name}() {\n  return <View.Provider>${open}\n    <View.Filters />\n${components}${chart}\n  ${close}</View.Provider>;\n}\n`);
  return { entry: editable, contract: join(root, 'view.ts'), library: join(root, 'shared/DataView.tsx') };
}
