import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";

import { documentSnapshot, packageDataAppForSites } from "../skills/publish-artifact-to-sites/scripts/package-data-app-for-sites.mjs";
import { createDataAppWorker } from "../templates/data-app/base/src/data-app-worker.js";
import {
  fixture as packageFixture,
  packageDataApp,
  writeSnapshot,
} from "./data-app-sites-package-fixtures.mjs";

const siteId = "appgprj_reviewed";
const ownerEmail = "owner@example.com";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const publicationPaths = [
  "dist/index.html",
  "src/data.json",
  "src/data-app-owner.js",
  ".openai/hosting.json",
  "protected-runtime.json",
  "dist/.openai/hosting.json",
  "dist/server/index.js",
  ".data-app-assets/manifest.json", ".data-app-assets/html.html", ".data-app-assets/snapshot.json", ".data-app-offline/index.html",
];

function fixture(t) {
  const state = packageFixture();
  t.after(() => {
    rmSync(state.project, { recursive: true, force: true });
    rmSync(join(dirname(state.helperPath), "../../.."), { recursive: true, force: true });
  });
  return state;
}

function publicationBytes({ project }) {
  return publicationPaths.map((path) => (existsSync(join(project, path)) ? readFileSync(join(project, path)) : null));
}

function packageOutputBytes({ project }, includeHosting = true) {
  const paths = ["dist/server/index.js", "dist/.openai/hosting.json"];
  if (includeHosting) paths.push(".openai/hosting.json");
  return paths.map((path) => readFileSync(join(project, path)));
}

function packagedConfiguration({ project }) {
  const worker = readFileSync(join(project, "dist/server/index.js"), "utf8");
  const prefix = "\nexport default createDataAppWorker(JSON.parse(";
  const suffix = "));\n";
  assert.ok(worker.endsWith(suffix));
  const offset = worker.lastIndexOf(prefix);
  assert.ok(offset >= 0);
  return JSON.parse(JSON.parse(worker.slice(offset + prefix.length, -suffix.length)));
}

function packagedHtml(state) { return readFileSync(join(state.project, ".data-app-assets/html.html"), "utf8"); }
function packagedSnapshot(state) { return JSON.parse(readFileSync(join(state.project, ".data-app-assets/snapshot.json"), "utf8")); }
function assetEnvironment(state) {
  const manifest = JSON.parse(readFileSync(join(state.project, ".data-app-assets/manifest.json"), "utf8"));
  return { BUCKET: { async get(key) {
    const asset = Object.values(manifest.assets).find(asset => asset.key === key);
    if (!asset) return null;
    const bytes = readFileSync(join(state.project, ".data-app-assets", asset.path));
    return { body: new Response(bytes).body, size: bytes.length, customMetadata: { sha256: asset.sha256 }, async json() { return JSON.parse(bytes); } };
  } } };
}

function packageWorker(state, options) {
  const result = JSON.parse(packageDataApp(state, options));
  const configuration = packagedConfiguration(state);
  // Exercise the real editing backend with the package's serialized inputs.
  // Its focused authorization/presentation suite also tests every request path.
  const worker = createDataAppWorker(configuration), assets = assetEnvironment(state);
  return { result, configuration, worker: { fetch: (request, environment) => worker.fetch(request, { ...assets, ...environment }) } };
}

function database() {
  let presentation = null;
  return {
    DATA_APP_OWNER_EMAIL_SHA256: digest(ownerEmail),
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...args) {
            values = args;
            return this;
          },
          async run() {
            if (sql.startsWith("INSERT INTO data_app_presentation_v1") && !presentation) {
              const [, presentation_json, revision, updated_at] = values;
              presentation = { presentation_json, revision, updated_at };
            }
            if (sql.startsWith("UPDATE data_app_presentation_v1")) {
              const [presentation_json, updated_at, , revision] = values;
              if (presentation.revision !== revision) return { meta: { changes: 0 } };
              presentation = { presentation_json, revision: revision + 1, updated_at };
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            return presentation;
          },
        };
      },
    },
  };
}

function request(path, email, init = {}) {
  return new Request(`https://dashboard.chatgpt.site${path}`, {
    ...init,
    headers: { ...(email ? { "oai-authenticated-user-email": email } : {}), ...init.headers },
  });
}

const mutation = (presentation, revision = 0) => ({
  method: "PUT",
  body: JSON.stringify({ presentation, revision }),
});

function embeddedPage(snapshot) {
  return (
    '<!doctype html><html><head><meta name="data-app-runtime-sha256" content="previous-runtime">' +
    '<meta name="data-app-snapshot-sha256" content="stale-marker">' +
    '<meta name="data-app-local-thread" content="local-preview-reference"></head><body>' +
    `<script type="application/json" id="data-app-reviewed-snapshot">${JSON.stringify(snapshot)}</script>` +
    "<main>Exact café — reviewed page</main></body></html>"
  );
}

const hostedHtml = (html) => html.replace('<meta name="data-app-local-thread" content="local-preview-reference">', "")
  .replace(/(<head[^>]*>)/iu, `$1<meta name="data-app-sites-project" content="${siteId}">`);

test("retired capture inputs fail before replacing publication outputs", (t) => {
  const state = fixture(t);
  packageDataApp(state);
  const before = publicationBytes(state);
  assert.throws(() => packageDataApp(state, { extra: ["--capture-file", "manifest.json"] }), /Unknown option '--capture-file'/u);
  assert.throws(() => packageDataAppForSites({
    "project-dir": state.project, "project-id": siteId, "capture-file": "manifest.json",
  }), /Unsupported publication option: --capture-file/u);
  assert.deepEqual(publicationBytes(state), before);
});

