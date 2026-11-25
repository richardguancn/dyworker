# Prebuilt Data runtime

The plugin ships browser-ready React/Data code and a small pure-JavaScript authoring compiler. Creating a customer dashboard does not install npm packages, download CDN code, extract a dependency tree, or load a native compiler. Vite, Rolldown, and Lightning CSS run at release time or in an explicitly selected `--source` build with compatible local dependencies; the default customer path does not invoke them or npm.

This directory is an intentionally standalone npm workspace. The canonical template's package lock supplies app dependency versions and tarball integrity. The compiler adds pinned browser Rollup, Sucrase, Acorn, and CSS Tree packages. A pinned, publisher-only Terser pass reduces raw inline JavaScript bytes after bundling; it is not shipped or installed for customer builds. Never refresh the canonical template's dependencies as a side effect of rebuilding.

## Rebuild

First refresh the canonical protected-runtime manifest through its maintainer workflow. If its dependency lock changed, refresh this release-only lock:

```sh
node output_formats/html/scripts/prebuilt/refresh-lock.mjs
```

Then build from a fresh frozen publisher installation:

```sh
node output_formats/html/scripts/prebuilt/build.mjs
node output_formats/html/scripts/prebuilt/build.mjs --check
node --test output_formats/html/scripts/prebuilt/*.test.mjs
```

The first two commands each make a private temporary workspace, run release-only `npm ci --ignore-scripts`, build, and remove that workspace. `--offline` restricts that publisher install to its existing npm cache. For an already-frozen publisher workspace, pass `--dependencies /absolute/path/to/workspace`; its package and lock must exactly match this directory. `--compiler-only` produces only the standalone compiler for local development and does not finalize a release manifest.

The default output is `assets/data-app-runtime/`. The manifest is written last and records exact artifact hashes/sizes and every protected/build source hash. `--check` rebuilds without changing the shipped assets and rejects any byte drift. Follow the owning package's release workflow for generated artifacts and publish only a verified candidate.

## Offline authoring check

`describe` looks up a component or query in the project's typed View. Call it before writing an unfamiliar block or formula. With no selectors it lists component names and query IDs. Combine `--component` and `--query` to get the required and optional props alongside the selected row fields in one JSON response. `K` in a prop signature is the query ID, and `Row<K>` is one of the rows listed for that query. Long types are abbreviated. The lookup inspects the authored contract with the offline TypeScript compiler and works for JSX and TSX without building the project or executing its code.

```sh
node output_formats/html/scripts/data-app.mjs describe --project-dir /absolute/report-project
node output_formats/html/scripts/data-app.mjs describe --project-dir /absolute/report-project --component Metric --query sales
```

```sh
node output_formats/html/scripts/data-app.mjs check --project-dir /absolute/report-project
node output_formats/html/scripts/data-app.mjs check --project-dir /absolute/report-project --watch --json
node output_formats/html/scripts/data-app.mjs build --project-dir /absolute/report-project --separate-data --check
```

`check` reuses the authored module graph and theme validation, then runs TypeScript semantic analysis and conservative literal evidence/chart checks. The existing standalone `chart-check.mjs` carries TypeScript, standard libraries, and the Data/React declarations, verified against `chart-assets.json`. It needs a supported Node runtime, no project dependencies, network, compiler plugins, or authored code execution. It reads neither `tsconfig.json` nor local `node_modules`, and writes no project or build artifacts. Ordinary prebuilt builds also run the focused [narrative table check](../../docs/components/tables/tables.md#report-scorecard); the remaining semantic checks require `--check`.

The result has `schemaVersion: 1`, `status`, structured `diagnostics` (severity, code, message, and file/line/column where available), error/warning counts, completed checks, and input counts. A failed one-shot check exits 1. Watch emits an initial result and debounced results after changes to `src/content/**`, `src/data.json`, or `src/theme.css`. It ignores generated output, cancels stale runs, and bounds each child to 512 MiB and 30 seconds. Watch output with `--json` is newline-delimited JSON; stop with Ctrl-C. Authored code/JSON modules are bounded to 512 files and 16 MiB; snapshots are streamed without retaining query rows for type inference.

Supported public Data and React props are typed. Raw Recharts exports are checked by the module graph but their props are not typed; a warning makes this gap explicit. Dynamic values, reviewed-data accuracy, rendered layout, and browser-only failures remain preview/runtime checks. JavaScript objects stored in variables may need a JSDoc `ChartSpec` annotation to preserve discriminant literals. The source declarations under `output_formats/html/scripts/types/` derive shared chart types from `skills/visualize-data/src/public-api.d.ts`; regenerate the checker through the pinned authoring build documented in `skills/visualize-data/CHART_RELEASES.md` after changing them.

## Artifact contract

- `app.js`: data-free IIFE defining `CodexDataAppRuntime`. Its manifest metadata records the exact own export names of the eight supported runtime modules, captured from the built IIFE at release time. The customer-side linker can therefore reject misspelled imports without evaluating browser code.
- `styles.css`, `print.css`: protected styles, kept separate so authored CSS retains its established ordering.
- `receipt.js`: data-free `CodexDataSourcesReceipt` IIFE for standalone answer provenance, using the same source inspector without the chart runtime. The release build verifies a complete receipt with 2,000 preview rows remains below 1 MB.
- `worker.mjs`: self-contained ESM with named `createDataAppWorker` and `validatePresentation` exports and no default export. The local `createDataAppWorker` binding is preserved so the Sites packager can append its sanitized per-artifact configuration and default export.
- `compiler.cjs`: dependency-free API version 1, exporting `rollup`, `transform`, `parseJavaScript`, `parseCss`, `walkCss`, `generateCss`, and `decodeCssIdentifier`. JSX uses the production automatic React runtime; TypeScript types are stripped, including in `.mts` modules. `commonjs: false` preserves ESM imports for the portable Rollup linker. Callers provide a closed virtual-module graph and call `generate()`, not filesystem-oriented `write()` or `watch()`. The single-file output inlines literal dynamic imports; their module side effects can run eagerly, so it is not an on-demand code-splitting runtime.
- `THIRD_PARTY_NOTICES.txt`: license texts for the exact frozen packages that contributed distributed code.

Two upstream npm packages omit their own license text from the published tarball. `license-overrides.json` supplies reviewed copies from immutable upstream commits, bound to the exact package tarball integrity and license hash. The builder also preserves licenses nested inside vendored packages. Missing or changed notices fail the release build; it never fetches licenses implicitly.

The source `buildInputsSha256` is SHA-256 of compact `JSON.stringify(buildInputs)`, where the plugin-relative map is sorted by path. No generated timestamp, publisher path, customer snapshot, authored component, or installation-specific data belongs in these shared assets.
