import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { Worker as NodeWorker } from "node:worker_threads";
import { once } from "node:events";
import test from "node:test";

import compiler from "../assets/data-app-runtime/compiler.cjs";
import { AUTHORED_RUNTIME_MODULES, compileAuthoredModules } from "../scripts/authored-module-graph.mjs";
import { encodeDataAssetFragment } from "../scripts/data-url.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DASHBOARD = "src/content/dashboard/DashboardContent.jsx";
const REPORT = "src/content/report/ReportContent.jsx";
const DEFAULT_FILES = {
  "src/theme.css": ":root{--test-color:#123456}",
  "src/content/dashboard/dashboard.css": ".dashboard{color:var(--test-color)}",
  "src/content/report/report.css": ".report{display:block}",
  "src/data-app-public.jsx": "export const protectedMarker = true;",
  "src/data.json": '{"label":"unreviewed source bytes"}',
  [DASHBOARD]: "export function DashboardContent(){return 'dashboard'}",
  [REPORT]: "export function ReportContent(){return 'report'}",
};

async function write(root, filename, contents) {
  const path = join(root, filename);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "data-authored-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [filename, contents] of Object.entries({ ...DEFAULT_FILES, ...files })) {
    await write(root, filename, contents);
  }
  return root;
}

function namespace(values = {}, defaultExport = values) {
  const result = { ...values, default: defaultExport };
  Object.defineProperty(result, "__esModule", { value: true });
  return Object.freeze(result);
}

function runtimeFixture(overrides = {}) {
  const jsx = (type, props, key) => ({ type, props, key });
  const React = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useEffect: () => {},
    useState: (value) => [typeof value === "function" ? value() : value, () => {}],
  };
  const publicNames = [
    "ChartRenderer",
    "Chart",
    "chartDataShape",
    "chartSpecKeys",
    "projectChartSpec",
    "compact",
    "displayValue",
    "label",
    "percentage",
    "periodComparison",
    "semanticColorResolver",
    "shortDate",
    "DataTable",
    "Table",
    "Dropdown",
    "Filters",
    "InlineFilters",
    "DataComponent",
    "MetricCard",
    "MetricSparkline",
    "EditableText",
    "Icon",
    "SourceInspector",
    "SourceSidebar",
    "useDataApp",
    "useDashboardTabs",
    "previousPeriodRows",
    "SortableItem",
    "SortableRegion",
  ];
  const publicApi = Object.fromEntries(publicNames.map((name) => [name, (...args) => ({ name, args })]));
  const ReactMarkdown = () => "markdown";
  const modules = {
    "@openai/data-app": namespace(publicApi),
    react: namespace(React, React),
    "react/jsx-runtime": namespace({ jsx, jsxs: jsx, Fragment: React.Fragment }),
    "react/jsx-dev-runtime": namespace({ jsxDEV: jsx, Fragment: React.Fragment }),
    "react-dom": namespace({ flushSync: (callback) => callback() }),
    "react-dom/client": namespace({ createRoot: () => ({ render() {} }) }),
    recharts: namespace({ LineChart: () => "line-chart" }),
    "react-markdown": namespace({ MarkdownHooks: () => "markdown-hooks" }, ReactMarkdown),
    ...overrides,
  };
  return { modules };
}

function runtimeExports(runtime = runtimeFixture()) {
  return Object.fromEntries(
    AUTHORED_RUNTIME_MODULES.map((specifier) => [
      specifier,
      Object.getOwnPropertyNames(runtime.modules[specifier]).sort(),
    ]),
  );
}

function runtimeFixtureWithExports(moduleExports) {
  const base = runtimeFixture();
  return {
    modules: Object.fromEntries(
      AUTHORED_RUNTIME_MODULES.map((specifier) => {
        const original = base.modules[specifier];
        const values = Object.fromEntries(
          moduleExports[specifier]
            .filter((name) => name !== "default" && name !== "__esModule")
            .map((name) => [name, Object.hasOwn(original, name) ? original[name] : () => undefined]),
        );
        return [specifier, namespace(values, original.default)];
      }),
    ),
  };
}

function instantiate(compiled, { runtime = runtimeFixture(), snapshot = {}, globals = {} } = {}) {
  const factory = new Script(compiled.factorySource, { filename: "authored-factory.js" }).runInNewContext(globals);
  return factory(runtime, snapshot);
}

async function compile(root, runtimeModuleExports = runtimeExports()) {
  return compileAuthoredModules({ projectRoot: root, compiler, runtimeModuleExports });
}