test("linear document inspection handles large embedded rows and ignores inert marker examples", () => {
  const snapshot = { queries: { reviewed: { rows: Array.from({ length: 30_000 }, (_, index) => ({ index, title: "İstanbul — reviewed", note: "x".repeat(220) })) } } };
  const page = embeddedPage(snapshot);
  const noise = `<script>${"/* compiled runtime */".repeat(800_000)}</script>`;
  const html = page.replace("</head>", `${noise}</head>`);
  assert.ok(html.length > 20_000_000);
  assert.deepEqual(JSON.parse(documentSnapshot(html).embedded), snapshot);
  const marker = `<meta content='${"A".repeat(64)}' name='data-app-snapshot-sha256'>`;
  const ignored = `<!--${marker}--><script>const sample='${marker}';</script><template><template>${marker}</template></template>`;
  const source = `<!doctype html><html><head data-title="İstanbul >">${ignored}${marker}</head><body>${marker}${ignored}</body></html>`;
  assert.deepEqual(documentSnapshot(source), { embedded: undefined, hashes: ["a".repeat(64)] });
  assert.deepEqual(documentSnapshot(`<head>${marker}${marker}</head>`).hashes, ["a".repeat(64), "a".repeat(64)]);
  assert.deepEqual(documentSnapshot(`<head>${marker.replace(" name=", " name='other' name=")}</head>`).hashes, [null]);
  assert.deepEqual(documentSnapshot(`<head>${ignored}</head><body>${marker}</body>`).hashes, []);
});

test("publishes the exact compiled page and its embedded data without rebuilding or running authoring checks", async (t) => {
  const state = fixture(t);
  const snapshot = {
    id: "reviewed-app",
    generatedAt: "2026-08-31T12:00:00Z",
    queries: {
      reviewed: {
        rows: [{ week: "2026-08-31", value: 12 }],
        source: {
          sql: "SELECT * FROM sessions s JOIN events e ON s.session_id = e.session_id",
          reviewNote: "Reviewed query metadata",
          localPath: "/Users/test/example.csv",
        },
      },
    },
  };
  const html = embeddedPage(snapshot);
  writeFileSync(join(state.project, "dist/index.html"), html);
  writeFileSync(join(state.project, "src/data.json"), "Unfinished source edit; not the compiled snapshot");
  writeFileSync(
    join(state.project, "src/presentation-state.js"),
    'throw new Error("Do not execute copied validators");',
  );
  rmSync(join(state.project, "node_modules"), { recursive: true, force: true });
  const sourceBefore = publicationBytes(state).slice(0, 5);
  const { result, configuration, worker } = packageWorker(state, { environment: { ...process.env, PATH: "" } });
  assert.equal(result.buildMode, "existing-page");
  assert.equal(result.snapshotSource, "compiled-html");
  assert.equal(result.htmlSha256, digest(html));
  assert.equal(result.scanStats.complete, true);
  assert.ok(result.scanStats.inspectedTextUnits >= html.length);
  assert.ok(result.scanStats.fieldsVisited > 0);
  assert.ok(result.scanStats.elapsedMs >= 0);
  assert.ok(Object.values(result.scanStats).every((value) =>
    typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))));
  assert.equal(configuration.projectId, siteId);
  assert.equal(packagedHtml(state), hostedHtml(html));
  assert.deepEqual(packagedSnapshot(state), snapshot);
  assert.equal(await (await worker.fetch(request("/"), {})).text(), hostedHtml(html));
  // Source, reviewed HTML, owner module, and protected-runtime manifest stay untouched.
  const after = publicationBytes(state);
  for (const index of [0, 1, 2, 4]) assert.deepEqual(after[index], sourceBefore[index]);
  assert.equal(existsSync(join(state.project, ".test-source-verified")), false);
  assert.equal(existsSync(join(state.project, ".test-runtime-verified")), false);
  assert.equal(existsSync(join(state.project, "node_modules")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(state.project, "dist/.openai/hosting.json"))), {
    d1: "DB",
    r2: "BUCKET",
    project_id: siteId,
    artifact_metadata: { surface: "dashboard", producer: "data-analytics" },
  });
});

test("uses the compiled report surface for deployed attribution without adding it to source hosting", (t) => {
  const state = fixture(t);
  writeFileSync(join(state.project, "dist/index.html"), embeddedPage({ surface: "report", queries: {} }));
  packageDataApp(state);
  assert.equal(JSON.parse(readFileSync(join(state.project, ".openai/hosting.json"))).artifact_metadata, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(state.project, "dist/.openai/hosting.json"))).artifact_metadata, {
    surface: "report", producer: "data-analytics",
  });
});

test("rejects unapproved compiled artifact surfaces before changing publication files", async (t) => {
  for (const surface of [null, "customer-authored-value", { customer_content: "secret" }]) {
    await t.test(JSON.stringify(surface), (t) => {
      const state = fixture(t);
      writeFileSync(join(state.project, "dist/index.html"), embeddedPage({ surface, queries: {} }));
      const before = publicationBytes(state);
      assert.throws(() => packageDataApp(state), /surface must be dashboard or report/u);
      assert.deepEqual(publicationBytes(state), before);
    });
  }
});

