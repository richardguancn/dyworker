import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import dns from "node:dns";
import fsPromises from "node:fs/promises";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertPrebuiltProject,
  assertSupportedDataNode,
  dataNodeEnvironment,
  loadPrebuiltCompiler,
  localSourceVite,
  readPrebuiltArtifact,
  readPrebuiltManifest,
  runDataNode,
} from "../scripts/data-app-runtime.mjs";
import {
  API_VERSION,
  ARTIFACT_PATHS,
  INLINE_CANONICAL_MODULES,
  RELEASE_INPUTS,
  RUNTIME_MODULE_SPECIFIERS,
  jsonBytes,
  makeManifest,
  readSourceState,
  sha256,
  validateRuntimeModuleExports,
} from "../scripts/prebuilt/manifest.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASE = "templates/data-app/base";
const ASSETS = "assets/data-app-runtime";
const COMPILER_METHODS = [
  "transform",
  "rollup",
  "parseJavaScript",
  "parseCss",
  "walkCss",
  "generateCss",
  "decodeCssIdentifier",
];
const INLINE_METADATA = {
  canonicalModules: [...INLINE_CANONICAL_MODULES],
  externalImports: [],
  dynamicImports: [],
  encodedTokens: 0,
};
const APP_METADATA = {
  moduleExports: Object.fromEntries(
    RUNTIME_MODULE_SPECIFIERS.map((name) => [name, ["__esModule", "default", "fixture"]]),
  ),
};
let seedPromise;
let seedRoot;
let fixtureNumber = 0;

function write(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function runIntegrity(project, args = [], environment = {}) {
  return spawnSync(process.execPath, [join(project, "scripts/verify-protected-runtime.mjs"), ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...dataNodeEnvironment(process.env), ...environment },
    windowsHide: true,
  });
}

function assertSuccessful(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function ownerSourceWithSeeds(source, { emailHash = "" } = {}) {
  return source.replace(
    /export const dataAppOwnerEmailSha256 = "[^"]*";/u,
    `export const dataAppOwnerEmailSha256 = "${emailHash}";`,
  );
}

// Snapshot the real source once, but generate its integrity manifest only in a
// private fixture. Tests never refresh or edit the checked-in starter/assets.
async function sourceSeed() {
  if (!seedPromise) {
    seedPromise = (async () => {
      seedRoot = realpathSync(mkdtempSync(join(tmpdir(), "data-runtime-source-test-")));
      const sourceBase = join(PLUGIN_ROOT, BASE);
      cpSync(sourceBase, join(seedRoot, BASE), {
        recursive: true,
        filter(path) {
          const first = relative(sourceBase, path).split(sep)[0];
          return !["node_modules", "dist", "tests"].includes(first);
        },
      });
      for (const name of RELEASE_INPUTS) write(join(seedRoot, name), readFileSync(join(PLUGIN_ROOT, name)));
      for (const name of ["templates/data-app/inline", "scripts/prebuilt/licenses"]) {
        cpSync(join(PLUGIN_ROOT, name), join(seedRoot, name), { recursive: true });
      }
      assertSuccessful(runIntegrity(join(seedRoot, BASE), ["--update", "--maintainer"], { DATA_APP_MAINTAINER: "1" }));
      return { root: seedRoot, state: await readSourceState(seedRoot) };
    })();
  }
  return seedPromise;
}

after(() => {
  if (seedRoot) rmSync(seedRoot, { recursive: true, force: true });
});

function compilerBytes({ marker = `compiler-${++fixtureNumber}`, prelude = "", omit, apiVersion = API_VERSION } = {}) {
  const methods = COMPILER_METHODS.filter((name) => name !== omit)
    .map((name) => `${JSON.stringify(name)}: function(value) { return value; }`)
    .join(",\n");
  return Buffer.from(
    `${prelude}\nmodule.exports = {apiVersion:${JSON.stringify(apiVersion)},marker:${JSON.stringify(
      marker,
    )},${methods}};\n`,
  );
}

async function fixture(t, { compiler = compilerBytes(), artifacts: overrides = {}, project = false } = {}) {
  const seed = await sourceSeed();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "data-app-runtime-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plugin = join(root, "plugin");
  cpSync(seed.root, plugin, { recursive: true });
  const assets = join(plugin, ASSETS);
  const artifacts = Object.fromEntries(
    Object.keys(ARTIFACT_PATHS).map((name) => [name, Buffer.from(`fixture ${name}\n`)]),
  );
  artifacts.compiler = compiler;
  for (const [name, bytes] of Object.entries(overrides)) artifacts[name] = Buffer.from(bytes);
  const state = { root, plugin, assets, artifacts, sourceState: seed.state };
  rewriteArtifacts(state);
  if (project) {
    state.project = join(root, "project");
    cpSync(join(plugin, BASE), state.project, { recursive: true });
  }
  return state;
}

function rewriteArtifacts(state) {
  for (const [name, filename] of Object.entries(ARTIFACT_PATHS)) {
    write(join(state.assets, filename), state.artifacts[name]);
  }
  state.manifest = makeManifest(state.sourceState, state.artifacts, {
    appMetadata: APP_METADATA,
    inlineMetadata: INLINE_METADATA,
  });
  writeManifest(state, state.manifest);
}

function writeManifest(state, manifest) {
  write(join(state.assets, "manifest.json"), jsonBytes(manifest));
}

function createLink(t, target, path, directory = false) {
  try {
    symlinkSync(target, path, directory ? (process.platform === "win32" ? "junction" : "dir") : "file");
    return true;
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    t.skip("This Windows environment does not permit creation of the test symlink.");
    return false;
  }
}

function treeInventory(root) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        assert.ok(entry.isFile(), `Unexpected fixture file type: ${path}`);
        files[relative(root, path)] = sha256(readFileSync(path));
      }
    }
  }
  visit(root);
  return files;
}