test("inline calculation Workers link local modules and preserve messages, errors and URL cleanup", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]: 'import Calculation from "./calculation.ts?worker&inline"; export function DashboardContent(options){return new Calculation(options)}',
    "src/content/dashboard/calculation.ts": 'import {sum} from "./sum.ts"; self.onmessage = ({data}) => { if(data.fail) throw new Error("calculation failed"); self.postMessage({key:data.key, value:sum(data.rows)}); };',
    "src/content/dashboard/sum.ts": 'import config from "./config.json"; export const sum = (rows: number[]) => rows.reduce((a,b)=>a+b,0) * config.scale;',
    "src/content/dashboard/config.json": '{"scale":2}',
  });
  const compiled = await compile(root);
  const urls = new Map(), revoked = [], workers = [];
  let serial = 0;
  class CalculationWorker extends EventTarget {
    constructor(url, options) {
      super();
      assert.equal(options.name, "test-calculation");
      this.thread = new NodeWorker('const {parentPort}=require("node:worker_threads"); globalThis.self={postMessage:data=>parentPort.postMessage(data)}; parentPort.on("message",data=>self.onmessage({data}));\n' + urls.get(url), {eval:true});
      this.thread.on("message", data => this.dispatchEvent(new MessageEvent("message", {data})));
      this.thread.on("error", () => this.dispatchEvent(new Event("error")));
      workers.push(this);
    }
    postMessage(data) { this.thread.postMessage(data); }
    terminate() { return this.thread.terminate(); }
  }
  t.after(() => Promise.all(workers.map(worker => worker.thread.terminate())));
  const globals = {
    Blob: class { constructor(parts) { this.source = parts.join(""); } },
    URL: {createObjectURL(blob) { const url=`blob:test-${++serial}`; urls.set(url,blob.source); return url; },
      revokeObjectURL(url) { revoked.push(url); urls.delete(url); }},
    Worker: CalculationWorker,
  };
  const create = instantiate(compiled, {globals}).DashboardContent;
  const worker = create({name:"test-calculation"});
  const first = once(worker, "message");
  worker.postMessage({key:"scope-a",rows:[2,3]});
  assert.deepEqual((await first)[0].data, {key:"scope-a",value:10});
  assert.equal(urls.size,0);
  const next = once(worker,"message");
  worker.postMessage({key:"scope-b",rows:[9]});
  assert.deepEqual((await next)[0].data,{key:"scope-b",value:18});
  worker.terminate();
  assert.equal(revoked.length,1,"message and termination release the URL only once");
  create({name:"test-calculation"}).terminate();
  assert.equal(revoked.length,2,"termination before first reply releases the URL");
  const failed=create({name:"test-calculation"});
  const failure=once(failed,"error");
  failed.postMessage({fail:true});
  await failure;
  assert.equal(revoked.length,3,"asynchronous Worker errors remain observable and release the URL");
  const throws=instantiate(compiled,{globals:{...globals,Worker:class {constructor(){throw new Error("Worker unavailable")}}}}).DashboardContent;
  assert.throws(()=>throws(),/Worker unavailable/);
  assert.equal(urls.size,0,"construction failure does not leak a URL");
  assert.equal(revoked.length,4);
  assert(compiled.sourceFiles.includes("src/content/dashboard/config.json"));
});

test("calculation Worker graphs retain authored ownership and dependency boundaries", async (t) => {
  const root=await fixture(t, {
    [DASHBOARD]: 'import Calculation from "./calculation.js?worker&inline"; export function DashboardContent(){return new Calculation()}',
    "src/content/dashboard/child.js":"self.postMessage(1);",
  });
  for(const [source,pattern] of [
    ['import React from "react";',/UI runtime/],
    ['import data from "../../data.json";',/protected UI or snapshot/],
    ['import "./dashboard.css";',/local JavaScript\/TypeScript and JSON/],
    ['import Worker from "./child.js?worker&inline";',/nested/],
    ['import "https://example.com/worker.js";',/invalid local path/],
    ['import "../../../../../outside.js";',/outside src\/content/],
  ]) {
    await write(root,"src/content/dashboard/calculation.js",source);
    await assert.rejects(compile(root),pattern);
  }
});

test("the bundled compiler exposes the mature, pure-JavaScript module bundler", () => {
  assert.equal(compiler.apiVersion, 1);
  assert.equal(typeof compiler.rollup, "function");
  assert.deepEqual(AUTHORED_RUNTIME_MODULES, Object.keys(runtimeFixture().modules).sort());
});

test("requires an exact validated runtime export map before reading authored files", async () => {
  const valid = runtimeExports();
  const missing = structuredClone(valid);
  delete missing.recharts;
  const extra = { ...valid, "node:fs": ["__esModule", "default"] };
  const unsorted = structuredClone(valid);
  unsorted.react.reverse();
  const duplicate = structuredClone(valid);
  duplicate.react.splice(1, 0, duplicate.react[0]);
  const withoutDefault = structuredClone(valid);
  withoutDefault.react = withoutDefault.react.filter((name) => name !== "default");
  const withoutMarker = structuredClone(valid);
  withoutMarker.react = withoutMarker.react.filter((name) => name !== "__esModule");
  for (const runtimeModuleExports of [
    undefined,
    null,
    [],
    missing,
    extra,
    unsorted,
    duplicate,
    withoutDefault,
    withoutMarker,
  ]) {
    await assert.rejects(
      compileAuthoredModules({ projectRoot: "/deliberately/missing/project", compiler, runtimeModuleExports }),
      /prebuilt runtime (?:module export map|export)/iu,
    );
  }
});

test("compiles nested JSX/TSX, extensionless/index imports, and one shared React namespace", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]: `import React, {useState} from "react";
      import {Widget} from "../shared/widget";
      import {compact} from "../../data-app-public.jsx";
      import {LineChart} from "recharts";
      import Markdown from "react-markdown";
      export function DashboardContent(){const [n]=useState(3);return <Widget n={n} react={React} compact={compact} chart={LineChart} markdown={Markdown}/>}`,
    "src/content/shared/widget/index.tsx": `import {format} from "./format.mjs";
      type Props={n:number}; export function Widget(props:Props){return <span>{format(props.n)}</span>}`,
    "src/content/shared/widget/format.mjs": "export const format = (n) => `value:${n}`;",
  });
  const compiled = await compile(root);
  const runtime = runtimeFixture();
  const { DashboardContent, ReportContent } = instantiate(compiled, { runtime });
  const view = DashboardContent();
  assert.equal(view.props.n, 3);
  assert.equal(view.props.react, runtime.modules.react.default);
  assert.equal(view.props.compact, runtime.modules["@openai/data-app"].compact);
  assert.equal(view.props.chart, runtime.modules.recharts.LineChart);
  assert.equal(view.props.markdown, runtime.modules["react-markdown"].default);
  assert.equal(view.type(view.props).props.children, "value:3");
  assert.equal(ReportContent(), "report");
  assert.equal(compiled.moduleCount, 4);
  assert.equal(compiled.assetCount, 0);
  assert.match(compiled.themeCss, /--test-color:#123456/u);
  assert.match(compiled.styles, /\.dashboard\{/u);
  assert.doesNotMatch(compiled.factorySource, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("does not execute authored top-level code while compiling", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]: "globalThis.dataAuthoredExecuted=true;export function DashboardContent(){return 1}",
  });
  assert.equal(globalThis.dataAuthoredExecuted, undefined);
  const compiled = await compile(root);
  assert.equal(globalThis.dataAuthoredExecuted, undefined);
  const globals = {};
  instantiate(compiled, { globals });
  assert.equal(globals.dataAuthoredExecuted, true);
  assert.equal(globalThis.dataAuthoredExecuted, undefined);
});

