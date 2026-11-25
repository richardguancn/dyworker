import { loadPrebuiltCompiler } from "../../../output_formats/html/scripts/data-app-runtime.mjs";

// Packaging runs this only for an explicitly authored live refresh adapter.
// Keep a closed two-module graph: server code never enters the browser bundle.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { worker, adapter, pluginRoot } = JSON.parse(input);
const compiler = await loadPrebuiltCompiler({ pluginRoot });
const bundle = await compiler.rollup({
  input: "worker",
  plugins: [{
    name: "data-refresh-worker",
    resolveId(id, importer) {
      if (!importer && id === "worker") return id;
      if (importer === "worker" && id === "data-refresh-adapter") return id;
      throw new Error("The refresh adapter must be one self-contained JavaScript module.");
    },
    resolveDynamicImport() { throw new Error("Refresh adapters cannot use dynamic imports."); },
    load(id) { return id === "worker" ? worker : adapter; },
  }],
});
try {
  const { output } = await bundle.generate({ format: "es", inlineDynamicImports: true });
  if (output.length !== 1 || output[0].type !== "chunk") throw new Error("Refresh must produce one Worker.");
  process.stdout.write(output[0].code);
} finally { await bundle.close(); }