test("portable runtime accepts supported Node releases and removes ambient Node injection", () => {
  for (const version of ["20.19.0", "20.20.1", "22.12.0", "22.20.0", "23.0.0", "24.0.0"]) {
    assert.doesNotThrow(() => assertSupportedDataNode(version), version);
  }
  for (const version of ["18.20.0", "20.18.9", "21.7.0", "22.11.9", "not-a-version", ""]) {
    assert.throws(() => assertSupportedDataNode(version), /requires Node 20\.19\+ or 22\.12\+/u, version);
  }
  const environment = {
    PATH: "ordinary-path",
    NODE_OPTIONS: "--require=unreviewed.cjs",
    node_options: "--import=unreviewed.mjs",
    NODE_PATH: "ambient-packages",
    Node_Path: "another-package-directory",
    NODE_EXTRA_CA_CERTS: "corporate-certificate.pem",
    KEEP: "value",
  };
  assert.deepEqual(dataNodeEnvironment(environment), {
    PATH: "ordinary-path",
    NODE_EXTRA_CA_CERTS: "corporate-certificate.pem",
    KEEP: "value",
  });
  assert.equal(environment.NODE_OPTIONS, "--require=unreviewed.cjs", "The caller's environment is not mutated");
});

test("verified manifests anchor source, release inputs, and every artifact and are deeply frozen", async (t) => {
  const state = await fixture(t);
  const manifest = await readPrebuiltManifest(state.plugin);
  assert.deepEqual(manifest, state.manifest);
  assert.equal(
    manifest.source.protectedRuntimeSha256,
    sha256(readFileSync(join(state.plugin, BASE, "protected-runtime.json"))),
  );
  assert.equal(manifest.source.buildInputsSha256, sha256(JSON.stringify(manifest.buildInputs)));
  for (const name of RELEASE_INPUTS)
    assert.equal(manifest.buildInputs[name], sha256(readFileSync(join(state.plugin, name))));
  for (const [name, filename] of Object.entries(ARTIFACT_PATHS)) {
    assert.ok(Object.isFrozen(manifest.artifacts[name]));
    const artifact = await readPrebuiltArtifact(name, { pluginRoot: state.plugin, manifest });
    assert.equal(artifact.path, join(state.assets, filename));
    assert.equal(artifact.code, state.artifacts[name].toString("utf8"));
    assert.equal(artifact.sha256, sha256(state.artifacts[name]));
    assert.equal(artifact.bytes, state.artifacts[name].length);
  }
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.source));
  assert.ok(Object.isFrozen(manifest.buildInputs));
  assert.deepEqual(manifest.artifacts.app.metadata, APP_METADATA);
  assert.ok(Object.isFrozen(manifest.artifacts.app.metadata.moduleExports));
  assert.ok(Object.isFrozen(manifest.artifacts.app.metadata.moduleExports.react));
  assert.ok(Object.isFrozen(manifest.artifacts.inline.metadata.canonicalModules));
  assert.throws(() => {
    manifest.artifacts.app.path = "outside.js";
  }, TypeError);
  assert.equal(existsSync(join(state.plugin, "node_modules")), false);
});

test("app export maps use the exact frozen module contract and detached sorted own-name arrays", () => {
  assert.equal(RUNTIME_MODULE_SPECIFIERS.length, 8);
  assert.ok(Object.isFrozen(RUNTIME_MODULE_SPECIFIERS));
  assert.deepEqual([...RUNTIME_MODULE_SPECIFIERS].sort(), RUNTIME_MODULE_SPECIFIERS);
  const input = structuredClone(APP_METADATA.moduleExports);
  input.react = [...input.react, "not-an-identifier", "x".repeat(256), "日本語"].sort();
  const verified = validateRuntimeModuleExports(input);
  assert.deepEqual(verified, input);
  assert.notStrictEqual(verified, input);
  assert.ok(Object.isFrozen(verified));
  assert.deepEqual(Object.keys(verified), RUNTIME_MODULE_SPECIFIERS);
  for (const name of RUNTIME_MODULE_SPECIFIERS) {
    assert.notStrictEqual(verified[name], input[name]);
    assert.ok(Object.isFrozen(verified[name]));
  }
  input.react.push("later mutation");
  assert.equal(verified.react.includes("later mutation"), false);
  assert.throws(() => verified.react.push("forged export"), TypeError);
  assert.throws(() => validateRuntimeModuleExports(Object.create(APP_METADATA.moduleExports)), /module export map/u);
  assert.throws(
    () => validateRuntimeModuleExports({ ...APP_METADATA.moduleExports, [Symbol("extra")]: [] }),
    /module export map/u,
  );
});

test("missing or malformed app export metadata is rejected by publishing and runtime verification", async (t) => {
  const state = await fixture(t);
  const malformed = [
    ["missing metadata", () => undefined],
    ["null metadata", () => null],
    ["array metadata", () => []],
    ["extra metadata field", (value) => ({ ...value, extra: true })],
    ["missing export map", () => ({})],
    ["null export map", () => ({ moduleExports: null })],
    ["array export map", () => ({ moduleExports: [] })],
    [
      "missing module",
      (value) => {
        delete value.moduleExports.react;
        return value;
      },
    ],
    [
      "extra module",
      (value) => {
        value.moduleExports["not-shipped"] = ["__esModule", "default"];
        return value;
      },
    ],
    ...[
      ["non-array exports", "default"],
      ["empty export list", []],
      ["missing default", ["__esModule", "fixture"]],
      ["missing __esModule", ["default", "fixture"]],
      ["duplicate export", ["__esModule", "default", "default"]],
      ["unsorted exports", ["default", "__esModule", "fixture"]],
      ["non-string export", ["__esModule", "default", 1]],
      ["empty export name", ["", "__esModule", "default"]],
      ["NUL export name", ["__esModule", "default", "name\0"]],
      ["newline export name", ["__esModule", "default", "name\n"]],
      ["DEL export name", ["__esModule", "default", "name\u007f"]],
      ["oversized export name", ["__esModule", "default", "x".repeat(257)]],
      [
        "oversized export list",
        ["__esModule", "default", ...Array.from({ length: 1023 }, (_, index) => `x${String(index).padStart(4, "0")}`)],
      ],
      ["sparse export list", ["__esModule", "default", , "fixture"]],
    ].map(([name, names]) => [
      name,
      (value) => {
        value.moduleExports.react = names;
        return value;
      },
    ]),
  ];
  const invalidMetadata = /app runtime metadata|runtime module export map|runtime exports|runtime export name/iu;
  for (const [name, mutate] of malformed) {
    await t.test(name, async () => {
      const appMetadata = mutate(structuredClone(APP_METADATA));
      assert.throws(
        () => makeManifest(state.sourceState, state.artifacts, { appMetadata, inlineMetadata: INLINE_METADATA }),
        invalidMetadata,
      );
      const manifest = structuredClone(state.manifest);
      if (appMetadata === undefined) delete manifest.artifacts.app.metadata;
      else manifest.artifacts.app.metadata = appMetadata;
      writeManifest(state, manifest);
      await assert.rejects(readPrebuiltManifest(state.plugin), invalidMetadata);
    });
  }
  assert.throws(() => makeManifest(state.sourceState, state.artifacts), /app runtime metadata/u);
});