test("legacy HTML falls back to existing source data and never alters the compiled page", (t) => {
  const state = fixture(t);
  const html = readFileSync(join(state.project, "dist/index.html"), "utf8");
  const source = JSON.parse(readFileSync(join(state.project, "src/data.json"), "utf8"));
  const { result, configuration } = packageWorker(state);
  assert.equal(result.snapshotSource, "src/data.json");
  assert.deepEqual(packagedSnapshot(state), source);
  assert.equal(packagedHtml(state), hostedHtml(html));
  assert.equal(readFileSync(join(state.project, "dist/index.html"), "utf8"), html);
});

test("legacy source replacement decoding preserves canonical bytes and the original source fingerprint", t => {
  const state = fixture(t);
  const bytes = Buffer.concat([Buffer.from('{"queries":{"q":{"rows":[{"label":"'), Buffer.from([0xc3]), Buffer.from('"}]}},"title":"Reviewed"}')]);
  writeSnapshot(state, bytes);
  const before = readFileSync(join(state.project, "src/data.json"));
  const result = JSON.parse(packageDataApp(state));
  assert.deepEqual(packagedSnapshot(state), JSON.parse(bytes.toString()));
  assert.equal(result.snapshotSha256, digest(JSON.stringify(JSON.parse(bytes.toString()))));
  assert.deepEqual(readFileSync(join(state.project, "src/data.json")), before);
});

test("legacy snapshot markers accept HTML attribute order, whitespace, and case variations", (t) => {
  const state = fixture(t);
  const snapshotBytes = Buffer.from('{\n  "queries": {}, "title": "Café — reviewed"\n}\n');
  writeSnapshot(state, snapshotBytes);
  const hash = digest(snapshotBytes).toUpperCase();
  const html = `<!doctype html><HTML><HEAD>\n<META\nCONTENT = '${hash}' NAME = DATA-APP-SNAPSHOT-SHA256>\n</HEAD><BODY>Reviewed</BODY></HTML>`;
  writeFileSync(join(state.project, "dist/index.html"), html);
  const { configuration } = packageWorker(state);
  assert.equal(packagedHtml(state), hostedHtml(html));
  assert.deepEqual(packagedSnapshot(state), JSON.parse(snapshotBytes));
});

test("legacy publication rejects missing, mismatched, duplicate, and spoofed snapshot markers before writing", (t) => {
  const cases = [
    ["missing", () => "<html><head></head><body>Reviewed</body></html>"],
    [
      "mismatched",
      () => '<html><head><meta name="data-app-snapshot-sha256" content="' + "0".repeat(64) + '"></head></html>',
    ],
    ["duplicate", (marker) => `<html><head>${marker}${marker}</head></html>`],
    ["comment", (marker) => `<html><head><!-- ${marker} --></head></html>`],
    ["script", (marker) => `<html><head><script>const marker = '${marker}';</script></head></html>`],
    ["style", (marker) => `<html><head><style>/* ${marker} */</style></head></html>`],
    ["template", (marker) => `<html><head><template>${marker}</template></head></html>`],
    ["body", (marker) => `<html><head></head><body>${marker}</body></html>`],
    ["implicit body element", (marker) => `<html><head><div>Reviewed</div>${marker}</html>`],
    ["implicit body text", (marker) => `<html><head>Reviewed${marker}</html>`],
    ["reopened head", (marker) => `<html><head></head><body><head>${marker}</head></body></html>`],
    [
      "fake embedded snapshot",
      () =>
        '<html><head></head><body><!-- <script id="data-app-reviewed-snapshot">{"queries":{}}</script> --></body></html>',
    ],
    ["quoted attribute", (marker) => `<html><head><meta title='${marker}'></head></html>`],
    ["lookalike attribute", (marker) => `<html><head>${marker.replace(" name=", " data-name=")}</head></html>`],
    [
      "duplicate name attribute",
      (marker) => `<html><head>${marker.replace(" name=", ' name="other" name=')}</head></html>`,
    ],
  ];
  for (const [label, page] of cases) {
    const state = fixture(t);
    packageDataApp(state);
    const hash = digest(readFileSync(join(state.project, "src/data.json")));
    const marker = `<meta name="data-app-snapshot-sha256" content="${hash}">`;
    writeFileSync(join(state.project, "dist/index.html"), page(marker));
    const before = packageOutputBytes(state);
    assert.throws(() => packageDataApp(state), /snapshot|reviewed data/iu, label);
    assert.deepEqual(packageOutputBytes(state), before, label);
  }
});

test("legacy consistency compares raw source bytes rather than parsed JSON equivalence", (t) => {
  const state = fixture(t);
  packageDataApp(state);
  const snapshotPath = join(state.project, "src/data.json");
  writeFileSync(snapshotPath, `${readFileSync(snapshotPath, "utf8")}\n`);
  const before = packageOutputBytes(state);
  assert.throws(() => packageDataApp(state), /snapshot|reviewed data/iu);
  assert.deepEqual(packageOutputBytes(state), before);
});

test("embedded snapshots publish without a source snapshot or a matching legacy marker", (t) => {
  const state = fixture(t);
  const snapshot = { title: "Reviewed embedded page", queries: {} };
  const html = embeddedPage(snapshot);
  writeFileSync(join(state.project, "dist/index.html"), html);
  rmSync(join(state.project, "src/data.json"));
  const { result, configuration } = packageWorker(state);
  assert.equal(result.snapshotSource, "compiled-html");
  assert.deepEqual(packagedSnapshot(state), snapshot);
  assert.equal(packagedHtml(state), hostedHtml(html));
});

