import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { chartRuntimePath } from "../../../scripts/plugin-paths.mjs";
import { writeComponentKit } from "./component-kit.mjs";
import { filterDefinitionDiagnostics } from "./filter-definition-diagnostics.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const appRoot = join(pluginRoot, "output_formats/html");
const excluded = new Set(["node_modules", "dist", ".git", ".data-plugin-version", "examples", "demos", "tests"]);
const surfaces = new Set(["dashboard", "report"]);

function contained(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function bundledPath(root, ref) {
  if (typeof ref !== "string" || isAbsolute(ref) || !contained(root, resolve(root, ref))) {
    throw new Error(`Invalid bundled path: ${ref}`);
  }
  const path = resolve(root, ref);
  for (let cursor = path; cursor !== root; cursor = dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Bundled symlinks are not supported: ${ref}`);
  }
  return path;
}

export function readCatalog(root = appRoot) {
  const catalogRoot = join(root, "examples");
  const catalog = JSON.parse(readFileSync(join(catalogRoot, "manifest.json"), "utf8"));
  const ids = new Set();
  if (catalog.version !== 1 || !Array.isArray(catalog.examples)) throw new Error("Unsupported example catalog.");
  for (const entry of catalog.examples) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) ||
      ids.has(entry.id) ||
      !Number.isInteger(entry.revision) ||
      entry.revision < 1 ||
      !["draft", "golden", "deprecated"].includes(entry.status)
    )
      throw new Error("Invalid example identity or status.");
    if (!surfaces.has(entry.kind ?? "dashboard"))
      throw new Error("Invalid example kind: expected dashboard or report.");
    ids.add(entry.id);
    for (const key of ["brief", "contract", "content", "fixture", "test"]) {
      const stat = lstatSync(bundledPath(catalogRoot, entry[key]));
      if (key === "content" ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Invalid ${key} resource type.`);
    }
    if (
      entry.status === "golden" &&
      (!entry.review?.approvedBy?.length || entry.review.approvedRevision !== entry.revision)
    )
      throw new Error("Golden examples require recorded review of the current revision.");
  }
  return catalog;
}

function copyContent(source, destination) {
  // The manifest cannot extend the authored boundary or replace the runtime.
  for (const item of readdirSync(source, { withFileTypes: true })) {
    if (!["dashboard", "report", "shared", "assets"].includes(item.name) || !item.isDirectory()) {
      throw new Error(`Unexpected authored root: ${item.name}`);
    }
  }
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      if (lstatSync(path).isSymbolicLink()) throw new Error("Authored content must not contain symlinks.");
      return true;
    },
  });
}

export async function readExampleFixture(entry, root = appRoot) {
  const path = bundledPath(join(root, "examples"), entry.fixture);
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  if (!path.endsWith(".mjs"))
    throw new Error("Example fixtures must be JSON or a bundled deterministic .mjs generator.");
  const generator = await import(pathToFileURL(path));
  if (typeof generator.fixture !== "function") throw new Error("Example generator must export fixture().");
  return generator.fixture();
}