test("manifest metadata rejects extra artifacts, unsafe paths, invalid hashes, and unbounded sizes", async (t) => {
  const state = await fixture(t);
  const cases = [
    [
      "format",
      (manifest) => {
        manifest.format += 1;
      },
      /unsupported manifest/u,
    ],
    [
      "API",
      (manifest) => {
        manifest.apiVersion += 1;
      },
      /unsupported manifest/u,
    ],
    [
      "missing artifact",
      (manifest) => {
        delete manifest.artifacts.worker;
      },
      /exact release artifacts/u,
    ],
    [
      "extra artifact",
      (manifest) => {
        manifest.artifacts.extra = manifest.artifacts.app;
      },
      /exact release artifacts/u,
    ],
    ...["../outside.js", "/absolute.js", "C:/absolute.js", "a\\b", "app.js\0", "./app.js"].map((path) => [
      `path ${JSON.stringify(path)}`,
      (manifest) => {
        manifest.artifacts.app.path = path;
      },
      /invalid app artifact metadata/u,
    ]),
    ...["", "f".repeat(63), "g".repeat(64), "A".repeat(64)].map((hash) => [
      `hash ${JSON.stringify(hash)}`,
      (manifest) => {
        manifest.artifacts.app.sha256 = hash;
      },
      /invalid app artifact metadata/u,
    ]),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 16 * 1024 * 1024 + 1].map((size) => [
      `size ${size}`,
      (manifest) => {
        manifest.artifacts.app.bytes = size;
      },
      /invalid app artifact metadata/u,
    ]),
    [
      "inline limit",
      (manifest) => {
        manifest.artifacts.inline.bytes = 1_000_000;
      },
      /invalid inline artifact metadata/u,
    ],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, async () => {
      const manifest = structuredClone(state.manifest);
      mutate(manifest);
      writeManifest(state, manifest);
      await assert.rejects(readPrebuiltManifest(state.plugin), expected);
    });
  }
});

test("manifest and combined artifact byte limits are checked before reading large content", async (t) => {
  const state = await fixture(t);
  const path = join(state.assets, "manifest.json");
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1, 0x20)]) {
    writeFileSync(path, bytes);
    await assert.rejects(readPrebuiltManifest(state.plugin), /bounded regular file/u);
  }
  const manifest = structuredClone(state.manifest);
  for (const name of ["app", "styles"]) {
    manifest.artifacts[name].bytes = 16 * 1024 * 1024;
    truncateSync(join(state.assets, ARTIFACT_PATHS[name]), manifest.artifacts[name].bytes);
  }
  writeManifest(state, manifest);
  await assert.rejects(readPrebuiltManifest(state.plugin), /artifacts exceed the supported size/u);
});

test("every missing, truncated, or same-size altered artifact fails closed", async (t) => {
  const state = await fixture(t);
  for (const [name, filename] of Object.entries(ARTIFACT_PATHS)) {
    await t.test(name, async () => {
      const path = join(state.assets, filename);
      const original = state.artifacts[name];
      try {
        rmSync(path);
        await assert.rejects(readPrebuiltManifest(state.plugin), /Invalid prebuilt Data runtime/u);
        writeFileSync(path, original.subarray(1));
        await assert.rejects(readPrebuiltManifest(state.plugin), /wrong size or file type/u);
        const changed = Buffer.from(original);
        changed[0] ^= 1;
        writeFileSync(path, changed);
        await assert.rejects(readPrebuiltManifest(state.plugin), /artifact integrity/u);
      } finally {
        writeFileSync(path, original);
      }
    });
  }
});

test("stale source, protected manifests, and release metadata cannot be relabeled as current assets", async (t) => {
  const state = await fixture(t);
  for (const [name, mutate] of [
    [
      "source hash",
      (manifest) => {
        manifest.source.packageSha256 = "0".repeat(64);
      },
    ],
    [
      "protected manifest hash",
      (manifest) => {
        manifest.source.protectedRuntimeSha256 = "0".repeat(64);
      },
    ],
    [
      "build input hash",
      (manifest) => {
        manifest.buildInputs["scripts/prebuilt/compiler-entry.mjs"] = "0".repeat(64);
      },
    ],
    [
      "extra build input",
      (manifest) => {
        manifest.buildInputs["unexpected.js"] = "0".repeat(64);
      },
    ],
  ]) {
    await t.test(name, async () => {
      const manifest = structuredClone(state.manifest);
      mutate(manifest);
      writeManifest(state, manifest);
      await assert.rejects(readPrebuiltManifest(state.plugin), /assets are stale/u);
    });
  }
  writeManifest(state, state.manifest);
  const releaseInput = join(state.plugin, "scripts/prebuilt/compiler-entry.mjs");
  const releaseBytes = readFileSync(releaseInput);
  writeFileSync(releaseInput, Buffer.concat([releaseBytes, Buffer.from("\n// changed release input\n")]));
  await assert.rejects(readPrebuiltManifest(state.plugin), /assets are stale/u);
  writeFileSync(releaseInput, releaseBytes);
  const protectedSource = join(state.plugin, BASE, "src/styles.css");
  writeFileSync(protectedSource, `${readFileSync(protectedSource, "utf8")}\n/* changed source */\n`);
  await assert.rejects(readPrebuiltManifest(state.plugin), /protected runtime is stale/u);
  assertSuccessful(runIntegrity(join(state.plugin, BASE), ["--update", "--maintainer"], { DATA_APP_MAINTAINER: "1" }));
  await assert.rejects(readPrebuiltManifest(state.plugin), /assets are stale/u);
});

test("supplied manifest objects cannot forge artifact identity or cross plugin roots", async (t) => {
  const first = await fixture(t, { artifacts: { app: "first runtime\n" } });
  const second = await fixture(t, { artifacts: { app: "second runtime\n" } });
  const trusted = await readPrebuiltManifest(first.plugin);
  const forged = structuredClone(trusted);
  forged.artifacts.app = { path: "../outside.js", sha256: "0".repeat(64), bytes: 1 };
  assert.equal(
    (await readPrebuiltArtifact("app", { pluginRoot: first.plugin, manifest: forged })).code,
    "first runtime\n",
  );
  assert.equal(
    (await readPrebuiltArtifact("app", { pluginRoot: second.plugin, manifest: trusted })).code,
    "second runtime\n",
  );
  for (const name of ["../app", "__proto__", "constructor", "missing"]) {
    await assert.rejects(
      readPrebuiltArtifact(name, { pluginRoot: first.plugin, manifest: trusted }),
      /unknown artifact/u,
    );
  }
});

