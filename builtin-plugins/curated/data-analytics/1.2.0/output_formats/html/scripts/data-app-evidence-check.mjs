import { checkedAppChartConfig as checkedChartConfig } from "../src/charting/chart-config.js";
import { dirname, join, resolve } from "node:path";
import { resolveChartSpec } from "../src/charting/chart-overrides.js";
import { getChartSpecError } from "../src/charting/chart-spec-validation.js";
import { filterDefinitionDiagnostics } from "./filter-definition-diagnostics.mjs";

const UNKNOWN = Symbol("not a static literal");
const MAX_REVIEWED_ROWS = 100_000;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const componentNames = new Set(["Chart", "EvidenceChart", "DataComponent"]);

function unwrap(ts, node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

// Deliberately no identifier resolution, evaluation, getters, calls or spreads.
// A dynamic part makes the whole value unknown, never a partially invented spec.
function literal(ts, expression) {
  let remaining = 10_000;
  function read(input, depth = 0) {
    const node = unwrap(ts, input);
    if (!node || depth > 64 || --remaining < 0) return UNKNOWN;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node)) {
      const value = read(node.operand, depth + 1);
      if (typeof value !== "number") return UNKNOWN;
      if (node.operator === ts.SyntaxKind.MinusToken) return -value;
      if (node.operator === ts.SyntaxKind.PlusToken) return value;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map(element => read(element, depth + 1));
      return values.includes(UNKNOWN) ? UNKNOWN : values;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const result = Object.create(null);
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name)
          || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))) return UNKNOWN;
        const name = property.name.text;
        if (name === "__proto__") return UNKNOWN;
        const value = read(property.initializer, depth + 1);
        if (value === UNKNOWN) return UNKNOWN;
        result[name] = value;
      }
      return result;
    }
    return UNKNOWN;
  }
  return read(expression);
}

function attributes(ts, node) {
  const values = new Map();
  let dynamicSpread = false;
  for (const attribute of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      const value = literal(ts, attribute.expression);
      if (record(value)) {
        for (const [name, entry] of Object.entries(value)) values.set(name, { value: entry, node: attribute });
      } else {
        // A later spread can replace every earlier property. Explicit later
        // attributes are still known, as in JavaScript's actual prop ordering.
        values.clear();
        dynamicSpread = true;
      }
    } else {
      const initializer = attribute.initializer;
      values.set(attribute.name.getText(), { node: attribute,
        value: !initializer ? true : ts.isJsxExpression(initializer)
          ? literal(ts, initializer.expression)
          // JSX quoted attributes decode entities/whitespace differently from
          // JavaScript strings. Leave those rare forms to the real compiler.
          : /[\r\n]|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/iu.test(initializer.text)
            ? UNKNOWN : literal(ts, initializer) });
    }
  }
  return { values, dynamicSpread };
}

function importedComponents(ts, source, projectRoot) {
  const names = new Map(), namespaces = new Set(), shadowed = new Set();
  const bind = name => {
    if (!name) return;
    if (ts.isIdentifier(name)) shadowed.add(name.text);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
      for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name);
  };
  const visit = node => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)
      || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) bind(node.name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (module !== "@openai/data-app" && (!module.startsWith(".")
      || resolve(dirname(source.fileName), module) !== join(projectRoot, "src/data-app-public.jsx"))) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const entry of bindings.elements) {
        const imported = (entry.propertyName ?? entry.name).text;
        if (componentNames.has(imported) && !shadowed.has(entry.name.text)) names.set(entry.name.text, imported);
      }
    } else if (bindings && ts.isNamespaceImport(bindings) && !shadowed.has(bindings.name.text)) namespaces.add(bindings.name.text);
  }
  return node => {
    const tag = node.tagName;
    if (ts.isIdentifier(tag)) return names.get(tag.text);
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression)
      && namespaces.has(tag.expression.text) && componentNames.has(tag.name.text)) return tag.name.text;
    return undefined;
  };
}

/** Cheap, conservative evidence checks over caller-supplied data; never reads or executes authored files.
 * Dynamic expressions are intentionally unexamined. Query identity does not imply
 * that displayed/derived rows equal the snapshot's original evidence rows.
 */