test("invalid snapshot metadata fails before replacing existing publication outputs", (t) => {
  const state = fixture(t);
  packageDataApp(state);
  writeFileSync(join(state.project, "dist/index.html"), embeddedPage(null));
  const before = packageOutputBytes(state);
  assert.throws(() => packageDataApp(state));
  assert.deepEqual(packageOutputBytes(state), before);
});

test("an explicitly selected compiled HTML file is packaged without replacing the default page", (t) => {
  const state = fixture(t);
  const before = readFileSync(join(state.project, "dist/index.html"));
  const selected = embeddedPage({ queries: {}, title: "Selected reviewed page" });
  writeFileSync(join(state.project, "dist/selected.html"), selected);
  const { configuration } = packageWorker(state, { extra: ["--html-file", "dist/selected.html"] });
  assert.equal(packagedHtml(state), hostedHtml(selected));
  assert.equal(packagedSnapshot(state).title, "Selected reviewed page");
  assert.deepEqual(readFileSync(join(state.project, "dist/index.html")), before);
});

test("HTML and presentation inputs cannot select unrelated files by absolute or parent-relative paths", (t) => {
  for (const selected of ["html", "presentation"]) {
    for (const absolute of [true, false]) {
      const state = fixture(t);
      packageDataApp(state);
      const outside = mkdtempSync(join(tmpdir(), "data-publish-input-"));
      t.after(() => rmSync(outside, { recursive: true, force: true }));
      const file = join(outside, selected === "html" ? "unrelated.html" : "unrelated.json");
      copyFileSync(join(state.project, selected === "html" ? "dist/index.html" : "presentation.json"), file);
      const selectedPath = absolute ? file : relative(state.project, file);
      const options =
        selected === "html" ? { extra: ["--html-file", selectedPath] } : { presentationPath: selectedPath };
      const before = packageOutputBytes(state);
      assert.throws(() => packageDataApp(state, options), /inside|within|outside|contain/iu);
      assert.deepEqual(packageOutputBytes(state), before);
    }
  }
});

test("publication inputs reject outward symlinks without changing existing output", (t) => {
  for (const input of ["dist/index.html", "src/data.json", "presentation.json", ".openai/hosting.json"]) {
    const state = fixture(t);
    packageDataApp(state);
    const outside = mkdtempSync(join(tmpdir(), "data-publish-linked-input-"));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    const target = join(outside, "input");
    copyFileSync(join(state.project, input), target);
    rmSync(join(state.project, input));
    symlinkSync(target, join(state.project, input));
    const before = packageOutputBytes(state);
    const unrelated = readFileSync(target);
    assert.throws(() => packageDataApp(state), /inside|within|outside|contain|symlink/iu, input);
    assert.deepEqual(packageOutputBytes(state), before, input);
    assert.deepEqual(readFileSync(target), unrelated, input);
  }
});

test("publication inputs must be regular files", (t) => {
  for (const input of ["dist/index.html", "src/data.json", "presentation.json", ".openai/hosting.json"]) {
    const state = fixture(t);
    packageDataApp(state);
    rmSync(join(state.project, input));
    mkdirSync(join(state.project, input));
    const before = packageOutputBytes(state, input !== ".openai/hosting.json");
    assert.throws(() => packageDataApp(state), /regular file/iu, input);
    assert.deepEqual(packageOutputBytes(state, input !== ".openai/hosting.json"), before, input);
  }
});

test("input symlinks contained in the project preserve the selected page and snapshot", (t) => {
  const state = fixture(t);
  const html = readFileSync(join(state.project, "dist/index.html"), "utf8");
  const snapshot = JSON.parse(readFileSync(join(state.project, "src/data.json"), "utf8"));
  mkdirSync(join(state.project, "reviewed"));
  for (const [input, target] of [
    ["dist/index.html", "reviewed/page.html"],
    ["src/data.json", "reviewed/snapshot.json"],
    ["presentation.json", "reviewed/presentation.json"],
  ]) {
    copyFileSync(join(state.project, input), join(state.project, target));
    rmSync(join(state.project, input));
    symlinkSync(join(state.project, target), join(state.project, input));
  }
  const { configuration } = packageWorker(state);
  assert.equal(packagedHtml(state), hostedHtml(html));
  assert.deepEqual(packagedSnapshot(state), snapshot);
  assert.equal(configuration.initialPresentation.title, "Reviewed Data app");
});

test("the selected project directory may itself be a symlink", (t) => {
  const state = fixture(t);
  const links = mkdtempSync(join(tmpdir(), "data-publish-project-link-"));
  t.after(() => rmSync(links, { recursive: true, force: true }));
  const projectLink = join(links, "project");
  symlinkSync(state.project, projectLink);
  const linked = { ...state, project: projectLink };
  const { result, configuration } = packageWorker(linked);
  assert.equal(result.projectRoot, state.project);
  assert.equal(configuration.initialPresentation.title, "Reviewed Data app");
});

test("detected credentials fail before replacing output and are not copied into the error", (t) => {
  const state = fixture(t);
  packageDataApp(state);
  const secret = "synthetic-publication-credential-never-echo";
  for (const query of [
    { rows: [{ api_key: secret }] },
    { source: { authToken: secret }, rows: [] },
    { source: { url: `https://example.test/data#access_token=${secret}` }, rows: [] },
    { source: { url: `https://example.test/data?key=${secret}` }, rows: [] },
    { source: { url: `https://example.test/token/${secret}` }, rows: [] },
  ]) {
    const html = embeddedPage({ queries: { reviewed: query } });
    writeFileSync(join(state.project, "dist/index.html"), html);
    const before = publicationBytes(state);
    assert.throws(
      () => packageDataApp(state),
      (error) => {
        const report = `${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`;
        assert.match(report, /secret|credential/iu);
        assert.equal(report.includes(secret), false);
        return true;
      },
    );
    assert.deepEqual(publicationBytes(state), before);
  }
});