test("trusted manifests still recheck the exact artifact bytes and reject invalid UTF-8", async (t) => {
  const state = await fixture(t);
  const manifest = await readPrebuiltManifest(state.plugin);
  const changed = Buffer.from(state.artifacts.app);
  changed[0] ^= 1;
  writeFileSync(join(state.assets, ARTIFACT_PATHS.app), changed);
  await assert.rejects(readPrebuiltArtifact("app", { pluginRoot: state.plugin, manifest }), /release hash/u);
  state.artifacts.app = Buffer.from([0xff, 0xfe, 0x80]);
  rewriteArtifacts(state);
  const utf8Manifest = await readPrebuiltManifest(state.plugin);
  await assert.rejects(
    readPrebuiltArtifact("app", { pluginRoot: state.plugin, manifest: utf8Manifest }),
    /not valid UTF-8/u,
  );
});

test("manifest and artifact leaves must be ordinary files, never symlinks", async (t) => {
  for (const filename of ["manifest.json", ARTIFACT_PATHS.app, ARTIFACT_PATHS.compiler]) {
    await t.test(filename, async (t) => {
      const state = await fixture(t);
      const path = join(state.assets, filename);
      const external = join(state.root, `external-${filename}`);
      renameSync(path, external);
      if (!createLink(t, external, path)) return;
      await assert.rejects(readPrebuiltManifest(state.plugin), /regular file|file type|nonsymlink|symlink/u);
    });
  }
});

test("asset directory ancestors cannot escape the verified plugin through symlinks", async (t) => {
  for (const name of ["assets", ASSETS]) {
    await t.test(name, async (t) => {
      const state = await fixture(t);
      const manifest = await readPrebuiltManifest(state.plugin);
      const path = join(state.plugin, name);
      const external = join(state.root, "outside-assets");
      renameSync(path, external);
      if (!createLink(t, external, path, true)) return;
      await assert.rejects(readPrebuiltManifest(state.plugin), /symlink|regular|outside|contain|escap/iu);
      await assert.rejects(
        readPrebuiltArtifact("app", { pluginRoot: state.plugin, manifest }),
        /symlink|regular|outside|contain|escap/iu,
      );
    });
  }
});

test("source input ancestors and leaves cannot be supplied through symlinks", async (t) => {
  for (const name of [`${BASE}/src`, "scripts/prebuilt/compiler-entry.mjs"]) {
    await t.test(name, async (t) => {
      const state = await fixture(t);
      const path = join(state.plugin, name);
      const directory = lstatSync(path).isDirectory();
      const external = join(state.root, "outside-source");
      renameSync(path, external);
      if (!createLink(t, external, path, directory)) return;
      await assert.rejects(readPrebuiltManifest(state.plugin), /symlink|regular|outside|contain|escap/iu);
    });
  }
});

test("compiler loading uses verified bytes instead of Node's CommonJS cache", async (t) => {
  const state = await fixture(t, { compiler: compilerBytes({ marker: "reviewed-cache-test" }) });
  const path = join(state.assets, ARTIFACT_PATHS.compiler);
  const require = createRequire(import.meta.url);
  const previous = require.cache[path];
  const poisoned = { id: path, filename: path, loaded: true, exports: { marker: "poisoned cache" } };
  require.cache[path] = poisoned;
  t.after(() => {
    if (previous) require.cache[path] = previous;
    else delete require.cache[path];
  });
  const compiler = await loadPrebuiltCompiler({ pluginRoot: state.plugin });
  assert.equal(compiler.marker, "reviewed-cache-test");
  assert.ok(Object.isFrozen(compiler));
  assert.strictEqual(require.cache[path], poisoned, "The loader neither consults nor rewrites ambient require.cache");
  assert.strictEqual(await loadPrebuiltCompiler({ pluginRoot: state.plugin }), compiler);
  state.artifacts.compiler = compilerBytes({ marker: "reviewed-new-revision" });
  rewriteArtifacts(state);
  const next = await loadPrebuiltCompiler({ pluginRoot: state.plugin });
  assert.equal(next.marker, "reviewed-new-revision");
  assert.notStrictEqual(next, compiler, "A newly verified hash at the same path is a different compiler");
  writeFileSync(path, compilerBytes({ marker: "unreviewed-revision" }));
  await assert.rejects(loadPrebuiltCompiler({ pluginRoot: state.plugin }), /wrong size|integrity|release hash/u);
});

test("compiler evaluation cannot reopen a swapped path after its bytes were verified", async (t) => {
  const state = await fixture(t, { compiler: compilerBytes({ marker: "verified-race-bytes" }) });
  const manifest = await readPrebuiltManifest(state.plugin);
  const path = join(state.assets, ARTIFACT_PATHS.compiler);
  const originalReadFile = fsPromises.readFile;
  let swapped = false;
  fsPromises.readFile = async function (name, ...args) {
    const bytes = await originalReadFile.call(this, name, ...args);
    const filename = name instanceof URL ? fileURLToPath(name) : typeof name === "string" ? resolve(name) : null;
    if (!swapped && filename === path) {
      swapped = true;
      writeFileSync(path, compilerBytes({ marker: "unreviewed-swapped-path" }));
    }
    return bytes;
  };
  syncBuiltinESMExports();
  try {
    const compiler = await loadPrebuiltCompiler({ pluginRoot: state.plugin, manifest });
    assert.equal(swapped, true, "The fixture swapped the compiler after the read completed");
    assert.equal(compiler.marker, "verified-race-bytes");
    await assert.rejects(loadPrebuiltCompiler({ pluginRoot: state.plugin, manifest }), /release hash/u);
  } finally {
    fsPromises.readFile = originalReadFile;
    syncBuiltinESMExports();
  }
});