/** Assemble the canonical scaffold into the same layout used by authored projects. */
export function assembleDataAppTemplate(root, destination, { blankContent = false } = {}) {
    cpSync(join(root, "templates"), destination, { recursive: true });
    cpSync(join(root, "src"), join(destination, "src"), {
      recursive: true,
      filter(path) {
        const rel = relative(join(root, "src"), path).split(sep).join("/");
        if ((blankContent && (rel === "data.json" || /^content\/(?:dashboard|report)(\/|$)/.test(rel)))) return false;
        if (lstatSync(path).isSymbolicLink()) throw new Error("Canonical starter contains a symlink.");
        return true;
      },
    });
    cpSync(join(root, "docs/components"), join(destination, "docs/components"), { recursive: true });
    cpSync(join(root, "scripts/template"), join(destination, "scripts"), { recursive: true });
    // Source builds get one protected snapshot of the shared UI library. The
    // normal compiler uses the embedded prebuilt runtime.
    const manifestPath = join(destination, "protected-runtime.json");
    const protectedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const pin = readFileSync(chartRuntimePath(resolve(root, "../.."), "assets/cdn.json"));
    writeFileSync(join(destination, "src/charting/cdn.json"), pin);
    protectedManifest.files["src/charting/cdn.json"] = createHash("sha256").update(pin).digest("hex");
    protectedManifest.files = Object.fromEntries(Object.entries(protectedManifest.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    writeFileSync(manifestPath, `${JSON.stringify(protectedManifest, null, 2)}\n`);
}

export async function prepareDataApp({
  output,
  surface = "dashboard",
  snapshot,
  example,
  fromReference,
  blank = false,
  allowDraft = false,
  makeReportContent,
  componentKit,
  legacyStarter = false,
  tsx,
  jsx = false,
  componentKitByline,
  root = appRoot,
}) {
  if (!surfaces.has(surface)) throw new Error("--surface must be dashboard or report.");
  if (!output || !isAbsolute(output)) throw new Error("--output must be an absolute, new project directory.");
  const destination = resolve(output);
  if (!existsSync(dirname(destination))) throw new Error("The output parent directory must already exist.");
  const physicalDestination = join(realpathSync(dirname(destination)), basename(destination));
  if (contained(realpathSync(pluginRoot), physicalDestination))
    throw new Error("Prepare projects outside the plugin source.");
  if (existsSync(destination)) throw new Error("Output already exists; revise existing data apps in place.");
  if (example && fromReference)
    throw new Error("Choose --example for a sample preview or --from-reference for adaptation, never both.");
  if (blank && (example || fromReference)) throw new Error("Choose --blank or a reference, never both.");
  componentKit ??= Boolean(tsx || jsx);
  if (legacyStarter && componentKit) throw new Error("Choose the component kit or --legacy-starter, not both.");
  if (componentKit && (example || fromReference || blank)) throw new Error("Choose the component kit without a reference or --blank.");
  if (tsx && jsx) throw new Error("Choose either --tsx or --jsx.");
  if ((tsx || jsx) && !componentKit) throw new Error("--tsx and --jsx select the component-kit language; omit the legacy, reference or blank starter option.");
  if (example && snapshot) throw new Error("Choose an example fixture or reviewed snapshot, never both.");
  if (fromReference && !snapshot) throw new Error("--from-reference requires --snapshot with reviewed data.");
  if (allowDraft && !example) throw new Error("--allow-draft requires --example.");
  const referenceId = fromReference || example;
  const catalog = blank || componentKit ? null : readCatalog(root);
  const entry = referenceId && catalog.examples.find(({ id }) => id === referenceId);
  if (referenceId && !entry) throw new Error(`Unknown example: ${referenceId}`);
  if (entry && (entry.kind ?? "dashboard") !== surface) {
    throw new Error(`Example ${entry.id} is for ${entry.kind ?? "dashboard"}, not ${surface}.`);
  }
  if (entry?.status === "deprecated" || (entry?.status === "draft" && !allowDraft)) {
    throw new Error("This example is not approved; draft previews require --allow-draft.");
  }
  const data = example
    ? await readExampleFixture(entry, root)
    : snapshot
      ? JSON.parse(readFileSync(snapshot, "utf8"))
      : { title: surface === "report" ? "Report" : "Dashboard", status: "draft", filters: [], queries: {} };
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !data.queries ||
    typeof data.queries !== "object" ||
    Array.isArray(data.queries)
  ) {
    throw new Error("Snapshot must contain a queries object.");
  }
  const filterErrors = filterDefinitionDiagnostics(data.filters);
  if (filterErrors.length) throw new Error(filterErrors.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  data.surface = surface;
  if (surface === "report") data.report ??= {};
  data.id = example ? `example:${entry.id}:r${entry.revision}` : `${surface}:${randomUUID()}`;
  data.buildStatus = example ? "complete" : "creating";
  if (
    data.exportPreferences != null &&
    (typeof data.exportPreferences !== "object" || Array.isArray(data.exportPreferences))
  ) {
    throw new Error("Export preferences must contain selected formats and verified plugin destinations.");
  }
  if (data.exportPreferences?.selected === undefined) {
    data.exportPreferences = {
      selected: null,
      destinations: data.exportPreferences?.destinations ?? [],
    };
  }
  delete data.buildOperation; // Discard the superseded operation field from imported snapshots.
  if (example) data.status = "fixture";
  const base = root;
  const sourcePluginRoot = resolve(root, "../..");
  let kit;
  mkdirSync(destination); // Exclusive: do not overwrite or merge any existing project.
  try {
    assembleDataAppTemplate(root, destination, { blankContent: true });
    copyContent(join(root, `starters/${surface}/content`), join(destination, "src/content"));
    if (entry) copyContent(bundledPath(join(root, "examples"), entry.content), join(destination, "src/content"));
    else if (!blank && !componentKit && surface === "report" && makeReportContent) {
      const content = join(destination, "src/content/report");
      cpSync(join(base, "src/content/report/report.css"), join(content, "report.css"));
      writeFileSync(join(content, "ReportContent.jsx"), makeReportContent(data));
    } else if (!blank && !componentKit)
      cpSync(join(base, `src/content/${surface}`), join(destination, `src/content/${surface}`), {
        recursive: true,
        filter(path) {
          if (lstatSync(path).isSymbolicLink()) throw new Error("Authored content must not contain symlinks.");
          return true;
        },
      });
    cpSync(join(root, "themes/codex-classic/theme.css"), join(destination, "src/theme.css"));
    writeFileSync(join(destination, "src/data.json"), `${JSON.stringify(data, null, 2)}\n`);
    if (componentKit) {
      if (surface === "report") cpSync(join(base, "src/content/report/report.css"), join(destination, "src/content/report/report.css"));
      kit = writeComponentKit(destination, data, componentKitByline, tsx ?? !jsx);
    }
  } catch (error) {
    rmSync(destination, { recursive: true, force: true }); // Only our newly created output.
    throw error;
  }
  return {
    output: destination,
    surface,
    id: data.id,
    example: example || null,
    status: example ? entry.status : "authored",
    built: false,
    documentation: {
      entryPoint: join(sourcePluginRoot, componentKit ? "output_formats/html/docs/components/component-kit.md" : "output_formats/html/docs/app-components.md"),
      referenceRoot: join(sourcePluginRoot, "output_formats/html/docs/components"),
      source: "installed-plugin",
    },
    starter: componentKit ? "component-kit" : entry ? entry.id : blank ? "blank" : makeReportContent && surface === "report" ? "report" : "base",
    ...(kit ? { componentKit: kit, editableFile: kit.entry } : {}),
    ...(surface === "report" ? { finishScript: join(root, "finish-report.mjs") } : {}),
    ...(makeReportContent && surface === "report" && !entry && !blank && !componentKit ? {
      editableFile: join(destination, "src/content/report/ReportContent.jsx"),
      componentFile: join(destination, "src/content/shared/ReportParts.jsx"),
      finishScript: join(root, "finish-report.mjs"),
      reviewedQueryIds: Object.keys(data.queries),
    } : {}),
    ...(surface === "dashboard" ? { authoringGuide: join(sourcePluginRoot, "skills/build-dashboard/SKILL.md") } : {}),
    ...(!example && !blank && !componentKit
      ? {
          needsAdaptation: true,
          referenceOptions: catalog.examples
            .filter(({ status, kind }) => status === "golden" && (kind ?? "dashboard") === surface)
            .map((reference) => ({
              id: reference.id,
              title: reference.title,
              decision: reference.decision,
              grain: reference.grain,
              composition: reference.composition,
              goodFit: reference.goodFit,
              brief: join(root, "examples", reference.brief),
              content: join(root, "examples", reference.content),
            })),
        }
      : {}),
    ...(fromReference ? { reference: entry.id, referenceRevision: entry.revision, needsAdaptation: true } : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        output: { type: "string" },
        surface: { type: "string" },
        snapshot: { type: "string" },
        example: { type: "string" },
        "from-reference": { type: "string" },
        blank: { type: "boolean" },
        "allow-draft": { type: "boolean" },
        "component-kit": { type: "boolean" },
        "legacy-starter": { type: "boolean" },
        tsx: { type: "boolean" },
        jsx: { type: "boolean" },
      },
    });
    console.log(
      JSON.stringify(
        await prepareDataApp({ ...values, componentKit: values["component-kit"], legacyStarter: values["legacy-starter"], fromReference: values["from-reference"], allowDraft: values["allow-draft"] }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