test("inline CSS and SVG preserve clean assets and reject credentials before replacing output", async (t) => {
  const state = fixture(t);
  copyFileSync(
    new URL("../assets/data-app-runtime/worker.mjs", import.meta.url),
    join(dirname(state.helperPath), "../../../assets/data-app-runtime/worker.mjs"),
  );
  const base64 = (value) => Buffer.from(value).toString("base64");
  const svg = (content) => `<svg xmlns="http://www.w3.org/2000/svg"><g id="icon">${content}</g></svg>`;
  const cleanCss = ".fixture { color: blue; }";
  const cleanSvg = svg('<rect width="8" height="8" fill="blue"/>');
  const page = (mime, content, fragment = "") => embeddedPage({ queries: {} }).replace(
    "</head>",
    `<style>.fixture{background-image:url(data:image/svg+xml;base64,${base64(cleanSvg)});` +
      `--asset:url(data:${mime};base64,${base64(content)}${fragment})}</style></head>`,
  );
  const cleanHtml = page("text/css", cleanCss);
  writeFileSync(join(state.project, "dist/index.html"), cleanHtml);
  packageDataApp(state);
  const emitted = readFileSync(join(state.project, "dist/server/index.js"), "utf8");
  const { default: worker } = await import(`data:text/javascript;base64,${base64(emitted)}`);
  const response = await worker.fetch(request("/", "viewer@example.com"), assetEnvironment(state));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), hostedHtml(cleanHtml));

  const secret = "INERT_TEST_BEARER_VALUE_1234567890";
  const credentialUrl = `https://example.test/image?token=${secret}`;
  const cases = [
    ["CSS literal", "text/css", `.fixture { --note: "Bearer ${secret}"; }`],
    ["CSS URL parameter", "text/css", `.fixture { background-image: url("${credentialUrl}"); }`],
    ["SVG literal", "image/svg+xml", svg(`<metadata>Bearer ${secret}</metadata>`), "#icon"],
    ["SVG URL parameter", "image/svg+xml", svg(`<image href="${credentialUrl}"/>`), "#icon"],
  ];
  for (const [label, mime, content, fragment] of cases) {
    await t.test(label, () => {
      writeFileSync(join(state.project, "dist/index.html"), page(mime, content, fragment));
      const before = publicationBytes(state);
      assert.throws(
        () => packageDataApp(state),
        (error) => {
          const report = `${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`;
          assert.match(report, /secret|credential/iu);
          for (const payload of [secret, content, base64(content)]) assert.equal(report.includes(payload), false);
          return true;
        },
      );
      assert.deepEqual(publicationBytes(state), before);
    });
  }
});

test("configuration serialization preserves special property names and script-like strings as data", (t) => {
  const state = fixture(t);
  const snapshot = JSON.parse(
    '{"queries":{"__proto__":{"rows":[{"constructor":"</script><script>fixture</script>","value":"  "}]}}}',
  );
  // These values are in the source snapshot, not inside an HTML raw-text element.
  writeSnapshot(state, snapshot);
  const { configuration } = packageWorker(state);
  assert.deepEqual(packagedSnapshot(state), snapshot);
  assert.equal(Object.hasOwn(packagedSnapshot(state).queries, "__proto__"), true);
});

test("direct publication needs no copied owner module, protected manifest, verifier, or local dependencies", (t) => {
  const state = fixture(t);
  for (const path of ["src/data-app-owner.js", "protected-runtime.json", "scripts", "node_modules"]) {
    rmSync(join(state.project, path), { recursive: true, force: true });
  }
  const { result } = packageWorker(state, { environment: { ...process.env, PATH: "" } });
  assert.equal(result.ownerEnvironmentVariable, "DATA_APP_OWNER_EMAIL_SHA256");
  for (const path of ["src/data-app-owner.js", "protected-runtime.json", "scripts", "node_modules"]) {
    assert.equal(existsSync(join(state.project, path)), false);
  }
});

test("packaged presentation handoff keeps shared editing, revision conflicts, and viewer isolation", async (t) => {
  const state = fixture(t);
  const presentation = {
    theme: "original",
    appearance: "system",
    title: "Reviewed title",
    filters: { lane: "All non-VIP" },
    blockLayouts: {
      canvas: {
        order: ["trend", "metric"],
        rows: [{ id: "overview", items: ["trend", "metric"] }],
        spans: { trend: 8, metric: 4 },
      },
    },
  };
  const file = join(state.project, "presentation.json");
  const transport = { ...presentation, filterDefinitions: [{ id: "transport-only" }] };
  writeFileSync(file, JSON.stringify(transport));
  const { configuration, worker } = packageWorker(state);
  const expectedPresentation = {
    hiddenBlocks: [], componentTitles: {}, textEdits: {}, chartOverrides: {}, ...presentation,
  };
  assert.deepEqual(configuration.initialPresentation, expectedPresentation);
  assert.deepEqual(JSON.parse(readFileSync(file)), transport);
  const env = database();
  const initial = await (await worker.fetch(request("/api/presentation", ownerEmail), env)).json();
  assert.equal(initial.canEdit, true);
  assert.deepEqual(initial.presentation, expectedPresentation);
  for (const viewer of [undefined, "another-viewer@example.com"]) {
    assert.equal((await (await worker.fetch(request("/api/presentation", viewer), env)).json()).canEdit, false);
    assert.equal(
      (await worker.fetch(request("/api/presentation", viewer, mutation({ title: "viewer edit" })), env)).status,
      403,
    );
    assert.equal(
      (
        await worker.fetch(
          request("/api/queries/reviewed", viewer, { method: "PUT", body: JSON.stringify({ rows: [] }) }),
          env,
        )
      ).status,
      403,
    );
  }
  assert.equal(
    (await worker.fetch(request("/api/presentation", ownerEmail, mutation({ title: "Owner edit" })), env)).status,
    200,
  );
  assert.equal(
    (await worker.fetch(request("/api/presentation", ownerEmail, mutation({ title: "Stale edit" })), env)).status,
    409,
  );
});