test("standalone compiler cannot fall back to builtins or ambient npm packages", async (t) => {
  for (const specifier of ["node:fs", "sucrase", "../outside.cjs"]) {
    await t.test(specifier, async (t) => {
      const state = await fixture(t, {
        compiler: compilerBytes({ prelude: `require(${JSON.stringify(specifier)});` }),
      });
      write(join(state.root, "node_modules/sucrase/index.js"), "throw new Error('ambient package executed');\n");
      await assert.rejects(
        loadPrebuiltCompiler({ pluginRoot: state.plugin }),
        /standalone compiler attempted to import/u,
      );
    });
  }
});

test("standalone compiler requires the complete versioned authoring and parser API", async (t) => {
  const state = await fixture(t);
  for (const options of [{ apiVersion: API_VERSION + 1 }, ...COMPILER_METHODS.map((omit) => ({ omit }))]) {
    state.artifacts.compiler = compilerBytes(options);
    rewriteArtifacts(state);
    await assert.rejects(loadPrebuiltCompiler({ pluginRoot: state.plugin }), /incompatible API/u);
  }
});

test("canonical projects remain editable without installing dependencies", async (t) => {
  const state = await fixture(t, { project: true });
  write(
    join(state.project, "src/content/Extra.tsx"),
    "export default function Extra(){return <section>Offline fixture</section>;}\n",
  );
  write(join(state.project, "src/content/nested/local.json"), jsonBytes({ label: "Editable local data" }));
  write(join(state.project, "src/theme.css"), ":root { --accent: #1965cf; }\n");
  write(join(state.project, "src/data.json"), jsonBytes({ title: "Editable snapshot" }));
  const progress = [];
  const checked = await assertPrebuiltProject({
    projectDir: state.project,
    pluginRoot: state.plugin,
    onProgress: (message) => progress.push(message),
  });
  assert.equal(checked.projectRoot, state.project);
  assert.equal(checked.pluginRoot, state.plugin);
  assert.ok(Object.isFrozen(checked.manifest));
  assert.ok(progress.some((message) => /Data app authored content verified/u.test(message)));
  assert.equal(existsSync(join(state.project, "node_modules")), false);
});

test("source-mode verification retains scoped authorization and requires an installed toolchain", async (t) => {
  const state = await fixture(t, { project: true });
  const name = "src/data-app-public.jsx";
  const path = join(state.project, name);
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// explicitly authorized fixture change\n`);
  const rejected = runIntegrity(state.project);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /runtime file was modified: src\/data-app-public\.jsx/u);
  await assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin });
  const authorization = spawnSync(
    process.execPath,
    [
      join(state.project, "scripts/authorize-protected-change.mjs"),
      "--confirmed",
      "--scope",
      name,
      "--reason",
      "Explicit test-fixture authorization",
    ],
    {
      cwd: state.project,
      encoding: "utf8",
      env: { ...dataNodeEnvironment(process.env), DATA_APP_USER_CONFIRMED: "1" },
      windowsHide: true,
    },
  );
  assertSuccessful(authorization);
  assertSuccessful(runIntegrity(state.project));
  await assert.rejects(
    localSourceVite(state.project),
    /already-installed local Vite.*default prebuilt build needs no npm install/u,
  );
  assert.equal(existsSync(join(state.project, "node_modules")), false);
  const vitePath = join(state.project, "node_modules/vite/bin/vite.js");
  write(vitePath, "// Already-installed local source-build fixture.\n");
  assert.deepEqual(await localSourceVite(state.project), { projectRoot: state.project, vitePath });
});

test("prebuilt verification needs only authored inputs and never executes copied infrastructure", async (t) => {
  const state = await fixture(t, { project: true });
  const manifestPath = join(state.project, "protected-runtime.json");
  const copied = JSON.parse(readFileSync(manifestPath));
  for (const name of Object.keys(copied.files)) rmSync(join(state.project, name));
  writeFileSync(manifestPath, "Obsolete copied metadata is not a build input.\n");
  write(join(state.project, "scripts/verify-protected-runtime.mjs"), "throw new Error('Copied verifier executed');\n");
  const before = treeInventory(state.project);
  await assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin });
  assert.deepEqual(treeInventory(state.project), before);

  write(join(state.project, "src/content/unsafe.css"), ".dashboard-topbar { display: none; }\n");
  await assert.rejects(
    assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin }),
    /targets protected application chrome/u,
  );
});

test("authored-only verification cannot update either project's integrity manifest", async (t) => {
  const state = await fixture(t, { project: true });
  const before = treeInventory(state.root);
  const result = runIntegrity(join(state.plugin, BASE), ["--authored-only", state.project, "--update", "--maintainer"], {
    DATA_APP_MAINTAINER: "1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without update or authorization options/u);
  assert.deepEqual(treeInventory(state.root), before);
});

test("a previously trusted manifest cannot authorize a later canonical-source rewrite", async (t) => {
  const state = await fixture(t, { project: true });
  const manifest = await readPrebuiltManifest(state.plugin);
  const canonicalBase = join(state.plugin, BASE);
  const name = "src/styles.css";
  const changed = `${readFileSync(join(canonicalBase, name), "utf8")}\n/* unbuilt source revision */\n`;
  writeFileSync(join(canonicalBase, name), changed);
  writeFileSync(join(state.project, name), changed);
  assertSuccessful(runIntegrity(canonicalBase, ["--update", "--maintainer"], { DATA_APP_MAINTAINER: "1" }));
  writeFileSync(
    join(state.project, "protected-runtime.json"),
    readFileSync(join(canonicalBase, "protected-runtime.json")),
  );
  assertSuccessful(runIntegrity(state.project));
  await assert.rejects(
    assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin, manifest }),
    /stale|protected.runtime|release hash|source.*(?:change|match)/iu,
  );
});

test("cached release metadata cannot authorize changed installed verifier code", async (t) => {
  const state = await fixture(t, { project: true });
  const manifest = await readPrebuiltManifest(state.plugin);
  for (const name of ["verify-protected-runtime.mjs", "protected-file-digest.mjs"]) {
    const path = join(state.plugin, BASE, "scripts", name);
    const original = readFileSync(path);
    writeFileSync(path, "throw new Error('Unverified verifier code executed');\n");
    await assert.rejects(
      assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin, manifest }),
      /installed authored verifier changed after release verification/u,
    );
    writeFileSync(path, original);
  }
});