test("compiles typed .mts modules rather than turning their source into an asset URL", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]: `import value, {count, bump} from "../shared/value.mts";
      import upper from "../shared/upper.MTS";
      export function DashboardContent(){return {value,count,bump,upper}}`,
    "src/content/shared/value.mts": `import type {MissingType} from "./type-only-missing.mts";
      const value:string="MTS_MODULE_VALUE_73";export default value;
      export let count:number=1;export const bump=()=>{count+=1};`,
    "src/content/shared/upper.MTS": 'const identity=<T>(value:T):T=>value;export default identity("uppercase");',
  });
  const compiled = await compile(root);
  const { DashboardContent } = instantiate(compiled);
  const view = DashboardContent();
  assert.equal(view.value, "MTS_MODULE_VALUE_73");
  assert.equal(view.upper, "uppercase");
  assert.equal(view.count, 1);
  view.bump();
  assert.equal(DashboardContent().count, 2);
  assert.equal(compiled.assetCount, 0);
  assert.equal(compiled.moduleCount, 4);
  assert.ok(compiled.sourceFiles.includes("src/content/shared/value.mts"));
  assert.ok(!compiled.sourceFiles.some((name) => name.includes("type-only-missing")));
  assert.equal(compiled.styles, compiled.conventionalCss);
  assert.equal(compiled.importedCss, "");
  for (const filename of ["value.mts", "upper.MTS"]) {
    await write(
      root,
      DASHBOARD,
      `import value from "../shared/${filename}#fragment";export function DashboardContent(){return value}`,
    );
    await assert.rejects(compile(root), /fragment on a JavaScript module.*--source/u);
  }
});

test("matches Vite extensionless file and index precedence without loading unused siblings", async (t) => {
  const precedence = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];
  const files = {};
  const imports = [];
  const bindings = [];
  const expected = [];
  for (let index = 0; index < precedence.length; index++) {
    for (const kind of ["file", "directory"]) {
      const basename = `${kind}${index}`;
      const binding = `${kind}${index}`;
      imports.push(`import ${binding} from "../shared/${basename}";`);
      bindings.push(binding);
      expected.push(precedence[index]);
      for (const extension of precedence.slice(index)) {
        const path = `src/content/shared/${basename}${kind === "directory" ? "/index" : ""}${extension}`;
        files[path] =
          extension === ".json" ? JSON.stringify(extension) : `export default ${JSON.stringify(extension)};`;
      }
    }
  }
  // A file candidate wins before even the highest-priority directory index.
  files["src/content/shared/file-before-index.json"] = '"file-before-index"';
  files["src/content/shared/file-before-index/index.mjs"] = 'export default "wrong-index";';
  imports.push('import fileBeforeIndex from "../shared/file-before-index";');
  bindings.push("fileBeforeIndex");
  expected.push("file-before-index");
  files[DASHBOARD] = `${imports.join("\n")}export function DashboardContent(){return [${bindings.join(",")}]}`;
  const root = await fixture(t, files);
  const compiled = await compile(root);
  assert.deepEqual(Array.from(instantiate(compiled).DashboardContent()), expected);
  assert.equal(compiled.assetCount, 0);
  assert.equal(compiled.moduleCount, expected.length + 2);
  assert.ok(!compiled.sourceFiles.includes("src/content/shared/file-before-index/index.mjs"));
});

test("rejects unsupported CommonJS code suffixes while retaining explicit raw and URL imports", async (t) => {
  const root = await fixture(t);
  for (const filename of ["value.cjs", "value.cts", "upper.CJS", "upper.CTS"]) {
    const source = 'module.exports="COMMONJS_SOURCE_29";';
    await write(root, `src/content/shared/${filename}`, source);
    for (const imported of [`import value from "../shared/${filename}";`, `import "../shared/${filename}";`]) {
      await write(root, DASHBOARD, `${imported}export function DashboardContent(){return 1}`);
      await assert.rejects(compile(root), /compile CommonJS \.cjs or \.cts modules.*--source/u);
    }
    await write(
      root,
      DASHBOARD,
      `import raw from "../shared/${filename}?raw";
      import url from "../shared/${filename}?url";export function DashboardContent(){return {raw,url}}`,
    );
    const result = instantiate(await compile(root)).DashboardContent();
    assert.equal(result.raw, source);
    assert.equal(result.url, `data:application/octet-stream;base64,${Buffer.from(source).toString("base64")}`);
  }
});

test("preserves live imported-local and star reexports", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]: `import * as bridge from "../shared/bridge.js";
      export function DashboardContent(){return {count:bridge.count,alias:bridge.alias,bump:bridge.bump}}`,
    "src/content/shared/counter.js": "export let count=0;export function bump(){count++}",
    "src/content/shared/bridge.js": `import {count,bump} from "./counter.js";export {count,bump};
      export {count as alias} from "./counter.js";export * from "./counter.js";`,
  });
  const { DashboardContent } = instantiate(await compile(root));
  const first = DashboardContent();
  assert.equal(first.count, 0);
  first.bump();
  assert.equal(DashboardContent().count, 1);
  assert.equal(DashboardContent().alias, 1);
});

test("keeps ambiguous star exports absent instead of choosing the first module", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]: 'import * as values from "../shared/barrel.js";export function DashboardContent(){return values}',
    "src/content/shared/a.js": "export const shared=1;export const onlyA=3;",
    "src/content/shared/b.js": "export const shared=2;export const onlyB=4;",
    "src/content/shared/barrel.js": 'export * from "./a.js";export * from "./b.js";',
  });
  const compiled = await compile(root);
  const values = instantiate(compiled).DashboardContent();
  assert.equal(values.onlyA, 3);
  assert.equal(values.onlyB, 4);
  assert.equal(Object.hasOwn(values, "shared"), false);
  await write(
    root,
    DASHBOARD,
    'import {shared} from "../shared/barrel.js";export function DashboardContent(){return shared}',
  );
  await assert.rejects(compile(root), /bundle authored modules.*--source/u);
});