test("full and compact presentation handoffs produce identical seeds and fresh hosted state", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-05T12:00:00Z") });
  const state = fixture(t);
  const shared = {
    theme: "original", appearance: "system", title: "Reviewed compact handoff",
    filters: {}, assumptions: { activationLift: 0 },
    tabs: [{ id: "dashboard", label: "Dashboard" }],
  };
  const emptyCollections = { hiddenBlocks: [], componentTitles: {}, textEdits: {}, chartOverrides: {} };
  const variants = [
    { full: { ...shared, ...emptyCollections }, compact: shared },
    {
      full: { ...shared, ...emptyCollections, componentTitles: { trend: "Reviewed trend" } },
      compact: { ...shared, componentTitles: { trend: "Reviewed trend" } },
    },
    {
      full: { ...shared, ...emptyCollections, hiddenBlocks: ["internal-note"], textEdits: { caption: "" },
        chartOverrides: { trend: { type: "bar" } } },
      compact: { ...shared, hiddenBlocks: ["internal-note"], textEdits: { caption: "" },
        chartOverrides: { trend: { type: "bar" } } },
    },
  ];
  const file = join(state.project, "presentation.json");
  for (const surface of ["dashboard", "report"]) {
    writeFileSync(join(state.project, "dist/index.html"), embeddedPage({ surface, queries: {} }));
    const reviewedBefore = publicationBytes(state).slice(0, 3);
    for (const { full, compact } of variants) {
      writeFileSync(file, JSON.stringify(full));
      const original = packageWorker(state);
      const originalRecord = await (await original.worker.fetch(request("/api/presentation", ownerEmail), database())).json();
      writeFileSync(file, JSON.stringify(compact));
      const cleaned = packageWorker(state);
      const cleanedRecord = await (await cleaned.worker.fetch(request("/api/presentation", ownerEmail), database())).json();
      assert.deepEqual(cleaned.configuration, original.configuration);
      assert.deepEqual(cleaned.configuration.initialPresentation, full);
      assert.deepEqual(cleanedRecord, originalRecord);
      assert.deepEqual(cleanedRecord, { presentation: full, revision: 0,
        updatedAt: "2026-09-05T12:00:00.000Z", canEdit: true, ownerEnvironmentConfigured: true });
      assert.deepEqual(JSON.parse(readFileSync(file)), compact, "Packaging must not rewrite handoff inputs");
      assert.deepEqual(publicationBytes(state).slice(0, 3), reviewedBefore);
    }
  }
});

test("omitting the presentation file keeps the existing empty seed contract", async (t) => {
  const state = fixture(t);
  const { configuration, worker } = packageWorker(state, { presentationPath: null });
  assert.deepEqual(configuration.initialPresentation, {});
  const record = await (await worker.fetch(request("/api/presentation", ownerEmail), database())).json();
  assert.deepEqual(record.presentation, {});
  assert.equal(record.revision, 0);
  assert.equal(record.canEdit, true);
});

test("compact seed restoration preserves malformed explicit values for the editing validator", (t) => {
  const state = fixture(t);
  const file = join(state.project, "presentation.json");
  for (const [key, invalidValues] of [
    ["hiddenBlocks", [null, {}, [7]]],
    ["componentTitles", [null, [], { trend: "" }]],
    ["textEdits", [null, [], { caption: false }]],
    ["chartOverrides", [null, [], { trend: { rows: [] } }]],
  ]) {
    for (const value of invalidValues) {
      writeFileSync(file, JSON.stringify({ [key]: value }));
      packageDataApp(state);
      const configuration = packagedConfiguration(state);
      assert.deepEqual(configuration.initialPresentation[key], value);
      assert.throws(() => createDataAppWorker(configuration), /Hidden blocks|bounded|reviewed data/u);
      assert.deepEqual(JSON.parse(readFileSync(file)), { [key]: value });
    }
  }
  for (const value of [[], "invalid", 7, false]) {
    writeFileSync(file, JSON.stringify(value));
    packageDataApp(state);
    const configuration = packagedConfiguration(state);
    assert.deepEqual(configuration.initialPresentation, value);
    assert.throws(() => createDataAppWorker(configuration), /Presentation must be a JSON object/u);
  }
});