test("source verification permits publication metadata without unlocking protected code", async (t) => {
  const state = await fixture(t, { project: true });
  const ownerPath = join(state.project, "src/data-app-owner.js");
  const ownerTemplate = readFileSync(ownerPath, "utf8");
  const protectedManifest = readFileSync(join(state.project, "protected-runtime.json"));
  for (const owner of ["a".repeat(64), "B".repeat(64), ""]) {
    writeFileSync(ownerPath, ownerSourceWithSeeds(ownerTemplate, { emailHash: owner }));
    writeFileSync(
      join(state.project, ".openai/hosting.json"),
      jsonBytes({ d1: "DB", r2: null, project_id: "appgprj_offline_fixture" }),
    );
    assertSuccessful(runIntegrity(state.project));
    assert.deepEqual(readFileSync(join(state.project, "protected-runtime.json")), protectedManifest);
  }
  writeFileSync(ownerPath, `${ownerTemplate}\nconsole.log('extra protected executable code');\n`);
  const ownerRejected = runIntegrity(state.project);
  assert.notEqual(ownerRejected.status, 0);
  assert.match(ownerRejected.stderr, /exactly its expected owner export/u);
  writeFileSync(ownerPath, ownerTemplate);
  writeFileSync(
    join(state.project, ".openai/hosting.json"),
    jsonBytes({ d1: "DB", r2: "FILES", project_id: "appgprj_offline_fixture" }),
  );
  const hostingRejected = runIntegrity(state.project);
  assert.notEqual(hostingRejected.status, 0);
  assert.match(hostingRejected.stderr, /runtime file was modified: .openai\/hosting\.json/u);
});

test("source verification permits owner email changes and rejects malformed seeds", async (t) => {
  const state = await fixture(t, { project: true });
  const ownerPath = join(state.project, "src/data-app-owner.js");
  const ownerTemplate = readFileSync(ownerPath, "utf8");
  const protectedPath = join(state.project, "protected-runtime.json");
  const protectedManifest = readFileSync(protectedPath);
  writeFileSync(
    join(state.project, ".openai/hosting.json"),
    jsonBytes({ d1: "DB", r2: null, project_id: "appgprj_email_mode_fixture" }),
  );
  for (const owner of [
    { emailHash: "a".repeat(64) },
    { emailHash: "B".repeat(64) },
    { emailHash: "d".repeat(64) },
    {},
  ]) {
    writeFileSync(ownerPath, ownerSourceWithSeeds(ownerTemplate, owner));
    assertSuccessful(runIntegrity(state.project));
    assert.deepEqual(readFileSync(protectedPath), protectedManifest, "Changing the owner email must not unlock source");
  }
  writeFileSync(ownerPath, ownerSourceWithSeeds(ownerTemplate, { emailHash: "not-a-sha256" }));
  const malformed = runIntegrity(state.project);
  assert.notEqual(malformed.status, 0);
  assert.match(`${malformed.stdout}\n${malformed.stderr}`, /owner seed must be empty or a SHA-256/u);
  assert.deepEqual(readFileSync(protectedPath), protectedManifest);
  writeFileSync(ownerPath, ownerTemplate.replace(/export const dataAppOwnerEmailSha256 = "[^"]*";\n?/u, ""));
  const rejected = runIntegrity(state.project);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /exactly its expected owner exports/u);
  assert.deepEqual(readFileSync(protectedPath), protectedManifest);
});

test("authored paths reject symlinks before the installed verifier reads them", async (t) => {
  await t.test("editable symlink", async (t) => {
    const state = await fixture(t, { project: true });
    const external = join(state.root, "outside-content.jsx");
    write(external, "export default null;\n");
    if (!createLink(t, external, join(state.project, "src/content/linked.jsx"))) return;
    await assert.rejects(
      assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin }),
      /must not contain symlinks/u,
    );
  });
  for (const name of ["src", "src/content", "src/theme.css"]) {
    await t.test(name, async (t) => {
      const state = await fixture(t, { project: true });
      const path = join(state.project, name);
      const external = join(state.root, "redirected-authored-input");
      const directory = lstatSync(path).isDirectory();
      renameSync(path, external);
      if (!createLink(t, external, path, directory)) return;
      await assert.rejects(
        assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin }),
        /nonsymlinked/u,
      );
    });
  }
});

test("explicit source builds cannot use Vite from outside the project", async (t) => {
  const state = await fixture(t, { project: true });
  const external = join(state.root, "outside-vite.js");
  const vitePath = join(state.project, "node_modules/vite/bin/vite.js");
  write(external, "// Outside project.\n");
  mkdirSync(dirname(vitePath), { recursive: true });
  if (!createLink(t, external, vitePath)) return;
  await assert.rejects(localSourceVite(state.project), /must be contained in the Data app project/u);
});

test("Node helper uses the current executable and sanitized environment even without a working PATH", async (t) => {
  const state = await fixture(t);
  const progress = [];
  const output = runDataNode(
    [
      "-e",
      "console.log(JSON.stringify({execPath:process.execPath,options:process.env.NODE_OPTIONS??null,path:process.env.NODE_PATH??null,kept:process.env.DATA_RUNTIME_TEST}));console.error('fixture diagnostic')",
    ],
    {
      cwd: state.root,
      environment: {
        ...process.env,
        PATH: join(state.root, "no-package-managers"),
        NODE_OPTIONS: "--require=missing.cjs",
        NODE_PATH: "ambient-packages",
        DATA_RUNTIME_TEST: "kept",
      },
      onProgress: (message) => progress.push(message),
    },
  );
  assert.deepEqual(JSON.parse(output), { execPath: process.execPath, options: null, path: null, kept: "kept" });
  assert.match(progress.join("\n"), /^fixture diagnostic$/mu);
  assert.throws(
    () => runDataNode(["-e", "console.error('expected child failure');process.exitCode=7"]),
    /expected child failure/u,
  );
});

