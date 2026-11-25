import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { dirname, extname, join, posix, relative, resolve } from "node:path";
import { authoredModuleCandidates, compileAuthoredModules } from "./authored-module-graph.mjs";
import { assertPrebuiltProject, DEFAULT_PLUGIN_ROOT, loadPrebuiltCompiler } from "./data-app-runtime.mjs";
import { assertHydratedPublicationSource } from "./data-app-separate.mjs";
import { readRegularFile } from "./prebuilt/manifest.mjs";
import { loadDataTypeScript } from "./data-app-typecheck.mjs";
import { inspectDataEvidence } from "./data-app-evidence-check.mjs";
import { createStreamingJsonParser } from "../src/streaming-json.js";
import { inspectNarrativeTables } from "./narrative-table-check.mjs";

const CODE = /\.(?:[cm]?[jt]sx?)$/iu;
const STYLE = /\.(?:css|pcss|postcss)$/iu;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_FILES = 512;
const MAX_DIAGNOSTICS = 200;
const diagnostic = (code, message, extra = {}) => ({ severity: "error", code, message, ...extra });

// Validate every byte and every row's container, without retaining the dataset.
export async function readCheckSnapshot(projectRoot) {
  const filename = join(projectRoot, "src/data.json");
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("src/data.json must be a regular file.");
  const diagnostics = [];
  let rows = 0, bytes = 0;
  const parser = createStreamingJsonParser({
    discard: path => path.length >= 3 && path[0] === "queries" && path[2] === "rows",
    onValue({ path, value }) {
      if (path.length === 4 && path[0] === "queries" && path[2] === "rows" && typeof path[3] === "number") {
        rows++;
        if ((!value || typeof value !== "object" || Array.isArray(value)) && diagnostics.length < MAX_DIAGNOSTICS)
          diagnostics.push(diagnostic("DATA_ROW_INVALID", `Query ${JSON.stringify(path[1])}, row ${path[3]} must be an object.`, { file: filename, line: 1, column: 1 }));
      }
    },
  });
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  for await (const chunk of createReadStream(filename)) {
    bytes += chunk.length;
    parser.write(decoder.decode(chunk, { stream: true }));
  }
  parser.write(decoder.decode());
  return { snapshot: parser.finish(), rows, bytes, diagnostics };
}