test("preserves cyclic function hoisting and reports genuine cyclic TDZ errors", async (t) => {
  const working = await fixture(t, {
    [DASHBOARD]: 'import {value} from "../shared/a.js";export function DashboardContent(){return value}',
    "src/content/shared/a.js": 'import {value} from "./b.js";export function f(){return 7};export {value};',
    "src/content/shared/b.js": 'import {f} from "./a.js";export const value=f();',
  });
  const compiled = await compile(working);
  assert.equal(instantiate(compiled).DashboardContent(), 7);
  assert.ok(compiled.warnings.some((warning) => warning.code === "CIRCULAR_DEPENDENCY"));

  const tdz = await fixture(t, {
    [DASHBOARD]: 'import {value} from "../shared/a.js";export function DashboardContent(){return value}',
    "src/content/shared/a.js": 'import {value} from "./b.js";export const original=7;export {value};',
    "src/content/shared/b.js": 'import {original} from "./a.js";export const value=original;',
  });
  const tdzCompiled = await compile(tdz);
  assert.throws(() => instantiate(tdzCompiled), { name: "ReferenceError" });
});

test("uses reviewed snapshot input and safely represents JSON __proto__ and script-closing strings", async (t) => {
  const payload =
    '{"__proto__":{"polluted":"no"},"constructor":"data","nested":{"text":"</script><script>bad()</script>"}}';
  const root = await fixture(t, {
    [DASHBOARD]: `import reviewed,{label} from "../../data.json";
      import * as reviewedNamespace from "../../data.json";
      import * as jsonNamespace from "../shared/data.json";
      import value,{constructor as ownConstructor} from "../shared/data.json";
      export function DashboardContent(){return {reviewed,reviewedNamespace,jsonNamespace,label,value,ownProto:value["__proto__"],ownConstructor}}`,
    "src/content/shared/data.json": payload,
  });
  const compiled = await compile(root);
  const snapshot = JSON.parse('{"label":"reviewed","__proto__":{"source":"safe"}}');
  const result = instantiate(compiled, { snapshot }).DashboardContent();
  assert.equal(result.reviewed, snapshot);
  assert.equal(result.label, "reviewed");
  assert.equal(Object.hasOwn(result.value, "__proto__"), true);
  assert.equal(result.ownProto, result.value.__proto__);
  assert.equal(Object.hasOwn(result.jsonNamespace, "__proto__"), false);
  assert.equal(result.jsonNamespace.default, result.value);
  assert.equal(Object.isFrozen(result.reviewedNamespace), true);
  assert.equal(Object.hasOwn(result.reviewedNamespace, "__proto__"), false);
  assert.equal(Object.hasOwn(result.reviewedNamespace.default, "__proto__"), true);
  assert.equal(result.ownConstructor, "data");
  assert.equal(result.value.nested.text, "</script><script>bad()</script>");
  assert.notEqual(Object.getPrototypeOf(result.value), result.value.__proto__);
  assert.equal(Object.prototype.polluted, undefined);
  assert.doesNotMatch(compiled.factorySource, /<\/script/iu);
  assert.match(compiled.factorySource, /JSON\.parse/u);
});

test("rejects exotic __proto__ ESM exports while preserving default JSON access", async (t) => {
  const root = await fixture(t, { "src/content/shared/data.json": '{"__proto__":{"safe":true}}' });
  for (const exported of [
    "export const __proto__=1;",
    "export const {value:__proto__}={value:1};",
    "export function __proto__(){}",
    "const value=1;export {value as __proto__};",
    'export {default as "__proto__"} from "./data.json";',
    'export * as __proto__ from "./data.json";',
  ]) {
    await write(root, "src/content/shared/exotic.js", exported);
    await write(
      root,
      DASHBOARD,
      'import * as exotic from "../shared/exotic.js";export function DashboardContent(){return exotic}',
    );
    await assert.rejects(compile(root), /export the ESM name "__proto__".*--source/u, exported);
  }
  for (const source of ["../shared/data.json", "../../data.json"]) {
    await write(
      root,
      DASHBOARD,
      `import {__proto__ as value} from ${JSON.stringify(source)};export function DashboardContent(){return value}`,
    );
    await assert.rejects(compile(root), /import JSON key "__proto__" as a named export.*--source/u);
  }
});

test("allows legitimate scope-shadowed CommonJS names and rejects unbound Node bindings", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]: `const require=(value)=>value+"!";const module={exports:"module"};const exports="exports";
      function nested(require){return require(7)}
      function caught(){try{throw (x)=>x+1}catch(require){return require(2)}}
      export function DashboardContent(){return [require("own"),module.exports,exports,nested(x=>x*2),caught()]}`,
  });
  assert.deepEqual(Array.from(instantiate(await compile(root)).DashboardContent()), [
    "own!",
    "module",
    "exports",
    14,
    3,
  ]);
  for (const source of [
    'export function DashboardContent(){return require("react")}',
    'const load=require;export function DashboardContent(){return load("react")}',
    "export function DashboardContent(){return module.exports}",
    "export function DashboardContent(){return exports.value}",
    "export function DashboardContent(){return __dirname}",
    "export function DashboardContent(){return __filename}",
    "export function DashboardContent(){return typeof require}",
    'function okay(require){return require(1)};export function DashboardContent(){return require("react")}',
    'function wrong(value=require("react")){var require;return value}export function DashboardContent(){return wrong()}',
    "function wrong(value=module.exports){var module;return value}export function DashboardContent(){return wrong()}",
    "const wrong=(value=exports.value)=>{var exports;return value};export function DashboardContent(){return wrong()}",
  ]) {
    await write(root, DASHBOARD, source);
    await assert.rejects(compile(root), /Node\/CommonJS binding.*--source/u);
  }
});