test("default runtime verification performs no install, network call, or project/plugin writes", async (t) => {
  const state = await fixture(t, { project: true });
  const before = treeInventory(state.root);
  const attempted = [];
  const allowedProcesses = [];
  const restorations = [];
  const replace = (object, name, value) => {
    const previous = object[name];
    object[name] = value;
    restorations.push(() => {
      object[name] = previous;
    });
  };
  const deny = (name) => () => {
    attempted.push(name);
    throw new Error(`Unexpected runtime side effect: ${name}`);
  };
  const originalSpawnSync = childProcess.spawnSync;
  replace(childProcess, "spawnSync", (command, args, options) => {
    assert.equal(command, process.execPath, "Only the existing Node executable may be launched");
    assert.deepEqual(args, [join(state.plugin, BASE, "scripts/verify-protected-runtime.mjs"), "--authored-only", state.project]);
    allowedProcesses.push(command);
    return originalSpawnSync(command, args, options);
  });
  for (const name of ["spawn", "exec", "execSync", "execFile", "execFileSync", "fork"])
    replace(childProcess, name, deny(name));
  for (const [module, names] of [
    [http, ["get", "request"]],
    [https, ["get", "request"]],
    [net, ["connect", "createConnection"]],
    [dns, ["lookup", "resolve"]],
  ]) {
    for (const name of names) replace(module, name, deny(name));
  }
  replace(globalThis, "fetch", deny("fetch"));
  syncBuiltinESMExports();
  try {
    const manifest = await readPrebuiltManifest(state.plugin);
    await readPrebuiltArtifact("app", { pluginRoot: state.plugin, manifest });
    await loadPrebuiltCompiler({ pluginRoot: state.plugin, manifest });
    await assertPrebuiltProject({ projectDir: state.project, pluginRoot: state.plugin, manifest });
  } finally {
    for (const restore of restorations.reverse()) restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(attempted, []);
  assert.deepEqual(allowedProcesses, [process.execPath]);
  assert.deepEqual(treeInventory(state.root), before);
  assert.equal(existsSync(join(state.plugin, "node_modules")), false);
  assert.equal(existsSync(join(state.project, "node_modules")), false);
});

// Serialized into an isolated child below. Keep every dependency a Node builtin
// and install the package/native/process/network traps before importing Data.
async function probeReleasedCompiler() {
  const { default: assert } = await import("node:assert/strict");
  const { default: processes } = await import("node:child_process");
  const { default: dns } = await import("node:dns");
  const { default: fs } = await import("node:fs");
  const { default: fsAsync } = await import("node:fs/promises");
  const { default: http } = await import("node:http");
  const { default: https } = await import("node:https");
  const { default: Module, isBuiltin, syncBuiltinESMExports } = await import("node:module");
  const { default: net } = await import("node:net");
  const { join, posix } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { Script } = await import("node:vm");
  const root = process.env.DATA_RUNTIME_TEST_ROOT;
  const pluginRoot = join(root, "plugin");
  const attempts = [];
  const deny = (label) => () => {
    attempts.push(label);
    throw new Error(`Unexpected released-compiler side effect: ${label}`);
  };
  assert.equal(process.env.PATH, join(root, "bin"));
  assert.equal(process.env.NODE_PATH, join(root, "node_modules"));
  assert.ok(process.execArgv.includes("--no-addons"));
  const originalLoad = Module._load;
  Module._load = function (specifier, ...args) {
    if (!isBuiltin(specifier)) return deny(`CommonJS module ${specifier}`)();
    return originalLoad.call(this, specifier, ...args);
  };
  Module._extensions[".node"] = deny("native .node extension");
  process.dlopen = deny("process.dlopen");
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    processes[name] = deny(`child_process.${name}`);
  }
  for (const [module, names] of [
    [http, ["get", "request"]],
    [https, ["get", "request"]],
    [net, ["connect", "createConnection"]],
    [dns, ["lookup", "resolve"]],
  ]) {
    for (const name of names) module[name] = deny(`network.${name}`);
  }
  for (const name of ["writeFile", "appendFile", "mkdir", "rm", "rename", "truncate", "copyFile"]) {
    fs[name] = deny(`fs.${name}`);
    fs[`${name}Sync`] = deny(`fs.${name}Sync`);
    fsAsync[name] = deny(`fs.promises.${name}`);
  }
  globalThis.fetch = deny("fetch");
  syncBuiltinESMExports();

  const runtime = await import(pathToFileURL(join(pluginRoot, "scripts/data-app-runtime.mjs")).href);
  const manifest = await runtime.readPrebuiltManifest(pluginRoot);
  const contract = await import(pathToFileURL(join(pluginRoot, "scripts/prebuilt/manifest.mjs")).href);
  const moduleExports = manifest.artifacts.app.metadata.moduleExports;
  assert.deepEqual(Object.keys(moduleExports), contract.RUNTIME_MODULE_SPECIFIERS);
  assert.deepEqual(contract.validateRuntimeModuleExports(moduleExports), moduleExports);
  for (const [specifier, required] of Object.entries({
    "@openai/data-app": ["Chart", "DataComponent", "useDataApp"],
    react: ["createElement", "useEffect", "useState"],
    "react-dom/client": ["createRoot"],
    "react/jsx-runtime": ["Fragment", "jsx", "jsxs"],
    "react/jsx-dev-runtime": ["jsxDEV"],
  })) {
    for (const name of required) assert.ok(moduleExports[specifier].includes(name), `${specifier} must export ${name}`);
  }
  const compiler = await runtime.loadPrebuiltCompiler({ pluginRoot, manifest });
  const modules = {
    "/counter.ts": "export let count: number = 2; export function bump(){ count += 1; }",
    "/barrel.ts": "export {count,bump} from './counter.ts';",
    "react/jsx-runtime": "export const jsx=(type,props)=>({type,props});export const jsxs=jsx;",
    "/main.tsx":
      "import {count} from './barrel.ts';export {count,bump} from './barrel.ts';export function View(){return <span data-count={count}>Offline</span>;}",
  };
  async function link(graph) {
    const prefix = "\0offline-test:";
    const resolveId = (source, importer) => {
      const name = source.startsWith(prefix)
        ? source.slice(prefix.length)
        : source.startsWith(".")
        ? posix.resolve(posix.dirname(importer.slice(prefix.length)), source)
        : source;
      if (!Object.hasOwn(graph, name)) throw new Error(`Closed graph rejected ${source}`);
      return `${prefix}${name}`;
    };
    const bundle = await compiler.rollup({
      input: `${prefix}/main.tsx`,
      onwarn(warning) {
        throw new Error(warning.message);
      },
      plugins: [
        {
          name: "offline-closed-graph",
          resolveId,
          resolveDynamicImport() {
            throw new Error("Dynamic imports are not part of this closed graph");
          },
          load(id) {
            const name = id.slice(prefix.length);
            assert.ok(Object.hasOwn(graph, name));
            return compiler.transform(graph[name], { filePath: name, commonjs: false });
          },
        },
      ],
    });
    try {
      const result = await bundle.generate({
        format: "iife",
        name: "OfflineAuthored",
        exports: "named",
        compact: true,
        sourcemap: false,
      });
      assert.equal(result.output.length, 1);
      const [chunk] = result.output;
      assert.equal(chunk.type, "chunk");
      assert.deepEqual(chunk.imports, []);
      assert.deepEqual(chunk.dynamicImports, []);
      compiler.parseJavaScript(chunk.code, { sourceType: "script" });
      return chunk.code;
    } finally {
      await bundle.close();
    }
  }
  const context = {};
  new Script(await link(modules)).runInNewContext(context);
  const authored = context.OfflineAuthored;
  assert.equal(authored.count, 2);
  authored.bump();
  assert.equal(authored.count, 3, "Live reexports survive the real compiler/linker");
  const view = authored.View();
  assert.equal(view.type, "span");
  assert.equal(view.props["data-count"], 3);
  assert.equal(view.props.children, "Offline");
  await assert.rejects(
    link({ ...modules, "/main.tsx": "import {missing} from 'not-shipped';export {missing};" }),
    /Closed graph rejected not-shipped/u,
  );
  const css = compiler.parseCss(":root{--color:var(--fallback,#123)}");
  const functions = [];
  compiler.walkCss(css, (node) => {
    if (node.type === "Function") functions.push(compiler.decodeCssIdentifier(node.name));
  });
  assert.deepEqual(functions, ["var"]);
  assert.match(compiler.generateCss(css), /--color:var/u);
  assert.deepEqual(attempts, []);
  console.log(
    JSON.stringify({
      source: manifest.source,
      compiler: manifest.artifacts.compiler,
      moduleExports,
      graphExports: Object.keys(authored).sort(),
      count: authored.count,
      attempts,
    }),
  );
}

