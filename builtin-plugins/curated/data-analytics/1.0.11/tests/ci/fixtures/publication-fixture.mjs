import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const digest = contents => createHash("sha256").update(contents).digest("hex");
const write = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

// This small Worker double exercises the verifier's real bucket boundary. The
// Linux CI helper separately builds and loads the shipped Worker after hydration.
export const workerFactory = `function createDataAppWorker({ deploymentAssets, responseOverride }) {
  return { async fetch(_request, environment) {
    const asset = await environment.BUCKET.get(deploymentAssets.html.key);
    return new Response(responseOverride === undefined ? asset.body : responseOverride);
  } };
}`;

export function writePublicationFixture(projectRoot, { projectId = "appgprj_offline_fixture", responseOverride } = {}) {
  const htmlPath = join(projectRoot, "dist/index.html");
  const original = readFileSync(htmlPath, "utf8");
  const snapshot = JSON.parse(readFileSync(join(projectRoot, "src/data.json"), "utf8"));
  const html = original.replace("<head>", `<head><meta name="data-app-sites-project" content="${projectId}"><meta name="data-app-snapshot-storage" content="external-v1">`)
    .replace(/(<script id="data-app-reviewed-snapshot" type="application\/json">)[\s\S]*?(<\/script>)/u, "$1{}$2");
  const bytes = { html: Buffer.from(html), snapshot: Buffer.from(JSON.stringify(snapshot)) };
  const assetFiles = Object.fromEntries(["html", "snapshot"].map(kind => [kind,
    join(projectRoot, ".data-app-assets", kind === "html" ? "html.html" : "snapshot.json")]));
  const deploymentAssets = Object.fromEntries(Object.entries(bytes).map(([kind, contents]) => {
    const sha256 = digest(contents);
    return [kind, { key: `data-app/${kind}/${sha256}`, sha256, bytes: contents.length }];
  }));
  const offlineHtmlPath = join(projectRoot, ".data-app-offline/index.html");
  const serverPath = join(projectRoot, "dist/server/index.js");
  const assetManifestPath = join(projectRoot, ".data-app-assets/manifest.json");
  write(offlineHtmlPath, original);
  write(htmlPath, html);
  for (const kind of Object.keys(bytes)) write(assetFiles[kind], bytes[kind]);
  write(assetManifestPath, JSON.stringify({ version: 1, projectId, thinBootstrap: true,
    assets: Object.fromEntries(Object.entries(deploymentAssets).map(([kind, descriptor]) => [kind,
      { ...descriptor, path: kind === "html" ? "html.html" : "snapshot.json" }])),
    source: { htmlSha256: digest(original), offlineHtmlPath: ".data-app-offline/index.html" } }));
  write(serverPath, `${workerFactory}\nexport default createDataAppWorker(${JSON.stringify({ deploymentAssets, responseOverride })});\n`);
  const hosting = { ...JSON.parse(readFileSync(join(projectRoot, ".openai/hosting.json"), "utf8")), project_id: projectId, d1: "DB", r2: "BUCKET" };
  delete hosting.static;
  write(join(projectRoot, ".openai/hosting.json"), `${JSON.stringify(hosting, null, 2)}\n`);
  write(join(projectRoot, "dist/.openai/hosting.json"), JSON.stringify({ ...hosting,
    artifact_metadata: { surface: snapshot.surface ?? "dashboard", producer: "data-analytics" } }));
  return { projectRoot, projectId, htmlPath, serverPath, offlineHtmlPath, assetManifestPath, assetFiles,
    deploymentAssets, thinBootstrap: true, htmlSha256: digest(original), hostedHtmlSha256: deploymentAssets.html.sha256,
    snapshotSha256: deploymentAssets.snapshot.sha256, databaseBinding: "DB", assetBinding: "BUCKET" };
}