export function inspectDataEvidence({ ts, sources, snapshot, projectRoot, snapshotFile = join(projectRoot, "src/data.json") }) {
  const diagnostics = [];
  const emit = (code, message, file = snapshotFile, node, source, severity = "error") => {
    const position = node && source ? source.getLineAndCharacterOfPosition(node.getStart(source)) : { line: 0, character: 0 };
    diagnostics.push({ severity, code, message, file, line: position.line + 1, column: position.character + 1 });
  };
  const validQueries = record(snapshot) && record(snapshot.queries);
  if (!validQueries) emit("DATA_SNAPSHOT", "The snapshot must be an object containing a queries object.");
  for (const { code, message } of filterDefinitionDiagnostics(snapshot?.filters)) emit(code, message);
  for (const [index, filter] of (Array.isArray(snapshot?.filters) ? snapshot.filters : []).entries()) {
    const valueType = filter?.type ?? filter?.valueType;
    if (valueType === "dateRange" || valueType === "date-range")
      emit("DATA_FILTER_TYPE", `filters[${index}].${filter.type != null ? "type" : "valueType"} for ${JSON.stringify(filter.id ?? filter.field ?? index)} describes the field's value type, not its control. Use type: "date", mode: "through" for a date-range control, or mode: "exact" (or omitted) for one date.`);
    if (record(filter) && filter.mode !== undefined && filter.mode !== "through" && filter.mode !== "exact")
      emit("DATA_FILTER_MODE", `filters[${index}].mode for ${JSON.stringify(filter.id ?? filter.field ?? index)} must be "through" (date range) or "exact" (one value), or omitted. Use type: "date", mode: "through" for a date-range control.`);
  }
  let remainingRows = MAX_REVIEWED_ROWS, limited = false;
  for (const [id, query] of Object.entries(validQueries ? snapshot.queries : {})) {
    if (!record(query)) {
      emit("DATA_QUERY", `Snapshot query ${JSON.stringify(id)} must be an object.`);
      continue;
    }
    if (record(query.source)) {
      const ignored = ["name", "title", "description"].filter(key =>
        typeof query.source[key] === "string" && query.source[key].trim());
      if (ignored.length) emit("DATA_SOURCE_METADATA_IGNORED", `Query ${JSON.stringify(id)}: Sources does not display source.${ignored.join(", source.")}. Use source.label for the query name, files/tables for inputs, filters for exclusions, metricDefinitions for calculations, and caveats for material limits.`, snapshotFile, null, null, "warning");
      if (typeof query.source.query === "string") emit("DATA_SOURCE_METADATA_IGNORED", `Query ${JSON.stringify(id)}: source.query must be a metadata object to appear in Sources. Put SQL text in source.sql.`, snapshotFile, null, null, "warning");
    }
    // Missing rows are valid for deferred query loading and existing metadata-only snapshots.
    if (query.rows === undefined) continue;
    if (!Array.isArray(query.rows)) {
      emit("DATA_QUERY_ROWS", `Snapshot query ${JSON.stringify(id)} rows must be an array when present.`);
      continue;
    }
    for (let index = 0; index < query.rows.length; index++) {
      if (remainingRows-- <= 0) { limited = true; break; }
      if (!record(query.rows[index])) {
        emit("DATA_QUERY_ROWS", `Snapshot query ${JSON.stringify(id)} row ${index + 1} must be an object.`);
        break;
      }
    }
  }
  if (limited) emit("DATA_ROW_CHECK_LIMIT", `Row shape checking stopped after ${MAX_REVIEWED_ROWS.toLocaleString("en-US")} rows; remaining row shapes were not checked.`, snapshotFile, null, null, "warning");

  for (const [filename, text] of sources) {
    if (!/\.[cm]?[jt]sx?$/iu.test(filename)) continue;
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true,
      /\.[cm]?tsx?$/iu.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
    const identify = importedComponents(ts, source, resolve(projectRoot));
    const components = new Map();
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = identify(node);
        if (name) {
          const props = attributes(ts, node);
          const config = props.values.get("config");
          // When config is an object, the renderer rejects mixed split props even
          // if dynamic rows prevent the checker from evaluating the chart itself.
          if (name === "EvidenceChart" && config && (record(config.value) ||
              (config.node.initializer?.expression && ts.isObjectLiteralExpression(config.node.initializer.expression)))) {
            const mixed = ["id", "title", "description", "spec", "rows", "height", "dataInputs"].filter(key => props.values.has(key));
            if (mixed.length) emit("DATA_CHART_PROPS", `Remove the outer ${mixed.join(", ")} from EvidenceChart. Put chart metadata, spec, rows and height in config; keep queryId and sourceRows beside config.`, filename, props.values.get(mixed[0]).node, source);
          }
          if (config && config.value !== UNKNOWN) {
            try { checkedChartConfig(structuredClone(config.value)); }
            catch (error) { emit("DATA_CHART_SPEC", error.message, filename, config.node, source); }
          }
          if (name === "Chart") return;
          const bindings = props.values.get("evidenceById");
          if (config && bindings && bindings.value !== UNKNOWN && record(bindings.value)) {
            const charts = config.value !== UNKNOWN ? config.value?.charts ?? [config.value] : [];
            for (const chart of charts) {
              const binding = bindings.value[chart?.id];
              const query = binding?.queryId ?? props.values.get("queryId")?.value;
              if (typeof query !== "string" || !query.trim()) emit("DATA_QUERY_REF", `Chart ${JSON.stringify(chart?.id)} requires a queryId binding.`, filename, bindings.node, source);
              else if (validQueries && !Object.hasOwn(snapshot.queries, query)) emit("DATA_QUERY_REF", `Unknown reviewed query ${JSON.stringify(query)}.`, filename, bindings.node, source);
            }
          }
          const id = config ? { value: config.value === UNKNOWN ? UNKNOWN : config.value?.id ?? UNKNOWN, node: config.node } : props.values.get("id"), queryId = props.values.get("queryId");
          const report = (code, message, attribute) => emit(code, message, filename, attribute?.node ?? node, source);
          for (const [key, entry, code] of [["id", id, "DATA_COMPONENT_ID"], ["queryId", queryId, "DATA_QUERY_REF"]]) {
            if (key === "queryId" && config && bindings) continue;
            if ((!entry && !props.dynamicSpread) || (entry && entry.value !== UNKNOWN
              && (typeof entry.value !== "string" || !entry.value.trim()))) report(code, `${name} requires a nonempty stable ${key}.`, entry);
          }
          const queryIds = props.values.get("queryIds");
          const references = [queryId, ...(Array.isArray(queryIds?.value)
            ? queryIds.value.map(value => ({ value, node: queryIds.node })) : [])];
          if (validQueries) for (const reference of references) {
            if (typeof reference?.value === "string" && reference.value.trim()
              && !Object.hasOwn(snapshot.queries, reference.value))
              report("DATA_QUERY_REF", `Unknown reviewed query ${JSON.stringify(reference.value)}.`, reference);
          }
          const chart = props.values.get(name === "EvidenceChart" ? "spec" : "chart");
          if (chart && chart.value !== UNKNOWN && (name === "EvidenceChart" || chart.value)) {
            const candidateRows = props.values.get(name === "EvidenceChart" ? "rows" : "displayRows")?.value;
            const rows = Array.isArray(candidateRows) && candidateRows.every(record) ? candidateRows : undefined;
            let error;
            try { error = getChartSpecError(resolveChartSpec(chart.value), { id: typeof id?.value === "string" ? id.value : undefined, rows }); }
            catch (cause) { error = `Invalid chart specification: ${cause.message}`; }
            if (error) report("DATA_CHART_SPEC", error, chart);
          }
          components.set(node, { id, props });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    // Only native elements/fragments establish co-rendered siblings. Do not
    // compare separate returns, conditional arms, callbacks, or custom slots.
    const reported = new Set();
    const native = node => ts.isJsxFragment(node) || (ts.isJsxElement(node)
      && ts.isIdentifier(node.openingElement.tagName) && /^[a-z]/u.test(node.openingElement.tagName.text));
    const collect = (node, ids) => {
      if (ts.isJsxExpression(node)) return node.expression && collect(unwrap(ts, node.expression), ids);
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const component = components.get(opening);
      if (component) {
        const id = component.id;
        if (typeof id?.value !== "string" || !id.value.trim()) return;
        if (ids.has(id.value) && !reported.has(opening)) {
          emit("DATA_DUPLICATE_ID", `Co-rendered components share stable id ${JSON.stringify(id.value)}. Give each component its own id.`, filename, id.node, source);
          reported.add(opening);
        }
        ids.add(id.value);
      } else if (native(node)) for (const child of node.children) collect(child, ids);
    };
    const duplicates = node => {
      if (native(node)) collect(node, new Set());
      ts.forEachChild(node, duplicates);
    };
    duplicates(source);
  }
  return diagnostics;
}