test("shipped release assets match current source and compile a closed graph without packages or native addons", async (t) => {
  const manifest = await readPrebuiltManifest(PLUGIN_ROOT);
  const source = await readSourceState(PLUGIN_ROOT);
  assert.deepEqual(manifest.source, source.source);
  assert.deepEqual(manifest.buildInputs, source.buildInputs);
  assert.deepEqual(
    validateRuntimeModuleExports(manifest.artifacts.app.metadata.moduleExports),
    manifest.artifacts.app.metadata.moduleExports,
  );
  const manifestBytes = readFileSync(join(PLUGIN_ROOT, ASSETS, "manifest.json"));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "data-released-compiler-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plugin = join(root, "plugin");
  for (const name of Object.keys(manifest.buildInputs)) {
    const bytes = readFileSync(join(PLUGIN_ROOT, name));
    assert.equal(sha256(bytes), manifest.buildInputs[name]);
    write(join(plugin, name), bytes);
  }
  write(join(plugin, "scripts/data-app-runtime.mjs"), readFileSync(join(PLUGIN_ROOT, "scripts/data-app-runtime.mjs")));
  write(join(plugin, ASSETS, "manifest.json"), manifestBytes);
  for (const [name, filename] of Object.entries(ARTIFACT_PATHS)) {
    const bytes = readFileSync(join(PLUGIN_ROOT, ASSETS, filename));
    assert.equal(bytes.length, manifest.artifacts[name].bytes);
    assert.equal(sha256(bytes), manifest.artifacts[name].sha256);
    write(join(plugin, ASSETS, filename), bytes);
  }
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const name of ["node", "npm", "npx", "pnpm", "yarn", "vite", "rolldown", "esbuild"]) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 86\n", { mode: 0o755 });
    writeFileSync(join(bin, `${name}.cmd`), "@echo off\r\nexit /b 86\r\n");
  }
  for (const name of ["react", "sucrase", "acorn", "css-tree", "@rollup/browser", "vite", "rolldown", "esbuild"]) {
    write(join(root, "node_modules", name, "package.json"), jsonBytes({ name, main: "index.cjs" }));
    write(
      join(root, "node_modules", name, "index.cjs"),
      `throw new Error(${JSON.stringify(`Ambient package ${name} was loaded`)});\n`,
    );
  }
  const loader = join(root, "closed-module-loader.mjs");
  write(
    loader,
    [
      'import { isBuiltin } from "node:module";',
      'import { isAbsolute, relative, sep } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "export async function resolve(specifier, context, nextResolve) {",
      '  if (!isBuiltin(specifier) && !specifier.startsWith("file:") && !specifier.startsWith("./") && !specifier.startsWith("../")) throw new Error(`External ESM package rejected: ${specifier}`);',
      "  const result = await nextResolve(specifier, context);",
      '  if (result.url.startsWith("file:")) {',
      "    const name = relative(process.env.DATA_RUNTIME_TEST_ROOT, fileURLToPath(result.url));",
      '    if (name === ".." || name.startsWith(`..${sep}`) || isAbsolute(name)) throw new Error(`ESM file escaped the isolated release: ${specifier}`);',
      "  }",
      "  return result;",
      "}",
      "",
    ].join("\n"),
  );
  const runner = join(root, "probe.mjs");
  write(runner, `await (${probeReleasedCompiler.toString()})();\n`);
  const before = treeInventory(root);
  const environment = Object.fromEntries(
    Object.entries(dataNodeEnvironment(process.env)).filter(([name]) => name.toUpperCase() !== "PATH"),
  );
  const result = spawnSync(
    process.execPath,
    ["--no-addons", "--experimental-loader", pathToFileURL(loader).href, runner],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...environment,
        PATH: bin,
        NODE_PATH: join(root, "node_modules"),
        DATA_RUNTIME_TEST_ROOT: root,
        npm_config_offline: "true",
        npm_config_registry: "http://127.0.0.1:9",
      },
    },
  );
  assertSuccessful(result);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.source, manifest.source);
  assert.deepEqual(report.compiler, manifest.artifacts.compiler);
  assert.deepEqual(report.moduleExports, manifest.artifacts.app.metadata.moduleExports);
  assert.deepEqual(report.graphExports, ["View", "bump", "count"]);
  assert.equal(report.count, 3);
  assert.deepEqual(report.attempts, []);
  assert.deepEqual(treeInventory(root), before);
  assert.equal(existsSync(join(plugin, "node_modules")), false);
  assert.deepEqual(await readPrebuiltManifest(PLUGIN_ROOT), manifest, "The real source and assets remain unchanged");
  assert.deepEqual(readFileSync(join(PLUGIN_ROOT, ASSETS, "manifest.json")), manifestBytes);
  t.diagnostic(`Released manifest ${sha256(manifestBytes)}; compiler ${manifest.artifacts.compiler.sha256}`);
});
