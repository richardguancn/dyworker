import { join } from "node:path";
import { readAuthoredSources, typecheckInputs } from "./data-app-check.mjs";
import { assertPrebuiltProject } from "./data-app-runtime.mjs";
import { loadDataTypeScript } from "./data-app-typecheck.mjs";

// TypeScript truncates most long displays itself. Applied generic types can
// still expand a whole chart union or dataset, which is too large for a hint.
function shortType(checker, type, declaration) {
  const resolved = checker.typeToString(type, declaration);
  // Preserve readable signatures such as (rows: readonly Row<K>[]) => ReactNode
  // when displaying the resolved form would repeat the entire reviewed schema.
  const text = (resolved.length > 120 ? declaration?.type?.getText() ?? resolved : resolved).replace(/\s+/g, " ");
  return text.length > 180 ? text.slice(0, 179) + "…" : text;
}

function describeProps(ts, checker, symbol, location) {
  const signatures = checker.getTypeOfSymbolAtLocation(symbol, location).getCallSignatures();
  const props = new Map();
  for (const signature of signatures) {
    const parameter = signature.parameters[0];
    if (!parameter) continue;
    const type = checker.getTypeOfSymbolAtLocation(parameter, location);
    for (const property of type.getProperties()) {
      const name = property.getName();
      const entry = props.get(name) ?? { required: 0, types: new Set() };
      if (!(property.flags & ts.SymbolFlags.Optional)) entry.required++;
      const value = shortType(checker, checker.getTypeOfSymbolAtLocation(property, location), property.valueDeclaration);
      // A disabled prop in one overload should not conceal the overload using it.
      if (value !== "undefined" && value !== "never") entry.types.add(value);
      props.set(name, entry);
    }
  }
  const required = [], optional = [];
  for (const [name, { required: count, types }] of props) {
    if (!types.size) continue;
    (count === signatures.length ? required : optional).push([name, [...types].join(" | ")]);
  }
  return { required: Object.fromEntries(required), optional: Object.fromEntries(optional) };
}

/** Look up the authored contract using the same closed compiler host as check.
 * The virtual module inspects types without building the app or executing its code.
 */
export async function describeDataApp({ projectDir, pluginRoot, component, query } = {}) {
  const { projectRoot, pluginRoot: root, manifest } = await assertPrebuiltProject({ projectDir, pluginRoot });
  const { typescript: ts, declarations, createTypeScriptProgram } = await loadDataTypeScript({ pluginRoot: root });
  const { files, sources } = await readAuthoredSources(projectRoot);
  const view = join(projectRoot, "src/content/view.ts");
  if (!Object.hasOwn(files, view)) throw new Error("This lookup requires src/content/view.ts; use the public component reference for projects without it.");
  const input = typecheckInputs({ ts, declarations, projectRoot, files, sources, runtimeExports: manifest.artifacts.app.metadata.moduleExports });
  const lookup = join(projectRoot, ".data-check-virtual-types/describe.ts");
  files[lookup] = 'import type { View } from "../src/content/view.ts";\ntype Kit = typeof View;\ntype Queries = Parameters<typeof View.useQuery>[0];\n'
    + (query === undefined ? "" : `type Row = ReturnType<typeof View.useQuery<${JSON.stringify(query)}>>["rows"][number];\n`);
  const program = createTypeScriptProgram({ ...input, rootNames: [lookup, ...input.browserAmbient] });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(lookup);
  const aliases = new Map(source.statements.filter(ts.isTypeAliasDeclaration).map(node => [node.name.text, checker.getTypeFromTypeNode(node.type)]));
  const kit = aliases.get("Kit"), queryType = aliases.get("Queries");
  const components = kit.getProperties().map(symbol => symbol.getName()).filter(name => /^[A-Z]/.test(name));
  const queries = (queryType.isUnion() ? queryType.types : [queryType]).filter(type => type.isStringLiteral()).map(type => type.value);
  if (!components.length || !queries.length) throw new Error("Cannot resolve the typed View in src/content/view.ts. Run data-app.mjs check to inspect its declaration.");
  const result = {};
  if (component !== undefined) {
    const name = component.replace(/^View\./, "");
    if (!components.includes(name)) throw new Error(`Unknown component ${JSON.stringify(component)}. Available: ${components.join(", ")}.`);
    result.component = { name: "View." + name, ...describeProps(ts, checker, kit.getProperty(name), source) };
  }
  if (query !== undefined) {
    if (!queries.includes(query)) throw new Error(`Unknown query ${JSON.stringify(query)}. Available: ${queries.join(", ")}.`);
    const fields = aliases.get("Row").getProperties().map(symbol =>
      [symbol.getName(), checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, source), source, ts.TypeFormatFlags.InTypeAlias)]);
    result.query = { id: query, fields: Object.fromEntries(fields) };
  }
  if (component === undefined && query === undefined) return { components, queries };
  return result;
}