test("the emitted shipped Worker preserves owner editing and saved presentation across republication", async (t) => {
  const state = fixture(t);
  copyFileSync(
    new URL("../assets/data-app-runtime/worker.mjs", import.meta.url),
    join(dirname(state.helperPath), "../../../assets/data-app-runtime/worker.mjs"),
  );
  const publish = async () => {
    packageDataApp(state);
    const emitted = readFileSync(join(state.project, "dist/server/index.js"), "utf8");
    const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`);
    return worker;
  };
  const env = database();
  const worker = await publish();
  const initial = await (await worker.fetch(request("/api/presentation", ownerEmail), env)).json();
  assert.equal(initial.canEdit, true);
  assert.equal(initial.presentation.title, "Reviewed Data app");
  const saved = {
    title: "Saved by owner", hiddenBlocks: ["private-note"], componentTitles: { trend: "Saved trend" },
    textEdits: { caption: "" }, chartOverrides: { trend: { type: "bar" } }, filters: { week: "current" },
  };
  const updated = await worker.fetch(request("/api/presentation", ownerEmail, mutation(saved)), env);
  assert.equal(updated.status, 200);
  const savedRecord = await updated.json();
  assert.deepEqual(savedRecord.presentation, saved);
  assert.equal(savedRecord.revision, 1);
  assert.equal(
    (
      await worker.fetch(
        request("/api/presentation", "workspace-viewer@example.com", mutation({ title: "Unauthorized edit" }, 1)),
        env,
      )
    ).status,
    403,
  );
  writeFileSync(join(state.project, "presentation.json"), JSON.stringify({ title: "New deployment seed" }));
  const redeployed = await publish();
  const retained = await (await redeployed.fetch(request("/api/presentation", ownerEmail), env)).json();
  assert.deepEqual(retained, { ...savedRecord, canEdit: true, ownerEnvironmentConfigured: true });
});

test("collaborator republication preserves the owner's saves before and after reload", async (t) => {
  const state = fixture(t);
  const env = database();
  const { worker } = packageWorker(state);
  await worker.fetch(request("/api/presentation", ownerEmail, mutation({ title: "Already saved online" })), env);
  writeFileSync(join(state.project, "presentation.json"), JSON.stringify({ title: "New local seed" }));
  const editor = "editor@example.com";
  const { worker: next, configuration } = packageWorker(state, {
    environment: { ...process.env, DATA_APP_OWNER_EMAIL_SHA256: digest(editor) },
  });
  assert.equal(Object.hasOwn(configuration, "ownerEmailSha256"), false);
  const retained = await (await next.fetch(request("/api/presentation", ownerEmail), env)).json();
  assert.equal(retained.presentation.title, "Already saved online");
  assert.equal(retained.revision, 1);
  assert.equal(retained.ownerEnvironmentConfigured, true);
  // An already-open owner tab can still save against the new deployment.
  const saved = await next.fetch(request("/api/presentation", ownerEmail, mutation({ title: "Saved after republish" }, 1)), env);
  assert.equal(saved.status, 200);
  const record = await (await next.fetch(request("/api/presentation", ownerEmail), env)).json();
  assert.equal(record.presentation.title, "Saved after republish");
  assert.equal(record.revision, 2);
  assert.equal(record.canEdit, true);
  assert.equal((await (await next.fetch(request("/api/presentation", editor), env)).json()).canEdit, false);
  assert.equal((await next.fetch(request("/api/presentation", editor, mutation({ title: "Editor save" }, 2)), env)).status, 403);
  // Reloaded owner controls receive the current revision and can save again.
  assert.equal((await next.fetch(request("/api/presentation", ownerEmail, mutation({ title: "Saved after reload" }, record.revision)), env)).status, 200);
});

test("publication passes presentation to the editing runtime without duplicating validation or verification authority", async (t) => {
  const state = fixture(t);
  writeFileSync(
    join(state.project, "presentation.json"),
    JSON.stringify({
      title: "Reviewed",
      verification: { verifiedBy: "fabricated@example.com", verifiedAt: "2026-08-31T12:00:00.000Z" },
    }),
  );
  const { worker } = packageWorker(state);
  const record = await (await worker.fetch(request("/api/presentation", ownerEmail), database())).json();
  assert.equal(Object.hasOwn(record.presentation, "verification"), false);
  writeFileSync(join(state.project, "presentation.json"), JSON.stringify({ unsupported: true }));
  packageDataApp(state);
  assert.throws(() => createDataAppWorker(packagedConfiguration(state)), /Unsupported presentation fields/u);
});

test("Site environment is the sole edit authority without packaging owner identity", async (t) => {
  const state = fixture(t);
  const historicalUserIdHash = digest("historical-site-user-id");
  const historicalEmailHash = digest("previous-owner@example.com");
  const ownerPath = join(state.project, "src/data-app-owner.js");
  const historicalOwner =
    `export const dataAppOwnerUserIdSha256 = "${historicalUserIdHash}";\n` +
    `export const dataAppOwnerEmailSha256 = "${historicalEmailHash}";\n`;
  writeFileSync(ownerPath, historicalOwner);
  const { result, configuration, worker } = packageWorker(state);
  assert.equal(result.ownerAuthorization, "environment");
  assert.equal(result.ownerEnvironmentVariable, "DATA_APP_OWNER_EMAIL_SHA256");
  assert.equal(Object.hasOwn(result, "ownerSeeded"), false);
  assert.equal(Object.hasOwn(result, "ownerSetupRequired"), false);
  assert.equal(Object.hasOwn(configuration, "ownerEmailSha256"), false);
  assert.equal(Object.hasOwn(configuration, "ownerUserIdSha256"), false);
  assert.equal(readFileSync(ownerPath, "utf8"), historicalOwner);
  const emitted = readFileSync(join(state.project, "dist/server/index.js"), "utf8");
  assert.equal(emitted.includes(historicalUserIdHash), false);
  assert.equal(emitted.includes(historicalEmailHash), false);
  assert.equal(emitted.includes(digest(ownerEmail)), false);
  for (const artifact of [JSON.stringify(result), emitted, ...publicationBytes(state)]) {
    if (artifact !== null) assert.doesNotMatch(artifact.toString(), /owner@example\.com/iu);
  }

  const env = database();
  const normalizedOwner = " OWNER@EXAMPLE.com ";
  assert.equal(
    (await (await worker.fetch(request("/api/presentation", normalizedOwner), env)).json()).canEdit,
    true,
  );
  assert.equal(
    (await worker.fetch(request("/api/presentation", normalizedOwner, mutation({ title: "Owner edit" })), env)).status,
    200,
  );
  for (const headers of [
    { "oai-authenticated-user-id": ownerEmail },
    { "x-user-email": ownerEmail },
    { "oai-authenticated-user-id": ownerEmail, "oai-authenticated-user-email": "viewer@example.com" },
  ]) {
    assert.equal(
      (await (await worker.fetch(request("/api/presentation", undefined, { headers }), env)).json()).canEdit,
      false,
    );
    assert.equal(
      (
        await worker.fetch(
          request("/api/presentation", undefined, { ...mutation({ title: "Unauthorized edit" }, 1), headers }),
          env,
        )
      ).status,
      403,
    );
  }
});

test("environment ownership handles normalized email punctuation without embedding identity", async (t) => {
  const state = fixture(t);
  const literalEmail = "-Owner+`tag`$bucket'&@Example.COM";
  const { result, configuration, worker } = packageWorker(state);
  assert.equal(result.ownerAuthorization, "environment");
  assert.equal(Object.hasOwn(configuration, "ownerEmailSha256"), false);
  const env = { ...database(), DATA_APP_OWNER_EMAIL_SHA256: digest(literalEmail.toLowerCase()) };
  assert.equal(
    (await (await worker.fetch(request("/api/presentation", literalEmail), env)).json()).canEdit,
    true,
  );
  for (const artifact of [JSON.stringify(result), readFileSync(join(state.project, "dist/server/index.js"), "utf8")]) {
    assert.equal(artifact.toLowerCase().includes(literalEmail.toLowerCase()), false);
  }
});

test("retired owner options fail before writes without exposing email", (t) => {
  const cases = [
    [{ ownerEmail }, /Unknown option '--owner-email'/u],
    [{ ownerEmail: "" }, /Unknown option '--owner-email'/u],
    ...["--read-only", "--owner-user-id", "--owner-user-id-sha256", "--legacy-owner-email-site-file", "--bootstrap-owner"].map(
      (flag) => [{ extra: [flag] }, /Unknown option/u],
    ),
  ];
  for (const source of [false, true]) {
    const state = fixture(t);
    packageDataApp(state, { source });
    const before = publicationBytes(state);
    for (const [options, expected] of cases) {
      assert.throws(
        () => packageDataApp(state, { ...options, source }),
        (error) => {
          // execFileSync's wrapper message repeats its command; inspect the CLI's own diagnostics.
          const report = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
          assert.match(report, expected);
          for (const identity of [ownerEmail, options.ownerEmail]) {
            if (identity) assert.equal(report.includes(identity), false);
          }
          return true;
        },
      );
      assert.deepEqual(publicationBytes(state), before);
    }
  }
  const state = fixture(t);
  const before = publicationBytes(state);
  assert.throws(() => packageDataAppForSites({
    "project-dir": state.project, "project-id": siteId, "owner-email": ownerEmail,
  }), /no longer supported.*DATA_APP_OWNER_EMAIL_SHA256/u);
  assert.deepEqual(publicationBytes(state), before);
});

test("publication cannot transfer a project to a different Site", (t) => {
  const state = fixture(t);
  packageDataApp(state);
  const before = publicationBytes(state);
  assert.throws(() => packageDataApp(state, { projectId: "different-site" }), /existing Site ID/u);
  assert.deepEqual(publicationBytes(state), before);
});

test("a failed package write restores existing publication outputs", (t) => {
  const state = fixture(t);
  packageDataApp(state);
  const before = publicationBytes(state);
  rmSync(join(state.project, "dist/.openai"), { recursive: true, force: true });
  writeFileSync(join(state.project, "dist/.openai"), "blocks the hosting output directory");
  assert.throws(() => packageDataApp(state));
  const after = publicationBytes(state);
  for (const index of [0, 1, 2, 3, 4, 6]) assert.deepEqual(after[index], before[index]);
});

test("output symlinks cannot redirect publication writes outside the project", (t) => {
  for (const target of ["dist/server", "dist/server/index.js", "dist/.openai", ".openai/hosting.json"]) {
    const state = fixture(t);
    const outside = mkdtempSync(join(tmpdir(), "data-publish-outside-"));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    const isFile = target.endsWith(".js") || target.endsWith(".json");
    const unrelated = join(outside, isFile ? "outside-file" : "index.js");
    writeFileSync(unrelated, isFile && target.endsWith(".json") ? "{}" : "unrelated file");
    const before = readFileSync(unrelated);
    const destination = join(state.project, target);
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(isFile ? unrelated : outside, destination);
    assert.throws(() => packageDataApp(state), /symlinks|inside the project/u);
    assert.deepEqual(readFileSync(unrelated), before);
  }
});