test("rejects both literal and computed dynamic imports instead of changing lazy side effects", async (t) => {
  const root = await fixture(t, { "src/content/shared/lazy.js": "export default 1;" });
  for (const expression of ['import("../shared/lazy.js")', "import(`../shared/lazy.js`)", "import(name)"]) {
    await write(root, DASHBOARD, `export function DashboardContent(name){return ${expression}}`);
    await assert.rejects(compile(root), /lazy dynamic-import evaluation.*--source/u);
  }
});

test("rejects top-level await and import.meta while allowing await inside authored functions", async (t) => {
  const root = await fixture(t);
  for (const source of [
    "await Promise.resolve();export function DashboardContent(){}",
    "for await (const item of []){}export function DashboardContent(){}",
    "export function DashboardContent(){return import.meta.url}",
  ]) {
    await write(root, DASHBOARD, source);
    await assert.rejects(compile(root), /(?:top-level await|import\.meta).*--source/u);
  }
  await write(root, DASHBOARD, "export async function DashboardContent(){return await Promise.resolve(7)}");
  assert.equal(await instantiate(await compile(root)).DashboardContent(), 7);
});

test("embeds nested CSS imports, escaped URLs, image-set assets, raw text, and inline/URL CSS", async (t) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="mark"/></svg>';
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const root = await fixture(t, {
    "src/theme.css": ':root{--logo:url("./content/assets/logo.svg")}',
    "src/content/dashboard/dashboard.css": String.raw`@import "../shared/base.css" layer(brand) supports(display:grid) screen and (min-width:1px);
      .dashboard{background:u\72 l("../assets/logo.svg#mark");mask-image:image-set("../assets/pixel.png" 1x,url(data:image/png;base64,AAAA) 2x);filter:url(#clip)}`,
    "src/content/shared/base.css":
      '@font-face{font-family:Example;src:local("Example"),url("../assets/example.woff2")} .base{display:grid}',
    "src/content/shared/extra.css": ".extra{color:red}",
    "src/content/shared/inline.css": '.inline{background:url("../assets/pixel.png")}',
    "src/content/assets/logo.svg": svg,
    "src/content/assets/pixel.png": png,
    "src/content/assets/example.woff2": Buffer.from("font fixture"),
    [DASHBOARD]: `import "../shared/extra.css";
      import css from "../shared/inline.css?inline";
      import cssUrl from "../shared/inline.css?url";
      import raw from "../assets/logo.svg?raw";
      import logo from "../assets/logo.svg?url";
      import image from "../assets/pixel.png";
      export function DashboardContent(){return {css,cssUrl,raw,logo,image}}`,
  });
  const compiled = await compile(root);
  const result = instantiate(compiled).DashboardContent();
  assert.equal(result.raw, svg);
  assert.equal(result.logo, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  assert.equal(result.image, `data:image/png;base64,${png.toString("base64")}`);
  assert.match(result.css, /data:image\/png;base64,/u);
  assert.equal(Buffer.from(result.cssUrl.split(",")[1], "base64").toString(), result.css);
  assert.match(compiled.themeCss, /data:image\/svg\+xml;base64,/u);
  assert.match(compiled.styles, /@layer brand\{@supports \(display:grid\)\{@media screen and \(min-width:1px\)/u);
  assert.match(compiled.styles, /data:font\/woff2;base64,/u);
  assert.match(compiled.styles, /#mark/u);
  assert.match(compiled.styles, /url\(#clip\)/u);
  assert.match(compiled.styles, /\.extra\{color:red\}/u);
  assert.doesNotMatch(compiled.styles, /\.inline\{/u);
  assert.doesNotMatch(compiled.styles, /@import/u);
  assert.equal(compiled.assetCount, 4);
  assert.ok(compiled.cssFiles.includes("src/content/shared/base.css"));
  assert.ok(compiled.sourceFiles.includes("src/content/assets/pixel.png"));
});

test("treats plain .pcss and .postcss as CSS through side effects, imports, raw, inline, and URL forms", async (t) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const pcss = '@import "./leaf.postcss"; .chain { display: grid; }';
  const postcss = '.leaf { mask-image: url("../assets/mark.svg"); }';
  const rawOnly = ".raw-only { color: blue; }";
  const root = await fixture(t, {
    "src/content/dashboard/dashboard.css": '@import "../shared/base.css";.dashboard{display:block}',
    "src/content/shared/base.css": '@import "./chain.pcss";.base{color:red}',
    "src/content/shared/chain.pcss": pcss,
    "src/content/shared/leaf.postcss": postcss,
    "src/content/shared/side.PCSS": ".pcss-side-effect{color:red}",
    "src/content/shared/side.postcss": ".postcss-side-effect{color:blue}",
    "src/content/shared/raw-only.pcss": rawOnly,
    "src/content/assets/mark.svg": svg,
    [DASHBOARD]: `import "../shared/side.PCSS";import "../shared/side.postcss";
      import pcss from "../shared/chain.pcss?inline";import postcss from "../shared/leaf.postcss?inline";
      import pcssUrl from "../shared/chain.pcss?url";import postcssUrl from "../shared/leaf.postcss?url";
      import pcssRaw from "../shared/chain.pcss?raw";import postcssRaw from "../shared/leaf.postcss?raw";
      import rawOnly from "../shared/raw-only.pcss?raw";
      export function DashboardContent(){return {pcss,postcss,pcssUrl,postcssUrl,pcssRaw,postcssRaw,rawOnly}}`,
  });
  const compiled = await compile(root);
  const result = instantiate(compiled).DashboardContent();
  assert.equal(result.pcssRaw, pcss);
  assert.equal(result.postcssRaw, postcss);
  assert.equal(result.rawOnly, rawOnly);
  for (const extension of ["pcss", "postcss"]) {
    assert.match(result[extension], /data:image\/svg\+xml;base64,/u);
    assert.doesNotMatch(result[extension], /@import/u);
    assert.match(result[`${extension}Url`], /^data:text\/css;base64,/u);
    assert.equal(Buffer.from(result[`${extension}Url`].split(",")[1], "base64").toString(), result[extension]);
  }
  assert.match(compiled.conventionalCss, /\.leaf\{/u);
  assert.match(compiled.conventionalCss, /\.chain\{display:grid\}/u);
  assert.equal(compiled.importedCss, ".pcss-side-effect{color:red}\n.postcss-side-effect{color:blue}");
  assert.equal(compiled.styles, `${compiled.conventionalCss}\n${compiled.importedCss}`);
  assert.equal(compiled.assetCount, 3);
  for (const name of ["chain.pcss", "leaf.postcss", "side.PCSS", "side.postcss"]) {
    assert.ok(compiled.cssFiles.includes(`src/content/shared/${name}`));
  }
});

test("separates conventional styles from component-imported styles without changing the combined field", async (t) => {
  const root = await fixture(t, {
    "src/content/dashboard/dashboard.css": '@import "../shared/conventional.css";.dashboard{color:red}',
    "src/content/shared/conventional.css": ".conventional-extra{color:green}",
    "src/content/shared/first.css": ".first{color:blue}",
    "src/content/shared/second.css": "@media print{.second{display:block}}",
    "src/content/shared/report-extra.css": ".report-extra{color:gray}",
    "src/content/shared/helper.js": 'import "./second.css";export const value=1;',
    [DASHBOARD]: `import "../shared/first.css";import "../shared/helper.js";
      import "../shared/first.css";import "./dashboard.css";import "../../theme.css";
      export function DashboardContent(){return "dashboard"}`,
    [REPORT]: 'import "../shared/report-extra.css";export function ReportContent(){return "report"}',
  });
  const compiled = await compile(root);
  assert.equal(
    compiled.conventionalCss,
    ".conventional-extra{color:green}.dashboard{color:red}\n.report{display:block}",
  );
  assert.equal(
    compiled.importedCss,
    ".first{color:blue}\n@media print{.second{display:block}}\n.report-extra{color:gray}",
  );
  assert.equal(compiled.styles, `${compiled.conventionalCss}\n${compiled.importedCss}`);
  assert.equal(compiled.themeCss, ":root{--test-color:#123456}");
});

test("applies the same network, circular-import, and fragment rejection to all plain CSS suffixes", async (t) => {
  for (const extension of ["css", "pcss", "postcss"]) {
    const root = await fixture(t, {
      [DASHBOARD]: `import "../shared/a.${extension}";export function DashboardContent(){return 1}`,
      [`src/content/shared/a.${extension}`]: String.raw`.x{background:u\72/**/l("https://tracker.example.test/image")}`,
    });
    await assert.rejects(compile(root), /external CSS resource.*--source/u);
    await write(root, `src/content/shared/a.${extension}`, `@import "./b.${extension}";`);
    await write(root, `src/content/shared/b.${extension}`, `@import "./a.${extension}";`);
    await assert.rejects(compile(root), /circular CSS @import.*--source/u);
    await write(root, `src/content/shared/a.${extension}`, ".x{color:red}");
    for (const query of ["", "?inline", "?url"]) {
      await write(
        root,
        DASHBOARD,
        `import "../shared/a.${extension}${query}#fragment";export function DashboardContent(){return 1}`,
      );
      await assert.rejects(compile(root), /fragment on a stylesheet.*--source/u);
    }
  }
});

test("punctuation-heavy SVG fragments survive the actual CSS generator without URL escapes", async (t) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="icon:(a)\'~"/></svg>';
  const fragments = ["icon:(a)'~", "shape!star*(v2)", "name/part?mode=on&value=1", "quote'and\"percent%", "unicode-雪"];
  const sourceUrls = fragments.map((fragment) => `../assets/icons.svg#${encodeURIComponent(fragment)}`);
  const css = sourceUrls
    .map((value, index) => `.icon-${index}{mask-image:${compiler.generateCss({ type: "Url", value })}}`)
    .join("");
  const imports = fragments
    .map(
      (fragment, index) =>
        `import icon${index} from ${JSON.stringify(`../assets/icons.svg?url#${encodeURIComponent(fragment)}`)};`,
    )
    .join("\n");
  const root = await fixture(t, {
    "src/content/assets/icons.svg": svg,
    "src/content/dashboard/dashboard.css": css,
    [DASHBOARD]: `${imports}\nexport function DashboardContent(){return [${fragments
      .map((_, index) => `icon${index}`)
      .join(",")}];}`,
  });
  const compiled = await compile(root);
  const expected = fragments.map(
    (fragment) =>
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}#${encodeDataAssetFragment(fragment)}`,
  );
  assert.deepEqual(Array.from(instantiate(compiled).DashboardContent()), expected);
  const cssUrls = [];
  compiler.walkCss(compiler.parseCss(compiled.styles), (node) => {
    if (node.type === "Url") cssUrls.push(node.value);
  });
  assert.deepEqual(cssUrls, expected);
  assert.equal(expected[0].split("#")[1], "icon%3A%28a%29%27~");
  for (let index = 0; index < expected.length; index++) {
    const value = expected[index];
    const encoded = value.split("#")[1];
    assert.doesNotMatch(encoded, /[!'()*]/u);
    assert.equal(decodeURIComponent(encoded), fragments[index]);
    const generated = compiler.generateCss({ type: "Url", value });
    assert.equal(generated, `url(${value})`);
    const roundtrip = [];
    const stylesheet = compiler.generateCss(compiler.parseCss(`.x{background:${generated}}`));
    compiler.walkCss(compiler.parseCss(stylesheet), (node) => {
      if (node.type === "Url") roundtrip.push(node.value);
    });
    assert.deepEqual(roundtrip, [value]);
  }
});

test("rejects remote CSS resources, including escaped functions exposed by generation", async (t) => {
  const root = await fixture(t);
  const cases = [
    '.x{background:url("https://tracker.example.test/pixel")}',
    '.x{background:url("//tracker.example.test/pixel")}',
    '.x{background:url("/not-embedded.png")}',
    String.raw`.x{background:u\72 l("https://tracker.example.test/pixel")}`,
    String.raw`:root{--x:u\72/**/l("https://tracker.example.test/pixel")}`,
    String.raw`:root{--x:\000075\000072\00006c/**/("https://tracker.example.test/pixel")}`,
    String.raw`:root{--x:var(--safe,u\72/**/l("https://tracker.example.test/pixel"))}`,
    '.x{background:image-set("https://tracker.example.test/pixel" 1x)}',
    String.raw`.x{background:var(--safe,i\6d age-set("https://tracker.example.test/pixel" 1x))}`,
    '@import "https://tracker.example.test/style.css";',
    String.raw`@\69mport "https://tracker.example.test/style.css";`,
  ];
  for (const css of cases) {
    await write(root, "src/theme.css", css);
    await assert.rejects(compile(root), /(?:external CSS resource|parse CSS|unresolved CSS).*--source/u, css);
  }
});

test("accepts already-embedded CSS assets and rejects incomplete CSS without repair", async (t) => {
  const root = await fixture(t, {
    "src/theme.css": ":root{--icon:url(data:image/svg+xml;base64,PHN2Zy8+);--filter:url(#local)}",
  });
  assert.match((await compile(root)).themeCss, /data:image\/svg\+xml;base64,PHN2Zy8\+/u);
  for (const css of [".x{", '.x{background:url("a")', '.x{content:"unterminated}', ".x{--x:var(--y}", "/*/"]) {
    await write(root, "src/theme.css", css);
    await assert.rejects(compile(root), /parse CSS.*--source/u, css);
  }
});

test("rejects unsupported stylesheet languages and circular CSS imports", async (t) => {
  const root = await fixture(t, {
    "src/content/shared/style.module.css": ".x{color:red}",
    "src/content/shared/style.scss": "$x:red;.x{color:$x}",
    "src/content/shared/a.css": '@import "./b.css";',
    "src/content/shared/b.css": '@import "./a.css";',
  });
  for (const name of [
    "style.module.css",
    "style.module.pcss",
    "style.module.postcss",
    "upper.module.PCSS",
    "style.scss",
  ]) {
    await write(root, `src/content/shared/${name}`, ".x{color:red}");
    await write(root, DASHBOARD, `import "../shared/${name}";export function DashboardContent(){}`);
    await assert.rejects(compile(root), /Sass, Less, or CSS modules.*--source/u);
    await write(root, DASHBOARD, "export function DashboardContent(){}");
    await write(root, "src/content/dashboard/dashboard.css", `@import "../shared/${name}";`);
    await assert.rejects(compile(root), /Sass, Less, or CSS modules.*--source/u);
    await write(root, "src/content/dashboard/dashboard.css", DEFAULT_FILES["src/content/dashboard/dashboard.css"]);
  }
  await write(root, DASHBOARD, 'import "../shared/a.css";export function DashboardContent(){}');
  await assert.rejects(compile(root), /circular CSS @import.*--source/u);
});

test("does not make invalid late or nested CSS imports take effect", async (t) => {
  const root = await fixture(t, { "src/content/shared/valid.css": ".imported{color:red}" });
  for (const source of [
    '.earlier{color:blue}@import "../shared/valid.css";',
    '@media screen{@import "../shared/valid.css";}',
  ]) {
    await write(root, "src/content/dashboard/dashboard.css", source);
    await assert.rejects(compile(root), /CSS @import.*--source/u);
  }
});

test("rejects unknown packages, URLs, protected imports, traversal, and missing files", async (t) => {
  const root = await fixture(t, {
    "src/App.jsx": "export default 1;",
    "outside.js": "export default 2;",
  });
  for (const specifier of [
    "lodash",
    "react-dom/server",
    "node:fs",
    "https://example.test/react.js",
    "data:text/javascript,export default 1",
    "/absolute.js",
    "file:///etc/passwd",
    "../../App.jsx",
    "../../../outside.js",
    "../%2e%2e/App.jsx",
    "../shared%2fsecret.js",
    "../shared\\secret.js",
    "../shared/missing.js",
    "../../data.json?raw",
    "../shared/name.js%3Fraw",
    "../shared/name.js%23fragment",
  ]) {
    await write(
      root,
      DASHBOARD,
      `import value from ${JSON.stringify(specifier)};export function DashboardContent(){return value}`,
    );
    await assert.rejects(compile(root), /--source/u, specifier);
  }
});

test("enforces exact filename case and rejects file and directory symlinks", async (t) => {
  const root = await fixture(t, { "src/content/shared/CaseSensitive.js": "export default 3;" });
  await write(
    root,
    DASHBOARD,
    'import value from "../shared/casesensitive.js";export function DashboardContent(){return value}',
  );
  await assert.rejects(compile(root), /case-mismatched path.*--source/u);
  await write(root, "outside.js", "export default 4;");
  await symlink(join(root, "outside.js"), join(root, "src/content/shared/link.js"));
  await write(
    root,
    DASHBOARD,
    'import value from "../shared/link.js";export function DashboardContent(){return value}',
  );
  await assert.rejects(compile(root), /symlink.*--source/u);
  await symlink(join(root, "src/content/shared"), join(root, "src/content/linked"), "dir");
  await write(
    root,
    DASHBOARD,
    'import value from "../linked/CaseSensitive.js";export function DashboardContent(){return value}',
  );
  await assert.rejects(compile(root), /symlink.*--source/u);
});

test("decoded query and fragment characters cannot collide with virtual module IDs", async (t) => {
  const root = await fixture(t, { "src/content/shared/name.js": "export default 'normal';" });
  if (process.platform !== "win32") {
    await write(root, "src/content/shared/name.js?raw", "export default 'different file';");
    await write(root, "src/content/shared/name.js#fragment", "export default 'another file';");
  }
  for (const encoded of ["name.js%3Fraw", "name.js%23fragment"]) {
    await write(
      root,
      DASHBOARD,
      `import normal from "../shared/name.js?raw";
      import disguised from "../shared/${encoded}";export function DashboardContent(){return [normal,disguised]}`,
    );
    await assert.rejects(compile(root), /invalid local path.*--source/u);
  }
});

test("missing direct runtime imports and reexports fail during compilation", async (t) => {
  const root = await fixture(t);
  for (const source of [
    'import {useStates} from "react";export function DashboardContent(){return useStates}',
    'import {ChartRendrer} from "../../data-app-public.jsx";export function DashboardContent(){return ChartRendrer}',
    'export {notAvailable as chart} from "recharts";export function DashboardContent(){return 1}',
    'import {notAvailable} from "react-markdown";export function DashboardContent(){return 1}',
  ]) {
    await write(root, DASHBOARD, source);
    await assert.rejects(compile(root), /missing export.*bundled module.*DashboardContent\.jsx.*--source/u);
  }
});

test("verified runtime facades catch missing names through local star/reexport chains", async (t) => {
  const root = await fixture(t, {
    "src/content/shared/first.js": 'export * from "react";export {default as ReactDefault} from "react";',
    "src/content/shared/second.js": 'export * from "./first.js";',
  });
  for (const source of [
    'import {notAvailable} from "../shared/second.js";export function DashboardContent(){return notAvailable}',
    'import {notAvailable} from "../shared/second.js";export function DashboardContent(){return 1}',
    'export {notAvailable as value} from "../shared/second.js";export function DashboardContent(){return 1}',
    'import ReactDefault from "../shared/second.js";export function DashboardContent(){return ReactDefault}',
  ]) {
    await write(root, DASHBOARD, source);
    await assert.rejects(compile(root), /bundle authored modules:.*not exported.*--source/u, source);
  }
});

test("runtime facade default, namespace, star exports, and __esModule interop remain coherent", async (t) => {
  const root = await fixture(t, {
    "src/content/shared/runtime.js": 'export * from "react";export {default as ReactDefault} from "react";',
    [DASHBOARD]: `import React,{useState,__esModule as marker} from "react";
      import * as direct from "react";import * as reexported from "../shared/runtime.js";
      import {ReactDefault} from "../shared/runtime.js";
      export function DashboardContent(){return {React,useState,marker,direct,reexported,ReactDefault}}`,
  });
  const runtime = runtimeFixture();
  assert.equal(Object.getOwnPropertyDescriptor(runtime.modules.react, "__esModule").enumerable, false);
  const result = instantiate(await compile(root, runtimeExports(runtime)), { runtime }).DashboardContent();
  assert.equal(result.React, runtime.modules.react.default);
  assert.equal(result.ReactDefault, result.React);
  assert.equal(result.direct.default, result.React);
  assert.equal(result.direct.useState, result.useState);
  assert.equal(result.reexported.useState, result.useState);
  assert.equal(result.marker, true);
  assert.equal(result.direct.__esModule, true);
  assert.equal(result.reexported.__esModule, true);
  assert.equal(Object.hasOwn(result.reexported, "default"), false);
  assert.equal(Object.isFrozen(result.direct), true);
  assert.equal(Object.isFrozen(result.reexported), true);
});

test("runtime facade export names are quoted rather than interpreted as source", async (t) => {
  const normal = runtimeFixture();
  const runtime = runtimeFixture({
    react: namespace({ ...normal.modules.react, "legal-string-name": 42 }, normal.modules.react.default),
  });
  const root = await fixture(t, {
    [DASHBOARD]: 'import {"legal-string-name" as value} from "react";export function DashboardContent(){return value}',
  });
  assert.equal(instantiate(await compile(root, runtimeExports(runtime)), { runtime }).DashboardContent(), 42);
});

test("browser-side runtime export checks remain a defense before authored code executes", async (t) => {
  const root = await fixture(t, {
    [DASHBOARD]:
      'import {useState} from "react";globalThis.ran=true;export function DashboardContent(){return useState}',
  });
  const compiled = await compile(root);
  const normal = runtimeFixture();
  const { useState: _missing, ...remaining } = normal.modules.react;
  const runtime = runtimeFixture({ react: namespace(remaining, normal.modules.react.default) });
  const globals = {};
  assert.throws(() => instantiate(compiled, { runtime, globals }), /Missing bundled Data export useState from react/u);
  assert.equal(globals.ran, undefined);
});

test("compiles the real maintained dashboard/report content without node_modules or author execution", async () => {
  const root = join(PLUGIN_ROOT, "templates/data-app/base");
  const manifest = JSON.parse(await readFile(join(PLUGIN_ROOT, "assets/data-app-runtime/manifest.json"), "utf8"));
  const moduleExports = manifest.artifacts.app.metadata.moduleExports;
  assert.deepEqual(Object.keys(moduleExports).sort(), AUTHORED_RUNTIME_MODULES);
  const compiled = await compile(root, moduleExports);
  const { DashboardContent, ReportContent } = instantiate(compiled, {
    runtime: runtimeFixtureWithExports(moduleExports),
  });
  assert.equal(typeof DashboardContent, "function");
  assert.equal(typeof ReportContent, "function");
  assert.ok(compiled.sourceFiles.includes("src/content/dashboard/dashboard-data.js"));
  assert.ok(compiled.sourceFiles.includes("src/content/dashboard/regional-world-map.js"));
  assert.ok(compiled.cssFiles.includes("src/theme.css"));
  assert.match(compiled.styles, /regional-map/u);
  assert.doesNotMatch(compiled.factorySource, /node_modules|https:\/\/registry/u);
  assert.ok((await readFile(join(root, DASHBOARD), "utf8")).includes("DashboardContent"));
});