export async function readAuthoredSources(projectRoot) {
  const files = {}, sources = new Map();
  let bytes = 0;
  async function visit(name) {
    for (const entry of await readdir(join(projectRoot, name), { withFileTypes: true })) {
      const path = `${name}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Authored source cannot contain symlinks: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && (CODE.test(path) || extname(path) === ".json")) {
        const info = await lstat(join(projectRoot, path));
        bytes += info.size;
        if (bytes > MAX_SOURCE_BYTES || Object.keys(files).length >= MAX_SOURCE_FILES)
          throw new Error("Offline typechecking supports at most 512 source/JSON modules and 16 MiB of source text under src/content.");
        const source = new TextDecoder("utf-8", { fatal: true }).decode(await readRegularFile(projectRoot, path));
        files[join(projectRoot, path)] = source;
        if (CODE.test(path)) sources.set(join(projectRoot, path), source);
      }
    }
  }
  await visit("src/content");
  return { files, sources };
}

export async function checkAuthoredNarratives({ projectRoot, pluginRoot, authored }) {
  const sources = new Map(await Promise.all(authored.codeFiles.map(async path => [join(projectRoot, path),
    new TextDecoder("utf-8", { fatal: true }).decode(await readRegularFile(projectRoot, path))])));
  const { typescript: ts, createTypeScriptProgram } = await loadDataTypeScript({ pluginRoot });
  return inspectNarrativeTables({ ts, createTypeScriptProgram, projectRoot, sources, resolvedImports: authored.resolvedImports });
}

export function typecheckInputs({ ts, declarations, projectRoot, files, sources, runtimeExports, snapshot, resolvedImports }) {
  const typeRoot = join(projectRoot, ".data-check-virtual-types");
  for (const [name, source] of Object.entries(declarations)) files[join(typeRoot, name)] = source;
  const moduleMap = Object.fromEntries(Object.entries({
    "@openai/data-app": "data-app-public.d.ts",
    react: "vendor/react/index.d.ts", "react/jsx-runtime": "vendor/react/jsx-runtime.d.ts",
    "react/jsx-dev-runtime": "vendor/react/jsx-dev-runtime.d.ts", csstype: "vendor/csstype/index.d.ts",
    "react-dom": "react-dom.d.ts", "react-dom/client": "react-dom-client.d.ts", "react-markdown": "react-markdown.d.ts",
  }).map(([name, path]) => [name, join(typeRoot, path)]));
  const publicFile = join(projectRoot, "src/data-app-public.jsx");
  moduleMap[posix.resolve("/", publicFile.replaceAll("\\", "/"))] = moduleMap["@openai/data-app"];
  const snapshotFile = join(projectRoot, "src/data.json");
  const snapshotType = join(typeRoot, "snapshot.d.ts");
  moduleMap[posix.resolve("/", snapshotFile.replaceAll("\\", "/"))] = snapshotType;
  files[snapshotType] = 'import type { DataSnapshot } from "./data-app-public"; declare const snapshot: DataSnapshot; export default snapshot;\n'
    + Object.keys(snapshot ?? {}).filter(name => !["default", "__esModule", "__proto__"].includes(name) && /^[a-z_$][\w$]*$/iu.test(name))
      .map(name => `export const ${name}: DataSnapshot[${JSON.stringify(name)}];`).join("\n");
  const assetType = join(typeRoot, "asset.d.ts"), styleType = join(typeRoot, "style.d.ts"), workerType = join(typeRoot, "worker.d.ts");
  files[assetType] = "declare const value: string; export default value;";
  files[styleType] = "export {};";
  files[workerType] = "declare const InlineWorker: {new(options?: WorkerOptions): Worker}; export default InlineWorker;";
  // Export existence is checked by the compiler. Raw Recharts is an explicitly
  // reported coverage boundary; the Data chart API has the checked contract.
  const rechartsType = join(typeRoot, "recharts.d.ts");
  files[rechartsType] = 'import type { ComponentType } from "react";\n' + (runtimeExports.recharts ?? [])
    .filter(name => !["default", "__esModule"].includes(name) && /^[a-z_$][\w$]*$/iu.test(name))
    .map(name => /^[A-Z]/u.test(name)
      ? `export const ${name}: ComponentType<Record<string, any>>;`
      : `export const ${name}: (...args: any[]) => any;`).join("\n");
  moduleMap.recharts = rechartsType;
  const resolutions = {}, workers = new Set(), warnings = [];
  for (const [filename, source] of sources) {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const imports = {};
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (specifier === "recharts") {
          const point = ast.getLineAndCharacterOfPosition(node.getStart(ast));
          warnings.push({ severity: "warning", code: "DATA_UNTYPED_RECHARTS", file: filename, line: point.line + 1, column: point.character + 1,
            message: "Raw Recharts exports are checked, but their props are not type-checked. Use Data Chart or EvidenceChart for checked chart options." });
        }
        if (specifier.startsWith(".")) {
          const [pathname, query = ""] = specifier.split("?");
          const resolvedTarget = resolvedImports?.[relative(projectRoot, filename).replaceAll("\\", "/")]?.[specifier];
          // describe runs before build. Resolve editable modules in the same
          // order as the bundler even when its compiled graph is unavailable.
          const requested = resolve(dirname(filename), decodeURIComponent(pathname.split("#")[0]));
          const target = resolvedTarget ? join(projectRoot, resolvedTarget)
            : authoredModuleCandidates(requested).find(candidate => Object.hasOwn(files, candidate)) ?? requested;
          if (target === publicFile) imports[specifier] = moduleMap["@openai/data-app"];
          else if (target === snapshotFile) imports[specifier] = snapshotType;
          else if (query === "worker&inline") { imports[specifier] = workerType; workers.add(target); }
          else if (query || STYLE.test(target) || (extname(target) && !CODE.test(target) && extname(target) !== ".json"))
            imports[specifier] = STYLE.test(target) && !query ? styleType : assetType;
          else if (resolvedTarget || Object.hasOwn(files, target)) imports[specifier] = target;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    resolutions[filename] = imports;
  }
  return { files, moduleMap, resolutions, workers, warnings, browserAmbient: [join(typeRoot, "react-style.d.ts")] };
}

/** Read-only preflight. No project code, configs or compiler plugins execute. */
export async function checkDataApp({ projectDir, pluginRoot = DEFAULT_PLUGIN_ROOT, state, authored } = {}) {
  const start = performance.now();
  const diagnostics = [], checks = [];
  let projectRoot = resolve(projectDir), fileCount = 0, rows = 0;
  try {
    assertHydratedPublicationSource(projectRoot);
    state ??= await assertPrebuiltProject({ projectDir, pluginRoot });
    projectRoot = state.projectRoot;
    checks.push("authored-boundary");
    const compiler = await loadPrebuiltCompiler({ pluginRoot: state.pluginRoot, manifest: state.manifest });
    authored ??= await compileAuthoredModules({ projectRoot, compiler, runtimeModuleExports: state.manifest.artifacts.app.metadata.moduleExports });
    checks.push("module-graph", "css");
    diagnostics.push(...authored.warnings.map(warning => ({ severity: "warning", code: warning.code, message: warning.message })));
    const snapshot = await readCheckSnapshot(projectRoot);
    rows = snapshot.rows;
    diagnostics.push(...snapshot.diagnostics);
    checks.push("snapshot");
    const { typescript: ts, checkTypeScript, createTypeScriptProgram, declarations } = await loadDataTypeScript({ pluginRoot: state.pluginRoot });
    const { files, sources } = await readAuthoredSources(projectRoot);
    const codeFiles = new Set(authored.codeFiles.map(path => join(projectRoot, path)));
    const reachable = new Map([...sources].filter(([name]) => codeFiles.has(name)));
    fileCount = reachable.size;
    const input = typecheckInputs({ ts, declarations, projectRoot, files, sources: reachable, runtimeExports: state.manifest.artifacts.app.metadata.moduleExports, snapshot: snapshot.snapshot, resolvedImports: authored.resolvedImports });
    diagnostics.push(...input.warnings);
    const roots = ["dashboard/DashboardContent.jsx", "report/ReportContent.jsx"].map(path => join(projectRoot, "src/content", path));
    const programs = [{ rootNames: [...roots, ...input.browserAmbient], environment: "browser" }, ...[...input.workers].map(root => ({ rootNames: [root], environment: "worker" }))];
    const seen = new Set();
    for (const program of programs) for (const item of checkTypeScript({ ...input, ...program })) {
      const next = { ...item, code: `TS${item.code}`, severity: item.category === "error" ? "error" : "warning" };
      delete next.category;
      const key = JSON.stringify(next);
      if (!seen.has(key)) { seen.add(key); diagnostics.push(next); }
    }
    checks.push("typescript");
    diagnostics.push(...inspectDataEvidence({ ts, sources: reachable, snapshot: snapshot.snapshot, projectRoot }));
    checks.push("literal-evidence");
    diagnostics.push(...inspectNarrativeTables({ ts, createTypeScriptProgram, sources: reachable, projectRoot, resolvedImports: authored.resolvedImports }));
    checks.push("narrative-tables");
  } catch (error) {
    diagnostics.push(diagnostic("DATA_CHECK_FAILED", error.message));
  }
  const errors = diagnostics.filter(item => item.severity === "error").length;
  return { schemaVersion: 1, status: errors ? "failed" : "passed", projectRoot,
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS), errors, warnings: diagnostics.length - errors,
    ...(diagnostics.length > MAX_DIAGNOSTICS ? { diagnosticsTruncated: true } : {}),
    checks, files: fileCount, rows, durationMs: Math.round(performance.now() - start),
    limitations: ["Rendering and browser interactions are not checked.", "Dynamic component IDs, query references, and derived data cannot always be proven statically.",
      "Narrative table checks follow static strings and literal-array map bindings; arbitrary helpers, runtime data, prop spreads, and saved edits require rendered inspection."] };
}

export function formatCheckResult(result) {
  const lines = result.diagnostics.map(item => `${item.file ? `${item.file}${item.line ? `:${item.line}:${item.column ?? 1}` : ""}: ` : ""}${item.severity} ${item.code}: ${item.message}`);
  lines.push(`Data check ${result.status}: ${result.errors} error(s), ${result.warnings} warning(s); ${result.files} authored modules, ${result.rows} reviewed rows (${result.durationMs}ms).`);
  if (result.diagnosticsTruncated) lines.push("Diagnostics truncated; fix these errors and run the checker again.");
  return lines.join("\n");
}
